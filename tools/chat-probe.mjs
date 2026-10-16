// Tickets 07 / 08 / 09: the three browser mechanics, probed together because
// they can only be measured on a live response.
//
//   node tools/chat-probe.mjs
//
// Assumes .scratch/browser-profile is already authenticated (see session-probe).
// Sends one adversarial message, records a high-resolution signal timeline while
// the answer streams, then tries every extraction path and diffs them.
//
// Raw data lands in .scratch/session/ for offline analysis. This script decides
// nothing; it measures.

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const PROFILE_DIR = path.resolve('.scratch/browser-profile')
const OUT_DIR = path.resolve('.scratch/session')
const TARGET = 'https://m365.cloud.microsoft/chat'
const COMPOSER = '#m365-chat-editor-target-element'

fs.mkdirSync(OUT_DIR, { recursive: true })
const t0 = Date.now()
const el = () => ((Date.now() - t0) / 1000).toFixed(2)
const log = (...m) => console.log(`[${el()}s]`, ...m)

// The payload deliberately contains everything that breaks naive extraction:
// a fenced block, JSON with escaped quotes, backticks, blank lines, indentation.
const PAYLOAD = [
  'Reply with EXACTLY the following block and nothing else — no preamble, no explanation:',
  '',
  '```json',
  '{',
  '  "tool": "bash",',
  '  "args": { "command": "echo \\"hello   world\\" && ls -la | grep \'x\'" },',
  '  "note": "backtick ` and tab\\tand trailing spaces   ",',
  '',
  '  "empty_line_above": true',
  '}',
  '```',
].join('\n')

// ---------------------------------------------------------------- in-page

function collectSignals() {
  const vis = (e) => {
    const r = e.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const btns = [...document.querySelectorAll('button,[role="button"]')].filter(vis).map((b) => ({
    aria: b.getAttribute('aria-label') || '',
    testid: b.getAttribute('data-testid') || '',
    text: (b.innerText || '').trim().slice(0, 30),
    disabled: b.disabled === true || b.getAttribute('aria-disabled') === 'true',
  }))
  const hay = (b) => `${b.aria} ${b.testid} ${b.text}`.toLowerCase()
  return {
    bodyLen: (document.body.innerText || '').length,
    buttonCount: btns.length,
    hasStop: btns.some((b) => /stop|cancel generat/.test(hay(b))),
    hasSend: btns.some((b) => /send/.test(hay(b))),
    hasCopy: btns.some((b) => /copy/.test(hay(b))),
    busy: !!document.querySelector('[aria-busy="true"]'),
    liveRegions: [...document.querySelectorAll('[aria-live]')]
      .filter(vis)
      .map((e) => (e.innerText || '').trim().slice(0, 60))
      .filter(Boolean),
    allButtons: btns,
  }
}

// ------------------------------------------------------------------- main

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 1440, height: 960 },
  args: ['--disable-blink-features=AutomationControlled'],
})
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], {
  origin: 'https://m365.cloud.microsoft',
})

const page = ctx.pages()[0] ?? (await ctx.newPage())
await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 })
log('navigated:', page.url())

await page.waitForSelector(COMPOSER, { timeout: 60000 })
log('composer present')

if (/login\.microsoftonline/.test(page.url())) {
  log('!! SESSION EXPIRED — re-run session-probe.mjs and sign in again')
  process.exit(2)
}

const before = await page.evaluate(collectSignals)
fs.writeFileSync(path.join(OUT_DIR, 'buttons-before-typing.json'), JSON.stringify(before, null, 2))
log(`baseline: ${before.buttonCount} buttons, hasSend=${before.hasSend}`)

// --------------------------------------------------- ticket 09: injection

const injection = {}
log('injection method A: locator.fill()')
try {
  await page.locator(COMPOSER).click()
  await page.locator(COMPOSER).fill(PAYLOAD)
  const got = await page.locator(COMPOSER).innerText()
  injection.fill = { ok: got.includes('"tool": "bash"'), gotLen: got.length, wantLen: PAYLOAD.length }
} catch (e) {
  injection.fill = { ok: false, error: String(e).slice(0, 200) }
}
log('  fill():', JSON.stringify(injection.fill))

