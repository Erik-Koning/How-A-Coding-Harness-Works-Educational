export type TurnState = 'pending_copy' | 'awaiting_response' | 'in_review' | 'committed'

export interface TurnRecord {
  id: string
  turnIndex: number
  conversationId: string
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
