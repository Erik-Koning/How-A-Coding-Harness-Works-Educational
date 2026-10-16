# Extract a Copilot response byte-faithfully

Type: prototype
Status: resolved
Blocked by: 05

## Question

How do we get Copilot's answer out of the page as *exactly* the text it produced?

"Roughly right" is not good enough here: the reply will carry a structured payload the Shim has to
parse, and rendering artefacts silently corrupt it. Whitespace, backticks, and escapes are the whole
game.

Approaches to test head to head:

- **The copy button** — click Copilot's own per-message copy control, then read the clipboard via
  `navigator.clipboard.readText()` with clipboard permissions granted to the context. This is the
  highest-fidelity path in principle: the app hands us its own canonical markdown rather than us
  reverse-engineering its rendering. Needs permissions plumbing and a way to know the click landed.
- **DOM scrape** — walk the rendered message node and reconstruct markdown from the HTML. No
  permissions, fully synchronous, but re-derives what the copy button already knows and will get
  fenced code blocks subtly wrong.
- **Both**, with the scrape as a fallback when clipboard access fails.

## Traps to probe deliberately

- A fenced code block containing backticks, and one containing JSON with escaped quotes.
- Leading/trailing whitespace and blank lines inside a code block.
- Any "smart" typographic substitution — curly quotes, en-dashes — which would wreck a JSON payload.
- Citation chips / footnote markers Copilot injects into prose. Do they end up in the copied text?
- Whether the copy button exists on *every* message or only some.

## Definition of done

An extractor that round-trips a known adversarial payload — a fenced JSON block with quotes,
newlines, and backticks inside string values — byte for byte. If nothing achieves byte-fidelity,
that is a finding, and it constrains the Tool-Call Protocol design hard.

## Answer

**Click the message-level copy control (`[data-testid="CopyButtonTestId"]`, aria-label "Copy
Response") and read `navigator.clipboard.readText()`.** Byte-faithful — but only for content Copilot
renders as a real code block, and that caveat drives the entire protocol design.

### DOM scraping is ruled out, not merely deprecated

Copilot renders code blocks with **zero `<pre>` elements** on the page. There is no
`white-space: pre` node to read, so reconstructing markdown from the DOM would mean reverse
engineering Fluent's renderer. The copy button hands us the app's own canonical text instead.

### Fidelity, measured

Asked for a multi-line JSON object; the clipboard returned **128 chars, 6 newlines**:

```json
{
  "tool": "write",
  "args": {
    "filePath": "/tmp/x.txt",
    "content": "line one\\nline two\\n    indented four\\n"
  }
}
```

- `JSON.parse()` succeeds
- newlines preserved (6)
- four-space indentation preserved
- **backslash escapes preserved** — `\n` survived as a literal two-character sequence

### The caveat that shapes everything: inline vs block

An earlier probe *did* lose data — a 277-char payload came back as 178 chars with newlines and
repeated spaces collapsed (`hello   world` → `hello world`). Diagnosis: **Copilot rendered that fence
inline rather than as a code block**, and inline content has its whitespace collapsed by CSS. Both the
clipboard and the rendered text agreed exactly, so extraction was faithful to a page that had already
lost the data.

Two conclusions:

1. **The loss happens before extraction, and no extraction path can recover it.** Choosing a
   different reader would not have helped.
2. **The Tool-Call Protocol must guarantee a real fenced code block**, and must treat "reply not
   rendered as a code block" as a Repair Loop trigger — it is a reliable proxy for "this reply may be
   silently corrupted".

### Why this makes JSON viable rather than fragile

The one observed corruption is whitespace collapse, and **JSON is immune to it**: insignificant
whitespace between tokens carries no meaning, and everything inside string values arrives escaped
(`\n`, `\t`) as literal two-character sequences that collapse cannot touch. A JSON payload that
collapses to one line still parses to exactly the same object.

That is a strong, evidence-backed argument for the fenced-JSON envelope in *Design the Tool-Call
Protocol* — the format's brittleness to stray characters is real, but the specific failure mode this
page exhibits passes straight through it.

### Two copy controls exist

| Control | Selector | Yields |
| --- | --- | --- |
| Message | `[data-testid="CopyButtonTestId"]` | the whole response |
| Code block | `button[aria-label="Copy code"]` | that block only |

Use the **message-level** one: stable `data-testid`, and it captures the full reply so a
protocol-violating preamble is *visible* to the parser rather than silently dropped. Note both return
identical text when the reply is nothing but a code block — which is what the protocol will ask for.

## CORRECTION (audit) — how the text is captured

The *conclusion* stands (the message-level copy control yields byte-faithful text), but the
**mechanism recorded above was wrong and would have failed in normal use**.

### `navigator.clipboard.readText()` is not usable here

It requires the document to be **focused**. The original probes only worked because the browser
happened to be frontmost. A shim runs in the background while the user works elsewhere, so reads
would return empty intermittently — the worst kind of bug, since an empty reply looks like a
protocol failure and burns the repair budget.

### Copilot copies via `write([ClipboardItem])`, not `writeText`

Confirmed by interception (`window.__shimClipboardPath === 'write/ClipboardItem'`). An interceptor
that only wrapped `writeText` captured nothing.

### Implemented

`launch()` installs an init script that intercepts, in order of preference:

1. `navigator.clipboard.write([ClipboardItem])` — extracting the `text/plain` blob (**the path Copilot
   actually uses**)
2. `navigator.clipboard.writeText`
3. the `copy` event, whatever produced it

`extractLast()` clears the capture slot, clicks copy, then polls for the captured text. No focus
requirement, no permission dependency, and immune to anything else using the system clipboard.
`readText()` remains only as a last-resort fallback.

### The quota notice has NO copy control

Measured: when the daily limit is hit, the page shows the notice with **`copies === 0`**, so
`extractLast` throws rather than returning it. Quota must therefore be detected by reading the **page
text**, not the extraction — implemented as `checkQuota(page)`, called before and after every send.
