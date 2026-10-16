# The Shim owns the memory, the browser is a cache

Type: grilling
Status: resolved
Blocked by: —

## Question

`/v1/chat/completions` is stateless — opencode resends the entire message array every Turn. A
Copilot chat thread is stateful and remembers its own history. Where does that impedance mismatch
get resolved?

## Answer

**The Shim keeps its own Transcript of Record. The browser thread is a Thread Projection — a
disposable cache of it.**

- While a healthy Projection exists and matches what we have already sent, a Turn sends only the new
  tail (typically one tool result), not the whole history.
- When we detect a **new or blank chat window**, a lost Projection, or divergence between the
  Projection and the Transcript, we **Re-seed**: replay our own recorded messages into a fresh chat
  and carry on.

The browser is never consulted as a source of truth about what was said. It is a rendering surface
we can rebuild at any moment from our own tape.

### Consequences

- Kills the entire "Copilot silently forgot / summarised / truncated our history" failure class. If
  the Projection is wrong, we throw it away rather than trying to reason about it.
- Requires cheap, reliable **divergence detection** — a prefix comparison between the incoming
  message array and what this Projection has been sent. opencode retries, edits, and compaction all
  show up as prefix divergence and are handled by the same mechanism.
- Requires that a Re-seed be *affordable*, which ties it to the input-size ceiling: replaying a long
  Transcript into a fresh chat must fit. That interaction is live fog on the map.
- Makes Pause/resume tractable — a Turn interrupted by a challenge page can be resumed by
  re-seeding, because nothing was lost.
