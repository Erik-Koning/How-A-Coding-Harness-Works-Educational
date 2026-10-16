// Acceptance criteria §1, §3, §4, §5, §6, §7.
// Runs against the compiled output in dist/, so `npm run build:server` first.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import net from 'node:net'
import { resolveTransport, loadConfig } from '../dist/config.js'
import { TurnStore } from '../dist/manual/turn-store.js'
import { ManualTransport } from '../dist/transport/manual.js'
import { createTransport, mapImportFailure, INSTALL_HINT } from '../dist/transport/index.js'
import { ProjectionLostError, TransportUnavailableError } from '../dist/transport/types.js'

// --------------------------------------------------------------- §4 config

test('unrecognised, empty and absent COPILOT_TRANSPORT all resolve to manual', () => {
  for (const raw of [undefined, '', '   ', 'garbage', 'playwrite', 'play wright', '1', 'true', 'auto']) {
    assert.equal(resolveTransport(raw).mode, 'manual', `raw=${JSON.stringify(raw)}`)
  }
})

test('only an exact playwright value selects the automated transport', () => {
  assert.equal(resolveTransport('playwright').mode, 'playwright')
  assert.equal(resolveTransport('  PlayWright  ').mode, 'playwright')
})

test('a garbage value logs the fallback', () => {
  const lines = []
  loadConfig({ env: { COPILOT_TRANSPORT: 'garbage' }, log: (m) => lines.push(m), warn: () => {} })
  assert.ok(
    lines.some((l) => /not recognised/i.test(l) && /manual/i.test(l)),
    `expected a fallback line, got: ${JSON.stringify(lines)}`,
  )
  assert.ok(lines.some((l) => l === 'transport: manual (human-in-the-loop)'))
})

test('nothing else on the machine can imply playwright', () => {
  // the spec is explicit: never infer from a PLAYWRIGHT_* var or an install
  const cfg = loadConfig({
    env: { PLAYWRIGHT_BROWSERS_PATH: '/tmp/x', PLAYWRIGHT: '1' },
    log: () => {},
    warn: () => {},
  })
  assert.equal(cfg.transport, 'manual')
})

test('selecting playwright prints an unsuppressable bold red policy warning', () => {
  const warned = []
  loadConfig({ env: { COPILOT_TRANSPORT: 'playwright' }, log: () => {}, warn: (m) => warned.push(m) })
  const all = warned.join('\n')
  assert.match(all, /automated browser access/i)
  assert.match(all, /terms of service/i)
  assert.match(all, /your responsibility/i)
  assert.ok(all.includes('\x1b[1;31m'), 'expected bold red ANSI styling')
})

test('manual mode prints no playwright warning', () => {
  const warned = []
  loadConfig({ env: {}, log: () => {}, warn: (m) => warned.push(m) })
  assert.deepEqual(warned, [])
})

test('config is frozen — no runtime mutation', () => {
  const cfg = loadConfig({ env: {}, log: () => {}, warn: () => {} })
  assert.throws(() => {
    cfg.transport = 'playwright'
  }, TypeError)
})

// ------------------------------------------- §5 no turn advances without a human

test('submit() never resolves without a discrete human send', async () => {
  const store = new TurnStore()
  const { wait } = store.open({ query: 'q', turnIndex: 1, conversationId: 'c' })

  let settled = false
  wait.then(
    () => (settled = true),
    () => (settled = true),
  )

  const turn = store.current()

  // every non-send interaction a human could perform, plus real elapsed time
  store.markCopied(turn.id)
  store.review(turn.id, 'a pasted draft')
  store.editAgain(turn.id)
  store.review(turn.id, 'an edited draft')
  await new Promise((r) => setTimeout(r, 250))
  store.snapshot()
  await new Promise((r) => setTimeout(r, 250))

  assert.equal(settled, false, 'submit() must still be pending after copy/review/edit and elapsed time')
  assert.equal(store.pendingCount, 1)

  store.send(turn.id, 'the response')
  assert.equal(await wait, 'the response')
  assert.equal(store.pendingCount, 0)
})

test('the store exposes no timer-driven path', () => {
  // Guard against a future "helpful" auto-advance: the module must not reach for
  // any scheduling primitive.
  const src = fs.readFileSync(new URL('../src/manual/turn-store.ts', import.meta.url), 'utf8')
  for (const banned of ['setTimeout', 'setInterval', 'setImmediate', 'clipboard']) {
    assert.ok(!src.includes(banned), `turn-store must not reference ${banned}`)
  }
})

test('a lost chat rejects the turn so the shim re-seeds', async () => {
  const store = new TurnStore()
  const { wait } = store.open({ query: 'q', turnIndex: 1, conversationId: 'c' })
  const turn = store.current()
  store.fail(turn.id, new ProjectionLostError())
  await assert.rejects(wait, (e) => e instanceof ProjectionLostError)
})

// ------------------------------------------------ §7 multi-turn history intact

