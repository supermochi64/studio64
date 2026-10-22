// Browser test of "connect any LLM": open AI settings from the model menu, add an
// OpenAI-compatible endpoint (the scripted mock LLM, or a real provider), pick it
// for the project and build through the chat. Screenshots: tests/out/ai_*.png
//   node tests/lib/mock_llm.mjs 8099 &      # the fake model server
//   STUDIO_URL=http://127.0.0.1:8072 node tests/scripts/ai_providers.mjs
//   REAL=openrouter:qwen/qwen3.7-flash ... also runs one real turn (server needs OPENROUTER_API_KEY or a saved key)
import { chromium } from 'playwright';

const BASE = process.env.STUDIO_URL || 'http://127.0.0.1:8064';
const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:8099/v1';
const REAL = process.env.REAL || '';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('pageerror:', e.message); });
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) console.log('console.error:', m.text().slice(0, 300)); });
let failed = 0;
const check = (cond, name) => { console.log(`${cond ? '  ok ' : ' FAIL'} ${name}`); if (!cond) failed++; };

// a fresh project (the start page lists projects; ?p= opens one)
const { id: pid0 } = await (await fetch(`${BASE}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"level":9}' })).json();
await page.goto(`${BASE}/?p=${pid0}`);
await page.waitForSelector('#loading', { state: 'hidden', timeout: 180000 });
await page.waitForTimeout(2000);

async function openSettings() {
  await page.click('#model-btn');
  await page.click('#model-menu .ai-menu-settings');
  await page.waitForSelector('.ai-dialog .ai-hero');
}

async function chat(text) {
  const before = await page.evaluate(() => studio64.chatDone || 0);
  const changes = await page.evaluate(() => studio64.changes.length);
  await page.fill('#input', text);
  await page.press('#input', 'Enter');
  const t0 = Date.now();
  await page.waitForFunction((n) => (studio64.chatDone || 0) > n && !studio64.busy, before, { timeout: 240000, polling: 300 });
  await page.waitForTimeout(1200);
  const last = await page.evaluate(() => [...document.querySelectorAll('.msg.assistant')].pop().innerText);
  const added = await page.evaluate((c) => studio64.changes.length - c, changes);
  console.log(`--- [${((Date.now() - t0) / 1000).toFixed(1)}s] ${text}\n${last}\n`);
  return { last, added };
}

// 1. the dialog opens from the model menu on the Claude page
await openSettings();
await page.screenshot({ path: 'tests/out/ai_settings_claude.png' });
check(await page.isVisible('.ai-item[data-id=claude].sel'), 'settings open on the Claude page');

// 2. add the mock as a custom endpoint: name, URL, key, Connect
await page.click('[data-act=add-custom]');
await page.waitForSelector('[data-f=baseUrl]');
await page.fill('[data-f=name]', 'Mock LLM');
await page.fill('[data-f=baseUrl]', MOCK);
await page.fill('[data-f=key]', 'wrong-key');
await page.click('[data-act=connect]');
await page.waitForSelector('.ai-status.err', { timeout: 15000 });
check(/rejected the API key/.test(await page.textContent('.ai-status.err')), 'a wrong key gets a clear message');
await page.fill('[data-f=key]', 'mock-key');
await page.click('[data-act=connect]');
await page.waitForSelector('.ai-status.ok', { timeout: 15000 });
const status = await page.textContent('.ai-status.ok');
check(/Connected/.test(status) && /added/.test(status), `connect adds a first model (${status.trim()})`);
check(!(await page.content()).includes('mock-key'), 'the key is not in the page after saving');
await page.screenshot({ path: 'tests/out/ai_settings_custom.png' });
// the embedding model is filtered out, mock-notools is offered
check(!(await page.isVisible('[data-add="text-embedding-mock"]')), 'non-chat models are hidden');
await page.click('.ai-chosen [data-probe]');
await page.waitForSelector('.ai-probe', { timeout: 20000 });
check(/tools work/.test(await page.textContent('.ai-probe')), 'Test: the model calls tools');
await page.click('.ai-chosen [data-use]');
await page.keyboard.press('Escape');
check(!(await page.isVisible('.ai-dialog')), 'Esc closes the dialog');
const label = await page.textContent('#model-name');
check(label === 'mock-tools', `the model menu shows the new model (${label})`);

// 3. build through the chat with the mock model
let r = await chat('Add 2 Bob-ombs in front of me');
check(/Added two Bob-ombs/.test(r.last) && r.added === 1, 'mock model spawns Bob-ombs through the tools');
await page.screenshot({ path: 'tests/out/ai_chat_mock.png' });
r = await chat('look at the screen');
check(/I see the level/.test(r.last), 'look works (screenshot to the model)');
r = await chat('build stairs here');
check(r.added === 1, 'build works');

// 4. the model menu groups providers
await page.click('#model-btn');
await page.waitForTimeout(200);
await page.screenshot({ path: 'tests/out/ai_menu.png' });
const groups = await page.$$eval('#model-menu .menu-label', (xs) => xs.map((x) => x.textContent));
check(groups.includes('Claude (subscription)') && groups.includes('Mock LLM'), `menu groups: ${groups.join(', ')}`);
await page.keyboard.press('Escape');
await page.click('#messages');

// 5. a real provider (a few cents at most)
if (REAL) {
  const [pid, ...rest] = REAL.split(':');
  const mid = rest.join(':');
  await openSettings();
  await page.click(`.ai-item[data-id=${pid}]`);
  await page.waitForSelector('[data-act=connect]');
  await page.click('[data-act=connect]');
  await page.waitForSelector('.ai-status', { timeout: 30000 });
  console.log('connect:', (await page.textContent('.ai-status')).trim());
  await page.fill('[data-f=filter]', mid);
  await page.waitForTimeout(300);
  if (await page.isVisible(`[data-add="${mid}"]`)) await page.click(`[data-add="${mid}"]`);
  else { await page.fill('[data-f=manual]', mid); await page.click('[data-act=manual]'); }
  await page.waitForSelector(`[data-use="@${pid}/${mid}"]`);
  await page.screenshot({ path: 'tests/out/ai_settings_real.png' });
  await page.click(`[data-use="@${pid}/${mid}"]`);
  await page.keyboard.press('Escape');
  r = await chat('Add 2 Bob-ombs in front of me');
  check(r.added >= 1, `${REAL} spawns objects through the tools`);
  await page.screenshot({ path: 'tests/out/ai_chat_real.png' });
}

check(!errors.length, 'no page errors');
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
