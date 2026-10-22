// Asset store: the binary files of a project (imported model packages, texture
// replacements, custom materials, skies) in projects.assetDir(id) (so exports,
// duplicates and deletes take them along), and the metadata that says how they
// are used (project.assets). Wired in by routes/assets.js.
//
//   GET    /api/projects/:id/assets               metadata
//   PATCH  /api/projects/:id/assets               { set: { models | textures | materials | skies | mario: value } }
//   POST   /api/projects/:id/assets/files?name=&kind=   raw body -> { id, size }
//   GET    /api/projects/:id/assets/files/:file
//   DELETE /api/projects/:id/assets/files/:file
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as projectsLib from './projects.js';

export const LIMITS = { file: 32 * 1024 * 1024, project: 400 * 1024 * 1024, files: 4000 };
const FIELDS = ['models', 'textures', 'materials', 'skies', 'mario'];
const MIME = { model: 'application/octet-stream', png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

export function assetsOf(p) {
  p.assets ||= {};
  const a = p.assets;
  a.files ||= {};
  a.models ||= [];
  a.textures ||= {};
  a.materials ||= [];
  a.skies ||= {};
  a.mario ||= {};
  return a;
}

const dirOf = (id) => path.join(projectsLib.assetDir(id), 'files');
// deleted files wait here (outside the project's export) so an undo can bring them back
const trashOf = (id) => path.join(projectsLib.assetDir(id), '..', '..', 'trash', 'assets', id);
const fileOf = (id, f) => {
  if (!/^[\w-]{6,40}(\.\w{1,5})?$/.test(f)) throw Object.assign(new Error('bad file id'), { code: 400 });
  return path.join(dirOf(id), f);
};

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let over = false;
    req.on('data', (c) => {
      size += c.length;
      if (over) return;
      // (the rest is read and dropped: the browser gets the 413 instead of a broken connection)
      if (size > limit) { over = true; chunks.length = 0; reject(Object.assign(new Error(`file too large (limit ${Math.round(limit / 1048576)} MB)`), { code: 413 })); } else chunks.push(c);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

const projectBytes = (a) => Object.values(a.files).reduce((s, f) => s + (f.size || 0), 0);

const SUMMARY = { models: 'Changed imported models', textures: 'Changed game textures', materials: 'Changed block materials', skies: 'Changed the sky', mario: 'Changed Mario\'s colours' };

// Change metadata fields and tell everyone on the project. Each changed field is one undo step
// (projects.recordProjectChange; quick changes of one field in a row merge).
export function setAssets(project, set, { projects, hub, by = null, summary = null, record = true } = {}) {
  const a = assetsOf(project);
  for (const k of FIELDS) {
    if (!set || !(k in set)) continue;
    if (record && JSON.stringify(a[k]) !== JSON.stringify(set[k])) projectsLib.recordProjectChange(project, ['assets', k], a[k], summary || SUMMARY[k], { by, merge: k === 'mario' ? 2500 : 0 }); // (colour sliders merge; models, textures, skies are single steps)
    a[k] = set[k];
  }
  projects.save(project);
  hub?.broadcast(project.id, { type: 'assets', assets: a, by });
  return a;
}

// After an undo or a version restore: files the metadata uses again come back from the trash.
export function restoreAssetFiles(project) {
  const trash = project.assetTrash || {};
  if (!Object.keys(trash).length) return 0;
  const a = assetsOf(project);
  const used = JSON.stringify({ ...a, files: undefined });
  let n = 0;
  for (const [fid, info] of Object.entries(trash)) {
    if (!used.includes(fid)) continue;
    try {
      fs.mkdirSync(dirOf(project.id), { recursive: true });
      fs.renameSync(path.join(trashOf(project.id), fid), fileOf(project.id, fid));
      a.files[fid] = info;
      delete trash[fid];
      n++;
    } catch { /* gone for good */ }
  }
  return n;
}

function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
  res.end(JSON.stringify(obj));
}

// Returns true when the request was an asset request (and has been answered).
export async function handleAssets(req, res, url, { projects, hub }) {
  const m = url.pathname.match(/^\/api\/projects\/([\w-]+)\/assets(?:\/files(?:\/([\w.-]+))?)?$/);
  if (!m) return false;
  const proj = projects.getProject(m[1]);
  if (!proj) { send(res, 404, { error: 'no such project' }); return true; }
  const a = assetsOf(proj);
  const isFiles = url.pathname.includes('/assets/files');
  const fid = m[2];
  try {
    if (!isFiles && req.method === 'GET') { send(res, 200, a); return true; }
    if (!isFiles && req.method === 'PATCH') {
      const body = JSON.parse((await readRaw(req, 8e6)).toString('utf8') || '{}');
      setAssets(proj, body.set || {}, { projects, hub, by: req.headers['x-studio-client'] || null, summary: typeof body.summary === 'string' ? body.summary.slice(0, 120) : null });
      hub?.broadcast(proj.id, { type: 'changes', changes: projects.changeList(proj) });
      send(res, 200, { ok: true });
      return true;
    }
    if (isFiles && !fid && req.method === 'POST') {
      if (Object.keys(a.files).length >= LIMITS.files) { send(res, 413, { error: 'too many asset files in this project' }); return true; }
      const room = LIMITS.project - projectBytes(a);
      const data = await readRaw(req, Math.min(LIMITS.file, Math.max(0, room)));
      if (!data.length) { send(res, 400, { error: 'empty file' }); return true; }
      const kind = String(url.searchParams.get('kind') || 'model').replace(/\W/g, '').slice(0, 12) || 'model';
      const ext = kind === 'model' ? 's64m' : kind === 'jpeg' ? 'jpg' : kind === 'webp' ? 'webp' : 'png';
      const id = `${crypto.randomBytes(9).toString('base64url')}.${ext}`;
      fs.mkdirSync(dirOf(proj.id), { recursive: true });
      fs.writeFileSync(fileOf(proj.id, id), data);
      a.files[id] = { name: String(url.searchParams.get('name') || id).slice(0, 120), kind, size: data.length, created: Date.now() };
      projects.save(proj);
      send(res, 200, { id, size: data.length });
      return true;
    }
    if (isFiles && fid && req.method === 'GET') {
      const f = fileOf(proj.id, fid);
      if (!fs.existsSync(f)) { send(res, 404, { error: 'no such file' }); return true; }
      const info = a.files[fid] || {};
      const st = fs.statSync(f);
      const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
      // files never change once written: let the browser keep them
      const headers = { 'content-type': MIME[info.kind] || 'application/octet-stream', 'cache-control': 'private, max-age=31536000, immutable', etag };
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
      res.writeHead(200, { ...headers, 'content-length': st.size });
      fs.createReadStream(f).pipe(res);
      return true;
    }
    if (isFiles && fid && req.method === 'DELETE') {
      try {
        fs.mkdirSync(trashOf(proj.id), { recursive: true });
        fs.renameSync(fileOf(proj.id, fid), path.join(trashOf(proj.id), fid));
        (proj.assetTrash ||= {})[fid] = a.files[fid] || { kind: 'png', size: 0 };
      } catch { /* already gone */ }
      delete a.files[fid];
      projects.save(proj);
      send(res, 200, { ok: true });
      return true;
    }
    send(res, 405, { error: 'method not allowed' });
  } catch (err) {
    send(res, err.code === 413 || err.code === 400 ? err.code : err instanceof SyntaxError ? 400 : 500, { error: err.message });
  }
  return true;
}
