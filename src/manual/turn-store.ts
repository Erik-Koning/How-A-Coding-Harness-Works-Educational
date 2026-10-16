// Pending queue, per-turn state machine, and in-memory history for the panel.
//
// This file is where the compliance property of manual mode actually lives:
// nothing here advances a turn on a timer, on arrival, or on any condition other
// than an explicit human action arriving from the panel. There are no timers in
// this module at all, by design — see the `assertNoTimers` note in the tests.

import { EventEmitter } from 'node:events'
import type { TurnRequest } from '../transport/types.js'

export type TurnState = 'pending_copy' | 'awaiting_response' | 'in_review' | 'committed'

/**
 * The Copilot chat a turn must be pasted into, as the human knows it.
 *
 * Every turn that carries a system prompt asks the human to start a new chat,
 * and gets a new label. Turns without one belong to their conversation's
 * latest chat. Without labels the panel could only say "the same chat as the
 * previous turn", which is wrong as soon as a subagent has its own chat.
 */
export interface ChatInfo {
  /** "A", "B", … in the order the human was asked to start them. */
  label: string
  /** The turn whose paste started this chat. */
  startedAtTurn: number
  /** For a subagent's chat: the label of the chat that started the subagent. */
  parentLabel?: string
}

export interface TurnRecord {
  id: string
  turnIndex: number
  conversationId: string
  chat: ChatInfo
  /** Why this turn exists, when it is not a step of the task. */
  purpose?: string
  systemPrompt?: string
  query: string
  /** Delta turns only: everything so far, for pasting into a brand-new chat. */
  fullContext?: { systemPrompt: string; query: string }
  state: TurnState
  /** What the human pasted; only set from `review` onwards. */
  draft?: string
  /** What was actually committed to opencode. */
  response?: string
  createdAt: string
  committedAt?: string
}

export interface PanelSnapshot {
  current: TurnRecord | null
  history: TurnRecord[]
}

type Resolver = {
  resolve: (text: string) => void
  reject: (err: Error) => void
}

let seq = 0

/** A, B, … Z, then A2, B2, … */
function chatLabel(n: number): string {
  const letter = String.fromCharCode(65 + (n % 26))
  return n < 26 ? letter : `${letter}${Math.floor(n / 26) + 1}`
}

function withoutFullContext(t: TurnRecord): TurnRecord {
  if (!t.fullContext) return t
  const copy = { ...t }
  delete copy.fullContext
  return copy
}

export class TurnStore extends EventEmitter {
  private turns = new Map<string, TurnRecord>()
  private order: string[] = []
  private waiters = new Map<string, Resolver>()
  /** Each conversation's current chat. */
  private chats = new Map<string, ChatInfo>()
  private chatCount = 0

  /**
   * Register a turn and return the promise the transport hands back.
   *
   * The promise is stored, not raced against anything. It resolves in exactly
   * one place: `send()`, which is only reachable from a panel POST.
   */
  open(req: TurnRequest): { record: TurnRecord; wait: Promise<string> } {
    const id = `turn_${++seq}`
    const record: TurnRecord = {
      id,
      turnIndex: req.turnIndex,
      conversationId: req.conversationId,
      chat: this.chatFor(req),
      purpose: req.purpose,
      systemPrompt: req.systemPrompt,
      query: req.query,
      fullContext: req.fullContext,
      state: 'pending_copy',
      createdAt: new Date().toISOString(),
    }
    this.turns.set(id, record)
    this.order.push(id)

    const wait = new Promise<string>((resolve, reject) => {
      this.waiters.set(id, { resolve, reject })
    })

    this.emit('changed', this.snapshot())
    return { record, wait }
  }

  get(id: string): TurnRecord | undefined {
    return this.turns.get(id)
  }

  private chatFor(req: TurnRequest): ChatInfo {
    const existing = this.chats.get(req.conversationId)
    if (existing && req.systemPrompt === undefined) return existing
    const chat: ChatInfo = { label: chatLabel(this.chatCount++), startedAtTurn: req.turnIndex }
    const parent = req.parentConversationId && this.chats.get(req.parentConversationId)
    if (parent) chat.parentLabel = parent.label
    this.chats.set(req.conversationId, chat)
    return chat
  }

  /** The turn the panel should be showing: the oldest not-yet-committed one. */
  current(): TurnRecord | null {
    for (const id of this.order) {
      const t = this.turns.get(id)
      if (t && t.state !== 'committed') return t
    }
    return null
  }

  snapshot(): PanelSnapshot {
    return {
      current: this.current(),
      // Only the turn on screen needs its full context. Keeping ~40K chars on
      // every past turn would make each SSE frame grow with the session.
      history: this.order.map((id) => this.turns.get(id)!).filter(Boolean).map(withoutFullContext),
    }
  }

  // --- transitions. Each is reachable only from an explicit panel action. ---

  markCopied(id: string): TurnRecord | undefined {
    const t = this.turns.get(id)
    if (!t || t.state !== 'pending_copy') return t
    t.state = 'awaiting_response'
    this.emit('changed', this.snapshot())
    return t
  }

  review(id: string, draft: string): TurnRecord | undefined {
    const t = this.turns.get(id)
    if (!t || t.state === 'committed') return t
    t.draft = draft
    t.state = 'in_review'
    this.emit('changed', this.snapshot())
    return t
  }

  editAgain(id: string): TurnRecord | undefined {
    const t = this.turns.get(id)
    if (!t || t.state !== 'in_review') return t
    t.state = 'awaiting_response'
    this.emit('changed', this.snapshot())
    return t
  }

  /**
   * The ONLY path that resolves a pending submit(). Called from the panel's
   * `send` endpoint and nowhere else.
   */
  send(id: string, text: string): TurnRecord | undefined {
    const t = this.turns.get(id)
    if (!t || t.state === 'committed') return t
    t.response = text
    t.state = 'committed'
    t.committedAt = new Date().toISOString()

    const waiter = this.waiters.get(id)
    this.waiters.delete(id)
    waiter?.resolve(text)

    this.emit('changed', this.snapshot())
    return t
  }

  /** The human reports the Copilot chat is gone; the turn must be re-seeded. */
  fail(id: string, err: Error): TurnRecord | undefined {
    const t = this.turns.get(id)
    if (!t) return undefined
    const waiter = this.waiters.get(id)
    this.waiters.delete(id)
    // drop it from the queue so the panel moves on to whatever comes next
    this.turns.delete(id)
    this.order = this.order.filter((x) => x !== id)
    waiter?.reject(err)
    this.emit('changed', this.snapshot())
    return t
  }

  /** Reject everything outstanding — used only on shutdown. */
  disposeAll(err: Error): void {
    for (const [, waiter] of this.waiters) waiter.reject(err)
    this.waiters.clear()
  }

  /** Test seam: how many submits are still awaiting a human. */
  get pendingCount(): number {
    return this.waiters.size
  }
}
