// The Tool-Call Protocol (ticket 12): rendering opencode's tool schemas into
// prose Copilot will follow, and reading its prose reply back as tool_calls.
//
// Every choice here is forced by measured evidence:
//
//  - Payloads MUST sit inside a fenced code block. Copilot collapses whitespace
//    on inline-rendered content, and no extraction path can recover it.
//  - JSON is the right envelope precisely BECAUSE of that collapse: it is
//    whitespace-insensitive between tokens, and string contents arrive escaped
//    (\n, \t) as literal two-character sequences that collapse cannot touch. A
//    JSON payload flattened to one line parses to the identical object.
//  - The Preamble must be rendered slim (38,715 chars vs 43,502 as received) to
//    leave headroom under the 43,308 chars proven to send successfully.

/**
 * Pull JSON objects out of a reply by BRACE MATCHING, not by fence matching.
 *
 * Fence regexes break on the most common thing a coding agent returns: a final
 * answer whose content contains a fenced code block. `{"type":"final",
 * "content":"here:\n```js\n...\n```"}` makes a non-greedy fence match terminate
 * at the INNER closing fence and hand back a truncated object.
 *
 * Scanning braces while tracking JSON string state is immune to that — the
 * inner backticks are just characters inside a string literal.
 */
export function extractJsonCandidates(text) {
  const out = []
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{') continue
    let depth = 0
    let inStr = false
    let esc = false
    for (let i = start; i < text.length; i++) {
      const c = text[i]
      if (inStr) {
        if (esc) esc = false
        else if (c === '\\') esc = true
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') inStr = true
      else if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          out.push(text.slice(start, i + 1))
          start = i // don't rescan the interior for nested objects
          break
        }
      }
    }
  }
  return out
}

/** Strip the noise from a JSON Schema that costs characters and buys nothing.
 *  Measured: 24,084 -> 19,297 chars across opencode's ten tools. */
function slimSchema(schema) {
  const s = JSON.parse(JSON.stringify(schema))
  delete s.$schema
  for (const key of Object.keys(s.properties ?? {})) {
    const p = s.properties[key]
    // opencode emits JS Number.MAX_SAFE_INTEGER bounds on every integer field
    delete p.minimum
    delete p.maximum
  }
  return s
}

export function renderTools(tools) {
  return tools
    .map((t) => {
      const f = t.function ?? t
      return `### ${f.name}\n${(f.description ?? '').trim()}\nPARAMS: ${JSON.stringify(slimSchema(f.parameters ?? {}))}`
    })
    .join('\n\n')
}

export const PROTOCOL_RULES = `
# How you must reply

You are the reasoning engine for a command-line coding agent running on a USER'S OWN COMPUTER. You
do not talk to a human. Your replies are parsed by a program.

## You cannot do anything yourself

You have NO file system. You have NO shell. You have NO code interpreter. You are NOT on the user's
computer and you cannot see any of their files.

If you run a command in your own sandbox, you are running it on the WRONG MACHINE and the result is
worthless. Their file "src/app.js" does not exist in your environment, and never will.

The tools listed above are the ONLY way anything can happen. They execute on the USER'S computer.
To read a file, to run a command, to search — you must emit a tool_call and WAIT. The program will
run it for you and send you the real result in the next message.

NEVER run code yourself. NEVER report output you produced yourself. NEVER say "I couldn't find that
file" — you cannot look; only the tools can.

## Reply format

EVERY reply must be EXACTLY ONE fenced code block tagged json, and NOTHING outside it. No greeting,
no explanation before or after, no second block.

To use a tool — this is what you should almost always do first:
\`\`\`json
{"type":"tool_call","name":"<tool name>","arguments":{ ... }}
\`\`\`

To give the final answer, ONLY once the tools have given you everything you need:
\`\`\`json
{"type":"final","content":"<your answer>"}
\`\`\`

## Worked example

If asked "how many lines are in src/protocol.mjs", the ONLY correct reply is:

\`\`\`json
{"type":"tool_call","name":"bash","arguments":{"command":"wc -l src/protocol.mjs","description":"count lines"}}
\`\`\`

Not an answer. Not an attempt to run it yourself. Not an apology that the file is missing. A tool
call, and then you wait for the result.

## Rules

- Newlines inside any string value MUST be written as the two characters \\n, never as real line
  breaks. Same for tabs (\\t) and quotes (\\").
- Use only the tools listed above, with exactly the parameter names given.
- One tool call per reply. You will be sent the result and can then call another.
- Never wrap the JSON in prose. Never apologise. Never explain your reasoning outside the JSON.
- If you are about to answer from your own knowledge about the user's files, STOP and emit a
  tool_call instead.
`.trim()

