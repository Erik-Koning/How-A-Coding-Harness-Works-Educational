// Ticket 05: establish and characterise an authenticated M365 Copilot session.
//
//   node tools/session-probe.mjs
//
// Launches a headed Chromium against a DEDICATED persistent profile (not your
// daily Chrome — avoids the profile lock), navigates to Copilot, then polls and
// logs what it sees. Log in by hand in the window it opens; the probe notices
// when the chat surface appears and dumps a selector report for tickets 07/08/09.
//
// Everything it learns goes to .scratch/session/observations.jsonl and
// .scratch/session/selectors.json.

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const PROFILE_DIR = path.resolve('.scratch/browser-profile')
const OUT_DIR = path.resolve('.scratch/session')
const TARGET = 'https://m365.cloud.microsoft/chat'

fs.mkdirSync(PROFILE_DIR, { recursive: true })
fs.mkdirSync(OUT_DIR, { recursive: true })

const obsFile = path.join(OUT_DIR, 'observations.jsonl')
const t0 = Date.now()
const el = () => ((Date.now() - t0) / 1000).toFixed(1)

function note(event, data = {}) {
  const line = { t: Number(el()), event, ...data }
  fs.appendFileSync(obsFile, JSON.stringify(line) + '\n')
  console.log(`[${el()}s] ${event}`, Object.keys(data).length ? JSON.stringify(data).slice(0, 400) : '')
}

// Runs in the page. Deliberately generic — we do not yet know Copilot's DOM,
// so we enumerate every plausible affordance rather than guessing selectors.
function surveyPage() {
  const vis = (e) => {
    const r = e.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const desc = (e) => ({
    tag: e.tagName.toLowerCase(),
    id: e.id || undefined,
    testid: e.getAttribute('data-testid') || e.getAttribute('data-test-id') || undefined,
    aria: e.getAttribute('aria-label') || undefined,
    placeholder: e.getAttribute('placeholder') || undefined,
    role: e.getAttribute('role') || undefined,
    title: e.getAttribute('title') || undefined,
    cls: (e.className && typeof e.className === 'string' ? e.className : '').slice(0, 90) || undefined,
    text: (e.innerText || '').trim().slice(0, 60) || undefined,
  })

  const inputs = [...document.querySelectorAll('textarea,[contenteditable="true"],input[type="text"]')]
    .filter(vis)
    .map(desc)
  const buttons = [...document.querySelectorAll('button,[role="button"]')].filter(vis).map(desc)
  const passwords = [...document.querySelectorAll('input[type="password"]')].filter(vis).map(desc)

  return {
    url: location.href,
    title: document.title,
    inputs,
    passwordFields: passwords,
    buttonCount: buttons.length,
    // only the buttons likely to matter, to keep the log readable
    buttons: buttons
      .filter((b) => {
        const s = `${b.aria || ''} ${b.text || ''} ${b.testid || ''} ${b.title || ''}`.toLowerCase()
        return /send|submit|copy|stop|regenerate|new chat|sign in|next|continue|yes|accept/.test(s)
      })
      .slice(0, 40),
    bodyTextHead: (document.body.innerText || '').trim().slice(0, 300),
  }
}

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 1440, height: 960 },
  args: ['--disable-blink-features=AutomationControlled'],
})

// Clipboard access is needed by the extraction ticket (copy-button path).
try {
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'https://m365.cloud.microsoft',
  })
  note('clipboard-permissions-granted')
} catch (e) {
  note('clipboard-permissions-failed', { error: String(e).slice(0, 200) })
}

const page = ctx.pages()[0] ?? (await ctx.newPage())

note('launching', { profile: PROFILE_DIR, target: TARGET })
try {
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 })
} catch (e) {
  note('goto-failed', { error: String(e).slice(0, 300) })
}

let lastSignature = ''
let dumped = false

for (let i = 0; i < 600; i++) {
  // ~30 min of polling
  let s
  try {
    s = await page.evaluate(surveyPage)
  } catch (e) {
    note('survey-failed', { error: String(e).slice(0, 200) })
    await page.waitForTimeout(3000)
    continue
  }

  const looksLikeLogin =
    s.passwordFields.length > 0 || /login\.microsoftonline|login\.live/.test(s.url)
  const composer = s.inputs.find((inp) =>
    /ask|message|chat|prompt|copilot/i.test(`${inp.aria || ''} ${inp.placeholder || ''} ${inp.testid || ''}`),
  )

  const signature = `${s.url}|${looksLikeLogin}|${!!composer}|${s.inputs.length}`
  if (signature !== lastSignature) {
    lastSignature = signature
    note('state-change', {
      url: s.url,
      title: s.title,
      looksLikeLogin,
      hasComposer: !!composer,
      composer,
      inputCount: s.inputs.length,
      bodyTextHead: s.bodyTextHead,
    })
    if (looksLikeLogin) note('ACTION-REQUIRED: sign in by hand in the open window')
  }

  if (composer && !dumped) {
    dumped = true
    note('CHAT-SURFACE-REACHED — dumping full selector report')
    fs.writeFileSync(path.join(OUT_DIR, 'selectors.json'), JSON.stringify(s, null, 2))
    await page.screenshot({ path: path.join(OUT_DIR, 'chat-surface.png'), fullPage: false })
    note('wrote selectors.json + chat-surface.png')
  }

  await page.waitForTimeout(3000)
}

note('probe-window-elapsed — leaving browser open')
