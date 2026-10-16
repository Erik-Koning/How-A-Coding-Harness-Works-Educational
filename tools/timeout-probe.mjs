// Probe for ticket 11 / ticket 15: how long will opencode wait for a response,
// and does an SSE heartbeat hold the connection open?
//
//   node tools/timeout-probe.mjs --mode silent    # no bytes at all, then respond
//   node tools/timeout-probe.mjs --mode heartbeat # SSE comments, then respond
//
// A "Pause" (human clearing an MFA prompt) can last minutes. If the client
// gives up, the Pause design needs a different mechanism entirely.

import http from 'node:http'

const args = process.argv.slice(2)
const argOf = (f, d) => {
  const i = args.indexOf(f)
  return i === -1 ? d : args[i + 1]
}

const MODE = argOf('--mode', 'silent')
const DELAY_MS = Number(argOf('--delay', 100000))
const PORT = Number(argOf('--port', 8787))

const t0 = Date.now()
const el = () => `t+${((Date.now() - t0) / 1000).toFixed(1)}s`

http
  .createServer(async (req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    await new Promise((r) => req.on('end', r))

    const body = raw ? JSON.parse(raw) : {}
    const isSide = !body.tools || !body.tools.length

    if (isSide) {
      // answer housekeeping instantly so it isn't what we're measuring
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(
        `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'probe' }, finish_reason: null }] })}\n\n`,
      )
      res.write(
        `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
      )
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }

    console.log(`${el()} MAIN CALL received. mode=${MODE} delay=${DELAY_MS}ms — stalling now`)

    let aborted = false
    req.on('aborted', () => {
      aborted = true
      console.log(`${el()} *** CLIENT ABORTED THE REQUEST ***`)
    })
    res.on('close', () => {
      if (!res.writableEnded) console.log(`${el()} *** CONNECTION CLOSED before we replied ***`)
    })

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    if (MODE === 'heartbeat') {
      const iv = setInterval(() => {
        if (aborted) return clearInterval(iv)
        res.write(': keepalive\n\n') // SSE comment — ignored by parsers
        console.log(`${el()} heartbeat sent`)
      }, 10000)
      await new Promise((r) => setTimeout(r, DELAY_MS))
      clearInterval(iv)
    } else {
      await new Promise((r) => setTimeout(r, DELAY_MS))
    }

    if (aborted) {
      console.log(`${el()} giving up — client already gone`)
      return
    }

    console.log(`${el()} stall over, replying now`)
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`)
    send({
      id: 'probe',
      object: 'chat.completion.chunk',
      model: 'm',
      choices: [{ index: 0, delta: { role: 'assistant', content: `SURVIVED ${MODE} ${DELAY_MS}ms` }, finish_reason: null }],
    })
    send({
      id: 'probe',
      object: 'chat.completion.chunk',
      model: 'm',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })
    res.write('data: [DONE]\n\n')
    res.end()
    console.log(`${el()} replied successfully`)
  })
  .listen(PORT, '127.0.0.1', () => console.log(`${el()} probe listening on ${PORT}, mode=${MODE}`))
