// Version history: snapshots of a whole project (everything but the chat and the
// Claude session), taken on demand ("Save version") and automatically while
// someone edits. Browse, compare (what changed) and restore.
//
// Stored in projects/versions/<project id>/: index.json plus one gzipped JSON per version.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import * as projects from './projects.js';
import { levelName } from './catalog.js';
import { restoreAssetFiles } from './assets.js';

const ROOT = path.join(projects.PROJECTS_DIR, 'versions');
const AUTO_EVERY = Number(process.env.STUDIO_SNAPSHOT_MINUTES || 10) * 60 * 1000;
const KEEP_AUTO = 40;
// Not part of a version: the conversation, the session and local bookkeeping.
// (assetTrash: deleted asset files waiting for an undo; it follows the files, not the versions)
const SKIP = new Set(['chat', 'sessionId', 'redo', 'model', 'id', 'createdAt', 'updatedAt', 'assetTrash']);

const dirOf = (id) => { if (!/^[\w-]{4,40}$/.test(id)) throw new Error('bad project id'); return path.join(ROOT, id); };

function content(p) {
  const out = {};
  for (const [k, v] of Object.entries(p)) if (!SKIP.has(k)) out[k] = v;
  return JSON.parse(JSON.stringify(out));
}
const hashOf = (c) => crypto.createHash('sha1').update(JSON.stringify(c)).digest('hex').slice(0, 16);

export function list(id) {
  try { return JSON.parse(fs.readFileSync(path.join(dirOf(id), 'index.json'), 'utf8')); } catch { return []; }
}
function writeList(id, items) {
  fs.mkdirSync(dirOf(id), { recursive: true });
  fs.writeFileSync(path.join(dirOf(id), 'index.json.tmp'), JSON.stringify(items));
  fs.renameSync(path.join(dirOf(id), 'index.json.tmp'), path.join(dirOf(id), 'index.json'));
}

function countObjects(c) { return Object.values(c.areas || {}).reduce((n, a) => n + (a.objects?.length || 0), 0); }

// Take a snapshot. auto: skipped when nothing changed since the last one.
export function snapshot(p, { label, auto = false } = {}) {
  const c = content(p);
  const hash = hashOf(c);
  const items = list(p.id);
  const last = items[items.length - 1];
  if (auto && last && last.hash === hash) return null;
  const v = {
    id: `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`, ts: Date.now(),
    label: String(label || (auto ? 'Auto-save' : 'Saved version')).slice(0, 80), auto, hash,
    stats: { edits: (c.changes || []).length, levels: (c.levels || []).length, objects: countObjects(c) },
  };
  const gz = zlib.gzipSync(JSON.stringify(c), { level: 6 });
  fs.mkdirSync(dirOf(p.id), { recursive: true });
  fs.writeFileSync(path.join(dirOf(p.id), `${v.id}.json.gz`), gz);
  v.size = gz.length;
  items.push(v);
  // old automatic snapshots thin out; named versions stay
  const autos = items.filter((x) => x.auto);
  const drop = new Set(autos.slice(0, Math.max(0, autos.length - KEEP_AUTO)).map((x) => x.id));
  for (const d of drop) { try { fs.unlinkSync(path.join(dirOf(p.id), `${d}.json.gz`)); } catch { /* gone */ } }
  writeList(p.id, items.filter((x) => !drop.has(x.id)));
  lastSnap.set(p.id, Date.now());
  return v;
}

export function load(id, vid) {
  if (!/^[\w]{4,40}$/.test(vid)) throw new Error('bad version id');
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dirOf(id), `${vid}.json.gz`))).toString('utf8'));
}

export function remove(id, vid) {
  const items = list(id);
  if (!items.some((x) => x.id === vid)) return false;
  try { fs.unlinkSync(path.join(dirOf(id), `${vid}.json.gz`)); } catch { /* gone */ }
  writeList(id, items.filter((x) => x.id !== vid));
  return true;
}

export function rename(id, vid, label) {
  const items = list(id);
  const v = items.find((x) => x.id === vid);
  if (!v) return null;
  v.label = String(label || v.label).slice(0, 80);
  v.auto = false; // a named version is kept
  writeList(id, items);
  return v;
}

// Put a version back. The current state is saved as a version first, so a restore can be undone.
export function restore(p, vid) {
  const c = load(p.id, vid);
  const v = list(p.id).find((x) => x.id === vid);
  const before = snapshot(p, { label: `Before restoring “${v?.label || 'a version'}”` });
  for (const k of Object.keys(p)) if (!SKIP.has(k) && !(k in c)) delete p[k];
  Object.assign(p, c);
  p.redo = [];
  p.areas ||= {}; p.changes ||= []; p.levels ||= []; p.thumbs ||= {};
  p.audio ||= {}; p.audio.songs ||= []; p.audio.sounds ||= []; p.audio.overrides ||= [];
  restoreAssetFiles(p); // asset files deleted since that version come back from the trash
  projects.save(p);
  projects.saveImmediately(p);
  return { restored: v, backup: before };
}

