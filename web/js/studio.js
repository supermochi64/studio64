import { GENERATORS, blockDefaults, blockName, degToYaw, radToYaw } from './generators.js';
import { World } from './world.js';

// Browser side of Claude's tools: placement math, live edits and level queries.
// The server calls these over the websocket (rpc), then stores the records the
// calls return in the project patch.

const NOISE = /Particle|Sparkle|Puff|Smoke|Mist|SoundLoop|AmbientSounds|Dust|Splash|WaveTrail|Bubble|Shard|Explosion|Fuse|Trail|bhvMario$|ShadowSpawn|CelebrationStar|StarKeyCollection/;
const LANDMARK = /Star\b|StarSpawn|King|Boss|Whomp|ChainChomp\b|Cannon|WarpPipe|Bowser|Toad|Yoshi|Door|Painting|Koopa\b|Bobomb|Goomba|Boo|Bully|Piranha|Thwomp|Hoot|Wiggler|Eyerok|Dorrie|Unagi|Manta|Mips|Ukiki|Penguin|Snowman|MrBlizzard|Klepto|Tree|Signpost|MessagePanel|ExclamationBox|Coin\b|RedCoin|1up|Heart/;
const randUid = () => 1 + Math.floor(Math.random() * 0x7efffffe); // 0x7f000000+ are editor previews
const deg = (yaw) => Math.round(((yaw / 65536) * 360 + 360) % 360);
const toYaw = (d) => Math.round((d / 360) * 65536) & 0xffff;
const s16 = (v) => ((v & 0xffff) << 16) >> 16;

// RPC methods added by feature modules: registerRpc('name', function (params) { this = Studio }).
const RPC = {};
export function registerRpc(name, fn) { RPC[name] = fn; }

export class Studio {
  constructor(engine, catalog) {
    this.engine = engine;
    this.catalog = catalog;
    this.entries = new Map(catalog.entries.map((e) => [e.id, e]));
  }

  // ---- naming ------------------------------------------------------------

  recordOf(uid) {
    if (!uid) return null;
    for (const a of Object.values(this.engine.patch.areas || {})) {
      const r = (a.objects || []).find((x) => x.uid === uid);
      if (r) return r;
    }
    return null;
  }

