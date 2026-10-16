// Does "I lost the chat" actually hand back the FULL context?
//
// Relays two turns normally, then reports the chat lost on turn 3. The turn that
// follows must be a re-seed carrying the system prompt AND everything that
// happened so far — otherwise a fresh Copilot chat starts blind.

import { setTimeout as sleep } from 'node:timers/promises'

const PANEL = 'http://127.0.0.1:8788'

const SCRIPT = [
  '```json\n{"type":"tool_call","name":"bash","arguments":{"command":"wc -l src/protocol.mjs"}}\n```',
  '```json\n{"type":"tool_call","name":"bash","arguments":{"command":"wc -l src/config.ts"}}\n```',
]

let handled = 0
let lostChatFired = false

const post = (p, b) =>
  fetch(`${PANEL}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(b),
  }).then((r) => r.json())

const res = await fetch(`${PANEL}/events`)
const reader = res.body.getReader()
const dec = new TextDecoder()
let buf = ''
const seen = new Set()

for (;;) {
  const { value, done } = await reader.read()
  if (done) break
  buf += dec.decode(value, { stream: true })
  let i
  while ((i = buf.indexOf('\n\n')) !== -1) {
    const frame = buf.slice(0, i)
    buf = buf.slice(i + 2)
    if (!frame.startsWith('data: ')) continue
    const turn = JSON.parse(frame.slice(6)).current
    if (!turn || seen.has(turn.id) || turn.state === 'committed') continue
    seen.add(turn.id)

    if (handled < 2) {
      console.log(`turn ${turn.turnIndex}: relaying normally (${turn.query.length} chars)`)
      await post('/api/copied', { id: turn.id })
      await post('/api/send', { id: turn.id, text: SCRIPT[handled++] })
      await sleep(150)
      continue
    }

    if (!lostChatFired) {
      lostChatFired = true
      console.log(`turn ${turn.turnIndex}: *** PRESSING "I lost the chat" ***`)
      await post('/api/lost-chat', { id: turn.id })
      await sleep(150)
      continue
    }

    // this is the recovery turn — inspect what it actually contains
    console.log('\n=== RECOVERY TURN ===')
    console.log('has systemPrompt      :', !!turn.systemPrompt)
    console.log('systemPrompt chars    :', turn.systemPrompt?.length ?? 0)
    console.log('query chars           :', turn.query.length)
    const q = turn.query
    console.log('contains user request :', /Count lines in src\/protocol\.mjs/.test(q))
    console.log('contains prior call 1 :', /wc -l src\/protocol\.mjs/.test(q))
    console.log('contains prior result :', /363/.test(q))
    console.log('contains prior call 2 :', /wc -l src\/config\.ts/.test(q))
    console.log('contains 2nd result   :', /89/.test(q))
    console.log('\n--- first 400 chars of recovery query ---')
    console.log(q.slice(0, 400))
    await post('/api/send', { id: turn.id, text: '```json\n{"type":"final","content":"recovered"}\n```' })
    process.exit(0)
  }
}
