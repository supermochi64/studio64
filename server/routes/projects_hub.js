// The project home, project files, sharing and version history (HTTP + websocket).
// See docs/projects.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as hack from '../hackfile.js';
import * as versions from '../versions.js';
import { zipRead } from '../zip.js';
import { decompExport } from '../decomp.js';
import { assetDir } from '../projects.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES = path.join(here, '..', 'samples');

function readRaw(req, limit = 400 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let over = false;
    // too large: answer 413 after reading the rest (a destroyed upload reached the browser as "Failed to fetch")
    req.on('data', (c) => { size += c.length; if (over) return; if (size > limit) { over = true; chunks.length = 0; reject(Object.assign(new Error(`the file is too large (limit ${Math.round(limit / 1048576)} MB)`), { status: 413 })); } else chunks.push(c); });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

const dataUrlImage = (s) => {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(s || '');
  return m ? { type: `image/${m[1]}`, data: Buffer.from(m[2], 'base64') } : null;
};

// The picture of a project: its cover, else the newest level screenshot.
function thumbOf(p) {
  const cover = dataUrlImage(p.meta?.cover);
  if (cover) return cover;
  const still = titleCover(p);
  if (still) return still;
  const keys = Object.keys(p.thumbs || {});
  const pick = (p.boot?.custom && p.thumbs[`c:${p.boot.custom}`]) ? `c:${p.boot.custom}` : keys.find((k) => k.startsWith('c:')) || keys[keys.length - 1];
  if (pick) return dataUrlImage(p.thumbs[pick]);
  return sampleCover(p.meta?.template);
}

// No cover picture: the launch screen's still (title screen with its logo; routes/title.js).
function titleCover(p) {
  const f = p.title?.on && p.title.cover;
  if (!f || !/^[\w-]{4,80}\.(png|jpg|webp)$/.test(f)) return null;
  try { return { type: f.endsWith('png') ? 'image/png' : f.endsWith('webp') ? 'image/webp' : 'image/jpeg', data: fs.readFileSync(path.join(assetDir(p.id), 'title', f)) }; } catch { return null; }
}

// Hacks made from a sample before covers were copied: the sample's cover picture.
function sampleCover(file) {
  if (!/^[\w.-]+\.s64hack$/.test(file || '')) return null;
  try {
    const z = zipRead(fs.readFileSync(path.join(SAMPLES, file)));
    const k = [...z.keys()].find((n) => n.startsWith('cover.'));
    return k ? { type: k.endsWith('png') ? 'image/png' : 'image/jpeg', data: z.get(k) } : null;
  } catch { return null; }
}

function summary(p) {
  const objects = Object.values(p.areas || {}).reduce((n, a) => n + (a.objects?.length || 0), 0);
  return {
    id: p.id, name: p.name, updatedAt: p.updatedAt, createdAt: p.createdAt,
    author: p.meta?.author || '', description: p.meta?.description || '', template: p.meta?.template || null,
    edits: (p.changes || []).length, levels: (p.levels || []).length, objects,
    hasThumb: !!(p.meta?.cover || (p.title?.on && p.title.cover) || Object.keys(p.thumbs || {}).length || (/\.s64hack$/.test(p.meta?.template || '') && fs.existsSync(path.join(SAMPLES, path.basename(p.meta.template))))),
    thumbVersion: p.meta?.coverAt || (p.title?.on && p.title.cover) || Object.keys(p.thumbs || {}).length,
  };
}

function sampleList() {
  let files = [];
  try { files = fs.readdirSync(SAMPLES).filter((f) => f.endsWith('.s64hack')).sort(); } catch { return []; }
  return files.map((f) => {
    try {
      const z = zipRead(fs.readFileSync(path.join(SAMPLES, f)));
      const m = JSON.parse(z.get('manifest.json').toString('utf8'));
      return { file: f, name: m.name, author: m.author, description: m.description, levels: m.levels, hasCover: [...z.keys()].some((k) => k.startsWith('cover.')) };
    } catch { return null; }
  }).filter(Boolean);
}

export default function projectsHub(ctx) {
  const { hub, projects, clients, agents, json, readBody } = ctx;

  const notify = (id, msg) => hub.broadcast(id, msg);
  const download = (res, name, type, buf) => {
    res.writeHead(200, { 'content-type': type, 'content-length': buf.length, 'cache-control': 'no-cache', 'content-disposition': `attachment; filename="${name}"` });
    res.end(buf);
  };
  const loaded = () => [...clients.keys()].map((id) => projects.getProject(id)).filter(Boolean);
  versions.startAuto(loaded);

  // safety net: what is in memory goes to disk if the server dies unexpectedly
  process.once('uncaughtException', (err) => { console.error(err); try { projects.flushAll(); } catch { /* ignore */ } process.exit(1); });

  async function http(req, res, url) {
    const p = url.pathname;
    const method = req.method;
    if (p === '/api/hub/projects' && method === 'GET') {
      const list = projects.listProjects().map((x) => projects.getProject(x.id)).filter(Boolean).map(summary);
      return json(res, 200, list), true;
    }
    if (p === '/api/hub/samples' && method === 'GET') return json(res, 200, sampleList()), true;
    let m = p.match(/^\/api\/hub\/samples\/([\w.-]+\.s64hack)\/cover$/);
    if (m) {
      try {
        const z = zipRead(fs.readFileSync(path.join(SAMPLES, m[1])));
        const k = [...z.keys()].find((n) => n.startsWith('cover.'));
        if (!k) return json(res, 404, { error: 'no cover' }), true;
        res.writeHead(200, { 'content-type': k.endsWith('png') ? 'image/png' : 'image/jpeg', 'cache-control': 'no-cache' });
        res.end(z.get(k));
      } catch { json(res, 404, { error: 'no such sample' }); }
      return true;
    }
    if (p === '/api/hub/create' && method === 'POST') {
      const body = await readBody(req, 40e6);
      let proj;
      if (body.sample) {
        const f = String(body.sample).replace(/[^\w.-]/g, '');
        // samples are generated (npm run samples): a fresh clone may not have them
        if (!fs.existsSync(path.join(SAMPLES, f))) return json(res, 404, { error: 'This sample is not on this server (make the samples with: npm run samples)' }), true;
        proj = hack.importHack(fs.readFileSync(path.join(SAMPLES, f)), { name: body.name || undefined });
      } else {
        proj = projects.createProject({ name: String(body.name || 'Untitled hack').slice(0, 80), level: Number(body.level) || 16 });
        for (const l of Array.isArray(body.levels) ? body.levels.slice(0, 12) : []) {
          const id = String(l.id || projects.newId()).replace(/[^\w-]/g, '').slice(0, 24);
          projects.createLevel(proj, { id, name: l.name, template: l.template, area: l.area, quiet: true });
          if (body.startInLevel && !proj.boot.custom) proj.boot.custom = id;
        }
      }
      proj.meta = { ...(proj.meta || {}), author: String(body.author || proj.meta?.author || '').slice(0, 60), template: body.template || body.sample || 'empty' };
      if (body.description) proj.meta.description = String(body.description).slice(0, 600);
      projects.saveImmediately(proj);
      return json(res, 200, { id: proj.id }), true;
    }
    if (p === '/api/hub/import' && method === 'POST') {
      try {
        const buf = await readRaw(req);
        const proj = hack.importHack(buf, { name: url.searchParams.get('name') || undefined });
        return json(res, 200, { id: proj.id, name: proj.name }), true;
      } catch (err) {
        return json(res, err.status || 400, { error: err.message }), true;
      }
    }

    m = p.match(/^\/api\/projects\/([\w-]{4,40})\/(thumb|info|meta|duplicate|undelete|export\.s64hack|standalone\.zip|decomp\.zip|play\.json|versions)(?:\/([\w]+)(?:\/(diff|restore|data))?)?$/);
    if (!m && (m = p.match(/^\/api\/projects\/([\w-]{4,40})$/)) && method === 'DELETE') {
      const ok = hack.deleteProject(m[1]);
      if (ok) {
        notify(m[1], { type: 'project_deleted' });
        agents.get(m[1])?.close?.();
        agents.delete(m[1]);
      }
      return json(res, ok ? 200 : 404, { ok }), true;
    }
    if (!m) return false;
    const [, id, what, vid, sub] = m;
    if (what === 'undelete' && method === 'POST') {
      const proj = hack.restoreDeleted(id);
      return json(res, proj ? 200 : 404, proj ? { id: proj.id } : { error: 'nothing to restore' }), true;
    }
    const proj = projects.getProject(id);
    if (!proj) return json(res, 404, { error: 'no such project' }), true;

    if (what === 'thumb') {
      const t = thumbOf(proj);
      if (!t) return json(res, 404, { error: 'no picture yet' }), true;
      res.writeHead(200, { 'content-type': t.type, 'cache-control': 'no-cache', 'content-length': t.data.length });
      res.end(t.data);
      return true;
    }
    if (what === 'info' && method === 'GET') return json(res, 200, { ...summary(proj), meta: { ...(proj.meta || {}), cover: undefined }, hasCover: !!proj.meta?.cover, boot: proj.boot, stats: hack.stats(proj), files: hack.projectFiles(proj.id).length }), true;
    if (what === 'meta' && (method === 'POST' || method === 'PATCH')) {
      const body = await readBody(req, 4e6);
      proj.meta ||= {};
      if (typeof body.name === 'string' && body.name.trim()) proj.name = body.name.trim().slice(0, 80);
      if (typeof body.author === 'string') proj.meta.author = body.author.trim().slice(0, 60);
      if (typeof body.description === 'string') proj.meta.description = body.description.trim().slice(0, 600);
      if (body.cover === null) { delete proj.meta.cover; proj.meta.coverAt = Date.now(); }
      if (typeof body.cover === 'string' && dataUrlImage(body.cover) && body.cover.length < 1.5e6) { proj.meta.cover = body.cover; proj.meta.coverAt = Date.now(); }
      if (body.boot && typeof body.boot === 'object') {
        proj.boot = { level: Number(body.boot.level) || proj.boot?.level || 16, act: 1 };
        if (body.boot.custom && proj.levels.some((l) => l.id === body.boot.custom)) proj.boot.custom = body.boot.custom;
      }
      projects.save(proj);
      notify(proj.id, { type: 'renamed', name: proj.name });
      notify(proj.id, { type: 'meta', meta: { ...proj.meta, cover: undefined }, hasCover: !!proj.meta.cover, boot: proj.boot });
      return json(res, 200, { ok: true, ...summary(proj) }), true;
    }
    if (what === 'duplicate' && method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      const copy = hack.duplicateProject(proj, body.name);
      return json(res, 200, { id: copy.id, name: copy.name }), true;
    }
    if (what === 'export.s64hack') {
      const buf = hack.exportHack(proj, { chat: url.searchParams.get('chat') !== '0' });
      download(res, `${hack.fileBase(proj)}.s64hack`, 'application/zip', buf);
      return true;
    }
    if (what === 'standalone.zip') {
      const buf = hack.standaloneZip(proj, { webDir: ctx.WEB, clientCatalog: ctx.clientCatalog });
      download(res, `${hack.fileBase(proj)}-playable.zip`, 'application/zip', buf);
      return true;
    }
    if (what === 'play.json') return json(res, 200, hack.playData(proj)), true;
    if (what === 'decomp.zip') {
      const r = decompExport(proj);
      if (url.searchParams.get('list') === '1') return json(res, 200, r.files.map((f) => ({ path: f.path, level: f.level, area: f.area, objects: f.objects, warps: f.warps, notes: f.notes, text: f.text }))), true;
      download(res, `${hack.fileBase(proj)}-decomp.zip`, 'application/zip', r.zip);
      return true;
    }

    if (what === 'versions') {
      if (!vid && method === 'GET') return json(res, 200, versions.list(proj.id).slice().reverse()), true;
      if (!vid && method === 'POST') {
        const body = await readBody(req).catch(() => ({}));
        const v = versions.snapshot(proj, { label: body.label || 'Saved version' });
        notify(proj.id, { type: 'versions_changed' });
        return json(res, 200, v), true;
      }
      if (vid && sub === 'diff') {
        const against = url.searchParams.get('against') || 'current';
        const newer = against === 'current' ? versions.current(proj) : versions.load(proj.id, against);
        const older = versions.load(proj.id, vid);
        return json(res, 200, versions.diff(older, newer)), true;
      }
      if (vid && sub === 'restore' && method === 'POST') {
        const r = versions.restore(proj, vid);
        notify(proj.id, { type: 'project_reload', reason: `Restored “${r.restored?.label || 'version'}”` });
        return json(res, 200, { ok: true, backup: r.backup?.id }), true;
      }
      if (vid && !sub && method === 'DELETE') return json(res, 200, { ok: versions.remove(proj.id, vid) }), true;
      if (vid && !sub && (method === 'PATCH' || method === 'POST')) {
        const body = await readBody(req).catch(() => ({}));
        return json(res, 200, versions.rename(proj.id, vid, body.label) || { error: 'no such version' }), true;
      }
    }
    return false;
  }

  async function ws(msg, client, project) {
    if (msg.type === 'save_version') {
      const v = versions.snapshot(project, { label: msg.label || 'Saved version' });
      hub.send(client, { type: 'version_saved', version: v });
      hub.broadcast(project.id, { type: 'versions_changed' });
      return true;
    }
    return false;
  }

  return { http, ws };
}
