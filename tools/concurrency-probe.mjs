// Ticket 14: does opencode's title Side Call overlap the Main Call?
// Stall the Side Call and see whether the Main Call arrives while it is pending.
// If it does, the browser needs a real queue (one chat, two callers). If not, a
// simple lock suffices.

import http from 'node:http'

const t0 = Date.now()
const el = () => `t+${((Date.now() - t0) / 1000).toFixed(2)}s`
let sideInFlight = false
let verdict = 'SEQUENTIAL - no main call arrived while the side call was pending'

http
  .createServer(async (req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    await new Promise((r) => req.on('end', r))
    const body = raw ? JSON.parse(raw) : {}
    const isSide = !body.tools || !body.tools.length

    console.log(`${el()} ARRIVED ${isSide ? 'SIDE' : 'MAIN'} (sideInFlight=${sideInFlight})`)

    if (!isSide && sideInFlight) {
      verdict = 'CONCURRENT - main call arrived while side call was still pending'
      console.log(`${el()} >>> ${verdict}`)
    }

    if (isSide) {
      sideInFlight = true
      console.log(`${el()} stalling SIDE call for 15s...`)
      await new Promise((r) => setTimeout(r, 15000))
      sideInFlight = false
      console.log(`${el()} SIDE call released`)
    }

    const id = 'probe'
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`)
    send({
      id,
      object: 'chat.completion.chunk',
      model: 'm',
      choices: [{ index: 0, delta: { role: 'assistant', content: isSide ? 'Title' : verdict }, finish_reason: null }],
    })
    send({ id, object: 'chat.completion.chunk', model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
    res.write('data: [DONE]\n\n')
    res.end()
  })
  .listen(8787, '127.0.0.1', () => console.log(`${el()} concurrency probe on 8787`))
