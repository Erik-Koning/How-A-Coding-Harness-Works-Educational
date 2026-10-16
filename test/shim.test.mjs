// End to end through the real shim process: opencode-shaped requests in, the
// panel's HTTP API standing in for the human. Runs against dist/, so
// `npm run build:server` first.
//
// The shim runs in a temporary folder, so its traces never touch this repo's
// .scratch/shim-log/.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SHIM = `http://127.0.0.1:8981`
const PANEL = `http://127.0.0.1:8982`
const TOOLS = [{ type: 'function', function: { name: 'bash', description: 'Run a command', parameters: {} } }]

let child
let dir

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-test-'))
  child = spawn(process.execPath, [fileURLToPath(new URL('../dist/shim-server.js', import.meta.url))], {
    cwd: dir,
    env: {
      ...process.env,
      COPILOT_TRANSPORT: '',
      COPILOT_SHIM_PORT: '8981',
      COPILOT_PANEL_PORT: '8982',
      COPILOT_PANEL_OPEN: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await new Promise((resolve, reject) => {
    let out = ''
    child.stdout.on('data', (c) => {
      out += c
      if (out.includes('listening on')) resolve()
    })
    child.stderr.on('data', (c) => (out += c))
    child.on('exit', (code) => reject(new Error(`shim exited (${code}): ${out}`)))
  })
})

after(() => {
  child?.kill()
  fs.rmSync(dir, { recursive: true, force: true })
})

/** A chat completion as opencode sends it. Resolves with the streamed reply. */
async function complete(body, headers = {}) {
  const res = await fetch(`${SHIM}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ model: 'm365-copilot', stream: true, ...body }),
  })
  let text = ''
  const toolCalls = []
  for (const frame of (await res.text()).split('\n\n')) {
    if (!frame.startsWith('data: {')) continue
    const delta = JSON.parse(frame.slice(6)).choices?.[0]?.delta ?? {}
    if (delta.content) text += delta.content
    if (delta.tool_calls) toolCalls.push(...delta.tool_calls)
  }
  return { text, toolCalls }
}

/** The first panel snapshot whose current turn passes `match`. */
async function waitForTurn(match) {
  const res = await fetch(`${PANEL}/events`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const deadline = Date.now() + 5000
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, i)
        buf = buf.slice(i + 2)
        if (!frame.startsWith('data: ')) continue
        const snapshot = JSON.parse(frame.slice(6))
        if (snapshot.current && match(snapshot.current)) return snapshot.current
      }
    }
  } finally {
    await reader.cancel()
  }
  throw new Error('no matching turn reached the panel')
}

async function answer(turn, text) {
  await fetch(`${PANEL}/api/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: turn.id, text }),
  })
}

async function currentTurn() {
  const res = await fetch(`${PANEL}/events`)
  const reader = res.body.getReader()
  const { value } = await reader.read()
  await reader.cancel()
  return JSON.parse(new TextDecoder().decode(value).slice(6).split('\n\n')[0]).current
}

const SYSTEM = { role: 'system', content: 'You are opencode, a coding agent.' }

test('a title request is answered locally and never reaches the panel', async () => {
  const reply = await complete({
    messages: [
      { role: 'system', content: 'You are a title generator. You output ONLY a thread title.' },
      { role: 'user', content: 'Generate a title for this conversation:\n' },
      { role: 'user', content: 'count the lines in foo.js' },
    ],
  })
  assert.equal(reply.text, 'count the lines in foo.js')
  assert.equal(await currentTurn(), null)
})

test('a step, then a compaction in the same chat, then a subagent in its own', async () => {
  // 1. the task starts: a new chat, A
  const first = complete({ messages: [SYSTEM, { role: 'user', content: 'say hi' }], tools: TOOLS }, { 'x-session-id': 'ses_main' })
  const t1 = await waitForTurn((t) => t.query.includes('say hi'))
  assert.ok(t1.systemPrompt, 'the first turn starts a chat')
  assert.equal(t1.chat.label, 'A')
  await answer(t1, '```json\n{"type":"final","content":"hi"}\n```')
  assert.equal((await first).text, 'hi')

  // 2. REGRESSION: compaction carries no tools. It used to be answered with a
  //    fake title; now it is relayed, into chat A, as plain text.
  const compaction = complete(
    {
      messages: [
        { role: 'system', content: 'You are an anchored context summarization assistant for coding sessions.' },
        { role: 'user', content: 'say hi' },
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: 'Create a new anchored summary from the conversation history.' },
      ],
    },
    { 'x-session-id': 'ses_main' },
  )
  const t2 = await waitForTurn((t) => t.query.includes('anchored summary'))
  assert.equal(t2.systemPrompt, undefined, 'goes into the chat that already has the history')
  assert.equal(t2.chat.label, 'A')
  assert.match(t2.purpose, /compacting/)
  assert.ok(!t2.query.includes('## User request'), 'the history is not pasted again')
  const summary = '## Goal\n- greet the user\n\n## Done\n- said hi'
  await answer(t2, summary)
  const compacted = await compaction
  assert.equal(compacted.text, summary, 'opencode receives the real summary')
  assert.equal(compacted.toolCalls.length, 0)

  // 3. a subagent: its own chat, B, linked to A
  const sub = complete(
    { messages: [SYSTEM, { role: 'user', content: 'subagent: list files' }], tools: TOOLS },
    { 'x-session-id': 'ses_sub', 'x-parent-session-id': 'ses_main' },
  )
  const t3 = await waitForTurn((t) => t.query.includes('subagent: list files'))
  assert.ok(t3.systemPrompt)
  assert.equal(t3.chat.label, 'B')
  assert.equal(t3.chat.parentLabel, 'A')
  await answer(t3, '{"type":"tool_call","name":"bash","arguments":{"command":"ls"}}')
  const subReply = await sub
  assert.equal(subReply.toolCalls[0]?.function?.name, 'bash')

  // 4. the parent continues: back to chat A, as a delta
  const back = complete(
    {
      messages: [SYSTEM, { role: 'user', content: 'say hi' }, { role: 'assistant', content: 'hi' }, { role: 'user', content: 'now say bye' }],
      tools: TOOLS,
    },
    { 'x-session-id': 'ses_main' },
  )
  const t4 = await waitForTurn((t) => t.query.includes('now say bye'))
  assert.equal(t4.systemPrompt, undefined)
  assert.equal(t4.chat.label, 'A', 'the parent goes back to its own chat')
  await answer(t4, '{"type":"final","content":"bye"}')
  assert.equal((await back).text, 'bye')
})

test('a tool call in answer to a tool-less request is sent back for a repair', async () => {
  const pending = complete(
    { messages: [{ role: 'user', content: 'Create a new anchored summary from the conversation history.' }] },
    { 'x-session-id': 'ses_other' },
  )
  const t1 = await waitForTurn((t) => t.query.includes('anchored summary'))
  assert.ok(t1.systemPrompt, 'no live chat for this session, so a new one')
  await answer(t1, '{"type":"tool_call","name":"bash","arguments":{"command":"ls"}}')
  const repair = await waitForTurn((t) => t.id !== t1.id)
  assert.match(repair.query, /no tools/i)
  assert.match(repair.purpose, /compacting/)
  await answer(repair, 'the summary')
  assert.equal((await pending).text, 'the summary')
})
