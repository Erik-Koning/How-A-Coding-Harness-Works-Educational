// The single place a transport is chosen. Nothing else in the shim branches on
// the mode.

import type { ShimConfig } from '../config.js'
import type { CopilotTransport } from './types.js'
import { TransportUnavailableError } from './types.js'
import { ManualTransport } from './manual.js'

export const INSTALL_HINT =
  'COPILOT_TRANSPORT=playwright was requested, but the playwright package is not available.\n' +
  '\n' +
  '  To use the automated transport:\n' +
  '      npm install playwright && npx playwright install chromium\n' +
  '\n' +
  '  To use the default human-in-the-loop transport instead:\n' +
  '      unset COPILOT_TRANSPORT\n'

/**
 * Turn an import failure into either advice or a genuine error.
 *
 * Exported so the missing-dependency path is testable without uninstalling the
 * package: a missing OPTIONAL dependency is a configuration problem and must
 * read as instructions, while anything else is a real fault and must not be
 * disguised as one.
 */
export function mapImportFailure(e: unknown): Error {
  const err = e as { code?: string; message?: string }
  const missing =
    err?.code === 'ERR_MODULE_NOT_FOUND' ||
    err?.code === 'MODULE_NOT_FOUND' ||
    /Cannot find (package|module)/i.test(String(err?.message ?? ''))
  return missing ? new TransportUnavailableError(INSTALL_HINT) : (e as Error)
}

export async function createTransport(config: ShimConfig): Promise<CopilotTransport> {
  if (config.transport === 'playwright') {
    let mod: typeof import('./playwright.js')
    try {
      // Dynamic on purpose. copilot-driver.mjs imports `playwright` at module
      // top level, so this import is the only thing that pulls the library in —
      // which is what lets manual mode run on a machine with no browsers.
      mod = await import('./playwright.js')
    } catch (e) {
      throw mapImportFailure(e)
    }
    return new mod.PlaywrightTransport(config)
  }

  return new ManualTransport(config)
}
