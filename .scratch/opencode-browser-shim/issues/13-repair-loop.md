# The Repair Loop

Type: prototype
Status: open
Blocked by: 12

## Question

When Copilot's reply doesn't parse, how does the Shim get a good one without corrupting the Thread
Projection?

The Tool-Call Protocol ticket picks a format and measures its first-attempt parse rate. This ticket
owns the remainder — the tail of malformed replies that will always exist.

Establish:

- **The re-ask.** What message do we send back into the same Projection? A terse "reply again, that
  block only, no prose" is likely better than an explanation, but this is testable.
- **Budget.** How many attempts before escalating? Escalate to what — a Re-seed, or a Pause?
- **Projection hygiene.** A failed reply and our correction now sit in the Copilot thread as real
  turns, but they are *not* in the Transcript of Record. Does that pollution degrade later replies?
  If so, a Re-seed after N repairs may be cheaper than continuing in a polluted thread.
- **Salvage vs re-ask.** Some failures are recoverable locally — a trailing comma, a stray fence, a
  smart quote. Tolerant parsing is much cheaper than a browser round-trip. Where is the line between
  "repair it ourselves" and "ask again"? Be careful: over-eager salvage that guesses wrong is worse
  than a re-ask, because it produces a *plausible* wrong tool call.
- **Refusals.** A reply that parses as nothing because Copilot declined the request is not a
  formatting failure and must not be retried as one. How do we tell them apart, and what does
  opencode see?

## Definition of done

A bounded repair strategy with a measured end-to-end success rate, an explicit salvage policy, and a
defined escalation path into Re-seed and Pause.
