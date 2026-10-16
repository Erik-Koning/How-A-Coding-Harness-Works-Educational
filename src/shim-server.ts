// The Shim: an OpenAI-compatible endpoint that answers from a transport rather
// than an API.
//
//   node dist/shim-server.js
//
// The transport is chosen once at startup and this file never branches on which
// one it got. Everything here — the reseed/delta decision, protocol parsing, the
// repair loop, tracing, usage — is transport-agnostic.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from './config.js'
import { createTransport } from './transport/index.js'
import type { CopilotTransport, TurnRequest } from './transport/types.js'
import { AbandonedTurnError, ProjectionLostError, TransportUnavailableError } from './transport/types.js'
import { SessionStore } from './transcript.mjs'
import type { Session, TurnPlan } from './transcript.mjs'
import type { OpencodeMessage, ToolSpec } from './protocol.mjs'
import {
  renderReseedParts,
  renderDelta,
  CONTINUE_NUDGE,
  parseReply,
  repairPrompt,
  contentToText,
  ProtocolError,
  classifyToollessRequest,
  renderTextRequest,
  renderTextRequestParts,
  parseTextReply,
} from './protocol.mjs'

const MAX_REPAIRS = 3
const LOG_DIR = '.scratch/shim-log'

const config = loadConfig()
fs.mkdirSync(LOG_DIR, { recursive: true })

let turnSeq = 0
const log = (...m: unknown[]): void =>
  console.log(`[shim ${new Date().toISOString().slice(11, 19)}]`, ...m)

/** Every Turn's outbound prose, raw reply and parse result. Without this,
 *  diagnosing a failed run means watching a browser in real time. */
function trace(name: string, data: unknown): void {
  fs.writeFileSync(
    path.join(LOG_DIR, name),
    typeof data === 'string' ? data : JSON.stringify(data, null, 2),
  )
}

// --------------------------------------------------------------- SSE output

interface ChatBody {
  model?: string
  messages: OpencodeMessage[]
  tools?: ToolSpec[]
  stream?: boolean
}

function sse(res: http.ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  const frame = (delta: unknown, finish: string | null = null): void => {
    res.write(
      `data: ${JSON.stringify({
        id: 'chatcmpl-shim',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'm365-copilot',
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`,
    )
  }
  return {
    chunk: frame,
    // SSE comment. Verified not to disturb the AI SDK parser over a 300s stall,
    // which is what makes a multi-minute manual turn safe.
    heartbeat: (): void => {
      res.write(': keepalive\n\n')
    },
    usage: (u: unknown): void => {
      res.write(
        `data: ${JSON.stringify({
          id: 'chatcmpl-shim',
          object: 'chat.completion.chunk',
          model: 'm365-copilot',
          choices: [],
          usage: u,
        })}\n\n`,
      )
    },
    done: (): void => {
      res.write('data: [DONE]\n\n')
      res.end()
    },
  }
}

type Sse = ReturnType<typeof sse>

/** opencode uses reported usage to decide when to compact. Reporting zeros would
 *  mean it NEVER compacts, so the Transcript would grow unbounded. */
function estimateUsage(messages: OpencodeMessage[] | undefined, replyText: string) {
  const chars = (messages ?? []).reduce(
    (n, m) => n + contentToText(m.content).length + JSON.stringify(m.tool_calls ?? '').length,
    0,
  )
  const prompt_tokens = Math.ceil(chars / 4)
  const completion_tokens = Math.ceil(String(replyText ?? '').length / 4)
  return { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens }
}

function emitText(out: Sse, text: string, usage?: unknown): void {
  out.chunk({ role: 'assistant', content: '' })
  for (const piece of String(text).match(/[\s\S]{1,200}/g) ?? []) out.chunk({ content: piece })
  out.chunk({}, 'stop')
  out.usage(usage ?? estimateUsage([], text))
  out.done()
}

function emitToolCall(
  out: Sse,
  name: string,
  argsObj: unknown,
  id: string,
  usage?: unknown,
): void {
  out.chunk({ role: 'assistant', content: '' })
  out.chunk({
    tool_calls: [
      { index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(argsObj ?? {}) } },
    ],
  })
  out.chunk({}, 'tool_calls')
  out.usage(usage ?? estimateUsage([], ''))
  out.done()
}

// -------------------------------------------------------------- the Turn

const sessions = new SessionStore()
let transport: CopilotTransport

