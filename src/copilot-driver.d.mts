// Declarations for the untouched JavaScript driver. Only the surface the
// transport actually uses is typed; the module itself is deliberately not
// converted (it is being isolated, not improved).

export interface CopilotLocator {
  count(): Promise<number>
  first(): CopilotLocator
  nth(i: number): CopilotLocator
  click(opts?: { timeout?: number }): Promise<void>
  innerText(): Promise<string>
  filter(opts: { visible?: boolean }): CopilotLocator
}

export interface CopilotPage {
  isClosed(): boolean
  url(): string
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>
  waitForSelector(sel: string, opts?: { timeout?: number }): Promise<unknown>
  waitForLoadState(state?: string): Promise<void>
  waitForTimeout(ms: number): Promise<void>
  bringToFront(): Promise<void>
  locator(sel: string): CopilotLocator
  evaluate<T = unknown>(fn: (...args: any[]) => T, arg?: any): Promise<T>
  screenshot(opts: { path: string }): Promise<unknown>
}

export interface BrowserHandle {
  ctx: { close(): Promise<void> }
  page: CopilotPage
  authenticated: boolean
  reason?: string
}

export declare const SELECTORS: Record<string, string>
export declare const COMPOSER_LIMIT: number

export declare class QuotaExhausted extends Error {}

export declare function launch(opts?: {
  profileDir?: string
  headless?: boolean
}): Promise<BrowserHandle>

export declare function ask(
  page: CopilotPage,
  text: string,
  opts?: { timeoutMs?: number; stableMs?: number },
): Promise<string>

export declare function selectMode(
  page: CopilotPage,
  mode?: string,
): Promise<{ ok: boolean; mode?: string; reason?: string }>

export declare function checkQuota(page: CopilotPage): Promise<void>