/**
 * How much of opencode's own system prompt to forward.
 *
 * Forwarding all 20KB of it measurably HURTS: in front of a chat model it drowns
 * the output contract and encourages Copilot to answer in its own voice —
 * observed refusing to emit tool calls and instead running commands in its own
 * sandbox. So it must be reduced.
 *
 * But reducing it by TRUNCATION was a mistake: the head of the document is CLI
 * boilerplate (/help, feedback URLs) while everything that governs tool use
 * lives further down. Measured on opencode 1.18.4, truncating at 1500 chars kept
 * "Tone and style" and dropped "Tool usage policy", "Doing tasks", "Following
 * conventions" and "Code References" — and 7 of the 10 tools were mentioned
 * ONLY in the discarded portion.
 *
 * We now select by section instead, keeping what governs behaviour and dropping
 * what does not apply.
 */
export const SYSTEM_PROMPT_BUDGET = 12000

/**
 * Sections dropped outright, with the reason.
 *
 * "Tone and style" governs prose formatting, verbosity and how to address the
 * user in a terminal. Our contract says the reply is exactly one JSON block and
 * is parsed by a program, never read by a human — so this section is not merely
 * useless here, it argues against the thing we most need Copilot to do.
 */
const EXCLUDED_SECTIONS = [/^tone and style$/i]

/** Most load-bearing first. Anything unlisted keeps its original order after these. */
const SECTION_PRIORITY = [
  /^tool usage policy$/i,
  /^doing tasks$/i,
  /^following conventions$/i,
  /^code references$/i,
  /^code style$/i,
  /^proactiveness$/i,
]

