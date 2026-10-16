// The narrow browser seam (ticket 17): everything above this line — protocol,
// transcript, queue, recovery — is testable against a fake implementing
// `send(text) -> replyText`. The inevitable Copilot UI change is contained here.
//
// Selectors and signals below are all measured, not guessed. See
// .scratch/session/ for the evidence behind each one.

import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'

export const SELECTORS = {
  composer: '#m365-chat-editor-target-element',
  sendButton: 'button[aria-label="Send"]',
  // message-level copy; carries a stable testid, unlike the code-block one
  copyResponse: '[data-testid="CopyButtonTestId"]',
  copyCode: 'button[aria-label="Copy code"]',
  stopButton: '[aria-label*="Stop" i], [aria-label*="Cancel generat" i]',
  // the "+" in the composer. Two testids exist: PlusMenuButton on the empty-chat
  // layout, chat-input-attach-button once a conversation is under way.
  plusMenu: '[data-testid="PlusMenuButton"], [data-testid="chat-input-attach-button"]',
  fileInput: 'input[type="file"]',
  modelSelector: '[aria-label="Model Selector"]',
}

/**
 * Payloads at or below this go in as composer text; anything larger is uploaded
 * as a file instead.
 *
 * Set just under the 43,308 chars proven to send, deliberately: the bare
 * Preamble is 39,819, so a first-Turn Re-seed still takes the fast composer path
 * (no upload latency, no OneDrive copy), while a Re-seed carrying real history —
 * or any large tool result — routes to upload. Deltas are small and always take
 * the composer.
 */
export const COMPOSER_LIMIT = 42000

const CHAT_URL = 'https://m365.cloud.microsoft/chat'

export async function launch({ profileDir = '.scratch/browser-profile', headless = false } = {}) {
  const ctx = await chromium.launchPersistentContext(path.resolve(profileDir), {
    headless,
    viewport: { width: 1440, height: 960 },
    args: ['--disable-blink-features=AutomationControlled'],
  })
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'https://m365.cloud.microsoft',
  })

  // Capture what the page COPIES rather than reading the system clipboard.
  //
  // navigator.clipboard.readText() requires the document to be focused, so it
  // silently returns empty whenever the browser window is not frontmost — fatal
  // for a shim that runs in the background while the user works elsewhere.
  // Intercepting writeText/execCommand has no focus requirement, no permission
  // dependency, and cannot be disturbed by anything else using the clipboard.
  await ctx.addInitScript(() => {
    window.__shimClipboard = null
    window.__shimClipboardPath = null
    try {
      const orig = navigator.clipboard?.writeText?.bind(navigator.clipboard)
      if (orig) {
        navigator.clipboard.writeText = (text) => {
          window.__shimClipboard = text
          window.__shimClipboardPath = 'writeText'
          return orig(text)
        }
      }
      // Fluent/modern apps copy rich content via write([ClipboardItem]) so that
      // both text/plain and text/html land on the clipboard. writeText is never
      // called on that path, which is why intercepting it alone captured nothing.
      const origWrite = navigator.clipboard?.write?.bind(navigator.clipboard)
      if (origWrite) {
        navigator.clipboard.write = async (items) => {
          try {
            for (const item of items ?? []) {
              if (item?.types?.includes?.('text/plain')) {
                const blob = await item.getType('text/plain')
                window.__shimClipboard = await blob.text()
                window.__shimClipboardPath = 'write/ClipboardItem'
                break
              }
            }
          } catch {}
          return origWrite(items)
        }
      }
    } catch {}

    // last resort: the copy event carries the payload regardless of which API
    // produced it
    document.addEventListener(
      'copy',
      (e) => {
        try {
          const t = e.clipboardData?.getData('text/plain')
          if (t) {
            window.__shimClipboard = t
            window.__shimClipboardPath = 'copy-event'
          }
        } catch {}
      },
      true,
    )
    // older copy paths go through execCommand('copy') on a selected node
    const origExec = document.execCommand?.bind(document)
    if (origExec) {
      document.execCommand = (cmd, ...rest) => {
        if (String(cmd).toLowerCase() === 'copy') {
          const sel = window.getSelection?.()
          if (sel && String(sel)) window.__shimClipboard = String(sel)
        }
        return origExec(cmd, ...rest)
      }
    }
  })

  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })

  // Reaching the chat goes through an OAuth redirect chain, so the URL right
  // after domcontentloaded is meaningless — an authenticated load still passes
  // through login.microsoftonline for a moment. Wait for a DOM signal instead:
  // the composer (authenticated) or a password field (not).
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    const [composer, password] = await Promise.all([
      page.locator(SELECTORS.composer).count().catch(() => 0),
      page.locator('input[type="password"]').count().catch(() => 0),
    ])
    if (composer > 0) return { ctx, page, authenticated: true }
    if (password > 0) return { ctx, page, authenticated: false }
    await page.waitForTimeout(500)
  }
  return { ctx, page, authenticated: false, reason: 'neither composer nor login form appeared' }
}

