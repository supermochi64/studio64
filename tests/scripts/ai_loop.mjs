// The studio's own agent loop against the scripted mock LLM, in all three
// dialects (OpenAI-compatible, Anthropic Messages, Ollama native), with the real
// Agent and its real tools; the browser is replaced by canned rpc answers.
//   node tests/scripts/ai_loop.mjs
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio64-ai-'));
process.env.STUDIO_AI_CONFIG = path.join(tmp, 'ai.json');
process.env.STUDIO_PROJECTS = path.join(tmp, 'projects');
delete process.env.OPENAI_API_KEY;

const { startMock, log } = await import('../lib/mock_llm.mjs');
const mock = await startMock(0);
const MOCK = `http://127.0.0.1:${mock.address().port}`;
const cfgMod = await import('../../server/ai/config.js');
const { Agent } = await import('../../server/agent.js');
const projects = await import('../../server/projects.js');
const { compact } = await import('../../server/ai/loop.js');

cfgMod.updateProvider('custom', { name: 'Mock', baseUrl: `${MOCK}/v1`, apiKey: 'mock-key', models: [{ id: 'mock-tools' }, { id: 'mock-notools' }] });
cfgMod.updateProvider('anthropic', { baseUrl: MOCK, apiKey: 'mock-key', models: [{ id: 'mock-tools' }] });
cfgMod.updateProvider('ollama', { baseUrl: MOCK, models: [{ id: 'mock-tools:latest' }] });
assert.equal(fs.statSync(process.env.STUDIO_AI_CONFIG).mode & 0o777, 0o600, 'config file is private');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const rpcs = [];
const events = [];
const hub = {
  broadcast: (_id, msg) => events.push(msg),
  patchChanged() {}, idle() {}, undo() { return null; },
  async rpc(_client, method, params) {
    rpcs.push({ method, params });
    if (method === 'state') return { level: 'Bob-omb Battlefield', mario: { x: 0, y: 0, z: 0 } };
    if (method === 'look') return { image: `data:image/png;base64,${PNG}`, state: { level: 'BoB' } };
    if (method === 'place') return { key: '9:1', level: 9, area: 1, placed: params.items.flatMap((it) => Array.from({ length: it.count || 1 }, (_, i) => ({ record: { uid: 100 + i, name: 'Bob-omb', x: 0, y: 0, z: 0 }, slot: 5 + i }))), errors: [] };
    if (method === 'build') return { key: '9:1', level: 9, area: 1, records: [{ uid: 200, name: 'Stairs', x: 0, y: 0, z: 0, block: { sy: 100 } }] };
    return {};
  },
};

const project = projects.createProject({ name: 'ai loop test' });
const agent = new Agent(hub, project);
const client = { id: 'test' };

