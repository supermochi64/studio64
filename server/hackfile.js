// Project files: the .s64hack archive (the whole project JSON plus its asset folder),
// importing one back, duplicating and deleting projects, and the standalone
// playable export (a static web build: engine + the hack's data + a small player).
import fs from 'node:fs';
import path from 'node:path';
import { zipWrite, zipRead, isZip } from './zip.js';
import * as projects from './projects.js';

const DIR = projects.PROJECTS_DIR;
// Folders under the projects folder that are never a project's own assets.
const SKIP_DIRS = new Set(['versions', 'trash', 'samples', 'playsaves']); // playsaves: play-test progress (routes/playsave.js)
// Keys that only make sense on this server, or that the player does not need.
const LOCAL_KEYS = ['sessionId', 'redo', 'assetTrash']; // assetTrash: deleted asset files kept for undo (not exported)
const NOT_PLAYED = ['chat', 'changes', 'redo', 'sessionId', 'model', 'assetTrash'];

export const HACK_FORMAT = 'studio64-hack';
export const HACK_VERSION = 2;

// Every file that belongs to a project: any path below the projects folder with a
// segment named after the project (assets/<id>/..., <id>/..., <id>.something).
export function projectFiles(id) {
  const out = [];
  const walk = (dir, rel, depth, owned) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (!rel && SKIP_DIRS.has(e.name)) continue;
      const mine = owned || e.name === id || (e.name.startsWith(`${id}.`) && !(depth === 0 && /^[\w-]+\.json(\.tmp)?$/.test(e.name)));
      if (e.isDirectory()) { if (depth < 5) walk(path.join(dir, e.name), r, depth + 1, mine); } else if (mine && e.isFile()) out.push(r);
    }
  };
  walk(DIR, '', 0, false);
  return out;
}

const totalSize = (id) => projectFiles(id).reduce((n, r) => { try { return n + fs.statSync(path.join(DIR, r)).size; } catch { return n; } }, 0);

// Copy (or move) a project's files to another id.
function copyFiles(fromId, toId, move = false) {
  for (const rel of projectFiles(fromId)) {
    const target = rel.split('/').map((seg) => (seg === fromId ? toId : seg.startsWith(`${fromId}.`) ? toId + seg.slice(fromId.length) : seg)).join('/');
    const dst = path.join(DIR, target);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (move) fs.renameSync(path.join(DIR, rel), dst); else fs.copyFileSync(path.join(DIR, rel), dst);
  }
}

const safeName = (s) => String(s || 'hack').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'hack';
export const fileBase = (p) => safeName(p.name);

function coverBytes(p) {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(p.meta?.cover || '');
  return m ? { ext: m[1] === 'jpeg' ? 'jpg' : m[1], data: Buffer.from(m[2], 'base64') } : null;
}

// ---- .s64hack ------------------------------------------------------------------

export function exportHack(p, { chat = true } = {}) {
  projects.saveImmediately(p);
  const doc = JSON.parse(JSON.stringify(p));
  for (const k of LOCAL_KEYS) delete doc[k];
  if (!chat) doc.chat = [];
  const files = projectFiles(p.id);
  const entries = [];
  const manifest = {
    format: HACK_FORMAT, version: HACK_VERSION, app: 'Studio 64', exportedAt: new Date().toISOString(),
    id: p.id, name: p.name, author: p.meta?.author || '', description: p.meta?.description || '',
    levels: (p.levels || []).length, edits: (p.changes || []).length,
    files: files.map((rel) => rel.split('/').map((seg) => (seg === p.id ? '{id}' : seg.startsWith(`${p.id}.`) ? `{id}${seg.slice(p.id.length)}` : seg)).join('/')),
  };
  entries.push({ name: 'manifest.json', data: JSON.stringify(manifest, null, 1) });
  entries.push({ name: 'project.json', data: JSON.stringify(doc) });
  const cover = coverBytes(p);
  if (cover) entries.push({ name: `cover.${cover.ext}`, data: cover.data });
  files.forEach((rel, i) => entries.push({ name: `files/${manifest.files[i]}`, data: fs.readFileSync(path.join(DIR, rel)) }));
  return zipWrite(entries);
}

