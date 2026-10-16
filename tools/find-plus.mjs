import { launch } from '../src/copilot-driver.mjs'
import fs from 'node:fs'
const { ctx, page } = await launch()
await page.waitForTimeout(4000)
const btns = await page.evaluate(() => {
  const vis = (e) => { const r=e.getBoundingClientRect(); return r.width>0&&r.height>0 }
  return [...document.querySelectorAll('button,[role="button"],input[type="file"]')].filter(vis).map(e=>{
    const r=e.getBoundingClientRect()
    return { tag:e.tagName.toLowerCase(), aria:e.getAttribute('aria-label')||'', testid:e.getAttribute('data-testid')||'',
             text:(e.innerText||'').trim().slice(0,25), x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height) }
  })
})
console.log('=== buttons in the composer band (y 460-540) ===')
btns.filter(b=>b.y>455&&b.y<545).forEach(b=>console.log(' ', JSON.stringify(b)))
console.log('\n=== any input[type=file] ===')
console.log(JSON.stringify(btns.filter(b=>b.tag==='input'),null,1))
fs.writeFileSync('.scratch/session/composer-buttons.json', JSON.stringify(btns,null,2))
await ctx.close()
