/**
 * Copy text to the clipboard, honestly.
 *
 * `navigator.clipboard.writeText` rejects in more situations than it is usually
 * given credit for — a non-focused document, a permissions policy, a browser
 * that only allows it under a user gesture it did not recognise. An unhandled
 * rejection there makes the button look simply dead, which is exactly the bug
 * this replaces: the click landed, the copy failed, and nothing said so.
 *
 * So: try the modern API, fall back to the legacy selection-based copy, and
 * report the outcome to the caller so the UI can tell the truth either way.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // fall through to the legacy path
  }

  try {
    const ta = document.createElement('textarea')
    ta.value = text
    // keep it out of view but still selectable — offscreen, not display:none
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