test('a three-turn session keeps order and history, systemPrompt only on turn 1', async () => {
  const store = new TurnStore()
  const responses = ['first', 'second', 'third']

  for (let i = 0; i < 3; i++) {
    const { wait } = store.open({
      systemPrompt: i === 0 ? 'THE SYSTEM PROMPT' : undefined,
      query: `query ${i + 1}`,
      turnIndex: i + 1,
      conversationId: 'ses_x',
    })
    const turn = store.current()
    store.markCopied(turn.id)
    store.review(turn.id, responses[i])
    store.send(turn.id, responses[i])
    assert.equal(await wait, responses[i])
  }

  const { history, current } = store.snapshot()
  assert.equal(current, null)
  assert.equal(history.length, 3)
  assert.deepEqual(
    history.map((t) => t.turnIndex),
    [1, 2, 3],
  )
  assert.deepEqual(
    history.map((t) => t.response),
    responses,
  )
  assert.ok(history[0].systemPrompt, 'turn 1 must carry the system prompt')
  assert.ok(!history[1].systemPrompt, 'turn 2 must be a delta')
  assert.ok(!history[2].systemPrompt, 'turn 3 must be a delta')
  assert.ok(history.every((t) => t.state === 'committed'))
})

test('a delta turn offers its full context on screen, but history does not carry it', async () => {
  const store = new TurnStore()
  const fullContext = { systemPrompt: 'THE SYSTEM PROMPT', query: 'everything so far' }

  const first = store.open({ query: 'just the delta', fullContext, turnIndex: 2, conversationId: 'c' })
  const { current, history } = store.snapshot()
  assert.deepEqual(current.fullContext, fullContext, 'the turn on screen must offer the full context')
  assert.equal(current.query, 'just the delta', 'the default copy stays the delta')
  assert.equal(history[0].fullContext, undefined, 'history must not repeat it every SSE frame')

  store.send(first.record.id, 'done')
  await first.wait
  assert.equal(store.snapshot().history[0].fullContext, undefined)
})

// --------------------------------------------- which Copilot chat a turn goes in

test('each new chat gets a label, and delta turns keep their conversation\'s', () => {
  const store = new TurnStore()
  const open = (req) => {
    const { record, wait } = store.open(req)
    wait.catch(() => {})
    return record
  }

  const main1 = open({ systemPrompt: 'S', query: 'q1', turnIndex: 1, conversationId: 'main' })
  const main2 = open({ query: 'q2', turnIndex: 2, conversationId: 'main' })
  const sub1 = open({
    systemPrompt: 'S',
    query: 'subagent task',
    turnIndex: 3,
    conversationId: 'sub',
    parentConversationId: 'main',
  })
  const sub2 = open({ query: 'subagent step', turnIndex: 4, conversationId: 'sub' })
  const main3 = open({ query: 'back in the parent', turnIndex: 5, conversationId: 'main' })
  const reseeded = open({ systemPrompt: 'S', query: 'lost chat', turnIndex: 6, conversationId: 'main' })

  assert.deepEqual(main1.chat, { label: 'A', startedAtTurn: 1 })
  assert.equal(main2.chat.label, 'A')
  assert.deepEqual(sub1.chat, { label: 'B', startedAtTurn: 3, parentLabel: 'A' })
  assert.equal(sub2.chat.label, 'B')
  assert.equal(main3.chat.label, 'A', 'the parent goes back to its own chat, not the last one used')
  assert.equal(reseeded.chat.label, 'C', 'starting over means a new chat')
})

test('a turn carries its purpose to the panel', () => {
  const store = new TurnStore()
  const { wait } = store.open({ query: 'q', turnIndex: 1, conversationId: 'c', purpose: 'compacting' })
  wait.catch(() => {})
  assert.equal(store.snapshot().current.purpose, 'compacting')
})

// ------------------------------------------------------ §3 playwright absent

test('a missing playwright package produces advice, not a stack trace', () => {
  // Exercised directly so the assertion holds whether or not playwright happens
  // to be installed in this checkout.
  const missing = Object.assign(new Error("Cannot find package 'playwright'"), {
    code: 'ERR_MODULE_NOT_FOUND',
  })
  const mapped = mapImportFailure(missing)

  assert.ok(mapped instanceof TransportUnavailableError)
  assert.match(mapped.message, /npm install playwright/)
  assert.match(mapped.message, /unset COPILOT_TRANSPORT/)
  assert.ok(!/\n\s+at /.test(mapped.message), 'the message must not carry a stack trace')
  assert.ok(!mapped.message.includes('ERR_MODULE_NOT_FOUND'))
})

test('a genuine fault is NOT disguised as a missing dependency', () => {
  const real = Object.assign(new SyntaxError('Unexpected token in playwright.js'), {})
  const mapped = mapImportFailure(real)
  assert.ok(!(mapped instanceof TransportUnavailableError))
  assert.equal(mapped, real, 'real faults must propagate unchanged')
})

