// A scripted fake LLM server for testing the studio's own agent loop without a
// real model. It speaks three dialects on one port:
//   POST /v1/chat/completions  (OpenAI-compatible, SSE streaming, chunked tool calls)
//   POST /v1/messages          (Anthropic Messages API, SSE)
//   POST /api/chat             (Ollama native, NDJSON)
// plus GET /v1/models, /api/tags. Scenarios pick tool calls from the user's
// latest message; every request is logged (GET /__log) so tests can check what
// the studio sent (tools, images, tool results).
//   node tests/lib/mock_llm.mjs [port]
import http from 'node:http';

// step n of a scenario = the n-th model call since the user's message.
// A step is { calls: [[name, args], ...] } or { text }.
const SCENARIOS = [
  { match: /ping tool/i, steps: [{ calls: [['ping', { word: 'hello' }]] }, { text: 'pong' }] },
  { match: /bob-?ombs?/i, steps: [
    { calls: [['get_state', {}], ['search_catalog', { query: 'bobomb', limit: '3' }]] }, // limit as a string: repaired to a number
    { calls: [['spawn', { items: [{ id: 'bobomb', count: '2', where: { mode: 'in_front' } }] }]] },
    { text: 'Added two Bob-ombs in front of you.' },
  ] },
  { match: /\blook\b|screen/i, steps: [
    { calls: [['look', {}]] },
    { text: 'I see the level. ' },
  ] },
  { match: /bad args/i, steps: [
    { calls: [['spawn', { items: 'nope' }]] }, // invalid: the loop must answer with an error the model can fix
    { calls: [['no_such_tool', {}]] },
    { text: 'Recovered from bad arguments.' },
  ] },
  { match: /stair/i, steps: [
    { calls: [['build', { kind: 'stairs', params: { steps: 8, material: 'castle stone' } }]] },
    { text: 'Built a staircase.' },
  ] },
  { match: /slow/i, steps: [
    { calls: [['get_state', {}]], delay: 400 },
    { calls: [['get_state', {}]], delay: 400 },
    { calls: [['get_state', {}]], delay: 400 },
    { calls: [['get_state', {}]], delay: 400 },
    { calls: [['get_state', {}]], delay: 400 },
    { text: 'done slowly' },
  ] },
  { match: /.*/, steps: [{ text: 'Hello from the mock model! I can chat.' }] },
];

export const log = [];

function lastUserText(messages, dialect) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return { text: m.content, index: i };
    if (Array.isArray(m.content)) {
      const t = m.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
      if (dialect === 'anthropic' && m.content.every((b) => b.type === 'tool_result')) continue;
      if (t && !/^Images returned by the tools/.test(t)) return { text: t, index: i };
    }
  }
  return { text: '', index: 0 };
}

function plan(messages, dialect) {
  const { text, index } = lastUserText(messages, dialect);
  const step = messages.slice(index + 1).filter((m) => m.role === 'assistant').length;
  const sc = SCENARIOS.find((s) => s.match.test(text.replace(/<game>[\s\S]*?<\/game>/, '').replace(/<earlier_chat>[\s\S]*?<\/earlier_chat>/, '')));
  return sc.steps[Math.min(step, sc.steps.length - 1)];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openaiReply(res, body, step) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  const base = { id: 'mock', object: 'chat.completion.chunk', model: body.model };
  res.write(': keep-alive\n\n');
  if (step.text) {
    for (const piece of step.text.match(/.{1,6}/g)) { send({ ...base, choices: [{ index: 0, delta: { content: piece } }] }); await sleep(5); }
    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10, cost: 0.0001 } });
  } else {
    step.calls.forEach(([name, args], i) => {
      const a = JSON.stringify(args);
      const half = Math.floor(a.length / 2);
      send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: `call_${i}_${Date.now()}`, type: 'function', function: { name, arguments: a.slice(0, half) } }] } }] });
      send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: i, function: { arguments: a.slice(half) } }] } }] });
    });
    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 10, cost: 0.0001 } });
  }
  res.end('data: [DONE]\n\n');
}

async function anthropicReply(res, body, step) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const ev = (type, o) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`);
  ev('message_start', { message: { id: 'msg_mock', role: 'assistant', content: [], usage: { input_tokens: 100, output_tokens: 1 } } });
  if (step.text) {
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    for (const piece of step.text.match(/.{1,6}/g)) ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: piece } });
    ev('content_block_stop', { index: 0 });
    ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } });
  } else {
    step.calls.forEach(([name, args], i) => {
      ev('content_block_start', { index: i, content_block: { type: 'tool_use', id: `toolu_${i}_${Date.now()}`, name, input: {} } });
      const a = JSON.stringify(args);
      ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: a.slice(0, 3) } });
      ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: a.slice(3) } });
      ev('content_block_stop', { index: i });
    });
    ev('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 10 } });
  }
  ev('message_stop', {});
  res.end();
}

async function ollamaReply(res, body, step) {
  res.writeHead(200, { 'content-type': 'application/x-ndjson' });
  const send = (o) => res.write(`${JSON.stringify({ model: body.model, ...o })}\n`);
  if (step.text) {
    for (const piece of step.text.match(/.{1,6}/g)) send({ message: { role: 'assistant', content: piece }, done: false });
  } else {
    send({ message: { role: 'assistant', content: '', tool_calls: step.calls.map(([name, args]) => ({ function: { name, arguments: args } })) }, done: false });
  }
  send({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 100, eval_count: 10 });
  res.end();
}

export function startMock(port = 0, { key = 'mock-key' } = {}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
    const auth = req.headers.authorization || (req.headers['x-api-key'] ? `Bearer ${req.headers['x-api-key']}` : '');
    if (url.pathname === '/__log') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(log)); return; }
    if (url.pathname === '/__clear') { log.length = 0; res.end('ok'); return; }
    const needsKey = !url.pathname.startsWith('/api/');
    if (needsKey && key && auth !== `Bearer ${key}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid API key', type: 'authentication_error' } }));
      return;
    }
    if (url.pathname === '/v1/models' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-tools' }, { id: 'mock-notools' }, { id: 'text-embedding-mock' }] }));
      return;
    }
    if (url.pathname === '/api/tags') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'mock-tools:latest', size: 1 }] }));
      return;
    }
    if (url.pathname === '/api/show') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ capabilities: ['completion', 'tools'], model_info: { 'llama.context_length': 32768 } }));
      return;
    }
    const dialect = url.pathname === '/v1/messages' ? 'anthropic' : url.pathname === '/api/chat' ? 'ollama' : url.pathname === '/v1/chat/completions' ? 'openai' : null;
    if (!dialect) { res.writeHead(404); res.end('{}'); return; }
    log.push({ dialect, body });
    if (body.model === 'mock-notools' && body.tools?.length) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `model ${body.model} does not support tools` } }));
      return;
    }
    const step = plan(body.messages, dialect);
    if (step.delay) await sleep(step.delay);
    if (dialect === 'openai') await openaiReply(res, body, step);
    else if (dialect === 'anthropic') await anthropicReply(res, body, step);
    else await ollamaReply(res, body, step);
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await startMock(Number(process.argv[2] || 8099));
  console.log(`mock LLM on http://127.0.0.1:${s.address().port}`);
}
