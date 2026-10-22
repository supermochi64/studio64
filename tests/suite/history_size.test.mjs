// A long sculpting session keeps the project file small: terrain undo is stored as diffs of the
// touched cells (not a 66 KB copy per stroke), redo steps hold only what they need, the change
// list is bounded. Undo/redo stay exact, a second tab follows, export and versions still work.
// Server only (no browser); starts its own server so it can weigh the project file.
// @tags smoke server
// @timeout 240
import { suite, ROOT, sleep } from '../lib/harness.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import WebSocket from 'ws';

const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

function client(base, projectId) {
  const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
  const inbox = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'rpc') ws.send(JSON.stringify({ type: 'rpc_result', id: m.id, ok: false, error: 'no game' })); inbox.push(m); });
  const next = async (type, ms = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const i = inbox.findIndex((m) => m.type === type); if (i >= 0) return inbox.splice(i, 1)[0]; await sleep(20); }
    throw new Error(`no ${type} [server: ${globalThis.__log?.() || ''}] (got ${inbox.map((m) => m.type + (m.message ? ":" + m.message : "")).join(", ")})`);
  };
  const opened = new Promise((r) => ws.on('open', r));
  return { ws, inbox, next, send: (m) => ws.send(JSON.stringify(m)), hello: async () => { await opened; ws.send(JSON.stringify({ type: 'hello', projectId })); return next('welcome'); } };
}

// a 128×128 terrain like the studio's (web/js/terrain.js encode)
const N = 128;
const enc = (h, m) => ({ nx: N, nz: N, cell: 64, x0: -4096, z0: -4096, h: Buffer.from(h.buffer, h.byteOffset, h.byteLength).toString('base64'), m: Buffer.from(m).toString('base64') });
function stroke(h, m, k) {
  const cx = 10 + ((k * 37) % 100), cz = 10 + ((k * 53) % 100);
  for (let j = cz - 4; j <= cz + 4; j++) for (let i = cx - 4; i <= cx + 4; i++) h[j * (N + 1) + i] += 7 + (k % 5);
  if (k % 3 === 0) for (let j = cz - 2; j < cz + 2; j++) for (let i = cx - 2; i < cx + 2; i++) m[j * N + i] = (k % 7) + 1;
}

