# The daily chat limit may make an agentic loop unviable

Type: task
Status: open
Blocked by: —

## Question

Copilot cut us off mid-experiment with:

> "You've reached your daily chat limit, get more chats with higher limits, or check back tomorrow."

This is potentially **fatal to the destination** and must be answered before any more building. An
agentic Turn costs one message. A 20-Turn task costs 20. If the daily allowance is in the low tens,
the shim cannot complete a single real task per day and the whole effort is pointless.

We exhausted it in roughly **10 messages across ~10 freshly-created conversations** during probing.
The page also shows "Buy Microsoft 365" and "Upgrade", which suggests **this account has no Copilot
licence** and is on a free tier.

Establish:

- **What is being counted — messages, or conversations?** This is the critical distinction. Our
  Re-seed design opens a *new chat* every time it rebuilds a Thread Projection. If the quota counts
  conversations, Re-seed is extraordinarily expensive and the design must change to favour long-lived
  Projections and in-place Repair over Re-seed. Test by sending several messages inside **one**
  existing conversation on a fresh quota and seeing what depletes.
- **What is the actual allowance** on this account, per day?
- **Does a licence remove it?** If the account is unlicensed, does an M365 Copilot licence lift the
  limit to something workable, or merely raise it?
- **How is exhaustion detected?** The notice arrives as a normal-looking assistant reply, so the Shim
  must pattern-match it. Capture the exact wording and any DOM marker. Getting this wrong means a
  quota notice is parsed as a tool call.
- **What should the Shim do on exhaustion?** It is not recoverable by retry, and waiting until
  tomorrow is not a Pause a human can clear. This is arguably the one case that *should* fail the run.

## Why this blocks

Every remaining ticket assumes browser round trips are cheap and effectively unlimited. If they are
rationed at ~10/day this stops being an engineering problem and becomes a licensing decision.

## Definition of done

The counted unit (messages vs conversations), the number, whether a licence changes it, the exact
detection string, and a go/no-go on whether the destination is still reachable.

## Findings so far (still open — this is now the binding constraint)

### The allowance is single-digit messages per day

The quota **partially reset overnight** and was exhausted again after roughly **3-4 messages**. Across
two days the pattern is consistent: a handful of messages, then a hard stop.

An agentic Turn costs one message. A trivial task costs 3-5 Turns; a real one costs 20+. **On this
account the destination is not reachable** — not because of anything in the design, but because the
budget is roughly one Turn per attempt.

### Messages vs conversations: still unresolved, but leaning "messages"

The probe designed to answer this (`tools/quota-probe.mjs`, several messages inside ONE conversation)
could not complete — it ran out of quota inside the same conversation, which is weak evidence for
**messages** being the counted unit rather than conversations. Not conclusive: the count may have
been carried over from the earlier fresh-chat probes.

If messages are the unit, the Re-seed design is fine as written. That is the more favourable answer.

### Detection is solved

The notice renders as an assistant turn with **no copy control**, and the exact string is:

> "You've reached your daily chat limit, get more chats with higher limits, or check back tomorrow."

Detected by `checkQuota(page)` against page text before and after each send, raising `QuotaExhausted`,
which the Shim converts into a loud failure rather than a retry or a Pause.

### What this needs from a human

Whether to license this account for M365 Copilot, use a different account, or abandon the browser
approach. This is a purchasing/access decision, not an engineering one, and nothing further can be
validated live until it is made.
