// Parser tests. Every "collapsed" case below is real text shape observed from
// Copilot, not invented — see .scratch/session/ for the captures.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseReply, ProtocolError, renderPreamble, renderTools, renderDelta, renderReseedParts, CONTINUE_NUDGE, selectSystemGuidance } from '../src/protocol.mjs'

test('parses a well-formed tool call', () => {
  const r = parseReply('```json\n{"type":"tool_call","name":"bash","arguments":{"command":"ls"}}\n```')
  assert.equal(r.type, 'tool_call')
  assert.equal(r.name, 'bash')
  assert.deepEqual(r.arguments, { command: 'ls' })
})

test('parses a final answer', () => {
  const r = parseReply('```json\n{"type":"final","content":"all done"}\n```')
  assert.deepEqual(r, { type: 'final', content: 'all done' })
})

// The measured failure mode: Copilot renders a fence inline and the page
// collapses newlines and repeated spaces. JSON must survive this unchanged.
test('survives whitespace collapse — the observed corruption', () => {
  const collapsed = '```json { "type": "tool_call", "name": "write", "arguments": { "content": "a\\nb\\n    c" } } ```'
  const r = parseReply(collapsed)
  assert.equal(r.name, 'write')
  // the \n inside the string is a literal two-char escape and must be intact
  assert.equal(r.arguments.content, 'a\nb\n    c')
})

test('escaped quotes and backslashes survive', () => {
  const r = parseReply('```json\n{"type":"tool_call","name":"bash","arguments":{"command":"echo \\"hi\\" && grep \'x\'"}}\n```')
  assert.equal(r.arguments.command, 'echo "hi" && grep \'x\'')
})

test('takes the LAST block when Copilot preambles with an example', () => {
  const r = parseReply(
    'Here is the format:\n```json\n{"type":"final","content":"example"}\n```\nAnd my answer:\n```json\n{"type":"tool_call","name":"read","arguments":{"filePath":"/a"}}\n```',
  )
  assert.equal(r.type, 'tool_call')
  assert.equal(r.name, 'read')
})

test('accepts a bare JSON object with no fence', () => {
  const r = parseReply('{"type":"final","content":"unfenced"}')
  assert.equal(r.content, 'unfenced')
})

test('rejects prose with no JSON at all', () => {
  assert.throws(() => parseReply('Sure! I can help you with that.'), (e) => e instanceof ProtocolError && e.kind === 'no-block')
})

test('rejects invalid JSON rather than guessing at a repair', () => {
  // a trailing comma is exactly the kind of thing a "helpful" salvage would fix
  // and a wrong guess here executes a tool, so it must fail loudly instead
  assert.throws(
    () => parseReply('```json\n{"type":"tool_call","name":"bash","arguments":{"command":"ls",}}\n```'),
    (e) => e instanceof ProtocolError && e.kind === 'bad-json',
  )
})

test('rejects a tool_call with no name', () => {
  assert.throws(
    () => parseReply('```json\n{"type":"tool_call","arguments":{}}\n```'),
    (e) => e instanceof ProtocolError && e.kind === 'bad-shape',
  )
})

test('quota notice is recognised as its own kind, not a parse failure', () => {
  assert.throws(
    () => parseReply("You've reached your daily chat limit, get more chats with higher limits, or check back tomorrow."),
    (e) => e instanceof ProtocolError && e.kind === 'quota',
  )
})

test('a refusal is not silently treated as a tool call', () => {
  assert.throws(() => parseReply("I'm sorry, I can't help with that request."), (e) => e.kind === 'no-block')
})

// --- rendering ---

const FAKE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read',
      description: 'Read a file.',
      parameters: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'path' },
          limit: { type: 'integer', minimum: 0, maximum: 9007199254740991, description: 'lines' },
        },
        required: ['filePath'],
      },
    },
  },
]

test('slim rendering drops $schema and numeric bounds', () => {
  const out = renderTools(FAKE_TOOLS)
  assert.ok(!out.includes('$schema'))
  assert.ok(!out.includes('9007199254740991'))
  assert.ok(out.includes('filePath'))
  assert.ok(out.includes('required'))
})

test('preamble contains the rules and the tools', () => {
  const p = renderPreamble('You are opencode.', FAKE_TOOLS)
  assert.ok(p.includes('You are opencode.'))
  assert.ok(p.includes('### read'))
  assert.ok(p.includes('EXACTLY ONE fenced code block'))
})

// --- regressions found in audit ---

