import { useEffect, useRef } from 'react'
import type { TurnRecord } from '../types'

export function InboundColumn({
  turn,
  draft,
  onDraftChange,
  onReview,
  onEditAgain,
  onSend,
}: {
  turn: TurnRecord
  draft: string
  onDraftChange: (v: string) => void
  onReview: () => void
  onEditAgain: () => void
  onSend: () => void
}) {
  const reviewing = turn.state === 'in_review'
  const text = turn.draft ?? draft
  const ta = useRef<HTMLTextAreaElement>(null)

  // Focus the paste target whenever a new turn arrives, so returning from the
  // Copilot tab means you can paste immediately. Focusing an empty input moves
  // no data — the human still performs the paste and the send.
  useEffect(() => {
    if (!reviewing) ta.current?.focus()
  }, [turn.id, reviewing])

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-hairline px-4 py-2.5">
        <h2 className="text-xs font-semibold tracking-tight uppercase text-ink-dim">
          Inbound · {reviewing ? 'review' : 'paste response'}
        </h2>
        <span className="font-mono text-[11px] text-ink-faint">
          {text.length.toLocaleString()} chars
        </span>
      </div>

      {reviewing ? (
        <>
          <div className="shrink-0 border-b border-hairline px-4 py-2 text-xs text-ink-dim">
            Read this through. It is exactly what opencode will receive.
          </div>
          {/* Full text, never a truncated preview — the gate is only meaningful
              if the human can actually see what they are approving. */}
          <pre className="m-4 min-h-0 flex-1 overflow-auto rounded border border-hairline bg-panel-2 p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink">
            {text}
          </pre>
          <div className="flex shrink-0 gap-2 px-4 pb-4">
            <button
              onClick={onSend}
              autoFocus
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSend()
              }}
              className="flex-1 rounded border border-accent-dim bg-accent-dim/25 py-2 text-xs font-medium text-accent hover:bg-accent-dim/40"
            >
              Send to opencode
              <span className="ml-2 font-mono text-[10px] text-ink-faint">⌘⏎</span>
            </button>
            <button
              onClick={onEditAgain}
              className="rounded border border-hairline px-4 py-2 text-xs text-ink-dim hover:text-ink"
            >
              Edit again
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="shrink-0 border-b border-hairline px-4 py-2 text-xs text-ink-dim">
            Paste Copilot&rsquo;s reply here, then review it before it goes anywhere.
          </div>
          <textarea
            ref={ta}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              // Explicit intent only. Never submit on paste, on blur, or on a timer.
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && draft.trim()) onReview()
            }}
            spellCheck={false}
            placeholder="Paste the response…"
            className="m-4 min-h-0 flex-1 resize-none rounded border border-hairline bg-panel-2 p-3 font-mono text-[12px] leading-relaxed text-ink placeholder:text-ink-faint focus:border-accent-dim"
          />
          <div className="shrink-0 px-4 pb-4">
            <button
              onClick={onReview}
              disabled={!draft.trim()}
              className="w-full rounded border border-hairline bg-panel-2 py-2 text-xs font-medium text-ink transition-colors enabled:hover:border-accent-dim enabled:hover:text-accent disabled:cursor-not-allowed disabled:text-ink-faint"
            >
              Review
              <span className="ml-2 font-mono text-[10px] text-ink-faint">⌘⏎</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
