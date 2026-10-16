// tsc does not emit the untouched .mjs modules (allowJs is off, deliberately —
// they are not being converted). Copy them next to the compiled output so the
// emitted imports of './protocol.mjs' resolve at runtime.

import fs from 'node:fs'
import path from 'node:path'

const FILES = ['protocol.mjs', 'transcript.mjs', 'copilot-driver.mjs']

fs.mkdirSync('dist', { recursive: true })
for (const f of FILES) {
  const from = path.join('src', f)
  const to = path.join('dist', f)
  fs.copyFileSync(from, to)
  console.log(`copied ${from} -> ${to}`)
}
