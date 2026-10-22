// The level's own shape and settings: custom-level terrain, sculpted original
// geometry, sky/music/water/spawn, and custom star progress.
import { Terrain } from './terrain.js';
import { makeTemplate } from './templates.js';
import { encodeSong } from './music.js';
import { material } from './generators.js';
import { songBytes } from './tokyo_template.js';

const TERRAIN_ID = 1;
const WATER_UID = 0x7e100000; // translucent water planes (not saved objects)
const SCULPT_MODES = { raise: 0, lower: 1, smooth: 2, flatten: 3 };

export class World {
  constructor({ engine, patch, commit, projectId, toast }) {
    this.engine = engine;
    this.patch = patch;       // () => current patch
    this.commit = commit;     // (op) => send an edit to the server
    this.projectId = projectId;
    this.toast = toast;
    this.terrain = null;
    this.sculpted = new Set(); // areas whose original geometry was ever changed this session
    this.listeners = [];
    engine.levelHooks.push((level, area, key) => this.onAreaLoad(level, area, key));
  }

  on(fn) { this.listeners.push(fn); }
  emit() { for (const fn of this.listeners) fn(); }

  key() { return this.engine.areaKey(); }
  isCustom() { return this.engine.level === this.engine.studioLevel; }
  area(key = this.key()) { return this.patch().areas?.[key] || {}; }
  settings(key = this.key()) { return this.area(key).settings || {}; }

  // ---- applying a level ---------------------------------------------------------

  onAreaLoad(level, area, key) {
    const a = this.area(key);
    this.applySettings(a.settings || {}, level === this.engine.studioLevel);
    this.loadTerrain(a.terrain);
    this.replaySculpt(key, a.sculpt || [], false);
    if (this.terrain || this.sculpted.has(key)) this.engine.rebuildCollision();
    setTimeout(() => this.emit(), 0);
    // raised ground can cover the level's start: Mario would spawn inside it and fall out of the world
    if (this.sculpted.has(key) || this.terrain) {
      let tries = 0;
      const lift = () => { if ((this.engine.inIntro || !this.liftMario()) && ++tries < 120) setTimeout(lift, 250); };
      setTimeout(lift, 500); // Mario is placed after the area finished loading
    }
  }

  // Mario inside the ground (no floor under him, ground above): put him on top. Returns true once
  // Mario exists (whether he needed it or not).
  liftMario() {
    let m;
    try { m = this.engine.state().mario; } catch { return false; }
    if (!m) return false;
    const e = this.engine;
    // custom terrain is a height field: below its surface is always inside the hill (a level
    // below it, like the flat template's floor far down, would let him fall out of the world)
    const T = this.terrain;
    if (T?.contains(m.x, m.z) && T.heightAt(m.x, m.z) > m.y + 20) {
      const top = e.floor(m.x, T.heightAt(m.x, m.z) + 300, m.z);
      if (top > m.y && top > -10000) { e.teleport(m.x, top + 10, m.z, m.yaw); return true; }
    }
    if (e.floor(m.x, m.y + 78, m.z) < -10000) {
      const top = e.floor(m.x, m.y + 2500, m.z);
      if (top > m.y && top > -10000) e.teleport(m.x, top + 10, m.z, m.yaw);
    }
    return true;
  }

  // Re-apply after an undo or someone else's edit.
  reapply() {
    const a = this.area();
    this.applySettings(a.settings || {}, this.isCustom(), true);
    this.loadTerrain(a.terrain);
    this.replaySculpt(this.key(), a.sculpt || [], true);
    this.engine.rebuildCollision();
    this.emit();
  }

  applySettings(s, custom, live = false) {
    const e = this.engine;
    if (custom) {
      e.setSky(s.sky ?? 0);
      e.setWater(!!s.water?.on, s.water?.height ?? 0);
      this.placeWater(s.water);
      const sp = s.spawn || this.defaultSpawn();
      if (!live) e.setSpawn(sp.x, sp.y, sp.z, sp.yaw || 0);
    }
    // a song from the sound studio, or one of the game's
    const song = s.song && this.getSongs?.().find((x) => x.id === s.song);
    if (song) e.setLevelSong(encodeSong(song), song.bank);
    else if (s.m64Song?.data && e.hasSoundBank?.(s.m64Song.bank)) e.setLevelSong(songBytes(s.m64Song), s.m64Song.bank); // a game sequence (the Tokyo template's)
    else if (s.music != null && (custom || s.musicOverride)) e.setMusic(s.music);
    else if (live) e.originalMusic();
    if (!custom && s.spawn && !live) e.setSpawn(s.spawn.x, s.spawn.y, s.spawn.z, s.spawn.yaw || 0);
  }

