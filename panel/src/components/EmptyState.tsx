export function EmptyState({ connected }: { connected: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      {/* An instruction, not a mood. Say what will appear and what to do with it. */}
      <div className="max-w-md">
        <h2 className="text-sm font-semibold tracking-tight text-ink">No turn waiting</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-dim">
          When opencode needs the model, the prompt appears on the left. Copy it into Copilot, paste
          the reply on the right, read it, then send it back.
        </p>
        <ol className="mt-5 space-y-2 text-xs text-ink-faint">
          <li>
            <span className="font-mono text-ink-dim">1</span> &nbsp;Start a run:{' '}
            <code className="font-mono text-ink-dim">opencode run &quot;…&quot;</code>
          </li>
          <li>
            <span className="font-mono text-ink-dim">2</span> &nbsp;Copy the prompt into a Copilot
            chat
          </li>
          <li>
            <span className="font-mono text-ink-dim">3</span> &nbsp;Paste the reply back and send it
          </li>
        </ol>
        {!connected && (
          <p className="mt-5 text-xs text-ink-faint">
            Not connected to the shim. Is it still running?
          </p>
        )}
      </div>
    </div>
  )
}
