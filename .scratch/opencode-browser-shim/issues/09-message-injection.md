# Inject a large message into the composer

Type: prototype
Status: resolved
Blocked by: 05

## Question

How does the Shim put a multi-kilobyte message into Copilot's composer and send it, without
mangling it or taking thirty seconds?

Every Turn sends at minimum a tool result; a Re-seed sends an entire replayed Transcript. Both are
large and both must arrive intact.

Things to establish:

- **Typing vs paste.** `type()` is slow and fires per-keystroke handlers that may autocomplete,
  autoformat, or trigger slash-command menus. Writing to the clipboard and pasting is fast and
  atomic — does the composer accept a paste, and does it preserve newlines?
- **Newlines don't send.** In most chat composers Enter sends and Shift+Enter newlines. A pasted
  multi-line block must not fire a premature send, and a payload containing blank lines must survive.
- **Does the composer transform input?** Markdown auto-formatting, slash commands on a leading `/`,
  @-mention pickers, emoji substitution. Any of these silently corrupt a structured payload.
- **Send confirmation.** How do we know the message was actually submitted and not left sitting in a
  disabled composer? (Pairs with response-done detection but is a distinct check.)
- **Attachments.** If Copilot accepts file uploads, that is a potential escape route for very large
  payloads — worth noting even if we don't use it yet, since it feeds the fog around big tool results.

## Definition of done

`sendMessage(page, text)` that delivers an adversarial multi-line payload with fenced code, blank
lines, and a leading `/` intact, confirms submission, and does it in a time we can afford once per
Turn.

## Answer

**`locator.fill()` on the contenteditable span.** Playwright handles the Fluent editor correctly and
it is atomic — no per-keystroke handlers, no slash-command menu, no autocomplete.

| Method | Result |
| --- | --- |
| `locator(COMPOSER).fill(text)` | **works** — 277-char adversarial payload landed as 279 innerText chars |
| clipboard write + `Meta+V` | works — but landed 291 chars (more normalisation drift) and needs clipboard permissions |
| per-key `type()` | not pursued — slow, and the atomic paths both worked |

`fill()` is preferred: fewer moving parts, no permission dependency, closer round-trip length.

### Fidelity is proven on the outbound side

Copilot's own "You said:" echo reproduced the injected payload **byte for byte** — `hello   world`
kept all three spaces, `trailing spaces   ` kept all three, blank lines, tabs, indentation and a
literal backtick all survived. **Whatever corruption exists in this system, it is not on the way in.**

Newlines do not send prematurely: a multi-line payload with blank lines went in as one message via
`fill()`, and a leading `/` did not open a command menu.

### Send confirmation

`button[aria-label="Send"]` **does not exist until the composer is non-empty** — it appeared only
after injection (11 buttons → 12). That makes it a natural confirmation that content actually landed:
wait for the button, then click it. Pressing Enter also sends, but the explicit button click is
checkable.

### Attachments

Not explored. Copilot's file-upload affordance may be an escape route for payloads over the input
ceiling — noted for the *big tool results* fog, not needed yet.
