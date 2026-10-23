// Roads & nature in the game: turns the area's road, line and nature records into engine models
// (src/studio/assets.c model slots) every time an area loads or the records change. Runs in the
// studio and in the standalone player (web/js/player.js), so a hack looks the same everywhere.
//
// Records (in the area's `objects`, so undo, other tabs and the project file work like for any edit):
//   { uid, name, road:   { style, width, pts: [[x, y, z, w?], ...], closed, smooth, lanes, left, right, prof, drop, ... } }
//   { uid, name, line:   { style, pts, closed, smooth, gaps: [seg...], gates: [seg...], scale, prof } }
//   { uid, name, nature: { items: [[kind, x, y, z, yawDeg, scalePct, nx100, nz100], ...] } }
// The engine objects made from them use uids 0x7e400000+ and are hidden from the object lists.

import { prepareNetwork, buildRoadMesh, carveTerrain, fitProfile, samplesOf, roadAt, STEP } from './roads.js';
import { buildLine } from './lines.js';
import { Mesh } from './mesh.js';
import { sampleCurve, closestOnCurve, resample, lerp } from './geom.js';
import { KIND, CHUNK, buildNatureMesh, itemInst } from './nature.js';

export const UID_BASE = 0x7e400000;
const UID_SPAN = 0x100000;
const TERRAIN_ID = 1; // world.js
const SMALL_FAR = 5200, BIG_FAR = 16000; // plants further away than this are not drawn

export const isPathRecord = (r) => !!(r && (r.road || r.line || r.nature));

export class PathsRuntime {
  constructor({ engine, world, assets = null, toast = () => {} }) {
    this.engine = engine;
    this.world = world;
    this.assets = assets;
    this.toast = toast;
    this.objs = new Map();      // id -> { slot, model, uid, flags, origin, kind, chunk, small }
    this.mine = new Map();      // engine slot -> id
    this.recSig = new Map();    // record uid -> signature (what was built)
    this.natChunks = new Map(); // nature record uid -> Set of chunk keys
    this.roadSigs = new Map();  // road/line uid -> mesh signature
    this.net = [];
    this.lines = [];
    this.editing = false;       // roads and lines have no collision while being edited (ground sampling)
    this.seq = 0;
    this.ownSlots = Array.from({ length: 48 }, (_, i) => 200 + i);
    this.listeners = [];
    this.stats = { roads: 0, lines: 0, plants: 0, tris: 0, trees: 0 };
    this.customTex = new Map();
    this.install();
    this.installGroundFollow();
  }

  on(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }
  emit() { for (const fn of this.listeners) { try { fn(); } catch (err) { console.error('paths listener', err); } } }

  get M() { return this.engine.M; }
  key() { return this.engine.areaKey(); }
  records(key = this.key()) { return this.engine.patch?.areas?.[key]?.objects || []; }
  roadRecs() { return this.records().filter((r) => r.road); }
  lineRecs() { return this.records().filter((r) => r.line); }
  natureRecs() { return this.records().filter((r) => r.nature); }

  // ---- plants on ground that changed --------------------------------------------------------

  // A stroke of the terrain brushes (raise, lower, smooth, flatten; custom terrain or an original
  // level): the plants that stood on the old ground stand on the new one afterwards, one edit.
  installGroundFollow() {
    const w = this.world;
    if (!w?.beginStroke || !w.dab || !w.endStroke) return;
    const begin = w.beginStroke.bind(w), dab = w.dab.bind(w), end = w.endStroke.bind(w);
    w.beginStroke = (mode, hit, brush) => {
      const st = begin(mode, hit, brush);
      if (st && mode !== 'paint') st.plantGround = this.plantGrounds();
      return st;
    };
    w.dab = (st, x, z) => {
      const out = dab(st, x, z);
      if (st?.plantGround) {
        const r = st.brush?.radius || 0, b = st.box;
        st.box = b ? [Math.min(b[0], x - r), Math.min(b[1], z - r), Math.max(b[2], x + r), Math.max(b[3], z + r)] : [x - r, z - r, x + r, z + r];
      }
      return out;
    };
    w.endStroke = (st) => {
      const out = end(st);
      if (st?.plantGround && st.box) {
        try { this.followGround(st.plantGround, st.box); } catch (err) { console.error('paths: plants on the new ground', err); }
      }
      return out;
    };
  }