/** Number of completed responses currently on screen. Used as a baseline so we
 *  can tell OUR reply apart from ones already present. */
/** Count only VISIBLE matches. A hidden Stop control left in the DOM would make
 *  `stops === 0` unsatisfiable and hang every Turn until its timeout. Not
 *  observed on an empty chat, but cheap insurance and correct either way. */
export async function visibleCount(page, selector) {
  return page.locator(selector).filter({ visible: true }).count()
}

export async function responseCount(page) {
  return visibleCount(page, SELECTORS.copyResponse)
}

/**
 * Choose the Copilot response mode.
 *
 * Why this matters: in "Auto" mode Copilot runs its OWN code interpreter. Asked
 * to run a shell command it executes it in Microsoft's sandbox and reports
 * "No such file or directory" — the wrong machine — instead of emitting a
 * tool_call for the harness to run on the user's computer. "Quick response"
 * answers directly and is the mode most likely to respect the output contract.
 *
 * Best-effort: a UI change here degrades to the default mode rather than
 * failing the Turn.
 */
export async function selectMode(page, mode = 'Quick response') {
  try {
    const selector = page.locator(SELECTORS.modelSelector).first()
    if ((await selector.count()) === 0) return { ok: false, reason: 'selector not present' }
    await selector.click({ timeout: 10000 })
    await page.waitForTimeout(900)
    const option = page.getByRole('menuitemradio', { name: new RegExp(mode, 'i') }).first()
    const fallback = page.getByText(new RegExp(`^${mode}`, 'i')).first()
    const target = (await option.count()) > 0 ? option : fallback
    if ((await target.count()) === 0) {
      await page.keyboard.press('Escape')
      return { ok: false, reason: `mode "${mode}" not offered` }
    }
    await target.click({ timeout: 8000 })
    await page.waitForTimeout(800)
    return { ok: true, mode }
  } catch (e) {
    await page.keyboard.press('Escape').catch(() => {})
    return { ok: false, reason: String(e).slice(0, 120) }
  }
}

/**
 * Attach a file via the composer's "+" → "Upload images and files".
 *
 * The `input[type=file]` does not exist until the menu is opened, which is why
 * a direct setInputFiles on page load finds nothing. Opening the menu creates
 * it, and Playwright can then set files on it even though it is hidden.
 *
 * NOTE: the page states "Uploading from device will send a copy to OneDrive
 * (personal)" — uploads are not local-only.
 */
export async function attachFile(page, filePath) {
  const name = path.basename(filePath)

  await page.locator(SELECTORS.plusMenu).first().click({ timeout: 20000 })
  await page.waitForTimeout(700)

  const input = page.locator(SELECTORS.fileInput).first()
  await input.waitFor({ state: 'attached', timeout: 15000 })
  await input.setInputFiles(filePath)

  // Wait for the app's own confirmation rather than a fixed sleep — a large
  // upload that is still in flight would otherwise be sent without its content.
  const deadline = Date.now() + 180000
  while (Date.now() < deadline) {
    const done = await page
      .evaluate((n) => (document.body.innerText || '').includes(`${n} upload finished`), name)
      .catch(() => false)
    if (done) return { attached: true, name }
    await page.waitForTimeout(500)
  }
  throw new Error(`upload of ${name} did not report finished within 180s`)
}

/**
 * Put a payload in front of Copilot, choosing the channel by size.
 *
 * Anything over COMPOSER_LIMIT goes in as an uploaded file with a short covering
 * message, which lifts the hard composer ceiling off the design: a Re-seed of a
 * long Transcript, or a 3000-line file read, no longer has to fit in a text box.
 */