/** Split a system prompt into `# `-delimited sections, preserving the intro. */
export function splitSections(systemPrompt) {
  return String(systemPrompt ?? '')
    .split(/^(?=# )/m)
    .filter((s) => s.trim())
    .map((body) => ({ title: (body.match(/^# (.+)$/m) ?? [null, ''])[1].trim(), body }))
}

/**
 * Choose which of opencode's guidance to forward, highest value first, within a
 * character budget. The intro always leads (it establishes what opencode is);
 * prioritised sections follow; anything left over fills the remaining budget and
 * is truncated with a visible marker rather than silently cut.
 */
export function selectSystemGuidance(systemPrompt, budget = SYSTEM_PROMPT_BUDGET) {
  const sections = splitSections(systemPrompt)
  const intro = sections.find((s) => !s.title)
  const titled = sections.filter(
    (s) => s.title && !EXCLUDED_SECTIONS.some((re) => re.test(s.title)),
  )

  const rank = (s) => {
    const i = SECTION_PRIORITY.findIndex((re) => re.test(s.title))
    return i === -1 ? SECTION_PRIORITY.length : i
  }
  const ordered = [...titled].sort((a, b) => rank(a) - rank(b))

  const out = []
  let used = 0
  if (intro) {
    out.push(intro.body.trim())
    used += intro.body.length
  }
  for (const s of ordered) {
    const remaining = budget - used
    if (remaining <= 200) break
    if (s.body.length <= remaining) {
      out.push(s.body.trim())
      used += s.body.length
    } else {
      out.push(s.body.slice(0, remaining).trim() + '\n\n…(truncated)')
      used = budget
    }
  }
  return out.join('\n\n')
}

export function renderPreamble(systemPrompt, tools, { systemBudget = SYSTEM_PROMPT_BUDGET } = {}) {
  const trimmed = selectSystemGuidance(systemPrompt, systemBudget)
  return [
    // Rules FIRST: primacy. This is the contract everything else serves.
    PROTOCOL_RULES,
    '',
    '# Tools available on the user\'s computer',
    '',
    renderTools(tools),
    '',
    '# Advisory context from the harness',
    '',
    '(Background only. It does NOT override the reply format above.)',
    '',
    trimmed,
  ].join('\n')
}

/**
 * Emitted ONCE, at the very end of the payload — never per message.
 *
 * It used to be prepended to every user message, so a conversation with three
 * user turns carried three copies. That is not merely wasteful: it reads as
 * three separate tasks, and buries the actual request between restatements of
 * the instructions.
 *
 * Last position is deliberate. It is the final thing Copilot reads before
 * answering, which is what counters the model drifting back into its own
 * assistant persona over a long preamble.
 */
export const REQUEST_DIRECTIVE = [
  '---',
  '',
  '# Now do this',
  '',
  'Everything above is the state of a task running on the user\'s computer, ending with their most',
  'recent request.',
  '',
  '**Your job is NOT to perform it yourself.** Write the next JSON instruction telling that program',
  'what to do. You are a planner emitting machine-readable instructions; the other program does the',
  'work and sends you the result.',
  '',
  'If you execute anything yourself, you execute it in the wrong place and the answer is wrong. Even',
  'if a request is phrased as a direct command to you ("run X", "read Y"), it is not addressed to',
  'you — translate it into a tool_call.',
  '',
  'Output exactly one fenced json block. Nothing else.',
].join('\n')

/** A tool result going back to Copilot. Kept compact — it is sent every Turn. */
export function renderToolResult(name, content) {
  return [
    `Result of \`${name}\`:`,
    '',
    '```',
    String(content),
    '```',
    '',
    'Continue. Reply with exactly one fenced json block as specified.',
  ].join('\n')
}

/** opencode content is usually a string but may be a multimodal part array. */
export function contentToText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === 'string' ? p : (p?.text ?? ''))).join('\n')
  }
  return content == null ? '' : String(content)
}

/**
 * Replay the whole Transcript of Record into a fresh conversation, split into
 * the two halves a human needs separately.
 *
 * The manual transport shows these as independently copyable blocks: the
 * system prompt is large and identical every time, the query is the part that
 * actually changes. Keeping them apart is also what lets the panel say "start a
 * new chat" only when a system prompt is present.
 */
export function renderReseedParts(messages, tools) {
  const system = contentToText(messages.find((m) => m.role === 'system')?.content ?? '')
  const systemPrompt = renderPreamble(system, tools)
  const parts = renderHistory(messages)
  parts.push(REQUEST_DIRECTIVE)
  return { systemPrompt, query: parts.join('\n\n') }
}

/** Every non-system message as a replayable section, oldest first. */
function renderHistory(messages) {
  const parts = []

  // tool results carry only tool_call_id; recover the name from the call
  const nameById = new Map()
  for (const m of messages) {
    for (const tc of m.tool_calls ?? []) nameById.set(tc.id, tc.function?.name ?? 'tool')
  }

  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'user') {
      // Plain label only. The directive is appended once at the end.
      parts.push(`## User request\n\n${contentToText(m.content)}`)
    } else if (m.role === 'assistant' && m.tool_calls?.length) {
      const tc = m.tool_calls[0]
      parts.push(
        `## You already called\n\n\`\`\`json\n{"type":"tool_call","name":"${tc.function?.name}","arguments":${tc.function?.arguments ?? '{}'}}\n\`\`\``,
      )
    } else if (m.role === 'assistant' && contentToText(m.content).trim()) {
      // A prose answer from an earlier turn. Without it a replayed chat holds
      // the user's follow-ups but none of the answers they were following up on.
      parts.push(
        `## You already answered\n\n\`\`\`json\n${JSON.stringify({ type: 'final', content: contentToText(m.content) })}\n\`\`\``,
      )
    } else if (m.role === 'tool') {
      parts.push(renderToolResult(nameById.get(m.tool_call_id) ?? 'tool', contentToText(m.content)))
    }
  }
  return parts
}

/** The single-blob form, unchanged, for the composer path. */
export function renderReseed(messages, tools) {
  const { systemPrompt, query } = renderReseedParts(messages, tools)
  return `${systemPrompt}\n\n${query}`
}

/** The incremental case: render only what opencode appended this Turn. */
export function renderDelta(delta) {
  let hasUser = false
  const nameById = new Map()
  for (const m of delta) {
    for (const tc of m.tool_calls ?? []) nameById.set(tc.id, tc.function?.name ?? 'tool')
  }
  const out = []
  for (const m of delta) {
    if (m.role === 'user') {
      out.push(`## User request\n\n${contentToText(m.content)}`)
      hasUser = true
    } else if (m.role === 'tool') {
      out.push(renderToolResult(nameById.get(m.tool_call_id) ?? 'tool', contentToText(m.content)))
    }
    // assistant tool_call messages are OUR own previous reply — Copilot already
    // has them in the projection, so re-sending would duplicate its own words
  }
  // A tool result already ends with its own "continue" instruction; a fresh user
  // request in a delta needs the full directive, but still only once.
  if (hasUser) out.push(REQUEST_DIRECTIVE)
  return out.join('\n\n')
}

/** Sent when a delta renders to nothing (opencode appended only assistant
 *  messages). Without this the composer would be filled with '', the Send
 *  button would never appear, and the Turn would hang until its timeout. */
export const CONTINUE_NUDGE =
  'Continue. Reply with exactly one fenced json block as specified.'

// ------------------------------------------------------- tool-less requests

/**
 * What a request with no tools is for.
 *
 * opencode makes several model calls with an empty tool set (verified in the
 * 1.18.4 binary: `tools:{}`, and no placeholder tool for a custom provider):
 *
 *  - 'title'      session titles and short task names. Cosmetic; answered locally.
 *  - 'compaction' "summarise the history so far", sent when the session nears the
 *                 context limit or on /compact. opencode REPLACES the older
 *                 history with the answer, so a made-up reply silently erases
 *                 the conversation. It must reach the model.
 *  - 'other'      anything else. Relayed, because guessing an answer is worse
 *                 than asking for one.
 *
 * Only the system prompt and the request itself are inspected, never the
 * history, so a user who happens to type "generate a title" mid-task does not
 * turn a compaction into a title.
 */
const TITLE_RE = /You are a title generator|^Generate a title for this conversation|^Generate a short 2-3 word name/
const COMPACTION_RE = /context summarization assistant|anchored summary/i

export function classifyToollessRequest(messages) {
  const system = contentToText(messages.find((m) => m.role === 'system')?.content ?? '')
  const users = messages.filter((m) => m.role === 'user')
  const first = contentToText(users[0]?.content ?? '')
  const last = contentToText(users.at(-1)?.content ?? '')
  if (TITLE_RE.test(system) || TITLE_RE.test(first)) return 'title'
  if (COMPACTION_RE.test(system) || COMPACTION_RE.test(last)) return 'compaction'
  return 'other'
}

/**
 * The closing instruction for a tool-less request.
 *
 * Plain text, not the JSON envelope: these answers are long Markdown (a
 * compaction summary has sections and bullets), and asking for that inside a
 * JSON string invites broken escapes. parseTextReply accepts the envelope too,
 * in case the chat sticks to the format it was taught.
 */
export const TEXT_ONLY_DIRECTIVE = [
  '---',
  '',
  '# Now do this',
  '',
  'This request is different from the others. It has no tools, and the program wants a written',
  'answer, not a tool call. Do not try to run anything.',
  '',
  'Reply with your answer as plain text (Markdown is fine). No JSON block this time, and no',
  'commentary about the request.',
].join('\n')

const TEXT_ONLY_PREAMBLE = [
  '# How you must reply',
  '',
  'You are helping a command-line coding agent. A program sends you its requests and reads your',
  'reply. This request needs a written answer only: there are no tools, and you cannot run anything.',
].join('\n')

function splitTextRequest(messages) {
  const system = contentToText(messages.find((m) => m.role === 'system')?.content ?? '').trim()
  let lastUser = -1
  messages.forEach((m, i) => {
    if (m.role === 'user') lastUser = i
  })
  return {
    system,
    history: lastUser === -1 ? messages : messages.slice(0, lastUser),
    request: lastUser === -1 ? '' : contentToText(messages[lastUser].content),
  }
}

/**
 * A tool-less request pasted into the chat that already holds the conversation.
 *
 * Only the instruction is sent: the chat has the history. That is what makes
 * compaction affordable at all, since it fires precisely when the history has
 * grown too large to paste again.
 */
export function renderTextRequest(messages) {
  const { system, request } = splitTextRequest(messages)
  return [
    '## A request from the program',
    ...(system ? ['', system] : []),
    '',
    request,
    '',
    TEXT_ONLY_DIRECTIVE,
  ].join('\n')
}

/** The same request for a brand-new chat, which needs the history replayed. */
export function renderTextRequestParts(messages) {
  const { system, history, request } = splitTextRequest(messages)
  const systemPrompt = system
    ? `${TEXT_ONLY_PREAMBLE}\n\n# Instructions from the program\n\n${system}`
    : TEXT_ONLY_PREAMBLE
  const parts = renderHistory(history)
  parts.push(`## The request\n\n${request}`, TEXT_ONLY_DIRECTIVE)
  return { systemPrompt, query: parts.join('\n\n') }
}

/**
 * Read the answer to a tool-less request.
 *
 * The whole reply is the answer, unless it is nothing but one JSON envelope: a
 * final is unwrapped, and a tool_call is refused, because there are no tools to
 * run it with. An envelope merely QUOTED inside a longer answer (a summary that
 * mentions a tool call it made) is left alone.
 */
export function parseTextReply(text) {
  if (QUOTA_RE.test(text)) {
    throw new ProtocolError('Copilot daily quota exhausted', 'quota', text)
  }
  const trimmed = String(text).trim()
  if (!trimmed) throw new ProtocolError('empty reply', 'empty', text)

  const bare = trimmed.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, '$1').trim()
  if (bare.startsWith('{') && bare.endsWith('}')) {
    let obj = null
    try {
      obj = JSON.parse(bare)
    } catch {
      // not an envelope; the text is the answer
    }
    if (obj?.type === 'final') return { type: 'final', content: String(obj.content ?? '') }
    if (obj?.type === 'tool_call') {
      throw new ProtocolError('tool_call on a request with no tools', 'no-tools', text)
    }
  }
  return { type: 'final', content: trimmed }
}