test('REGRESSION: final answer whose content contains a fenced code block', () => {
  // The most common thing a coding agent returns. A fence-matching regex
  // terminates at the INNER closing fence and truncates the object; brace
  // matching that tracks string state does not.
  const reply = '```json\n{"type":"final","content":"Here you go:\\n```js\\nconst x=1\\n```\\nDone."}\n```'
  const r = parseReply(reply)
  assert.equal(r.type, 'final')
  assert.ok(r.content.includes('const x=1'))
  assert.ok(r.content.includes('```js'), 'inner fence must survive into the content')
})

test('REGRESSION: braces inside string values do not break extraction', () => {
  const r = parseReply('```json\n{"type":"tool_call","name":"bash","arguments":{"command":"awk \'{print $1}\' f"}}\n```')
  assert.equal(r.arguments.command, "awk '{print $1}' f")
})

test('REGRESSION: prose around the envelope is tolerated', () => {
  const r = parseReply('Sure thing!\n\n```json\n{"type":"final","content":"ok"}\n```\n\nLet me know!')
  assert.equal(r.content, 'ok')
})

test('renderDelta returns empty for an assistant-only delta (server nudges)', () => {
  // Documents the contract the server relies on: renderDelta does NOT invent
  // content, so the caller must substitute CONTINUE_NUDGE rather than filling
  // the composer with '' and hanging on a Send button that never appears.
  const out = renderDelta([
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', function: { name: 'bash', arguments: '{}' } }] },
  ])
  assert.equal(out.trim(), '')
  assert.ok(CONTINUE_NUDGE.length > 0)
})

test('REGRESSION: a re-seed replays earlier prose answers, not just the questions', () => {
  // A replayed chat used to hold the user's follow-ups but none of the answers
  // they followed up on — both "I lost the chat" and "Copy full context".
  const answer = 'It loads config. Note the "frozen" object:\n```ts\nObject.freeze(cfg)\n```'
  const { query } = renderReseedParts(
    [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'What does config.ts do?' },
      { role: 'assistant', content: answer },
      { role: 'user', content: 'Now add a port option.' },
    ],
    [],
  )
  const first = query.indexOf('What does config.ts do?')
  const replayed = query.indexOf('## You already answered')
  const second = query.indexOf('Now add a port option.')
  assert.ok(first < replayed && replayed < second, 'the answer must sit between the two requests')

  // the replayed envelope must round-trip exactly, quotes and fences included
  const block = query.slice(replayed, second)
  assert.deepEqual(parseReply(block), { type: 'final', content: answer })
})

// --- system prompt selection (regression: truncation dropped the useful part) ---

const REAL_SYSTEM = [
  'You are opencode, an interactive CLI tool.',
  '',
  '# Tone and style',
  'Be concise. Answer in fewer than 4 lines. Avoid preamble.',
  '',
  '# Proactiveness',
  'Do the right thing when asked.',
  '',
  '# Following conventions',
  'Mimic existing code style.',
  '',
  '# Doing tasks',
  'Use the search tools to understand the codebase.',
  '',
  '# Tool usage policy',
  'When doing file search, prefer the task tool. Use read before edit.',
  '',
  '# Code References',
  'Reference code as file_path:line.',
].join('\n')

test('REGRESSION: tool-governing sections survive selection', () => {
  // Truncating at 1500 chars kept "Tone and style" and dropped every section
  // that governs tool use — the exact inverse of what matters.
  const out = selectSystemGuidance(REAL_SYSTEM, 12000)
  assert.match(out, /# Tool usage policy/)
  assert.match(out, /# Doing tasks/)
  assert.match(out, /# Following conventions/)
  assert.match(out, /# Code References/)
  assert.match(out, /read before edit/)
})

test('Tone and style is excluded — it argues against the output contract', () => {
  const out = selectSystemGuidance(REAL_SYSTEM, 12000)
  assert.ok(!/# Tone and style/.test(out))
  assert.ok(!/fewer than 4 lines/.test(out), 'prose-formatting guidance must not survive')
})

test('the intro leads, then the highest-priority section', () => {
  const out = selectSystemGuidance(REAL_SYSTEM, 12000)
  assert.ok(out.startsWith('You are opencode'))
  assert.ok(
    out.indexOf('# Tool usage policy') < out.indexOf('# Proactiveness'),
    'tool usage policy must outrank proactiveness',
  )
})

test('a tight budget keeps the most important section, not the first one', () => {
  const out = selectSystemGuidance(REAL_SYSTEM, 260)
  assert.match(out, /# Tool usage policy/)
  assert.ok(!/# Proactiveness/.test(out))
})

test('over-budget content is marked truncated, never silently cut', () => {
  const out = selectSystemGuidance(REAL_SYSTEM, 150)
  if (out.length > 120) assert.match(out, /…\(truncated\)/)
})

test('an empty or missing system prompt is handled', () => {
  assert.equal(selectSystemGuidance(''), '')
  assert.equal(selectSystemGuidance(undefined), '')
})