/** One caller at a time reaches the transport. */
let chain: Promise<unknown> = Promise.resolve()
/** In-flight + waiting main calls, so blocking can be reported rather than felt. */
let queueDepth = 0
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn) as Promise<T>
  chain = run.catch(() => {})
  return run
}

const PURPOSE = {
  compaction:
    'opencode is compacting the conversation: it wants a summary of the work so far, which ' +
    'replaces the older messages. There are no tools on this turn, so the reply is plain text.',
  other:
    'opencode wants a written answer with no tools. This is not a step of the task, and the ' +
    'reply is plain text.',
}

interface CallerIds {
  sessionId: string
  parentSessionId?: string
}

type RequestBase = Pick<TurnRequest, 'turnIndex' | 'conversationId' | 'parentConversationId' | 'signal'>

/**
 * A request with no tools is not a step of the task (compaction, usually), so
 * it neither reads nor advances the Transcript. It goes into the conversation's
 * live chat when there is one: that chat already holds the history a compaction
 * asks about, and pasting the whole history again is exactly what compaction
 * exists to avoid.
 */
function planTextOnly(body: ChatBody, session: Session, base: RequestBase): TurnRequest {
  const kind = classifyToollessRequest(body.messages)
  const purpose = kind === 'compaction' ? PURPOSE.compaction : PURPOSE.other
  const inChat = session.projection !== null && session.sent.length > 0
  log(
    `turn ${base.turnIndex} [${base.conversationId.slice(0, 12)}] no tools (${kind}), ` +
      `${inChat ? 'same chat' : 'new chat'}`,
  )
  if (!inChat) return { ...base, purpose, ...renderTextRequestParts(body.messages) }
  return {
    ...base,
    purpose,
    query: renderTextRequest(body.messages),
    fullContext: renderTextRequestParts(body.messages),
  }
}

function planStep(body: ChatBody, session: Session, base: RequestBase): { req: TurnRequest; plan: TurnPlan } {
  const plan = session.plan(body.messages)
  log(`turn ${base.turnIndex} [${base.conversationId.slice(0, 12)}] ${plan.action}${plan.reason ? ` (${plan.reason})` : ''}`)

  if (plan.action === 'reseed') {
    const { systemPrompt, query } = renderReseedParts(body.messages, body.tools ?? [])
    session.markReseeded({ startedAt: Date.now() })
    return { plan, req: { ...base, systemPrompt, query } }
  }

  let query = renderDelta(plan.delta ?? [])
  if (!query.trim()) {
    // opencode appended only assistant messages — nothing new to say. Nudge
    // rather than send an empty payload, and say so, because this shape is
    // unexpected and worth noticing in a trace.
    log(`  delta rendered empty (roles: ${(plan.delta ?? []).map((m) => m.role).join(',')}) — nudging`)
    query = CONTINUE_NUDGE
  }
  return { plan, req: { ...base, query, fullContext: renderReseedParts(body.messages, body.tools ?? []) } }
}

async function runTurn(
  body: ChatBody,
  ids: CallerIds,
  out: Sse,
  signal: AbortSignal,
  retried = false,
): Promise<void> {
  const seq = ++turnSeq
  const stamp = String(seq).padStart(3, '0')
  const session = sessions.get(ids.sessionId)
  const base: RequestBase = {
    turnIndex: seq,
    conversationId: ids.sessionId,
    parentConversationId: ids.parentSessionId,
    signal,
  }

  const textOnly = !body.tools || body.tools.length === 0
  const { req, plan } = textOnly
    ? { req: planTextOnly(body, session, base), plan: null }
    : planStep(body, session, base)
  const parse = textOnly ? parseTextReply : parseReply

  trace(`${stamp}-outbound.txt`, [req.systemPrompt, req.query].filter(Boolean).join('\n\n'))

  let reply = ''
  let parsed
  let attempt = 0
  let current = req

  while (attempt <= MAX_REPAIRS) {
    // Heartbeat throughout. Essential in manual mode, where a turn legitimately
    // waits minutes for a human.
    const hb = setInterval(() => out.heartbeat(), 10000)
    try {
      const response = await transport.submit(current)
      reply = response.text
    } catch (e) {
      clearInterval(hb)

      // The conversation is gone. Invalidate and replan as a re-seed, once.
      if (e instanceof ProjectionLostError && !retried) {
        log(`  ${e.message} — re-seeding`)
        session.invalidate()
        return runTurn(body, ids, out, signal, true)
      }
      throw e
    }
    clearInterval(hb)

    trace(`${stamp}-reply-${attempt}.txt`, reply)

    try {
      parsed = parse(reply)
      break
    } catch (e) {
      if (!(e instanceof ProtocolError)) throw e
      if (e.kind === 'quota') {
        throw new Error(
          'Copilot daily chat limit reached. The shim cannot continue until the quota resets or the account is licensed.',
        )
      }
      attempt++
      if (attempt > MAX_REPAIRS) {
        throw new Error(`protocol not recovered after ${MAX_REPAIRS} repairs: ${e.message}`)
      }
      log(`  repair ${attempt}/${MAX_REPAIRS} (${e.kind})`)
      // A repair is just another turn: same transport, no special casing. In
      // manual mode it surfaces in the panel as the next thing to copy.
      current = { ...base, purpose: req.purpose, query: repairPrompt(e.kind) }
    }
  }

  if (plan) session.commit(plan.incoming)
  trace(`${stamp}-parsed.json`, { plan: plan?.action ?? 'no-tools', attempts: attempt, parsed })

  const usage = estimateUsage(body.messages, reply)
  if (parsed!.type === 'tool_call') {
    emitToolCall(out, parsed!.name, parsed!.arguments, `call_shim_${seq}`, usage)
  } else {
    emitText(out, parsed!.content, usage)
  }
}

