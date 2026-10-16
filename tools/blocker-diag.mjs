import { launch } from '../src/copilot-driver.mjs'
const { ctx, page, authenticated } = await launch()
console.log('authed:', authenticated, 'url:', page.url())
await page.waitForTimeout(4000)
const d = await page.evaluate(() => {
  const el = document.elementFromPoint(window.innerWidth/2, window.innerHeight - 80)
  const btn = document.querySelector('[data-testid="chat-input-attach-button"]')
  const r = btn?.getBoundingClientRect()
  const atBtn = r ? document.elementFromPoint(r.x + r.width/2, r.y + r.height/2) : null
  const dsc = (e) => e ? { tag: e.tagName, cls: (typeof e.className==='string'?e.className:'').slice(0,70), z: getComputedStyle(e).zIndex, pos: getComputedStyle(e).position } : null
  return {
    dialogs: [...document.querySelectorAll('[role="dialog"],dialog')].map(e => (e.innerText||'').replace(/\s+/g,' ').trim().slice(0,150)),
    elementAtComposerArea: dsc(el),
    elementOverAttachButton: dsc(atBtn),
    attachBtnRect: r ? {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)} : null,
    bodyTail: (document.body.innerText||'').replace(/\n{2,}/g,'\n').slice(-400),
  }
})
console.log(JSON.stringify(d, null, 2))
await page.screenshot({ path: '.scratch/session/blocker.png' })
await ctx.close()