  nameOfObject(o) {
    const rec = this.recordOf(o.uid);
    if (rec?.block) return blockName(rec.block);
    if (rec?.name) return rec.name;
    if (o.cat >= 0) return this.catalog.entries[o.cat].name;
    return o.bhv.replace(/^bhv/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  }

  levelName(num) {
    if (num === this.engine.studioLevel) {
      const l = (this.customLevels?.() || []).find((x) => x.id === this.engine.customLevel);
      return l ? l.name : 'Custom level';
    }
    for (const info of Object.values(this.catalog.levels)) if (info.num === num) return info.name;
    return `Level ${num}`;
  }

  // ---- geometry ----------------------------------------------------------

  mario() {
    const s = this.engine.state();
    if (!s.mario) throw new Error('Mario is not in a level right now (menu or transition). Try again in a moment.');
    return s;
  }

  basis(yaw) {
    const a = (yaw / 32768) * Math.PI;
    // SM64: yaw 0 faces +Z; x = sin, z = cos. Mario's right is (-cos, +sin).
    return { fx: Math.sin(a), fz: Math.cos(a), rx: -Math.cos(a), rz: Math.sin(a) };
  }

  bearing(m, x, z) {
    const b = this.basis(m.yaw);
    const dx = x - m.x, dz = z - m.z;
    const fwd = dx * b.fx + dz * b.fz, right = dx * b.rx + dz * b.rz;
    const ang = (Math.atan2(right, fwd) * 180) / Math.PI;
    const dirs = ['ahead', 'ahead-right', 'right', 'behind-right', 'behind', 'behind-left', 'left', 'ahead-left'];
    return dirs[Math.round(((ang + 360) % 360) / 45) % 8];
  }

  ground(x, z, probeY) {
    let y = this.engine.floor(x, probeY, z);
    if (y < -20000) y = this.engine.floor(x, 20000, z);
    return y < -20000 ? null : y;
  }

  // Resolve a placement spec into `count` points.
  points(where = {}, count = 1) {
    const s = this.mario();
    const m = s.mario;
    const b = this.basis(m.yaw);
    const mode = where.mode || (where.x !== undefined ? 'at' : 'in_front');
    const spacing = where.spacing ?? 180;
    const pts = [];
    let cx = m.x, cz = m.z, cy = m.y;
    const along = (fwd, right) => ({ x: m.x + b.fx * fwd + b.rx * right, z: m.z + b.fz * fwd + b.rz * right });

    if (mode === 'in_front' || mode === 'row') {
      const d = where.distance ?? 350;
      for (let i = 0; i < count; i++) pts.push(along(d, (i - (count - 1) / 2) * spacing));
    } else if (mode === 'line') {
      const d = where.distance ?? 300;
      for (let i = 0; i < count; i++) pts.push(along(d + i * spacing, 0));
    } else if (mode === 'grid') {
      const cols = Math.ceil(Math.sqrt(count));
      const d = where.distance ?? 400;
      for (let i = 0; i < count; i++) {
        const r = Math.floor(i / cols), c = i % cols;
        pts.push(along(d + r * spacing, (c - (cols - 1) / 2) * spacing));
      }
    } else if (mode === 'around' || mode === 'circle') {
      let a0 = 0;
      if (where.x !== undefined) {
        cx = where.x; cz = where.z; cy = where.y ?? cy;
        // a ring around something else: Mario's side falls in the middle of a gap, so nothing
        // of the ring (Bowser's mines, enemies) stands right between him and its middle
        if (Math.hypot(m.x - cx, m.z - cz) > 50) a0 = Math.atan2(m.x - cx, m.z - cz) + Math.PI / count;
      }
      const r = where.radius ?? 400;
      for (let i = 0; i < count; i++) {
        const a = a0 + (i / count) * Math.PI * 2;
        pts.push({ x: cx + Math.sin(a) * r, z: cz + Math.cos(a) * r });
      }
    } else if (mode === 'relative') {
      for (let i = 0; i < count; i++) pts.push(along((where.forward ?? 0), (where.right ?? 0) + (i - (count - 1) / 2) * spacing));
    } else if (mode === 'at' || mode === 'near_object') {
      if (mode === 'near_object') {
        const o = this.findObject(where);
        if (!o) throw new Error('near_object: no such object (give slot or uid from list_objects)');
        cx = o.x; cy = o.y; cz = o.z;
        const d = where.distance ?? 250;
        const a = Math.atan2(m.x - o.x, m.z - o.z); // toward Mario
        cx += Math.sin(a) * d; cz += Math.cos(a) * d;
      } else {
        if (where.x === undefined || where.z === undefined) throw new Error('mode "at" needs x and z');
        cx = where.x; cz = where.z; cy = where.y ?? 20000;
      }
      for (let i = 0; i < count; i++) {
        if (count === 1) { pts.push({ x: cx, z: cz }); break; }
        const a = (i / count) * Math.PI * 2;
        pts.push({ x: cx + Math.sin(a) * spacing * 0.7, z: cz + Math.cos(a) * spacing * 0.7 });
      }
    } else {
      throw new Error(`unknown placement mode "${mode}"`);
    }

    const snap = where.snap !== false;
    const explicitY = (mode === 'at' && where.y !== undefined) ? where.y : undefined;
    const probeY = explicitY !== undefined ? explicitY + 300 : (mode === 'at' ? 20000 : m.y + 400);
    return pts.map((p) => {
      let y;
      let noFloor = false;
      if (!snap && explicitY !== undefined) y = explicitY;
      else if (!snap) y = m.y;
      else {
        const g = this.ground(p.x, p.z, probeY);
        if (g === null) { noFloor = true; y = explicitY ?? m.y; } else y = g;
      }
      y += where.y_offset ?? 0;
      const water = this.engine.water(p.x, p.z);
      return { x: Math.round(p.x), y: Math.round(y), z: Math.round(p.z), noFloor, underwater: water > y + 50 && water > -10000 };
    });
  }

  faceYaw(face, p, m) {
    if (typeof face === 'number') return toYaw(face);
    if (face === 'away') return toYaw((Math.atan2(p.x - m.x, p.z - m.z) * 180) / Math.PI);
    if (face === 'same') return m.yaw & 0xffff;
    return toYaw((Math.atan2(m.x - p.x, m.z - p.z) * 180) / Math.PI); // face Mario
  }

  parseParams(v) {
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v === 'number') return v >>> 0;
    return parseInt(String(v), String(v).startsWith('0x') ? 16 : 10) >>> 0;
  }

  findObject({ slot, uid }) {
    const objs = this.engine.objects();
    if (uid) return objs.find((o) => o.uid === uid);
    if (slot !== undefined) return objs.find((o) => o.slot === slot);
    return null;
  }