  // the ground under every plant of the area: item -> height
  plantGrounds() {
    const g = new Map();
    for (const rec of this.natureRecs()) for (const it of rec.nature.items || []) g.set(it, this.groundAt(it[1], it[3], it[2]));
    return g;
  }

  followGround(before, [x0, z0, x1, z1]) {
    const updates = [];
    for (const rec of this.natureRecs()) {
      let changed = false;
      const items = (rec.nature.items || []).map((it) => {
        const old = before.get(it);
        if (old == null || it[1] < x0 || it[1] > x1 || it[3] < z0 || it[3] > z1 || KIND[it[0]]?.water === 'on') return it;
        if (Math.abs(it[2] - old) > 16) return it; // (not on that ground: on a block, a bridge)
        const now = this.groundAt(it[1], it[3], Math.max(it[2], old) + 1500);
        if (now == null || Math.abs(now - old) < 1) return it;
        changed = true;
        const moved = it.slice();
        moved[2] = Math.round(it[2] + (now - old));
        return moved;
      });
      if (!changed) continue;
      rec.nature.items = items;
      touchNature(rec);
      updates.push({ uid: rec.uid, fields: { nature: { ...rec.nature, items } } });
    }
    if (!updates.length || !this.ui?.ops) return;
    this.ui.ops.commit({ type: 'update_many', updates, summary: 'Plants moved with the ground' });
    this.sync();
  }

  // ---- hooks into the engine ---------------------------------------------------------------

  install() {
    const e = this.engine;
    e.spawnFilters.push((rec) => {
      if (!isPathRecord(rec)) return undefined;
      this.schedule();
      return -1;
    });
    e.levelHooks.push(() => this.onAreaStart());
    e.afterAreaHooks.push((level, area, key) => this.onAreaLoaded(key));
    const setPatch = e.setPatch.bind(e);
    e.setPatch = (p) => { setPatch(p); this.schedule(); };
    const deleteUid = e.deleteUid.bind(e);
    e.deleteUid = (uid) => { if (this.recSig.has(uid)) this.schedule(); return deleteUid(uid); };
    // our engine objects are not "objects" for the rest of the studio
    const objects = e.objects.bind(e);
    e.objects = () => objects().filter((o) => !(o.uid >= UID_BASE && o.uid < UID_BASE + UID_SPAN));
    const raycast = e.raycast.bind(e);
    this.rawRaycast = raycast;
    e.raycast = (o, d, ignoreSlot = -1, objs = true, maxDist = 60000) => {
      let hit = raycast(o, d, ignoreSlot, objs, maxDist);
      for (let k = 0; k < 4 && hit && this.mine.has(hit.slot); k++) {
        if (hit.type !== undefined) { // our ground: it is level geometry for everyone else
          hit.paths = this.mine.get(hit.slot);
          hit.slot = -1; hit.kind = 'level';
          break;
        }
        hit = raycast(o, d, hit.slot, objs, maxDist); // the object's own pick sphere: look past it
      }
      return hit;
    };
    e.on('frame', () => this.onFrame());
    this.wrapTerrain();
  }

