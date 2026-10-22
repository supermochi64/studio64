// Robustness: edits made while the connection is down are kept and saved when it comes back
// (also across a reload), level operations undo and redo, and a crashed engine shows a
// friendly recovery card that restarts the game (in the castle when asked).
// @tags projects sync
// @timeout 600
import WebSocket from 'ws';
import { suite, api, URL_BASE, sleep } from '../lib/harness.mjs';

await suite('robustness', async (t) => {
  // ---- level operations undo/redo (over the websocket, like the editor) ----
  const { id: pid } = await api('/api/hub/create', { name: 'Undo levels' });
  const ws = new WebSocket(`${URL_BASE.replace('http', 'ws')}/ws`);
  let levels = [];
  let changes = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.type === 'welcome') { levels = m.levels; changes = m.changes; }
    if (m.type === 'levels') levels = m.levels;
    if (m.type === 'patch') changes = m.changes;
  });
  await new Promise((r) => ws.on('open', r));
  const send = (m) => ws.send(JSON.stringify(m));
  send({ type: 'hello', projectId: pid });
  await sleep(500);
  const names = () => levels.map((l) => l.name).join(',');
  send({ type: 'level_create', id: 'lvA', name: 'Alpha', template: 'flat', area: { objects: [{ uid: 77, entry: 'yellow_coin', x: 0, y: 0, z: 0, yaw: 0, bparams: 0, scale: 1 }], removals: [], warps: [] } });
  await sleep(300);
  send({ type: 'edit', op: { type: 'add', key: 'c:lvA', records: [{ uid: 78, entry: 'yellow_coin', x: 100, y: 0, z: 0, yaw: 0, bparams: 0, scale: 1 }], summary: 'Added a coin' } });
  await sleep(300);
  send({ type: 'level_rename', id: 'lvA', name: 'Alpha 2' });
  await sleep(300);
  send({ type: 'level_delete', id: 'lvA' });
  await sleep(300);
  t.eq('delete removes the level', names(), '');
  send({ type: 'undo' });
  await sleep(400);
  const back = await api(`/api/projects/${pid}/play.json`);
  t.check('undo delete: the level and its edits are back', names() === 'Alpha 2' && back.areas['c:lvA']?.objects?.length === 2 && changes.some((c) => c.summary === 'Added a coin'), { names: names(), n: back.areas['c:lvA']?.objects?.length });
  send({ type: 'undo' });
  await sleep(300);
  t.eq('undo rename', names(), 'Alpha');
  send({ type: 'redo' });
  await sleep(300);
  t.eq('redo rename', names(), 'Alpha 2');
  send({ type: 'level_duplicate', id: 'lvA' });
  await sleep(300);
  t.eq('duplicate', levels.length, 2);
  send({ type: 'undo' });
  await sleep(300);
  t.eq('undo duplicate', levels.length, 1);
  ws.close();

  // ---- offline edits ----
  const s = await t.open({ level: 9 });
  await s.page.waitForFunction(() => studio64.connected && studio64.testing, null, { timeout: 60000 });
  const before = (await api(`/api/projects/${s.projectId}/info`)).edits;
  // the connection drops; an edit happens before the app reconnects
  await s.eval(() => {
    studio64.ws.close();
    studio64.testing.send({ type: 'edit', op: { type: 'add', key: studio64.engine.areaKey(), records: [{ uid: 0x2100001, entry: 'yellow_coin', x: 0, y: 500, z: 0, yaw: 0, bparams: 0, scale: 1, name: 'Coin' }], summary: 'Offline coin' } });
  });
  const shown = await s.eval(() => document.querySelector('#save-state').textContent);
  t.check('the edit waits and the app says so', /Offline/.test(shown), shown);
  await s.page.waitForFunction(() => studio64.connected, null, { timeout: 30000 });
  await s.wait(1500);
  t.eq('after reconnecting it is saved', (await api(`/api/projects/${s.projectId}/info`)).edits, before + 1);
  // offline, then the page is reloaded: the edit survives in the browser and is sent after
  await s.eval(() => {
    studio64.ws.onclose = null;
    studio64.ws.close();
    studio64.testing.send({ type: 'edit', op: { type: 'add', key: studio64.engine.areaKey(), records: [{ uid: 0x2100002, entry: 'yellow_coin', x: 200, y: 500, z: 0, yaw: 0, bparams: 0, scale: 1, name: 'Coin' }], summary: 'Offline coin 2' } });
  });
  await s.reload();
  await s.page.waitForFunction(() => studio64.connected, null, { timeout: 30000 });
  await s.wait(1500);
  t.eq('an offline edit survives a reload', (await api(`/api/projects/${s.projectId}/info`)).edits, before + 2);

  // ---- crash recovery ----
  t.allowConsole(/engine crash/);
  await s.eval(() => studio64.engine.emit('crash', 'RuntimeError: memory access out of bounds (test)'));
  await s.wait(300);
  const card = await s.eval(() => ({ shown: !document.querySelector('#crash').hidden, text: document.querySelector('#crash').textContent }));
  t.check('a crash shows the recovery card', card.shown && /The game crashed/.test(card.text) && /Restart in the castle/.test(card.text) && /in \d/.test(card.text), card.text.slice(0, 200));
  await s.page.hover('#cr-restart'); // stops the countdown
  await s.shot('crash');
  await s.wait(1500);
  t.check('hovering stops the automatic restart', !(await s.eval(() => document.querySelector('#crash').hidden)));
  await s.page.click('#cr-safe');
  await s.page.waitForLoadState('load');
  await s.booted();
  await s.page.waitForFunction(() => studio64.engine.level === 16 && studio64.engine.state().mario, null, { timeout: 90000 }).catch(() => {});
  t.eq('"Restart in the castle" goes to the castle grounds', await s.eval(() => studio64.engine.level), 16);
});
