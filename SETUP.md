# Setup and configuration

How to install the shim, connect opencode to it, and relay a full task through Microsoft 365 Copilot
by hand.

> [!CAUTION]
> **Automating the copying and pasting could break the terms and conditions of the chat service you
> use, and is advised against.** If you are unsure what your service allows, consult a lawyer and/or
> the provider of the LLM chat interface you are using. **Recommended:** use only your own chat
> interface and account, and do every copy and paste yourself. See
> [Terms and conditions](README.md#terms-and-conditions).

## Requirements

- **Node.js 22** and npm. Tested on Node 22.21.
- **macOS, Linux or Windows.** The panel opens with `open`, `xdg-open` or `start`.
- **An LLM chat account.** These steps use Microsoft 365 Copilot at
  [m365.cloud.microsoft/chat](https://m365.cloud.microsoft/chat). Any chat window you can paste
  into should work the same way.
- **opencode.** You do not need to install it separately: it is a dev dependency of this project
  (version 1.18.4 at the time of writing), so `npx opencode` runs it.

You do **not** need an AI API key.

## 1. Install

```bash
git clone https://github.com/Erik-Koning/How-A-Coding-Harness-Works-Educational.git
cd How-A-Coding-Harness-Works-Educational
npm install
```

`npm install` also builds everything: the shim server into `dist/` and the panel into
`panel/dist/`. To rebuild later, run `npm run build`.

Check that it works:

```bash
npm test
```

## 2. Start the shim

```bash
npm start
```

You should see:

```
transport: manual (human-in-the-loop)
[manual] panel on http://127.0.0.1:8788
[shim 14:02:11] listening on http://127.0.0.1:8787/v1
[shim 14:02:11] traces -> .scratch/shim-log/
```

Leave this terminal open. It logs every turn as it happens.

Both servers listen on `127.0.0.1` only, so nothing is reachable from your network.

## 3. Point opencode at the shim

This repo already includes an `opencode.json` that does this, so if you run opencode from this
folder there is nothing to do:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "copilot-shim": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "M365 Copilot (browser)",
      "options": {
        "baseURL": "http://127.0.0.1:8787/v1",
        "apiKey": "not-needed"
      },
      "models": {
        "m365-copilot": {
          "name": "M365 Copilot (browser)",
          "tool_call": true,
          "limit": { "context": 128000, "output": 8192 }
        }
      }
    }
  },
  "model": "copilot-shim/m365-copilot"
}
```

What each part does:

| Field | Purpose |
| --- | --- |
| `npm: "@ai-sdk/openai-compatible"` | opencode talks to the shim as if it were any OpenAI-compatible API. |
| `options.baseURL` | Where the shim listens. Change it if you change `COPILOT_SHIM_PORT`. |
| `options.apiKey` | Required by the client library but ignored by the shim. Any value works. |
| `tool_call: true` | Tells opencode to send its tools. Without it there is no agent loop to watch. |
| `limit.context` / `limit.output` | Used by opencode to decide when to compact the conversation. |
| `model` | Makes the shim the default model, so you do not need `--model` every time. |

### Using it on another project

opencode works on the folder you start it in, so you can watch it work on any of your repos. You do
not need to change anything in the other repo.

The easiest way is the install script, which adds an `opencode-shim` command. From this repo:

```bash
./install.sh
```

This runs `npm install` and writes the command to `~/.local/bin`. Then, from any repo:

```bash
opencode-shim                    # interactive UI
opencode-shim run "your task"    # a single task
```

- If the shim is not running, `opencode-shim` starts it in the background first. Its output goes to
  `.scratch/shim-background.log` in this repo. Stop it with `pkill -f shim-server`.
- Any arguments are passed on to opencode, so `--model`, `run` and the rest work as usual.
- `./install.sh --bin-dir DIR` puts the command somewhere else. `./install.sh --uninstall` removes it.
- If `~/.local/bin` is not on your `PATH`, the script prints the line to add to your shell config.
- If you move this repo, run `./install.sh` again.

#### Without the install script

Keep the shim running from this repo (`npm start` in this folder). Then, in a second terminal:

```bash
cd ~/path/to/other-repo
SHIM=~/path/to/How-A-Coding-Harness-Works-Educational
OPENCODE_CONFIG=$SHIM/opencode.json $SHIM/node_modules/.bin/opencode
```

For a single task instead of the interactive interface, add `run "your task"` to the end of the
last line.

- `OPENCODE_CONFIG` tells opencode to load the shim provider from this repo's `opencode.json`.
- `$SHIM/node_modules/.bin/opencode` is the opencode installed with this repo, so you do not need a
  global install.
- opencode's tool calls read, edit and run commands in the other repo.
- Traces still go to `.scratch/shim-log/` in **this** repo, because the shim writes them to the
  folder it was started from.
- If the other repo has its own `opencode.json` that sets a `model`, add
  `--model copilot-shim/m365-copilot` to make sure the shim is used.

**Or edit the other repo's config:** copy the `provider` block above into the other repo's `opencode.json`, or into
your global config at `~/.config/opencode/opencode.json`, and pick the model with
`--model copilot-shim/m365-copilot`. This needs opencode installed globally, or the full path to
this repo's copy as above.

Remember that opencode runs tools for real on your machine. Try it on a scratch folder or a clean
git checkout first.

## 4. Open your chat window

Open [m365.cloud.microsoft/chat](https://m365.cloud.microsoft/chat) in your browser and sign in.
Keep it in a tab next to the panel.

## 5. Run a task

In a second terminal, from the same folder:

```bash
npx opencode run "How many lines are in src/protocol.mjs?"
```

Or start the interactive interface with `npx opencode` and type the task there.

Start with something small like the example above. It takes two turns: one tool call and one final
answer.

## 6. Relay each turn

The panel opens in your browser on the first turn. While a turn is waiting, the tab title shows
**● Turn N waiting**. The left side is what goes **out** to your chat window; the right side is
what comes back **in**.

### The first turn: a new chat

The banner reads **"Start a new Copilot chat and paste this. It carries the system prompt."**

1. Start a **new** chat in Copilot.
2. In the panel, click **Copy both**. This copies the system prompt and the query together.
3. Paste into Copilot and send.
4. When Copilot finishes, copy its whole reply. Copilot's own copy button keeps the formatting
   intact; selecting text by hand also works.
5. Paste it into **Paste the response…** in the panel and click **Review** (or press ⌘⏎ / Ctrl+⏎).
6. Read it. This is exactly what opencode will receive. Click **Send to opencode**, or
   **Edit again** to fix it.

opencode now runs the tool on your machine (for example `wc -l src/protocol.mjs`) and sends the
next turn.

### Later turns: the same chat

The banner reads **"Paste into the same Copilot chat as the previous turn."** The panel now shows
only what is new: usually the tool's output and a reminder of the reply format.

1. Click **Copy prompt**.
2. Paste into the **same** Copilot chat and send.
3. Copy the reply back, then **Review** and **Send to opencode** as before.

Repeat until Copilot replies with a final answer (`{"type":"final", ...}`). opencode prints it and
the task is done.

### What a good reply looks like

Each reply should be exactly one fenced JSON block and nothing else:

````
```json
{"type":"tool_call","name":"bash","arguments":{"command":"wc -l src/protocol.mjs","description":"count lines"}}
```
````

If Copilot adds some text around the block, that is fine: the shim finds the JSON. If there is no
usable JSON at all, see [Troubleshooting](#troubleshooting).

## Recovering when something goes wrong

| Situation | What to do |
| --- | --- |
| You closed, reset or lost the Copilot chat | Click **I lost the chat**. The next turn carries the full context again; paste it into a new chat. |
| You want to restart in a fresh chat without waiting | On a later turn, click **Copy full context** next to "Starting a new Copilot chat?" and paste it into a new chat. |
| The turn is too big to paste comfortably | Click **Download this turn** (or the **download** link for the full context) and upload the file to Copilot instead. |
| Copilot's reply was not valid | The shim sends a short correction prompt as the next turn. Paste it into the same chat. It tries this up to 3 times before the turn fails. |
| Copilot says you have reached your daily limit | The shim recognises the message and stops the turn with an error. Try again when your limit resets. |
| You quit opencode while a turn was waiting | The shim drops that turn. Nothing is left stuck in the panel. |

## Configuration

All settings are environment variables, read once when the shim starts.

| Variable | Default | Purpose |
| --- | --- | --- |
| `COPILOT_SHIM_PORT` | `8787` | Port for the OpenAI-compatible endpoint. If you change it, update `baseURL` in `opencode.json`. |
| `COPILOT_PANEL_PORT` | `8788` | Port for the panel. |
| `COPILOT_PANEL_OPEN` | `true` | Open the panel automatically when a turn arrives and no panel is open. Set to `0` or `false` to open it yourself. |

Example:

```bash
COPILOT_SHIM_PORT=9787 COPILOT_PANEL_OPEN=0 npm start
```

## Watching the traffic

This is the educational part. Everything that passes through is recorded.

- **In the panel:** **Turn history** at the bottom lists every turn, with what was sent and what came
  back. **Export session** downloads the whole session as one Markdown file.
- **On disk:** `.scratch/shim-log/` in the folder you started the shim from holds, per turn:
  - `NNN-outbound.txt`: exactly what you were asked to paste
  - `NNN-reply-N.txt`: the reply you pasted back (one file per attempt)
  - `NNN-parsed.json`: how the shim read it, either a tool call or a final answer

Open `001-outbound.txt` to see opencode's tool definitions and system prompt in full.

What you see is the shim's text rendering of opencode's request, not the raw JSON. The tool schemas
are slimmed (fields that cost characters but carry no meaning are removed), and opencode's system
prompt is cut to its most relevant sections to fit within about 12,000 characters.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `The operator panel has not been built` | Run `npm run build:panel`, then `npm start` again. |
| `EADDRINUSE` on start | Another process is using the port. Stop it, or set `COPILOT_SHIM_PORT` / `COPILOT_PANEL_PORT`. |
| opencode seems to hang | It is waiting for you. Check the panel. The shim terminal says `awaiting a human`, or `queued behind N unanswered turns` if an earlier turn is still open. |
| opencode prints `[shim error] ...` | The turn failed (for example after 3 invalid replies, or a daily limit). The message says why. |
| opencode cannot connect | Check the shim is running and that `baseURL` matches `COPILOT_SHIM_PORT`. |
| The panel did not open | Open `http://127.0.0.1:8788` yourself, or check `COPILOT_PANEL_OPEN` is not `0`. |
| **Copy** says "Selected — press ⌘C" | The browser blocked clipboard access. The text is selected; press ⌘C or Ctrl+C. |
| Copilot answers in prose, or claims to have run the command itself | Paste the reply back anyway: the shim sends a correction prompt as the next turn. Or, before pasting, ask Copilot in the same chat to "Reply with exactly one fenced json block as specified." |

## Commands

| Command | What it does |
| --- | --- |
| `./install.sh` | Install dependencies, build everything, and add the `opencode-shim` command |
| `npm install` | Install dependencies and build everything |
| `npm start` | Start the shim and the panel |
| `npm run build` | Rebuild the shim and the panel |
| `npm test` | Run the unit tests |
| `npm run typecheck` | Type-check without building |
| `npm run dev:panel` | Run the panel with hot reload, for working on its UI |