// ------------------------------------------------------------------- server

async function main(): Promise<void> {
  try {
    transport = await createTransport(config)
    await transport.init()
  } catch (e) {
    if (e instanceof TransportUnavailableError) {
      process.stderr.write(`\n${e.message}\n`)
      process.exit(1)
    }
    process.stderr.write(`\n${(e as Error).message}\n`)
    process.exit(1)
  }

  http
    .createServer(async (req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      await new Promise<void>((resolve) => req.on('end', () => resolve()))

      if (!req.url?.includes('chat/completions')) {
        res.writeHead(404, { 'Content-Type': 'application/json' }).end('{}')
        return
      }

      let body: ChatBody
      try {
        body = JSON.parse(raw)
      } catch {
        res.writeHead(400).end('{"error":"bad json"}')
        return
      }

      const out = sse(res)

      // Trip when opencode goes away — quitting the TUI, Ctrl-C, a dropped
      // socket. Without this the turn waits on a human forever and wedges the
      // queue for every future session.
      const ac = new AbortController()
      res.on('close', () => {
        if (!res.writableEnded) ac.abort()
      })

      // A title is cosmetic and must never cost a transport round trip — in
      // manual mode that would mean asking a human to relay a throwaway string.
      // Other calls without tools (compaction) fall through and are relayed:
      // opencode keeps their answer in place of the conversation history.
      const toolless = !body.tools || body.tools.length === 0
      if (toolless && classifyToollessRequest(body.messages ?? []) === 'title') {
        const lastUser = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user')
        const title = contentToText(lastUser?.content ?? 'Session')
          // the task-name request puts its instruction on the first line
          .replace(/^Generate [^\n]*:\n/, '')
          .replace(/^["']|["']$/g, '')
          .split('\n')[0]
          .slice(0, 50)
        log(`side-call answered locally: "${title}"`)
        emitText(out, title || 'Session')
        return
      }

      const ids: CallerIds = {
        sessionId: (req.headers['x-session-id'] as string) ?? 'default',
        // opencode sends this for a subagent's requests (the task tool)
        parentSessionId: req.headers['x-parent-session-id'] as string | undefined,
      }

      // Surface the panel NOW, before queueing. A request that waits behind an
      // unanswered turn would otherwise produce no visible sign at all.
      transport.notifyIncoming?.()
      if (queueDepth > 0) {
        log(
          `queued behind ${queueDepth} unanswered turn${queueDepth === 1 ? '' : 's'} — ` +
            `nothing will move until the pending turn is answered or discarded in the panel`,
        )
      }
      queueDepth++

      try {
        await serialize(() => runTurn(body, ids, out, ac.signal))
      } catch (e) {
        if (e instanceof AbandonedTurnError) {
          log(e.message)
          return
        }
        log('TURN FAILED:', (e as Error).message)
        if (!res.writableEnded) emitText(out, `[shim error] ${(e as Error).message}`)
      } finally {
        queueDepth--
      }
    })
    .listen(config.port, '127.0.0.1', () => {
      log(`listening on http://127.0.0.1:${config.port}/v1`)
      log(`traces -> ${LOG_DIR}/`)
    })
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void transport?.dispose().finally(() => process.exit(0))
  })
}

void main()