  // custom-level terrain is cut and filled under the roads (the saved heightmap stays as it was)
  wrapTerrain() {
    const w = this.world;
    if (!w) return;
    const load = w.loadTerrain.bind(w);
    w.loadTerrain = (t) => {
      load(t);
      try { if (w.terrain && this.carve(false)) this.engine.terrainBuild(TERRAIN_ID, 0, 0, -1, -1, false); } catch (err) { console.error('paths: carve', err); }
    };
    const sync = w.syncTerrain.bind(w);
    w.syncTerrain = (rect, collision = true) => {
      sync(rect, collision);
      try { if (w.terrain && this.carve(false)) this.engine.terrainBuild(TERRAIN_ID, rect.i0, rect.j0, rect.i1, rect.j1, collision); } catch (err) { console.error('paths: carve', err); }
    };
  }

  // Apply the roads' cut and fill to the engine's terrain heights. Returns the touched cells.
  carve(fromPatch = true) {
    const w = this.world, T = w?.terrain;
    const v = T && this.engine.terrainViews(TERRAIN_ID);
    if (!v) return null;
    const recs = this.roadRecs();
    if (!recs.length) return null;
    const net = fromPatch && this.net.length ? this.net : prepareNetwork(recs);
    return carveTerrain(v.heights, T, net);
  }

  // Roads changed in a custom level: the ground under them again.
  recarve() {
    const w = this.world, T = w?.terrain;
    const v = T && this.engine.terrainViews(TERRAIN_ID);
    if (!v) return;
    v.heights.set(T.h);
    const rect = carveTerrain(v.heights, T, this.net);
    const prev = this.carveRect;
    this.carveRect = rect;
    const u = rect && prev ? { i0: Math.min(rect.i0, prev.i0), j0: Math.min(rect.j0, prev.j0), i1: Math.max(rect.i1, prev.i1), j1: Math.max(rect.j1, prev.j1) } : rect || prev;
    if (u) this.engine.terrainBuild(TERRAIN_ID, u.i0, u.j0, u.i1, u.j1, false);
  }

  onAreaStart() {
    // the old area's objects are gone with it: free their models
    for (const o of this.objs.values()) if (o.model >= 0) this.freeSlot(o.model);
    this.objs.clear();
    this.mine.clear();
    this.recSig.clear();
    this.natChunks.clear();
    this.roadSigs.clear();
    this.net = [];
    this.lines = [];
    this.carveRect = null;
    this.editing = false;
  }

  onAreaLoaded() {
    try { this.sync({ collision: true }); } catch (err) { console.error('paths: area', err); }
  }

