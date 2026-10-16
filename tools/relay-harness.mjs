// Stands in for the human at the panel, so a full multi-turn session can be
// exercised without spending Copilot quota.
//
// It performs exactly the actions a person performs — copied, review, send —
// through the same HTTP endpoints the panel uses. It supplies canned protocol
// replies rather than real Copilot output; the point is to prove the plumbing
// and the human gate, not the model.

import { setTimeout as sleep } from 'node:timers/promises'

const PANEL = process.env.PANEL ?? 'http://127.0.0.1:8788'

// This process impersonates the human. If it is left running against a real
// session it will answer YOUR questions with canned text, and the only clue is
// an implausibly fast reply. Require an explicit opt-in so it can never be
// started or forgotten by accident.
if (process.env.RELAY_CONFIRM !== '1') {
  console.error(
    '\n  relay-harness impersonates the human at the panel and answers with CANNED replies.\n' +
      '  It is a test fixture, not a way to use the bridge.\n\n' +
      '  If that is really what you want:  RELAY_CONFIRM=1 node tools/relay-harness.mjs\n',
  )
  process.exit(1)
}

console.warn(
  '\n  ⚠  RELAY HARNESS ACTIVE — canned replies are being sent as if by a human.\n' +
    '     Do not use the bridge for real work while this is running.\n',
)

/** Replies handed over in order, as a human would paste them. */
const SCRIPT = [
  '```json\n{"type":"tool_call","name":"bash","arguments":{"command":"wc -l src/protocol.mjs","description":"count lines"}}\n```',
  '```json\n{"type":"tool_call","name":"bash","arguments":{"command":"wc -l src/config.ts","description":"count lines"}}\n```',
  '```json\n{"type":"final","content":"Counted both files; protocol.mjs is the longer of the two."}\n```',
]

let handled = 0

async function post(path, body) {
  const res = await fetch(`${PANEL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

async function watch() {
  const res = await fetch(`${PANEL}/events`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const seen = new Set()

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    let idx
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      if (!frame.startsWith('data: ')) continue

      const snapshot = JSON.parse(frame.slice(6))
      const turn = snapshot.current
      if (!turn || seen.has(turn.id) || turn.state === 'committed') continue
      seen.add(turn.id)

      const kind = turn.systemPrompt ? 'NEW CHAT (system prompt included)' : 'delta, same chat'
      console.log(
        `[human] turn ${turn.turnIndex} — ${kind}, ${turn.query.length} chars of query`,
      )

      // Stop when the script is exhausted rather than repeating the last reply.
      // Repeating it is what let this harness answer an unrelated question with
      // a stale answer — the turn simply sat unanswered would have been obvious.
      if (handled >= SCRIPT.length) {
        console.warn(
          `[harness] script exhausted at turn ${turn.turnIndex} — exiting rather than sending a stale reply.`,
        )
        process.exit(0)
      }
      const reply = SCRIPT[handled]
      handled++

      // the same three discrete actions a person takes in the panel
      await post('/api/copied', { id: turn.id })
      await sleep(120)
      await post('/api/review', { id: turn.id, text: reply })
      await sleep(120)
      await post('/api/send', { id: turn.id, text: reply })
      console.log(`[human] turn ${turn.turnIndex} sent to opencode`)
    }
  }
}

console.log(`[human] watching ${PANEL} …`)
await watch()
