// Transcript of Record + divergence detection (ticket 02).
//
// opencode resends the whole message array every Turn; a Copilot chat remembers
// its own. We keep the authoritative tape here and treat the browser thread as a
// disposable projection of it.
//
// Measured behaviour this relies on: the array is APPEND-ONLY in normal
// operation — messages [0] and [1] never change, and each Turn appends exactly
// two (assistant with tool_calls, then tool with tool_call_id). Anything else —
// a retry, an edit, opencode's own compaction — shows up as prefix divergence
// and is handled by exactly one mechanism: throw the projection away and
// re-seed.

import crypto from 'node:crypto'

export function hashMessage(m) {
  // tool_call ids are minted per attempt and would cause false divergence on an
  // otherwise identical retry, so they are excluded from identity.
  const stable = {
    role: m.role,
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? null),
    tools: (m.tool_calls ?? []).map((t) => `${t.function?.name}:${t.function?.arguments}`),
  }
  return crypto.createHash('sha1').update(JSON.stringify(stable)).digest('hex').slice(0, 16)
}

export class Session {
  constructor(id) {
    this.id = id
    /** hashes of the opencode messages already reflected in the Thread Projection */
    this.sent = []
    /** the live projection, if any (opaque handle owned by the caller) */
    this.projection = null
    this.turns = 0
    this.reseeds = 0
  }

  /**
   * Compare an incoming message array against what this projection has been
   * sent. Returns either a delta to append, or an instruction to re-seed.
   */
  plan(messages) {
    const incoming = messages.map(hashMessage)

    if (!this.projection || this.sent.length === 0) {
      return { action: 'reseed', reason: 'no live projection', messages, incoming }
    }
    if (incoming.length < this.sent.length) {
      return { action: 'reseed', reason: 'history shrank (compaction or fork)', messages, incoming }
    }
    for (let i = 0; i < this.sent.length; i++) {
      if (incoming[i] !== this.sent[i]) {
        return { action: 'reseed', reason: `prefix diverged at message ${i}`, messages, incoming }
      }
    }
    const delta = messages.slice(this.sent.length)
    if (delta.length === 0) {
      return { action: 'reseed', reason: 'no new messages (duplicate request)', messages, incoming }
    }
    return { action: 'delta', delta, messages, incoming }
  }

  /** Record that the projection now reflects this whole array. */
  commit(incoming) {
    this.sent = incoming
    this.turns++
  }

  markReseeded(projection) {
    this.projection = projection
    this.sent = []
    this.reseeds++
  }

  invalidate() {
    this.projection = null
    this.sent = []
  }
}

export class SessionStore {
  constructor() {
    this.map = new Map()
  }
  get(id) {
    if (!this.map.has(id)) this.map.set(id, new Session(id))
    return this.map.get(id)
  }
}
