import { useRef, useState } from 'react'
import type { TurnRecord } from '../types'
import { copyText } from '../lib/copy'
import { downloadText } from '../lib/export'

type CopyState = 'idle' | 'copied' | 'failed'

function CopyBlock({
  label,
  text,
  onCopied,
}: {
  label: string
  text: string
  onCopied: () => void
}) {
  const [state, setState] = useState<CopyState>('idle')
  const ref = useRef<HTMLPreElement>(null)

  async function copy() {
    // Writing to the clipboard on an explicit click is the human performing the
    // transfer. Reading the clipboard, or doing either on a timer, is what this
    // panel must never do.
    const ok = await copyText(text)
    setState(ok ? 'copied' : 'failed')
    if (ok) onCopied()
    else {
      // If the browser refused, select the text so ⌘C still works. Never leave
      // the human staring at a button that silently did nothing.
      const node = ref.current
      if (node) {
        const range = document.createRange()
        range.selectNodeContents(node)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
        node.focus()
      }
    }
    window.setTimeout(() => setState('idle'), 2600)
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between px-4 py-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-xs font-medium tracking-tight text-ink-dim">{label}</h3>
          <span className="font-mono text-[11px] text-ink-faint">
            {text.length.toLocaleString()} chars
          </span>
        </div>
        <button
          onClick={copy}
          className={`rounded border px-2.5 py-1 text-xs transition-colors ${
            state === 'failed'
              ? 'border-amber-500/60 text-amber-400'
              : 'border-hairline bg-panel-2 text-ink hover:border-accent-dim hover:text-accent'
          }`}
        >
          {state === 'copied'
            ? 'Copied'
            : state === 'failed'
              ? 'Selected — press ⌘C'
              : `Copy ${label.toLowerCase()}`}
        </button>
      </div>
      <pre
        ref={ref}
        tabIndex={0}
        onKeyDown={(e) => {
          // Cmd/Ctrl+C on the focused block copies the whole block, so the
          // keyboard path matches the button exactly.
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
            const sel = window.getSelection()?.toString()
            if (!sel) {
              e.preventDefault()
              void copy()
            }
          }
        }}
        className="mx-4 mb-3 min-h-0 flex-1 overflow-auto rounded border border-hairline bg-panel-2 p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink"
      >
        {text}
      </pre>
    </section>
  )
}

function CopyBothButton({ text, onCopied }: { text: string; onCopied: () => void }) {
  const [state, setState] = useState<CopyState>('idle')

  async function copy() {
    const ok = await copyText(text)
    setState(ok ? 'copied' : 'failed')
    if (ok) onCopied()
    window.setTimeout(() => setState('idle'), 2600)
  }

  return (
    <button
      onClick={copy}
      className={`w-full rounded border py-2 text-xs font-medium transition-colors ${
        state === 'failed'
          ? 'border-amber-500/60 text-amber-400'
          : 'border-accent-dim bg-accent-dim/20 text-accent hover:bg-accent-dim/30'
      }`}
    >
      {state === 'copied'
        ? 'Copied both'
        : state === 'failed'
          ? 'Copy blocked by the browser — use the buttons above'
          : 'Copy both'}
    </button>
  )
}

/**
 * Deliberately quiet. The default on a delta turn is to paste into the existing
 * chat; this is the escape hatch for starting over in a fresh one without
 * waiting for a "lost chat" round trip.
 */
function FullContextRow({
  text,
  turnIndex,
  onCopied,
}: {
  text: string
  turnIndex: number
  onCopied: () => void
}) {
  const [state, setState] = useState<CopyState>('idle')

  async function copy() {
    const ok = await copyText(text)
    setState(ok ? 'copied' : 'failed')
    if (ok) onCopied()
    window.setTimeout(() => setState('idle'), 2600)
  }

  const link = 'underline decoration-dotted underline-offset-2 hover:text-ink'

  return (
    <div className="flex shrink-0 flex-wrap items-baseline gap-x-1.5 px-4 pb-3 text-[11px] text-ink-faint">
      <span>Starting a new Copilot chat?</span>
      <button
        onClick={copy}
        title="System prompt, tool definitions and the whole conversation so far. Paste it into a brand-new Copilot chat; later turns then go into that chat as usual."
        className={state === 'failed' ? 'text-amber-400' : link}
      >
        {state === 'copied'
          ? 'Copied full context'
          : state === 'failed'
            ? 'Copy blocked — download it instead'
            : 'Copy full context'}
      </button>
      <span className="font-mono">{text.length.toLocaleString()} chars</span>
      <span aria-hidden>·</span>
      <button onClick={() => downloadText(`turn-${turnIndex}-full.md`, text)} className={link}>
        download
      </button>
    </div>
  )
}

export function OutboundColumn({
  turn,
  onCopied,
  onLostChat,
}: {
  turn: TurnRecord
  onCopied: () => void
  onLostChat: () => void
}) {
  const isNewChat = !!turn.systemPrompt
  const both = isNewChat ? `${turn.systemPrompt}\n\n${turn.query}` : turn.query

  function download() {
    downloadText(`turn-${turn.turnIndex}.md`, both)
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col border-r border-hairline">
      <div className="flex shrink-0 items-center justify-between border-b border-hairline px-4 py-2.5">
        <h2 className="text-xs font-semibold tracking-tight uppercase text-ink-dim">
          Outbound · turn {turn.turnIndex}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={download}
            title="This turn only. Use it when the payload is too large to paste comfortably — upload the file to Copilot instead."
            className="rounded border border-hairline px-2 py-1 text-[11px] text-ink-dim hover:text-ink"
          >
            Download this turn
          </button>
          <button
            onClick={onLostChat}
            title="The Copilot chat was closed or reset. The next turn will carry the full context again."
            className="rounded border border-hairline px-2 py-1 text-[11px] text-ink-dim hover:text-ink"
          >
            I lost the chat
          </button>
        </div>
      </div>

      {/* The banner is the delta model made visible: it is the only thing telling
          the human whether this paste belongs in a new chat or the existing one. */}
      <div
        className={`shrink-0 border-b px-4 py-2 text-xs ${
          isNewChat
            ? 'border-accent-dim bg-accent-dim/15 text-accent'
            : 'border-hairline text-ink-dim'
        }`}
      >
        {isNewChat
          ? 'Start a new Copilot chat and paste this. It carries the system prompt.'
          : 'Paste into the same Copilot chat as the previous turn.'}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {isNewChat ? (
          <>
            <CopyBlock label="System prompt" text={turn.systemPrompt!} onCopied={onCopied} />
            <CopyBlock label="Query" text={turn.query} onCopied={onCopied} />
            <div className="shrink-0 px-4 pb-3">
              <CopyBothButton text={both} onCopied={onCopied} />
            </div>
          </>
        ) : (
          <>
            <CopyBlock label="Prompt" text={turn.query} onCopied={onCopied} />
            {turn.fullContext && (
              <FullContextRow
                text={`${turn.fullContext.systemPrompt}\n\n${turn.fullContext.query}`}
                turnIndex={turn.turnIndex}
                onCopied={onCopied}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
