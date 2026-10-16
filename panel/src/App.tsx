import { useCallback, useEffect, useRef, useState } from 'react'
import type { PanelSnapshot, TurnRecord } from './types'
import { OutboundColumn } from './components/OutboundColumn'
import { InboundColumn } from './components/InboundColumn'
import { HistoryRail } from './components/HistoryRail'
import { EmptyState } from './components/EmptyState'
import { buildSessionMarkdown, downloadText } from './lib/export'

async function post(path: string, body: unknown): Promise<void> {
  await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export default function App() {
  const [snapshot, setSnapshot] = useState<PanelSnapshot>({ current: null, history: [] })
  const [connected, setConnected] = useState(false)
  const [draft, setDraft] = useState('')
  const lastTurnId = useRef<string | null>(null)

  useEffect(() => {
    const es = new EventSource('/events')
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.onmessage = (e) => {
      const next = JSON.parse(e.data) as PanelSnapshot
      setSnapshot(next)
      // Clear the textarea only when a genuinely new turn arrives, never on a
      // re-render — losing typed text would be unforgivable here.
      const id = next.current?.id ?? null
      if (id !== lastTurnId.current) {
        lastTurnId.current = id
        setDraft(next.current?.draft ?? '')
      }
    }
    return () => es.close()
  }, [])

  const turn = snapshot.current

  // The tab title is the one signal that survives the panel being a background
  // tab on another desktop. No sound, no popup — just an unmistakable marker.
  useEffect(() => {
    document.title = turn ? `● Turn ${turn.turnIndex} waiting — Copilot bridge` : 'Copilot bridge'
  }, [turn?.id, turn?.turnIndex])

  const onCopied = useCallback((t: TurnRecord) => post('/api/copied', { id: t.id }), [])
  const onReview = useCallback(
    (t: TurnRecord, text: string) => post('/api/review', { id: t.id, text }),
    [],
  )
  const onEditAgain = useCallback((t: TurnRecord) => post('/api/edit-again', { id: t.id }), [])
  const onSend = useCallback(
    (t: TurnRecord, text: string) => post('/api/send', { id: t.id, text }),
    [],
  )
  const onLostChat = useCallback((t: TurnRecord) => post('/api/lost-chat', { id: t.id }), [])

  const seamActive = !!turn && turn.state !== 'committed'

  return (
    <div className="flex h-full flex-col bg-base text-ink">
      <header className="flex shrink-0 items-center justify-between border-b border-hairline px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-semibold tracking-tight">Copilot bridge</h1>
          <span className="text-xs text-ink-faint">
            You are the wire between opencode and Copilot.
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-ink-dim">
          {snapshot.history.length > 0 && (
            <button
              onClick={() =>
                downloadText(
                  `copilot-session-${snapshot.history[0]?.conversationId ?? 'transcript'}.md`,
                  buildSessionMarkdown(snapshot.history),
                )
              }
              title="Full transcript of every turn so far. To restore a lost chat, use “I lost the chat” instead — it rebuilds the context properly."
              className="rounded border border-hairline px-2 py-1 text-[11px] hover:text-ink"
            >
              Export session
            </button>
          )}
          <span
            aria-hidden
            className={`inline-block size-1.5 rounded-full ${
              connected ? 'bg-accent' : 'bg-ink-faint'
            }`}
          />
          {connected ? 'Connected to shim' : 'Waiting for shim'}
        </div>
      </header>

      <main className="flex min-h-0 flex-1">
        {turn ? (
          <>
            <OutboundColumn
              turn={turn}
              onCopied={() => onCopied(turn)}
              onLostChat={() => onLostChat(turn)}
            />
            {/* The seam: lit and moving whenever a turn is waiting on a human. */}
            <div
              aria-hidden
              className={`seam shrink-0 ${seamActive ? 'seam-active' : ''}`}
              data-state={turn.state}
            />
            <InboundColumn
              turn={turn}
              draft={draft}
              onDraftChange={setDraft}
              onReview={() => onReview(turn, draft)}
              onEditAgain={() => onEditAgain(turn)}
              onSend={() => onSend(turn, turn.draft ?? draft)}
            />
          </>
        ) : (
          <EmptyState connected={connected} />
        )}
      </main>

      <HistoryRail history={snapshot.history} />
    </div>
  )
}
