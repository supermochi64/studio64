// The server without a browser: projects API, the live websocket (welcome, edits, undo, redo,
// levels, rename), export and import. Fast; catches a server that cannot start a project.
// @tags smoke server
import { suite, api, URL_BASE } from '../lib/harness.mjs';
import WebSocket from 'ws';

function client(projectId) {
  const ws = new WebSocket(URL_BASE.replace(/^http/, 'ws') + '/ws');
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    // answer the page's RPCs (the server asks for the game state before chats)
    if (m.type === 'rpc') ws.send(JSON.stringify({ type: 'rpc_result', id: m.id, ok: false, error: 'no game in this test' }));
    inbox.push(m);
    for (const w of waiters.splice(0)) w();
  });
  const next = (type, ms = 20000, pred = () => true) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    let done = false; // one waiter takes one message (old wake-ups must not eat later ones)
    const look = () => {
      if (done) return;
      const i = inbox.findIndex((m) => m.type === type && pred(m));
      if (i >= 0) { done = true; return resolve(inbox.splice(i, 1)[0]); }
      if (Date.now() - t0 > ms) { done = true; return reject(new Error(`no "${type}" message (got: ${inbox.map((m) => m.type + (m.message ? ":" + m.message : "")).join(", ")})`)); }
      waiters.push(look);
    };
    const timer = setInterval(() => { look(); if (done) clearInterval(timer); }, 200);
    look();
  });
  const opened = new Promise((r) => ws.on('open', r));
  return { ws, inbox, next, opened, send: (m) => { inbox.length = 0; ws.send(JSON.stringify(m)); }, hello: async () => { await opened; ws.send(JSON.stringify({ type: 'hello', projectId, level: 9 })); return next('welcome'); } };
}

