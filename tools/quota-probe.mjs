// Ticket 18: is the quota back, and what unit does it count?
//
// Sends messages inside ONE conversation. If the allowance is per-conversation,
// many messages in one chat should be cheap; if per-message, this depletes it at
// the same rate as opening new chats. Either way it reports where it stopped.
//
//   node tools/quota-probe.mjs [--max 6]

import { launch, ask, SELECTORS } from '../src/copilot-driver.mjs'
import { parseReply, ProtocolError } from '../src/protocol.mjs'
import fs from 'node:fs'

const args = process.argv.slice(2)
const MAX = Number(args[args.indexOf('--max') + 1] || 6)

const t0 = Date.now()
const log = (...m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...m)

const { ctx, page, authenticated } = await launch()
if (!authenticated) {
  log('not authenticated')
  process.exit(2)
}
log('authenticated; sending inside ONE conversation')

const results = []
let quotaHitAt = null

for (let i = 1; i <= MAX; i++) {
  const prompt =
    `Reply with ONLY this, as a fenced json code block, nothing else:\n` +
    `{"type":"final","content":"pong ${i}"}`
  try {
    const reply = await ask(page, prompt, { timeoutMs: 90000 })
    let parsedOk = false
    let kind = null
    try {
      const p = parseReply(reply)
      parsedOk = p.type === 'final' && String(p.content).includes(`pong ${i}`)
    } catch (e) {
      kind = e instanceof ProtocolError ? e.kind : 'other'
      if (kind === 'quota') {
        quotaHitAt = i
        log(`message ${i}: QUOTA EXHAUSTED`)
        results.push({ i, quota: true })
        break
      }
    }
    results.push({ i, parsedOk, kind, replyLen: reply.length, reply: reply.slice(0, 100) })
    log(`message ${i}: ${parsedOk ? 'protocol OK' : `parse failed (${kind})`} | ${JSON.stringify(reply.slice(0, 70))}`)
  } catch (e) {
    results.push({ i, error: String(e).slice(0, 160) })
    log(`message ${i}: ERROR ${String(e).slice(0, 120)}`)
    break
  }
  fs.writeFileSync('.scratch/session/quota-probe.json', JSON.stringify({ quotaHitAt, results }, null, 2))
}

fs.writeFileSync('.scratch/session/quota-probe.json', JSON.stringify({ quotaHitAt, results }, null, 2))
const ok = results.filter((r) => r.parsedOk).length
log(`\nSUMMARY: ${results.length} messages in ONE conversation, ${ok} parsed as valid protocol`)
log(quotaHitAt ? `quota hit at message ${quotaHitAt}` : 'quota NOT hit')
await ctx.close()
