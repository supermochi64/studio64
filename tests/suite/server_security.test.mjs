// The server under abuse, without a browser: requests from other websites (CSRF, cross-site
// websockets), DNS rebinding (foreign Host names), the password (header, cookie for pictures and
// downloads, constant-time), malformed and huge requests, path traversal, hostile project files
// and links to projects that do not exist. Starts its own servers (one with STUDIO_PASSWORD).
// @tags smoke server
// @timeout 180
import { suite, ROOT } from '../lib/harness.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';
import WebSocket from 'ws';
import { zipWrite } from '../../server/zip.js';

const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

async function startServer(env) {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's64sec-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', STUDIO_PROJECTS: dir, STUDIO_SETUP: 'off', STUDIO_AI: 'off', STUDIO_PASSWORD: '', STUDIO_ALLOWED_HOSTS: '', ...env },
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 300 && !/running/.test(log); i++) await new Promise((r) => setTimeout(r, 100)); // (up to 30 s: a busy machine)
  return { base: `http://127.0.0.1:${port}`, port, dir, child, log: () => log, stop: () => { child.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } } };
}

// a raw request (fetch can't set Host / Origin freely)
function raw(base, p, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const u = new URL(base);
    const req = http.request({ host: u.hostname, port: u.port, path: p, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', (e) => resolve({ status: 0, text: e.message }));
    if (body) req.write(body);
    req.end();
  });
}

function wsTry(base, { origin, headers, hello } = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws', { origin, headers });
    const got = [];
    ws.on('open', () => ws.send(JSON.stringify(hello || { type: 'hello' })));
    ws.on('message', (d) => { got.push(JSON.parse(d)); if (got.length >= 1) { ws.close(); resolve({ open: true, msgs: got }); } });
    ws.on('unexpected-response', (_q, res) => resolve({ open: false, status: res.statusCode }));
    ws.on('error', (e) => resolve({ open: false, error: e.message }));
    setTimeout(() => { try { ws.close(); } catch { /* ignore */ } resolve({ open: true, msgs: got }); }, 4000);
  });
}

