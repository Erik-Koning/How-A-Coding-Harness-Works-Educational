export type TurnState = 'pending_copy' | 'awaiting_response' | 'in_review' | 'committed'

/** The Copilot chat a turn belongs in. See ChatInfo in src/manual/turn-store.ts. */
export interface ChatInfo {
  label: string
  startedAtTurn: number
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
  draft?: string
  response?: string
  createdAt: string
  committedAt?: string
}

export interface PanelSnapshot {
  current: TurnRecord | null
  history: TurnRecord[]
}
