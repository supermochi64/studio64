// Projects: the persistent patch (objects added, objects removed, pipe warps per
// area), the change history used for undo, and the chat transcript.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.env.STUDIO_PROJECTS || path.join(here, 'projects');
fs.mkdirSync(DIR, { recursive: true });

const cache = new Map();
const saveTimers = new Map();

export const newId = () => crypto.randomBytes(6).toString('base64url');

function file(id) {
  if (!/^[\w-]{4,40}$/.test(id)) throw new Error('bad project id');
  return path.join(DIR, `${id}.json`);
}

export function createProject({ name = 'Untitled hack', level = 9 } = {}) {
  const p = {
    id: newId(),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    boot: { level, act: 1 },
    areas: {},
    changes: [],
    redo: [],
    chat: [],
    sessionId: null,
    model: null,
    levels: [],   // custom levels: { id, name, created, template }
    thumbs: {},   // area key -> small jpeg data URL
    audio: { songs: [], sounds: [], overrides: [] }, // the sound studio's songs, sound effects, replaced game sounds
  };
  cache.set(p.id, p);
  saveNow(p);
  return p;
}

export function getProject(id) {
  if (cache.has(id)) return cache.get(id);
  try {
    const p = JSON.parse(fs.readFileSync(file(id), 'utf8'));
    p.redo ||= [];
    p.levels ||= [];
    p.thumbs ||= {};
    p.audio ||= {};
    p.audio.songs ||= [];
    p.audio.sounds ||= [];
    p.audio.overrides ||= [];
    cache.set(id, p);
    return p;
  } catch {
    return null;
  }
}

export function listProjects() {
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => {
    const p = getProject(f.slice(0, -5));
    return p && { id: p.id, name: p.name, updatedAt: p.updatedAt, edits: p.changes.length };
  }).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
}

function saveNow(p) {
  fs.writeFileSync(file(p.id) + '.tmp', JSON.stringify(p));
  fs.renameSync(file(p.id) + '.tmp', file(p.id));
}

export function save(p) {
  p.updatedAt = Date.now();
  if (p.changes?.length > MAX_CHANGES) p.changes.splice(0, p.changes.length - MAX_CHANGES); // (see trimUndo)
  clearTimeout(saveTimers.get(p.id));
  saveTimers.set(p.id, setTimeout(() => saveNow(p), 300));
}

// Per-project binary assets (images, sounds, models...) live in their own folder;
// exports (.s64hack, standalone) and duplicates take the whole folder along.
export const PROJECTS_DIR = DIR;
export const assetDir = (id) => { file(id); return path.join(DIR, 'assets', id); };

// Drop a project from memory (deleted or replaced on disk): no pending save may write it back.
export function forget(id) {
  clearTimeout(saveTimers.get(id));
  saveTimers.delete(id);
  cache.delete(id);
}

// Write a project now (exports and snapshots want what is in memory on disk).
export function saveImmediately(p) {
  clearTimeout(saveTimers.get(p.id));
  saveTimers.delete(p.id);
  saveNow(p);
}

export function flushAll() {
  for (const [id, t] of saveTimers) {
    clearTimeout(t);
    const p = cache.get(id);
    if (p) saveNow(p);
  }
}

const areaOf = (p, key) => (p.areas[key] ||= { objects: [], removals: [], warps: [] });

// What the browser needs to re-apply edits when areas load.
export function patchOf(p) {
  // world: the hack's flow (start, hub, goal) and shared pictures (world_store.js)
  return { areas: p.areas, world: p.world || {} };
}

