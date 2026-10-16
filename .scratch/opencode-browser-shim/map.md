# Map: opencode via M365 Copilot browser chat

Label: `wayfinder:map`

## Destination

`opencode run "<a real task>"` completes a multi-turn agentic loop — file edits, bash, web search —
with **no AI API key present on the machine**, every model turn served by M365 Copilot driven
through Playwright.

Done when a genuine non-trivial task finishes end to end *and* survives at least one recoverable
failure along the way (a lost thread, or a malformed reply) without a human touching it.

## State

**10 of 18 tickets resolved** (one re-opened by audit). The Shim is built, **26 unit tests passing**.
Its Side Call path is verified live; the **Main Call path has never completed a real Turn**.

An audit found and fixed four real bugs — see *Audit corrections* below. Two of them would have
broken every Turn, and neither was visible without live traffic.

**The binding constraint is not engineering.** The account allows single-digit messages per day, so
the destination is currently unreachable regardless of code quality.

Run it with `npm run build && npm start`, with `opencode.json` already pointed at `127.0.0.1:8787`.

**Transport is now selectable.** The default is `manual` — a human relays each message through an
operator panel on `127.0.0.1:8788`, and Playwright is never loaded. Set `COPILOT_TRANSPORT=playwright`
for the automated path.

## Notes

**Execution is in scope.** This map deliberately overrides wayfinder's plan-don't-do default: build
tickets are legitimate here and the deliverable is running software, not a spec.

- **Domain**: opencode 1.18.2 (Bun/TypeScript) · Playwright · persistent Chromium profile ·
  `https://m365.cloud.microsoft/chat`
- **Vocabulary**: see `CONTEXT.md` at the repo root. Use those terms; sharpen them as you go.
- **Skills per ticket type**: `/grilling` + `/domain-modeling` for decision tickets · `/prototype`
  for the browser-mechanics tickets · `/research` for wire-format tickets · `/tdd` once the
  Tool-Call Protocol is locked and real code starts.
- **Environment facts** (verified 2026-07-30): bun 1.3.6 · node 22.21.1 · playwright 1.57.0 global ·
  chromium builds cached in `~/Library/Caches/ms-playwright` · a real Chrome profile at
  `~/Library/Application Support/Google/Chrome`. **opencode is NOT currently installed** — installing
  1.18.2 is part of *Map opencode's wire expectations*.
- **Standing risk, accepted knowingly**: Copilot's DOM is unversioned and will change without
  warning; automating it is very likely contrary to Microsoft's terms for that service. The design
  answer is to fail *visibly* rather than silently, and to hand control to a human rather than route
  around any control — see the Out of scope section.

## Decisions so far

- [Integration seam: a local OpenAI-compatible HTTP server](issues/01-integration-seam.md) — opencode's
  plugin hooks cannot intercept model calls, but `provider.*.options.baseURL` accepts any URL. The
  Shim is an HTTP server on localhost; no fork, no plugin.
- [The Shim owns the memory, the browser is a cache](issues/02-transcript-of-record.md) — a Transcript
  of Record in the Shim is authoritative; a Thread Projection in the browser is disposable and
  re-seeded on detection of a new/blank/diverged chat.
- [Failure posture: self-heal, then pause for a human](issues/03-failure-posture.md) — bounded repair
  and re-seed for anything recoverable; anything else suspends the Turn and asks for help rather
  than killing the run.
- [Auth approach: persistent Chromium profile with a driven login](issues/04-auth-approach.md) — attach
  to a profile, drive the sign-in form if it is presented, land on the chat. Session *characterisation*
  remains open.
- [Establish and characterise an authenticated Copilot session](issues/05-hold-a-session.md) — a
  **dedicated** profile dir works; human signs in once; `/chat` always lands on an empty chat, so
  Re-seed is just a navigation. All selectors measured. Session lifetime still unknown.
