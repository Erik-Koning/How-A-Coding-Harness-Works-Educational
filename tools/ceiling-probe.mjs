// Ticket 10: what is the largest message Copilot accepts, and does it fail
// LOUDLY or SILENTLY at the boundary?
//
// Silent truncation is the dangerous outcome: the Shim would believe it sent a
// full Transcript while Copilot saw half, and every downstream symptom would
// look like a model failure. We detect it with a sentinel at the very END of the
// message — if Copilot can echo the sentinel, it saw the end.
//
// The number that matters most is 43502: opencode's Preamble.

import { launch, ask } from '../src/copilot-driver.mjs'
import fs from 'node:fs'

const t0 = Date.now()
const log = (...m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...m)

const SIZES = [5000, 20000, 43502, 60000, 100000]

const { ctx, page, authenticated } = await launch()
if (!authenticated) {
  log('SESSION EXPIRED — re-run session-probe.mjs and sign in')
  process.exit(2)
}
log('authenticated, starting sweep')

const results = []

for (const size of SIZES) {
  const sentinel = `SENTINEL${size}Z`
  // Filler is varied text rather than one repeated char — a repeated char might
  // be compressed or elided by something in the path and give a false pass.
  let filler = ''
  let i = 0
  while (filler.length < size - 400) {
    filler += `line ${i} of filler payload for the ceiling probe, id ${(i * 7919) % 100000}\n`
    i++
  }
  const msg =
    `Below is a block of filler text. Ignore all of it. At the very end there is a sentinel token. ` +
    `Reply with ONLY that sentinel token inside a fenced code block, nothing else.\n\n` +
    filler.slice(0, Math.max(0, size - 400)) +
    `\n\nSENTINEL TOKEN: ${sentinel}\n`

  log(`--- size ${size} (actual ${msg.length} chars) ---`)
  const started = Date.now()
  try {
    const reply = await ask(page, msg, { timeoutMs: 180000 })
    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    const saw = reply.includes(sentinel)
    results.push({ size, actual: msg.length, ok: true, sawSentinel: saw, elapsedS: Number(elapsed), replyLen: reply.length, reply: reply.slice(0, 200) })
    log(`  sent OK in ${elapsed}s | sentinel echoed: ${saw ? 'YES' : 'NO  <-- SILENT TRUNCATION'} | reply: ${JSON.stringify(reply.slice(0, 80))}`)
  } catch (e) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    results.push({ size, actual: msg.length, ok: false, error: String(e).slice(0, 250), elapsedS: Number(elapsed) })
    log(`  FAILED after ${elapsed}s: ${String(e).slice(0, 160)}`)
  }
  fs.writeFileSync('.scratch/session/ceiling-results.json', JSON.stringify(results, null, 2))
}

log('sweep complete')
console.log(JSON.stringify(results.map(({ reply, ...r }) => r), null, 2))
await ctx.close()
