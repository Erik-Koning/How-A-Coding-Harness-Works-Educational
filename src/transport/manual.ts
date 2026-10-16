// The default transport: a human moves every message across the boundary.
//
// There is no timer, no fallback and no reference to Playwright anywhere in this
// file or anything it imports. A long wait is correct behaviour, not an error.

import type { ShimConfig, TransportMode } from '../config.js'
import type { CopilotTransport, TurnRequest, TurnResponse } from './types.js'
import { AbandonedTurnError } from './types.js'
import { TurnStore } from '../manual/turn-store.js'
import { PanelServer } from '../manual/panel-server.js'

export class ManualTransport implements CopilotTransport {
  readonly mode: TransportMode = 'manual'

  private readonly store = new TurnStore()
  private readonly panel: PanelServer
  private opened = false

  constructor(private readonly config: ShimConfig) {
    this.panel = new PanelServer(config, this.store)
  }

  async init(): Promise<void> {
    await this.panel.start()
  }

  /** Surface the panel the moment a request arrives, even if it will queue. */
  notifyIncoming(): void {
    if (this.config.manual.autoOpenBrowser) this.panel.raise()
  }

  async submit(req: TurnRequest): Promise<TurnResponse> {
    // Nothing to do if the caller already gave up while this was queued.
    if (req.signal?.aborted) {
      throw new AbandonedTurnError('the opencode client disconnected before this turn started')
    }

    const { record, wait } = this.store.open(req)

    // Drop the turn if the caller disappears. The human is never asked to relay
    // something no one is waiting for, and the queue does not wedge.
    const onAbort = (): void => {
      console.log(`[manual] turn ${req.turnIndex} abandoned — the opencode client disconnected`)
      this.store.fail(
        record.id,
        new AbandonedTurnError('the opencode client disconnected while this turn was pending'),
      )
    }
    req.signal?.addEventListener('abort', onAbort, { once: true })

    // Raise on every turn. A turn the human never notices is indistinguishable
    // from a hang, and the whole point of this mode is that they are the wire.
    if (this.config.manual.autoOpenBrowser) this.panel.raise()

    console.log(
      `[manual] turn ${req.turnIndex} awaiting a human — ${this.panel.url} ` +
        `(${req.systemPrompt ? 'new chat, system prompt included' : 'same chat, delta only'})`,
    )

    // Resolves only when a human presses Send in the panel. The only thing that
    // can interrupt it is the caller vanishing — never a timer, never a fallback.
    let text: string
    try {
      text = await wait
    } finally {
      req.signal?.removeEventListener('abort', onAbort)
    }

    return {
      text,
      receivedAt: record.committedAt ?? new Date().toISOString(),
      source: this.mode,
    }
  }

  async dispose(): Promise<void> {
    this.store.disposeAll(new Error('shim is shutting down'))
    await this.panel.stop()
  }
}
