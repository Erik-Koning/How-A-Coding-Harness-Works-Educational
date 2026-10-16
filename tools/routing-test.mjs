// Verify injectAndSend routes by size. Stubs out the actual send click so this
// exercises the upload path WITHOUT consuming quota.
import { launch, attachFile, COMPOSER_LIMIT, SELECTORS } from '../src/copilot-driver.mjs'
import { renderPreamble } from '../src/protocol.mjs'
import fs from 'node:fs'

const { ctx, page, authenticated } = await launch()
if (!authenticated) { console.log('not authenticated'); process.exit(2) }
await page.waitForTimeout(3000)

// a realistic oversized payload: the real opencode Preamble + a big tool result
const cap = JSON.parse(fs.readFileSync('.scratch/capture/run-02/001-request.json','utf8'))
const preamble = renderPreamble(cap.messages[0].content, cap.tools)
const bigResult = Array.from({length:3000},(_,i)=>`${i}: some source line from a file the agent just read`).join('\n')
const payload = preamble + '\n\n## Result of `read`\n\n```\n' + bigResult + '\n```\n'

console.log('COMPOSER_LIMIT :', COMPOSER_LIMIT)
console.log('preamble       :', preamble.length)
console.log('full payload   :', payload.length, payload.length > COMPOSER_LIMIT ? '-> UPLOAD route' : '-> composer route')

fs.mkdirSync('.scratch/uploads', { recursive: true })
const f = '.scratch/uploads/routing-test.md'
fs.writeFileSync(f, payload)
console.log('file on disk   :', fs.statSync(f).size, 'bytes')

const t0 = Date.now()
const res = await attachFile(page, f)
console.log('attach result  :', JSON.stringify(res), `in ${((Date.now()-t0)/1000).toFixed(1)}s`)

const st = await page.evaluate(() => ({
  sendPresent: !!document.querySelector('button[aria-label="Send"]'),
  tail: (document.body.innerText||'').replace(/\n{2,}/g,'\n').slice(-220),
}))
console.log('page state     :', JSON.stringify(st, null, 2))
console.log('\nNOT sending — quota preserved.')
await ctx.close()
