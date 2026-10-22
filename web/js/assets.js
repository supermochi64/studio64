// The project's own assets in the running game: imported models (level geometry
// and props), replaced game textures, custom block/terrain materials, custom
// skies and Mario's colours. Everything is stored on the server (files in the
// asset store, settings in project.assets) and re-applied on every load.
//
// Records of placed models live in the area patch like any object:
//   { uid, asset: { model, mode: 'prop' | 'level', collision, anim, speed }, x, y, z, yaw, pitch, roll, scale, name }
// Other features can draw an imported model: assets.modelSlot(id) is the engine
// model id (src/studio/studio_assets.h: studio_asset_model_node).

import { registerRpc } from './studio.js';
import { MATERIALS } from './generators.js';
import { decodeN64, encodeRGBA16, rasterize, quantize, toPNGBlob, blobToRGBA, recolor, pattern, parseColor, hex, toCanvas } from './texcodec.js';
import { decodePackage, uploadPackage, defaultMaterialMeta } from './asset_mesh.js';

export const ANIMS = { none: 0, spin: 1, bob: 2, spin_bob: 3, sway: 4, pulse: 5 };
export const ANIM_NAMES = { none: 'Still', spin: 'Spin', bob: 'Float up & down', spin_bob: 'Spin & float', sway: 'Sway', pulse: 'Pulse' };

// Mario's parts, in the engine's order (ASSET_MARIO_* in studio_assets.h).
export const MARIO_PARTS = [
  ['overalls', 'Overalls'], ['shirt', 'Shirt & arms'], ['gloves', 'Gloves'], ['shoes', 'Shoes'], ['skin', 'Skin'], ['hair', 'Hair'], ['cap', 'Cap'],
];
export const MARIO_PRESETS = {
  mario: { name: 'Mario', colors: {} },
  luigi: { name: 'Luigi', colors: { cap: '#00a038', shirt: '#00a038', overalls: '#1b2fbf' } },
  wario: { name: 'Wario', colors: { cap: '#f5d000', shirt: '#f5d000', overalls: '#7c2fa8', shoes: '#1e7a24' } },
  waluigi: { name: 'Waluigi', colors: { cap: '#5b2a90', shirt: '#5b2a90', overalls: '#20203e', shoes: '#e58217' } },
  fire: { name: 'Fire Mario', colors: { cap: '#ffffff', shirt: '#ffffff', overalls: '#e3141c' } },
  ice: { name: 'Ice Mario', colors: { cap: '#47b8ff', shirt: '#47b8ff', overalls: '#ffffff' } },
  classic: { name: 'Classic (NES)', colors: { cap: '#c8321e', shirt: '#7c6a08', overalls: '#c8321e', skin: '#f0a848', hair: '#5a3a08' } },
  gold: { name: 'Gold', colors: { cap: '#ffc81e', shirt: '#ffc81e', overalls: '#c88a00', gloves: '#fff2a8', shoes: '#9a6400' } },
  shadow: { name: 'Shadow', colors: { cap: '#24242e', shirt: '#2c2c3c', overalls: '#16161e', gloves: '#3a3a48', shoes: '#101014', skin: '#5c5c7a', hair: '#0e0e10' } },
  builder: { name: 'Builder', colors: { cap: '#ffb300', shirt: '#ffb300', overalls: '#3d6bc4', gloves: '#c48a3c' } },
  doctor: { name: 'Doctor', colors: { cap: '#f4f4f4', shirt: '#f4f4f4', overalls: '#e8e8ee' } },
  pink: { name: 'Pink', colors: { cap: '#ff6fb5', shirt: '#ff6fb5', overalls: '#7d3cff' } },
};

const SKY_K = { n64: 1, hd: 2 }; // texels per sky tile pixel (32 or 64 per tile)

const plainName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
// "levels/bob/0.rgba16" -> "bob 0", "actors/mario/mario_logo.rgba16" -> "mario logo"
const texName = (path) => {
  const parts = path.split('/');
  const base = parts.pop().replace(/\.(rgba16|rgba32|ia\d+|i\d|ci\d)$/, '');
  const dir = parts.pop() || '';
  return (/^[\da-f]+$/i.test(base) ? `${dir} ${base}` : base).replace(/_/g, ' ');
};

export class Assets {
  constructor({ engine, getProjectId, getPassword, getClientId, toast, commit, getPatch }) {
    this.engine = engine;
    this.getProjectId = getProjectId;
    this.getPassword = getPassword;
    this.getClientId = getClientId;
    this.toast = toast || (() => {});
    this.commit = commit;        // (op) => send an edit (area patch) to the server
    this.getPatch = getPatch;    // () => the patch
    this.meta = { files: {}, models: [], textures: {}, materials: [], skies: {}, mario: {} };
    this.listeners = [];
    this.files = new Map();      // file id -> Promise<Uint8Array>
    this.models = new Map();     // model id -> { slot, ready: Promise, info }
    this.freeSlots = Array.from({ length: 256 }, (_, i) => 255 - i);
    this.pending = new Map();    // uid -> record waiting for its model
    this.texAddr = null;         // texture path -> address in memory (after locate)
    this.appliedTex = new Map(); // path -> file id now applied
    this.skyState = null;        // what sky is in the engine: file id + quality
    this.poseHash = 0;
    this.loaded = false;
    window.studio64Assets = this;
    engine.spawnFilters.push((rec) => (rec.asset ? this.spawn(rec) : undefined));
    engine.levelHooks.push((level, area, key) => this.onAreaLoad(key));
    engine.afterAreaHooks.push((level, area, key) => this.afterArea(key));
    engine.on('frame', () => this.onFrame());
    engine.on('ready', () => this.applyAll());
    window.addEventListener('studio-message', (e) => {
      const msg = e.detail;
      if (msg?.type === 'assets' && msg.by !== this.getClientId?.()) this.setMeta(msg.assets);
    });
    registerAssetRpcs(this);
  }

