import type { TurnRecord } from '../types'

/**
 * Build a readable transcript of the whole session.
 *
 * This is for reading, archiving, or hand-restoring a chat — NOT the primary
 * recovery path. If the Copilot chat is lost, "I lost the chat" is better: the
 * shim rebuilds a properly-shaped re-seed from its own transcript, which is
 * authoritative and always complete. This export can only reflect what passed
 * through the panel.
 */
export function buildSessionMarkdown(history: TurnRecord[]): string {
  const first = history[0]
  const out: string[] = ['# Copilot bridge — session transcript', '']

  if (first?.conversationId) out.push(`Session: \`${first.conversationId}\``, '')
  out.push(`Turns: ${history.length}`, '')

  if (first?.systemPrompt) {
    out.push('---', '', '## System prompt', '', '````text', first.systemPrompt, '````', '')
  }

  for (const t of history) {
    out.push('---', '', `## Turn ${t.turnIndex}`, '')
    out.push(`_${t.state}${t.committedAt ? ` · ${t.committedAt}` : ''}_`, '')
    out.push('### Sent to Copilot', '', '````text', t.query, '````', '')
    if (t.response) {
      out.push('### Copilot replied', '', '````text', t.response, '````', '')
    }
  }

  return out.join('\n')
}

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  // The anchor MUST be in the document: Chromium ignores a click on a detached
  // element for blob downloads, so the click silently does nothing.
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // revoke on the next tick, not immediately — revoking synchronously can race
  // the browser's own fetch of the blob and produce an empty file.
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