async function turn(model, text) {
  await agent.setModel(model);
  assert.equal(agent.model, model, `model ${model} accepted`);
  events.length = 0;
  rpcs.length = 0;
  log.length = 0;
  await agent.send(`<game>Level: BoB</game>\n\n${text}`, client, text);
  const t0 = Date.now();
  while (agent.busy) {
    if (Date.now() - t0 > 20000) throw new Error('turn timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
  const done = events.find((e) => e.type === 'assistant_done');
  const textOut = events.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
  const tools = events.filter((e) => e.type === 'tool_start').map((e) => e.name);
  return { done, text: textOut, tools, requests: [...log] };
}

let pass = 0;
const ok = (name) => { pass++; console.log(`  ok  ${name}`); };

for (const [model, dialect] of [['@custom/mock-tools', 'openai'], ['@anthropic/mock-tools', 'anthropic'], ['@ollama/mock-tools:latest', 'ollama']]) {
  console.log(`\n${dialect} (${model})`);
  let r = await turn(model, 'Add 2 Bob-ombs in front of me');
  assert.equal(r.done.error, null, r.done.error);
  assert.deepEqual(r.tools, ['get_state', 'search_catalog', 'spawn']);
  const place = rpcs.find((x) => x.method === 'place');
  assert.equal(place.params.items[0].count, 2, 'string "2" repaired to the number 2');
  assert.match(r.text, /Added two Bob-ombs/);
  assert.equal(r.requests.length, 3);
  assert.ok(r.requests[0].body.tools.length >= 20, 'tools sent');
  ok('spawn through tools, parallel lookups, argument repair');

  r = await turn(model, 'look at the screen');
  assert.equal(r.done.error, null, r.done.error);
  const second = JSON.stringify(r.requests[1].body);
  if (dialect === 'openai') assert.match(second, /"image_url":\{"url":"data:image\/(png|jpeg);base64,/, "image sent");
  if (dialect === 'anthropic') assert.match(second, /"type":"tool_result".*"type":"image","source":\{"type":"base64","media_type":"image\/(png|jpeg)"/, "image sent");
  if (dialect === 'ollama') assert.match(second, /"images":\["iVBOR/, "image sent");
  ok('screenshots from look reach the model');

  r = await turn(model, 'bad args please');
  assert.equal(r.done.error, null);
  const results = JSON.stringify(r.requests[1].body.messages.slice(-2));
  assert.match(results, /invalid arguments for spawn/);
  assert.match(JSON.stringify(r.requests[2].body.messages.slice(-2)), /there is no tool/);
  assert.match(r.text, /Recovered/);
  ok('invalid arguments and unknown tools are answered, not fatal');

  r = await turn(model, 'build stairs');
  assert.deepEqual(r.tools, ['build']);
  ok('build');
}

console.log('\nfallbacks');
let r = await turn('@custom/mock-notools', 'hello there');
assert.equal(r.done.error, null, r.done.error);
assert.match(r.text, /Hello from the mock/);
assert.match(r.text, /can't use tools/);
assert.equal(cfgMod.modelInfo('@custom/mock-notools').tools, false, 'learned: no tools');
r = await turn('@custom/mock-notools', 'hello again');
assert.equal(r.requests.length, 1, 'no failing request first the second time');
assert.ok(!r.requests[0].body.tools, 'no tools sent');
ok('a model without tools falls back to plain chat and is remembered');

// stop in the middle of a slow tool loop
await agent.setModel('@custom/mock-tools');
events.length = 0;
await agent.send('<game>x</game>\n\ngo slow', client, 'go slow');
await new Promise((res) => setTimeout(res, 700));
await agent.interrupt();
while (agent.busy) await new Promise((res) => setTimeout(res, 20));
const stopped = events.find((e) => e.type === 'assistant_done');
assert.equal(stopped.error, 'Stopped.');
ok('stop button cancels the loop');

// the stored history is valid: every call answered, no images kept
const h = project.aiHistory;
for (let i = 0; i < h.length; i++) {
  const calls = h[i].content.filter((b) => b.type === 'tool_use').map((b) => b.id);
  if (!calls.length) continue;
  const answered = (h[i + 1]?.content || []).filter((b) => b.type === 'tool_result').map((b) => b.id);
  assert.deepEqual(answered.sort(), calls.sort(), `tool calls at ${i} answered`);
}
assert.ok(!JSON.stringify(h).includes(PNG), 'no images persisted');
ok(`history is valid (${h.length} messages) and has no images`);

// switching to the Claude SDK path hands over a transcript (checked without running Claude)
const { handoffNote } = await import('../../server/ai/loop.js');
project.chat.push({ role: 'user', text: 'next' });
const note = handoffNote(project, 'sdkSync');
assert.match(note, /Add 2 Bob-ombs/);
project.chat.pop();
ok('handoff transcript for the other side');

// compaction folds old turns into a summary and keeps the current turn
const big = [];
for (let i = 0; i < 30; i++) {
  big.push({ role: 'user', content: [{ type: 'text', text: `<game>state ${i}</game> request ${i} ${'x'.repeat(2000)}` }] });
  big.push({ role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: 'spawn', input: {} }] });
  big.push({ role: 'user', content: [{ type: 'tool_result', id: `t${i}`, name: 'spawn', content: [{ type: 'text', text: 'y'.repeat(5000) }] }] });
  big.push({ role: 'assistant', content: [{ type: 'text', text: `did ${i}` }] });
}
big.push({ role: 'user', content: [{ type: 'text', text: 'the current request' }] });
compact(big, 8000, 1000, big.length - 1);
assert.match(big[0].content[0].text, /Summary of the earlier conversation/);
assert.equal(big.at(-1).content.at(-1).text, 'the current request');
assert.ok(big[0].role === 'user');
ok(`compaction (${big.length} messages left)`);

// key handling: masked in public settings, dropped when the base URL changes
const pub = cfgMod.publicSettings();
assert.ok(!JSON.stringify(pub).includes('mock-key'), 'keys never in public settings');
cfgMod.updateProvider('custom', { baseUrl: 'http://127.0.0.1:1/v1' });
assert.equal(cfgMod.resolveProvider('custom').apiKey, '', 'a new base URL drops the stored key');
ok('keys masked; base URL change drops the key');

// friendly errors
cfgMod.updateProvider('custom', { baseUrl: `${MOCK}/v1`, apiKey: 'wrong' });
r = await turn('@custom/mock-tools', 'hello');
assert.match(r.done.error, /rejected the API key/);
cfgMod.updateProvider('custom', { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'x' });
r = await turn('@custom/mock-tools', 'hello');
assert.match(r.done.error, /Can't reach Mock/);
ok('friendly errors (bad key, server down)');

projects.flushAll?.();
mock.close();
console.log(`\n${pass} checks passed`);
process.exit(0);
