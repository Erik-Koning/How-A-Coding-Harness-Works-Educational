// Prove the upload path end-to-end WITHOUT sending (attaching costs no quota).
import { launch } from '../src/copilot-driver.mjs'
import fs from 'node:fs'

const PLUS = '[data-testid="PlusMenuButton"], [data-testid="chat-input-attach-button"]'
const { ctx, page, authenticated } = await launch()
if (!authenticated) { console.log('not authenticated'); process.exit(2) }
await page.waitForTimeout(3500)

await page.locator(PLUS).first().click()
await page.waitForTimeout(1500)

const menu = await page.evaluate(() => {
  const vis = (e) => { const r=e.getBoundingClientRect(); return r.width>0&&r.height>0 }
  return [...document.querySelectorAll('[role="menuitem"],[role="menuitemcheckbox"],[role="option"],button,[role="button"]')]
    .filter(vis)
    .map(e => ({ aria:e.getAttribute('aria-label')||'', testid:e.getAttribute('data-testid')||'', text:(e.innerText||'').trim().slice(0,60) }))
    .filter(x => /upload|file|device|onedrive|image|attach/i.test(`${x.aria} ${x.testid} ${x.text}`))
})
console.log('=== menu entries ==='); console.log(JSON.stringify(menu, null, 2))

const tmp = '/tmp/shim-payload.md'
fs.writeFileSync(tmp, '# Tool result payload\n\n' + Array.from({length:800},(_,i)=>`line ${i}: content that would never fit in a chat composer`).join('\n') + '\n')
console.log('payload file:', fs.statSync(tmp).size, 'bytes')

let how = null
try {
  const fi = page.locator('input[type="file"]')
  if (await fi.count() > 0) {
    await fi.first().setInputFiles(tmp); how = 'existing input[type=file]'
  } else {
    const chooserP = page.waitForEvent('filechooser', { timeout: 10000 })
    await page.getByText(/upload (images and )?files?|from this device|upload/i).first().click()
    const chooser = await chooserP
    await chooser.setFiles(tmp); how = 'filechooser'
  }
} catch (e) { console.log('attach failed:', String(e).slice(0,300)) }

if (how) {
  console.log('attached via:', how)
  await page.waitForTimeout(6000)
  const st = await page.evaluate(() => ({
    sendPresent: !!document.querySelector('button[aria-label="Send"]'),
    tail: (document.body.innerText||'').replace(/\n{2,}/g,'\n').slice(-300),
  }))
  console.log('after attach:', JSON.stringify(st, null, 2))
  await page.screenshot({ path: '.scratch/session/attached.png' })
}
await ctx.close()