- [Map opencode's wire expectations](issues/11-wire-expectations.md) — one endpoint, always SSE;
  **Preamble is 43,502 chars**; `x-session-id` header hands us session identity; message array is
  append-only (+2 per Turn); **no client timeout** (300s survived), so Pause is safe.
- ~~Detect when a Copilot response is complete~~ — **RE-OPENED by audit.** The recorded predicate
  fires prematurely (t+1.02s, on a placeholder that already has a copy control), and extraction at
  that point returns empty. Corrected predicate implemented but **not yet validated**. See
  [the ticket](issues/07-response-done.md).
- [Extract a Copilot response byte-faithfully](issues/08-faithful-extraction.md) — message-level copy
  control + clipboard. Byte-faithful **only inside real code blocks**; inline-rendered content is
  collapsed by the page before we ever see it. Zero `<pre>` elements, so DOM scraping is out.
- [Inject a large message into the composer](issues/09-message-injection.md) — `locator.fill()` on the
  contenteditable span; outbound fidelity proven byte-exact by Copilot's own echo.
- [Serialise concurrent model calls onto one browser](issues/14-serialize-calls.md) — Side Calls are
  **genuinely concurrent** (measured). Answer them locally without touching the browser; queue the rest.
- [Find the input-size ceiling](issues/10-input-ceiling.md) — **43,308 chars proven good in 5.0s**, and
  latency is flat in size. Upper bound *not* established: the sweep was confounded by hitting a daily
  quota. Slim Preamble rendering buys 4.6k chars of headroom.
- [The human escape hatch: Pause, notify, resume](issues/15-pause-and-resume.md) — opencode waits
  indefinitely (300s proven), so a Pause needs no protocol: hold the connection, heartbeat, resume by
  Re-seed. Quota exhaustion is explicitly **not** a Pause — it fails loudly.
- [Where the password lives](issues/06-secret-handling.md) — **nowhere**. Reuse the Pause machinery
  and let the human type it; zero secret-handling code.

## File upload lifts the size ceiling

Oversized payloads now go in via the composer's **"Upload images and files"** rather than as text.
Verified without sending (no quota cost): **203,766 bytes attached in 4.3s**, against 43,308 chars for
the composer. Routing threshold is 42,000 — a first-Turn Re-seed still takes the fast composer path;
anything larger uploads. See [Find the input-size ceiling](issues/10-input-ceiling.md).

Two things to carry forward: uploads are **copied to the user's OneDrive**, and it is **not yet
verified that Copilot reads the whole uploaded file** — that needs a real send and is the most
important unverified assumption in the design.

## Audit corrections

Found by auditing the built code against live behaviour, all fixed, all with regression tests where
testable offline:

1. **Completion fired prematurely** — a copy control exists on Copilot's *placeholder* turn, so the
   predicate returned "done" at t+1.02s with an empty extraction. Would have silently truncated every
   tool call. Predicate rewritten; **awaiting validation**.
2. **Clipboard read needed window focus** — `navigator.clipboard.readText()` returns empty unless the
   document is focused, so extraction worked only while the browser was frontmost. Replaced by
   intercepting the page's own `navigator.clipboard.write([ClipboardItem])`, which is the path Copilot
   actually uses.
3. **Nested fences broke the parser** — a `final` answer containing a fenced code block (the most
   common thing a coding agent returns) truncated at the inner fence. Replaced fence-regex with
   brace matching that tracks JSON string state.
4. **Zero token usage would have disabled compaction** — opencode never compacts if told nothing was
   spent, so the Transcript would grow past the browser ceiling. Now reports a chars/4 estimate.

Plus: an empty delta would have hung on a Send button that never appears (now nudges); and
"not signed in" failed the run instead of Pausing (now Pauses).

## Open risk to the destination

**[The daily chat limit may make an agentic loop unviable](issues/18-daily-quota.md).** Probing
exhausted the account's daily allowance in ~10 messages across ~10 conversations, and the page offers
"Buy Microsoft 365" / "Upgrade" — suggesting no Copilot licence. Every other ticket assumes browser
round trips are effectively unlimited. Until the counted unit (messages vs **conversations**) and the
allowance are known, the destination's reachability is unconfirmed. This outranks everything else on
the frontier.

## Not yet specified

<!-- in-scope fog; graduates to tickets as the frontier advances -->

- **Compaction strategy when the Transcript outgrows the ceiling.** Whose compaction wins, opencode's
  or ours, and do they fight. Much less pressing now that uploads lift the size wall, but not gone:
  Copilot's own conversation-length limit still applies.
- **What usage/token numbers we report back to opencode**, and how those numbers steer opencode's own
  context management. We know `usage` is accepted; we don't know what it *does* with it.
- **Noticing the DOM changed before it corrupts a run.** A canary or self-check, so a Copilot UI update
  surfaces as a clear failure rather than a subtly wrong extraction. Sharpened: the two load-bearing
  handles are `#m365-chat-editor-target-element` and `[data-testid="CopyButtonTestId"]`.
- **Latency budget.** Measured at ~5-7s per browser round trip regardless of message size. A 20-Turn
  task is therefore ~2 minutes of pure waiting. Tolerable? Unknown until a real task runs.
- **Packaging and lifecycle.** How the Shim starts, stops, and is discovered alongside opencode.
- **Multiple concurrent opencode sessions.** One browser, many tabs? Many browsers? Refused?

## Out of scope

- **Generalising to other browser chat UIs** (ChatGPT, Gemini, Claude.ai). One target, done properly.
- **Multi-user or hosted operation.** This is a single-user tool on one Mac.
- **Defeating Microsoft's automation controls** — CAPTCHA solving, fingerprint spoofing, detection
  evasion, or anything else that routes *around* a control rather than surfacing it. The chosen
  failure posture is to stop and hand the browser to the human, which makes this category
  unnecessary as well as unwanted.
- **Changing opencode itself.** The seam decision means we never fork or patch it.