// One user-visible change (one tool call) groups the records it created.
export function recordChange(p, { summary, key: k, level, area, objects = [], removals = [], warps = [], dropped = [] }) {
  const key = k || `${level}:${area}`;
  const a = areaOf(p, key);
  const change = { id: newId(), ts: Date.now(), summary, key, objects: [], removals: [], warps: [], dropped: [] };
  for (const o of objects) { a.objects.push(o); change.objects.push(o.uid); }
  for (const r of removals) { r.id ||= newId(); a.removals.push(r); change.removals.push(r.id); }
  for (const w of warps) {
    a.warps = a.warps.filter((x) => x.node !== w.node);
    a.warps.push(w);
    change.warps.push(w.node);
  }
  // studio objects deleted by this change: keep them so undo can restore them
  for (const uid of dropped) {
    for (const [k, ar] of Object.entries(p.areas)) {
      const i = ar.objects.findIndex((o) => o.uid === uid);
      if (i >= 0) { change.dropped.push({ key: k, record: ar.objects[i] }); ar.objects.splice(i, 1); }
    }
  }
  p.changes.push(change);
  p.redo = [];
  save(p);
  return change;
}

// Update a stored object in place (move/rotate), remembering the old record for undo.
export function updateObject(p, uid, fields, summary) {
  for (const [key, a] of Object.entries(p.areas)) {
    const o = a.objects.find((x) => x.uid === uid);
    if (o) {
      const before = { ...o };
      Object.assign(o, fields);
      const change = { id: newId(), ts: Date.now(), summary, key, objects: [], removals: [], warps: [], dropped: [], moved: [{ uid, before }] };
      p.changes.push(change);
      p.redo = [];
      save(p);
      return change;
    }
  }
  return null;
}

// Update several stored objects as one change (group moves, align, distribute).
export function updateObjects(p, updates, summary) {
  const change = { id: newId(), ts: Date.now(), summary, key: null, objects: [], removals: [], warps: [], dropped: [], moved: [] };
  for (const { uid, fields } of updates || []) {
    for (const [key, a] of Object.entries(p.areas)) {
      const o = a.objects.find((x) => x.uid === uid);
      if (o) {
        change.moved.push({ uid, before: { ...o } });
        Object.assign(o, fields || {});
        change.key ||= key;
        break;
      }
    }
  }
  if (!change.moved.length) return null;
  p.changes.push(change);
  p.redo = [];
  save(p);
  return change;
}

// Replace one field of an area (terrain, settings), remembering the old value for undo.
// Terrain (~66 KB a copy, one per brush stroke) keeps only the bytes the edit touched: a diff
// with their old and new values (terrainDiff), so a long sculpting session stays small.
export function updateArea(p, key, field, value, summary) {
  const a = areaOf(p, key);
  const change = { id: newId(), ts: Date.now(), summary, key, objects: [], removals: [], warps: [], dropped: [], area: { field, before: a[field] ?? null } };
  const diff = field === 'terrain' ? terrainDiff(a[field], value) : null;
  if (diff) change.area = { field, diff };
  a[field] = value;
  p.changes.push(change);
  trimUndo(p);
  p.redo = [];
  save(p);
  return change;
}

