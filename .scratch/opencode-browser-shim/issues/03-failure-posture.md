# Failure posture: self-heal, then pause for a human

Type: grilling
Status: resolved
Blocked by: —

## Question

Mid-agentic-loop the browser side goes wrong — unparseable prose, a challenge page, a dead thread, a
hang. Does the Shim fail loudly to opencode, retry silently, or something else?

## Answer

**Self-heal what it can; Pause and ask for help with what it cannot. Never kill the run for
something a human could clear in five seconds.**

| Failure | Response |
| --- | --- |
| Reply fails to parse | Repair Loop — re-ask in the same Projection, bounded retries |
| Thread lost / blank / diverged | Re-seed from the Transcript of Record |
| Throttled or rate-limited | Back off and retry |
| Challenge page, expired login, MFA | **Pause** — surface the browser, notify the human, resume the same Turn once cleared |

opencode observes only a slow response. It is never told about a recoverable problem.

### Consequences

- A Turn is **suspended, not failed**. This is only safe because the Transcript of Record survives
  independently of the browser — the two decisions depend on each other.
- Needs a real notification path and a resume trigger, not just a log line, or a Pause is
  indistinguishable from a hang.
- Needs a distinction between "waiting on Copilot, which is slow" and "hung". A watchdog with a
  timeout that is longer than a slow generation but shorter than a human's patience.
- opencode / the AI SDK will have its own HTTP timeout, which a long Pause may exceed. Whether the
  Shim must emit keep-alive bytes to hold the connection open is a question for the wire-format
  ticket.
- **Explicitly rules out** working around a control rather than surfacing it — no CAPTCHA solving,
  no fingerprint spoofing, no detection evasion. Pausing for a human is both the safer and the more
  robust answer, so that whole category is off the map.
