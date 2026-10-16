# Assemble the Shim

Type: task
Status: open
Blocked by: 06, 10, 13, 14, 15

## Question

Build the thing. By the time this is takeable, every design question has an answer and every browser
mechanic has a proven prototype — this ticket wires them into one process.

Use `/tdd`: the Tool-Call Protocol parser, the divergence detection, and the Re-seed trigger are all
pure logic over data and should be tested without a browser at all.

## Scope

- The HTTP server implementing the surface the wire-expectations ticket specified.
- Transcript of Record storage, prefix comparison, divergence detection, Re-seed.
- The Playwright driver, composed from the proven prototypes: send, wait-for-done, extract.
- Protocol rendering outbound, parsing inbound, Repair Loop.
- The concurrency queue and the Pause state machine.
- Logging good enough to diagnose a failed run *after the fact* — every Turn's outbound prose,
  extracted reply, and parse result. Without this, debugging means watching a browser in real time.

## Seams that matter

Keep the browser behind one narrow interface — roughly `send(text) → replyText`. Everything above it
(protocol, transcript, queue, recovery) is then testable against a fake, and the inevitable Copilot
UI change is contained to one module rather than smeared through the codebase.

## Definition of done

The Shim runs, opencode connects, and a single-tool round trip completes. Multi-step and failure
injection belong to the end-to-end ticket.

## Progress (built; live verification blocked on quota)

The Shim is written and its browser-independent paths are tested.

| Module | Role |
| --- | --- |
| `src/copilot-driver.mjs` | The narrow seam — `ask(page, text) -> replyText`. All selectors measured. |
| `src/transcript.mjs` | Transcript of Record, prefix hashing, divergence detection, Re-seed triggers. |
| `src/protocol.mjs` | Preamble rendering (slim), delta rendering, envelope parsing, repair prompts. |
| `src/shim-server.mjs` | HTTP/SSE surface, Side Call short-circuit, serialisation, Repair Loop, Pause, tracing. |

**22 unit tests passing** across the protocol parser and the transcript state machine — including the
observed whitespace-collapse shape, opencode's compaction, tool-call id re-minting, and the quota
notice.

### Verified live

The **Side Call path works end to end**: a title-generation request is answered locally in
milliseconds with correct SSE framing and **never touches the browser**. That is the concurrency
problem removed at its source rather than managed.

### Seam held

Everything above `ask(page, text)` is browser-free and unit-testable against a fake. A Copilot UI
change lands in `copilot-driver.mjs` alone.

### Tracing

Every Turn writes outbound prose, each raw reply (including failed attempts), and the parse result to
`.scratch/shim-log/`. Diagnosing a failed run does not require watching a browser.

### Not yet done

The Main Call path has never executed against live Copilot — the account's daily quota was exhausted
during characterisation. Everything it depends on is individually proven (injection, completion
detection, extraction, 43,308-char capacity), but the assembled path is unverified. That is the
end-to-end ticket's job, and it needs quota.
