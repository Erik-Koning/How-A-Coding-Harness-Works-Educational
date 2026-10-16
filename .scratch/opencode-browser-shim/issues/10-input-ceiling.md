# Find the input-size ceiling

Type: prototype
Status: resolved
Blocked by: 09

## Question

What is the largest message Copilot will accept, and what happens at the boundary?

This number sets the budget for the entire design — how much history a Re-seed can replay, how big a
tool result can be, whether chunking is needed at all.

Establish:

- **The hard cap.** Binary-search the composer with generated payloads. Is the limit enforced in the
  UI (character counter, disabled send) or server-side?
- **The failure mode at the boundary — the important part.** Does it reject loudly, or does it
  silently truncate? Silent truncation is the dangerous one: the Shim would believe it sent a full
  Transcript when Copilot saw half of it, and every downstream symptom would look like a model
  failure. If truncation is silent we need a detection trick (e.g. a sentinel token at the very end
  of every message that Copilot is asked to echo).
- **Conversation-level limits**, separate from per-message: does a long thread degrade, get
  summarised, or get cut off? This directly bounds how long a Thread Projection stays trustworthy
  before a Re-seed is mandatory anyway.
- **Rate limits.** Messages per minute/hour, and what hitting one looks like — since the failure
  posture calls for backing off, we need to recognise it.

## Definition of done

Three numbers with evidence — per-message cap, usable conversation length, rate limit — plus a
verdict on whether over-limit input fails loudly or silently.

Resolving this should clear most of the "big tool results" and "compaction strategy" fog on the map.

## Answer (partial — the sweep was confounded)

### Established

**43,308 characters sends successfully and is fully seen**, round-tripping in **5.0s** with the
end-of-message sentinel echoed back. Sizes 4,805 / 19,806 / 43,308 all passed with sentinel echoed.

That number matters: opencode's Preamble is **43,502 chars**, so a full Preamble fits in a single
Copilot message with essentially no margin.

Latency is **flat in message size** — 6.6s / 5.7s / 5.0s for 4.8k / 19.8k / 43.3k. Cost per Turn is a
fixed browser round trip, not a function of payload. Sending more costs nothing extra.

### NOT established — the upper bound

The 50k / 60k / 100k failures **cannot be attributed to size**. Midway through the sweep the account
hit a **daily chat limit** (`.scratch/session/overlay-diag.json`):

> "You've reached your daily chat limit, get more chats with higher limits, or check back tomorrow."

The failures were quota exhaustion, not truncation. **The real ceiling is somewhere at or above
43,308 and remains unmeasured.** Re-run `tools/ceiling-narrow.mjs` on a fresh quota.

Note the failure was *loud but misleading*: the composer accepted 49,797 chars, the send button
enabled and clicked, and a "reply" arrived — the quota notice — so a naive shim would have parsed the
refusal as a model response. **Detecting the quota notice explicitly is required**, not optional.

### Headroom won by rendering the Preamble compactly

The 43,502 figure is *pretty-printed* JSON, which is only how opencode sends it to us — we choose how
to render it to Copilot:

| Rendering | Tools | Preamble total |
| --- | --- | --- |
| Pretty (as received) | 24,084 | 43,502 |
| `JSON.stringify` compact | 20,856 | 40,274 |
| Slim (drop `$schema`, numeric min/max) | 19,297 | **38,715** |

Slim rendering buys **4,593 chars of headroom** under the proven-good 43,308 — room for the protocol
instructions plus a modest first tool result. Worth doing regardless of where the true ceiling lands.

### Still open

Per-message hard cap, conversation-length limit, and rate limits — all now downstream of the quota
question, which is its own ticket.

## SUPERSEDED IN PART — the ceiling is no longer a wall

User direction: content that does not fit the composer should go in via the
**"Upload images and files"** button instead. Implemented and verified.

### Measured

| | |
| --- | --- |
| Composer, proven good | **43,308 chars** |
| **File upload, proven good** | **203,766 bytes** — 4.7x the composer ceiling |
| Upload time | **4.3s** for 204KB |

Both verified without sending, so at no quota cost.

### How it works

The `input[type=file]` **does not exist until the "+" menu is opened** — a direct `setInputFiles` on
page load finds nothing. Opening the menu creates it; Playwright can then set files on the hidden
input directly, so no filechooser interception is needed.

```
plusMenu   [data-testid="PlusMenuButton"]           (empty-chat layout)
           [data-testid="chat-input-attach-button"]  (once a conversation exists)
menu entry "Upload images and files"
input      input[type="file"]   — created when the menu opens
done when  page text contains "<name> upload finished"
```

Both plus-button testids are needed; the layout swaps between them.

### Routing rule

`COMPOSER_LIMIT = 42000`, just under the proven-good composer size. Consequences:

- **First-Turn Re-seed** (Preamble 39,819 + short user message) -> composer. Fast path preserved.
- **Re-seed carrying history**, or any large tool result -> upload.
- **Deltas** (a tool result) -> composer, being small.

### What this unblocks

The "big tool results" and "compaction strategy" fog both shrink dramatically. A 3000-line file read
no longer has to be truncated or chunked, and a long Transcript replay is no longer bounded by a text
box.

### Caveats

1. **Uploads are copied to OneDrive.** The page states: "Uploading from device will send a copy to
   OneDrive (personal)." Every oversized tool result becomes a file in the user's OneDrive — a
   privacy and clutter consequence, not just an implementation detail.
2. **UNVERIFIED: does Copilot actually read the whole uploaded file?** Attachment succeeds, but
   whether the model receives the full content — or a summary, or a truncated extract — needs a real
   send and is quota-blocked. **This is now the single most important unverified assumption in the
   design.** The sentinel technique used for the composer applies directly: put a token at the end of
   the file and ask for it back.
