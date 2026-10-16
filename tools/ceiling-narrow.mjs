// Ticket 10, part 2: narrow the ceiling and characterise the failure mode.
// The dangerous outcome is SILENT truncation. Diagnose precisely where a
// too-large message dies: at fill(), at send, or in Copilot.

import { launch, SELECTORS } from '../src/copilot-driver.mjs'
import fs from 'node:fs'

const t0 = Date.now()
const log = (...m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...m)

const SIZES = [50000, 55000, 60000]

const { ctx, page, authenticated } = await launch()
if (!authenticated) {
  log('not authenticated')
  process.exit(2)
}

const results = []

for (const size of SIZES) {
  const sentinel = `SENTINEL${size}Z`
  let filler = ''
  let i = 0
  while (filler.length < size - 400) {
    filler += `line ${i} of filler payload for the ceiling probe, id ${(i * 7919) % 100000}\n`
    i++
  }
  const msg =
    `Below is filler text. Ignore all of it. At the very end there is a sentinel token. ` +
    `Reply with ONLY that sentinel token inside a fenced code block, nothing else.\n\n` +
    filler.slice(0, Math.max(0, size - 400)) +
    `\n\nSENTINEL TOKEN: ${sentinel}\n`

  log(`--- ${size} (actual ${msg.length}) ---`)
  const r = { size, actual: msg.length }

  // 1. does fill() get the whole thing into the composer?
  await page.locator(SELECTORS.composer).click()
  await page.locator(SELECTORS.composer).fill(msg)
  await page.waitForTimeout(1200)
  const composerText = await page.locator(SELECTORS.composer).innerText()
  r.composerLen = composerText.length
  r.composerHasSentinel = composerText.includes(sentinel)
  log(`  composer holds ${r.composerLen} chars, sentinel present: ${r.composerHasSentinel}`)

  // 2. does the send control appear / is it enabled?
  const sendCount = await page.locator(SELECTORS.sendButton).count()
  r.sendButtonPresent = sendCount > 0
  if (sendCount > 0) {
    r.sendDisabled = await page
      .locator(SELECTORS.sendButton)
      .first()
      .isDisabled()
      .catch(() => null)
  }
  log(`  send button present: ${r.sendButtonPresent}, disabled: ${r.sendDisabled}`)

  // 3. any visible warning / character counter?
  r.warnings = await page.evaluate(() => {
    const txt = document.body.innerText || ''
    const hits = []
    for (const re of [/too long/i, /character limit/i, /exceeds/i, /maximum/i, /shorten/i]) {
      const m = txt.match(new RegExp(`.{0,80}${re.source}.{0,80}`, 'i'))
      if (m) hits.push(m[0].replace(/\s+/g, ' ').trim())
    }
    return hits
  })
  if (r.warnings.length) log('  WARNINGS ON PAGE:', JSON.stringify(r.warnings))

  // 4. try sending and see what happens
  const before = await page.locator(SELECTORS.copyResponse).count()
  if (r.sendButtonPresent && !r.sendDisabled) {
    await page.locator(SELECTORS.sendButton).first().click()
    const deadline = Date.now() + 60000
    let got = false
    while (Date.now() < deadline) {
      const [c, s] = await Promise.all([
        page.locator(SELECTORS.copyResponse).count(),
        page.locator(SELECTORS.stopButton).count(),
      ])
      if (c > before && s === 0) {
        got = true
        break
      }
      await page.waitForTimeout(300)
    }
    r.gotReply = got
    if (got) {
      await page.waitForTimeout(500)
      const n = await page.locator(SELECTORS.copyResponse).count()
      await page.locator(SELECTORS.copyResponse).nth(n - 1).click()
      await page.waitForTimeout(600)
      const reply = await page.evaluate(() => navigator.clipboard.readText())
      r.replyLen = reply.length
      r.sawSentinel = reply.includes(sentinel)
      r.reply = reply.slice(0, 120)
      log(`  reply ${r.replyLen} chars, sentinel echoed: ${r.sawSentinel ? 'YES' : 'NO <-- SILENT TRUNCATION'}`)
    } else {
      log('  NO REPLY within 60s')
      r.warnings = await page.evaluate(() => (document.body.innerText || '').slice(-500))
    }
  }

  // clear composer for the next round
  await page.locator(SELECTORS.composer).click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('Backspace')

  results.push(r)
  fs.writeFileSync('.scratch/session/ceiling-narrow.json', JSON.stringify(results, null, 2))
}

log('done')
console.log(JSON.stringify(results.map(({ reply, ...r }) => r), null, 2))
await ctx.close()
