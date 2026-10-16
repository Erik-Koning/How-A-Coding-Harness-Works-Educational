# Auth approach: persistent Chromium profile with a driven login

Type: grilling
Status: resolved
Blocked by: —

## Question

How does the Shim reach an authenticated M365 Copilot chat? Cookie injection, headless login, an
attached profile, something else?

## Answer

**A persistent Chromium profile, with a login flow the Shim can drive when it is presented.**

Playwright launches (or attaches to) a persistent Chromium user-data directory rather than a fresh
ephemeral context. On navigating to `https://m365.cloud.microsoft/chat`:

- Already authenticated → land straight on the chat.
- Credentials autofilled → click through sign-in and continue.
- Password required → the Shim enters it.

The profile is the durable part; the login flow is the fallback the Shim must be able to walk.

### Consequences

- The Shim handles a **password**, which makes secret storage a real question rather than a
  hypothetical — its own ticket.
- **MFA is an open unknown.** If the tenant enforces it on re-auth, that is a Pause, not an
  automation target. Only a real run will tell us.
- Everything downstream is gated on this: no extraction, protocol, or server work is meaningful
  until a session can be reached and held. The characterisation ticket therefore blocks most of the
  map.
- Profile locking is a live hazard — a running Chrome may hold the profile directory, and a
  Playwright launch against a locked profile fails. Whether we need a dedicated profile separate
  from the user's daily Chrome is part of characterisation.