// A project from an uploaded file: a .s64hack archive, the old .studio64.json export
// or a bare project JSON. Returns the new project.
export function importHack(buf, { name } = {}) {
  let doc;
  let files = new Map();
  if (isZip(buf)) {
    const z = zipRead(buf);
    let manifest = null;
    try { manifest = z.has('manifest.json') ? JSON.parse(z.get('manifest.json').toString('utf8')) : null; } catch { throw new Error('this file is damaged (its manifest is not readable)'); }
    if (manifest && manifest.format !== HACK_FORMAT) throw new Error('this archive is not a Studio 64 hack');
    if (manifest && manifest.version > HACK_VERSION) throw new Error('this hack was made with a newer Studio 64');
    if (!z.has('project.json')) throw new Error('the archive has no project.json');
    try { doc = JSON.parse(z.get('project.json').toString('utf8')); } catch { throw new Error('the project inside this file is damaged'); }
    for (const [n, data] of z) if (n.startsWith('files/')) files.set(n.slice(6), data);
    // the cover picture: kept as cover.* (older files and the samples have no meta.cover)
    const coverName = [...z.keys()].find((n) => /^cover\.(jpe?g|png|webp)$/.test(n));
    if (coverName && !doc?.meta?.cover) {
      const ext = coverName.split('.')[1].replace('jpg', 'jpeg');
      doc.meta = { ...(doc.meta || {}), cover: `data:image/${ext};base64,${z.get(coverName).toString('base64')}`, coverAt: Date.now() };
    }
  } else {
    try { doc = JSON.parse(buf.toString('utf8')); } catch { throw new Error('this file is not a Studio 64 project (.s64hack)'); }
    // the first export format: { format: 'studio64', name, boot, areas, changes }
    if (doc?.format === 'studio64') doc = { name: doc.name, boot: doc.boot, areas: doc.areas, changes: doc.changes, levels: doc.levels, audio: doc.audio, thumbs: doc.thumbs, meta: doc.meta };
  }
  if (!doc || typeof doc !== 'object' || (typeof doc.areas !== 'object' && !Array.isArray(doc.levels))) throw new Error('not a Studio 64 project');
  const oldId = typeof doc.id === 'string' ? doc.id : null;
  const fresh = projects.createProject({ name: String(name || doc.name || 'Imported hack').slice(0, 80), level: doc.boot?.level || 9 });
  // ids inside the project (asset links and the like) follow the new project id
  let text = JSON.stringify(doc);
  if (oldId && oldId.length >= 6) text = text.split(oldId).join(fresh.id);
  const data = JSON.parse(text);
  for (const k of [...LOCAL_KEYS, 'id', 'createdAt']) delete data[k];
  Object.assign(fresh, data, { id: fresh.id, name: fresh.name, createdAt: Date.now(), updatedAt: Date.now(), sessionId: null, redo: [] });
  fresh.areas ||= {}; fresh.changes ||= []; fresh.chat ||= []; fresh.levels ||= []; fresh.thumbs ||= {};
  fresh.audio ||= {}; fresh.audio.songs ||= []; fresh.audio.sounds ||= []; fresh.audio.overrides ||= [];
  for (const [rel, bytes] of files) {
    const target = rel.split('/').map((seg) => seg.replace(/^\{id\}/, fresh.id)).join('/');
    if (target.split('/').some((s) => !s || s === '..' || s === '.') || path.isAbsolute(target)) continue;
    if (SKIP_DIRS.has(target.split('/')[0]) || /^[\w-]+\.json(\.tmp)?$/.test(target)) continue;
    // only the new project's own files (a path with a segment named after it): never another project's
    if (!target.split('/').some((s) => s === fresh.id || s.startsWith(`${fresh.id}.`))) continue;
    const dst = path.join(DIR, target);
    if (!dst.startsWith(DIR + path.sep)) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, bytes);
  }
  projects.saveImmediately(fresh);
  return fresh;
}

// ---- duplicate / delete ------------------------------------------------------------

export function duplicateProject(p, name) {
  projects.saveImmediately(p);
  const copy = projects.createProject({ name: String(name || `${p.name} copy`).slice(0, 80), level: p.boot?.level || 9 });
  let text = JSON.stringify(p);
  text = text.split(p.id).join(copy.id);
  const data = JSON.parse(text);
  for (const k of ['id', 'name', 'createdAt', 'sessionId', 'redo', 'chat', 'assetTrash']) delete data[k];
  Object.assign(copy, data, { updatedAt: Date.now(), chat: [], sessionId: null, redo: [] });
  copyFiles(p.id, copy.id);
  projects.saveImmediately(copy);
  return copy;
}

// Deleted projects go to the trash folder (projects/trash), never straight away.
export function deleteProject(id) {
  const p = projects.getProject(id);
  if (!p) return false;
  projects.saveImmediately(p);
  projects.forget(id);
  const trash = path.join(DIR, 'trash');
  fs.mkdirSync(trash, { recursive: true });
  const stamp = Date.now();
  fs.renameSync(path.join(DIR, `${id}.json`), path.join(trash, `${id}.${stamp}.json`));
  // its files move along, below trash/<id>.<stamp>/
  for (const rel of projectFiles(id)) {
    const dst = path.join(trash, `${id}.${stamp}`, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(path.join(DIR, rel), dst);
  }
  return true;
}

// Put the newest trashed copy of a project back.
export function restoreDeleted(id) {
  const trash = path.join(DIR, 'trash');
  const found = (fs.existsSync(trash) ? fs.readdirSync(trash) : []).filter((f) => f.startsWith(`${id}.`) && f.endsWith('.json')).sort().pop();
  if (!found || fs.existsSync(path.join(DIR, `${id}.json`))) return null;
  fs.renameSync(path.join(trash, found), path.join(DIR, `${id}.json`));
  const filesDir = path.join(trash, found.slice(0, -5));
  if (fs.existsSync(filesDir)) {
    const walk = (d, rel) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(d, e.name), r);
        else { const dst = path.join(DIR, r); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.renameSync(path.join(d, e.name), dst); }
      }
    };
    walk(filesDir, '');
    fs.rmSync(filesDir, { recursive: true, force: true });
  }
  return projects.getProject(id);
}

