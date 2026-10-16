# The human escape hatch: Pause, notify, resume

Type: grilling
Status: resolved
Blocked by: 05, 07

## Question

A Turn hits something the Shim cannot fix — a challenge page, an expired login, MFA. The failure
posture says suspend rather than fail. How does that actually work, end to end?

Decide:

- **Detection.** How does the Shim recognise "this is a wall, not a slow response"? Presumably a URL
  change away from the chat, or a known challenge element. It must not mistake a slow generation for
  a wall, nor a wall for a hang.
- **Surfacing.** How does the human find out? Bring the browser window to the front, a macOS
  notification, a line in the opencode TUI, a terminal bell. It must be noticeable when the human is
  looking at a different window — an unnoticed Pause is a hang.
- **Resume trigger.** Once they've cleared it: does the Shim poll until the chat is reachable again,
  or does the human signal it explicitly? Polling is less friction and should be the default if
  reliable detection is possible.
- **Holding the connection.** opencode's HTTP client has a timeout. A Pause can last minutes. Do we
  hold the request open with keep-alive/SSE heartbeats, or fail it and rely on opencode retrying?
  This depends on the wire-expectations finding and is the part most likely to force the design.
- **Resuming the Turn.** After a Pause, the Projection is probably unusable — a Re-seed is the
  natural resume path, since the Transcript of Record is intact. Confirm that is cheap enough to be
  the default.
- **Giving up.** Is there a point where a Pause becomes a failure? An unattended overnight run
  should probably not sit paused forever.

## Definition of done

A Pause state machine covering detect → surface → wait → resume, with the connection-holding
question answered concretely rather than deferred.

## Answer

The hard part — holding the connection — turned out not to be hard, and that collapses most of the
design.

### opencode will wait. Measured.

| Probe | Result |
| --- | --- |
| 100s stall, zero bytes sent | **survived** |
| 300s stall + SSE `: keepalive` every 10s | **survived** (29 heartbeats, parser unaffected) |

So a Pause needs **no protocol at all**: hold the HTTP request open and reply whenever the human has
cleared the block. Send heartbeats anyway — they cost nothing and insure against a longer Pause than
we tested.

### The state machine

1. **Detect.** Two distinct conditions, deliberately separated:
   - *Wall* — `input[type=password]` appears, or the URL leaves `m365.cloud.microsoft`. Both are
     already implemented as the auth check in `src/copilot-driver.mjs`.
   - *Hang* — no completion signal within the watchdog. Distinguishable from slow generation because
     generation shows a Stop control; a hang shows neither Stop nor a new copy button.
2. **Surface.** Bring the browser window to the front (it runs headed by design) and emit a macOS
   notification. A Pause nobody notices is indistinguishable from a hang, so a log line is not enough.
3. **Wait.** Poll for the composer to reappear — no explicit human signal needed, which removes a
   step from the human's job. Keep heartbeating meanwhile.
4. **Resume.** Re-seed from the Transcript of Record and re-issue the Turn. Safe precisely because
   the Transcript is independent of the browser; cheap because `/chat` always opens a fresh empty
   chat.

### Quota exhaustion is NOT a Pause — and this is the important carve-out

The daily chat limit surfaces as an ordinary-looking assistant reply. It is:

- not recoverable by retry,
- not clearable by a human at the keyboard,
- resolved only by waiting until tomorrow or changing the licence.

Treating it as a Pause would hang the run overnight. It must **fail the request loudly** with a clear
message. The parser recognises it as its own error kind (`quota`) rather than a formatting failure —
see `src/protocol.mjs`.

### Giving up

Bound the Pause (default ~15 min). Past that, fail rather than hang forever, so an unattended run
ends in a diagnosable error instead of silence.