  // ---- rpc methods -------------------------------------------------------

  state() {
    const s = this.mario();
    const m = s.mario;
    const objs = this.engine.objects().filter((o) => !NOISE.test(o.bhv) && o.dist > 1);
    objs.sort((a, b) => a.dist - b.dist);
    const nearby = objs.slice(0, 14).map((o) => ({
      slot: o.slot, name: this.nameOfObject(o), dist: Math.round(o.dist),
      direction: this.bearing(m, o.x, o.z), studio: o.uid ? o.uid : undefined,
    }));
    const key = this.engine.areaKey();
    const a = this.engine.patch.areas[key] || {};
    return {
      level: this.levelName(s.level), level_num: s.level, area: s.area, act: s.act,
      custom: s.level === this.engine.studioLevel ? this.engine.customLevel : undefined,
      stars_here: this.world ? this.world.stars().map((x) => `${x.name}${x.done ? ' (collected)' : ''}`) : undefined,
      mario: { x: m.x, y: m.y, z: m.z, facing_deg: deg(m.yaw), yaw: s16(m.yaw), health: m.health, coins: m.coins, stars: m.stars, on_ground_y: m.floorY, action: m.action },
      camera_yaw_deg: s.camera ? deg(s.camera.yaw) : undefined,
      nearby,
      edits_here: { added: (a.objects || []).length, removed: (a.removals || []).length, pipes: (a.warps || []).length },
      object_count: s.objects,
    };
  }

  async look() {
    const url = await this.engine.screenshot();
    return { image: url, state: this.state() };
  }

  objects({ radius, query, limit = 60, include_effects = false } = {}) {
    const m = this.mario().mario;
    let objs = this.engine.objects();
    if (!include_effects) objs = objs.filter((o) => !NOISE.test(o.bhv));
    if (radius) objs = objs.filter((o) => o.dist <= radius);
    if (query) {
      const q = query.toLowerCase().replace(/[^a-z0-9]/g, '');
      objs = objs.filter((o) => (o.bhv + this.nameOfObject(o) + (o.cat >= 0 ? this.catalog.entries[o.cat].id : '')).toLowerCase().replace(/[^a-z0-9]/g, '').includes(q));
    }
    objs.sort((a, b) => a.dist - b.dist);
    return {
      total: objs.length,
      objects: objs.slice(0, limit).map((o) => ({
        slot: o.slot, name: this.nameOfObject(o), behavior: o.bhv,
        id: o.cat >= 0 ? this.catalog.entries[o.cat].id : undefined,
        x: o.x, y: o.y, z: o.z, dist: Math.round(o.dist), direction: this.bearing(m, o.x, o.z),
        studio_uid: o.uid || undefined, spawned_by_slot: o.parent >= 0 ? o.parent : undefined,
        bparams: o.bparams ? '0x' + (o.bparams >>> 0).toString(16).padStart(8, '0') : undefined,
      })),
    };
  }

