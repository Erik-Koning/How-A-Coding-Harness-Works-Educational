# Where the password lives

Type: grilling
Status: resolved
Blocked by: 05

## Question

The Shim may have to type a password. Where does that secret live, and who can read it?

Options to put to the human, with the trade-off each carries:

- **macOS Keychain** via `security find-generic-password` — encrypted at rest, unlocked with the
  login session, no plaintext on disk. Costs a shell-out per read.
- **Environment variable** at Shim launch — simplest, but leaks into process listings and shell
  history.
- **Never stored**: the Shim always Pauses on a login form and the human types it. Zero secret
  handling, at the cost of an interactive moment on every re-auth.

The right answer depends hard on the session-lifetime finding in the characterisation ticket: if the
session survives for weeks, "never stored" is nearly free and clearly correct. If it expires daily,
it is a daily interruption and the Keychain earns its complexity.

Also settle: does the Shim ever write anything sensitive to logs or the Transcript of Record — and
if the Transcript is persisted to disk, what is in it?

## Answer

**The Shim never stores or types the password. It Pauses and the human types it.**

The earlier framing assumed the Shim would drive the login form. Building it made clear that is
unnecessary: the Pause machinery already exists for MFA and challenge pages, and a password form is
the same shape of problem. Reusing it means **zero secret handling code** — nothing in the Keychain,
nothing in the environment, nothing to leak into a log or a crash dump.

This is cheap because the session is durable: the persistent profile carried authentication across
browser restarts throughout testing, so a human sign-in is a rare event, not a per-run tax.

Implemented as `waitForHuman()` in `src/shim-server.mjs`: surface the browser, notify, poll for the
composer to reappear, resume.

### Revisit if

Session lifetime turns out to be short — if sign-in is needed daily, the interruption may justify
Keychain storage (`security find-generic-password`, never a plaintext file or an env var). Lifetime is
still unmeasured; the *Establish and characterise* ticket left it open deliberately.

### What is written to disk

- `.scratch/browser-profile/` holds real session cookies — **it is credential material** and must
  never be committed or shared.
- `.scratch/shim-log/` holds every Turn's prose, replies and parse results, which will contain source
  code and command output from the user's project. Diagnostically essential, but it is project data,
  not something to hand around.

Both belong in `.gitignore`.