// ---- compact terrain undo -------------------------------------------------------------------
// A terrain is { nx, nz, cell, x0, z0, h: base64 Int16 heights, m: base64 material bytes }.
const TERRAIN_HEAD = ['nx', 'nz', 'cell', 'x0', 'z0'];
const sameGrid = (a, b) => !!a && !!b && typeof a.h === 'string' && typeof b.h === 'string' && typeof a.m === 'string' && typeof b.m === 'string' && TERRAIN_HEAD.every((k) => a[k] === b[k]);
// runs of changed bytes: [start, old bytes (base64), new bytes (base64)]; near runs merge
function byteRuns(x, y) {
  const runs = [];
  for (let i = 0; i < x.length;) {
    if (x[i] === y[i]) { i++; continue; }
    let j = i + 1, same = 0;
    for (; j < x.length; j++) { if (x[j] === y[j]) { if (++same > 8) { j++; break; } } else same = 0; }
    const end = j - same; // just after the last changed byte (always > i)
    runs.push([i, x.subarray(i, end).toString('base64'), y.subarray(i, end).toString('base64')]);
    i = end;
  }
  return runs;
}
export function terrainDiff(before, after) {
  if (!sameGrid(before, after)) return null; // a new or resized terrain keeps the whole copy
  const bh = Buffer.from(before.h, 'base64'), ah = Buffer.from(after.h, 'base64');
  const bm = Buffer.from(before.m, 'base64'), am = Buffer.from(after.m, 'base64');
  if (bh.length !== ah.length || bm.length !== am.length) return null;
  return { h: byteRuns(bh, ah), m: byteRuns(bm, am) };
}
// The terrain with the diff's old (undo) or new (redo) bytes; null when it no longer fits.
export function applyTerrainDiff(t, diff, side) {
  if (!t || typeof t.h !== 'string' || typeof t.m !== 'string') return null;
  const out = { ...t };
  for (const f of ['h', 'm']) {
    const buf = Buffer.from(t[f], 'base64');
    for (const [start, oldB, newB] of diff[f] || []) {
      const bytes = Buffer.from(side === 'old' ? oldB : newB, 'base64');
      if (start + bytes.length > buf.length) return null;
      bytes.copy(buf, start);
    }
    out[f] = buf.toString('base64');
  }
  return out;
}
const undoBytes = (c) => (c.area?.diff ? JSON.stringify(c.area.diff).length : c.area?.before ? JSON.stringify(c.area.before).length : 0);

// The history stays bounded: the last MAX_CHANGES edits, and big area snapshots (terrain,
// paths...) undoable within AREA_UNDO_BYTES, newest first. Versions are the long-term safety net.
const MAX_CHANGES = 1500;
const AREA_UNDO_BYTES = 4e6;
function trimUndo(p) {
  if (p.changes.length > MAX_CHANGES) p.changes.splice(0, p.changes.length - MAX_CHANGES);
  let total = 0;
  for (let i = p.changes.length - 1; i >= 0; i--) {
    const c = p.changes[i];
    if (!c.area || (c.area.before === undefined && !c.area.diff)) continue;
    total += undoBytes(c);
    if (total > AREA_UNDO_BYTES) { c.area.before = undefined; delete c.area.diff; }
  }
}

// ---- project-wide edits (story, assets, world flow, sound studio) ------------------------
// They live outside the areas, so a change keeps the field's value from before the edit
// (`project: { path, before }`, key '@project'); undo puts it back, redo puts the newer one back.
// Quick edits of the same thing (typing a dialog, dragging a slider) become one undo step.
export const PROJECT_KEY = '@project';
const MAX_PROJECT_SNAPSHOTS = 40;
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
export function getPath(p, path) { return path.reduce((o, k) => (o == null ? undefined : o[k]), p); }
function setPath(p, path, value) {
  let o = p;
  for (const k of path.slice(0, -1)) o = (o[k] ||= {});
  if (value === undefined) delete o[path[path.length - 1]]; else o[path[path.length - 1]] = value;
}

// Call before changing p[path]: `before` is the value it has now.
export function recordProjectChange(p, path, before, summary, { by = null, merge = 2500 } = {}) {
  path = [].concat(path);
  const last = p.changes[p.changes.length - 1];
  if (last?.project && last.project.path.join('.') === path.join('.') && last.summary === summary && last.by === by && Date.now() - last.ts < merge && last.project.before !== undefined) {
    last.ts = Date.now(); // the same edit going on: keep the older value
    p.redo = [];
    return last;
  }
  const change = { id: newId(), ts: Date.now(), summary: String(summary || 'Changed the project').slice(0, 200), key: PROJECT_KEY, by, objects: [], removals: [], warps: [], dropped: [], project: { path, before: before === undefined ? null : clone(before) } };
  p.changes.push(change);
  // snapshots of big fields: only the last ones stay undoable
  const snaps = p.changes.filter((c) => c.project && c.project.before !== undefined);
  for (const c of snaps.slice(0, -MAX_PROJECT_SNAPSHOTS)) c.project.before = undefined;
  p.redo = [];
  save(p);
  return change;
}

