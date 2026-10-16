// The automated transport. This is the existing browser logic ISOLATED behind
// the transport interface — moved, not improved.
//
// Nothing here is hardened, retried harder, paced, or made stealthier as part of
// this change. If a behaviour looked odd during the move it was left alone; the
// point of this file is that the rest of the shim no longer knows it exists.
//
// This module is only ever reached through a dynamic import in ./index.ts, which
// is what keeps `playwright` unloaded in manual mode.

import { exec } from 'node:child_process'
import type { ShimConfig, TransportMode } from '../config.js'
import type { CopilotTransport, TurnRequest, TurnResponse } from './types.js'
import { ProjectionLostError } from './types.js'
import {
  launch,
  ask,
  selectMode,
  SELECTORS,
  QuotaExhausted,
  type CopilotPage,
  type BrowserHandle,
} from '../copilot-driver.mjs'

const CHAT_URL = 'https://m365.cloud.microsoft/chat'
const PAUSE_LIMIT_MS = 15 * 60 * 1000

export class PlaywrightTransport implements CopilotTransport {
  readonly mode: TransportMode = 'playwright'

  private handle: BrowserHandle | null = null

  constructor(private readonly config: ShimConfig) {}

  async init(): Promise<void> {
    // Launch lazily on first submit; starting a browser at boot would open a
    // window before opencode has asked for anything.
  }

  async submit(req: TurnRequest): Promise<TurnResponse> {
    const page = await this.page()

    // A turn carrying a system prompt starts a fresh conversation.
    if (req.systemPrompt !== undefined) {
      await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector(SELECTORS.composer, { timeout: 60000 })
      // The composer exists well before Fluent has hydrated; an inject during
      // that window gets wiped. fillComposerVerified() is the real guard, this
      // just avoids burning its first attempt on a known-bad moment.
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.waitForTimeout(2500)
      // Auto mode lets Copilot run its own interpreter instead of emitting tool
      // calls; pick the direct-answer mode on every fresh conversation.
      const mode = await selectMode(page, 'Quick response')
      console.log(`[playwright] mode: ${mode.ok ? mode.mode : `default (${mode.reason})`}`)
    }

    const outbound =
      req.systemPrompt !== undefined ? `${req.systemPrompt}\n\n${req.query}` : req.query

    try {
      const text = await ask(page, outbound)
      return { text, receivedAt: new Date().toISOString(), source: this.mode }
    } catch (e: any) {
      if (e instanceof QuotaExhausted) throw e

      // A wall (login/MFA/challenge) looks like a failure to complete. Pause for
      // a human, then tell the shim the conversation is gone so it re-seeds.
      const composer = await page.locator(SELECTORS.composer).count().catch(() => 0)
      if (composer === 0) {
        if (await this.waitForHuman(page)) {
          throw new ProjectionLostError('resumed after a pause; the conversation must be re-seeded')
        }
        throw new Error('paused too long waiting for a human')
      }
      throw e
    }
  }

  async dispose(): Promise<void> {
    await this.handle?.ctx.close().catch(() => {})
    this.handle = null
  }

  // ------------------------------------------------------------------ internals

  private async page(): Promise<CopilotPage> {
    if (this.handle?.page && !this.handle.page.isClosed()) return this.handle.page

    console.log('[playwright] launching browser…')
    this.handle = await launch({})

    if (!this.handle.authenticated) {
      if (!(await this.waitForHuman(this.handle.page))) {
        throw new Error('not signed in, and nobody completed the login within the pause limit')
      }
    }
    console.log('[playwright] browser ready')
    return this.handle.page
  }

  private async waitForHuman(page: CopilotPage): Promise<boolean> {
    console.log('[playwright] PAUSED — needs a human. Surfacing the browser.')
    await page.bringToFront().catch(() => {})
    notify('opencode shim paused', 'Copilot needs you to sign in or clear a prompt.')

    const deadline = Date.now() + PAUSE_LIMIT_MS
    while (Date.now() < deadline) {
      const composer = await page.locator(SELECTORS.composer).count().catch(() => 0)
      if (composer > 0) {
        console.log('[playwright] resumed — chat surface is back')
        return true
      }
      await page.waitForTimeout(3000)
    }
    return false
  }
}

function notify(title: string, body: string): void {
  if (process.platform !== 'darwin') return
  const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`
  exec(`osascript -e ${JSON.stringify(script)}`, () => {})
}
