import { launch, SELECTORS } from '../src/copilot-driver.mjs'
const { ctx, page, authenticated } = await launch()
console.log('authenticated:', authenticated)
const s = await page.evaluate(() => ({
  url: location.href,
  composer: !!document.querySelector('#m365-chat-editor-target-element'),
  copyBtns: document.querySelectorAll('[data-testid="CopyButtonTestId"]').length,
  quotaText: /daily chat limit|check back tomorrow/i.test(document.body.innerText || ''),
  tail: (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(-700),
}))
console.log(JSON.stringify(s, null, 2))
await ctx.close()