// One sculpt stroke on an original level's geometry.
export function addSculpt(p, key, stroke, summary) {
  const a = areaOf(p, key);
  (a.sculpt ||= []).push(stroke);
  const change = { id: newId(), ts: Date.now(), summary, key, objects: [], removals: [], warps: [], dropped: [], sculpt: stroke.id };
  p.changes.push(change);
  p.redo = [];
  save(p);
  return change;
}

// ---- custom levels ---------------------------------------------------------

// Level operations (create, rename, delete, duplicate) are undoable: the change keeps the
// level list and the level's areas before and after (see undoChange / redoChange).
const levelKeys = (id) => (k) => k === `c:${id}` || k.startsWith(`c:${id}:`);
function levelSnap(p, id) {
  const mine = levelKeys(id);
  return {
    levels: JSON.parse(JSON.stringify(p.levels)),
    areas: Object.fromEntries(Object.keys(p.areas).filter(mine).map((k) => [k, JSON.parse(JSON.stringify(p.areas[k]))])),
    thumbs: Object.fromEntries(Object.keys(p.thumbs || {}).filter(mine).map((k) => [k, p.thumbs[k]])),
  };
}
function applyLevelSnap(p, id, snap) {
  const mine = levelKeys(id);
  p.levels = JSON.parse(JSON.stringify(snap.levels));
  for (const k of Object.keys(p.areas)) if (mine(k)) delete p.areas[k];
  Object.assign(p.areas, JSON.parse(JSON.stringify(snap.areas)));
  for (const k of Object.keys(p.thumbs || {})) if (mine(k)) delete p.thumbs[k];
  Object.assign((p.thumbs ||= {}), snap.thumbs);
}
function recordLevelChange(p, id, summary, before, removedChanges = []) {
  const change = { id: newId(), ts: Date.now(), summary, key: `c:${id}`, objects: [], removals: [], warps: [], dropped: [], level: { id, before, after: levelSnap(p, id), removedChanges } };
  p.changes.push(change);
  p.redo = [];
  return change;
}

// For other level edits (world_store.js: sub-areas made, renamed, deleted): snapshot first,
// then record the change after editing.
export const snapLevel = (p, id) => levelSnap(p, id);
export function recordLevelEdit(p, id, summary, before, removedChanges = []) {
  const c = recordLevelChange(p, id, summary, before, removedChanges);
  save(p);
  return c;
}

// quiet: not an undoable edit (new projects, imports, duplicates record their own)
export function createLevel(p, { id, name, template, area, quiet = false }) {
  const before = quiet ? null : levelSnap(p, id);
  p.levels.push({ id, name: String(name || 'New level').slice(0, 60), created: Date.now(), template: template || null });
  p.areas[`c:${id}`] = { objects: [], removals: [], warps: [], ...(area || {}) };
  if (!quiet) recordLevelChange(p, id, `Created level “${p.levels[p.levels.length - 1].name}”`, before);
  save(p);
  return p.levels[p.levels.length - 1];
}

export function renameLevel(p, id, name) {
  const l = p.levels.find((x) => x.id === id);
  if (l) {
    const before = levelSnap(p, id);
    const old = l.name;
    l.name = String(name).slice(0, 60);
    if (old !== l.name) recordLevelChange(p, id, `Renamed level “${old}” to “${l.name}”`, before);
    save(p);
  }
  return l;
}

export function deleteLevel(p, id) {
  const gone = p.levels.find((x) => x.id === id);
  const before = levelSnap(p, id);
  p.levels = p.levels.filter((x) => x.id !== id);
  // the level's sub-areas (c:<id>:<n>) go with it
  const mine = levelKeys(id);
  for (const k of Object.keys(p.areas)) if (mine(k)) delete p.areas[k];
  for (const k of Object.keys(p.thumbs)) if (mine(k)) delete p.thumbs[k];
  const removed = p.changes.filter((c) => mine(c.key));
  p.changes = p.changes.filter((c) => !mine(c.key));
  if (gone) recordLevelChange(p, id, `Deleted level “${gone.name}”`, before, removed);
  save(p);
}

