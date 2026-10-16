import { launch } from '../src/copilot-driver.mjs'
const { ctx, page } = await launch()
await page.waitForTimeout(4000)
await page.locator('#m365-chat-editor-target-element').click().catch(()=>{})
await page.waitForTimeout(2000)
await page.screenshot({ path: '.scratch/session/composer-area.png', fullPage: false })
const info = await page.evaluate(() => {
  const b = document.querySelector('[data-testid="chat-input-attach-button"]')
  if (!b) return { present: false }
  const cs = getComputedStyle(b)
  const r = b.getBoundingClientRect()
  let p = b.parentElement, chain = []
  for (let i=0;i<4&&p;i++,p=p.parentElement){
    const pcs=getComputedStyle(p), pr=p.getBoundingClientRect()
    chain.push({tag:p.tagName,display:pcs.display,visibility:pcs.visibility,overflow:pcs.overflow,w:Math.round(pr.width),h:Math.round(pr.height)})
  }
  return { present:true, display:cs.display, visibility:cs.visibility, opacity:cs.opacity,
           rect:{w:Math.round(r.width),h:Math.round(r.height)}, ancestors:chain }
})
console.log(JSON.stringify(info,null,2))
await ctx.close()