  on(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }
  emit(what) { for (const fn of this.listeners) { try { fn(what); } catch (err) { console.error(err); } } }

  // ---- server --------------------------------------------------------------------

  base() { return `/api/projects/${this.getProjectId()}/assets`; }
  headers(extra = {}) { return { 'x-studio-key': this.getPassword?.() || '', 'x-studio-client': this.getClientId?.() || '', ...extra }; }

  async load() {
    try {
      const r = await fetch(this.base(), { headers: this.headers() });
      if (r.ok) this.setMeta(await r.json(), true);
    } catch (err) { console.warn('assets: could not load', err); }
    this.loaded = true;
  }

  setMeta(meta, first = false) {
    const before = this.meta;
    this.meta = { files: {}, models: [], textures: {}, materials: [], skies: {}, mario: {}, ...(meta || {}) };
    if (this.engine.ready) {
      // models whose settings changed are rebuilt
      for (const m of this.meta.models) {
        const old = before.models.find((x) => x.id === m.id);
        if (old && (old.file !== m.file || JSON.stringify(old.materials) !== JSON.stringify(m.materials) || old.lighting !== m.lighting)) this.reloadModel(m.id);
      }
      // models deleted elsewhere (another tab, an undo): free their engine copy
      for (const old of before.models) if (!this.meta.models.some((m) => m.id === old.id)) this.freeModel(old.id);
      this.applyAll();
    }
    this.emit(first ? 'load' : 'meta');
  }