export function duplicateLevel(p, id, newIdStr) {
  const l = p.levels.find((x) => x.id === id);
  if (!l) return null;
  // the main area and its sub-areas (c:<id>:<n>), with fresh uids so objects stay unique
  // across levels; doors and pipes between the copy's own areas lead to the copy's areas
  const uidMap = new Map();
  const copies = {};
  for (const [k, a] of Object.entries(p.areas)) {
    const m = k === `c:${id}` ? [k, '1'] : k.match(new RegExp(`^c:${id}:(\\d+)$`));
    if (!m) continue;
    const c = JSON.parse(JSON.stringify(a));
    for (const o of c.objects || []) { const uid = 1 + Math.floor(Math.random() * 0x7efffffe); uidMap.set(o.uid, uid); o.uid = uid; }
    copies[m[1]] = c;
  }
  for (const c of Object.values(copies)) {
    for (const o of c.objects || []) {
      const to = o.warp?.to;
      if (to?.custom !== id) continue;
      o.warp.to = { ...to, custom: newIdStr, ...(to.uid && uidMap.has(to.uid) ? { uid: uidMap.get(to.uid) } : {}) };
    }
  }
  const before = levelSnap(p, newIdStr);
  const made = createLevel(p, { id: newIdStr, name: `${l.name} copy`, template: l.template, area: copies['1'] || {}, quiet: true });
  if (l.areas) made.areas = JSON.parse(JSON.stringify(l.areas));
  if (l.mainAreaName) made.mainAreaName = l.mainAreaName;
  for (const [n, c] of Object.entries(copies)) if (n !== '1') p.areas[`c:${newIdStr}:${n}`] = c;
  recordLevelChange(p, newIdStr, `Duplicated level “${l.name}”`, before);
  save(p);
  return made;
}

// ---- the sound studio --------------------------------------------------------

const upsert = (list, item) => {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item; else list.push(item);
  return item;
};

export function saveSong(p, song) {
  if (!song || typeof song.id !== 'string' || JSON.stringify(song).length > 400000) return null;
  song.name = String(song.name || 'Song').slice(0, 60);
  upsert(p.audio.songs, song);
  save(p);
  return song;
}

export function saveSound(p, sound) {
  if (!sound || typeof sound.id !== 'string' || JSON.stringify(sound).length > 2500000) return null;
  sound.name = String(sound.name || 'Sound').slice(0, 60);
  upsert(p.audio.sounds, sound);
  save(p);
  return sound;
}

export function deleteAudio(p, kind, id) {
  if (kind === 'song') p.audio.songs = p.audio.songs.filter((x) => x.id !== id);
  if (kind === 'sound') {
    p.audio.sounds = p.audio.sounds.filter((x) => x.id !== id);
    p.audio.overrides = p.audio.overrides.filter((o) => o.sound !== id);
  }
  save(p);
}

export function setOverrides(p, overrides) {
  p.audio.overrides = (Array.isArray(overrides) ? overrides : [])
    .filter((o) => Number.isFinite(o.bits) && typeof o.sound === 'string').slice(0, 96)
    .map((o) => ({ bits: o.bits >>> 0, sound: o.sound, name: String(o.name || '').slice(0, 80) }));
  save(p);
}

