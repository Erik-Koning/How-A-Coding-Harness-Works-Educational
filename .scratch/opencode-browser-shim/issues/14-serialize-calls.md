# Serialise concurrent model calls onto one browser

Type: grilling
Status: resolved
Blocked by: 11

## Question

There is one browser and one chat. opencode may issue more than one model call at a time. What
happens to the second one?

The wire-expectations ticket will reveal whether opencode makes side calls — session title
generation and summarisation/compaction are the likely candidates, and they can fire while the main
agentic loop is mid-Turn. Each is a full browser round-trip in this architecture, and they must not
interleave into the same Thread Projection or they will corrupt each other's context.

Decide:

- **Queue or parallel.** A single global lock with a FIFO queue is the simple answer, and correct;
  the cost is that a title-generation call stalls the main loop behind it. The alternative is a
  second tab with its own Projection — genuinely parallel, at the cost of a second concurrent
  conversation and more session surface.
- **Priority.** If we queue, does the main agentic Turn jump ahead of housekeeping calls? It should.
- **Cheap paths.** Some side calls may not deserve a browser round-trip at all. A session title is
  cosmetic — answering it locally with a stub, or a trivially derived string, may be strictly better
  than spending fifteen seconds of Copilot time on it. Worth deciding per side call, once we know
  what they are.
- **Backpressure.** If a Turn is Paused waiting on a human, what happens to everything queued behind
  it? They cannot all sit on open HTTP connections indefinitely.

## Definition of done

A concurrency policy: what serialises, what runs in parallel, what gets answered locally without
touching the browser, and what happens to the queue during a Pause.

## Answer

**A priority queue in front of one browser, and answer the title Side Call locally without touching
the browser at all.**

### Concurrency is real — measured

Stalling the Side Call 15s showed the Main Call arriving **0.76s later, while the Side Call was still
pending** (`tools/concurrency-probe.mjs`). A plain mutex would therefore let a cosmetic title
generation block real agentic work behind it for a full browser round trip (~7-15s).

### Decisions

1. **Answer Side Calls locally.** A call with an empty/absent `tools` array is housekeeping. Title
   generation is cosmetic and its whole job is to produce a ≤50-char string; spending a browser round
   trip on it is indefensible when a Turn already costs 7-15s. Derive the title from the first user
   message and return it immediately. **This removes the concurrency problem at its source** rather
   than managing it.
2. **Still queue what remains.** Do not rely on locally-answering to be sufficient — an unrecognised
   Side Call (summarisation/compaction, which we have not yet observed) must not interleave into a
   Thread Projection. One FIFO queue per session, Main Calls ahead of anything else.
3. **One Projection per `x-session-id`.** opencode hands us the session identity in a header, so
   keying is free; no message-content heuristics needed.
4. **During a Pause, the queue holds.** Verified safe: opencode waits indefinitely (100s silent and
   300s heartbeated both survived), so queued callers can simply block. No need to fail them.

### Consequence

If Side Calls are always answered locally, and only one opencode session is live, the queue is
usually empty and the fast path is uncontended. The queue exists for correctness, not throughput.

### Not established

Whether opencode issues a **summarisation/compaction** call, and whether that one carries tools. If it
does carry tools it is indistinguishable from a Main Call by our discriminator and *must* go to the
browser. Watch for it during the end-to-end run on a long conversation.