  async save(field, value) {
    this.meta[field] = value;
    this.emit(field);
    const r = await fetch(this.base(), { method: 'PATCH', headers: this.headers({ 'content-type': 'application/json' }), body: JSON.stringify({ set: { [field]: value } }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'could not save');
  }

  async upload(blob, kind, name) {
    const r = await fetch(`${this.base()}/files?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name || '')}`, { method: 'POST', headers: this.headers(), body: blob });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'upload failed');
    this.meta.files[j.id] = { name, kind, size: j.size, created: Date.now() };
    return j.id;
  }

  fileBytes(id) {
    if (!this.files.has(id)) {
      this.files.set(id, fetch(`${this.base()}/files/${id}`, { headers: this.headers() }).then(async (r) => {
        if (!r.ok) throw new Error(`asset ${id} is missing`);
        return new Uint8Array(await r.arrayBuffer());
      }).catch((err) => { this.files.delete(id); throw err; }));
    }
    return this.files.get(id);
  }

  async fileRGBA(id) { return blobToRGBA(new Blob([await this.fileBytes(id)], { type: 'image/png' })); }

  async deleteFile(id) {
    if (!id) return;
    this.files.delete(id);
    delete this.meta.files[id];
    await fetch(`${this.base()}/files/${id}`, { method: 'DELETE', headers: this.headers() }).catch(() => {});
  }

  get M() { return this.engine.M; }
  key() { return this.engine.areaKey(); }

  // ---- applying everything -------------------------------------------------------

  applyAll() {
    if (!this.engine.ready) return;
    try { this.applyMario(); } catch (err) { console.error('mario colours', err); }
    try { this.applyMaterials(); } catch (err) { console.error('materials', err); }
    this.applyTextures().catch((err) => console.error('textures', err));
    this.applySky(this.key()).catch((err) => console.error('sky', err));
    this.spawnMissing();
  }

  onAreaLoad(key) {
    if (!this.engine.M?._studio_assets_area_reset) return;
    this.M._studio_assets_area_reset();
    this.M._studio_tex_flush(); // everything drawn in this area shows up in "In this level"
    this.applySky(key).catch((err) => console.error('sky', err));
  }

  afterArea(key) {
    // placed models with static collision: put them into the level collision now
    const recs = (this.getPatch()?.areas?.[key]?.objects || []).filter((r) => r.asset);
    if (recs.length) {
      this.rebuildCollision();
      this.applyWater(key);
    }
    this.poseHash = this.M._studio_assets_pose_hash?.() || 0;
    this.M._studio_assets_gc?.(); // rebuilt models the last area still drew
  }

  onFrame() {
    // static collision follows models moved in the editor (checked a few times a second)
    if (!this.engine.ready || (this.frameN = (this.frameN || 0) + 1) % 12) return;
    const M = this.M;
    if (!M?._studio_assets_pose_hash) return;
    const h = M._studio_assets_pose_hash();
    if (h !== this.poseHash) {
      if (this.lastHash === h) { this.poseHash = h; this.rebuildCollision(); this.applyWater(this.key()); }
      this.lastHash = h;
    }
  }

  rebuildCollision() {
    try { this.engine.rebuildCollision(); } catch (err) { console.error(err); }
    this.poseHash = this.M._studio_assets_pose_hash?.() || 0;
    // the level's collision has room for about 57,000 triangles in all
    const dropped = this.M._studio_assets_dropped?.() || 0;
    if (dropped && dropped !== this.lastDropped) this.toast(`${dropped.toLocaleString()} triangles of imported models are not solid: this level's collision is full. Use simpler models or mark decoration as "No collision".`, 'x');
    this.lastDropped = dropped;
  }

  // ---- models ----------------------------------------------------------------------

  model(id) { return this.meta.models.find((m) => m.id === id || m.name.toLowerCase() === String(id).toLowerCase()) || null; }
  modelSlot(id) { return this.models.get(id)?.slot ?? -1; }

  ensureModel(id) {
    const meta = this.model(id);
    if (!meta) return Promise.reject(new Error(`no imported model "${id}"`));
    let e = this.models.get(meta.id);
    if (e) return e.ready;
    if (!this.freeSlots.length) return Promise.reject(new Error('too many models loaded (256)'));
    e = { slot: this.freeSlots.pop(), info: null };
    e.ready = (async () => {
      const pkg = await decodePackage(await this.fileBytes(meta.file));
      e.pkg = pkg;
      e.info = uploadPackage(this.engine, e.slot, pkg, meta);
      return e.slot;
    })();
    e.ready.catch((err) => { console.error('model', meta.name, err); this.models.delete(meta.id); this.freeSlots.push(e.slot); });
    this.models.set(meta.id, e);
    return e.ready;
  }

  // Settings changed: build it again and replace what is placed in this area.
  async reloadModel(id) {
    const meta = this.model(id);
    const e = this.models.get(id);
    if (!meta || !e) return;
    try {
      await e.ready;
      if (e.pkgFile !== meta.file && e.pkgFile) e.pkg = null;
      const pkg = e.pkg || await decodePackage(await this.fileBytes(meta.file));
      e.pkg = pkg;
      e.pkgFile = meta.file;
      e.info = uploadPackage(this.engine, e.slot, pkg, meta);
      this.respawnModel(id);
      this.M._studio_assets_gc?.(); // the old buffers nothing draws any more are freed
    } catch (err) { console.error('reload model', err); }
  }

  respawnModel(id) {
    const recs = (this.getPatch()?.areas?.[this.key()]?.objects || []).filter((r) => r.asset?.model === id);
    for (const r of recs) { this.engine.deleteUid(r.uid); this.spawn(r); }
    if (recs.length) { this.rebuildCollision(); this.applyWater(this.key()); }
  }

  flagsOf(a) { return (a.collision !== false ? 1 : 0) | (a.mode === 'level' ? 2 : 0) | (a.invisible ? 4 : 0); }

  // Spawn a placed-model record (engine spawn filter). Returns the slot, or -1 while its model loads.
  spawn(rec) {
    const a = rec.asset;
    const e = this.models.get(a.model);
    if (!e || e.info === null) {
      if (!this.model(a.model)) return -1;
      this.pending.set(rec.uid, rec);
      this.ensureModel(a.model).then(() => this.spawnMissing()).catch(() => {});
      return -1;
    }
    this.pending.delete(rec.uid);
    return this.M._studio_model_spawn(e.slot, rec.x, rec.y, rec.z, rec.pitch | 0, rec.yaw | 0, rec.roll | 0, rec.scale || 1,
      this.flagsOf(a), ANIMS[a.anim] || 0, a.speed || 1, rec.uid);
  }

  // Placed models of this area that are not in the game yet (their model was still loading,
  // or the project's settings arrived after the area): load and spawn them.
  spawnMissing() {
    if (!this.engine.ready) return;
    const recs = (this.getPatch()?.areas?.[this.key()]?.objects || []).filter((r) => r.asset);
    this.pending.clear();
    if (!recs.length) return;
    const live = new Set(this.engine.objects().map((o) => o.uid).filter(Boolean));
    let any = false;
    for (const rec of recs) {
      if (live.has(rec.uid) || !this.model(rec.asset.model)) continue;
      const e = this.models.get(rec.asset.model);
      if (!e?.info) { this.ensureModel(rec.asset.model).then(() => this.spawnMissing()).catch(() => {}); continue; }
      if (this.spawn(rec) >= 0) any = true;
    }
    if (any) { this.rebuildCollision(); this.applyWater(this.key()); this.emit('spawned'); }
  }

  // Water boxes of the placed models (world space) into the area's water.
  applyWater(key) {
    const boxes = [];
    for (const r of this.getPatch()?.areas?.[key]?.objects || []) {
      const e = r.asset && this.models.get(r.asset.model);
      if (!e?.info?.water?.length) continue;
      const s = r.scale || 1, a = ((r.yaw | 0) / 65536) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      for (const b of e.info.water) {
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const x of [b[0], b[3]]) for (const z of [b[2], b[5]]) {
          const wx = r.x + (x * c + z * sn) * s, wz = r.z + (-x * sn + z * c) * s;
          x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); z0 = Math.min(z0, wz); z1 = Math.max(z1, wz);
        }
        boxes.push(Math.round(x0), Math.round(z0), Math.round(x1), Math.round(z1), Math.round(r.y + b[4] * s));
      }
    }
    const M = this.M;
    if (!M?._studio_assets_water) return;
    const n = Math.min(32, boxes.length / 5);
    const p = M._malloc(Math.max(2, boxes.length * 2));
    new Int16Array(M.HEAPU8.buffer, p, boxes.length).set(boxes);
    M._studio_assets_water(p, n);
    M._free(p);
  }

  // Store a new model: package bytes + its metadata. Returns the model meta.
  async addModel({ bytes, pkg, name, materials, lighting = 'baked', thumb, source }) {
    const file = await this.upload(new Blob([bytes]), 'model', name);
    const id = `m${Math.random().toString(36).slice(2, 9)}`;
    const meta = {
      id, name: plainName(name) || 'Model', file, tris: pkg.tris, bounds: pkg.bounds, materials, lighting, thumb,
      texFormat: pkg.texFormat, texMax: pkg.texMax, source, created: Date.now(),
      defaults: { mode: 'prop', collision: true, anim: 'none', speed: 1 },
    };
    await this.save('models', [...this.meta.models, meta]);
    return meta;
  }

  async updateModel(id, fields) {
    const list = this.meta.models.map((m) => (m.id === id ? { ...m, ...fields } : m));
    const before = this.model(id);
    await this.save('models', list);
    if (before && (fields.materials || fields.lighting || fields.file)) this.reloadModel(id);
  }

  async deleteModel(id) {
    const m = this.model(id);
    if (!m) return;
    // its placements go too, in every area
    for (const [key, a] of Object.entries(this.getPatch()?.areas || {})) {
      const uids = (a.objects || []).filter((r) => r.asset?.model === id).map((r) => r.uid);
      if (!uids.length) continue;
      if (key === this.key()) for (const u of uids) this.engine.deleteUid(u);
      this.commit({ type: 'remove', key, summary: `Removed ${uids.length} × ${m.name}`, uids, rules: [] });
    }
    await this.save('models', this.meta.models.filter((x) => x.id !== id));
    await this.deleteFile(m.file);
    this.rebuildCollision();
    this.freeModel(id);
  }

  // The engine's copy of a model goes (its slot is free again; buffers freed once nothing draws them).
  freeModel(id) {
    const e = this.models.get(id);
    if (!e) return;
    this.models.delete(id);
    e.ready.then((slot) => {
      if (this.M?._studio_model_free) this.M._studio_model_free(slot);
      this.freeSlots.push(slot);
    }).catch(() => {});
  }

  placementsOf(id) {
    let n = 0;
    for (const a of Object.values(this.getPatch()?.areas || {})) n += (a.objects || []).filter((r) => r.asset?.model === id).length;
    return n;
  }

  // A record for placing model `id` (prop or level geometry).
  makeRecord(id, pose, opts = {}) {
    const m = this.model(id);
    const d = { ...(m?.defaults || {}), ...opts };
    return {
      uid: 1 + Math.floor(Math.random() * 0x7efffffe),
      asset: { model: m.id, mode: d.mode || 'prop', collision: d.collision !== false, anim: d.anim || 'none', speed: d.speed || 1 },
      x: Math.round(pose.x), y: Math.round(pose.y), z: Math.round(pose.z), yaw: pose.yaw & 0xffff, pitch: pose.pitch | 0, roll: pose.roll | 0,
      scale: d.scale || 1, name: m.name,
    };
  }

  // ---- game textures --------------------------------------------------------------

  async catalog() {
    if (!this._catalog) {
      this._catalog = fetch('data/textures.json').then((r) => r.json()).then((j) => j.textures.map((t) => ({
        path: t[0], group: t[1], fmt: t[2], bits: t[3], w: t[4], h: t[5], len: t[6], probe: t[7], a: t[8] >>> 0, b: t[9] >>> 0, hash: t[10] >>> 0,
        mid: t[11] ?? 0, c: (t[12] ?? 0) >>> 0, d: (t[13] ?? 0) >>> 0,
        name: texName(t[0]),
      })));
    }
    return this._catalog;
  }

  // Find every catalogued texture in the game's memory by its fingerprint (about a second:
  // a bitmap filter on the first window, then a second window, then a hash of all bytes).
  async locate() {
    if (this.texAddr) return this.texAddr;
    if (this._locating) return this._locating;
    this._locating = (async () => {
      const list = await this.catalog();
      const M = this.M;
      const end = Math.min(M._studio_static_end(), M.HEAPU8.length) & ~3;
      const heap = M.HEAPU8;
      const u32 = new Uint32Array(heap.buffer, 0, end >> 2);
      const BITS = 1 << 22;
      const filter = new Uint8Array(BITS >> 3);
      const byA = new Map();
      for (const t of list) {
        const k = t.a & (BITS - 1);
        filter[k >> 3] |= 1 << (k & 7);
        if (!byA.has(t.a)) byA.set(t.a, []);
        byA.get(t.a).push(t);
      }
      const fnv = (start, len) => {
        let h = 0x811c9dc5;
        for (let i = start; i < start + len; i++) h = Math.imul(h ^ heap[i], 0x01000193) >>> 0;
        return h;
      };
      const found = new Map(); // hash -> [addresses]
      const n = u32.length - 1;
      for (let i = 0; i < n; i++) {
        const a = u32[i];
        const k = a & (BITS - 1);
        if (!(filter[k >> 3] & (1 << (k & 7)))) continue;
        const cands = byA.get(a);
        if (!cands) continue;
        for (const t of cands) {
          if (u32[i + 1] !== t.b) continue;
          const start = i * 4 - t.probe;
          if (start < 0 || start + t.len > heap.length || (start & 3)) continue;
          if (u32[(start + t.mid) >> 2] !== t.c || u32[((start + t.mid) >> 2) + 1] !== t.d) continue;
          if (fnv(start, t.len) !== t.hash) continue;
          if (!found.has(t.hash)) found.set(t.hash, []);
          if (!found.get(t.hash).includes(start)) found.get(t.hash).push(start);
        }
      }
      const addr = new Map();
      const used = new Map();
      for (const t of list) {
        const a = found.get(t.hash);
        if (!a?.length) continue;
        const k = used.get(t.hash) || 0;
        addr.set(t.path, a[Math.min(k, a.length - 1)]);
        used.set(t.hash, k + 1);
        t.addr = addr.get(t.path);
        t.dupes = a.length > 1 ? a.length : 0;
      }
      this.texAddr = addr;
      return addr;
    })();
    return this._locating;
  }

  // The texture's current pixels: its replacement, or the game's own.
  async texturePixels(t) {
    const r = this.meta.textures[t.path];
    if (r?.file) { try { return await this.fileRGBA(r.file); } catch { /* fall back */ } }
    return this.originalPixels(t);
  }

  originalPixels(t) {
    if (t.addr === undefined) return null;
    const bytes = this.M.HEAPU8.subarray(t.addr, t.addr + t.len);
    return { rgba: decodeN64(bytes, t.fmt, t.bits, t.w, t.h), w: t.w, h: t.h };
  }

  // Textures drawn in this area so far.
  seenPaths() {
    const M = this.M;
    const n = M._studio_tex_seen_count();
    const p = M._studio_tex_seen_list();
    const view = new Uint32Array(M.HEAPU8.buffer, p, n);
    const set = new Set(view);
    const out = new Set();
    if (!this.texAddr) return out;
    for (const [path, a] of this.texAddr) if (set.has(a)) out.add(path);
    return out;
  }

  async applyTextures() {
    const want = this.meta.textures || {};
    const paths = Object.keys(want);
    if (!paths.length && !this.appliedTex.size) return;
    await this.locate();
    const M = this.M;
    let changed = false;
    for (const [path, file] of this.appliedTex) {
      if (want[path]?.file === file) continue;
      const a = this.texAddr.get(path);
      if (a !== undefined) M._studio_tex_unset(a, 0);
      this.appliedTex.delete(path);
      changed = true;
    }
    for (const path of paths) {
      const r = want[path];
      if (!r?.file || this.appliedTex.get(path) === r.file) continue;
      const a = this.texAddr.get(path);
      if (a === undefined) continue;
      try {
        const img = await this.fileRGBA(r.file);
        this.setOverride(a, img.rgba, img.w, img.h, false);
        this.appliedTex.set(path, r.file);
        changed = true;
      } catch (err) { console.warn('texture', path, err); }
    }
    if (changed) M._studio_tex_flush();
  }

  setOverride(addr, rgba, w, h, flush = true) {
    const M = this.M;
    const p = M._malloc(rgba.length);
    M.HEAPU8.set(rgba, p);
    M._studio_tex_set(addr, p, w, h, flush ? 1 : 0);
    M._free(p);
  }

  // Replace a game texture (saved in the project). rgba is w*h RGBA8.
  replaceTexture(t, rgba, w, h, note = '') { return this.replaceTextures([{ t, rgba, w, h, note }]); }

  // Several at once: one save, one refresh. items: [{ t, rgba, w, h, note }]
  async replaceTextures(items) {
    const textures = { ...this.meta.textures };
    const old = [];
    await Promise.all(items.map(async ({ t, rgba, w, h, note = '' }) => {
      const png = await toPNGBlob(rgba, w, h);
      const file = await this.upload(png, 'png', t.path);
      if (textures[t.path]?.file) old.push(textures[t.path].file);
      textures[t.path] = { file, w, h, note: String(note).slice(0, 120), at: Date.now() };
      this.files.set(file, png.arrayBuffer().then((b) => new Uint8Array(b))); // no need to load it back
    }));
    await this.save('textures', textures);
    for (const f of old) this.deleteFile(f);
    await this.applyTextures();
  }

  async resetTexture(t) {
    const old = this.meta.textures[t.path];
    if (!old) return;
    const textures = { ...this.meta.textures };
    delete textures[t.path];
    await this.save('textures', textures);
    if (old.file) this.deleteFile(old.file);
    await this.applyTextures();
  }

  async findTextures({ query = '', group = '', here = false, limit = 60 } = {}) {
    const list = await this.catalog();
    await this.locate();
    const seen = here ? this.seenPaths() : null;
    const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    return list.filter((t) => t.addr !== undefined
      && (!group || t.group.toLowerCase().includes(group.toLowerCase()))
      && (!seen || seen.has(t.path))
      && words.every((w) => `${t.path} ${t.group}`.toLowerCase().includes(w))).slice(0, limit);
  }

  // ---- custom materials (blocks and terrain) ---------------------------------------------

  applyMaterials() {
    const M = this.M;
    if (!M?._studio_material_custom) return;
    const want = new Map((this.meta.materials || []).map((m) => [m.slot, m]));
    this.appliedMats ||= new Map();
    for (let slot = 0; slot < 16; slot++) {
      const m = want.get(slot);
      const applied = this.appliedMats.get(slot);
      if (!m) {
        delete MATERIALS[48 + slot];
        if (applied) { M._studio_material_custom(slot, 0); this.appliedMats.delete(slot); this.emit('materials'); }
        continue;
      }
      // a rename needs no new pixels
      if (applied && MATERIALS[48 + slot] !== m.name) { MATERIALS[48 + slot] = m.name; this.emit('materials'); }
      if (applied === `${m.file}:${m.sharp}`) continue;
      this.appliedMats.set(slot, `${m.file}:${m.sharp}`);
      this.fileRGBA(m.file).then((img) => {
        const small = img.w === 32 && img.h === 32 ? img.rgba : rasterize(toCanvas(img.rgba, img.w, img.h), 32, 32);
        const p = M._malloc(2048);
        M.HEAPU8.set(encodeRGBA16(small, 32, 32), p);
        const tex = M._studio_material_custom(slot, p);
        M._free(p);
        if (m.sharp && (img.w > 32 || img.h > 32)) this.setOverride(tex, img.rgba, img.w, img.h, true);
        else M._studio_tex_unset(tex, 1);
        // listed only once the engine has its pixels (the lists draw a swatch from them)
        MATERIALS[48 + slot] = m.name;
        this.emit('materials');
      }).catch((err) => console.warn('material', m.name, err));
    }
  }

  // Add (or replace) a custom material from w*h RGBA8 pixels. Returns its material index (48..63).
  async saveMaterial({ slot, name, rgba, w, h, sharp = false }) {
    const list = [...(this.meta.materials || [])];
    if (slot === undefined) {
      const used = new Set(list.map((m) => m.slot));
      slot = [...Array(16).keys()].find((s) => !used.has(s));
      if (slot === undefined) throw new Error('all 16 custom material slots are used');
    }
    const file = await this.upload(await toPNGBlob(rgba, w, h), 'png', name);
    const old = list.find((m) => m.slot === slot);
    const entry = { slot, name: plainName(name) || `material ${slot + 1}`, file, w, h, sharp: !!sharp && (w > 32 || h > 32) };
    const next = list.filter((m) => m.slot !== slot).concat(entry).sort((a, b) => a.slot - b.slot);
    // two materials with one name would be ambiguous in the editor and for Claude
    if (next.filter((m) => m.name === entry.name).length > 1) entry.name = `${entry.name} ${slot + 1}`;
    await this.save('materials', next);
    if (old?.file && old.file !== file) this.deleteFile(old.file);
    this.applyMaterials();
    return 48 + slot;
  }

  async deleteMaterial(slot) {
    const old = (this.meta.materials || []).find((m) => m.slot === slot);
    await this.save('materials', (this.meta.materials || []).filter((m) => m.slot !== slot));
    if (old?.file) this.deleteFile(old.file);
    this.applyMaterials();
  }

  // ---- skies --------------------------------------------------------------------------

  skyFor(key) { return this.meta.skies?.[key] || this.meta.skies?.['*'] || null; }

  async applySky(key) {
    const M = this.M;
    if (!M?._studio_sky_apply) return;
    const s = this.skyFor(key);
    const want = s ? `${s.file}:${s.quality || 'n64'}` : null;
    if (want === this.skyState) {
      if (want && !M._studio_sky_active()) M._studio_sky_apply(1);
      return;
    }
    this.skyState = want;
    if (!s) { this.clearHdSky(); M._studio_sky_apply(0); return; }
    const img = await this.fileRGBA(s.file);
    if (this.skyState !== want) return; // changed meanwhile
    this.loadSkyImage(img, s.quality || 'n64');
    M._studio_sky_apply(1);
  }

  clearHdSky() {
    const M = this.M;
    if (!this.skyHd) return;
    const buf = M._studio_sky_buffer();
    for (let i = 0; i < 64; i++) M._studio_tex_unset(buf + i * 2048, 0);
    this.skyHd = false;
  }

  // img: the sky in the game's layout (8 x 31 tiles each way, k = 1 or 2 texels per pixel).
  loadSkyImage(img, quality) {
    const M = this.M;
    const k = Math.round(img.w / 248) || 1;
    const buf = M._studio_sky_buffer();
    const ts = 32 * k;
    const tile = new Uint8ClampedArray(ts * ts * 4);
    this.clearHdSky();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        for (let y = 0; y < ts; y++) {
          const sy = Math.min(img.h - 1, r * 31 * k + y);
          for (let x = 0; x < ts; x++) {
            const sx = (c * 31 * k + x) % img.w;
            const si = (sy * img.w + sx) * 4, di = (y * ts + x) * 4;
            tile[di] = img.rgba[si]; tile[di + 1] = img.rgba[si + 1]; tile[di + 2] = img.rgba[si + 2]; tile[di + 3] = 255;
          }
        }
        const small = k === 1 ? tile : rasterize(toCanvas(tile, ts, ts), 32, 32);
        const addr = buf + (r * 8 + c) * 2048;
        M.HEAPU8.set(encodeRGBA16(small, 32, 32), addr);
        if (k > 1 && quality === 'hd') { this.setOverride(addr, tile, ts, ts, false); this.skyHd = true; }
      }
    }
  }

  // Make the game-layout sky image from any picture.
  //   mode 'panorama': a 360° equirectangular image; 'picture': any picture, mirrored around
  //   horizon: where the horizon sits (-0.3..0.3 shifts it)
  static skyLayout(src, { mode = 'panorama', quality = 'n64', horizon = 0 } = {}) {
    const k = SKY_K[quality] || 1;
    const W = 248 * k, H = 248 * k;
    const sw = Math.min(src.width, 4096), sh = Math.min(src.height, 2048);
    const s = rasterize(src, sw, sh);
    const out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      // the game shows about 240 degrees of pitch over the image, the horizon in the middle
      let v;
      if (mode === 'panorama') {
        const lat = Math.max(-90, Math.min(90, 120 - 240 * (y / H) + horizon * 180));
        v = (90 - lat) / 180;
      } else {
        v = Math.max(0, Math.min(1, (y / H - 0.5) * 1.15 + 0.5 - horizon));
      }
      const syy = Math.min(sh - 1, Math.floor(v * sh));
      for (let x = 0; x < W; x++) {
        let u = x / W;
        if (mode !== 'panorama') u = u < 0.5 ? u * 2 : (1 - u) * 2; // mirrored: no seam
        const sxx = Math.min(sw - 1, Math.floor(u * sw));
        const si = (syy * sw + sxx) * 4, di = (y * W + x) * 4;
        out[di] = s[si]; out[di + 1] = s[si + 1]; out[di + 2] = s[si + 2]; out[di + 3] = 255;
      }
    }
    if (quality === 'n64') quantize(out, 'rgba16');
    return { rgba: out, w: W, h: H };
  }

  // A generated sky: gradient, sun, clouds, stars and mountains (for Claude and quick starts).
  static generateSky({ top = '#2a6fd6', horizon = '#bfe3ff', bottom = '#7aa0c0', clouds = 0.5, cloud_color = '#ffffff', sun = true, sun_color = '#fff6c8', stars = 0, mountains = 0, mountain_color = '#4a6a8a', seed = 1 } = {}) {
    const W = 1024, H = 512;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, top); grad.addColorStop(0.5, horizon); grad.addColorStop(1, bottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    let rnd = seed * 9301 + 49297;
    const rand = () => { rnd = (rnd * 9301 + 49297) % 233280; return rnd / 233280; };
    if (stars > 0) {
      for (let i = 0; i < 900 * stars; i++) {
        const x = rand() * W, y = rand() * H * 0.48;
        g.fillStyle = `rgba(255,255,255,${0.4 + rand() * 0.6})`;
        g.fillRect(x, y, rand() < 0.1 ? 2 : 1, rand() < 0.1 ? 2 : 1);
      }
    }
    if (sun) {
      const sx = W * 0.3, sy = H * 0.3;
      const sg = g.createRadialGradient(sx, sy, 2, sx, sy, 90);
      sg.addColorStop(0, sun_color); sg.addColorStop(0.18, sun_color); sg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sg;
      g.fillRect(sx - 90, sy - 90, 180, 180);
    }
    if (clouds > 0) {
      const cc = parseColor(cloud_color);
      for (let i = 0; i < 60 * clouds; i++) {
        const x = rand() * W, y = H * (0.18 + rand() * 0.3), r = 18 + rand() * 46;
        for (let k = 0; k < 6; k++) {
          const px = x + (rand() - 0.5) * r * 2.6, py = y + (rand() - 0.5) * r * 0.5;
          for (const dx of [0, -W, W]) {
            const cg = g.createRadialGradient(px + dx, py, 1, px + dx, py, r);
            cg.addColorStop(0, `rgba(${cc[0]},${cc[1]},${cc[2]},0.55)`); cg.addColorStop(1, `rgba(${cc[0]},${cc[1]},${cc[2]},0)`);
            g.fillStyle = cg;
            g.fillRect(px + dx - r, py - r, r * 2, r * 2);
          }
        }
      }
    }
    if (mountains > 0) {
      const mc = parseColor(mountain_color);
      for (let layer = 0; layer < 2; layer++) {
        const base = H * 0.5 + layer * 10, amp = H * 0.12 * mountains * (layer ? 0.6 : 1);
        const f = layer ? 1.2 : 1;
        g.fillStyle = hex(mc.map((v) => v * (layer ? 1.15 : 0.9)));
        g.beginPath();
        g.moveTo(0, H);
        for (let x = 0; x <= W; x += 4) {
          const t = (x / W) * Math.PI * 2;
          const y = base - amp * (0.55 + 0.25 * Math.sin(t * 3 * f + seed) + 0.15 * Math.sin(t * 7 * f + seed * 2) + 0.05 * Math.sin(t * 17 + seed));
          g.lineTo(x, y);
        }
        g.lineTo(W, H);
        g.fill();
      }
    }
    return c;
  }

  // Set the sky of area `key` ('*' = every level without one of its own) from a panorama canvas/bitmap.
  async setSky(key, src, { mode = 'panorama', quality = 'n64', horizon = 0, name = 'Sky' } = {}) {
    const lay = Assets.skyLayout(src, { mode, quality, horizon });
    const png = await toPNGBlob(lay.rgba, lay.w, lay.h);
    const file = await this.upload(png, 'png', name);
    this.files.set(file, png.arrayBuffer().then((b) => new Uint8Array(b)));
    const old = this.meta.skies?.[key];
    await this.save('skies', { ...(this.meta.skies || {}), [key]: { file, quality, name: plainName(name), at: Date.now() } });
    if (old?.file && !Object.values(this.meta.skies).some((s) => s.file === old.file)) this.deleteFile(old.file);
    if (this.skyFor(this.key())?.file === file) {
      // show it right away from the pixels we have
      this.skyState = `${file}:${quality}`;
      this.loadSkyImage(lay, quality);
      this.M._studio_sky_apply(1);
    } else await this.applySky(this.key());
  }

  async clearSky(key) {
    const old = this.meta.skies?.[key];
    const skies = { ...(this.meta.skies || {}) };
    delete skies[key];
    await this.save('skies', skies);
    if (old?.file) this.deleteFile(old.file);
    await this.applySky(this.key());
  }

  // ---- Mario -------------------------------------------------------------------------

  marioDefaults() {
    const M = this.M;
    return Object.fromEntries(MARIO_PARTS.map(([k], i) => [k, hex(((v) => [(v >> 16) & 255, (v >> 8) & 255, v & 255])(M._studio_mario_default_color(i)))]));
  }

  applyMario(colors = this.meta.mario?.colors || {}) {
    const M = this.M;
    if (!M?._studio_mario_color) return;
    MARIO_PARTS.forEach(([k], i) => {
      const c = colors[k];
      M._studio_mario_color(i, c ? parseInt(String(c).replace('#', ''), 16) : -1, 128);
    });
  }

  async setMario(colors, preset = null) {
    const clean = {};
    for (const [k] of MARIO_PARTS) if (colors[k]) clean[k] = hex(parseColor(colors[k]));
    this.applyMario(clean);
    await this.save('mario', { colors: clean, preset });
  }
}

