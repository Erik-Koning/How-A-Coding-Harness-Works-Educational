# Context

Glossary for the opencode-via-browser-chat effort. Terms only — no implementation detail.

## Shim

The local process that stands where an AI provider's API would stand. opencode believes it is
talking to an ordinary OpenAI-compatible endpoint; behind that surface the Shim drives a real
browser. "The shim" always means this process, never the browser and never opencode.

## Transcript of Record

The Shim's own stored, complete, ordered message list for a session. **Authoritative.** It is the
only memory that counts. Nothing in the browser is ever treated as the truth.

## Thread Projection

A live Copilot chat that currently reflects some prefix of the Transcript of Record. A *cache*, not
a memory — disposable by definition. A Projection can be lost, reloaded, blanked, or drift, and
none of that is a data-loss event.

## Re-seed

Rebuilding a Thread Projection by replaying the Transcript of Record into a fresh chat. Triggered
whenever we detect a new or blank chat window, a lost Projection, or divergence between what the
Projection contains and what the Transcript says it should — or, in manual mode, whenever the human
chooses to start a fresh chat from the panel instead of continuing the current one.

## Turn

One opencode → model → opencode exchange. A Turn may cost several browser round-trips (a Re-seed, a
repair re-ask) without opencode being aware of more than one.

## Side Call

A model call opencode makes for housekeeping rather than for the agentic loop — observed:
**title generation**. Recognisable on the wire by carrying **no `tools` array**, which makes it
cheap and reliable to detect. A Side Call's output is cosmetic and need not reach the browser at
all. Contrast with a **Main Call**, which always carries the full tool set and drives the loop.

## Preamble

The fixed prefix every Main Call carries: opencode's system prompt plus the JSON Schema for all ten
tools. Measured at **43,502 characters** in opencode 1.18.2. It is identical on every Turn, which is
what makes it a candidate for being sent once per Thread Projection rather than every Turn.

## Tool-Call Protocol

The convention by which opencode's tool *schemas* are expressed to Copilot as prose, and Copilot's
prose reply is read back as structured `tool_calls`. The Shim's central translation problem.

## Repair Loop

Re-asking Copilot, inside the same Projection, to restate a reply that failed to parse. Bounded.
Distinct from a Re-seed, which rebuilds the Projection rather than correcting one reply.

## Pause

The Shim's response to something it cannot fix alone — a challenge page, an expired login, MFA. The
Turn is suspended (not failed), the human is surfaced the browser and notified, and the same Turn
resumes once they have cleared it. opencode observes only a slow response.