test('the install hint names both ways out', () => {
  assert.match(INSTALL_HINT, /npx playwright install chromium/)
  assert.match(INSTALL_HINT, /human-in-the-loop/)
})

// --------------------------------------------------------- §6 loopback only

test('the panel is unreachable from a non-loopback interface', async (t) => {
  const external = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)

  if (!external) return t.skip('no non-loopback IPv4 interface on this host')

  const port = 8999
  const transport = new ManualTransport({
    transport: 'manual',
    port: 0,
    manual: { port, autoOpenBrowser: false },
  })
  await transport.init()

  try {
    // loopback works
    await new Promise((resolve, reject) => {
      const s = net.connect(port, '127.0.0.1', () => {
        s.destroy()
        resolve()
      })
      s.on('error', reject)
    })

    // the machine's own LAN address does not
    const refused = await new Promise((resolve) => {
      const s = net.connect(port, external.address)
      s.setTimeout(3000)
      s.on('connect', () => {
        s.destroy()
        resolve(false)
      })
      s.on('timeout', () => {
        s.destroy()
        resolve(true)
      })
      s.on('error', () => resolve(true))
    })
    assert.equal(refused, true, `panel must not be reachable on ${external.address}:${port}`)
  } finally {
    await transport.dispose()
  }
})

import fs from 'node:fs'

// ---------------------------------------------- panel window reuse (regression)

test('REGRESSION: a second turn does not open a second window', async () => {
  const { PanelServer } = await import('../dist/manual/panel-server.js')
  const { TurnStore } = await import('../dist/manual/turn-store.js')

  const launches = []
  const store = new TurnStore()
  const panel = new PanelServer(
    { transport: 'manual', port: 0, manual: { port: 8997, autoOpenBrowser: true } },
    store,
    (cmd) => launches.push(cmd),
  )
  await panel.start()

  try {
    // nothing connected: the first turn legitimately opens a panel
    panel.raise()
    assert.equal(launches.length, 1, 'first turn should open a panel')

    // still nothing connected, but a launch is in flight — must NOT open again
    panel.raise()
    panel.raise()
    assert.equal(launches.length, 1, 'turns during browser startup must not each open a window')

    // now a panel actually connects
    const res = await fetch('http://127.0.0.1:8997/events')
    await new Promise((r) => setTimeout(r, 250))
    assert.equal(panel.connectedClients, 1)

    // every subsequent turn must reuse it, however many arrive
    for (let i = 0; i < 5; i++) panel.raise()
    assert.equal(launches.length, 1, 'a connected panel must be reused, never re-opened')

    await res.body.cancel()
  } finally {
    await panel.stop()
  }
})

// ------------------------------- abandoned turns (regression: wedged queue)

test('REGRESSION: a disconnected client drops its turn instead of wedging', async () => {
  const { AbandonedTurnError } = await import('../dist/transport/types.js')
  const transport = new ManualTransport({
    transport: 'manual',
    port: 0,
    manual: { port: 8996, autoOpenBrowser: false },
  })
  await transport.init()

  try {
    const ac = new AbortController()
    const pending = transport.submit({
      query: 'q',
      turnIndex: 1,
      conversationId: 'c',
      signal: ac.signal,
    })

    let settled = false
    pending.then(
      () => (settled = true),
      () => (settled = true),
    )
    await new Promise((r) => setTimeout(r, 150))
    assert.equal(settled, false, 'still waiting on a human while the client is connected')

    // the opencode client quits
    ac.abort()
    await assert.rejects(pending, (e) => e instanceof AbandonedTurnError)

    // and crucially the queue is now clear for the next session
    const next = transport.submit({
      query: 'from a new session',
      turnIndex: 2,
      conversationId: 'c2',
      signal: new AbortController().signal,
    })
    next.catch(() => {})
    await new Promise((r) => setTimeout(r, 150))
    const snap = await fetch('http://127.0.0.1:8996/events')
      .then(async (r) => {
        const rd = r.body.getReader()
        const { value } = await rd.read()
        await rd.cancel()
        return JSON.parse(new TextDecoder().decode(value).slice(6).split('\n\n')[0])
      })
    assert.equal(snap.current.query, 'from a new session', 'the stale turn must not still be current')
  } finally {
    await transport.dispose()
  }
})

test('a turn already abandoned before it starts is never shown to the human', async () => {
  const { AbandonedTurnError } = await import('../dist/transport/types.js')
  const transport = new ManualTransport({
    transport: 'manual',
    port: 0,
    manual: { port: 8995, autoOpenBrowser: false },
  })
  await transport.init()
  try {
    const ac = new AbortController()
    ac.abort() // client already gone while this was queued
    await assert.rejects(
      transport.submit({ query: 'q', turnIndex: 1, conversationId: 'c', signal: ac.signal }),
      (e) => e instanceof AbandonedTurnError,
    )
  } finally {
    await transport.dispose()
  }
})