export async function injectAndSend(page, text, { tmpDir = '.scratch/uploads' } = {}) {
  if (text.length > COMPOSER_LIMIT) {
    fs.mkdirSync(tmpDir, { recursive: true })
    const file = path.resolve(tmpDir, `payload-${uploadSeq++}.md`)
    fs.writeFileSync(file, text)
    await attachFile(page, file)
    await fillComposerVerified(page, COVERING_MESSAGE)
    await page.waitForSelector(SELECTORS.sendButton, { timeout: 15000 })
    await page.locator(SELECTORS.sendButton).first().click()
    return { channel: 'upload', bytes: text.length, file }
  }

  await fillComposerVerified(page, text)
  await page.waitForSelector(SELECTORS.sendButton, { timeout: 15000 })
  await page.locator(SELECTORS.sendButton).first().click()
  return { channel: 'composer', bytes: text.length }
}

/**
 * Fill the composer and CONFIRM the text is still there.
 *
 * Fluent keeps re-rendering the editor for seconds after a navigation. A fill
 * that lands during hydration gets wiped, leaving only a `<br>` placeholder —
 * and since the Send button is present either way, the Turn then sends an empty
 * message. Observed for real: Copilot replied "your message only contains an
 * HTML line break tag (<br aria-hidden="true">)".
 *
 * Verifying beats sleeping: it is correct whether hydration takes 200ms or 8s.
 */
export async function fillComposerVerified(page, text, { attempts = 4 } = {}) {
  const wantLen = text.length
  for (let i = 1; i <= attempts; i++) {
    await page.locator(SELECTORS.composer).click()
    await page.locator(SELECTORS.composer).fill(text)
    await page.waitForTimeout(400)

    // read back twice, a beat apart, so a wipe that happens just after the fill
    // is caught rather than raced past
    const first = await page.locator(SELECTORS.composer).innerText().catch(() => '')
    await page.waitForTimeout(600)
    const second = await page.locator(SELECTORS.composer).innerText().catch(() => '')

    const ok = second.length >= wantLen * 0.95 && first.length >= wantLen * 0.95
    if (ok) return { ok: true, attempts: i, got: second.length }

    if (i < attempts) await page.waitForTimeout(1500 * i)
  }
  throw new Error(
    `composer did not retain the payload after ${attempts} attempts (wanted ${wantLen} chars) — the page is probably still re-rendering`,
  )
}

let uploadSeq = 1

/** Sent alongside an uploaded payload. Deliberately restates the output contract,
 *  because the instructions now live in the attachment rather than in the message
 *  Copilot is directly answering. */
const COVERING_MESSAGE = [
  'The attached file contains your full instructions and the current state of the task.',
  'Read all of it, then follow the instructions inside it exactly.',
  'Reply with exactly one fenced json code block and nothing else.',
].join(' ')

/**
 * Completion detection (ticket 07). Measured behaviour: during generation a
 * Stop control is present and the message has no Copy control; on completion the
 * Stop disappears and a Copy Response button appears on the new message.
 *
 * We wait for the copy-button COUNT to exceed the pre-send baseline, which is
 * robust to the follow-up suggestion chips that make body text non-monotonic.
 */
/** In-progress markers Copilot renders while thinking. A copy control exists on
 *  the placeholder message during this phase, which is what made the earlier
 *  predicate fire at t+1.02s on a response that had not started. */
const GENERATING_RE = /Generating response|Digging in|Thinking|Searching the web/i