// Undo a change. Returns the live operations the browser must perform.
export function undoChange(p, changeId) {
  const i = changeId ? p.changes.findIndex((c) => c.id === changeId) : p.changes.length - 1;
  if (i < 0) return null;
  const c = p.changes[i];
  if (c.area && c.area.before === undefined && !c.area.diff) return null; // too old to undo
  if (c.project && c.project.before === undefined) return null;
  p.changes.splice(i, 1);
  if (c.project) {
    // a project-wide field (story, assets, world, audio) goes back; redo keeps the newer value
    p.redo = [...(p.redo || []), { change: c, value: clone(getPath(p, c.project.path)) }].slice(-50);
    setPath(p, c.project.path, clone(c.project.before === null ? undefined : c.project.before));
    save(p);
    return { change: c, ops: { key: PROJECT_KEY }, project: c.project.path };
  }
  if (c.level) {
    // a level created, renamed, deleted or duplicated: the level list and its areas go back
    applyLevelSnap(p, c.level.id, c.level.before);
    if (c.level.removedChanges?.length) p.changes = [...p.changes, ...c.level.removedChanges].sort((x, y) => x.ts - y.ts);
    p.redo = [...(p.redo || []), { change: c, level: true }].slice(-50);
    save(p);
    return { change: c, ops: { key: '*', reloadArea: true }, levels: true };
  }
  const a = areaOf(p, c.key);
  if (c.area) {
    // one field of one area: redo keeps that field (or reuses the terrain diff), not the whole area
    if (c.area.diff) {
      const back = applyTerrainDiff(a[c.area.field], c.area.diff, 'old');
      if (!back) { p.changes.splice(i, 0, c); return null; } // the terrain was replaced since: can't
      a[c.area.field] = back;
      p.redo = [...(p.redo || []), { change: c, diff: true }].slice(-50);
    } else {
      p.redo = [...(p.redo || []), { change: c, value: clone(a[c.area.field]) ?? null }].slice(-50);
      if (c.area.before === null) delete a[c.area.field]; else a[c.area.field] = c.area.before;
    }
    save(p);
    return { change: c, ops: { key: c.key, reloadArea: true } };
  }
  // redo puts the touched objects, rules and warps back exactly as they were before this undo
  // (only those: a copy of the whole area also copied its terrain into every redo step)
  const keys = [...new Set([c.key, ...(c.dropped || []).map((d) => d.key)])];
  // (`part`: only these fields; a sculpt undo keeps the strokes too)
  const objectPart = (ar) => JSON.parse(JSON.stringify({ part: true, objects: ar.objects || [], removals: ar.removals || [], warps: ar.warps || [], ...(c.sculpt ? { sculpt: ar.sculpt || [] } : {}) }));
  p.redo = [...(p.redo || []), { change: c, areas: Object.fromEntries(keys.map((k) => [k, objectPart(areaOf(p, k))])) }].slice(-50);
  if (c.sculpt) {
    a.sculpt = (a.sculpt || []).filter((s) => s.id !== c.sculpt);
    save(p);
    return { change: c, ops: { key: c.key, reloadArea: true } };
  }
  const ops = { key: c.key, deleteUids: [], removedRules: [], restore: [], warps: [] };
  a.objects = a.objects.filter((o) => {
    if (c.objects.includes(o.uid)) { ops.deleteUids.push(o.uid); return false; }
    return true;
  });
  a.removals = a.removals.filter((r) => {
    if (c.removals.includes(r.id)) { ops.removedRules.push(r); return false; }
    return true;
  });
  a.warps = a.warps.filter((w) => !c.warps.includes(w.node));
  for (const d of c.dropped || []) {
    areaOf(p, d.key).objects.push(d.record);
    ops.restore.push({ key: d.key, record: d.record });
  }
  for (const m of c.moved || []) {
    for (const ar of Object.values(p.areas)) {
      const o = ar.objects.find((x) => x.uid === m.uid);
      if (o) {
        // fields the change added (scale, pitch, ...) go away too
        for (const k of Object.keys(o)) if (!(k in m.before)) delete o[k];
        Object.assign(o, m.before);
        ops.deleteUids.push(o.uid);
        ops.restore.push({ key: c.key, record: o });
      }
    }
  }
  save(p);
  return { change: c, ops };
}

