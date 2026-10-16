// Throwaway capture server for ticket 11 (Map opencode's wire expectations).
// Logs every request opencode makes, replays a scripted sequence of responses.
//
//   node tools/capture-server.mjs [--port 8787] [--script scripts/foo.json]
//
// The script file is a JSON array of response specs, consumed one per
// /v1/chat/completions call. When exhausted, the last entry repeats.
//   { "kind": "text", "content": "..." }
//   { "kind": "tool",  "name": "bash", "arguments": { ... } }

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i === -1 ? fallback : args[i + 1]
}

const PORT = Number(argOf('--port', 8787))
const SCRIPT_PATH = argOf('--script', null)
const OUT_DIR = argOf('--out', '.scratch/capture')

fs.mkdirSync(OUT_DIR, { recursive: true })

const script = SCRIPT_PATH
  ? JSON.parse(fs.readFileSync(SCRIPT_PATH, 'utf8'))
  : [{ kind: 'text', content: 'Acknowledged.' }]

let callIndex = 0
let scriptIndex = 0

const log = (...m) => console.log('[capture]', ...m)

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => resolve(raw))
  })

function record(name, payload) {
  const file = path.join(OUT_DIR, name)
  fs.writeFileSync(file, typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2))
  log('wrote', file)
}

// ---------------------------------------------------------------- responses

function chunk(id, model, delta, finish = null) {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Number(process.hrtime.bigint() / 1000000000n)),
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  }
}

function sendSSE(res, spec, model) {
  const id = `chatcmpl-capture-${callIndex}`
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  const emit = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)

  emit(chunk(id, model, { role: 'assistant', content: '' }))

  if (spec.kind === 'tool') {
    emit(
      chunk(id, model, {
        tool_calls: [
          {
            index: 0,
            id: `call_capture_${callIndex}`,
            type: 'function',
            function: { name: spec.name, arguments: JSON.stringify(spec.arguments ?? {}) },
          },
        ],
      }),
    )
    emit(chunk(id, model, {}, 'tool_calls'))
  } else {
    for (const piece of String(spec.content).match(/.{1,24}/gs) ?? []) {
      emit(chunk(id, model, { content: piece }))
    }
    emit(chunk(id, model, {}, 'stop'))
  }

  // usage on the final chunk, mirroring what real providers send
  res.write(
    `data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      model,
      choices: [],
      usage: { prompt_tokens: 1234, completion_tokens: 56, total_tokens: 1290 },
    })}\n\n`,
  )
  res.write('data: [DONE]\n\n')
  res.end()
}

function sendJSON(res, spec, model) {
  const id = `chatcmpl-capture-${callIndex}`
  const message =
    spec.kind === 'tool'
      ? {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: `call_capture_${callIndex}`,
              type: 'function',
              function: { name: spec.name, arguments: JSON.stringify(spec.arguments ?? {}) },
            },
          ],
        }
      : { role: 'assistant', content: spec.content }

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(
    JSON.stringify({
      id,
      object: 'chat.completion',
      created: 0,
      model,
      choices: [
        { index: 0, message, finish_reason: spec.kind === 'tool' ? 'tool_calls' : 'stop' },
      ],
      usage: { prompt_tokens: 1234, completion_tokens: 56, total_tokens: 1290 },
    }),
  )
}

// ------------------------------------------------------------------ server

const server = http.createServer(async (req, res) => {
  const raw = await readBody(req)
  const stamp = String(callIndex).padStart(3, '0')

  log(req.method, req.url, `(${raw.length} bytes)`)

  record(`${stamp}-${req.method}-${req.url.replace(/\W+/g, '_')}.headers.json`, {
    method: req.method,
    url: req.url,
    headers: req.headers,
  })

  if (req.url.startsWith('/v1/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        object: 'list',
        data: [{ id: 'm365-copilot', object: 'model', created: 0, owned_by: 'shim' }],
      }),
    )
    return
  }

  if (!req.url.includes('chat/completions')) {
    log('UNEXPECTED endpoint:', req.url)
    res.writeHead(404).end('{}')
    return
  }

  let body = {}
  try {
    body = JSON.parse(raw)
  } catch {
    record(`${stamp}-unparseable-body.txt`, raw)
  }

  record(`${stamp}-request.json`, body)

  const model = body.model ?? 'm365-copilot'

  // A call with no tools is a housekeeping side-call (title generation,
  // summarisation). Answer it cheaply and don't let it consume the script.
  const isSideCall = !body.tools || body.tools.length === 0
  if (isSideCall) {
    log(`call #${callIndex} SIDE-CALL (no tools, ${body.messages?.length} msgs) -> canned`)
    callIndex++
    const canned = { kind: 'text', content: 'Capture run' }
    if (body.stream) sendSSE(res, canned, model)
    else sendJSON(res, canned, model)
    return
  }

  const spec = script[Math.min(scriptIndex, script.length - 1)]
  scriptIndex++
  log(
    `call #${callIndex}`,
    `stream=${body.stream}`,
    `msgs=${body.messages?.length}`,
    `tools=${body.tools?.length ?? 0}`,
    `-> ${spec.kind}${spec.kind === 'tool' ? ':' + spec.name : ''}`,
  )
  callIndex++

  if (body.stream) sendSSE(res, spec, model)
  else sendJSON(res, spec, model)
})

server.listen(PORT, '127.0.0.1', () => log(`listening on http://127.0.0.1:${PORT}/v1`))
