// Declarations for the untouched transcript module.

import type { OpencodeMessage } from './protocol.mjs'

export interface TurnPlan {
  action: 'reseed' | 'delta'
  reason?: string
  delta?: OpencodeMessage[]
  messages: OpencodeMessage[]
  incoming: string[]
}

export declare class Session {
  id: string
  sent: string[]
  projection: unknown
  turns: number
  reseeds: number
  plan(messages: OpencodeMessage[]): TurnPlan
  commit(incoming: string[]): void
  markReseeded(projection: unknown): void
  invalidate(): void
}

export declare class SessionStore {
  get(id: string): Session
}

export declare function hashMessage(m: OpencodeMessage): string
