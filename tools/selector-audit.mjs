// Audit: the probes filtered candidate elements by visibility; the driver's
// locator .count() does not. If hidden Stop/Copy controls exist in the DOM, then
// waitForComplete() can never satisfy `stops === 0` and every Turn hangs until
// its 180s timeout. Loads the page only — sends nothing, so costs no quota.

import { launch, SELECTORS } from '../src/copilot-driver.mjs'

const { ctx, page, authenticated } = await launch()
console.log('authenticated:', authenticated)
if (!authenticated) {
  console.log('cannot audit without a session')
  await ctx.close()
  process.exit(2)
}

for (const [name, sel] of Object.entries(SELECTORS)) {
  const all = await page.locator(sel).count()
  const vis = await page.locator(sel).filter({ visible: true }).count().catch(() => 'n/a')
  const flag = all !== vis ? '   <-- MISMATCH: hidden elements present' : ''
  console.log(`${name.padEnd(14)} all=${String(all).padStart(3)}  visible=${String(vis).padStart(3)}${flag}`)
}

// what does the raw DOM think about stop controls specifically?
const detail = await page.evaluate(() => {
  const els = [...document.querySelectorAll('[aria-label*="Stop" i], [aria-label*="Cancel generat" i]')]
  return els.map((e) => {
    const r = e.getBoundingClientRect()
    const cs = getComputedStyle(e)
    return {
      aria: e.getAttribute('aria-label'),
      w: Math.round(r.width),
      h: Math.round(r.height),
      display: cs.display,
      visibility: cs.visibility,
      hidden: e.hasAttribute('hidden') || e.getAttribute('aria-hidden') === 'true',
    }
  })
})
console.log('\nstop-control detail:', JSON.stringify(detail, null, 2))

await ctx.close()
