// Ticket 07, take 2. The first predicate (copy appears + stop gone) FIRES
// PREMATURELY: a copy control exists on the placeholder message while Copilot is
// still showing "Generating response" / "Digging in…".
//
// Gather every candidate signal at 250ms so the predicate can be chosen on data
// rather than on a plausible story.

import { launch, SELECTORS, injectAndSend, responseCount } from '../src/copilot-driver.mjs'
import fs from 'node:fs'

const { ctx, page, authenticated } = await launch()
if (!authenticated) {
  console.log('not authenticated')
  process.exit(2)
}

function signals() {
  const vis = (e) => {
    const r = e.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const body = document.body.innerText || ''
  const copies = [...document.querySelectorAll('[data-testid="CopyButtonTestId"]')].filter(vis)
  const stops = [...document.querySelectorAll('[aria-label*="Stop" i],[aria-label*="Cancel generat" i]')].filter(vis)

  // text of the last assistant turn, as the page renders it
  const marker = body.lastIndexOf('Copilot said:')
  const lastTurn = marker === -1 ? '' : body.slice(marker + 'Copilot said:'.length).trim()

  return {
    copies: copies.length,
    stops: stops.length,
    generating: /Generating response|Digging in|Thinking|Searching/i.test(body),
    busy: !!document.querySelector('[aria-busy="true"]'),
    live: [...document.querySelectorAll('[aria-live]')]
      .filter(vis)
      .map((e) => (e.innerText || '').trim())
      .filter(Boolean)
      .slice(0, 3),
    lastTurnLen: lastTurn.length,
    lastTurnHead: lastTurn.slice(0, 60).replace(/\n/g, '\\n'),
  }
}

const baseline = await responseCount(page)
const PROMPT =
  'Reply with ONLY this fenced json code block and nothing else:\n```json\n{"type":"final","content":"pong"}\n```'
await injectAndSend(page, PROMPT)
const t0 = Date.now()

const rows = []
for (let i = 0; i < 240; i++) {
  const s = await page.evaluate(signals).catch(() => null)
  if (s) {
    rows.push({ t: Number(((Date.now() - t0) / 1000).toFixed(2)), ...s })
    const last = rows[rows.length - 1]
    if (i % 4 === 0) {
      console.log(
        `t+${String(last.t).padStart(6)} copies=${last.copies} stops=${last.stops} gen=${last.generating ? 'Y' : 'n'} busy=${last.busy ? 'Y' : 'n'} len=${String(last.lastTurnLen).padStart(4)} | ${last.lastTurnHead}`,
      )
    }
    // stop once things have been quiet for a while, so we capture the tail too
    const stableFor = rows.filter((r) => r.t > last.t - 4 && r.lastTurnLen === last.lastTurnLen).length
    if (last.copies > baseline && !last.generating && last.stops === 0 && stableFor > 14 && last.lastTurnLen > 0) break
  }
  await page.waitForTimeout(250)
}

fs.writeFileSync('.scratch/session/timeline2.json', JSON.stringify(rows, null, 2))
console.log(`\n${rows.length} samples -> .scratch/session/timeline2.json`)

// when would each candidate predicate have fired?
const firstWhere = (fn) => rows.find(fn)?.t ?? null
console.log('\ncandidate predicates:')
console.log('  copies>baseline && stops==0          ->', firstWhere((r) => r.copies > baseline && r.stops === 0))
console.log('  ... && !generating                   ->', firstWhere((r) => r.copies > baseline && r.stops === 0 && !r.generating))
console.log('  ... && !generating && !busy          ->', firstWhere((r) => r.copies > baseline && r.stops === 0 && !r.generating && !r.busy))
console.log('  ... && lastTurnLen>0                 ->', firstWhere((r) => r.copies > baseline && r.stops === 0 && !r.generating && r.lastTurnLen > 0))
console.log('  final settled length                 ->', rows[rows.length - 1]?.lastTurnLen)

await ctx.close()
