// The composer header has an "Auto" selector. If it can switch Copilot out of
// its agentic/interpreter mode, that may stop it executing commands itself
// instead of emitting tool calls. Inspecting costs no quota.
import { launch } from '../src/copilot-driver.mjs'
const { ctx, page, authenticated } = await launch()
if (!authenticated) { console.log('not authed'); process.exit(2) }
await page.waitForTimeout(4000)

const before = await page.evaluate(() => {
  const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0}
  return [...document.querySelectorAll('button,[role="button"],[role="combobox"],select')].filter(vis)
    .map(e=>({aria:e.getAttribute('aria-label')||'',testid:e.getAttribute('data-testid')||'',text:(e.innerText||'').trim().slice(0,30),expanded:e.getAttribute('aria-expanded')||''}))
    .filter(x=>/auto|mode|model|gpt|think|reason|agent/i.test(`${x.aria} ${x.testid} ${x.text}`))
})
console.log('=== mode-ish controls ==='); console.log(JSON.stringify(before,null,2))

const auto = page.locator('[aria-label="Model Selector"]').first()
if (await auto.count() > 0) {
  await auto.click(); await page.waitForTimeout(1500)
  const opts = await page.evaluate(() => {
    const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0}
    return [...document.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="option"]')].filter(vis)
      .map(e=>({text:(e.innerText||'').replace(/\s+/g,' ').trim().slice(0,80), checked:e.getAttribute('aria-checked')||''}))
  })
  console.log('=== options in the Auto menu ==='); console.log(JSON.stringify(opts,null,2))
  await page.screenshot({ path: '.scratch/session/mode-menu.png' })
} else console.log('no Auto button found')
await ctx.close()