  schedule() {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      if (!this.engine.ready && !this.engine.M?._studio_model_begin) return;
      try { this.sync(); } catch (err) { console.error('paths: sync', err); }
    }, 0);
  }

  onFrame() {
    if ((this.frameN = (this.frameN || 0) + 1) % 10) return;
    // distance culling of plants
    let cam;
    try { cam = this.engine.camOut().pos; } catch { return; }
    const M = this.M;
    if (!M?._studio_set_visible) return;
    for (const o of this.objs.values()) {
      if (o.kind !== 'nature' || !o.center) continue;
      const d = Math.hypot(o.center[0] - cam[0], o.center[2] - cam[2]) - CHUNK * 0.7;
      const vis = d < (o.small ? SMALL_FAR : BIG_FAR);
      if (vis !== o.visible) { o.visible = vis; M._studio_set_visible(o.slot, vis ? 1 : 0); }
    }
  }

  // ---- model slots and objects ------------------------------------------------------------

  takeSlot() {
    const pool = this.assets?.freeSlots;
    // the imported models take slots from the bottom, these from the top
    const s = pool?.length ? pool.shift() : this.ownSlots.shift();
    if (s === undefined) throw new Error('no model slot left (too many models in this area)');
    return s;
  }
  freeSlot(slot) {
    try { this.M?._studio_model_free?.(slot); } catch { /* engine gone */ }
    if (this.assets?.freeSlots) this.assets.freeSlots.unshift(slot); else this.ownSlots.unshift(slot);
  }

  // Put a mesh into the game as object `id` (replacing what was there).
  place(id, mesh, { kind, collision = true, small = false, chunk = null } = {}) {
    this.remove(id);
    if (!mesh || mesh.empty()) return null;
    const c = mesh.center();
    // the origin sits under the mesh: the object's pick sphere stays out of the way
    const origin = [c[0], Math.round(mesh.min[1] - 300), c[2]];
    const model = this.takeSlot();
    let tris = 0;
    try { tris = mesh.upload(this.engine, model, origin); } catch (err) { this.freeSlot(model); throw err; }
    const uid = UID_BASE + (this.seq = (this.seq + 1) % UID_SPAN);
    const o = { id, model, uid, kind, collision, small, chunk, origin, tris, center: c, visible: true, hasCol: mesh.colTypes.length > 0, flights: mesh.flights || 0 };
    o.slot = this.spawnObj(o);
    this.objs.set(id, o);
    if (o.slot >= 0) this.mine.set(o.slot, id);
    return o;
  }

  spawnObj(o) {
    const flags = o.hasCol && o.collision && !(this.editing && (o.kind === 'road' || o.kind === 'line')) ? 1 : 0;
    o.flags = flags;
    return this.M._studio_model_spawn(o.model, o.origin[0], o.origin[1], o.origin[2], 0, 0, 0, 1, flags, 0, 1, o.uid);
  }

  remove(id) {
    const o = this.objs.get(id);
    if (!o) return;
    if (o.slot >= 0) { this.M._studio_delete_slot(o.slot); this.mine.delete(o.slot); }
    for (const s of o.trees || []) this.M._studio_delete_slot(s);
    if (o.model >= 0) this.freeSlot(o.model);
    this.objs.delete(id);
  }

  rebuildCollision() {
    if (this.assets?.rebuildCollision) this.assets.rebuildCollision();
    else this.engine.rebuildCollision();
  }

  // Roads and lines lose their collision while being edited, so the ground under them can be read.
  setEditing(on) {
    if (this.editing === !!on) return;
    this.editing = !!on;
    let any = false;
    for (const o of this.objs.values()) {
      if ((o.kind !== 'road' && o.kind !== 'line') || !o.hasCol) continue;
      if (o.slot >= 0) { this.M._studio_delete_slot(o.slot); this.mine.delete(o.slot); }
      o.slot = this.spawnObj(o);
      if (o.slot >= 0) this.mine.set(o.slot, o.id);
      any = true;
    }
    if (any) this.rebuildCollision();
  }

  // ---- building ------------------------------------------------------------------------

  ctx() {
    return { engine: this.engine, customMaterial: (slot) => this.customMaterial(slot) };
  }

  // A custom material's picture (Assets › Materials), loaded on first use.
  customMaterial(slot) {
    if (this.customTex.has(slot)) return this.customTex.get(slot);
    const a = this.assets;
    const m = a?.meta?.materials?.find((x) => x.slot === slot);
    if (!m) return null;
    this.customTex.set(slot, null);
    a.fileRGBA(m.file).then((img) => {
      this.customTex.set(slot, { w: img.w, h: img.h, rgba: img.rgba });
      this.roadSigs.clear();
      this.sync({ force: true });
    }).catch(() => {});
    return null;
  }

  // Bring the game in line with the records. Rebuilds only what changed.
  sync({ force = false, collision = true } = {}) {
    if (!this.M?._studio_model_begin) return;
    const recs = this.records();
    const roads = recs.filter((r) => r.road), lines = recs.filter((r) => r.line), nats = recs.filter((r) => r.nature);
    const seen = new Set();
    let changedCol = false;

    // roads and lines: the whole network is prepared again; each mesh is rebuilt only if it changed
    const rlSig = JSON.stringify(roads.map((r) => [r.uid, r.road])) + JSON.stringify(lines.map((r) => [r.uid, r.line]));
    if (force || rlSig !== this.rlSig) {
      const roadsChanged = force || JSON.stringify(roads.map((r) => [r.uid, r.road])) !== this.roadOnlySig;
      this.rlSig = rlSig;
      this.roadOnlySig = JSON.stringify(roads.map((r) => [r.uid, r.road]));
      this.net = prepareNetwork(roads);
      const ctx = this.ctx();
      for (const R of this.net) {
        const id = `r:${R.rec.uid}`;
        seen.add(id);
        const sig = JSON.stringify([R.road, R.Y.map((y) => Math.round(y)), R.lift, R.under, R.gaps, !!R.ends.start, !!R.ends.end]);
        if (!force && this.roadSigs.get(id) === sig && this.objs.has(id)) { R.flights = this.objs.get(id).flights || 0; continue; }
        this.roadSigs.set(id, sig);
        const mesh = buildRoadMesh(R, ctx);
        R.flights = R.flights || 0;
        mesh.flights = R.flights;
        this.place(id, mesh, { kind: 'road' });
        changedCol = true;
      }
      this.lines = [];
      for (const rec of lines) {
        const id = `l:${rec.uid}`;
        seen.add(id);
        const L = prepareLine(rec);
        if (L) this.lines.push(L);
        const sig = JSON.stringify(rec.line);
        if (!force && this.roadSigs.get(id) === sig && this.objs.has(id)) continue;
        this.roadSigs.set(id, sig);
        const mesh = new Mesh();
        if (L) buildLine(mesh, rec.line.style, L.runs, { scale: rec.line.scale || 1 });
        this.place(id, mesh, { kind: 'line' });
        changedCol = true;
      }
      for (const id of [...this.objs.keys()]) {
        if ((id.startsWith('r:') || id.startsWith('l:')) && !seen.has(id)) { this.remove(id); this.roadSigs.delete(id); changedCol = true; }
      }
      if (roadsChanged && this.world?.terrain && this.engine.level === this.engine.studioLevel) {
        this.recarve();
        changedCol = true;
      }
    }

    // nature: the chunks whose plants changed
    const dirty = new Set();
    const live = new Set();
    for (const rec of nats) {
      live.add(rec.uid);
      const sig = sigOfNature(rec);
      if (!force && this.recSig.get(rec.uid) === sig) continue;
      this.recSig.set(rec.uid, sig);
      const chunks = new Set((rec.nature.items || []).map((it) => chunkKey(it[1], it[3])));
      for (const c of this.natChunks.get(rec.uid) || []) dirty.add(c);
      for (const c of chunks) dirty.add(c);
      this.natChunks.set(rec.uid, chunks);
    }
    for (const [uid, chunks] of [...this.natChunks]) {
      if (live.has(uid)) continue;
      for (const c of chunks) dirty.add(c);
      this.natChunks.delete(uid);
      this.recSig.delete(uid);
    }
    for (const r of roads) this.recSig.set(r.uid, 'road');
    for (const r of lines) this.recSig.set(r.uid, 'line');
    if (force) for (const id of this.objs.keys()) if (id.startsWith('n:')) dirty.add(id.split(':')[1]);
    if (dirty.size) changedCol = this.rebuildChunks(dirty, nats) || changedCol;

    if (changedCol && collision) this.rebuildCollision();
    this.M._studio_assets_gc?.();
    this.updateStats();
    this.emit();
  }

  rebuildChunks(dirty, nats) {
    // every item of the dirty chunks
    const byChunk = new Map();
    for (const rec of nats) for (const it of rec.nature.items || []) {
      const ck = chunkKey(it[1], it[3]);
      if (!dirty.has(ck)) continue;
      if (!byChunk.has(ck)) byChunk.set(ck, []);
      byChunk.get(ck).push(it);
    }
    // (a plant under the custom terrain -- the ground was raised by an undo, a template, the AI --
    // grows on top of it: buried plants are never meant)
    const T = this.world?.terrain;
    const onTerrain = !!T && this.engine.level === this.engine.studioLevel;
    const lift = (it) => {
      if (!onTerrain || KIND[it[0]]?.water === 'on' || !T.contains(it[1], it[3])) return it;
      const t = T.heightAt(it[1], it[3]);
      return t > it[2] + 2 ? [it[0], it[1], Math.round(t), ...it.slice(3)] : it;
    };
    let col = false;
    for (const ck of dirty) {
      const items = byChunk.get(ck) || [];
      const insts = items.map((it) => itemInst(lift(it)));
      for (const small of [true, false]) {
        const id = `n:${ck}:${small ? 's' : 'b'}`;
        const list = insts.filter((i) => KIND[i.kind] && KIND[i.kind].type !== 'sm64' && !!KIND[i.kind].small === small);
        const had = this.objs.get(id);
        if (!list.length) { if (had) { this.remove(id); col = col || had.hasCol; } continue; }
        const mesh = buildNatureMesh(list);
        const o = this.place(id, mesh, { kind: 'nature', small, chunk: ck });
        if (o) { o.visible = true; col = col || o.hasCol || !!had?.hasCol; }
      }
      // the game's own trees: real objects (Mario climbs them)
      const tid = `t:${ck}`;
      const old = this.objs.get(tid);
      if (old) { for (const s of old.trees) this.M._studio_delete_slot(s); this.objs.delete(tid); }
      const trees = insts.filter((i) => KIND[i.kind]?.type === 'sm64');
      if (trees.length) {
        const slots = [];
        for (const t of trees) {
          const idx = this.engine.entryIndex.get(KIND[t.kind].entry);
          if (idx === undefined) continue;
          const uid = UID_BASE + (this.seq = (this.seq + 1) % UID_SPAN);
          const s = this.M._studio_spawn(idx, t.x, t.y, t.z, Math.round((t.yaw / (Math.PI * 2)) * 65536) & 0xffff, 0, 0, 0, uid, t.s || 1);
          if (s >= 0) slots.push(s);
        }
        this.objs.set(tid, { id: tid, model: -1, slot: -1, kind: 'trees', trees: slots, chunk: ck });
      }
    }
    return col;
  }

  updateStats() {
    let tris = 0, plants = 0, trees = 0;
    for (const o of this.objs.values()) { if (o.kind === 'nature') tris += o.tris || 0; if (o.trees) trees += o.trees.length; }
    for (const r of this.natureRecs()) plants += r.nature.items?.length || 0;
    this.stats = { roads: this.net.length, lines: this.lines.length, plants, tris, trees, models: [...this.objs.values()].filter((o) => o.model >= 0).length };
  }

  // ---- queries for the editor and the tools -------------------------------------------------

  // The ground at (x, z) near height yHint, without our roads (call while editing) but with the
  // custom terrain as it is without cuts.
  groundAt(x, z, yHint = 20000) {
    const e = this.engine;
    let h = null;
    for (const y0 of [yHint + 400, 20000]) {
      const v = e.floor(x, y0, z);
      if (v > -20000) { h = v; break; }
    }
    const T = this.world?.terrain;
    if (T && T.contains(x, z) && this.engine.level === this.engine.studioLevel) {
      const t = T.heightAt(x, z);
      h = h == null ? t : Math.max(h, t);
    }
    return h;
  }

  // Fit a road or line record to the ground (stores prof/drop in it). Roads must not collide now.
  fit(rec) {
    const was = this.editing;
    if (!was) this.setEditing(true);
    try {
      if (rec.road) Object.assign(rec.road, fitProfile(rec.road, (x, z, y) => this.groundAt(x, z, y)));
      else if (rec.line) rec.line.prof = fitLine(rec.line, (x, z, y) => this.groundAt(x, z, y));
    } finally { if (!was) this.setEditing(false); }
    return rec;
  }

  // The road or line under a ground point: { kind: 'road' | 'line', rec, c } or null.
  pickAt(x, z, margin = 10) {
    const r = roadAt(this.net, x, z, margin);
    if (r) return { kind: 'road', rec: r.R.rec, c: r.c, R: r.R };
    let best = null;
    for (const L of this.lines) {
      const c = closestOnCurve(L.S, x, z);
      if (c && c.d < 40 + margin && (!best || c.d < best.c.d)) best = { kind: 'line', rec: L.rec, c, L };
    }
    return best;
  }

  roadNear(x, z, margin) { return roadAt(this.net, x, z, margin); }
}