  terrain({ resolution = 64 } = {}) {
    const s = this.mario();
    const m = s.mario;
    const N = Math.min(Math.max(resolution, 16), 96);
    // the world is ±16384 now: find where there is ground on a coarse grid, then sample that box
    const W0 = 16384, NC = 48;
    const coarse = this.engine.heightmap(-W0, -W0, W0, W0, NC, NC);
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    const step = (2 * W0) / (NC - 1);
    for (let j = 0; j < NC; j++) for (let i = 0; i < NC; i++) {
      if (coarse.h[j * NC + i] < -20000) continue;
      const x = -W0 + step * i, z = -W0 + step * j;
      bx0 = Math.min(bx0, x - step); bx1 = Math.max(bx1, x + step); bz0 = Math.min(bz0, z - step); bz1 = Math.max(bz1, z + step);
    }
    if (bx0 === Infinity) { bx0 = bz0 = -8192; bx1 = bz1 = 8192; }
    // a square box (keeps the relief map's proportions), inside the world
    const half = Math.max(bx1 - bx0, bz1 - bz0) / 2, cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
    const X0 = Math.max(-W0, cx - half), X1 = Math.min(W0, cx + half), Z0 = Math.max(-W0, cz - half), Z1 = Math.min(W0, cz + half);
    const hm = this.engine.heightmap(X0, Z0, X1, Z1, N, N);
    const cells = [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const y = hm.h[j * N + i];
      if (y < -20000) continue;
      const x = X0 + ((X1 - X0) * i) / (N - 1), z = Z0 + ((Z1 - Z0) * j) / (N - 1);
      cells.push({ x, z, y, w: hm.w[j * N + i], i, j });
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    if (!cells.length) return { error: 'no floors found' };
    const sorted = [...cells].sort((a, b) => b.y - a.y);
    const peaks = [];
    for (const c of sorted) {
      if (peaks.length >= 6) break;
      if (peaks.every((p) => Math.hypot(p.x - c.x, p.z - c.z) > 1800)) {
        // refine on a finer local grid
        let best = c;
        for (let dz = -200; dz <= 200; dz += 50) for (let dx = -200; dx <= 200; dx += 50) {
          const y = this.engine.floor(c.x + dx, 20000, c.z + dz);
          if (y > best.y) best = { x: c.x + dx, z: c.z + dz, y };
        }
        peaks.push({ x: Math.round(best.x), y: Math.round(best.y), z: Math.round(best.z), direction: this.bearing(m, best.x, best.z), dist: Math.round(Math.hypot(best.x - m.x, best.z - m.z)) });
      }
    }
    const lows = [...cells].filter((c) => c.y > -9000).sort((a, b) => a.y - b.y);
    const waterLevels = [...new Set(cells.filter((c) => c.w > c.y && c.w > -10000).map((c) => c.w))].slice(0, 4);
    // ASCII relief map, rows = z from min (top) to max (bottom), columns = x min -> max
    const W = 40;
    const ys = cells.map((c) => c.y);
    const lo = Math.min(...ys), hi = Math.max(...ys);
    const ramp = ' .:-=+*#%@';
    const rows = [];
    const mi = Math.round(((m.x - minX) / Math.max(1, maxX - minX)) * (W - 1));
    const mj = Math.round(((m.z - minZ) / Math.max(1, maxZ - minZ)) * (W - 1));
    for (let j = 0; j < W; j++) {
      let row = '';
      for (let i = 0; i < W; i++) {
        if (i === mi && j === mj) { row += 'M'; continue; }
        const x = minX + ((maxX - minX) * i) / (W - 1), z = minZ + ((maxZ - minZ) * j) / (W - 1);
        const ci = Math.round(((x - X0) / (X1 - X0)) * (N - 1)), cj = Math.round(((z - Z0) / (Z1 - Z0)) * (N - 1));
        const y = hm.h[cj * N + ci], w = hm.w[cj * N + ci];
        if (y < -20000) row += ' ';
        else if (w > y + 30 && w > -10000) row += '~';
        else row += ramp[Math.min(9, Math.floor(((y - lo) / Math.max(1, hi - lo)) * 9.99))];
      }
      rows.push(row);
    }
    const landmarks = this.engine.objects()
      .filter((o) => LANDMARK.test(o.bhv) && !NOISE.test(o.bhv))
      .sort((a, b) => b.y - a.y).slice(0, 24)
      .map((o) => ({ slot: o.slot, name: this.nameOfObject(o), x: o.x, y: o.y, z: o.z }));
    return {
      level: this.levelName(s.level), area: s.area,
      bounds: { minX: Math.round(minX), maxX: Math.round(maxX), minZ: Math.round(minZ), maxZ: Math.round(maxZ), minY: lo, maxY: hi },
      mario: { x: m.x, y: m.y, z: m.z, facing_deg: deg(m.yaw) },
      highest_points: peaks,
      lowest_ground: lows.slice(0, 1).map((c) => ({ x: Math.round(c.x), y: c.y, z: Math.round(c.z) }))[0],
      water_levels: waterLevels,
      landmarks,
      relief_map: { legend: `rows: z ${Math.round(minZ)} (top) -> ${Math.round(maxZ)} (bottom); cols: x ${Math.round(minX)} (left) -> ${Math.round(maxX)} (right); ramp low->high " .:-=+*#%@", ~ water, M Mario`, rows },
    };
  }

  probe({ points = [] } = {}) {
    return points.slice(0, 50).map((p) => {
      const y = this.ground(p.x, p.z, p.y ?? 20000);
      return { x: p.x, z: p.z, floor_y: y, water_y: this.engine.water(p.x, p.z) };
    });
  }

  place({ items = [] } = {}) {
    const s = this.mario();
    const m = s.mario;
    const placed = [];
    const errors = [];
    for (const it of items) {
      const count = Math.max(1, Math.min(it.count ?? 1, 40));
      let entry = it.id && this.entries.get(it.id);
      if (it.id && !entry) { errors.push(`unknown id "${it.id}" (use search_catalog)`); continue; }
      if (!entry && !it.behavior) { errors.push('item needs id (or behavior + model)'); continue; }
      if (it.behavior && !this.catalog.behaviors.includes(it.behavior)) { errors.push(`unknown behavior ${it.behavior}`); continue; }
      let pts;
      try { pts = this.points(it.where, count); } catch (e) { errors.push(e.message); continue; }
      const bparams = this.parseParams(it.bparams) ?? (entry ? this.parseParams(entry.params[0]) || 0 : 0);
      for (const p of pts) {
        const yaw = this.faceYaw(it.face, p, m);
        const rec = it.behavior
          ? { uid: randUid(), bhv: it.behavior, model: it.model_id || it.id || null, x: p.x, y: p.y, z: p.z, yaw, bparams, scale: it.scale || 1 }
          : { uid: randUid(), entry: entry.id, x: p.x, y: p.y, z: p.z, yaw, pitch: 0, roll: 0, bparams, scale: it.scale || 1 };
        const slot = this.engine.spawn(rec);
        if (slot < 0) { errors.push(`could not spawn ${it.id || it.behavior} (object pool full?)`); continue; }
        rec.name = entry ? entry.name : it.behavior;
        placed.push({ record: rec, slot, noFloor: p.noFloor || undefined, underwater: p.underwater || undefined });
      }
    }
    return { level: s.level, area: s.area, key: this.engine.areaKey(), placed, errors };
  }

  remove({ slots, uids, query, radius, nearest, include_spawner = false } = {}) {
    const s = this.mario();
    let objs = this.engine.objects().filter((o) => o.bhv !== 'bhvMario');
    let targets = [];
    if (slots?.length) targets = objs.filter((o) => slots.includes(o.slot));
    else if (uids?.length) targets = objs.filter((o) => uids.includes(o.uid));
    else if (query) {
      const q = query.toLowerCase().replace(/[^a-z0-9]/g, '');
      targets = objs.filter((o) => !NOISE.test(o.bhv) && (o.bhv + this.nameOfObject(o) + (o.cat >= 0 ? this.catalog.entries[o.cat].id : '')).toLowerCase().replace(/[^a-z0-9]/g, '').includes(q));
      if (radius) targets = targets.filter((o) => o.dist <= radius);
      targets.sort((a, b) => a.dist - b.dist);
      if (nearest) targets = targets.slice(0, nearest);
    }
    if (include_spawner) {
      for (const t of [...targets]) {
        if (t.parent >= 0) {
          const p = objs.find((o) => o.slot === t.parent);
          if (p && p.bhv !== 'bhvMario' && !targets.includes(p)) targets.push(p);
        }
      }
    }
    const removed = [];
    const rules = [];
    const studioUids = [];
    for (const o of targets) {
      if (o.uid) {
        this.engine.deleteUid(o.uid);
        studioUids.push(o.uid);
      } else {
        this.engine.deleteSlot(o.slot);
        const useHome = o.hx || o.hy || o.hz;
        const rule = { bhv: o.bhv, x: useHome ? o.hx : o.x, y: useHome ? o.hy : o.y, z: useHome ? o.hz : o.z, r: 60,
          name: this.nameOfObject(o), restore: o.cat >= 0 ? { entry: this.catalog.entries[o.cat].id, x: o.x, y: o.y, z: o.z, yaw: o.yaw, bparams: o.bparams } : undefined };
        rules.push(rule);
        this.engine.addRemoval(rule);
      }
      removed.push({ slot: o.slot, name: this.nameOfObject(o), x: o.x, y: o.y, z: o.z, studio: !!o.uid });
    }
    return { level: s.level, area: s.area, key: this.engine.areaKey(), removed, rules, studioUids };
  }

  move({ slot, uid, where = {}, face } = {}) {
    const s = this.mario();
    const o = this.findObject({ slot, uid });
    if (!o) throw new Error('no such object (use list_objects for slot/uid)');
    const [p] = this.points(where, 1);
    const yaw = face !== undefined ? this.faceYaw(face, p, s.mario) : o.yaw;
    if (o.uid) {
      this.engine.moveSlot(o.slot, p.x, p.y, p.z, yaw);
      return { level: s.level, area: s.area, key: this.engine.areaKey(), uid: o.uid, x: p.x, y: p.y, z: p.z, yaw };
    }
    // vanilla object: hide the original for good and place a copy we own
    if (o.cat < 0) throw new Error('this object cannot be moved (unknown model); remove it and spawn a new one instead');
    const r = this.remove({ slots: [o.slot] });
    const rec = { uid: randUid(), entry: this.catalog.entries[o.cat].id, x: p.x, y: p.y, z: p.z, yaw, pitch: 0, roll: 0, bparams: o.bparams >>> 0, scale: 1 };
    this.engine.spawn(rec);
    rec.name = this.nameOfObject(o);
    return { level: s.level, area: s.area, key: this.engine.areaKey(), copied: rec, rules: r.rules };
  }

  pipe({ from = {}, to = {}, two_way = true } = {}) {
    const s = this.mario();
    const used = new Set(this.engine.warps().map((w) => w.id));
    for (const a of Object.values(this.engine.patch.areas)) for (const w of a.warps || []) used.add(w.node);
    const free = () => { for (let id = 0x80; id < 0xee; id++) if (!used.has(id)) { used.add(id); return id; } throw new Error('no free warp ids left in this area'); };
    const [pa] = this.points({ distance: 300, ...from }, 1);
    const nodeA = free();
    const records = [];
    const warps = [];
    const recA = { uid: randUid(), entry: 'warp_pipe', x: pa.x, y: pa.y, z: pa.z, yaw: 0, bparams: (nodeA << 16) >>> 0, scale: 1, name: 'Warp Pipe' };
    records.push(recA);
    if (to.level !== undefined) {
      warps.push({ node: nodeA, destLevel: to.level, destArea: to.area ?? 1, destNode: to.node ?? 0x0a });
    } else {
      const [pb] = this.points(to.x !== undefined ? { mode: 'at', ...to } : to, 1);
      if (Math.hypot(pb.x - pa.x, pb.z - pa.z) < 200) throw new Error('both pipe ends are at the same spot');
      const nodeB = free();
      const recB = { uid: randUid(), entry: 'warp_pipe', x: pb.x, y: pb.y, z: pb.z, yaw: 0, bparams: (nodeB << 16) >>> 0, scale: 1, name: 'Warp Pipe' };
      records.push(recB);
      warps.push({ node: nodeA, destLevel: s.level, destArea: s.area, destNode: nodeB });
      // the exit pipe needs a node even one-way, so Mario can come out of it
      warps.push({ node: nodeB, destLevel: s.level, destArea: s.area, destNode: two_way ? nodeA : nodeB });
    }
    for (const w of warps) this.engine.addWarp(w);
    for (const r of records) this.engine.spawn(r);
    this.engine.relinkWarps();
    return { level: s.level, area: s.area, key: this.engine.areaKey(), records, warps };
  }

  teleport({ where = {} } = {}) {
    const [p] = this.points(where.mode ? where : { mode: 'at', ...where }, 1);
    this.engine.teleport(p.x, p.y + 50, p.z, this.mario().mario.yaw);
    return { x: p.x, y: p.y, z: p.z };
  }

  warp({ level, act = 1, area = 1, node = 10, acts = false } = {}) {
    this.engine.warp(level, area, node, acts ? act : 0);
    return { ok: true };
  }

  heal() { this.engine.heal(); return { ok: true }; }

  // ---- levels, settings, stars --------------------------------------------------

  // Returns once Mario is in the level (its star select screen goes on by itself).
  async gotoLevel({ custom, level, act = 1, acts = false } = {}) {
    const target = custom ? this.engine.studioLevel : level;
    if (custom) this.engine.warpFast(this.engine.studioLevel, 0, custom);
    else this.engine.warpFast(level, acts ? act : 0);
    const arrived = await this.engine.waitArrival(target);
    return { ok: true, arrived };
  }

  levelSettings({ sky, music, water, spawn, song } = {}) {
    const f = {};
    if (sky !== undefined) f.sky = sky;
    if (music !== undefined) { f.music = music; f.musicOverride = true; f.song = null; }
    if (song !== undefined) { f.song = song; f.musicOverride = true; }
    if (water !== undefined) f.water = { on: water.enabled !== false, height: Math.round(water.height ?? 0) };
    if (spawn) {
      const [p] = this.points(spawn.mode || spawn.x !== undefined ? (spawn.x !== undefined ? { mode: 'at', ...spawn } : spawn) : { distance: 0, ...spawn }, 1);
      f.spawn = { x: p.x, y: p.y + 50, z: p.z, yaw: this.mario().mario.yaw & 0xffff };
    }
    if ((f.sky !== undefined || f.water) && !this.world.isCustom()) throw new Error('sky and water can only be changed in custom levels');
    this.world.setSettings(f, 'Changed level settings');
    return { ok: true, settings: this.world.settings() };
  }

  // A star (or a red coin star with its 8 red coins), tracked by the studio.
  addStar({ name = 'Star', where = {}, kind = 'star', coins } = {}) {
    const s = this.mario();
    const used = new Set(this.world.stars().map((x) => x.index));
    let index = 0;
    while (used.has(index) && index < 30) index++;
    const [p] = this.points(where, 1);
    const records = [];
    const hover = kind === 'star' ? 120 : 0;
    const star = { uid: randUid(), entry: kind === 'red_coins' ? 'hidden_red_coin_star' : 'star', x: p.x, y: p.y + hover, z: p.z, yaw: 0, pitch: 0, roll: 0,
      bparams: ((index & 0x1f) << 24) >>> 0, scale: 1, name, star: { name } };
    records.push(star);
    if (kind === 'red_coins') {
      let pts = [];
      if (Array.isArray(coins) && coins.length) pts = coins.slice(0, 8).map((c) => this.points(c.mode || c.x === undefined ? c : { mode: 'at', ...c }, 1)[0]);
      else pts = this.points({ mode: 'around', x: p.x, z: p.z, radius: 1400 }, 8);
      for (const c of pts) records.push({ uid: randUid(), entry: 'red_coin', x: c.x, y: c.y + 60, z: c.z, yaw: 0, pitch: 0, roll: 0, bparams: 0, scale: 1, name: 'Red Coin' });
    }
    for (const r of records) this.engine.spawn(r);
    return { level: s.level, area: s.area, key: this.engine.areaKey(), records, star: { name, index, x: star.x, y: star.y, z: star.z } };
  }

  // Nearest wall around a point (for wall climbs): returns the hit and the yaw facing away from it.
  nearestWall(p) {
    let best = null;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const hit = this.engine.raycast([p.x, p.y + 120, p.z], [Math.sin(a), 0, Math.cos(a)], -1, false, 3000);
      if (hit && Math.abs(hit.ny) < 0.5 && (!best || hit.t < best.t)) best = hit;
    }
    return best && { x: best.x, y: p.y, z: best.z, yaw: radToYaw(Math.atan2(best.nx, best.nz)) };
  }