// ---- the playable data and the standalone build ----------------------------------------

// What the player page needs: the whole project except the editing history and chat.
export function playData(p) {
  const doc = JSON.parse(JSON.stringify(p));
  for (const k of NOT_PLAYED) delete doc[k];
  doc.format = 'studio64-play';
  doc.patch = { areas: doc.areas || {}, world: doc.world || {} }; // world: start, hub, goal, pictures (worldflow.js)
  return doc;
}

// Relative imports of a module, followed transitively (the player's code).
function moduleClosure(webDir, entry) {
  const seen = new Set();
  const todo = [entry];
  while (todo.length) {
    const rel = todo.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const src = fs.readFileSync(path.join(webDir, rel), 'utf8');
    for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|import\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const spec = m[1] || m[2] || m[3];
      const next = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
      if (!next.startsWith('..') && fs.existsSync(path.join(webDir, next))) todo.push(next);
    }
  }
  return [...seen];
}

export const NINTENDO_NOTE = 'The game in this build is made from your own Super Mario 64 ROM: it contains Nintendo\'s copyrighted code, graphics and sounds. Play it yourself or share it privately with friends; do not upload it publicly or sell it.';

export function standaloneZip(p, { webDir, clientCatalog }) {
  projects.saveImmediately(p);
  const entries = [];
  const add = (name, data, store) => entries.push({ name, data, store });
  const fromWeb = (rel, as = rel) => add(as, fs.readFileSync(path.join(webDir, rel)));
  // the page is the player (web/play.html) at the root, with the same folders as web/
  add('index.html', fs.readFileSync(path.join(webDir, 'play.html')));
  fromWeb('css/play.css');
  if (fs.existsSync(path.join(webDir, 'css/shotgun.css'))) fromWeb('css/shotgun.css'); // (js/shotgun.js loads it)
  if (fs.existsSync(path.join(webDir, 'css/vehicles.css'))) fromWeb('css/vehicles.css'); // (js/vehicles.js loads it)
  if (fs.existsSync(path.join(webDir, 'css/katana.css'))) fromWeb('css/katana.css'); // (js/katana.js loads it)
  for (const rel of moduleClosure(webDir, 'js/player.js')) fromWeb(rel);
  fromWeb('engine/sm64.us.f3dex2e.js');
  fromWeb('engine/sm64.us.f3dex2e.wasm');
  // the game data the runtime reads (instruments, sounds, story texts and font, textures...)
  for (const f of fs.readdirSync(path.join(webDir, 'data'))) if (fs.statSync(path.join(webDir, 'data', f)).isFile() && f !== 'debug_names.json') fromWeb(`data/${f}`);
  if (fs.existsSync(path.join(webDir, 'favicon.svg'))) fromWeb('favicon.svg');
  // pictures of the original levels for the level list
  for (const f of (fs.existsSync(path.join(webDir, 'thumbs/levels')) ? fs.readdirSync(path.join(webDir, 'thumbs/levels')) : []).filter((x) => /^\d+\.jpg$/.test(x))) fromWeb(`thumbs/levels/${f}`);
  add('data/catalog.json', clientCatalog);
  add('data/hack.json', JSON.stringify(playData(p)));
  // the project's files: assets/<id>/... becomes assets/project/... (window.studioAssetBase)
  for (const rel of projectFiles(p.id)) {
    const r = rel.split('/').map((s) => (s === p.id ? 'project' : s)).join('/');
    add(r.startsWith('assets/') ? r : `assets/${r}`, fs.readFileSync(path.join(DIR, rel)));
  }
  const cover = coverBytes(p);
  if (cover) add(`cover.${cover.ext}`, cover.data);
  add('README.txt', [
    `${p.name}${p.meta?.author ? ` by ${p.meta.author}` : ''}`,
    p.meta?.description || '',
    '',
    'A Super Mario 64 hack made with Studio 64. This folder is a complete static web build:',
    'put it on any static web host (GitHub Pages, itch.io, a USB stick with a small web server)',
    'and open index.html. It needs no server code and works offline.',
    '',
    'Playing it locally: browsers do not run WebAssembly from file:// pages, so start a tiny',
    'web server in this folder, for example:',
    '    python3 -m http.server 8000      (then open http://localhost:8000)',
    '    npx serve .',
    '',
    'Controls: WASD move, Space jump, J punch, Shift crouch, arrow keys camera, Enter pause,',
    'L level list. Gamepads work too.',
    '',
    `IMPORTANT: ${NINTENDO_NOTE}`,
    '',
  ].join('\n'));
  return zipWrite(entries);
}

export function stats(p) {
  const objects = Object.values(p.areas || {}).reduce((n, a) => n + (a.objects?.length || 0), 0);
  return { levels: (p.levels || []).length, edits: (p.changes || []).length, objects, songs: p.audio?.songs?.length || 0, sounds: p.audio?.sounds?.length || 0, assetBytes: totalSize(p.id) };
}