await suite('server', async (t) => {
  const cfg = await api('/api/config');
  // (with no AI connected, STUDIO_AI=off, the list is empty and ai.available is false)
  t.check('config lists models (or says there is no AI)', Array.isArray(cfg.models) && (cfg.models.length > 0 || cfg.ai?.available === false), cfg);
  const cat = await api('/api/catalog');
  t.check('catalog served', cat.entries?.length > 500);
  const { id } = await api('/api/projects', { level: 9, name: 'server test' });
  t.must('project created', !!id);
  const a = client(id), b = client(id);
  const w = await a.hello();
  t.eq('welcome has the project', w.project?.id, id);
  t.check('welcome has a patch', !!w.patch?.areas);
  await b.hello();

  // an edit from a reaches b
  const rec = { uid: 12345, block: { shape: 0, sx: 300, sy: 300, sz: 300 }, x: 0, y: 0, z: 0, yaw: 0 };
  b.inbox.length = 0;
  a.send({ type: 'edit', op: { type: 'add', key: '9:1', summary: 'Placed a box', records: [rec] } });
  const ops = await b.next('apply_ops');
  t.eq('b gets the spawn', ops.ops.spawn?.[0]?.uid, 12345);
  let p = await b.next('patch');
  t.check('patch has the box', p.patch.areas['9:1'].objects.some((o) => o.uid === 12345));
  // move it, undo the move: the record is as before (no leftover fields)
  const nChanges = (m) => m.changes.length;
  a.send({ type: 'edit', op: { type: 'update', key: '9:1', uid: 12345, fields: { x: 500, scale: 2 }, summary: 'Moved' } });
  await a.next('patch', 20000, (m) => nChanges(m) === 2);
  a.send({ type: 'undo' });
  p = await a.next('patch', 20000, (m) => nChanges(m) === 1);
  const back = p.patch.areas['9:1'].objects.find((o) => o.uid === 12345);
  t.eq('undo of a move restores x', back?.x, 0);
  t.check('undo of a move drops fields it added', back && !('scale' in back), back);
  // redo the move
  a.send({ type: 'redo' });
  p = await a.next('patch', 20000, (m) => nChanges(m) === 2);
  const toast = await a.next('toast', 20000, (m) => /Redid/.test(m.message));
  t.eq('redo of the move', p.patch.areas['9:1'].objects.find((o) => o.uid === 12345)?.x, 500);
  t.check('redo toast', /Redid/.test(toast.message), toast);
  // undo everything, redo the add
  a.send({ type: 'undo' }); await a.next('patch', 20000, (m) => nChanges(m) === 1);
  a.send({ type: 'undo' }); p = await a.next('patch', 20000, (m) => nChanges(m) === 0);
  t.check('both undone', !p.patch.areas['9:1'].objects.length && !p.changes.length);
  a.send({ type: 'redo' }); p = await a.next('patch', 20000, (m) => nChanges(m) === 1);
  const redoOps = await a.next('apply_ops', 20000, (m) => (m.ops.restore || []).length > 0);
  t.check('redo brings the box back', p.patch.areas['9:1'].objects.some((o) => o.uid === 12345));
  t.check('redo tells the pages to spawn it', redoOps.ops.restore?.some((r) => r.record.uid === 12345), redoOps.ops);
  // a new edit clears the redo stack
  a.send({ type: 'edit', op: { type: 'add', key: '9:1', summary: 'Placed another', records: [{ ...rec, uid: 777 }] } });
  await a.next('patch', 20000, (m) => m.patch.areas['9:1'].objects.some((o) => o.uid === 777));
  a.send({ type: 'redo' });
  t.check('nothing to redo after a new edit', !!(await a.next('toast', 20000, (m) => /Nothing to redo/.test(m.message)).catch(() => null)));

  // custom levels
  b.inbox.length = 0;
  a.send({ type: 'level_create', id: 'lvltest', name: 'Lvl', template: 'flat', area: { objects: [], removals: [], warps: [], settings: { sky: 0 } } });
  const lv = await b.next('levels', 20000, (m) => m.levels.some((l) => l.id === 'lvltest'));
  t.check('level broadcast', lv.levels.some((l) => l.id === 'lvltest'));
  b.inbox.length = 0;
  a.send({ type: 'level_rename', id: 'lvltest', name: 'Renamed' });
  t.check('rename broadcast', !!(await b.next('levels', 20000, (m) => m.levels.some((l) => l.name === 'Renamed')).catch(() => null)));
  b.inbox.length = 0;
  a.send({ type: 'level_delete', id: 'lvltest' });
  t.check('delete broadcast', !!(await b.next('levels', 20000, (m) => !m.levels.some((l) => l.id === 'lvltest')).catch(() => null)));
  // project rename
  a.send({ type: 'rename', name: 'Server hack' });
  t.eq('project rename broadcast', (await b.next('renamed')).name, 'Server hack');

  // clearing all edits keeps the project's own levels
  a.send({ type: 'level_create', id: 'keepme', name: 'Keep me', template: 'flat', area: { objects: [{ uid: 4242, block: { shape: 0, sx: 100, sy: 100, sz: 100 }, x: 0, y: 0, z: 0, yaw: 0 }], removals: [], warps: [], terrain: 'abc', settings: { sky: 1 } } });
  await a.next('levels', 20000, (m) => m.levels.some((l) => l.id === 'keepme'));
  a.send({ type: 'reset_edits' });
  p = await a.next('patch', 20000, (m) => !(m.patch.areas['9:1']?.objects || []).length);
  t.check('clear all edits empties the original levels', !p.patch.areas['9:1'] || !p.patch.areas['9:1'].objects.length, p.patch.areas['9:1']);
  t.check('clear all edits keeps custom levels', p.patch.areas['c:keepme']?.terrain === 'abc' && p.patch.areas['c:keepme'].objects.length === 1, p.patch.areas['c:keepme']);

  // export / import
  const ex = await api(`/api/projects/${id}/export`);
  t.check('export has the areas', !!ex.areas?.['c:keepme']);
  a.ws.close(); b.ws.close();
  const list = await api('/api/projects');
  t.check('project listed', Array.isArray(list) && list.some((x) => x.id === id));
});
