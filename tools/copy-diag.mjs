// Which clipboard path does Copilot's copy button actually use?
import { launch, SELECTORS, injectAndSend, waitForComplete, responseCount } from '../src/copilot-driver.mjs'

const { ctx, page, authenticated } = await launch()
if (!authenticated) { console.log('not authed'); process.exit(2) }

const baseline = await responseCount(page)
console.log('baseline copy buttons:', baseline)
await injectAndSend(page, 'Reply with only the word: pong')
const done = await waitForComplete(page, baseline, { timeoutMs: 90000 })
console.log('complete:', JSON.stringify(done))

const state = await page.evaluate(() => ({
  copyBtns: document.querySelectorAll('[data-testid="CopyButtonTestId"]').length,
  quota: /daily chat limit|check back tomorrow/i.test(document.body.innerText||''),
  tail: (document.body.innerText||'').replace(/\n{2,}/g,'\n').slice(-400),
}))
console.log('page state:', JSON.stringify(state, null, 2))

const copies = page.locator(SELECTORS.copyResponse).filter({ visible: true })
const n = await copies.count()
console.log('visible copy controls:', n)
if (n > 0) {
  await page.evaluate(() => { window.__shimClipboard = null; window.__shimClipboardPath = null })
  await copies.nth(n-1).click()
  await page.waitForTimeout(2000)
  const cap = await page.evaluate(() => ({ text: window.__shimClipboard, path: window.__shimClipboardPath }))
  console.log('CAPTURED:', JSON.stringify(cap))
}
await ctx.close()