// Clear, then try the clipboard-paste route (atomic, no per-keystroke handlers).
try {
  await page.locator(COMPOSER).click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('Backspace')
  await page.evaluate(async (text) => navigator.clipboard.writeText(text), PAYLOAD)
  await page.locator(COMPOSER).click()
  await page.keyboard.press('ControlOrMeta+V')
  await page.waitForTimeout(600)
  const got = await page.locator(COMPOSER).innerText()
  injection.paste = { ok: got.includes('"tool": "bash"'), gotLen: got.length, wantLen: PAYLOAD.length }
} catch (e) {
  injection.paste = { ok: false, error: String(e).slice(0, 200) }
}
log('  paste  :', JSON.stringify(injection.paste))

fs.writeFileSync(path.join(OUT_DIR, 'injection-results.json'), JSON.stringify(injection, null, 2))

const afterTyping = await page.evaluate(collectSignals)
fs.writeFileSync(path.join(OUT_DIR, 'buttons-after-typing.json'), JSON.stringify(afterTyping, null, 2))
log(`after typing: ${afterTyping.buttonCount} buttons, hasSend=${afterTyping.hasSend}`)
const sendBtn = afterTyping.allButtons.find((b) => /send/i.test(`${b.aria} ${b.testid} ${b.text}`))
log('  send button:', JSON.stringify(sendBtn))

// ------------------------------------------- ticket 07: completion timeline

log('sending…')
const sendAt = Date.now()
if (sendBtn?.aria) await page.getByRole('button', { name: sendBtn.aria, exact: false }).first().click()
else await page.keyboard.press('Enter')

const timeline = []
let stableSince = null
let doneAt = null

for (let i = 0; i < 480; i++) {
  // up to ~2 min at 250ms
  let s
  try {
    s = await page.evaluate(collectSignals)
  } catch {
    await page.waitForTimeout(250)
    continue
  }
  const prev = timeline[timeline.length - 1]
  const row = {
    t: Number(((Date.now() - sendAt) / 1000).toFixed(2)),
    bodyLen: s.bodyLen,
    hasStop: s.hasStop,
    hasSend: s.hasSend,
    hasCopy: s.hasCopy,
    busy: s.busy,
    live: s.liveRegions.slice(0, 2),
  }
  timeline.push(row)

  const grew = !prev || prev.bodyLen !== row.bodyLen
  if (grew) stableSince = null
  else if (stableSince === null) stableSince = Date.now()

  // candidate predicate: text quiescent 2.5s AND no stop button visible
  if (stableSince && Date.now() - stableSince > 2500 && !row.hasStop && i > 8) {
    doneAt = row.t
    log(`completion predicate fired at t+${row.t}s`)
    break
  }
  await page.waitForTimeout(250)
}

fs.writeFileSync(path.join(OUT_DIR, 'completion-timeline.json'), JSON.stringify(timeline, null, 2))
log(`timeline: ${timeline.length} samples, done=${doneAt}`)

// ------------------------------------------- ticket 08: extraction fidelity

const extraction = {}

extraction.bodyTail = await page.evaluate(() => (document.body.innerText || '').slice(-3000))

// copy-button path: click the last visible copy control, then read the clipboard
try {
  const copies = page.locator('button[aria-label*="Copy" i], [role="button"][aria-label*="Copy" i]')
  const n = await copies.count()
  log(`copy controls found: ${n}`)
  if (n > 0) {
    await copies.last().click()
    await page.waitForTimeout(800)
    extraction.clipboard = await page.evaluate(() => navigator.clipboard.readText())
    extraction.copyButtonUsed = true
  } else {
    extraction.copyButtonUsed = false
  }
} catch (e) {
  extraction.clipboardError = String(e).slice(0, 300)
}

fs.writeFileSync(path.join(OUT_DIR, 'extraction-results.json'), JSON.stringify(extraction, null, 2))
log('clipboard length:', extraction.clipboard?.length ?? 'n/a')
if (extraction.clipboard) {
  fs.writeFileSync(path.join(OUT_DIR, 'clipboard-raw.txt'), extraction.clipboard)
  log('--- clipboard content ---')
  console.log(extraction.clipboard)
}

await page.screenshot({ path: path.join(OUT_DIR, 'after-response.png') })
fs.writeFileSync(path.join(OUT_DIR, 'body-tail.txt'), extraction.bodyTail)
log('done — leaving browser open')
await page.waitForTimeout(600000)