// ---- comparing ------------------------------------------------------------------------

function areaName(key, levels) {
  if (key === '@game') return 'Whole game (rules, custom objects)';
  if (key.startsWith('c:')) {
    // sub-areas are c:<id>:<n>
    const [, id, n] = key.split(':');
    const l = levels.find((x) => x.id === id);
    if (!l) return 'Custom level';
    const ai = Number(n) || 1;
    return ai > 1 ? `${l.name} · ${(l.areas || []).find((x) => x.index === ai)?.name || `area ${ai}`}` : l.name;
  }
  const [n, a] = key.split(':');
  return `${levelName(Number(n)) || `Level ${n}`}${a && a !== '1' ? ` (area ${a})` : ''}`;
}

function recName(r) {
  if (r.star?.name) return `★ ${r.star.name}`;
  if (r.name) return r.name;
  if (r.block) return 'Block';
  return String(r.entry || r.bhv || 'object').replace(/_/g, ' ');
}

const group = (names) => {
  const m = new Map();
  for (const n of names) m.set(n, (m.get(n) || 0) + 1);
  return [...m].map(([n, c]) => (c > 1 ? `${c} × ${n}` : n));
};

// What changed from a to b (b is the newer one), as readable lines per level.
export function diff(a, b) {
  const levels = [...(b.levels || []), ...(a.levels || [])];
  const sections = [];
  const keys = [...new Set([...Object.keys(a.areas || {}), ...Object.keys(b.areas || {})])].sort();
  for (const key of keys) {
    const A = a.areas?.[key] || {}, B = b.areas?.[key] || {};
    if (JSON.stringify(A) === JSON.stringify(B)) continue;
    const items = [];
    const ao = new Map((A.objects || []).map((o) => [o.uid, o])), bo = new Map((B.objects || []).map((o) => [o.uid, o]));
    const added = [...bo.values()].filter((o) => !ao.has(o.uid));
    const removed = [...ao.values()].filter((o) => !bo.has(o.uid));
    const changed = [...bo.values()].filter((o) => ao.has(o.uid) && JSON.stringify(ao.get(o.uid)) !== JSON.stringify(o));
    if (added.length) items.push({ kind: 'add', text: `Added ${group(added.map(recName)).join(', ')}` });
    if (removed.length) items.push({ kind: 'remove', text: `Removed ${group(removed.map(recName)).join(', ')}` });
    if (changed.length) items.push({ kind: 'change', text: `Moved or changed ${group(changed.map(recName)).join(', ')}` });
    const ar = (A.removals || []).length, br = (B.removals || []).length;
    if (ar !== br) items.push({ kind: br > ar ? 'remove' : 'add', text: br > ar ? `Removed ${br - ar} original object${br - ar > 1 ? 's' : ''}` : `Brought back ${ar - br} original object${ar - br > 1 ? 's' : ''}` });
    if (JSON.stringify(A.warps || []) !== JSON.stringify(B.warps || [])) items.push({ kind: 'change', text: `Warps: ${(A.warps || []).length} → ${(B.warps || []).length}` });
    if (JSON.stringify(A.terrain ?? null) !== JSON.stringify(B.terrain ?? null)) items.push({ kind: 'change', text: B.terrain ? (A.terrain ? 'Reshaped the terrain' : 'Added terrain') : 'Removed the terrain' });
    const as = (A.sculpt || []).length, bs = (B.sculpt || []).length;
    if (as !== bs) items.push({ kind: 'change', text: bs > as ? `Sculpted the ground (${bs - as} stroke${bs - as > 1 ? 's' : ''})` : `Undid ${as - bs} sculpt stroke${as - bs > 1 ? 's' : ''}` });
    const sa = A.settings || {}, sb = B.settings || {};
    const sk = [...new Set([...Object.keys(sa), ...Object.keys(sb)])].filter((k) => JSON.stringify(sa[k]) !== JSON.stringify(sb[k]));
    if (sk.length) items.push({ kind: 'change', text: `Level settings: ${sk.join(', ')}` });
    const other = [...new Set([...Object.keys(A), ...Object.keys(B)])].filter((k) => !['objects', 'removals', 'warps', 'terrain', 'sculpt', 'settings'].includes(k) && JSON.stringify(A[k]) !== JSON.stringify(B[k]));
    if (other.length) items.push({ kind: 'change', text: `Changed ${other.join(', ')}` });
    if (!a.areas?.[key]) items.unshift({ kind: 'add', text: 'New area' });
    if (!b.areas?.[key]) items.unshift({ kind: 'remove', text: 'Area deleted' });
    if (items.length) sections.push({ key, title: areaName(key, levels), items });
  }
  const project = [];
  const al = new Map((a.levels || []).map((l) => [l.id, l])), bl = new Map((b.levels || []).map((l) => [l.id, l]));
  for (const l of bl.values()) if (!al.has(l.id)) project.push({ kind: 'add', text: `New level “${l.name}”` });
  for (const l of al.values()) if (!bl.has(l.id)) project.push({ kind: 'remove', text: `Deleted level “${l.name}”` });
  for (const l of bl.values()) if (al.has(l.id) && al.get(l.id).name !== l.name) project.push({ kind: 'change', text: `Renamed “${al.get(l.id).name}” to “${l.name}”` });
  if (a.name !== b.name && a.name && b.name) project.push({ kind: 'change', text: `Project renamed from “${a.name}” to “${b.name}”` });
  for (const kind of ['songs', 'sounds']) {
    const x = new Map((a.audio?.[kind] || []).map((s) => [s.id, s])), y = new Map((b.audio?.[kind] || []).map((s) => [s.id, s]));
    const add = [...y.values()].filter((s) => !x.has(s.id)), del = [...x.values()].filter((s) => !y.has(s.id));
    const ch = [...y.values()].filter((s) => x.has(s.id) && JSON.stringify(x.get(s.id)) !== JSON.stringify(s));
    const what = kind === 'songs' ? 'song' : 'sound';
    if (add.length) project.push({ kind: 'add', text: `New ${what}${add.length > 1 ? 's' : ''}: ${add.map((s) => s.name).join(', ')}` });
    if (del.length) project.push({ kind: 'remove', text: `Deleted ${what}${del.length > 1 ? 's' : ''}: ${del.map((s) => s.name).join(', ')}` });
    if (ch.length) project.push({ kind: 'change', text: `Edited ${what}${ch.length > 1 ? 's' : ''}: ${ch.map((s) => s.name).join(', ')}` });
  }
  if (JSON.stringify(a.audio?.overrides || []) !== JSON.stringify(b.audio?.overrides || [])) project.push({ kind: 'change', text: 'Replaced game sounds changed' });
  if (JSON.stringify(a.boot || null) !== JSON.stringify(b.boot || null)) project.push({ kind: 'change', text: 'Start level changed' });
  if (JSON.stringify(a.meta || null) !== JSON.stringify(b.meta || null)) project.push({ kind: 'change', text: 'Project settings changed' });
  // anything else the project keeps (story, world, rules, assets ...)
  const known = new Set(['areas', 'levels', 'audio', 'name', 'boot', 'meta', 'changes', 'thumbs', 'chat', 'redo', 'sessionId', 'model', 'id', 'createdAt', 'updatedAt', 'assetTrash']);
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !known.has(k))) {
    if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) project.push({ kind: a[k] === undefined ? 'add' : b[k] === undefined ? 'remove' : 'change', text: `${k.charAt(0).toUpperCase()}${k.slice(1).replace(/_/g, ' ')} changed` });
  }
  if (project.length) sections.unshift({ key: '*', title: 'Project', items: project });
  const n = sections.reduce((s, x) => s + x.items.length, 0);
  return { same: n === 0, count: n, sections };
}

export const current = (p) => content(p);

// ---- automatic snapshots -----------------------------------------------------------------

const lastSnap = new Map(); // project id -> time of the last snapshot (this run)
const seenEdit = new Map(); // project id -> updatedAt when we last looked

// Every minute: projects edited since their last snapshot get one once AUTO_EVERY has passed.
export function startAuto(getLoaded) {
  const tick = () => {
    for (const p of getLoaded()) {
      try {
        if (!p || !p.changes) continue;
        const prev = seenEdit.get(p.id);
        seenEdit.set(p.id, p.updatedAt);
        if (prev === undefined) {
          // first look at this project in this run: wait for an edit
          const items = list(p.id);
          // (no version yet: count from now, else an untouched project got an empty "Auto-save" a minute after opening)
          lastSnap.set(p.id, items.length ? items[items.length - 1].ts : Date.now());
          continue;
        }
        const since = Date.now() - (lastSnap.get(p.id) || 0);
        if (p.updatedAt > (lastSnap.get(p.id) || 0) && since >= AUTO_EVERY) snapshot(p, { auto: true });
      } catch (err) { console.error('[versions]', err.message); }
    }
  };
  const t = setInterval(tick, 60 * 1000);
  t.unref?.();
  return tick;
}
