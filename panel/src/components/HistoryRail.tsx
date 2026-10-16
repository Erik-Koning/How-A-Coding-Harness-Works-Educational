import { useState } from 'react'
import type { TurnRecord } from '../types'

const STATE_LABEL: Record<string, string> = {
  pending_copy: 'waiting to be copied',
  awaiting_response: 'awaiting response',
  in_review: 'in review',
  committed: 'sent to opencode',
}

function Row({ turn }: { turn: TurnRecord }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="border-t border-hairline first:border-t-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-1.5 text-left text-xs hover:bg-panel-2"
      >
        <span className="font-mono text-ink-faint">{String(turn.turnIndex).padStart(2, '0')}</span>
        <span className="shrink-0 font-mono text-ink-faint" title={`Copilot chat ${turn.chat.label}`}>
          {turn.chat.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-ink-dim">
          {turn.query.replace(/\s+/g, ' ').slice(0, 90)}
        </span>
        <span
          className={`shrink-0 ${turn.state === 'committed' ? 'text-ink-faint' : 'text-accent'}`}
        >
          {STATE_LABEL[turn.state] ?? turn.state}
        </span>
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-3">
          {turn.systemPrompt && (
            <div>
              <div className="mb-1 text-[11px] text-ink-faint">System prompt</div>
              <pre className="max-h-40 overflow-auto rounded border border-hairline bg-panel-2 p-2 font-mono text-[11px] whitespace-pre-wrap text-ink-dim">
                {turn.systemPrompt}
              </pre>
            </div>
          )}
          <div>
            <div className="mb-1 text-[11px] text-ink-faint">Query</div>
            <pre className="max-h-40 overflow-auto rounded border border-hairline bg-panel-2 p-2 font-mono text-[11px] whitespace-pre-wrap text-ink-dim">
              {turn.query}
            </pre>
          </div>
          {turn.response && (
            <div>
              <div className="mb-1 text-[11px] text-ink-faint">Response</div>
              <pre className="max-h-40 overflow-auto rounded border border-hairline bg-panel-2 p-2 font-mono text-[11px] whitespace-pre-wrap text-ink-dim">
                {turn.response}
              </pre>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

export function HistoryRail({ history }: { history: TurnRecord[] }) {
  const [open, setOpen] = useState(false)
  if (history.length === 0) return null

  return (
    <div className="shrink-0 border-t border-hairline">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-5 py-2 text-left text-xs text-ink-dim hover:text-ink"
      >
        <span aria-hidden className={`transition-transform ${open ? 'rotate-90' : ''}`}>
          ›
        </span>
        Turn history
        <span className="font-mono text-ink-faint">{history.length}</span>
      </button>
      {open && (
        <ul className="max-h-64 overflow-auto border-t border-hairline">
          {history.map((t) => (
            <Row key={t.id} turn={t} />
          ))}
        </ul>
      )}
    </div>
  )
}
