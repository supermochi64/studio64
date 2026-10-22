// Studio 64 server: serves the web app and the game, keeps projects, and runs
// one Claude agent per project whose tools act on the player's browser.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { catalog, friendlyName, levelName } from './catalog.js';
import * as projects from './projects.js';
import { storyOf, storyEdit } from './story.js';
import { assetsOf, restoreAssetFiles } from './assets.js';
import { Agent } from './agent.js';
import { aiRoutes } from './ai/routes.js';
import { modelMenu, defaultModel, aiStatus, canRun } from './ai/config.js';
import { setupGate } from './setup/index.js';

// which Studio 64 folder this server runs from (tools/start.mjs: is the server on this port ours?)
const INSTANCE = (await import('node:crypto')).createHash('sha1').update(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')).digest('hex').slice(0, 12);
const here = path.dirname(fileURLToPath(import.meta.url));
// Route plug-ins: every server/routes/*.js default-exports (ctx) => ({ http?(req, res, url), ws?(msg, client, project) }),
// each returning true when it handled the request (see server/routes/README.md).
const ROUTE_PLUGINS = [];
fs.mkdirSync(path.join(here, 'routes'), { recursive: true });
for (const f of fs.readdirSync(path.join(here, 'routes')).filter((x) => x.endsWith('.js')).sort()) {
  try { ROUTE_PLUGINS.push((await import(`./routes/${f}`)).default); } catch (err) { console.error(`[routes] ${f} failed to load:`, err); }
}
let ROUTES = [];
const ROOT = path.resolve(here, '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const WEB = path.join(ROOT, 'web');
const PORT = Number(process.env.PORT || 8064);
const HOST = process.env.HOST || '127.0.0.1';
const PASSWORD = process.env.STUDIO_PASSWORD || '';

const VENDOR = {
  '/vendor/marked.js': path.join(ROOT, 'node_modules/marked/lib/marked.esm.js'),
  '/vendor/purify.js': path.join(ROOT, 'node_modules/dompurify/dist/purify.es.mjs'),
};
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

// The catalog the browser needs: ids, friendly names, behaviors, levels.
const clientCatalog = JSON.stringify({
  studioLevel: catalog.studio_level,
  levels: catalog.levels,
  behaviors: catalog.behaviors,
  entries: catalog.entries.map((e) => ({ index: e.index, id: e.id, name: friendlyName(e.id), params: e.params, prop: e.prop, behavior: e.behavior })),
});

// gzip big static files once
const gzCache = new Map();
function gzipped(file) {
  const st = fs.statSync(file);
  const hit = gzCache.get(file);
  if (hit && hit.mtime === st.mtimeMs) return hit.data;
  const data = zlib.gzipSync(fs.readFileSync(file), { level: 6 });
  gzCache.set(file, { mtime: st.mtimeMs, data });
  return data;
}

function sendFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    // always revalidate: a rebuilt engine must reach the browser on the next reload
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const headers = { 'content-type': type, 'cache-control': 'no-cache', etag };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
    if (/gzip/.test(req.headers['accept-encoding'] || '') && st.size > 50000) {
      const data = gzipped(file);
      res.writeHead(200, { ...headers, 'content-encoding': 'gzip', 'content-length': data.length });
      res.end(data);
      return;
    }
    res.writeHead(200, { ...headers, 'content-length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
  res.end(body);
}

// A JSON request body. Too large: 413 (the rest of the upload is read and dropped, so the
// browser gets the answer instead of a broken connection); not JSON: 400.
function readBody(req, limit = 5e6) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (over) return;
      if (size > limit) { over = true; chunks.length = 0; reject(Object.assign(new Error(`the request is too large (limit ${Math.round(limit / 1e6)} MB)`), { status: 413 })); } else chunks.push(c);
    });
    req.on('end', () => { if (over) return; try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch { reject(Object.assign(new Error('the request is not valid JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}

// The password: the x-studio-key header (fetch) or the cookie the server sets once the header
// was right (pictures, downloads and links can't send headers). Compared in constant time.
const AUTH_COOKIE = 'studio64_auth';
const AUTH_TOKEN = PASSWORD ? crypto.createHmac('sha256', PASSWORD).update('studio64-session').digest('base64url') : '';
const sameSecret = (a, b) => { const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const cookieOf = (req, name) => (String(req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${name}=`)) || '').slice(name.length + 1);
const keyOk = (req) => !!PASSWORD && sameSecret(req.headers['x-studio-key'], PASSWORD);
const authorized = (req) => !PASSWORD || keyOk(req) || sameSecret(cookieOf(req, AUTH_COOKIE), AUTH_TOKEN);
const setAuthCookie = (req, res) => { if (keyOk(req)) res.setHeader('set-cookie', `${AUTH_COOKIE}=${AUTH_TOKEN}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`); };

// Other web pages may not drive the studio: a request from a page of another origin is refused
// (CSRF, cross-site websockets), and without a password only local host names reach the server
// (DNS rebinding). STUDIO_ALLOWED_HOSTS=name1,name2 allows more host names.
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', ...String(process.env.STUDIO_ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)]);
function trustedHost(req) {
  if (PASSWORD) return true;
  const h = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  return ALLOWED_HOSTS.has(h) || h.endsWith('.localhost') || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^\[[0-9a-f:.]+\]$/.test(h);
}
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true; // not sent by a web page of another site (same-origin GETs, curl, the tests)
  try { return new URL(o).host === String(req.headers.host || '').toLowerCase(); } catch { return false; }
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); res.end('bad request'); return; }
  const p = url.pathname;
  try {
    if (!trustedHost(req)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Studio 64 only answers on localhost or an IP address when it has no password.\nTo open it as "${String(req.headers.host || '').replace(/[^\w.:[\]-]/g, '')}", start it with STUDIO_PASSWORD=... (or STUDIO_ALLOWED_HOSTS=<that name>).\n`);
      return;
    }
    if (p.startsWith('/api/') && !sameOrigin(req)) return json(res, 403, { error: 'requests from other websites are not allowed' });
    if (p.startsWith('/api/')) setAuthCookie(req, res);
    if (p === '/api/config') return json(res, 200, { instance: INSTANCE, version: VERSION, models: authorized(req) ? modelMenu() : modelMenu().filter((m) => m.provider === 'claude'), defaultModel: defaultModel(), needsPassword: !!PASSWORD, ai: aiStatus() });
    if (p === '/api/catalog') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' }); res.end(clientCatalog); return; }
    if (p.startsWith('/api/')) {
      if (!authorized(req)) return json(res, 401, { error: 'password required' });
      for (const r of ROUTES) if (r.http && await r.http(req, res, url)) return;
      if (p.startsWith('/api/ai/')) return aiRoutes(req, res, p); // AI providers & keys (server/ai/)
      // Project changes from a page that is closing (fetch keepalive): handled like websocket messages.
      const ms = req.method === 'POST' && p.match(/^\/api\/projects\/([\w-]{4,40})\/send$/);
      if (ms) {
        const body = await readBody(req, 2e6);
        if (!projects.getProject(ms[1])) return json(res, 404, { error: 'no such project' });
        const ghost = { id: String(body.client || 'leaving').slice(0, 12), ws: { readyState: 3 }, projectId: ms[1], pending: new Map() };
        let n = 0;
        for (const m of (Array.isArray(body.messages) ? body.messages : []).slice(0, 200)) {
          if (!m || !LEAVE_TYPES.has(m.type)) continue;
          await onClientMessage(ghost, m);
          n++;
        }
        return json(res, 200, { ok: true, handled: n });
      }
      if (p === '/api/projects' && req.method === 'GET') return json(res, 200, projects.listProjects());
      if (p === '/api/projects' && req.method === 'POST') {
        const body = await readBody(req);
        const proj = projects.createProject({ name: String(body.name || 'Untitled hack').slice(0, 80), level: Number(body.level) || 9 });
        return json(res, 200, { id: proj.id });
      }
      if (p === '/api/projects/import' && req.method === 'POST') {
        const body = await readBody(req);
        const proj = projects.createProject({ name: String(body.name || 'Imported hack').slice(0, 80), level: body.boot?.level || 9 });
        proj.areas = body.areas || {};
        if (body.story) proj.story = body.story;
        proj.changes = Array.isArray(body.changes) ? body.changes : [];
        projects.save(proj);
        return json(res, 200, { id: proj.id });
      }
      const m = p.match(/^\/api\/projects\/([\w-]+)\/export$/);
      if (m) {
        const proj = projects.getProject(m[1]);
        if (!proj) return json(res, 404, { error: 'no such project' });
        const out = { format: 'studio64', version: 1, name: proj.name, boot: proj.boot, areas: proj.areas, changes: proj.changes, story: storyOf(proj) };
        res.writeHead(200, { 'content-type': 'application/json', 'content-disposition': `attachment; filename="${proj.name.replace(/[^\w-]+/g, '_')}.studio64.json"` });
        res.end(JSON.stringify(out, null, 1));
        return;
      }
      return json(res, 404, { error: 'not found' });
    }
    if (VENDOR[p]) return sendFile(req, res, VENDOR[p]);
    // first run: the setup page until the game is built (server/setup/)
    const gate = setupGate(p);
    if (gate) return sendFile(req, res, gate);
    let rel;
    try { rel = decodeURIComponent(p); } catch { res.writeHead(400); res.end('bad request'); return; }
    const file = path.normalize(path.join(WEB, p === '/' ? 'index.html' : rel));
    if (!file.startsWith(WEB + path.sep) || rel.includes('\0')) { res.writeHead(403); res.end(); return; }
    return sendFile(req, res, file);
  } catch (err) {
    if (!err.status || err.status >= 500) console.error(err);
    if (res.headersSent) { res.end(); return; }
    json(res, err.status || 500, { error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Live hub

const clients = new Map();  // projectId -> Set(client)
const agents = new Map();   // projectId -> Agent

const hub = {
  broadcast(projectId, msg, except) {
    const data = JSON.stringify(msg);
    for (const c of clients.get(projectId) || []) if (c !== except && c.ws.readyState === 1) c.ws.send(data);
  },
  send(client, msg) {
    if (client.ws.readyState === 1) client.ws.send(JSON.stringify(msg));
  },
  rpc(client, method, params, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      if (client.ws.readyState !== 1) { reject(new Error('the game tab disconnected')); return; }
      const id = crypto.randomUUID();
      const t = setTimeout(() => { client.pending.delete(id); reject(new Error(`the game did not answer (${method})`)); }, timeoutMs);
      client.pending.set(id, { resolve, reject, t });
      hub.send(client, { type: 'rpc', id, method, params });
    });
  },
  patchChanged(project, driver, remoteOps) {
    hub.broadcast(project.id, { type: 'patch', patch: projects.patchOf(project), changes: projects.changeList(project) });
    if (remoteOps) hub.broadcast(project.id, { type: 'apply_ops', ops: remoteOps }, driver);
  },
  // A project-wide field changed (undo/redo of story, assets, world, sound): everyone gets it again.
  projectField(project, root) {
    if (root === 'story') hub.broadcast(project.id, { type: 'story', story: storyOf(project) });
    else if (root === 'assets') { restoreAssetFiles(project); hub.broadcast(project.id, { type: 'assets', assets: assetsOf(project), by: null }); }
    else if (root === 'audio') hub.broadcast(project.id, { type: 'audio', audio: project.audio });
    else if (root === 'title') hub.broadcast(project.id, { type: 'title', title: project.title || null }); // the launch screen (routes/title.js)
    else if (root === 'world') {
      // the start is also the boot level (world_store.setWorld)
      const st = project.world?.start;
      if (st?.custom && project.levels.some((l) => l.id === st.custom)) project.boot = { level: project.boot?.level || 16, act: 1, custom: st.custom };
      else if (st?.level) project.boot = { level: Number(st.level) || 16, act: 1 };
    }
  },
  // the edit list (after project-wide edits, which send no patch)
  changesChanged(project) { hub.broadcast(project.id, { type: 'changes', changes: projects.changeList(project) }); },
  undo(project, changeId, driver) {
    const r = projects.undoChange(project, changeId);
    if (!r) return null;
    if (r.project) hub.projectField(project, r.project[0]);
    if (r.levels) hub.broadcast(project.id, { type: 'levels', levels: project.levels, thumbs: project.thumbs }); // a level op went back
    hub.broadcast(project.id, { type: 'patch', patch: projects.patchOf(project), changes: projects.changeList(project) });
    hub.broadcast(project.id, { type: 'apply_ops', ops: r.ops });
    return r;
  },
  redo(project) {
    const r = projects.redoChange(project);
    if (!r) return null;
    if (r.project) hub.projectField(project, r.project[0]);
    if (r.levels) hub.broadcast(project.id, { type: 'levels', levels: project.levels, thumbs: project.thumbs });
    hub.broadcast(project.id, { type: 'patch', patch: projects.patchOf(project), changes: projects.changeList(project) });
    hub.broadcast(project.id, { type: 'apply_ops', ops: r.ops });
    return r;
  },
  idle(projectId) {
    hub.broadcast(projectId, { type: 'idle' });
  },
};

function agentFor(project) {
  let a = agents.get(project.id);
  if (!a) { a = new Agent(hub, project); agents.set(project.id, a); }
  return a;
}

function editorLine(ctx) {
  if (!ctx) return '';
  const parts = [];
  if (ctx.building) parts.push('The user is in build mode (world paused, free camera).');
  if (ctx.selection) {
    const s = ctx.selection;
    const b = s.block ? ` ${s.block.sx}×${s.block.sy}×${s.block.sz}` : '';
    parts.push(`Selected in the editor ("this", "it"): ${s.name} [${s.kind}${s.uid ? `, uid ${s.uid}` : ''}, slot ${s.slot}] at (${s.x}, ${s.y}, ${s.z}), facing ${s.yaw_deg}°${b}.`);
  }
  if (ctx.last_click) parts.push(`Last point the user clicked ("there", "here"): (${ctx.last_click.x}, ${ctx.last_click.y}, ${ctx.last_click.z}).`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

function compactState(s, ctx) {
  if (!s || !s.mario) return 'Mario is not in a level right now (menu, act select or transition).' + editorLine(ctx);
  const m = s.mario;
  const near = (s.nearby || []).slice(0, 10).map((o) => `${o.name} [slot ${o.slot}${o.studio ? `, uid ${o.studio}` : ''}] ${o.dist} ${o.direction}`).join('; ');
  return `Level: ${s.level}${s.custom ? ' (custom level)' : ` (#${s.level_num})`}, area ${s.area}, act ${s.act}. Mario at (${m.x}, ${m.y}, ${m.z}) facing ${m.facing_deg}°, health ${m.health}/8. `
    + `Camera yaw ${s.camera_yaw_deg}°. Near Mario: ${near || 'nothing'}. Saved edits in this area: ${s.edits_here.added} added, ${s.edits_here.removed} removed, ${s.edits_here.pipes} pipe warps.` + editorLine(ctx);
}

ROUTES = ROUTE_PLUGINS.map((make) => {
  try { return make({ hub, projects, clients, agents, agentFor, json, readBody, authorized, clientCatalog, ROOT, WEB }); } catch (err) { console.error('[routes]', err); return {}; }
});

// Messages a closing page may still send by HTTP (POST /api/projects/:id/send): project changes only.
const LEAVE_TYPES = new Set(['edit', 'level_create', 'level_rename', 'level_delete', 'level_duplicate', 'thumb', 'song_save', 'sound_save', 'audio_delete', 'overrides_save', 'rename', 'boot_level', 'story_op', 'world_set', 'area_create', 'area_rename', 'area_delete']);

// One message of a client (the websocket, or a keepalive request from a page that is closing).
async function onClientMessage(client, msg) {
  try {
    if (msg.type === 'rpc_result') {
      const p = client.pending.get(msg.id);
      if (!p) return;
      client.pending.delete(msg.id);
      clearTimeout(p.t);
      if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error || 'failed'));
      return;
    }
    if (msg.type === 'hello') {
      if (PASSWORD && !client.cookieAuth && !sameSecret(msg.password, PASSWORD)) { hub.send(client, { type: 'auth_required', wrong: !!msg.password }); return; }
      let project = msg.projectId && projects.getProject(String(msg.projectId));
      // a link to a project that is gone (deleted, mistyped): say so instead of making a new one
      if (msg.projectId && !project) { hub.send(client, { type: 'no_project', projectId: String(msg.projectId).slice(0, 40) }); return; }
      if (!project) project = projects.createProject({ level: Number(msg.level) || 9 });
      client.projectId = project.id;
      if (!clients.has(project.id)) clients.set(project.id, new Set());
      clients.get(project.id).add(client);
      const agent = agentFor(project);
      hub.send(client, {
        type: 'welcome', clientId: client.id,
        project: { id: project.id, name: project.name, boot: project.boot, model: agent.model },
        patch: projects.patchOf(project), changes: projects.changeList(project), chat: project.chat,
        levels: project.levels, thumbs: project.thumbs, audio: project.audio, story: storyOf(project),
        busy: agent.busy, viewers: clients.get(project.id).size,
      });
      hub.broadcast(project.id, { type: 'viewers', count: clients.get(project.id).size });
      return;
    }
    const project = client.projectId && projects.getProject(client.projectId);
    if (!project) return;
    const agent = agentFor(project);
    switch (msg.type) {
      case 'chat': {
        const textIn = String(msg.text || '').trim().slice(0, 4000);
        if (!textIn) return;
        if (agent.busy) { hub.send(client, { type: 'error', message: 'The assistant is still busy with the last message.' }); return; }
        // no AI connected or turned off: never start a session (the app hides the chat then)
        const ai = aiStatus();
        if (!ai.available) { hub.send(client, { type: 'error', message: ai.reason || 'The AI assistant is off.' }); return; }
        if (msg.model && msg.model !== agent.model) await agent.setModel(msg.model);
        if (!canRun(agent.model)) await agent.setModel(defaultModel()); // e.g. Claude logged out, another provider set up
        // name a fresh project after its first request, like a chat title
        if (project.name === 'Untitled hack' && !project.chat.length) {
          const title = textIn.replace(/\s+/g, ' ');
          project.name = title.length > 42 ? `${title.slice(0, 40).replace(/\s\S*$/, '')}…` : title;
          project.name = project.name.charAt(0).toUpperCase() + project.name.slice(1);
          projects.save(project);
          hub.broadcast(project.id, { type: 'renamed', name: project.name });
        }
        let state = null;
        try { state = await hub.rpc(client, 'state', {}, 3000); } catch { /* not in a level */ }
        // images the user attached (pasted or uploaded), for Claude's eyes
        const images = (Array.isArray(msg.images) ? msg.images : []).slice(0, 4)
          .filter((im) => /^image\/(png|jpeg|webp|gif)$/.test(im.mime) && typeof im.data === 'string' && im.data.length < 6e6);
        const levelsLine = project.levels.length ? ` Custom levels in this project: ${project.levels.map((l) => `"${l.name}" (id ${l.id})`).join(', ')}.` : '';
        const textBlock = `<game>${compactState(state, msg.context)}${levelsLine}</game>\n\n${textIn}`;
        const content = images.length
          ? [...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } })), { type: 'text', text: textBlock }]
          : textBlock;
        await agent.send(content, client, textIn, images.map((im) => im.thumb).filter(Boolean));
        break;
      }
      case 'edit': {
        // an edit made by hand in the editor
        const op = msg.op || {};
        const key = op.key || `${Number(op.level)}:${Number(op.area)}`;
        if (op.type === 'add') {
          projects.recordChange(project, { summary: op.summary, key, objects: op.records || [], removals: op.rules || [], warps: op.warps || [] });
          hub.patchChanged(project, client, { key, spawn: op.records || [], addRules: op.rules || [], warps: op.warps || [] });
        } else if (op.type === 'remove') {
          projects.recordChange(project, { summary: op.summary, key, removals: op.rules || [], dropped: op.uids || [] });
          hub.patchChanged(project, client, { key, deleteUids: op.uids || [], addRules: op.rules || [] });
        } else if (op.type === 'update') {
          const change = projects.updateObject(project, op.uid, op.fields || {}, op.summary || 'Changed an object');
          const rec = change && Object.values(project.areas).flatMap((a) => a.objects).find((o) => o.uid === op.uid);
          hub.patchChanged(project, client, rec ? { key, deleteUids: [op.uid], spawn: [rec] } : null);
        } else if (op.type === 'update_many' && Array.isArray(op.updates)) {
          // group edits (objects panel): one undo step
          const change = projects.updateObjects(project, op.updates.slice(0, 500), op.summary || 'Changed objects');
          const uids = new Set(op.updates.map((u) => u.uid));
          const recs = change ? Object.values(project.areas).flatMap((a) => a.objects).filter((o) => uids.has(o.uid)) : [];
          hub.patchChanged(project, client, recs.length ? { key, deleteUids: recs.map((r) => r.uid), spawn: recs } : null);
        } else if (op.type === 'area' && ['terrain', 'settings', 'rules', 'prefabs', 'objdefs', 'paths'].includes(op.field)) {
          projects.updateArea(project, key, op.field, op.value, op.summary || 'Changed the level');
          hub.patchChanged(project, client, { key, reloadArea: true });
        } else if (op.type === 'sculpt' && op.stroke?.id && Array.isArray(op.stroke.dabs)) {
          projects.addSculpt(project, key, op.stroke, op.summary || 'Sculpted the level');
          hub.patchChanged(project, client, { key, reloadArea: true });
        }
        break;
      }
      case 'level_create': {
        const id = String(msg.id || projects.newId()).replace(/[^\w-]/g, '').slice(0, 24);
        if (project.levels.some((l) => l.id === id)) break;
        projects.createLevel(project, { id, name: msg.name, template: msg.template, area: msg.area });
        hub.broadcast(project.id, { type: 'levels', levels: project.levels, thumbs: project.thumbs });
        hub.broadcast(project.id, { type: 'patch', patch: projects.patchOf(project), changes: projects.changeList(project) });
        break;
      }
      case 'level_rename':
        projects.renameLevel(project, msg.id, msg.name);
        hub.broadcast(project.id, { type: 'levels', levels: project.levels, thumbs: project.thumbs });
        break;
      case 'level_delete':
        projects.deleteLevel(project, msg.id);
        hub.broadcast(project.id, { type: 'levels', levels: project.levels, thumbs: project.thumbs });
        hub.broadcast(project.id, { type: 'patch', patch: projects.patchOf(project), changes: projects.changeList(project) });
        break;
      case 'level_duplicate': {
        const l = projects.duplicateLevel(project, msg.id, projects.newId());
        if (l) {
          hub.broadcast(project.id, { type: 'levels', levels: project.levels, thumbs: project.thumbs });
          hub.broadcast(project.id, { type: 'patch', patch: projects.patchOf(project), changes: projects.changeList(project) });
          hub.send(client, { type: 'level_created', id: l.id });
        }
        break;
      }
      case 'thumb':
        // (one small picture per area: keys are bounded, so a client can't grow the project file without end)
        if (typeof msg.data === 'string' && msg.data.length < 60000 && /^data:image\//.test(msg.data) && /^[\w:-]{1,48}$/.test(msg.key || '') && (msg.key in project.thumbs || Object.keys(project.thumbs).length < 400)) {
          project.thumbs[msg.key] = msg.data;
          projects.save(project);
          hub.broadcast(project.id, { type: 'thumb', key: msg.key, data: msg.data }, client);
        }
        break;
      // the sound studio: songs, sound effects and replaced game sounds
      // (each is an undoable project-wide edit: projects.recordProjectChange)
      case 'song_save': {
        const before = JSON.parse(JSON.stringify(project.audio || {}));
        if (projects.saveSong(project, msg.song)) {
          projects.recordProjectChange(project, ['audio'], before, `Edited song “${String(msg.song?.name || 'song').slice(0, 40)}”`, { by: client.id || null });
          hub.broadcast(project.id, { type: 'audio', audio: project.audio }, client);
          hub.changesChanged(project);
        }
        break;
      }
      case 'sound_save': {
        const before = JSON.parse(JSON.stringify(project.audio || {}));
        if (projects.saveSound(project, msg.sound)) {
          projects.recordProjectChange(project, ['audio'], before, `Edited sound “${String(msg.sound?.name || 'sound').slice(0, 40)}”`, { by: client.id || null });
          hub.broadcast(project.id, { type: 'audio', audio: project.audio }, client);
          hub.changesChanged(project);
        }
        break;
      }
      case 'audio_delete': {
        const before = JSON.parse(JSON.stringify(project.audio || {}));
        projects.deleteAudio(project, msg.kind, msg.id);
        projects.recordProjectChange(project, ['audio'], before, msg.kind === 'song' ? 'Deleted a song' : 'Deleted a sound', { by: client.id || null });
        hub.broadcast(project.id, { type: 'audio', audio: project.audio });
        hub.changesChanged(project);
        break;
      }
      // the story panel: dialogs, texts, characters, events, cutscenes (web/js/story/ops.js)
      case 'story_op':
        storyEdit(hub, project, msg.ops, client, { by: client.id || null });
        break;
      case 'overrides_save': {
        const before = JSON.parse(JSON.stringify(project.audio || {}));
        projects.setOverrides(project, msg.overrides);
        projects.recordProjectChange(project, ['audio'], before, 'Changed replaced game sounds', { by: client.id || null });
        hub.broadcast(project.id, { type: 'audio', audio: project.audio }, client);
        hub.changesChanged(project);
        break;
      }
      case 'stop': await agent.interrupt(); break;
      case 'model': await agent.setModel(msg.model); hub.broadcast(project.id, { type: 'model', model: agent.model }); break;
      case 'undo': {
        const r = hub.undo(project, msg.changeId, client);
        if (r) hub.broadcast(project.id, { type: 'toast', message: `Undid: ${r.change.summary}` });
        break;
      }
      case 'redo': {
        const r = hub.redo(project);
        if (r) hub.broadcast(project.id, { type: 'toast', message: `Redid: ${r.change.summary}` });
        else hub.send(client, { type: 'toast', message: 'Nothing to redo' });
        break;
      }
      case 'reset_edits': {
        const keys = Object.keys(project.areas).filter((k) => !k.startsWith('c:') && !k.startsWith('@'));
        const uids = keys.flatMap((k) => project.areas[k].objects.map((o) => o.uid));
        projects.resetEdits(project);
        hub.broadcast(project.id, { type: 'patch', patch: projects.patchOf(project), changes: projects.changeList(project) });
        // reloadArea: sculpting and settings of the level on screen go back too
        hub.broadcast(project.id, { type: 'apply_ops', ops: { key: '*', deleteUids: uids, reloadArea: true } });
        hub.broadcast(project.id, { type: 'toast', message: 'All edits cleared' });
        break;
      }
      case 'new_chat': agent.resetConversation(); hub.broadcast(project.id, { type: 'chat_cleared' }); break;
      case 'rename':
        project.name = String(msg.name || '').trim().slice(0, 80) || project.name;
        projects.save(project);
        hub.broadcast(project.id, { type: 'renamed', name: project.name });
        break;
      case 'boot_level':
        project.boot = { level: Number(msg.level) || 9, act: 1 };
        projects.save(project);
        break;
      default:
        for (const r of ROUTES) if (r.ws && await r.ws(msg, client, project)) break;
        break;
    }
  } catch (err) {
    console.error('[ws]', err);
    hub.send(client, { type: 'error', message: err.message });
  }
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8e6, verifyClient: ({ req }) => trustedHost(req) && sameOrigin(req) });
wss.on('connection', (ws, req) => {
  const client = { id: crypto.randomUUID().slice(0, 8), ws, projectId: null, pending: new Map(), alive: true, cookieAuth: !!PASSWORD && authorized(req) };
  ws.on('pong', () => { client.alive = true; });

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    await onClientMessage(client, msg);
  });

  ws.on('close', () => {
    for (const p of client.pending.values()) { clearTimeout(p.t); p.reject(new Error('the game tab disconnected')); }
    const set = clients.get(client.projectId);
    if (set) {
      set.delete(client);
      hub.broadcast(client.projectId, { type: 'viewers', count: set.size });
      if (!set.size) {
        clients.delete(client.projectId);
        // let the Claude process go after a while without viewers
        setTimeout(() => {
          if (!clients.has(client.projectId)) { agents.get(client.projectId)?.close(); agents.delete(client.projectId); }
        }, 10 * 60 * 1000);
      }
    }
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (ws._studioDead) { ws.terminate(); continue; }
    ws._studioDead = true;
    ws.once('pong', () => { ws._studioDead = false; });
    ws.ping();
  }
}, 30000);

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { projects.flushAll(); process.exit(0); });

// a restart after the setup waits for the old server to let go of the port
let listenTries = 0;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && process.env.STUDIO_RESTART_WAIT && ++listenTries < 50) { setTimeout(() => server.listen(PORT, HOST), 200); return; }
  if (err.code === 'EADDRINUSE') console.error(`\n  Port ${PORT} is already in use: is Studio 64 already running? Open http://localhost:${PORT}, or start it on another port: PORT=${PORT + 1} npm start\n`);
  else console.error(err);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`\n  Studio 64 ${VERSION} is running:  http://${shown}:${PORT}\n`);
  if (!fs.existsSync(path.join(WEB, 'engine', 'sm64.us.f3dex2e.wasm'))) console.log('  First start: open the page above and drop your Super Mario 64 ROM. The setup does the rest.\n');
  if (HOST !== '127.0.0.1' && !PASSWORD && !process.env.STUDIO_IN_DOCKER) console.log('  Warning: listening on the network without STUDIO_PASSWORD.\n');
});