// ------------------------------------------------------------------ parsing

export class ProtocolError extends Error {
  constructor(message, kind, raw) {
    super(message)
    this.kind = kind // 'no-block' | 'bad-json' | 'bad-shape' | 'quota' | 'no-tools' | 'empty'
    this.raw = raw
  }
}

// Copilot's quota notice arrives as an ordinary-looking assistant reply. It must
// be recognised explicitly or it gets parsed as a malformed tool call and
// pointlessly retried. Measured wording, see ticket 18.
const QUOTA_RE = /reached your daily chat limit|check back tomorrow/i

/**
 * Tolerant on the outside, strict on the inside.
 *
 * Salvage is deliberately limited to things that cannot change meaning —
 * locating the block, trimming whitespace. We do NOT repair broken JSON by
 * guessing (no comma insertion, no quote balancing): a plausible-but-wrong tool
 * call is far worse than a re-ask, because it executes.
 */
export function parseReply(text) {
  if (QUOTA_RE.test(text)) {
    throw new ProtocolError('Copilot daily quota exhausted', 'quota', text)
  }

  const candidates = extractJsonCandidates(text)
  if (candidates.length === 0) {
    throw new ProtocolError('no json object in reply', 'no-block', text)
  }

  // Prefer the LAST candidate that both parses and carries a known envelope
  // type: if Copilot preambles with a format example, the real answer is the one
  // it ended on. Falling back to the last parseable object keeps the error
  // message useful when nothing matches.
  let obj = null
  let candidate = candidates[candidates.length - 1]
  let lastParseError = null
  for (let i = candidates.length - 1; i >= 0; i--) {
    let parsed
    try {
      parsed = JSON.parse(candidates[i])
    } catch (e) {
      lastParseError = e
      continue
    }
    if (parsed?.type === 'tool_call' || parsed?.type === 'final') {
      obj = parsed
      candidate = candidates[i]
      break
    }
    if (obj === null) {
      obj = parsed // remember a parseable-but-wrong-shape object for the error
      candidate = candidates[i]
    }
  }

  if (obj === null) {
    throw new ProtocolError(
      `no parseable json object: ${lastParseError?.message ?? 'unknown'}`,
      'bad-json',
      candidate,
    )
  }

  if (obj?.type === 'tool_call') {
    if (typeof obj.name !== 'string' || !obj.name) {
      throw new ProtocolError('tool_call missing name', 'bad-shape', candidate)
    }
    return { type: 'tool_call', name: obj.name, arguments: obj.arguments ?? {} }
  }
  if (obj?.type === 'final') {
    return { type: 'final', content: String(obj.content ?? '') }
  }
  throw new ProtocolError(`unknown type: ${JSON.stringify(obj?.type)}`, 'bad-shape', candidate)
}

/** The re-ask sent into the same Projection when parsing fails. Terse on
 *  purpose — explanation invites more prose, which is the failure we are fixing. */
export function repairPrompt(kind) {
  switch (kind) {
    case 'no-block':
      return 'Your reply had no fenced json block. Resend the SAME answer as exactly one ```json block, nothing else.'
    case 'bad-json':
      return 'That block was not valid JSON. Resend it as exactly one ```json block containing valid JSON, nothing else.'
    case 'no-tools':
      return 'There are no tools for this request, so a tool call cannot run. Answer it directly instead, as plain text.'
    case 'empty':
      return 'Your reply was empty. Answer the request above as plain text.'
    default:
      return 'Wrong shape. Resend as exactly one ```json block containing {"type":"tool_call","name":...,"arguments":{...}} or {"type":"final","content":...}, nothing else.'
  }
}