  // The level's song was edited: play the new version.
  applyLevelSong() {
    const s = this.settings();
    const song = s.song && this.getSongs?.().find((x) => x.id === s.song);
    if (song) this.engine.setLevelSong(encodeSong(song), song.bank);
  }

  defaultSpawn() {
    const y = this.terrain ? this.terrain.heightAt(0, 0) : 0;
    return { x: 0, y: Math.round(y + 400), z: 0, yaw: 0 };
  }

  // Water you can see: translucent planes on top of the swimmable water box.
  placeWater(water) {
    for (let i = 0; i < 4; i++) this.engine.deleteUid(WATER_UID + i);
    if (!water?.on) return;
    // a sea reaches past the terrain; ponds and rivers stay inside it (extent 4096)
    const half = (water.extent || 8000) / 2;
    let i = 0;
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
      this.engine.spawn({ uid: WATER_UID + i++, block: { shape: 0, sx: half * 2, sy: 4, sz: half * 2, top: material('water'), side: material('water'), surface: 0, flags: 2 | 4, color: 0x9fd0ff, steps: 0 },
        x: dx * half, y: (water.height ?? 0) - 4, z: dz * half, yaw: 0, pitch: 0, roll: 0 });
    }
  }

  loadTerrain(t) {
    this.engine.terrainDestroy(TERRAIN_ID);
    this.terrain = t ? Terrain.decode(t) : null;
    if (!this.terrain) return;
    const T = this.terrain;
    const v = this.engine.terrainCreate(TERRAIN_ID, T.nx, T.nz, T.cell, T.x0, T.z0);
    v.heights.set(T.h);
    v.mats.set(T.m);
    this.engine.terrainBuild(TERRAIN_ID, 0, 0, -1, -1, false);
  }

  // Push a region of the JS heightmap into the engine and redraw it.
  syncTerrain(rect, collision = true) {
    const T = this.terrain;
    const v = this.engine.terrainViews(TERRAIN_ID);
    if (!T || !v) return;
    v.heights.set(T.h);
    v.mats.set(T.m);
    this.engine.terrainBuild(TERRAIN_ID, rect.i0, rect.j0, rect.i1, rect.j1, collision);
  }

  replaySculpt(key, strokes, force) {
    if (!strokes.length && !this.sculpted.has(key) && !force) return;
    if (this.isCustom()) return; // custom levels use the heightmap
    this.engine.sculptPrepare();
    this.engine.sculptRestore();
    for (const st of strokes) for (const d of st.dabs) this.engine.sculptDab(d[0], d[1], d[2], d[3], d[4], d[5] || 0);
    if (strokes.length) this.sculpted.add(key);
  }

  // ---- brushes (called by the editor while a stroke is held) ----------------------

  // What a brush at (x,z) edits: the custom terrain, or the original level's own mesh.
  brushTarget(x, z) {
    if (this.terrain && this.terrain.contains(x, z)) return 'terrain';
    if (!this.isCustom()) return 'level';
    return null;
  }

  beginStroke(mode, hit, brush) {
    const target = this.brushTarget(hit.x, hit.z);
    if (!target) return null;
    if (target === 'level' && mode === 'paint') { this.toast('Paint works on custom terrain; the original levels keep their textures', 'x'); return null; }
    if (target === 'level') this.engine.sculptPrepare();
    const flatY = target === 'terrain' ? this.terrain.heightAt(hit.x, hit.z) : hit.y;
    return { target, mode, brush, flatY, dabs: [], before: target === 'terrain' ? this.terrain.encode() : null };
  }

  dab(stroke, x, z) {
    const b = stroke.brush;
    const strength = stroke.mode === 'raise' || stroke.mode === 'lower' ? b.strength * 0.9 : b.strength;
    if (stroke.target === 'terrain') {
      const rect = stroke.mode === 'paint'
        ? this.terrain.paint(b.material, x, z, b.radius)
        : this.terrain.brush(stroke.mode, x, z, b.radius, strength, stroke.flatY);
      this.syncTerrain(rect);
    } else {
      const d = [SCULPT_MODES[stroke.mode], Math.round(x), Math.round(z), Math.round(b.radius), Math.round(strength * 10) / 10, Math.round(stroke.flatY)];
      this.engine.sculptDab(...d);
      stroke.dabs.push(d);
      this.engine.rebuildCollision();
    }
  }

  endStroke(stroke) {
    const names = { raise: 'Raised', lower: 'Lowered', smooth: 'Smoothed', flatten: 'Flattened', paint: 'Painted' };
    const what = stroke.target === 'terrain' ? 'the terrain' : 'the level';
    const summary = `${names[stroke.mode]} ${stroke.mode === 'paint' ? `${stroke.brush.materialName || 'terrain'}` : what}`;
    if (stroke.target === 'terrain') {
      this.commitArea('terrain', this.terrain.encode(), summary);
    } else if (stroke.dabs.length) {
      const st = { id: Math.random().toString(36).slice(2, 10), dabs: stroke.dabs };
      const a = this.patch().areas[this.key()] ||= { objects: [], removals: [], warps: [] };
      (a.sculpt ||= []).push(st);
      this.sculpted.add(this.key());
      this.commit({ type: 'sculpt', key: this.key(), stroke: st, summary });
    }
  }

  // Save one part of the current area (terrain or settings) and keep the local copy in step.
  commitArea(field, value, summary) {
    const key = this.key();
    const a = this.patch().areas[key] ||= { objects: [], removals: [], warps: [] };
    a[field] = value;
    this.commit({ type: 'area', key, field, value, summary });
  }

  // ---- terrain operations (Claude, templates, buttons) ---------------------------

  ensureTerrain() {
    if (!this.terrain) {
      this.terrain = new Terrain({ nx: 128, nz: 128, cell: 64 });
      this.terrain.autoPaint();
      const T = this.terrain;
      const v = this.engine.terrainCreate(TERRAIN_ID, T.nx, T.nz, T.cell, T.x0, T.z0);
      v.heights.set(T.h);
      v.mats.set(T.m);
    }
    return this.terrain;
  }

  runOps(ops, summary = 'Shaped the terrain') {
    if (!this.isCustom()) {
      // original levels: shapes become sculpt strokes on the real geometry
      this.engine.sculptPrepare();
      const dabs = [];
      for (const o of ops) {
        const r = o.radius ?? 1200;
        const mode = { hill: 0, mountain: 0, raise: 0, plateau: 3, flatten: 3, valley: 1, crater: 1, lower: 1, smooth: 2 }[o.op];
        if (mode === undefined) throw new Error(`"${o.op}" only works in custom levels here; use hill, raise, lower, valley, flatten, plateau or smooth`);
        const total = Math.abs(o.height ?? o.amount ?? o.depth ?? 500);
        const n = mode >= 2 ? 6 : Math.max(1, Math.ceil(total / 60));
        for (let k = 0; k < n; k++) {
          const d = [mode, Math.round(o.x ?? 0), Math.round(o.z ?? 0), Math.round(r), mode >= 2 ? 60 : total / n, Math.round(o.height ?? 0)];
          this.engine.sculptDab(...d);
          dabs.push(d);
        }
      }
      this.engine.rebuildCollision();
      const st = { id: Math.random().toString(36).slice(2, 10), dabs };
      const a = this.patch().areas[this.key()] ||= { objects: [], removals: [], warps: [] };
      (a.sculpt ||= []).push(st);
      this.sculpted.add(this.key());
      this.commit({ type: 'sculpt', key: this.key(), stroke: st, summary });
      return { sculpted: dabs.length };
    }
    const T = this.ensureTerrain();
    for (const o of ops) T.op(o);
    this.syncTerrain({ i0: 0, j0: 0, i1: T.nx, j1: T.nz });
    this.commitArea('terrain', T.encode(), summary);
    return { ok: true, heights: this.terrainSummary() };
  }

  terrainSummary() {
    const T = this.terrain;
    if (!T) return null;
    let lo = Infinity, hi = -Infinity, hiAt = null;
    for (let j = 0; j <= T.nz; j++) for (let i = 0; i <= T.nx; i++) {
      const v = T.h[T.idx(i, j)];
      if (v < lo) lo = v;
      if (v > hi) { hi = v; hiAt = [Math.round(T.wx(i)), Math.round(T.wz(j))]; }
    }
    return { size: T.nx * T.cell, ...T.bounds(), lowest: lo, highest: hi, highest_at: hiAt };
  }

  // ---- settings -------------------------------------------------------------------

  setSettings(patchFields, summary = 'Changed level settings') {
    const s = { ...this.settings(), ...patchFields };
    this.commitArea('settings', s, summary);
    this.applySettings(s, this.isCustom(), true);
    if (patchFields.spawn) this.engine.setSpawn(s.spawn.x, s.spawn.y, s.spawn.z, s.spawn.yaw || 0);
    this.emit();
  }

  // ---- stars ------------------------------------------------------------------------

  progressKey() { return `studio64.stars.${this.projectId()}`; }
  progress() {
    try { return JSON.parse(localStorage.getItem(this.progressKey()) || '{}'); } catch { return {}; }
  }
  markStar(id) {
    const p = this.progress();
    p[id] = Date.now();
    try { localStorage.setItem(this.progressKey(), JSON.stringify(p)); } catch { /* private mode */ }
  }
  // (an empty progress, not none: savegame.js tells a reset from cleared browser storage)
  resetProgress() { try { localStorage.setItem(this.progressKey(), '{}'); } catch { /* ignore */ } }

  // Stars of an area: every saved star record (the editor and Claude name them).
  // Custom levels also have the courses' 100 coin star (star index 6).
  stars(key = this.key()) {
    const a = this.area(key);
    const p = this.progress();
    const list = (a.objects || []).filter((r) => r.star || r.entry === 'star' || r.entry === 'hidden_red_coin_star')
      .map((r) => ({ uid: r.uid, name: r.star?.name || (r.entry === 'hidden_red_coin_star' ? 'Red coin star' : 'Star'),
        kind: r.entry === 'hidden_red_coin_star' ? 'red_coins' : 'star', index: (r.bparams >>> 24) & 0x1f,
        x: r.x, y: r.y, z: r.z, done: !!p[`${key}|${r.uid}`] }));
    if (/^c:[^:]+$/.test(key)) list.push({ uid: 'coins100', name: '100 coins', kind: 'coins100', index: 6, done: !!p[`${key}|coins100`] });
    return list;
  }

  // A custom level's stars: its main area's and its sub-areas' (keys c:<id>:<n>, worldflow.js).
  // (an original level's key "9:1" stands for all its areas "9:<n>")
  levelStars(key) {
    if (!key.startsWith('c:')) {
      const num = key.split(':')[0];
      const all = Object.keys(this.patch().areas || {}).filter((k) => k.split(':')[0] === num).sort();
      return (all.length ? all : [key]).flatMap((k) => this.stars(k));
    }
    key = `c:${key.slice(2).split(':')[0]}`;
    const keys = Object.keys(this.patch().areas || {}).filter((k) => k.startsWith(`${key}:`)).sort();
    return [key, ...keys].flatMap((k) => this.stars(k));
  }

  // Coin score of a custom level: the most coins held when collecting a star there.
  coinScore(key = this.key()) { return this.progress()[`coins|${key}`] || 0; }
  recordCoins(key, coins) {
    const p = this.progress();
    if (coins <= (p[`coins|${key}`] || 0)) return;
    p[`coins|${key}`] = coins;
    try { localStorage.setItem(this.progressKey(), JSON.stringify(p)); } catch { /* private mode */ }
  }

  // Studio stars collected in the whole project (the star counter adds them).
  collectedTotal() {
    return Object.keys(this.patch().areas || {}).reduce((n, key) => n + this.stars(key).filter((s) => s.done).length, 0);
  }

  // The star the engine reports: by uid, or (red coin and 100 coin stars) by index.
  findStar(key, uid, index) {
    const stars = this.stars(key);
    return stars.find((x) => uid && x.uid === uid) || stars.find((x) => x.kind === 'red_coins' && x.index === index)
      || stars.find((x) => x.kind === 'coins100' && x.index === index) || stars.find((x) => x.index === index);
  }

  // The engine reports a collected studio star.
  onStarCollected(ev) {
    const s = this.findStar(ev.key, ev.uid, ev.index);
    if (s) this.markStar(`${ev.key}|${s.uid}`);
    // a custom level's coin score and star count cover all its areas (sub-areas: c:<id>:<n>)
    const levelKey = ev.key.startsWith('c:') ? `c:${ev.key.slice(2).split(':')[0]}` : ev.key;
    try { this.recordCoins(levelKey, this.engine.state().mario?.coins || 0); } catch { /* not in a level */ }
    // counted like the Stars tab: the 100 coin star of a custom level is apart
    // (levelStars makes new objects: the collected one is matched by uid, not identity)
    const all = this.levelStars(ev.key).filter((x) => x.kind !== 'coins100' || (s && x.uid === s.uid));
    this.toast(`★ ${s ? s.name : 'Star'}!  ${all.filter((x) => x.done).length}/${all.length} in this level`, 'sparkles');
    this.emit();
  }

  // A fresh custom level from a template: { area, spawn } ready for the server.
  static newLevelArea(template) {
    const t = makeTemplate(template);
    const area = { objects: [], removals: [], warps: [], settings: { ...t.settings, spawn: t.spawn } };
    if (t.terrain) area.terrain = t.terrain.encode();
    // the template's blocks and objects become ordinary records: movable and deletable like any edit
    for (const r of [...(t.blocks || []), ...(t.objects || [])]) area.objects.push({ uid: 1 + Math.floor(Math.random() * 0x7efffffe), ...r });
    return area;
  }
}
