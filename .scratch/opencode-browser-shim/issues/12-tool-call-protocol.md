# Design the Tool-Call Protocol

Type: prototype
Status: open
Blocked by: 08, 11

## Question

How do opencode's tool schemas get expressed to Copilot as prose, and how does Copilot's prose reply
get read back as structured `tool_calls`?

**This is the crux of the whole effort.** opencode's agentic loop is driven entirely by structured
tool calls; Copilot is a chat that emits text. Everything else in this map is plumbing around this
translation.

Two halves, and they constrain each other:

**Outbound** — rendering `tools: [...]` (JSON Schema per tool) into an instruction Copilot will
actually follow, turn after turn, without drifting back into helpful prose.

**Inbound** — recognising a tool call in the reply and parsing it into `{ id, name, arguments }`,
while distinguishing it from a final answer meant for the user.

## Candidate shapes

- **Fenced JSON envelope** — Copilot replies with one ```json block containing either a tool call or
  a final answer. Easy to locate, and if the copy-button extraction proves byte-faithful, easy to
  parse. Risk: chat models love to wrap code blocks in explanation, and JSON is brittle to a single
  stray character.
- **XML-ish tags** — `<tool_call><name>…</name>…</tool_call>`. Far more tolerant of surrounding
  prose and of partial corruption; easier to repair. Less natural for nested arguments.
- **Two-phase** — let Copilot answer naturally, then send a second message asking it to restate that
  intent as strict JSON. Doubles the round-trips (expensive, given every Turn is a browser
  interaction) but is dramatically more robust because the formatting task is isolated from the
  reasoning task.

## What to actually test

Don't pick on aesthetics — run each candidate against the same battery: a simple single-arg call, a
call whose argument is a 200-line file body, a call with nested objects, two calls in sequence, and
a final-answer turn that must *not* be mistaken for a tool call.

Measure: **first-attempt parse rate over ~20 real turns**. That number decides it.

## Constraints inherited

- Whatever the extraction ticket concludes about fidelity — if backticks or quotes get mangled, JSON
  is dead and tags win by default.
- Whatever the wire ticket concludes about `tool_calls` shape and whether parallel calls must be
  supported.
- Per-message input ceiling: the full tool-schema preamble is sent at least once per Projection and
  must fit alongside real content.

## Definition of done

One protocol chosen with measured evidence, its preamble written, and a parser that handles the
battery above. Deviations get handled by the Repair Loop, which is a separate ticket.

## Progress (design + parser done; live measurement blocked)

**Chosen: the fenced JSON envelope** — on evidence, not taste.

The argument that decided it: the *only* corruption this page exhibits is whitespace collapse on
inline-rendered content, and **JSON is immune to it**. Whitespace between tokens is insignificant, and
string contents arrive escaped (`\n`, `\t`) as literal two-character sequences that collapse cannot
touch. A payload flattened to one line parses to the identical object — verified as a test case.

Tags were the alternative and would also survive collapse, but bring nothing else: nested tool
arguments are natural in JSON and awkward in tags, and opencode hands us JSON Schema already. The
two-phase approach is ruled out on cost — every extra round trip is ~5-7s *and* one unit of a daily
quota that has proven scarce.

### Built

- `src/protocol.mjs` — `renderPreamble`, `renderTools` (slim), `renderToolResult`, `parseReply`,
  `repairPrompt`.
- `test/protocol.test.mjs` — **13 tests, all passing**, including the observed collapse shape,
  escaped quotes/backslashes, last-block-wins, bare unfenced JSON, and the quota notice.

Envelope:

```json
{"type":"tool_call","name":"bash","arguments":{"command":"ls"}}
{"type":"final","content":"..."}
```

### Rendered Preamble fits

**39,819 chars** against the 43,308 proven to send — **3,489 chars headroom**. Slim schema rendering
(dropping `$schema` and the `9007199254740991` numeric bounds opencode emits on every integer) is what
buys it.

### Deliberate non-decision: no guessing repairs

Salvage is limited to locating the block and trimming. Broken JSON is **not** repaired by inserting
commas or balancing quotes: a plausible-but-wrong tool call *executes*, which is strictly worse than a
re-ask. Covered by a test asserting a trailing comma throws rather than being fixed.

### Blocked

The ticket's definition of done demands a **measured first-attempt parse rate over ~20 real turns**.
That needs ~20 browser round trips, and the account's daily quota is exhausted — see *The daily chat
limit may make an agentic loop unviable*. The design is settled and unit-tested; the number is not yet
taken, so this stays open.
