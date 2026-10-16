# Map opencode's wire expectations

Type: research
Status: resolved
Blocked by: —

## Question

Exactly what does opencode 1.18.2, through `@ai-sdk/openai-compatible`, send to and require from a
`/v1/chat/completions` endpoint? Assumption is not good enough — capture real traffic.

Method: install opencode 1.18.2, point a custom provider at a throwaway logging server on localhost
that records every request and returns canned responses, and drive it through a real session.

Establish:

- **Endpoints hit.** Is `/v1/models` required at startup? `/v1/chat/completions` only? Anything else?
- **Streaming.** Does it request `stream: true`, and will it accept a single non-streamed JSON
  response? If SSE is mandatory, what is the minimum viable event sequence — and how does that
  interact with a long **Pause** (can we hold the connection open with keep-alive events, or will
  the client time out)?
- **Tool schemas.** The exact shape of the `tools` array opencode sends, and the exact `tool_calls`
  shape it expects back — including whether `id` values must correlate with the following
  `role: "tool"` messages, and whether parallel tool calls are ever emitted.
- **Message roles.** How system prompt, assistant messages with tool calls, and tool results are
  laid out in the array. This is the raw material the Tool-Call Protocol has to render into prose.
- **Side calls.** Does opencode make model calls we don't expect — session title generation,
  summarisation/compaction, a capability probe? These matter enormously: each one is a browser
  round-trip, and they may fire *concurrently* with the main loop.
- **Fields it reads on the response.** `usage`, `finish_reason`, `model`, anything else — and what it
  does with them.
- **Error handling.** What status codes and error bodies it treats as retryable.

## Definition of done

A captured, annotated transcript of a real opencode session's HTTP traffic, plus a written spec of
the minimum surface the Shim must implement.

This is the one ticket that can be worked entirely offline from the browser, in parallel with the
session work. It should clear the token-accounting and model-capability fog on the map.

## Answer

Captured from real opencode 1.18.2 traffic (`tools/capture-server.mjs`, raw requests in
`.scratch/capture/run-01`, `run-02`). Every number below is measured, not assumed.

### Endpoints

**Only `POST /v1/chat/completions`.** opencode never called `/v1/models` — it uses the models
declared in `opencode.json`. The Shim needs exactly one route.

### Request shape

Keys: `model`, `max_tokens` (8192), `messages`, `tools`, `tool_choice` (`"auto"`), `stream`,
`stream_options`. **No `temperature`.**

- `stream: true` **always**, with `stream_options: {include_usage: true}`. Non-streaming was never
  requested, so SSE is the only path that must work.
- Headers include **`x-session-id`** and `x-session-affinity` (e.g. `ses_049b1b28dffesRzhky03zlpUSg`).
  **This is a gift**: opencode hands us a stable session identity, so a Thread Projection can be keyed
  on it directly rather than inferred.

### The Preamble is 43,502 characters

| Part | Chars |
| --- | --- |
| System prompt | 19,418 |
| Tool JSON Schema (10 tools) | 24,084 |
| **Total, every Main Call** | **43,502** (~11k tokens) |

Tools: `bash` (5,319), `task` (3,856), `todowrite` (2,686), `edit` (1,958), `read` (1,734),
`webfetch` (1,293), `grep` (1,183), `glob` (1,114), `write` (1,026), `skill` (676).

This is the single largest design constraint. It is *identical every Turn*, which is what makes
sending it once per Thread Projection viable.

### Side Calls are CONCURRENT — measured, not assumed

opencode fires a **title generation** call with **no `tools` array**, and `tools.length === 0` is a
reliable discriminator. Stalling the Side Call 15s showed the Main Call arriving **0.76s later while
it was still pending** (`tools/concurrency-probe.mjs`).

So the browser genuinely has two concurrent callers. A bare lock would make the cosmetic title call
block real work. See *Serialise concurrent model calls*.

### Message array is append-only

Verified across a three-Turn loop: messages `[0]`(system) and `[1]`(user) never change, and each Turn
appends **exactly two** — `assistant` with `tool_calls`, then `tool` with `tool_call_id`. opencode
echoes back the `tool_call_id` we minted, so IDs must correlate.

This is precisely the shape the prefix comparison in *The Shim owns the memory* needs: a delta is
always the last two messages, and any deviation from append-only is divergence.

### No client timeout — the Pause design is safe

| Probe | Result |
| --- | --- |
| 100s stall, **zero bytes sent** | **Survived**, completed normally |
| 300s stall with SSE `: keepalive` comments every 10s | **Survived** (29 heartbeats) |

SSE comment frames do not disturb the AI SDK parser. opencode will wait as long as a human needs, so
a Pause needs no special protocol — though heartbeats are free insurance and worth sending.

### Minimum surface for the Shim

1. `POST /v1/chat/completions` returning SSE.
2. Chunks: an opening `{role:"assistant"}` delta, content or `tool_calls` deltas, a final delta with
   `finish_reason` (`"stop"` or `"tool_calls"`), a usage-only chunk, then `data: [DONE]`.
3. Mint `tool_calls[].id`; expect it echoed in the next request.
4. Detect Side Calls via empty `tools` and answer them without touching the browser.
