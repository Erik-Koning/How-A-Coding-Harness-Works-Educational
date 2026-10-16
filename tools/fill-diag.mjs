// Why did a 40k markdown Preamble land in the composer as "<br aria-hidden>"?
import { launch, SELECTORS } from '../src/copilot-driver.mjs'
import { renderPreamble } from '../src/protocol.mjs'
import fs from 'node:fs'

const { ctx, page, authenticated } = await launch()
if (!authenticated) { console.log('not authed'); process.exit(2) }
await page.waitForTimeout(3000)

const cap = JSON.parse(fs.readFileSync('.scratch/capture/run-1184/001-request.json','utf8'))
const preamble = renderPreamble(cap.messages[0].content, cap.tools)

const cases = [
  ['plain 40k (ceiling-probe style)', Array.from({length:700},(_,i)=>`line ${i} of filler payload for the probe, id ${(i*7919)%100000}`).join('\n')],
  ['real preamble', preamble],
  ['preamble first 5k', preamble.slice(0,5000)],
  ['preamble first 20k', preamble.slice(0,20000)],
]

for (const [name, text] of cases) {
  await page.locator(SELECTORS.composer).click()
  await page.locator(SELECTORS.composer).fill('')
  await page.waitForTimeout(300)
  const t0 = Date.now()
  try { await page.locator(SELECTORS.composer).fill(text) } catch(e) { console.log(name,'fill threw:',String(e).slice(0,120)) }
  await page.waitForTimeout(1500)
  const got = await page.locator(SELECTORS.composer).innerText().catch(()=> '<err>')
  const html = await page.locator(SELECTORS.composer).innerHTML().catch(()=> '')
  const sendable = await page.locator(SELECTORS.sendButton).count()
  console.log(`${name.padEnd(34)} sent=${String(text.length).padStart(6)} got=${String(got.length).padStart(6)} send=${sendable} ${((Date.now()-t0)/1000).toFixed(1)}s  html0=${JSON.stringify(html.slice(0,60))}`)
}
await page.locator(SELECTORS.composer).fill('')
await ctx.close()
