// The user's direction: content that exceeds the composer's capacity should go
// in as a FILE UPLOAD rather than as composer text. Find the affordance.
// Inspecting and attaching costs no quota — only sending does.
import { launch } from '../src/copilot-driver.mjs'
import fs from 'node:fs'

const { ctx, page, authenticated } = await launch()
if (!authenticated) { console.log('not authenticated'); process.exit(2) }

const survey = await page.evaluate(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const desc = (e) => ({
    tag: e.tagName.toLowerCase(),
    aria: e.getAttribute('aria-label') || '',
    testid: e.getAttribute('data-testid') || '',
    title: e.getAttribute('title') || '',
    text: (e.innerText || '').trim().slice(0, 40),
    type: e.getAttribute('type') || '',
    accept: e.getAttribute('accept') || '',
    multiple: e.hasAttribute('multiple'),
    hidden: !vis(e),
  })
  return {
    fileInputs: [...document.querySelectorAll('input[type="file"]')].map(desc),
    allButtons: [...document.querySelectorAll('button,[role="button"]')].filter(vis).map(desc),
  }
})

console.log('=== file inputs ===')
console.log(JSON.stringify(survey.fileInputs, null, 2))
console.log('\n=== all visible buttons ===')
survey.allButtons.forEach(b => console.log(' ', JSON.stringify(b)))
fs.writeFileSync('.scratch/session/upload-survey.json', JSON.stringify(survey, null, 2))
await ctx.close()
