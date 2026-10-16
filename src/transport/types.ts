// The one interface the rest of the shim talks to. Neither implementation knows
// the other exists.

import type { TransportMode } from '../config.js'

export interface TurnRequest {
  /** Present only when this turn starts a fresh Copilot conversation. Its
   *  presence is what tells the panel to say "start a new chat". */
  systemPrompt?: string
  query: string
  /**
   * The whole Transcript of Record rendered as a re-seed, offered beside a
   * delta so the human can move to a fresh Copilot chat by choice — not only
   * after declaring the old one lost. Present only on delta turns: a re-seed
   * already IS the full context.
   */
  fullContext?: { systemPrompt: string; query: string }
  turnIndex: number
  conversationId: string
  /**
   * Aborted when the opencode client that asked for this turn goes away —
   * quitting the TUI, Ctrl-C, a dropped connection.
   *
   * Manual mode deliberately never times out waiting for a human, but a turn
   * nobody is waiting for is different: left pending it blocks every later turn
   * and the panel keeps showing a dead query. Observed for real after quitting
   * and restarting opencode.
   *
   * This does NOT advance a turn — it discards one.
   */
  signal?: AbortSignal
}

export interface TurnResponse {
  text: string
  /** ISO */
  receivedAt: string
  source: TransportMode
}

export interface CopilotTransport {
  readonly mode: TransportMode
  init(): Promise<void>
  submit(req: TurnRequest): Promise<TurnResponse>
  dispose(): Promise<void>

  /**
   * A request has arrived but may wait behind an earlier turn.
   *
   * Called BEFORE the queue, unlike submit(). Without it, a turn that is still
   * unanswered blocks every later request and the human sees nothing at all —
   * observed for real: one unanswered turn silently swallowed two hours of
   * subsequent messages, and the panel was never surfaced because submit() was
   * never reached.
   */
  notifyIncoming?(): void
}

/**
 * The conversation this turn was appending to is gone.
 *
 * Needed because turns after the first carry only a delta. If the underlying
 * conversation is lost — a Playwright Pause cleared it, or the human started a
 * new Copilot chat — a delta is meaningless: it would land in a chat with no
 * system prompt and no history. The shim catches this, invalidates the session
 * and replans the turn as a full re-seed.
 *
 * Without it, delta mode has no recovery path at all.
 */
export class ProjectionLostError extends Error {
  constructor(message = 'the Copilot conversation was lost; a re-seed is required') {
    super(message)
    this.name = 'ProjectionLostError'
  }
}

/** The client that requested this turn went away; the turn was discarded. */
export class AbandonedTurnError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AbandonedTurnError'
  }
}

/** Raised when the transport cannot proceed and no retry will help. */
export class TransportUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransportUnavailableError'
  }
}