  // Blocks and structures (see generators.js).
  build({ kind = 'block', where = {}, yaw_deg, face, block = {}, params = {}, to } = {}) {
    const s = this.mario();
    const m = s.mario;
    if (kind !== 'block' && !GENERATORS[kind]) throw new Error(`unknown structure "${kind}" (block, ${Object.keys(GENERATORS).join(', ')})`);
    const [p] = this.points(where.mode || where.x !== undefined ? where : { distance: 400, ...where }, 1);
    let yaw;
    if (yaw_deg !== undefined) yaw = degToYaw(yaw_deg);
    else if (face === 'mario') yaw = radToYaw(Math.atan2(m.x - p.x, m.z - p.z));
    else yaw = radToYaw(Math.atan2(p.x - m.x, p.z - m.z)); // away from Mario
    let anchor = { x: p.x, y: p.y, z: p.z, yaw };
    if (kind === 'wall_climb' && yaw_deg === undefined) {
      const w = this.nearestWall(p);
      if (!w) throw new Error('no wall near that spot: give a point right next to a wall');
      anchor = w;
    }
    let recs;
    if (kind === 'block') {
      const b = blockDefaults(block);
      recs = [{ block: b, x: anchor.x, y: anchor.y + (where.y_offset ? 0 : 0), z: anchor.z, yaw: anchor.yaw, pitch: block.pitch_deg ? degToYaw(block.pitch_deg) : 0, roll: block.roll_deg ? degToYaw(block.roll_deg) : 0 }];
    } else {
      const args = { ...params, ...anchor };
      if (to) { const [q] = this.points(to.x !== undefined ? { mode: 'at', ...to } : to, 1); args.x2 = q.x; args.y2 = q.y; args.z2 = q.z; }
      recs = GENERATORS[kind].build(args);
      if (!recs.length) throw new Error(kind === 'bridge' ? 'a bridge needs "to"' : 'nothing to build');
    }
    const records = recs.map((r) => ({ ...r, uid: randUid(), name: blockName(r.block) }));
    for (const r of records) this.engine.spawn(r);
    return { level: s.level, area: s.area, key: this.engine.areaKey(), records, anchor };
  }