// ---------------------------------------------------------------------------
// Claude's side (server/tools/assets.js calls these over rpc)

function registerAssetRpcs(A) {
  registerRpc('asset_list', function () {
    const key = A.key();
    return {
      models: A.meta.models.map((m) => ({ id: m.id, name: m.name, triangles: m.tris, size: m.bounds ? m.bounds.max.map((v, i) => Math.round(v - m.bounds.min[i])) : null, placed: A.placementsOf(m.id), materials: (m.materials || []).map((x) => `${x.name}: ${x.surface}`) })),
      custom_materials: (A.meta.materials || []).map((m) => ({ index: 48 + m.slot, name: m.name })),
      sky_here: A.skyFor(key)?.name || null,
      skies: Object.entries(A.meta.skies || {}).map(([k, s]) => ({ area: k === '*' ? 'all levels' : k, name: s.name })),
      replaced_textures: Object.keys(A.meta.textures || {}).length,
      mario: A.meta.mario || {},
    };
  });

  registerRpc('asset_place', async function ({ model, count = 1, where = {}, face, scale, mode, collision, animation, speed, yaw_deg } = {}) {
    const m = A.model(model);
    if (!m) throw new Error(`no imported model "${model}" (use list_assets)`);
    await A.ensureModel(m.id);
    const s = this.mario();
    const pts = this.points(where, Math.max(1, Math.min(count, 40)));
    const records = [];
    for (const p of pts) {
      const yaw = yaw_deg !== undefined ? Math.round((yaw_deg / 360) * 65536) & 0xffff : this.faceYaw(face, p, s.mario);
      const rec = A.makeRecord(m.id, { x: p.x, y: p.y, z: p.z, yaw }, { scale, mode, collision, anim: animation, speed });
      const slot = this.engine.spawn(rec);
      if (slot < 0) throw new Error('could not place it (object pool full?)');
      records.push(rec);
    }
    A.rebuildCollision();
    A.applyWater(A.key());
    return { level: s.level, area: s.area, key: this.engine.areaKey(), records };
  });

  // The matches, plus a numbered picture of them (the game's own pixels) so Claude can see
  // which one is the grass: texture names are mostly numbers.
  registerRpc('texture_search', async function ({ query = '', group = '', here = false, limit = 30, picture = true } = {}) {
    const list = await A.findTextures({ query, group, here, limit: Math.min(limit, 64) });
    const out = list.map((t, i) => ({ n: i + 1, path: t.path, group: t.group, size: `${t.w}x${t.h}`, format: `${t.fmt}${t.bits}`, replaced: !!A.meta.textures[t.path] }));
    if (!picture || !list.length) return { textures: out };
    const cols = 8, cell = 72, rows = Math.ceil(list.length / cols);
    const c = document.createElement('canvas');
    c.width = cols * cell; c.height = rows * cell;
    const g = c.getContext('2d');
    g.fillStyle = '#222'; g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = false;
    list.forEach((t, i) => {
      const img = A.originalPixels(t);
      const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
      if (img) g.drawImage(toCanvas(img.rgba, img.w, img.h), x + 4, y + 4, cell - 8, cell - 8);
      g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(x + 2, y + 2, 22, 15);
      g.fillStyle = '#fff'; g.font = 'bold 12px sans-serif'; g.fillText(String(i + 1), x + 5, y + 14);
    });
    return { textures: out, sheet: c.toDataURL('image/jpeg', 0.85) };
  });

  registerRpc('texture_edit', async function ({ paths = [], query, here = false, recolor: rc, pattern: pt, reset = false, limit = 24 } = {}) {
    const list = await A.catalog();
    await A.locate();
    let targets = paths.map((p) => list.find((t) => t.path === p || t.path.endsWith(p))).filter(Boolean);
    if (!targets.length && (query || here)) targets = await A.findTextures({ query: query || '', here, limit: Math.min(limit, 64) });
    if (!targets.length) throw new Error('no matching textures (use search_textures)');
    const done = [], batch = [];
    for (const t of targets) {
      if (reset) { await A.resetTexture(t); done.push(t.path); continue; }
      let img;
      if (pt) {
        img = { rgba: pattern(pt.kind || 'noise', t.w, t.h, pt), w: t.w, h: t.h };
        // keep the original's transparency (leaves, fences)
        const orig = A.originalPixels(t);
        if (orig) for (let i = 3; i < img.rgba.length; i += 4) img.rgba[i] = orig.rgba[i];
      } else {
        // recolour starts from the game's own pixels
        img = A.originalPixels(t);
        if (!img) continue;
      }
      if (rc) img = { ...img, rgba: recolor(img.rgba, rc) };
      batch.push({ t, rgba: img.rgba, w: img.w, h: img.h, note: rc ? 'recoloured by Claude' : 'pattern by Claude' });
      done.push(t.path);
    }
    if (batch.length) await A.replaceTextures(batch);
    return { changed: done };
  });

  registerRpc('sky_generate', async function ({ area = 'here', ...opts } = {}) {
    const key = area === 'all' ? '*' : A.key();
    const canvas = Assets.generateSky(opts);
    await A.setSky(key, canvas, { mode: 'panorama', quality: opts.hd ? 'hd' : 'n64', name: opts.name || 'Generated sky' });
    return { ok: true, area: key === '*' ? 'every level' : key };
  });

  registerRpc('sky_clear', async function ({ area = 'here' } = {}) {
    await A.clearSky(area === 'all' ? '*' : A.key());
    return { ok: true };
  });

  registerRpc('mario_colors', async function ({ preset, colors = {} } = {}) {
    const base = preset && MARIO_PRESETS[preset] ? MARIO_PRESETS[preset].colors : (preset ? null : A.meta.mario?.colors || {});
    if (preset && !base) throw new Error(`unknown preset "${preset}" (${Object.keys(MARIO_PRESETS).join(', ')})`);
    const next = { ...base, ...colors };
    await A.setMario(next, preset || null);
    return { colors: next };
  });
}