await suite('history size', async (t) => {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's64hist-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', STUDIO_PROJECTS: dir, STUDIO_SETUP: 'off', STUDIO_AI: 'off', STUDIO_PASSWORD: '' },
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  globalThis.__log = () => log.slice(-700);
  try {
    for (let i = 0; i < 200 && !/running/.test(log); i++) await sleep(100);
    t.must('server started', /running/.test(log), log);
    const B = `http://127.0.0.1:${port}`;
    const post = (p, body) => fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json());
    const { id } = await post('/api/hub/create', { name: 'sculpt marathon', template: 'empty' });
    const a = client(B, id), b = client(B, id);
    await a.hello(); await b.hello();
    const key = 'c:lvl1:1';
    const h = new Int16Array((N + 1) * (N + 1)), m = new Uint8Array(N * N);
    const states = [enc(h, m)];
    a.send({ type: 'edit', op: { type: 'area', key, field: 'terrain', value: states[0], summary: 'New terrain' } });
    await a.next('patch');
    const STROKES = 200;
    for (let k = 0; k < STROKES; k++) {
      stroke(h, m, k);
      states.push(enc(h, m));
      a.send({ type: 'edit', op: { type: 'area', key, field: 'terrain', value: states[states.length - 1], summary: 'Raised the terrain' } });
      await a.next('patch');
    }
    await sleep(800); // the debounced save
    const file = path.join(dir, `${id}.json`);
    const size = fs.statSync(file).size;
    const one = JSON.stringify(states[0]).length;
    console.log(`  project file after ${STROKES} strokes: ${(size / 1024).toFixed(0)} KB (one terrain copy: ${(one / 1024).toFixed(0)} KB)`);
    t.check(`the project file stays small after ${STROKES} strokes (< 12 terrain copies)`, size < one * 12, `${size} bytes`);
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    t.check('terrain undo is stored as diffs', doc.changes.filter((c) => c.area?.diff).length === STROKES, doc.changes.filter((c) => c.area?.diff).length);
    t.check('every stroke is still undoable', doc.changes.filter((c) => c.area && (c.area.diff || c.area.before !== undefined)).length === STROKES + 1);

    // undo three strokes: exactly the terrain before each; the other tab gets it too
    const terrainNow = async (c) => { const msg = await c.next('patch'); return msg.patch.areas[key]?.terrain; };
    for (let u = 1; u <= 3; u++) {
      b.inbox.length = 0;
      a.inbox.length = 0;
      a.send({ type: 'undo' });
      const got = await terrainNow(a);
      t.check(`undo ${u}: the terrain is exactly the one before stroke ${STROKES - u + 1}`, got?.h === states[STROKES - u].h && got?.m === states[STROKES - u].m);
      const other = await terrainNow(b);
      t.check(`undo ${u}: the second tab has it too`, other?.h === states[STROKES - u].h);
    }
    // redo two: forward again, exactly
    for (let r = 1; r <= 2; r++) {
      a.inbox.length = 0;
      a.send({ type: 'redo' });
      const got = await terrainNow(a);
      t.check(`redo ${r}: exactly the terrain after stroke ${STROKES - 3 + r}`, got?.h === states[STROKES - 3 + r].h && got?.m === states[STROKES - 3 + r].m);
    }
    await sleep(800);
    const doc2 = JSON.parse(fs.readFileSync(file, 'utf8'));
    t.check('redo steps of terrain hold no terrain copy', (doc2.redo || []).every((r) => !r.areas && r.value === undefined), JSON.stringify(doc2.redo).length);
    // a new stroke after undo clears redo; undo it again works
    // (after 3 undos and 2 redos the terrain is states[STROKES - 1])
    const cur = Buffer.from(states[STROKES - 1].h, 'base64');
    const h2 = new Int16Array(cur.buffer.slice(cur.byteOffset, cur.byteOffset + cur.byteLength));
    const m2 = new Uint8Array(Buffer.from(states[STROKES - 1].m, 'base64'));
    stroke(h2, m2, 999);
    a.inbox.length = 0;
    a.send({ type: 'edit', op: { type: 'area', key, field: 'terrain', value: enc(h2, m2), summary: 'Raised the terrain' } });
    await a.next('patch');
    a.inbox.length = 0;
    a.send({ type: 'undo' });
    const back = await terrainNow(a);
    t.check('a stroke after undo is undone exactly too', back?.h === states[STROKES - 1].h);

    // a whole new terrain (other size) keeps a full copy and undoes exactly
    const big = { ...enc(new Int16Array(65 * 65), new Uint8Array(64 * 64)), nx: 64, nz: 64 };
    a.inbox.length = 0;
    a.send({ type: 'edit', op: { type: 'area', key, field: 'terrain', value: big, summary: 'Terrain from an image' } });
    await a.next('patch');
    a.inbox.length = 0;
    a.send({ type: 'undo' });
    t.check('replacing the terrain is undoable', (await terrainNow(a))?.h === states[STROKES - 1].h);

    // object undo/redo in the terrain's area keeps the terrain; sculpt strokes undo and redo
    const rec = { uid: 777001, block: { shape: 0, sx: 200, sy: 200, sz: 200 }, x: 0, y: 0, z: 0, yaw: 0 };
    a.inbox.length = 0;
    a.send({ type: 'edit', op: { type: 'add', key, summary: 'Placed a box', records: [rec] } });
    await a.next('patch');
    a.inbox.length = 0; a.send({ type: 'undo' });
    let pt = (await a.next('patch')).patch.areas[key];
    t.check('object undo: box gone, terrain kept', !pt.objects.some((o) => o.uid === 777001) && pt.terrain?.h === states[STROKES - 1].h);
    a.inbox.length = 0; a.send({ type: 'redo' });
    pt = (await a.next('patch')).patch.areas[key];
    t.check('object redo: box back, terrain kept', pt.objects.some((o) => o.uid === 777001) && pt.terrain?.h === states[STROKES - 1].h);
    a.inbox.length = 0;
    a.send({ type: 'edit', op: { type: 'sculpt', key: '9:1', stroke: { id: 'stk1', dabs: [[0, 100, 200, 300, 1, 0]] }, summary: 'Raised the level' } });
    await a.next('patch');
    a.inbox.length = 0; a.send({ type: 'undo' });
    t.check('sculpt undo removes the stroke', !((await a.next('patch')).patch.areas['9:1']?.sculpt || []).some((x) => x.id === 'stk1'));
    a.inbox.length = 0; a.send({ type: 'redo' });
    t.check('sculpt redo brings it back', ((await a.next('patch')).patch.areas['9:1']?.sculpt || []).some((x) => x.id === 'stk1'));

    // export and versions still carry the terrain
    const hack = await fetch(`${B}/api/projects/${id}/export.s64hack`);
    t.check('the project file exports', hack.status === 200 && (await hack.arrayBuffer()).byteLength > 1000);
    const v = await post(`/api/projects/${id}/versions`, { label: 'checkpoint' });
    a.inbox.length = 0;
    stroke(h2, m2, 1000);
    a.send({ type: 'edit', op: { type: 'area', key, field: 'terrain', value: enc(h2, m2), summary: 'Raised the terrain' } });
    await a.next('patch');
    const rr = await post(`/api/projects/${id}/versions/${v.id}/restore`);
    t.check('a version restores', rr.ok === true, rr);
    await sleep(500);
    const doc3 = JSON.parse(fs.readFileSync(file, 'utf8'));
    t.check('... with the terrain of that version', doc3.areas[key]?.terrain?.h === states[STROKES - 1].h);
    t.check('no server errors', !/TypeError|ReferenceError|\[ws\]/.test(log), log.slice(-600));
    a.ws.close(); b.ws.close();
  } finally {
    child.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
