import { launch } from '../src/copilot-driver.mjs'
const { ctx, page } = await launch()
await page.waitForTimeout(4000)

const clicked = await page.evaluate(() => {
  const els = [...document.querySelectorAll('a,button,[role="button"],[role="option"],li,div')]
  const hit = els.find(e => {
    const t = (e.innerText||'').trim()
    return t.startsWith('# System instructions') && t.length < 120 && e.getBoundingClientRect().width > 0
  })
  if (!hit) return null
  hit.click()
  return { tag: hit.tagName, text: (hit.innerText||'').slice(0,60) }
})
console.log('clicked:', JSON.stringify(clicked))
await page.waitForTimeout(6000)

const s = await page.evaluate(() => {
  const vis = (e) => { const r=e.getBoundingClientRect(); return r.width>0&&r.height>0 }
  const body = document.body.innerText || ''
  const idx = body.lastIndexOf('Copilot said:')
  return {
    url: location.href,
    hasMarker: idx !== -1,
    lastTurnLen: idx === -1 ? 0 : body.slice(idx+13).trim().length,
    copies: [...document.querySelectorAll('[data-testid="CopyButtonTestId"]')].filter(vis).length,
    generating: /Generating response|Digging in|Thinking|Searching the web/i.test(body),
    quota: /daily chat limit|check back tomorrow/i.test(body),
    tail: body.replace(/\n{2,}/g,'\n').slice(-900),
  }
})
console.log(JSON.stringify(s,null,2))
await page.screenshot({ path: '.scratch/session/opened-chat.png' })
await ctx.close()
