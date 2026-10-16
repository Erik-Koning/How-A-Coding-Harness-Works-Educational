// Ticket 08, decisive experiment: when Copilot emits a REAL fenced code block
// (a <pre>), is extraction byte-faithful?
//
// The first probe showed whitespace collapsing — but that reply rendered the
// fence INLINE, so collapsing is expected there. A real <pre> has
// `white-space: pre`, so innerText should preserve. textContent always does.
//
// Compares five extraction paths against each other on two prompts.

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const PROFILE_DIR = path.resolve('.scratch/browser-profile')
const OUT_DIR = path.resolve('.scratch/session')
const COMPOSER = '#m365-chat-editor-target-element'
const t0 = Date.now()
const log = (...m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(2)}s]`, ...m)

const PROMPTS = [
  {
    id: 'A-natural-codeblock',
    text: 'Write a Python function that reverses a string. Reply with ONLY a fenced code block, no prose before or after.',
  },
  {
    id: 'B-protocol-json',
    text:
      'Reply with ONLY a fenced json code block containing exactly this object, formatted across multiple lines:\n' +
      '{"tool":"write","args":{"filePath":"/tmp/x.txt","content":"line one\\nline two\\n    indented four\\n"}}\n' +
      'Keep the backslash-n sequences as literal two-character escapes inside the JSON string. Do not add commentary.',
  },
]

function extractAll() {
  const out = { pres: [], copyButtons: [], lastTurnInnerText: null }

  const pres = [...document.querySelectorAll('pre')]
  out.pres = pres.map((p) => {
    const code = p.querySelector('code')
    return {
      preInnerText: p.innerText,
      preTextContent: p.textContent,
      codeTextContent: code ? code.textContent : null,
      whiteSpaceStyle: getComputedStyle(p).whiteSpace,
      cls: (typeof p.className === 'string' ? p.className : '').slice(0, 80),
    }
  })

  out.copyButtons = [...document.querySelectorAll('button,[role="button"]')]
    .filter((b) => {
      const r = b.getBoundingClientRect()
      if (!(r.width > 0 && r.height > 0)) return false
      return /copy/i.test(`${b.getAttribute('aria-label') || ''} ${b.getAttribute('data-testid') || ''} ${b.innerText || ''}`)
    })
    .map((b) => ({
      aria: b.getAttribute('aria-label') || '',
      testid: b.getAttribute('data-testid') || '',
      text: (b.innerText || '').trim().slice(0, 30),
    }))

  return out
}

function signals() {
  const vis = (e) => {
    const r = e.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const btns = [...document.querySelectorAll('button,[role="button"]')].filter(vis)
  const hay = (b) => `${b.getAttribute('aria-label') || ''} ${b.innerText || ''}`.toLowerCase()
  return {
    bodyLen: (document.body.innerText || '').length,
    hasStop: btns.some((b) => /stop|cancel generat/.test(hay(b))),
  }
}

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 1440, height: 960 },
  args: ['--disable-blink-features=AutomationControlled'],
})
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], {
  origin: 'https://m365.cloud.microsoft',
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
await page.goto('https://m365.cloud.microsoft/chat', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForSelector(COMPOSER, { timeout: 60000 })
log('ready:', page.url())

const results = {}

for (const p of PROMPTS) {
  log(`--- prompt ${p.id} ---`)
  await page.locator(COMPOSER).click()
  await page.locator(COMPOSER).fill(p.text)
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Send', exact: false }).first().click()

  // wait for completion: body text quiescent 3s and no stop button
  let stable = null
  let prev = -1
  for (let i = 0; i < 400; i++) {
    const s = await page.evaluate(signals)
    if (s.bodyLen !== prev) {
      prev = s.bodyLen
      stable = null
    } else if (stable === null) stable = Date.now()
    if (stable && Date.now() - stable > 3000 && !s.hasStop && i > 8) break
    await page.waitForTimeout(250)
  }
  log('  response complete')
  await page.waitForTimeout(1000)

  const ex = await page.evaluate(extractAll)
  log(`  <pre> blocks: ${ex.pres.length}, copy buttons: ${ex.copyButtons.length}`)
  ex.copyButtons.forEach((b) => log('    copy:', JSON.stringify(b)))

  // try every copy button, capture what each yields
  const clips = []
  for (let i = 0; i < ex.copyButtons.length; i++) {
    try {
      const loc = page.locator('button[aria-label*="Copy" i], [role="button"][aria-label*="Copy" i]').nth(i)
      await loc.click({ timeout: 5000 })
      await page.waitForTimeout(700)
      const txt = await page.evaluate(() => navigator.clipboard.readText())
      clips.push({ index: i, aria: ex.copyButtons[i].aria, length: txt.length, text: txt })
      log(`    clip[${i}] "${ex.copyButtons[i].aria}" -> ${txt.length} chars, ${(txt.match(/\n/g) || []).length} newlines`)
    } catch (e) {
      clips.push({ index: i, error: String(e).slice(0, 150) })
    }
  }

  results[p.id] = { prompt: p.text, pres: ex.pres, copyButtons: ex.copyButtons, clips }
}

fs.writeFileSync(path.join(OUT_DIR, 'extraction-comparison.json'), JSON.stringify(results, null, 2))
log('wrote extraction-comparison.json')
await ctx.close()
log('closed')
