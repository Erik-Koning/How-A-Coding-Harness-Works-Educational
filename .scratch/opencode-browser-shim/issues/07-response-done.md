# Detect when a Copilot response is complete

Type: prototype
Status: open
Blocked by: 05

## Question

How do we know, reliably, that Copilot has *finished* answering — not merely paused mid-stream?

This is the single most important reliability primitive in the Shim. Every other browser mechanic
can be retried; a premature "done" silently truncates a tool call and corrupts the run in a way that
looks like a model error rather than a shim bug.

Candidate signals, to be tested rather than assumed:

- The send/stop button flipping back from "stop generating" to "send" — usually the strongest signal
  in chat UIs, because it is state the app itself owns.
- A per-message action bar appearing (copy / thumbs / regenerate) once a message is final.
- DOM mutation quiescence — no changes under the message node for N ms.
- A network/streaming signal observable via Playwright request interception.
- Any `aria-busy` / `aria-live` / role state the page exposes.

Prefer a signal the application controls over one we infer. Combine two if neither is sufficient
alone, but be explicit about which is primary.

## Traps to probe deliberately

- Long responses that stall mid-generation — does quiescence lie?
- Responses containing code blocks that render progressively.
- Copilot's own "searching the web…" / tool-use interstitials, if it has them — do they look like
  completion?
- A response that gets *replaced* or amended after appearing complete.

## Definition of done

A predicate `waitForResponseComplete(page)` that is correct across at least: a one-line answer, a
long multi-paragraph answer, an answer containing a large fenced code block, and an answer that
triggers whatever Copilot's slowest path is. Plus a written note on what it does when Copilot errors
or refuses.

## Answer

**Primary signal: the message-level copy control appearing, combined with the stop control
disappearing.** Both are state the application itself owns — exactly the class of signal the ticket
asked to prefer over inference.

```
during generation:  [aria-label*="Stop"] present     AND  no new [data-testid="CopyButtonTestId"]
on completion:      Stop gone                        AND  copy count > pre-send baseline
```

### Measured timeline (34 samples at 250ms, `.scratch/session/completion-timeline.json`)

| t (s) | body len | stop | copy | aria-busy |
| --- | --- | --- | --- | --- |
| 0.16 | 199 | **true** | false | false |
| 3.28 | 702 | **true** | false | true |
| **4.08** | 842 | **false** | **true** | true |
| 4.96 | 822 | false | true | false |
| 8.76 | 791 | false | true | false |

### Quiescence is the wrong signal — and measurably so

Body text **shrinks after completion** (842 → 822 → 796 → **791**) as follow-up suggestion chips
render and settle. So text-stability is both noisy and slow:

- Button-flip predicate fires at **t+4.08s**
- Naive "quiescent for 2.5s" predicate fires at **t+8.76s**

That is **4.7 seconds of dead time per Turn**, more than doubling the round trip. Over a 20-Turn
agentic task that is ~1.5 minutes wasted. Use the button flip.

`aria-busy` also tracks generation but lags the button flip by ~0.9s, so it is a usable secondary
confirmation, not the primary.

### Implementation note

Count copy controls **before** sending and wait for the count to *exceed* that baseline. Absolute
presence is not enough — earlier messages already carry copy buttons, so only the delta identifies
our reply. Implemented as `waitForComplete(page, baselineCount)` in `src/copilot-driver.mjs`.

### Still untested

Copilot's error/refusal path — whether a refusal produces a copy button like any other message
(likely) or a distinct surface. The *Repair Loop* ticket must not treat a refusal as a formatting
failure, so it needs this answered.

## CORRECTION (audit) — the predicate above is WRONG

The answer recorded above fires prematurely and must not be trusted.

**Measured on a later run:** `copies > baseline && stops === 0` returned "complete" at **t+1.02s**
while the page still read *"Generating response / Copilot said: Digging in…"*. Extraction at that
moment returned an **empty string**.

Why the first timeline missed it: that probe only sampled a response that had already started
streaming, so the placeholder phase never appeared in the data. Copilot renders a placeholder turn
that **already carries a copy control** before any text exists — so the copy control marks "a message
element exists", not "the message is finished".

This is precisely the failure this ticket called the worst possible one: a premature "done" silently
truncates a tool call and looks like a model error rather than a shim bug.

### Corrected predicate (implemented, NOT yet validated)

```
copy control present  AND  no stop control  AND  no in-progress marker text
AND  reply text non-empty  AND  reply text unchanged for >= 1500ms
```

In-progress markers observed: `Generating response`, `Digging in`. Also matching `Thinking` and
`Searching the web` defensively.

Text stability is a tie-breaker, not the primary signal — alone it is unreliable, because suggestion
chips make body length non-monotonic (that part of the original finding stands).

### Why this ticket is re-opened

The corrected predicate has **never run against a completed Copilot response** — the account quota was
exhausted before it could be validated. It is reasoned from evidence, not measured. Validating it is
the first thing to do when quota is available.