  // Change an object's properties. Original objects are replaced by an owned copy.
  modify({ slot, uid, set = {} } = {}) {
    const s = this.mario();
    const o = this.findObject({ slot, uid });
    if (!o) throw new Error('no such object (use list_objects for slot/uid)');
    let rec = this.recordOf(o.uid);
    let adopted = null;
    if (!rec) {
      if (o.cat < 0) throw new Error('this object cannot be changed, only removed');
      const r = this.remove({ slots: [o.slot] });
      rec = { uid: randUid(), entry: this.catalog.entries[o.cat].id, x: o.x, y: o.y, z: o.z, yaw: o.yaw & 0xffff, pitch: 0, roll: 0, bparams: o.bparams >>> 0, scale: o.scale || 1, name: this.nameOfObject(o) };
      adopted = { record: rec, rules: r.rules };
    }
    const fields = {};
    for (const k of ['x', 'y', 'z', 'scale']) if (set[k] !== undefined) fields[k] = set[k];
    if (set.yaw_deg !== undefined) fields.yaw = degToYaw(set.yaw_deg);
    if (set.pitch_deg !== undefined) fields.pitch = degToYaw(set.pitch_deg);
    if (set.roll_deg !== undefined) fields.roll = degToYaw(set.roll_deg);
    if (set.bparams !== undefined) fields.bparams = this.parseParams(set.bparams);
    if (set.block && rec.block) {
      const sb = { ...set.block };
      if (sb.material !== undefined) { sb.top = sb.material; sb.side = sb.material; delete sb.material; }
      fields.block = blockDefaults({ ...rec.block, ...sb });
    }
    Object.assign(rec, fields);
    this.engine.deleteUid(rec.uid);
    this.engine.spawn(rec);
    return { level: s.level, area: s.area, key: this.engine.areaKey(), uid: rec.uid, fields, record: rec, adopted };
  }

