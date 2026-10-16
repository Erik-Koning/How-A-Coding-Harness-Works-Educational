// Ticket 10, part 3: at ~50k chars something appears that blocks interaction.
// Is it a loud "too long" error (good — detectable) or a silent nothing?

import { launch, SELECTORS } from '../src/copilot-driver.mjs'
import fs from 'node:fs'

const log = (...m) => console.log(...m)
const SIZE = 50000

const { ctx, page, authenticated } = await launch()
if (!authenticated) process.exit(2)

let filler = ''
let i = 0
while (filler.length < SIZE - 400) {
  filler += `line ${i} of filler payload, id ${(i * 7919) % 100000}\n`
  i++
}
const msg = `Ignore the filler. Reply with ONLY the sentinel in a fenced code block.\n\n${filler.slice(0, SIZE - 400)}\n\nSENTINEL TOKEN: SENTINEL_OVERLAY_Z\n`

log('sending', msg.length, 'chars')
await page.locator(SELECTORS.composer).click()
await page.locator(SELECTORS.composer).fill(msg)
await page.waitForTimeout(1000)
const before = await page.locator(SELECTORS.copyResponse).count()
await page.locator(SELECTORS.sendButton).first().click()

// let whatever is going to happen, happen
await page.waitForTimeout(25000)

const diag = await page.evaluate(() => {
  const vis = (e) => {
    const r = e.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  // find elements that sit above the page and could intercept clicks
  const overlays = [...document.querySelectorAll('div,section,dialog')]
    .filter(vis)
    .filter((e) => {
      const cs = getComputedStyle(e)
      const z = parseInt(cs.zIndex || '0', 10)
      return (cs.position === 'fixed' || cs.position === 'absolute') && z > 100
    })
    .slice(0, 12)
    .map((e) => ({
      tag: e.tagName.toLowerCase(),
      role: e.getAttribute('role') || '',
      z: getComputedStyle(e).zIndex,
      text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 220),
    }))
    .filter((o) => o.text)

  return {
    url: location.href,
    alerts: [...document.querySelectorAll('[role="alert"],[aria-live="assertive"]')]
      .filter(vis)
      .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean),
    overlays,
    bodyTail: (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').slice(-1200),
  }
})

const after = await page.locator(SELECTORS.copyResponse).count()
log('copy controls before:', before, 'after:', after)
log('\n=== ALERTS ===')
log(JSON.stringify(diag.alerts, null, 2))
log('\n=== HIGH-Z OVERLAYS ===')
log(JSON.stringify(diag.overlays, null, 2))
log('\n=== BODY TAIL ===')
log(diag.bodyTail)

fs.writeFileSync('.scratch/session/overlay-diag.json', JSON.stringify(diag, null, 2))
await page.screenshot({ path: '.scratch/session/overlay.png', fullPage: false })
log('\nscreenshot: .scratch/session/overlay.png')
await ctx.close()
