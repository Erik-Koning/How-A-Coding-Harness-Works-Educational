import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Session } from '../src/transcript.mjs'

const sys = { role: 'system', content: 'you are opencode' }
const user = { role: 'user', content: 'do the thing' }
const asst = (id, name, args) => ({
  role: 'assistant',
  content: null,
  tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
})
const toolRes = (id, content) => ({ role: 'tool', tool_call_id: id, content })

function seeded(messages) {
  const s = new Session('ses_test')
  s.markReseeded({ fake: true })
  s.commit(s.plan(messages).incoming)
  return s
}

test('first request always re-seeds — there is no projection yet', () => {
  const s = new Session('ses_test')
  const p = s.plan([sys, user])
  assert.equal(p.action, 'reseed')
  assert.match(p.reason, /no live projection/)
})

test('append-only growth yields a delta of exactly the new messages', () => {
  const base = [sys, user]
  const s = seeded(base)
  const grown = [...base, asst('call_1', 'bash', { command: 'ls' }), toolRes('call_1', 'a\nb')]
  const p = s.plan(grown)
  assert.equal(p.action, 'delta')
  assert.equal(p.delta.length, 2)
  assert.equal(p.delta[1].content, 'a\nb')
})

test('a second Turn deltas again rather than re-sending history', () => {
  const base = [sys, user]
  const s = seeded(base)
  const t1 = [...base, asst('call_1', 'bash', { command: 'ls' }), toolRes('call_1', 'out1')]
  s.commit(s.plan(t1).incoming)
  const t2 = [...t1, asst('call_2', 'read', { filePath: '/a' }), toolRes('call_2', 'out2')]
  const p = s.plan(t2)
  assert.equal(p.action, 'delta')
  assert.equal(p.delta.length, 2)
})

test('a changed earlier message is divergence, not a delta', () => {
  const s = seeded([sys, user])
  const edited = [sys, { role: 'user', content: 'do a DIFFERENT thing' }]
  const p = s.plan(edited)
  assert.equal(p.action, 'reseed')
  assert.match(p.reason, /prefix diverged at message 1/)
})

test("opencode's compaction (history shrinks) forces a re-seed", () => {
  const base = [sys, user, asst('call_1', 'bash', { command: 'ls' }), toolRes('call_1', 'out')]
  const s = seeded(base)
  const p = s.plan([sys, { role: 'user', content: 'summary of earlier work' }])
  assert.equal(p.action, 'reseed')
  assert.match(p.reason, /shrank/)
})

test('an identical repeat request re-seeds rather than sending nothing', () => {
  const base = [sys, user]
  const s = seeded(base)
  const p = s.plan(base)
  assert.equal(p.action, 'reseed')
  assert.match(p.reason, /duplicate/)
})

test('differing tool_call ids in the PREFIX do not count as divergence', () => {
  // ids are minted per attempt; if they were part of message identity, every
  // harmless re-mint would force a full re-seed — expensive in both wall-clock
  // and daily quota. Growth must still be detected as a plain delta.
  const base = [sys, user]
  const s = seeded(base)
  const turn1 = [...base, asst('call_AAA', 'bash', { command: 'ls' }), toolRes('call_AAA', 'out')]
  s.commit(s.plan(turn1).incoming)

  const turn2WithRemintedIds = [
    ...base,
    asst('call_ZZZ', 'bash', { command: 'ls' }), // same call, different id
    toolRes('call_ZZZ', 'out'),
    asst('call_YYY', 'read', { filePath: '/a' }),
    toolRes('call_YYY', 'out2'),
  ]
  const p = s.plan(turn2WithRemintedIds)
  assert.equal(p.action, 'delta', 'differing ids alone must not force a re-seed')
  assert.equal(p.delta.length, 2)
})

test('an exact repeat with no new messages is a duplicate, not a delta', () => {
  // opencode retrying the identical array has nothing new to append, so there
  // is no delta to send; re-seeding is the only correct response
  const base = [sys, user]
  const s = seeded(base)
  const turn = [...base, asst('call_A', 'bash', { command: 'ls' }), toolRes('call_A', 'out')]
  s.commit(s.plan(turn).incoming)
  const p = s.plan(turn)
  assert.equal(p.action, 'reseed')
  assert.match(p.reason, /duplicate/)
})

test('a lost projection re-seeds even when the prefix still matches', () => {
  const base = [sys, user]
  const s = seeded(base)
  s.invalidate() // e.g. the tab was closed
  const p = s.plan([...base, asst('c', 'bash', {}), toolRes('c', 'x')])
  assert.equal(p.action, 'reseed')
})