const chunkKey = (x, z) => `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
const sigCache = new WeakMap();
function sigOfNature(rec) {
  const n = rec.nature;
  let s = sigCache.get(n);
  if (s === undefined || n.items?.length !== s.len) {
    s = { len: n.items?.length || 0, v: JSON.stringify(n.items || []) };
    sigCache.set(n, s);
  }
  return s.v;
}
// The UI changes nature items in place: forget the cached signature.
export function touchNature(rec) { if (rec?.nature) sigCache.delete(rec.nature); }

// ---- lines ----------------------------------------------------------------------------------

function lineSamples(line) {
  return sampleCurve(line.pts || [], { closed: !!line.closed, smooth: !!line.smooth, step: STEP, width: 40 });
}

export function fitLine(line, ground) {
  const S = lineSamples(line);
  return S.map((s) => {
    const g = ground(s.x, s.z, s.y);
    return Math.round(g == null ? s.y : g);
  });
}

// A line record -> its sampled curve and the runs between gaps (with gates).
export function prepareLine(rec) {
  const line = rec.line;
  const S = lineSamples(line);
  if (S.length < 2) return null;
  const Y = resample(line.prof, S.length) || S.map((s) => s.y);
  S.forEach((s, i) => { s.y = Y[i]; });
  const pts = line.pts;
  const nSeg = line.closed && pts.length > 2 ? pts.length : pts.length - 1;
  // where each control point is along the curve
  const sAt = pts.map((p) => closestOnCurve(S, p[0], p[2])?.s ?? 0);
  if (line.closed && pts.length > 2) sAt.push(S[S.length - 1].s);
  const gaps = new Set(line.gaps || []), gates = new Set(line.gates || []);
  const ranges = [];
  for (let k = 0; k < nSeg; k++) if (gaps.has(k) || gates.has(k)) ranges.push([k, sAt[k], sAt[k + 1] ?? S[S.length - 1].s]);
  const pointAt = (s) => {
    for (let i = 0; i + 1 < S.length; i++) {
      if (S[i + 1].s >= s) { const f = (s - S[i].s) / Math.max(1e-6, S[i + 1].s - S[i].s); return [lerp(S[i].x, S[i + 1].x, f), lerp(S[i].y, S[i + 1].y, f), lerp(S[i].z, S[i + 1].z, f)]; }
    }
    const l = S[S.length - 1];
    return [l.x, l.y, l.z];
  };
  const runs = [];
  let cur = { pts: [] };
  for (let i = 0; i < S.length; i++) {
    const s = S[i].s;
    const g = ranges.find((r) => s > r[1] + 0.5 && s < r[2] - 0.5);
    if (g) {
      if (cur.pts.length) { cur.pts.push(pointAt(g[1])); runs.push(cur); }
      cur = { pts: [] };
      continue;
    }
    if (!cur.pts.length) {
      const prev = ranges.find((r) => Math.abs(s - r[2]) < STEP && s >= r[2] - 0.5);
      if (prev && i > 0) cur.pts.push(pointAt(prev[2]));
    }
    cur.pts.push([S[i].x, S[i].y, S[i].z]);
  }
  if (cur.pts.length) runs.push(cur);
  // gates stand in their gaps
  const gateList = ranges.filter((r) => gates.has(r[0])).map((r) => [pointAt(r[1]), pointAt(r[2])]);
  if (gateList.length) runs.push({ pts: [], gates: gateList });
  return { rec, S, runs: runs.filter((r) => r.pts.length > 1 || r.gates), sAt };
}

export { samplesOf };