await suite('server security', async (t) => {
  const open = await startServer({});
  const locked = await startServer({ STUDIO_PASSWORD: 'sesame' });
  try {
    t.must('open server started', /running/.test(open.log()), open.log());
    t.must('password server started', /running/.test(locked.log()), locked.log());
    const B = open.base;
    const json = { 'content-type': 'application/json' };

    // ---- other websites (CSRF) and DNS rebinding
    let r = await raw(B, '/api/hub/create', { method: 'POST', headers: { origin: 'http://evil.example', 'content-type': 'text/plain' }, body: '{"name":"pwned"}' });
    t.eq('a POST from another website is refused', r.status, 403);
    r = await raw(B, '/api/hub/create', { method: 'POST', headers: { origin: 'null', ...json }, body: '{"name":"x"}' });
    t.eq('a POST from an opaque origin (sandbox, file://) is refused', r.status, 403);
    r = await raw(B, '/api/hub/create', { method: 'POST', headers: { origin: B, ...json }, body: '{"name":"mine"}' });
    t.eq('a POST from the studio itself works', r.status, 200);
    const pid = JSON.parse(r.text).id;
    r = await raw(B, '/api/hub/projects', { headers: { host: `evil.example:${open.port}` } });
    t.eq('a foreign host name (DNS rebinding) is refused without a password', r.status, 403);
    t.check('... with a message that says what to do', /STUDIO_PASSWORD/.test(r.text), r.text);
    r = await raw(B, '/api/hub/projects', { headers: { host: `localhost:${open.port}` } });
    t.eq('localhost works', r.status, 200);
    r = await raw(B, '/', { headers: { host: `studio.localhost:${open.port}` } });
    t.eq('*.localhost works', r.status, 200);
    let w = await wsTry(B, { origin: 'http://evil.example' });
    t.check('a websocket from another website is refused', !w.open, w);
    w = await wsTry(B, { headers: { host: `evil.example:${open.port}` } });
    t.check('a websocket under a foreign host name is refused', !w.open, w);
    w = await wsTry(B, { origin: B, hello: { type: 'hello', projectId: pid } });
    t.eq('a websocket from the studio itself gets its project', w.msgs?.[0]?.project?.id, pid);

    // ---- a link to a project that is not there: said so, no new project made
    const before = JSON.parse((await raw(B, '/api/hub/projects')).text).length;
    w = await wsTry(B, { hello: { type: 'hello', projectId: 'gone12345' } });
    t.eq('hello for a missing project answers no_project', w.msgs?.[0]?.type, 'no_project');
    w = await wsTry(B, { hello: { type: 'hello', projectId: '../../etc/passwd' } });
    t.eq('hello with a hostile id answers no_project', w.msgs?.[0]?.type, 'no_project');
    t.eq('no project was made for them', JSON.parse((await raw(B, '/api/hub/projects')).text).length, before);

    // ---- malformed and huge requests: clear 4xx answers, never a 500 or a dropped connection
    r = await raw(B, '/api/hub/create', { method: 'POST', headers: json, body: '{bad' });
    t.eq('broken JSON is a 400', r.status, 400);
    t.check('... with a plain message', /not valid JSON/.test(r.text), r.text);
    r = await raw(B, '/api/projects', { method: 'POST', headers: json, body: Buffer.alloc(6e6, 32) });
    t.eq('a too large JSON body is a 413 (not a dropped connection)', r.status, 413);
    r = await raw(B, `/api/projects/${pid}/assets/files?kind=png&name=big.png`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.alloc(33 * 1024 * 1024, 1) });
    t.eq('a too large asset upload is a 413 (not a dropped connection)', r.status, 413);
    r = await raw(B, '/%E0%A4%A');
    t.eq('a malformed URL is a 400', r.status, 400);
    for (const p of ['/../server/index.js', '/%2e%2e/server/index.js', '/..%2fserver%2findex.js', '/%2e%2e%2f%2e%2e%2fetc%2fpasswd', '/js/%00.js']) {
      r = await raw(B, p);
      t.check(`no file outside web/ for ${p}`, r.status === 403 || r.status === 404 || r.status === 400, r.status);
      t.check(`... nothing leaked for ${p}`, !/createServer|root:x:/.test(r.text));
    }
    for (const p of [`/api/projects/${pid}/assets/files/..%2f..%2f${pid}.json`, `/api/projects/${pid}/assets/files/....json`, '/api/projects/..%2f..%2fetc/info', `/api/projects/${pid}/versions/..%2findex/diff`]) {
      r = await raw(B, p);
      t.check(`asset / project / version routes refuse ${p}`, r.status >= 400 && r.status < 500 && !/"changes"/.test(r.text), `${r.status} ${r.text.slice(0, 120)}`);
    }

    // ---- hostile or broken project files
    for (const [what, body] of [['plain text', 'hello'], ['null', 'null'], ['a number', '5'], ['a broken zip', 'PK\u0003\u0004garbage'], ['a zip with a broken project.json', zipWrite([{ name: 'project.json', data: '{nope' }])]]) {
      r = await raw(B, '/api/hub/import', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body });
      t.eq(`importing ${what} is a 400`, r.status, 400);
      t.check(`... with a friendly message (${what})`, !/Cannot read|Unexpected token|undefined/.test(r.text), r.text);
    }
    // a project file that tries to write into another project's folder, or outside the projects folder
    const evil = zipWrite([
      { name: 'manifest.json', data: JSON.stringify({ format: 'studio64-hack', version: 2, name: 'evil' }) },
      { name: 'project.json', data: JSON.stringify({ id: 'evilid99', name: 'evil', areas: {} }) },
      { name: `files/assets/${pid}/files/planted.png`, data: 'x' },
      { name: 'files/../../planted.txt', data: 'x' },
      { name: `files/${pid}.json`, data: '{}' },
      { name: 'files/assets/{id}/files/mine.png', data: 'ok' },
    ]);
    r = await raw(B, '/api/hub/import', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: evil });
    t.eq('the hostile project file still imports', r.status, 200);
    const nid = JSON.parse(r.text).id;
    t.check('it did not plant a file in another project', !fs.existsSync(path.join(open.dir, 'assets', pid, 'files', 'planted.png')));
    t.check('it did not write outside the projects folder', !fs.existsSync(path.join(open.dir, '..', 'planted.txt')));
    t.check('its own files are there', fs.existsSync(path.join(open.dir, 'assets', nid, 'files', 'mine.png')));

    // ---- a client can't grow the project file without end with level pictures
    {
      const ws = new WebSocket(B.replace(/^http/, 'ws') + '/ws');
      await new Promise((r) => ws.on('open', r));
      ws.send(JSON.stringify({ type: 'hello', projectId: pid }));
      await new Promise((r) => setTimeout(r, 300));
      for (let i = 0; i < 600; i++) ws.send(JSON.stringify({ type: 'thumb', key: `9:${i}`, data: 'data:image/jpeg;base64,AAAA' }));
      ws.send(JSON.stringify({ type: 'thumb', key: '9:x', data: '<script>not a picture</script>' }));
      await new Promise((r) => setTimeout(r, 1200));
      ws.close();
      const doc = JSON.parse(fs.readFileSync(path.join(open.dir, `${pid}.json`), 'utf8'));
      t.check('level pictures are capped (400 per project)', Object.keys(doc.thumbs || {}).length <= 400, Object.keys(doc.thumbs || {}).length);
      t.check('a level picture must be a picture', !doc.thumbs?.['9:x']);
    }

    // ---- the password
    const L = locked.base;
    r = await raw(L, '/api/hub/projects');
    t.eq('the API needs the password', r.status, 401);
    r = await raw(L, '/api/hub/projects', { headers: { 'x-studio-key': 'sesam' } });
    t.eq('a wrong password is refused', r.status, 401);
    t.check('a wrong password sets no cookie', !r.headers['set-cookie']);
    r = await raw(L, '/api/config', { headers: { 'x-studio-key': 'sesame' } });
    const cookie = String(r.headers['set-cookie'] || '');
    t.check('the right password sets an HttpOnly, SameSite=Strict cookie', /studio64_auth=/.test(cookie) && /HttpOnly/.test(cookie) && /SameSite=Strict/.test(cookie), cookie);
    t.check('the cookie is not the password itself', !cookie.includes('sesame'));
    const jar = cookie.split(';')[0];
    r = await raw(L, '/api/hub/projects', { headers: { cookie: jar } });
    t.eq('the cookie opens the API (pictures, downloads, links)', r.status, 200);
    r = await raw(L, '/api/hub/projects', { headers: { cookie: 'studio64_auth=forged' } });
    t.eq('a forged cookie does not', r.status, 401);
    r = await raw(L, '/api/hub/create', { method: 'POST', headers: { 'x-studio-key': 'sesame', ...json }, body: '{"name":"locked"}' });
    const lid = JSON.parse(r.text).id;
    r = await raw(L, `/api/projects/${lid}/export.s64hack`, { headers: { cookie: jar } });
    t.check('a download link works with the cookie', r.status === 200 && r.text.startsWith('PK'), r.status);
    r = await raw(L, '/api/hub/projects', { headers: { host: `my-studio.example:${locked.port}`, 'x-studio-key': 'sesame' } });
    t.eq('with a password any host name works (shared servers)', r.status, 200);
    w = await wsTry(L, { hello: { type: 'hello', projectId: lid, password: 'nope' } });
    t.check('websocket: a wrong password says it was wrong', w.msgs?.[0]?.type === 'auth_required' && w.msgs[0].wrong === true, w.msgs);
    w = await wsTry(L, { headers: { cookie: jar }, hello: { type: 'hello', projectId: lid } });
    t.eq('websocket: the cookie is enough', w.msgs?.[0]?.project?.id, lid);
    w = await wsTry(L, { hello: { type: 'hello', projectId: lid, password: 'sesame' } });
    t.eq('websocket: the password works', w.msgs?.[0]?.project?.id, lid);
    t.check('no crash in the servers', !/TypeError|ReferenceError|uncaught/i.test(open.log() + locked.log()), (open.log() + locked.log()).slice(-800));
  } finally {
    open.stop();
    locked.stop();
  }
});
