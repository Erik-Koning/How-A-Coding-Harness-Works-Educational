// Serves the operator panel and carries turn events to it.
//
// Loopback only, always. This process holds the contents of the user's source
// files and Copilot's replies; it must not be reachable from the network.
//
// Server -> panel is SSE; panel -> server is POST. That needs no dependency
// beyond node:http, and the shim already speaks SSE correctly elsewhere.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec } from 'node:child_process'
import type { ShimConfig } from '../config.js'
import type { TurnStore, PanelSnapshot } from './turn-store.js'
import { ProjectionLostError } from '../transport/types.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** dist/manual/ -> repo root -> panel/dist */
const PANEL_DIST = path.resolve(HERE, '..', '..', 'panel', 'dist')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
}

/** How long after launching a panel to assume one is on its way, so turns
 *  arriving during browser startup do not each open another window. */
const LAUNCH_GRACE_MS = 15000

export class PanelServer {
  private server: http.Server | null = null
  private clients = new Set<http.ServerResponse>()
  private lastLaunchAt = 0

  constructor(
    private readonly config: ShimConfig,
    private readonly store: TurnStore,
    /** Injected so tests can count launches without spawning a browser. */
    private readonly opener: (cmd: string) => void = (cmd) => {
      exec(cmd, () => {})
    },
  ) {}

  get url(): string {
    return `http://127.0.0.1:${this.config.manual.port}`
  }

  async start(): Promise<void> {
    if (!fs.existsSync(path.join(PANEL_DIST, 'index.html'))) {
      throw new Error(
        `The operator panel has not been built.\n` +
          `Expected: ${path.join(PANEL_DIST, 'index.html')}\n` +
          `Run \`npm run build:panel\` and start the shim again.`,
      )
    }

    this.store.on('changed', (snapshot: PanelSnapshot) => this.broadcast(snapshot))

    this.server = http.createServer((req, res) => this.handle(req, res))

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      // 127.0.0.1 explicitly, never 0.0.0.0 and never the default (which would
      // listen on every interface).
      this.server!.listen(this.config.manual.port, '127.0.0.1', () => resolve())
    })

    console.log(`[manual] panel on ${this.url}`)
  }

  async stop(): Promise<void> {
    for (const c of this.clients) c.end()
    this.clients.clear()
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve()
      this.server.close(() => resolve())
    })
    this.server = null
  }

  /** How many panels are currently connected via SSE. */
  get connectedClients(): number {
    return this.clients.size
  }

  /**
   * Open the panel, but ONLY if one is not already open.
   *
   * `open <url>` on macOS (and `xdg-open` on Linux) spawns a NEW TAB every
   * time — it does not focus an existing tab for the same URL. Calling it per
   * turn therefore produced a new window per turn.
   *
   * A live SSE connection is proof that a panel is already showing this turn,
   * so the correct behaviour is to do nothing: the open panel updates itself
   * and marks its own tab title. We only launch when nothing is listening.
   */
  raise(): void {
    if (this.clients.size > 0) return

    // A browser takes seconds to start and connect its SSE stream. Without this
    // grace window, turns arriving during the launch would each see zero
    // clients and open yet another window — the same bug in a narrower form.
    if (Date.now() - this.lastLaunchAt < LAUNCH_GRACE_MS) return
    this.lastLaunchAt = Date.now()

    const cmd =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open'
    console.log('[manual] no panel connected — opening one')
    this.opener(`${cmd} ${this.url}`)
  }

  private broadcast(snapshot: PanelSnapshot): void {
    const payload = `data: ${JSON.stringify(snapshot)}\n\n`
    for (const c of this.clients) c.write(payload)
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url)

    if (url.pathname === '/events') return this.handleEvents(req, res)
    if (url.pathname.startsWith('/api/')) return this.handleApi(url.pathname, req, res)
    return this.handleStatic(url.pathname, res)
  }

  private handleEvents(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    this.clients.add(res)
    res.write(`data: ${JSON.stringify(this.store.snapshot())}\n\n`)
    // keep the stream alive through proxies and idle periods
    const beat = setInterval(() => res.write(': keepalive\n\n'), 15000)
    req.on('close', () => {
      clearInterval(beat)
      this.clients.delete(res)
    })
  }

  private async handleApi(
    pathname: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (req.method !== 'POST') {
      res.writeHead(405).end('{"error":"method not allowed"}')
      return
    }

    let raw = ''
    req.on('data', (c) => (raw += c))
    await new Promise<void>((resolve) => req.on('end', () => resolve()))

    let body: { id?: string; text?: string }
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"error":"bad json"}')
      return
    }

    const id = String(body.id ?? '')
    const ok = (): void => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, snapshot: this.store.snapshot() }))
    }

    switch (pathname) {
      // Every one of these is a discrete human action in the panel. There is no
      // endpoint that advances a turn without one.
      case '/api/copied':
        this.store.markCopied(id)
        return ok()
      case '/api/review':
        this.store.review(id, String(body.text ?? ''))
        return ok()
      case '/api/edit-again':
        this.store.editAgain(id)
        return ok()
      case '/api/send':
        this.store.send(id, String(body.text ?? ''))
        return ok()
      case '/api/lost-chat':
        this.store.fail(id, new ProjectionLostError('the human reported the Copilot chat was lost'))
        return ok()
      default:
        res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"not found"}')
    }
  }

  private handleStatic(pathname: string, res: http.ServerResponse): void {
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
    const file = path.resolve(PANEL_DIST, rel)

    // never serve outside the built panel
    if (!file.startsWith(PANEL_DIST)) {
      res.writeHead(403).end('forbidden')
      return
    }

    const target = fs.existsSync(file) && fs.statSync(file).isFile()
      ? file
      : path.join(PANEL_DIST, 'index.html')

    res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream' })
    fs.createReadStream(target).pipe(res)
  }
}
