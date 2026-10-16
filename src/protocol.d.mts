// Declarations for the untouched protocol module.

export interface OpencodeMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: unknown
  tool_calls?: Array<{ id: string; function?: { name?: string; arguments?: string } }>
  tool_call_id?: string
}

export interface ToolSpec {
  type?: string
  function: { name: string; description?: string; parameters?: unknown }
}

export type ParsedReply =
  | { type: 'tool_call'; name: string; arguments: Record<string, unknown> }
  | { type: 'final'; content: string }

export declare class ProtocolError extends Error {
  kind: 'no-block' | 'bad-json' | 'bad-shape' | 'quota'
  raw: string
}

export declare const CONTINUE_NUDGE: string
export declare const PROTOCOL_RULES: string
export declare const REQUEST_DIRECTIVE: string

export declare function renderPreamble(systemPrompt: string, tools: ToolSpec[]): string
export declare function renderTools(tools: ToolSpec[]): string
export declare function renderReseed(messages: OpencodeMessage[], tools: ToolSpec[]): string
export declare function renderReseedParts(
  messages: OpencodeMessage[],
  tools: ToolSpec[],
): { systemPrompt: string; query: string }
export declare function renderDelta(delta: OpencodeMessage[]): string
export declare function renderToolResult(name: string, content: unknown): string
export declare function contentToText(content: unknown): string
export declare function parseReply(text: string): ParsedReply
export declare function repairPrompt(kind: string): string