  // Undo/redo and other clients' edits.
  applyOps(ops) {
    const here = this.engine.areaKey();
    if (ops.reloadArea && (ops.key === here || ops.key === '*')) this.world?.reapply();
    for (const uid of ops.deleteUids || []) this.engine.deleteUid(uid);
    for (const r of ops.restore || []) if (r.key === here) this.engine.spawn(r.record);
    for (const rec of ops.spawn || []) if (ops.key === here) this.engine.spawn(rec);
    for (const w of ops.warps || []) if (ops.key === here) this.engine.addWarp(w);
    if ((ops.warps || []).length && ops.key === here) this.engine.relinkWarps();
    if (ops.key === here || ops.key === '*') {
      this.engine.reapplyRemovals();
      for (const r of ops.removedRules || []) if (r.restore) this.engine.spawn({ ...r.restore, uid: 0 });
      for (const r of ops.addRules || []) { this.engine.addRemoval(r); }
      if ((ops.addRules || []).length) this.engine.M._studio_apply_removals_now();
    }
    return { ok: true };
  }

  async handle(method, params) {
    // nothing to edit while the star select screen is up: wait for the level
    if (this.engine.inIntro) await this.engine.waitArrival(null, 15000);
    switch (method) {
      case 'state': return this.state();
      case 'look': return this.look();
      case 'objects': return this.objects(params);
      case 'terrain': return this.terrain(params);
      case 'probe': return this.probe(params);
      case 'place': return this.place(params);
      case 'remove': return this.remove(params);
      case 'move': return this.move(params);
      case 'pipe': return this.pipe(params);
      case 'teleport': return this.teleport(params);
      case 'warp': return this.warp(params);
      case 'heal': return this.heal();
      case 'build': return this.build(params);
      case 'make_level_area': return World.newLevelArea(params.template || 'meadow');
      case 'goto': return this.gotoLevel(params);
      case 'shape': return this.world.runOps(params.ops || [], params.summary);
      case 'level_settings': return this.levelSettings(params);
      case 'add_star': return this.addStar(params);
      case 'stars': return { level: this.levelName(this.engine.level), stars: this.world.stars() };
      case 'modify': return this.modify(params);
      case 'apply_ops': return this.applyOps(params);
      default:
        if (RPC[method]) return RPC[method].call(this, params);
        throw new Error(`unknown method ${method}`);
    }
  }
}