// Redo the last undone change. Returns the live operations the browser must perform.
export function redoChange(p) {
  const r = (p.redo || []).pop();
  if (!r) return null;
  const c = r.change;
  if (c.project) {
    // the undone value of a project-wide field: back to the newer one
    c.project.before = clone(getPath(p, c.project.path)) ?? null;
    setPath(p, c.project.path, clone(r.value));
    c.ts = Date.now();
    p.changes.push(c);
    save(p);
    return { change: c, ops: { key: PROJECT_KEY }, project: c.project.path };
  }
  if (r.level) {
    applyLevelSnap(p, c.level.id, c.level.after);
    const ids = new Set((c.level.removedChanges || []).map((x) => x.id));
    p.changes = p.changes.filter((x) => !ids.has(x.id));
    p.changes.push(c);
    save(p);
    return { change: c, ops: { key: '*', reloadArea: true }, levels: true };
  }
  if (c.area && (r.diff || 'value' in r)) {
    const a = areaOf(p, c.key);
    if (r.diff) {
      const fwd = applyTerrainDiff(a[c.area.field], c.area.diff, 'new');
      if (!fwd) { p.redo.push(r); return null; }
      a[c.area.field] = fwd;
    } else {
      c.area.before = clone(a[c.area.field]) ?? null;
      if (r.value === null) delete a[c.area.field]; else a[c.area.field] = clone(r.value);
    }
    p.changes.push(c);
    trimUndo(p);
    save(p);
    return { change: c, ops: { key: c.key, reloadArea: true } };
  }
  const ops = { key: c.key, deleteUids: [], restore: [], warps: [], addRules: [] };
  let reload = !!(c.area || c.sculpt);
  for (const [k, snap] of Object.entries(r.areas)) {
    const cur = areaOf(p, k);
    // objects that differ between now and the snapshot are deleted and spawned again
    const now = new Map(cur.objects.map((o) => [o.uid, JSON.stringify(o)]));
    const then = new Map((snap.objects || []).map((o) => [o.uid, JSON.stringify(o)]));
    for (const [uid, j] of now) if (then.get(uid) !== j) ops.deleteUids.push(uid);
    for (const o of snap.objects || []) if (now.get(o.uid) !== then.get(o.uid)) ops.restore.push({ key: k, record: o });
    const ruleIds = new Set((cur.removals || []).map((x) => x.id));
    for (const rule of snap.removals || []) if (k === c.key && !ruleIds.has(rule.id)) ops.addRules.push(rule);
    if (JSON.stringify(cur.warps || []) !== JSON.stringify(snap.warps || [])) { ops.warps = snap.warps || []; if (k !== c.key) reload = true; }
    // (older redo steps hold a whole area; newer ones only its objects, rules and warps)
    if (snap.part) { const { part, ...fields } = snap; Object.assign(cur, fields); } else p.areas[k] = snap;
  }
  p.changes.push(c);
  save(p);
  return { change: c, ops: reload ? { key: c.key, reloadArea: true, deleteUids: ops.deleteUids, restore: ops.restore } : ops };
}

// The original levels go back to the game's; the project's own levels (c:...) are not edits and
// stay as they are (clearing them left levels without ground).
export function resetEdits(p) {
  // (also kept: '@game' rules and custom objects, '@project' story/assets/world edits)
  const own = (k) => k.startsWith('c:') || k.startsWith('@');
  p.areas = Object.fromEntries(Object.entries(p.areas).filter(([k]) => own(k)));
  p.changes = p.changes.filter((c) => own(c.key));
  p.redo = [];
  save(p);
}

export function changeList(p) {
  return p.changes.map((c) => ({
    id: c.id, ts: c.ts, summary: c.summary, key: c.key, level: c.level ? true : undefined, project: c.project ? c.project.path[0] : undefined,
    count: c.objects.length + c.removals.length + (c.dropped?.length || 0) + (c.moved?.length || 0),
  }));
}
