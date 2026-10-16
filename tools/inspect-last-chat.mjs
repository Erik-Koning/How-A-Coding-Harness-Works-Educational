// Open the most recent conversation and evaluate the completion predicate
// against a REAL completed reply. No sending — no quota cost.
import { launch, SELECTORS } from '../src/copilot-driver.mjs'
const { ctx, page, authenticated } = await launch()
if (!authenticated) { console.log('not authed'); process.exit(2) }
await page.waitForTimeout(4000)

// click the first chat in the sidebar (most recent)
const items = page.locator('[data-testid*="chat"], nav a, [role="listitem"]')
console.log('sidebar candidates:', await items.count())
const firstChat = page.getByText(/# System instructions You are opencode/i).first()
if (await firstChat.count() > 0) { await firstChat.click(); await page.waitForTimeout(5000); console.log('opened the CONTEXT.md chat') }
else console.log('could not find that chat in the sidebar')
await page.waitForTimeout(3000)

const s = await page.evaluate(() => {
  const vis = (e) => { const r=e.getBoundingClientRect(); return r.width>0&&r.height>0 }
  const body = document.body.innerText || ''
  const idx = body.lastIndexOf('Copilot said:')
  return {
    url: location.href,
    hasCopilotSaidMarker: idx !== -1,
    lastTurnLen: idx === -1 ? 0 : body.slice(idx + 'Copilot said:'.length).trim().length,
    copies: [...document.querySelectorAll('[data-testid="CopyButtonTestId"]')].filter(vis).length,
    stops: [...document.querySelectorAll('[aria-label*="Stop" i],[aria-label*="Cancel generat" i]')].filter(vis).length,
    generating: /Generating response|Digging in|Thinking|Searching the web/i.test(body),
    quota: /daily chat limit|check back tomorrow/i.test(body),
    tail: body.replace(/\n{2,}/g,'\n').slice(-700),
  }
})
console.log(JSON.stringify(s, null, 2))
await page.screenshot({ path: '.scratch/session/last-chat.png' })
await ctx.close()
