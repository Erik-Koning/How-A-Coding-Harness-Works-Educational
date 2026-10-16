// Startup configuration. Read once from the environment, frozen, never mutated.
//
// The transport default is deliberately conservative: manual unless someone has
// explicitly and correctly asked for automation. Nothing else on the machine may
// influence it — not an installed Playwright, not a PLAYWRIGHT_* variable, not a
// previous session.

export type TransportMode = 'manual' | 'playwright'

export interface ShimConfig {
  readonly transport: TransportMode
  readonly port: number
  readonly manual: {
    readonly port: number
    readonly autoOpenBrowser: boolean
  }
}

export interface ResolvedTransport {
  readonly mode: TransportMode
  /** Set when the raw value was present but not understood, so startup can say so. */
  readonly fellBackFrom?: string
}

/** Exported for tests: the pure part, with no process/env/global reads. */
export function resolveTransport(raw: string | undefined): ResolvedTransport {
  const value = (raw ?? '').trim().toLowerCase()
  if (value === 'playwright') return { mode: 'playwright' }
  if (value === 'manual' || value === '') return { mode: 'manual' }
  return { mode: 'manual', fellBackFrom: raw as string }
}

function intFromEnv(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt((raw ?? '').trim(), 10)
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : fallback
}

function boolFromEnv(raw: string | undefined, fallback: boolean): boolean {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === '1' || v === 'true' || v === 'yes') return true
  if (v === '0' || v === 'false' || v === 'no') return false
  return fallback
}

const BOLD_RED = '\x1b[1;31m'
const RESET = '\x1b[0m'

const PLAYWRIGHT_WARNING_LINES = [
  '',
  '  ============================================================================',
  '  WARNING: AUTOMATED BROWSER ACCESS TO M365 COPILOT IS ENABLED',
  '  ============================================================================',
  '  The shim will drive the Copilot web UI with Playwright on your behalf.',
  '  Automating that page may violate Microsoft\'s terms of service and your',
  '  organisation\'s policies, and could get your account restricted.',
  '',
  '  DO NOT use this mode unless you have confirmed it is permitted for your',
  '  account and tenant. That is your responsibility as the operator.',
  '',
  '  To go back to the default manual transport: unset COPILOT_TRANSPORT',
  '  ============================================================================',
  '',
]

/** Exported for tests. Each line is wrapped on its own so no terminal drops the colour at a newline. */
export const PLAYWRIGHT_WARNING = PLAYWRIGHT_WARNING_LINES.map((l) => (l ? BOLD_RED + l + RESET : l)).join('\n')

export interface LoadOptions {
  env?: NodeJS.ProcessEnv
  /** Injected so tests can assert on what was logged without capturing stdio. */
  log?: (message: string) => void
  warn?: (message: string) => void
}

export function loadConfig(options: LoadOptions = {}): ShimConfig {
  const env = options.env ?? process.env
  const log = options.log ?? ((m: string) => console.log(m))
  const warn = options.warn ?? ((m: string) => process.stderr.write(m + '\n'))

  const resolved = resolveTransport(env.COPILOT_TRANSPORT)

  if (resolved.fellBackFrom !== undefined) {
    log(`COPILOT_TRANSPORT="${resolved.fellBackFrom}" is not recognised — falling back to manual`)
  }

  log(
    resolved.mode === 'manual'
      ? 'transport: manual (human-in-the-loop)'
      : 'transport: playwright (automated)',
  )

  if (resolved.mode === 'playwright') {
    // Deliberately unsuppressable, and bold red so it cannot be scrolled past
    // as ordinary startup noise. Choosing this mode means automating a
    // Microsoft product page, and that choice should never be silent.
    warn(PLAYWRIGHT_WARNING)
  }

  return Object.freeze({
    transport: resolved.mode,
    port: intFromEnv(env.COPILOT_SHIM_PORT, 8787),
    manual: Object.freeze({
      port: intFromEnv(env.COPILOT_PANEL_PORT, 8788),
      autoOpenBrowser: boolFromEnv(env.COPILOT_PANEL_OPEN, true),
    }),
  })
}