function completionSignals() {
  const vis = (e) => {
    const r = e.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const body = document.body.innerText || ''
  // NOTE: deliberately does NOT key off the literal string "Copilot said:".
  // An earlier version did, and any change to that label — a UI revision, a
  // different locale — would leave the predicate permanently unsatisfiable and
  // every Turn would time out at 180s with no diagnosis.
  return {
    copies: [...document.querySelectorAll('[data-testid="CopyButtonTestId"]')].filter(vis).length,
    stops: [...document.querySelectorAll('[aria-label*="Stop" i],[aria-label*="Cancel generat" i]')].filter(vis).length,
    generating: /Generating response|Digging in|Thinking|Searching the web/i.test(body),
    bodyLen: body.length,
  }
}

/**
 * Completion detection (ticket 07, corrected).
 *
 * The original predicate — copy control appears, stop control gone — FIRES
 * PREMATURELY. Measured: it returned ok after 1450ms on a response still showing
 * "Digging in…", and the resulting extraction was empty. A premature "done"
 * silently truncates a tool call, which is the single worst failure this system
 * can have, so the predicate is now deliberately conservative:
 *
 *   copy control present  AND  no stop control  AND  no in-progress marker
 *   AND  the reply has non-empty text  AND  that text has stopped changing
 *
 * Text stability is used only as a TIE-BREAKER here, not as the primary signal —
 * it is unreliable alone because suggestion chips make body length non-monotonic.
 */
export async function waitForComplete(page, baselineCount, { timeoutMs = 180000, stableMs = 1500, trace = null } = {}) {
  const deadline = Date.now() + timeoutMs
  const started = Date.now()
  const samples = []
  let sawGeneration = false
  let lastLen = -1
  let stableSince = null

  while (Date.now() < deadline) {
    const s = await page.evaluate(completionSignals).catch(() => null)
    if (s) {
      if (samples.length < 800) samples.push({ t: Math.round((Date.now() - started) / 100) / 10, ...s })
      if (s.stops > 0 || s.generating) sawGeneration = true

      if (s.bodyLen !== lastLen) {
        lastLen = s.bodyLen
        stableSince = null
      } else if (stableSince === null) {
        stableSince = Date.now()
      }

      // NOTE: `generating` is recorded for diagnostics but deliberately NOT part
      // of the predicate. It is a text match over document.innerText, which
      // includes OUR OWN injected Preamble — opencode's system prompt contains
      // words like "Thinking", so the check pinned itself true forever and every
      // Turn timed out at 180s despite a correct answer arriving at t+10s.
      //
      // Text stability replaces it and is strictly better: during the
      // placeholder phase that caused the earlier premature fire, the body was
      // still GROWING, so the stability requirement rejects that moment on its
      // own. Verified against both recorded timelines.
      const settled = stableSince !== null && Date.now() - stableSince >= stableMs
      if (s.copies > baselineCount && s.stops === 0 && settled) {
        trace?.({ ok: true, samples })
        return { ok: true, sawGeneration, elapsedMs: Date.now() - started, samples }
      }
    }
    await page.waitForTimeout(250)
  }
  // A timeout with no diagnosis is the worst outcome: the run is dead and the
  // evidence is gone. Hand back the signal trace so the caller can dump it.
  trace?.({ ok: false, samples })
  return { ok: false, sawGeneration, reason: 'timeout', samples, baselineCount }
}

/**
 * Extraction (ticket 08). The copy button is byte-faithful — newlines,
 * indentation and backslash escapes all survive — PROVIDED Copilot rendered a
 * real code block. Prose rendered inline has its whitespace collapsed by the
 * page, and no extraction path can recover it. The protocol must therefore keep
 * payloads inside fenced blocks.
 */
export async function extractLast(page) {
  const copies = page.locator(SELECTORS.copyResponse).filter({ visible: true })
  const n = await copies.count()
  if (n === 0) throw new Error('no copy control found — cannot extract')

  await page.evaluate(() => {
    window.__shimClipboard = null
  })
  await copies.nth(n - 1).click()

  // wait for the interception to fire rather than sleeping a fixed interval
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const captured = await page.evaluate(() => window.__shimClipboard)
    if (captured) return captured
    await page.waitForTimeout(150)
  }

  // fall back to the system clipboard; works only when the window is focused,
  // which is why it is the fallback and not the primary path
  const fallback = await page.evaluate(() => navigator.clipboard.readText().catch(() => '')).catch(() => '')
  if (fallback) return fallback
  throw new Error('copy produced no text — the page may be blocked (quota notice?) or the copy control changed')
}

export class QuotaExhausted extends Error {}

/**
 * Detect the daily-limit notice from the PAGE, not from the extracted reply.
 * Measured: the notice renders as an ordinary-looking assistant turn but does
 * not yield copyable text, so a shim that only inspected the extraction would
 * see an empty string and misdiagnose it as a formatting failure — then burn
 * its repair budget re-asking a chat that cannot answer.
 */
export async function checkQuota(page) {
  const hit = await page
    .evaluate(() => /reached your daily chat limit|check back tomorrow/i.test(document.body.innerText || ''))
    .catch(() => false)
  if (hit) throw new QuotaExhausted('Copilot daily chat limit reached')
}

/** One full round trip. This is the entire surface the rest of the Shim needs. */
export async function ask(page, text, opts = {}) {
  await checkQuota(page)
  const baseline = await responseCount(page)
  const sent = await injectAndSend(page, text)
  const done = await waitForComplete(page, baseline, opts)
  await checkQuota(page)
  if (!done.ok) {
    const err = new Error(`response did not complete: ${done.reason}`)
    err.diagnostics = { sent, baseline, samples: done.samples }
    throw err
  }
  return extractLast(page)
}
