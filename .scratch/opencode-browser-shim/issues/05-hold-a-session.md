# Establish and characterise an authenticated Copilot session

Type: task
Status: resolved
Blocked by: —

## Question

Can Playwright reach a working M365 Copilot chat with a persistent Chromium profile, and what are
the properties of that session? This is the ground-truth run that everything else is built on.

Drive it by hand first (HITL), then automate what proved stable. Record findings as facts, not
impressions.

Answer at minimum:

- **Launch**: does `launchPersistentContext` against a profile work, or is CDP-attach to an already
  running Chromium needed? Does a running Chrome hold a lock on the profile directory — and do we
  therefore want a dedicated profile rather than the daily-driver one?
- **Login**: what is actually presented on a cold start — already signed in, autofilled, or a full
  password form? Is MFA enforced, and on what cadence?
- **Lifetime**: how long does the session survive? Across a browser restart? A machine restart? Days
  of idleness? This sets how often the login flow runs, which sets how much it matters.
- **Headed or headless**: does Copilot work headless, or does it detect and refuse? (Headed is fine
  and probably preferable given the Pause design — but we should know, not assume.)
- **The chat surface**: what URL lands on a *new empty chat*? Is there a stable way to start a fresh
  conversation on demand — a URL parameter, a button — since Re-seed depends on it.
- **Anti-automation**: does anything challenge us on a first automated visit?

## Definition of done

A script that gets from cold to a usable, empty Copilot chat, plus a written record of the six
answers above. If any of them is "it depends", say what it depends on.

## Answer

A dedicated persistent Chromium profile reaches a working Copilot chat. Evidence in
`.scratch/session/` (`observations.jsonl`, `selectors.json`, `chat-surface.png`).

| Question | Finding |
| --- | --- |
| Launch | `chromium.launchPersistentContext()` works. **Use a dedicated profile dir** (`.scratch/browser-profile`), not the daily Chrome profile — sidesteps the profile lock entirely, and the daily browser stays usable while the Shim runs. |
| Login | Cold profile redirects to `login.microsoftonline.com`. A **human signs in once**; the profile then holds the session. Reached `Chat \| M365 Copilot` **56s** after launch including hand-typing. |
| MFA | Not enforced on this account's first sign-in. **Still unknown on re-auth** — remains a Pause case by design. |
| Headed | Ran headed throughout; nothing challenged the automated browser. Headless untested and not needed — headed suits the Pause design, since the human must be able to see and click. |
| Chat surface | `https://m365.cloud.microsoft/chat` lands on a **new empty chat**. Simple URL navigation is therefore enough to Re-seed. |
| Anti-automation | Nothing triggered across ~10 automated sends. |

### Measured selectors

```
composer      #m365-chat-editor-target-element   (contenteditable span, role=textbox,
                                                  aria-label="Message Copilot" — NOT a textarea)
send          button[aria-label="Send"]           (only exists once composer is non-empty)
copy message  [data-testid="CopyButtonTestId"]    (aria-label="Copy Response")
copy code     button[aria-label="Copy code"]
stop          [aria-label*="Stop" i]
```

`data-testid="CopyButtonTestId"` is the most durable handle on the page — the only stable test id
found — and both completion detection and extraction hang off it.

### Trap found and fixed

Judging authentication from `page.url()` right after `domcontentloaded` is **wrong**: an
authenticated load still transits `login.microsoftonline.com` during the OAuth redirect chain, so the
Shim reports a false "session expired". Wait for a DOM signal instead — composer present
(authenticated) vs `input[type=password]` present (not). Fixed in `src/copilot-driver.mjs`.

### Not established

**Session lifetime.** Held comfortably across an hour and several browser restarts within this
session, but days/weeks of idleness are untested. This is the input *Where the password lives* needs,
so that ticket stays open pending real elapsed time.
