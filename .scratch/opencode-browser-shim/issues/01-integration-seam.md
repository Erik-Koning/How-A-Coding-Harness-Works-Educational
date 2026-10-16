# Integration seam: a local OpenAI-compatible HTTP server

Type: research
Status: resolved
Blocked by: —

## Question

Where does the browser shim plug into opencode 1.18.2? Via the plugin API, a fork of the provider
layer, or something else?

## Answer

**A local HTTP server speaking `/v1/chat/completions`, registered as a custom provider.** Not a
plugin, not a fork.

opencode's plugin API (`@opencode-ai/plugin`) exposes only *events* — `tool.execute.before` /
`.after`, `session.*`, `message.*`, `permission.*`, `command.executed`, `file.edited`, `tui.*`,
`experimental.session.compacting`. **None of them intercept or replace the model request.** There is
no `chat.params`, no `chat.message`, no fetch override. So the plugin route cannot carry this.

The provider config, however, takes an arbitrary base URL:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "copilot-shim": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "M365 Copilot (browser)",
      "options": { "baseURL": "http://localhost:PORT/v1" },
      "models": { "m365-copilot": { "name": "M365 Copilot (browser)" } }
    }
  }
}
```

This is the same mechanism Ollama / LM Studio / llama.cpp use. `@ai-sdk/openai-compatible` targets
`/v1/chat/completions`; `@ai-sdk/openai` would target `/v1/responses` instead.

### Consequences

- Zero changes to opencode. It is a stock install pointed at localhost.
- Every hard problem — protocol translation, response-done detection, extraction, recovery — lives
  inside the Shim, behind a single well-understood interface.
- The Shim must satisfy whatever `@ai-sdk/openai-compatible` actually demands on the wire. That is
  not yet fully known and is its own ticket.

Source: <https://opencode.ai/docs/providers/>, <https://opencode.ai/docs/plugins/> (fetched 2026-07-30).
