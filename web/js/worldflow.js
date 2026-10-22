// World flow: how the hack's levels and areas connect, and what each area feels like.
//
// - Areas: custom levels have up to 7 areas (keys `c:<id>` and `c:<id>:<n>`), each with
//   its own terrain, objects and settings, like SM64's sub-areas.
// - Warps: doors, pipes, paintings, warp zones and arrival points are ordinary records
//   with a `warp` field ({ kind, node, to, stars, key, locked }). `to` names the
//   destination: { custom, area, uid } (a warp object there) or { level, area, node },
//   or { hub: true }. Warp nodes are registered while the area loads; the engine asks
//   us where each warp goes (Module.studioWarp), since custom levels share one slot.
// - Zones: block records with a `zone` field (warp, arrival, death, camera, water, gas,
//   lava, quicksand, exit), visible and pickable in build mode only.
// - Flow (patch.world): start level, hub (deaths, stars and Exit Course return there),
//   star goal, pictures for paintings.
// - Environment (settings.env): fog, light, weather, death height, camera, ambient sound.
import { material } from './generators.js';
import { registerRpc } from './studio.js';
import { World } from './world.js';

export const STUDIO_LEVEL = 37;
export const MAX_AREAS = 7;
const HELPER_UID = 0x7e200000;           // spawns that aren't saved: hub return points, liquid surfaces
const N_STAR = 0xe0, N_DEATH = 0xe1, N_EXIT = 0xe2;
const NODE_MIN = 0x80, NODE_MAX = 0xdf;

export const CAMERA_MODES = ['default', 'open', 'radial', 'close', '8dir', 'behind', 'slide', 'boss', 'fixed', 'side', 'top'];
export const CAMERA_LABELS = {
  default: 'Level default', open: 'Open (Lakitu follows)', radial: 'Radial (around the middle)', close: 'Close (indoors)',
  '8dir': '8 directions (Bowser courses)', behind: 'Behind Mario', slide: 'Slide', boss: 'Boss fight', fixed: 'Fixed point',
  side: 'Side-scroller', top: 'Top-down',
};
export const WEATHER = ['none', 'snow', 'blizzard', 'rain', 'leaves', 'petals', 'lava_bubbles', 'bubbles', 'snow_water'];
export const WEATHER_LABELS = { none: 'Clear', snow: 'Snow', blizzard: 'Blizzard', rain: 'Rain', leaves: 'Falling leaves', petals: 'Petals', lava_bubbles: 'Lava bubbles', bubbles: 'Bubbles', snow_water: 'Underwater flakes' };
// ambient loops: the game's environment sounds (bits from web/data/sounds.json); interval in frames
export const AMBIENT = {
  none: null,
  wind: { bits: 0x40108001, every: 1, label: 'Wind' },
  howling: { bits: 0x60098001, every: 1, label: 'Howling wind' },
  waterfall: { bits: 0x40000001, every: 1, label: 'Waterfall' },
  water: { bits: 0x40090001, every: 1, label: 'Flowing water' },
  drone: { bits: 0x40040001, every: 1, label: 'Cave drone' },
  birds: { bits: 0x50510081, every: 140, label: 'Birds' },
  boos: { bits: 0x500b0081, every: 400, label: 'Haunted (Boo laughs)' },
  bubbles: { bits: 0x300b0081, every: 50, label: 'Bubbling' },
  sand: { bits: 0x400e0001, every: 1, label: 'Moving sand' },
};
export const PICTURES = [
  { id: 'bob', label: "Bob-omb Battlefield" }, { id: 'ccm', label: 'Cool, Cool Mountain' }, { id: 'wf', label: "Whomp's Fortress" },
  { id: 'jrb', label: 'Jolly Roger Bay' }, { id: 'lll', label: 'Lethal Lava Land' }, { id: 'ssl', label: 'Shifting Sand Land' },
  { id: 'wdw', label: 'Wet-Dry World' }, { id: 'thi', label: 'Tiny-Huge Island' }, { id: 'ttm', label: 'Tall, Tall Mountain' },
  { id: 'ttc', label: 'Tick Tock Clock' }, { id: 'sl', label: "Snowman's Land" },
];
export const DOOR_STYLES = [
  { id: 'wood', label: 'Wooden door', model: 'prop:wooden_door' },
  { id: 'castle', label: 'Castle door', model: 'door:castle_door' },
  { id: 'star', label: 'Star door', model: 'prop:castle_door_0_star' },
  { id: 'star1', label: 'One-star door', model: 'door:castle_door_1_star' },
  { id: 'star3', label: 'Three-star door', model: 'door:castle_door_3_stars' },
  { id: 'key', label: 'Key door', model: 'door:key_door' },
  { id: 'metal', label: 'Metal door', model: 'prop:metal_door' },
  { id: 'haunted', label: 'Haunted door', model: 'prop:haunted_door' },
  { id: 'cabin', label: 'Cabin door', model: 'prop:cabin_door' },
  { id: 'cave', label: 'Cave door', model: 'door:hazy_maze_door' },
];
// zone kinds: color in build mode, block material, what it does
export const ZONES = {
  warp: { label: 'Warp zone', color: 0xb070ff, help: 'Mario walking in warps away (fade, star wipe or instantly).' },
  arrival: { label: 'Arrival point', color: 0x5ee08a, help: 'Where Mario comes out of a warp.' },
  exit: { label: 'Level exit', color: 0xffd23f, help: 'Leaves the level, back to the hub.' },
  death: { label: 'Death zone', color: 0xff4a4a, help: 'Falling in costs a life (or leads to the area set as "falling leads to").' },
  camera: { label: 'Camera zone', color: 0xffb03a, help: 'Inside it, the camera changes mode.' },
  water: { label: 'Water box', color: 0x3a9bff, help: 'Swimmable water up to the top of the box.' },
  gas: { label: 'Toxic gas', color: 0xc8e04a, help: 'Hurts Mario while his head is in it.' },
  lava: { label: 'Lava pool', color: 0xff6a1a, help: 'A burning lava surface at the top of the box.' },
  quicksand: { label: 'Quicksand', color: 0xd9b36a, help: 'Sinking sand at the top of the box.' },
};
const ARRIVALS = { walk: 'bhvInstantActiveWarp', spin: 'bhvSpinAirborneWarp', fall: 'bhvAirborneWarp' };
const TRANSITIONS = { fade: 0, star: 1, circle: 2, instant: 3 };

const randUid = () => 1 + Math.floor(Math.random() * 0x7efffffe);
const hex = (c, d = 0xffffff) => (typeof c === 'string' ? parseInt(c.replace('#', ''), 16) : (c ?? d)) & 0xffffff;
const plain = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e\n]/g, ' ');

export function areaKeyOf({ custom, level, area = 1 }) {
  if (custom) return area > 1 ? `c:${custom}:${area}` : `c:${custom}`;
  return `${level}:${area || 1}`;
}

export function parseKey(key) {
  const m = /^c:([^:]+)(?::(\d+))?$/.exec(key || '');
  if (m) return { custom: m[1], area: Number(m[2] || 1) };
  const [l, a] = String(key).split(':').map(Number);
  return { level: l, area: a || 1 };
}

export class WorldFlow {
  constructor({ engine, world, send, toast, getLevels, catalog }) {
    this.engine = engine;
    this.world = world;
    this.send = send;
    this.toast = toast;
    this.getLevels = getLevels;
    this.catalog = catalog;
    this.editor = null;
    this.nodeTargets = new Map();   // warp node in this area -> { custom } (where it really leads)
    this.lockOverrides = new Map(); // uid -> locked (events open and close doors at runtime)
    this.pictureCache = new Map();  // picture id -> Uint16Array 128x128 RGBA16
    this.pictureSlots = new Map();  // picture id -> engine slot
    this.returnTo = null;           // where Mario left the hub: { key, x, y, z, yaw }
    this.zonesPending = false;
    this.building = false;
    this.listeners = [];
    this.goalShown = false;
    engine.levelHooks.push((level, area, key) => this.onAreaLoad(level, area, key));
    engine.spawnFilters.push((rec) => this.spawnFilter(rec));
    engine.on('frame', () => this.onFrame());
    engine.on('ready', () => { this.installHooks(); this.refreshPaintings(); });
    this.registerRpcs();
  }

  on(fn) { this.listeners.push(fn); }
  emit() { for (const fn of this.listeners) { try { fn(); } catch (e) { console.error(e); } } }

  get M() { return this.engine.M; }
  patch() { return this.engine.patch; }
  flow() { return this.patch().world || {}; }
  key() { return this.engine.areaKey(); }
  here() {
    const e = this.engine;
    return e.level === STUDIO_LEVEL ? { custom: e.customLevel, area: e.area } : { level: e.level, area: e.area };
  }
  area(key = this.key()) { return this.patch().areas?.[key] || {}; }
  // The area's records, plus ones added here that the server hasn't echoed back yet (a
  // patch from the server replaces ours and may be a moment behind).
  records(key = this.key()) {
    const list = this.area(key).objects || [];
    if (!this.recent?.size) return list;
    const extra = [];
    for (const [uid, r] of this.recent) if (r.key === key && Date.now() - r.t < 15000 && !list.some((x) => x.uid === uid)) extra.push(r.rec);
    return extra.length ? [...list, ...extra] : list;
  }

  installHooks() {
    const M = this.M;
    M.studioWarp = (src, level, area, node, exitCourse) => {
      try { this.onWarp(src, level, area, node, exitCourse); } catch (err) { console.error('warp hook', err); }
    };
    M.studioKey = (k, uid) => setTimeout(() => this.onKey(k, uid), 0);
    M.studioUnlocked = (uid) => setTimeout(() => this.onUnlocked(uid), 0);
    this.pushKeys();
  }

  // ---- areas of custom levels ----------------------------------------------------

  levelOf(id) { return this.getLevels().find((l) => l.id === id) || null; }
  areasOf(id) {
    const l = this.levelOf(id);
    if (!l) return [];
    return [{ index: 1, name: l.mainAreaName || 'Main area' }, ...(l.areas || [])].sort((a, b) => a.index - b.index);
  }
  areaName(to) {
    if (to.custom) {
      const l = this.levelOf(to.custom);
      const a = this.areasOf(to.custom).find((x) => x.index === (to.area || 1));
      return `${l?.name || 'Custom level'}${this.areasOf(to.custom).length > 1 ? ` · ${a?.name || `Area ${to.area}`}` : ''}`;
    }
    const info = Object.values(this.catalog.levels).find((l) => l.num === to.level);
    return `${info?.name || `Level ${to.level}`}${to.area > 1 ? ` · area ${to.area}` : ''}`;
  }

  // Go to an area (the editor keeps its camera per area and comes back in build mode).
  goArea(to, { intro = false, node } = {}) {
    const e = this.engine;
    if (!e.ready) return;
    const ed = this.editor;
    const lui = this.levelsUI;
    if (ed?.active && lui) { lui.cams[e.areaKey()] = { ...ed.cam }; lui.rebuild = true; }
    const level = to.custom ? STUDIO_LEVEL : to.level;
    let force = 0;
    if (to.custom) { force = e.level === STUDIO_LEVEL && e.customLevel !== to.custom ? 1 : 0; e.pendingCustom = to.custom; }
    if (level === e.level && (to.area || 1) === e.area && !force) force = 1;
    this.M._studio_warp_fast(level, to.area || 1, node ?? (level === 6 ? 0 : 10), 0, force, intro ? 1 : 2);
  }

  // ---- warps ------------------------------------------------------------------------

  // Nodes taken in an area: pipes' warps, our records, and the reserved ones.
  usedNodes(key) {
    const used = new Set([0x0a, 0xf0, 0xf1, 0xf2, 0xf3, N_STAR, N_DEATH, N_EXIT, 0xef]);
    const a = this.area(key);
    for (const w of a.warps || []) { used.add(w.node); used.add(w.destNode); }
    for (const r of a.objects || []) {
      if (r.warp?.node) used.add(r.warp.node);
      if (r.entry === 'warp_pipe') used.add((r.bparams >>> 16) & 0xff);
    }
    if (key === this.key()) { try { for (const w of this.engine.warps()) used.add(w.id); } catch { /* not loaded */ } }
    return used;
  }
  freeNode(key, extra = []) {
    const used = this.usedNodes(key);
    for (const n of extra) used.add(n);
    for (let n = NODE_MIN; n <= NODE_MAX; n++) if (!used.has(n)) return n;
    throw new Error('no free warp ids left in this area');
  }

  findRecord(uid) {
    for (const [key, a] of Object.entries(this.patch().areas || {})) {
      const r = (a.objects || []).find((x) => x.uid === uid);
      if (r) return { key, rec: r };
    }
    // just added, and the server's copy of the patch (which replaces ours) doesn't have it yet
    const recent = this.recent?.get(uid);
    if (recent && Date.now() - recent.t < 15000) {
      const a = (this.patch().areas[recent.key] ||= { objects: [], removals: [], warps: [] });
      if (!a.objects.includes(recent.rec)) a.objects.push(recent.rec);
      return { key: recent.key, rec: recent.rec };
    }
    return null;
  }

  remember(key, rec) {
    (this.recent ||= new Map()).set(rec.uid, { key, rec, t: Date.now() });
    if (this.recent.size > 200) this.recent.delete(this.recent.keys().next().value);
  }

  hubTarget() {
    const h = this.flow().hub;
    return h ? { ...h, area: h.area || 1 } : null;
  }
  startTarget() {
    const s = this.flow().start;
    return s ? { ...s, area: s.area || 1 } : null;
  }

  // A destination descriptor -> engine warp { destLevel, destArea, destNode, destCustom }.
  resolve(to, fromKey = this.key()) {
    if (!to) return null;
    if (to.hub) {
      const h = this.hubTarget();
      if (!h) return { destLevel: 6, destArea: 1, destNode: 0, destCustom: null };
      return { destLevel: h.custom ? STUDIO_LEVEL : h.level, destArea: h.area, destNode: h.node ?? N_EXIT, destCustom: h.custom || null };
    }
    if (to.start) return this.resolve({ ...this.startTarget(), start: undefined }, fromKey);
    const level = to.custom ? STUDIO_LEVEL : to.level;
    let node = to.node ?? (level === 6 ? 0 : 0x0a);
    if (to.uid) {
      const t = this.findRecord(to.uid);
      if (t?.rec.warp?.node) node = t.rec.warp.node;
      else if (t?.rec.entry === 'warp_pipe') node = (t.rec.bparams >>> 16) & 0xff;
    }
    return { destLevel: level, destArea: to.area || 1, destNode: node, destCustom: to.custom || null };
  }

  // Register this area's warps with the engine (while it loads, or after an edit).
  registerWarps(key = this.key(), live = false) {
    const e = this.engine;
    if (live) this.fixDuplicateNodes(key);
    this.nodeTargets.clear();
    for (const r of this.records(key)) {
      const w = r.warp;
      if (!w?.node) continue;
      const d = w.to ? this.resolve(w.to, key) : null;
      if (d) {
        e.addWarp({ node: w.node, ...d });
        this.nodeTargets.set(w.node, { custom: d.destCustom, to: w.to, uid: r.uid });
      } else {
        // a destination only (arrival points, doors nobody leaves through): it leads to itself
        const here = parseKey(key);
        e.addWarp({ node: w.node, destLevel: here.custom ? STUDIO_LEVEL : here.level, destArea: here.area, destNode: w.node });
      }
    }
    // falling off leads somewhere else (else it costs a life)
    const fall = this.area(key).settings?.env?.fallTo;
    if (fall) {
      const d = this.resolve(fall, key);
      if (d) { e.addWarp({ node: 0xf3, ...d }); this.nodeTargets.set(0xf3, { custom: d.destCustom, to: fall }); }
    }
    this.registerLocks(key);
    if (live) e.relinkWarps();
  }

  // A duplicated door (Ctrl+D) or pasted warp shares its node with the original: the
  // copy gets a node of its own, and leads nowhere until linked (a copy of a link would
  // make two warps claim one destination's way back).
  fixDuplicateNodes(key) {
    const seen = new Set();
    for (const r of this.records(key)) {
      const n = r.warp?.node;
      if (!n) continue;
      if (!seen.has(n)) { seen.add(n); continue; }
      const node = this.freeNode(key, [...seen]);
      seen.add(node);
      const fields = { warp: { ...r.warp, node, to: r.warp.kind === 'arrival' || r.warp.to?.hub ? r.warp.to : null } };
      if (r.bparams !== undefined && (r.entry === 'warp_pipe' || r.bhv === 'bhvDoorWarp' || r.bhv === 'bhvDoor')) fields.bparams = ((r.bparams & 0xff00ffff) | (node << 16)) >>> 0;
      if (r.bhv === 'bhvDoorWarp' && !fields.warp.to) fields.bhv = 'bhvDoor';
      Object.assign(r, fields);
      this.send({ type: 'edit', op: { type: 'update', key, uid: r.uid, fields, summary: 'A copied warp got its own id' } });
      this.engine.deleteUid(r.uid);
      this.engine.spawn(r);
    }
  }

  registerLocks(key = this.key()) {
    const M = this.M;
    M._studio_locks_reset();
    const prog = this.world.progress();
    for (const r of this.records(key)) {
      const w = r.warp;
      if (!w) continue;
      const over = this.lockOverrides.get(r.uid);
      const locked = over !== undefined ? over : !!w.locked;
      const key = Number.isInteger(w.key) && w.key >= 0 && !prog[`door|${r.uid}`] ? w.key : -1;
      const stars = w.stars | 0;
      if (locked || key >= 0 || stars > 0) M._studio_lock_set(r.uid >>> 0, stars, key, locked ? 1 : 0);
    }
  }

  // The engine is about to warp: through which node, and to where? Custom destinations
  // pick the level the slot shows; deaths, stars and exits go to the hub.
  onWarp(src, level, area, node, exitCourse) {
    const e = this.engine;
    if (src === 0xef && !exitCourse) return; // the studio's own jumps already know
    const M = this.M;
    const hub = this.hubTarget();
    const atHub = hub && this.sameLevel(hub, this.here());
    const t = !exitCourse ? this.nodeTargets.get(src) : null;
    const redirect = (to, n, intro = -1) => {
      const d = this.resolve(to);
      let force = 0;
      if (d.destCustom) {
        force = e.level === STUDIO_LEVEL && (e.customLevel !== d.destCustom) ? 1 : 0;
        e.pendingCustom = d.destCustom;
      }
      M._studio_warp_redirect(d.destLevel, d.destArea, n ?? d.destNode, force, intro);
    };
    if (t) {
      // leaving the hub through an entrance: come back out of it later
      if (atHub && t.uid) {
        const r = this.records().find((x) => x.uid === t.uid);
        if (r) this.returnTo = { key: this.key(), x: r.x, y: r.y, z: r.z, yaw: r.yaw | 0 };
      }
      const toHub = hub && t.to && this.sameLevel(hub, t.to);
      if (t.custom) {
        const force = e.level === STUDIO_LEVEL && e.customLevel !== t.custom ? 1 : 0;
        e.pendingCustom = t.custom;
        M._studio_warp_redirect(level, area, node, force, toHub ? 2 : -1);
      } else if (toHub) M._studio_warp_redirect(level, area, node, 0, 2);
      return;
    }
    // courses: back to the hub (stars, deaths, falling, Exit Course)
    // (dying in the hub itself also stays in the hack: back to the hub's start)
    if (hub && (exitCourse || src === 0xf0 || src === 0xf1 || src === 0xf3)) {
      const n = exitCourse ? N_EXIT : src === 0xf0 ? N_STAR : N_DEATH;
      redirect({ ...hub }, n, 2);
      return;
    }
    // a custom level without a hub: deaths go to the castle (the level script), nothing to do
  }

  sameLevel(a, b) {
    if (!a || !b) return false;
    if (a.custom || b.custom) return a.custom === b.custom;
    return a.level === b.level;
  }

  // ---- loading an area ------------------------------------------------------------

  onAreaLoad(level, area, key) {
    const e = this.engine;
    const a = this.area(key);
    const custom = level === STUDIO_LEVEL;
    const s = a.settings || {};
    this.building = !!this.editor?.active;
    this.applyEnv(s.env || {}, custom);
    this.uploadPictures();
    // pictures of paintings not decoded yet (right after a page load): decode, then repaint
    if (Object.keys(this.flow().pictures || {}).some((id) => !this.pictureCache.has(id))) this.onPatch();
    this.registerWarps(key);
    this.pushKeys();
    // the hub: castle-like pause, and the points Mario returns to from the courses
    const hub = this.hubTarget();
    const isHub = hub && this.sameLevel(hub, custom ? { custom: e.customLevel } : { level });
    this.M._studio_set_hub(isHub && custom ? 1 : 0);
    if (isHub && (hub.area || 1) === area) this.placeHubReturns(key, s);
    this.zonesPending = true;
    setTimeout(() => this.emit(), 0);
  }

  // Return points in the hub: in front of the entrance Mario left through, else the spawn.
  placeHubReturns(key, s) {
    const e = this.engine;
    let p = null;
    if (this.returnTo?.key === key) {
      const yaw = this.returnTo.yaw;
      const a = (yaw / 32768) * Math.PI;
      p = { x: this.returnTo.x + Math.sin(a) * 260, y: this.returnTo.y + 120, z: this.returnTo.z + Math.cos(a) * 260, yaw };
      this.returnTo = null; // used once: dying in the hub later starts at its spawn
    } else if (s.spawn) p = { x: s.spawn.x, y: s.spawn.y, z: s.spawn.z, yaw: s.spawn.yaw || 0 };
    else p = { x: 0, y: 600, z: 0, yaw: 0 };
    const here = parseKey(key);
    const lvl = here.custom ? STUDIO_LEVEL : here.level;
    const helpers = [[N_STAR, 'bhvAirborneStarCollectWarp'], [N_DEATH, 'bhvAirborneDeathWarp'], [N_EXIT, 'bhvAirborneWarp']];
    helpers.forEach(([node, bhv], i) => {
      e.addWarp({ node, destLevel: lvl, destArea: here.area, destNode: node });
      e._spawnBase({ uid: HELPER_UID + 0x100 + i, bhv, x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), yaw: p.yaw, bparams: (node << 16) >>> 0 });
    });
  }

  // Fog, light, weather, death height, camera, ambient sound, water and gas.
  applyEnv(env, custom) {
    const M = this.M;
    const fog = env.fog || {};
    M._studio_env_fog(fog.on ? 1 : 0, hex(fog.color, 0xb8c8e0), fog.near ?? 1500, fog.far ?? 9000);
    const light = env.light || {};
    M._studio_env_tint(light.tint && hex(light.tint) !== 0xffffff ? 1 : 0, hex(light.tint));
    M._studio_env_light(light.yaw ?? 45, light.pitch ?? 57, hex(light.color), light.ambient ?? 0.42);
    M._studio_env_weather(WEATHER.indexOf(env.weather) >= 0 ? WEATHER.indexOf(env.weather) : (custom ? 0 : -1));
    M._studio_env_death(Number.isFinite(env.deathY) ? env.deathY : -40000);
    const cam = env.camera || {};
    const mode = Math.max(0, CAMERA_MODES.indexOf(cam.mode || 'default'));
    M._studio_env_camera(mode, cam.mode === 'side' ? Math.round(((cam.axis ?? 0) / 360) * 65536) : (cam.x ?? 0), cam.y ?? 0, cam.z ?? 0, cam.dist ?? 0);
    const amb = AMBIENT[env.ambient];
    M._studio_env_ambient(amb ? amb.bits >>> 0 : 0, amb ? amb.every : 0);
  }

  // Re-apply after an edit of this area's environment (no reload).
  reapplyEnv() {
    const custom = this.engine.level === STUDIO_LEVEL;
    this.applyEnv(this.area().settings?.env || {}, custom);
    if (custom && this.world.terrain) this.engine.terrainBuild(1, 0, 0, -1, -1, false);
    this.registerWarps(this.key(), true); // "falling leads to" is a warp node
    this.pushZones();
  }

  // ---- zones (block records with a `zone`) -----------------------------------------

  isZone(r) { return !!r?.zone && !!r.block; }

  // Zones: translucent boxes you can pick in build mode; while playing, what they make.
  spawnFilter(r) {
    if (r.painting || r.bhv === 'bhvStudioPainting') {
      const pic = this.pictureIndex(r.painting?.picture);
      const rec = { ...r, bhv: 'bhvStudioPainting', model: null, bparams: (((pic & 0xff) << 24) | (((r.warp?.node || 0) & 0xff) << 16)) >>> 0 };
      const slot = this.engine._spawnBase(rec);
      if (slot >= 0) this.M._studio_painting_setup(slot);
      return slot;
    }
    if (!this.isZone(r)) return undefined;
    const z = r.zone;
    const info = ZONES[z.kind] || ZONES.warp;
    const b = r.block;
    if (this.building && this.flow().hideZones !== true) {
      return this.engine._spawnBase({ ...r, block: { ...b, shape: 0, top: material('water'), side: material('water'), surface: 0, flags: 4, color: info.color } });
    }
    // playing
    if (z.kind === 'arrival') {
      return this.engine._spawnBase({ uid: r.uid, bhv: ARRIVALS[z.spawn] || ARRIVALS.walk, x: r.x, y: r.y, z: r.z, yaw: r.yaw | 0, bparams: ((r.warp?.node || 0) << 16) >>> 0 });
    }
    if (z.kind === 'water') {
      return this.engine._spawnBase({ ...r, y: r.y + b.sy - 4, block: { shape: 0, sx: b.sx, sy: 4, sz: b.sz, top: material('water'), side: material('water'), surface: 0, flags: 2 | 4, color: 0x9fd0ff, steps: 0 } });
    }
    if (z.kind === 'gas') {
      return this.engine._spawnBase({ ...r, block: { shape: 0, sx: b.sx, sy: b.sy, sz: b.sz, top: material('water'), side: material('water'), surface: 0, flags: 2 | 4, color: 0xd8f070, steps: 0 } });
    }
    if (z.kind === 'lava') {
      return this.engine._spawnBase({ ...r, y: r.y + b.sy - 20, block: { shape: 0, sx: b.sx, sy: 20, sz: b.sz, top: material('lava'), side: material('lava'), surface: 0x0001, flags: 0, color: 0xffffff, steps: 0 } });
    }
    if (z.kind === 'quicksand') {
      return this.engine._spawnBase({ ...r, y: r.y + b.sy - 20, block: { shape: 0, sx: b.sx, sy: 20, sz: b.sz, top: material('sand'), side: material('sand'), surface: z.deep ? 0x0022 : 0x0026, flags: 0, color: 0xe8c890, steps: 0 } });
    }
    // warp, exit, death, camera: invisible while playing (flow.c watches the box)
    return this.engine._spawnBase({ ...r, block: { ...b, flags: 1 | 2 } });
  }

  // Zones of this area to the engine (after Mario arrived: being inside one at the
  // start doesn't set it off).
  pushZones() {
    const M = this.M;
    M._studio_zones_reset();
    M._studio_env_boxes_reset();
    for (const r of this.records()) {
      if (!this.isZone(r)) continue;
      const z = r.zone, b = r.block;
      const cy = r.y + b.sy / 2;
      const hx = b.sx / 2, hy = b.sy / 2, hz = b.sz / 2;
      if (z.kind === 'warp' || z.kind === 'exit') {
        const tr = TRANSITIONS[z.transition] ?? 0;
        let off = [0, 0, 0];
        if (tr === 3 && r.warp?.to?.uid) {
          const t = this.findRecord(r.warp.to.uid);
          if (t && t.key === this.key()) off = [t.rec.x - r.x, t.rec.y - r.y + 20, t.rec.z - r.z];
        }
        const node = r.warp?.node || 0;
        if (!node) continue;
        M._studio_zone_add(1, r.uid >>> 0, r.x, cy, r.z, hx, hy, hz, r.yaw | 0, node, tr === 3 && !(off[0] || off[1] || off[2]) ? 0 : tr, off[0], off[1], off[2]);
      } else if (z.kind === 'death') {
        M._studio_zone_add(2, r.uid >>> 0, r.x, cy, r.z, hx, hy, hz, r.yaw | 0, 0, 0, 0, 0, 0);
      } else if (z.kind === 'camera') {
        const mode = Math.max(0, CAMERA_MODES.indexOf(z.mode || 'close'));
        const px = z.mode === 'side' ? Math.round(((z.axis ?? 0) / 360) * 65536) : (z.x ?? r.x);
        M._studio_zone_add(3, r.uid >>> 0, r.x, cy, r.z, hx, hy, hz, r.yaw | 0, mode, Math.round(z.dist ?? 1400), px, z.y ?? r.y + b.sy, z.z ?? r.z);
      } else if (z.kind === 'water' || z.kind === 'gas') {
        // environment boxes are axis-aligned: the box's footprint
        const a = ((r.yaw | 0) / 32768) * Math.PI, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
        const ex = hx * c + hz * s, ez = hx * s + hz * c;
        M._studio_env_box(z.kind === 'gas' ? 1 : 0, Math.round(r.x - ex), Math.round(r.z - ez), Math.round(r.x + ex), Math.round(r.z + ez), Math.round(r.y + b.sy));
      }
    }
    M._studio_env_boxes_apply();
    this.lastZoneSig = this.zoneSig();
  }

  zoneSig() {
    return JSON.stringify(this.records().filter((r) => r.zone || r.warp).map((r) => [r.uid, r.x, r.y, r.z, r.yaw, r.block?.sx, r.block?.sy, r.block?.sz, r.zone, r.warp]));
  }

  // Build mode on/off: zones change how they look; the area's warps follow edits.
  onFrame() {
    const e = this.engine;
    const building = !!this.editor?.active;
    if (building !== this.building) {
      this.building = building;
      this.respawnZones();
    }
    if (this.zonesPending) {
      let m = null;
      try { m = e.state().mario; } catch { /* loading */ }
      if (m && !e.inIntro) { this.zonesPending = false; this.pushZones(); }
    } else if ((this.frameN = (this.frameN || 0) + 1) % 20 === 0) {
      const sig = this.zoneSig();
      if (sig !== this.lastZoneSig) { this.registerWarps(this.key(), true); this.pushZones(); this.emit(); }
      this.checkGoal();
    }
  }

  respawnZones() {
    for (const r of this.records()) {
      if (!this.isZone(r)) continue;
      this.engine.deleteUid(r.uid);
      this.engine.spawn(r);
    }
    this.editor?.refreshSelection?.();
  }

  // ---- paintings' pictures -----------------------------------------------------------

  pictureIndex(id) {
    const builtin = PICTURES.findIndex((p) => p.id === id);
    if (builtin >= 0) return builtin;
    const slot = this.pictureSlots.get(id);
    return slot !== undefined ? 0x40 + slot : 0;
  }

  // Images for paintings: 128x128, kept decoded so areas can load synchronously.
  async decodePictures() {
    const pics = this.flow().pictures || {};
    for (const [id, p] of Object.entries(pics)) {
      if (this.pictureCache.has(id) || !p?.data) continue;
      try { this.pictureCache.set(id, await imageToRgba16(p.data, 128, 128)); } catch (err) { console.warn('picture', id, err); }
    }
  }

  uploadPictures() {
    const M = this.M;
    for (const [id, px] of this.pictureCache) {
      let slot = this.pictureSlots.get(id);
      if (slot === undefined) { slot = this.pictureSlots.size; if (slot >= 24) continue; this.pictureSlots.set(id, slot); }
      const ptr = M._studio_painting_image(slot);
      if (ptr) new Uint16Array(M.HEAPU8.buffer, ptr, 128 * 128).set(px);
    }
  }

  async onPatch() {
    // the server has these now
    for (const [uid, r] of this.recent || []) {
      if ((this.patch().areas?.[r.key]?.objects || []).some((x) => x.uid === uid) || Date.now() - r.t > 15000) this.recent.delete(uid);
    }
    await this.decodePictures();
    this.refreshPaintings();
  }

  // Paintings showing another picture than theirs (their picture was still decoding when the
  // area loaded, e.g. right after a page load) are spawned again with it.
  refreshPaintings() {
    if (!this.engine.ready || !this.pictureCache.size) return;
    this.uploadPictures();
    let objs;
    try { objs = this.engine.objects(); } catch { return; }
    for (const r of this.records()) {
      if (!r.painting) continue;
      const o = objs.find((x) => x.uid === r.uid);
      if (o && (o.bparams >>> 24) !== this.pictureIndex(r.painting.picture)) { this.engine.deleteUid(r.uid); this.engine.spawn(r); }
    }
  }

  // ---- keys, locks, goal -------------------------------------------------------------

  keysMask() {
    const p = this.world.progress();
    let m = 0;
    for (let k = 0; k < 31; k++) if (p[`key|${k}`]) m |= 1 << k;
    return m >>> 0;
  }
  pushKeys() { if (this.engine.ready) this.M._studio_set_keys(this.keysMask()); }

  setProgress(id) {
    const p = this.world.progress();
    p[id] = Date.now();
    try { localStorage.setItem(this.world.progressKey(), JSON.stringify(p)); } catch { /* private mode */ }
  }

  onKey(k, uid) {
    this.setProgress(`key|${k}`);
    const rec = this.findRecord(uid)?.rec;
    this.toast(`🔑 ${rec?.key?.name || `Key ${k + 1}`} collected`, 'sparkles');
    this.emit();
  }

  onUnlocked(uid) {
    this.setProgress(`door|${uid}`);
    this.toast('Unlocked!', 'check');
  }

  // Events (dialogs, cutscenes) lock and unlock doors and warps by uid. `persist`
  // saves it in the project as the door's state; otherwise it lasts until reload.
  setLocked(uid, locked, { persist = false } = {}) {
    const found = this.findRecord(uid);
    if (!found?.rec.warp) return false;
    this.lockOverrides.set(uid, !!locked);
    if (persist) {
      found.rec.warp = { ...found.rec.warp, locked: !!locked };
      this.send({ type: 'edit', op: { type: 'update', key: found.key, uid, fields: { warp: found.rec.warp }, summary: locked ? 'Locked a door' : 'Unlocked a door' } });
    }
    if (found.key === this.key()) this.registerLocks();
    return true;
  }
  isLocked(uid) {
    const found = this.findRecord(uid);
    if (!found?.rec.warp) return null;
    const over = this.lockOverrides.get(uid);
    return over !== undefined ? over : !!found.rec.warp.locked;
  }

  checkGoal() {
    const g = this.flow().goal;
    if (!g?.stars || this.goalShown) return;
    let stars = 0;
    try { stars = this.engine.state().mario?.stars || 0; } catch { return; }
    if (stars < g.stars) return;
    const p = this.world.progress();
    this.goalShown = true;
    if (p.goal) return;
    this.setProgress('goal');
    const text = plain(g.message || `Congratulations!\nYou collected ${g.stars} Stars\nand finished the hack!`);
    this.M.ccall('studio_show_message', null, ['string'], [text]);
    this.toast(`🏆 Goal reached: ${g.stars} stars!`, 'sparkles');
  }

  // ---- saving flow and areas ---------------------------------------------------------

  setFlow(fields) {
    const w = { ...this.flow(), ...fields };
    for (const k of Object.keys(fields)) if (fields[k] === null) delete w[k];
    this.patch().world = w;
    this.send({ type: 'world_set', world: w });
    this.goalShown = false;
    this.emit();
    return w;
  }

  // The area's environment (saved with its settings).
  setEnv(fields, summary = 'Changed the environment') {
    const s = this.world.settings();
    const env = { ...(s.env || {}), ...fields };
    for (const k of Object.keys(fields)) if (fields[k] === null) delete env[k];
    this.world.setSettings({ env }, summary);
    this.reapplyEnv();
    return env;
  }

  createArea(levelId, { name, template = 'room', area: given } = {}) {
    const area = given || makeAreaTemplate(template) || World.newLevelArea(template);
    const req = Math.random().toString(36).slice(2, 8);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pendingArea = null; reject(new Error('the server did not answer')); }, 8000);
      this.pendingArea = { req, resolve: (m) => { clearTimeout(t); resolve(m); } };
      this.send({ type: 'area_create', level: levelId, name, area, req });
    });
  }
  onAreaCreated(msg) {
    if (this.pendingArea?.req === msg.req) { this.pendingArea.resolve(msg); this.pendingArea = null; }
  }
  renameArea(levelId, index, name) { this.send({ type: 'area_rename', level: levelId, index, name }); }
  deleteArea(levelId, index) { this.send({ type: 'area_delete', level: levelId, index }); }

  // ---- making warps (shared by the editor UI and Claude's tools) ----------------------

  // A warp record ready to place: kind door | pipe | painting | zone | arrival | exit | death | camera | water ...
  makeWarpRecord(kind, { x, y, z, yaw = 0, style, picture, to, stars, key, locked, size, mode, spawn, transition, name } = {}) {
    const k = this.key();
    const uid = randUid();
    const base = { uid, x: Math.round(x), y: Math.round(y), z: Math.round(z), yaw: yaw & 0xffff, pitch: 0, roll: 0 };
    const lock = {};
    if (stars) lock.stars = stars | 0;
    if (Number.isInteger(key) && key >= 0) lock.key = key;
    if (locked) lock.locked = true;
    if (kind === 'door') {
      const st = DOOR_STYLES.find((d) => d.id === style) || (key >= 0 ? DOOR_STYLES.find((d) => d.id === 'key') : stars ? DOOR_STYLES.find((d) => d.id === (stars === 1 ? 'star1' : stars === 3 ? 'star3' : 'star')) : DOOR_STYLES[0]);
      const node = this.freeNode(k);
      return { ...base, bhv: to ? 'bhvDoorWarp' : 'bhvDoor', model: st.model, bparams: (node << 16) >>> 0, scale: 1, name: name || st.label, warp: { kind: 'door', style: st.id, node, to: to || null, ...lock } };
    }
    if (kind === 'pipe') {
      const node = this.freeNode(k);
      return { ...base, entry: 'warp_pipe', bparams: (node << 16) >>> 0, scale: 1, name: name || 'Warp pipe', warp: { kind: 'pipe', node, to: to || null, ...lock } };
    }
    if (kind === 'painting') {
      const node = this.freeNode(k);
      return { ...base, bhv: 'bhvStudioPainting', model: null, bparams: 0, scale: size ? size / 600 : 1, name: name || 'Painting', painting: { picture: picture || 'bob' }, warp: { kind: 'painting', node, to: to || null, ...lock } };
    }
    if (kind === 'key') {
      const used = new Set(Object.values(this.patch().areas || {}).flatMap((a) => (a.objects || []).filter((r) => r.keyItem).map((r) => r.keyItem.index)));
      let index = Number.isInteger(key) ? key : 0;
      while (!Number.isInteger(key) && used.has(index)) index++;
      return { ...base, y: base.y + 60, bhv: 'bhvStudioKey', model: 'prop:bowser_key', bparams: (index << 24) >>> 0, scale: 0.5, name: name || `Key ${index + 1}`, keyItem: { index, name: name || `Key ${index + 1}` } };
    }
    if (kind === 'cannon') return { ...base, entry: 'cannon', bparams: 0, scale: 1, name: name || 'Cannon' };
    // zones
    const zk = kind === 'zone' ? 'warp' : kind;
    const info = ZONES[zk];
    if (!info) throw new Error(`unknown warp kind ${kind}`);
    const def = { warp: [300, 300, 300], arrival: [160, 200, 160], exit: [300, 300, 300], death: [3000, 300, 3000], camera: [1200, 800, 1200], water: [1200, 400, 1200], gas: [1200, 400, 1200], lava: [1200, 200, 1200], quicksand: [1000, 200, 1000] }[zk];
    const [sx, sy, sz] = Array.isArray(size) ? size : def;
    const rec = { ...base, block: { shape: 0, sx, sy, sz, top: material('water'), side: material('water'), surface: 0, flags: 4, color: info.color, steps: 0 }, name: name || info.label, zone: { kind: zk } };
    if (zk === 'warp' || zk === 'exit' || zk === 'arrival') rec.warp = { kind: zk === 'arrival' ? 'arrival' : 'zone', node: this.freeNode(k), to: zk === 'exit' ? { hub: true } : (to || null), ...lock };
    if (zk === 'warp') rec.zone.transition = transition || 'fade';
    if (zk === 'arrival') rec.zone.spawn = spawn || 'walk';
    if (zk === 'camera') rec.zone.mode = mode || 'close';
    return rec;
  }

  // Link `rec` (in area fromKey) to a destination; two-way when the target is a door,
  // pipe or arrival (the target then leads back to rec).
  link(fromKey, uid, to, { twoWay = true } = {}) {
    const found = this.findRecord(uid);
    const rec = found?.rec;
    if (found) fromKey = found.key;
    if (!rec?.warp) throw new Error('that object is not a warp');
    const changes = [];
    const fields = { warp: { ...rec.warp, to } };
    if (rec.warp.kind === 'door' && rec.bhv === 'bhvDoor') { fields.bhv = 'bhvDoorWarp'; }
    changes.push({ key: fromKey, uid, fields });
    if (twoWay && to?.uid) {
      const t = this.findRecord(to.uid);
      if (t?.rec.warp && ['door', 'pipe'].includes(t.rec.warp.kind) && ['door', 'pipe'].includes(rec.warp.kind)) {
        const back = { ...parseKey(fromKey), uid };
        const tf = { warp: { ...t.rec.warp, to: back } };
        if (t.rec.bhv === 'bhvDoor') tf.bhv = 'bhvDoorWarp';
        changes.push({ key: t.key, uid: to.uid, fields: tf });
      }
    } else if (to?.uid) {
      // one way into a plain door: it must be a warp door to be arrived at (it then leads to itself)
      const t = this.findRecord(to.uid);
      if (t?.rec.warp?.kind === 'door' && t.rec.bhv === 'bhvDoor') changes.push({ key: t.key, uid: to.uid, fields: { bhv: 'bhvDoorWarp' } });
    }
    for (const c of changes) this.updateRecord(c.key, c.uid, c.fields, `Linked ${rec.name || 'a warp'} to ${this.areaName(to.hub ? (this.hubTarget() || { level: 6 }) : to)}`);
    return changes;
  }

  updateRecord(key, uid, fields, summary) {
    const found = this.findRecord(uid);
    const rec = found?.rec;
    if (!rec) return;
    key = found.key;
    Object.assign(rec, fields);
    this.send({ type: 'edit', op: { type: 'update', key, uid, fields, summary } });
    if (key === this.key()) {
      this.engine.deleteUid(uid);
      this.engine.spawn(rec);
      this.registerWarps(key, true);
      this.pushZones();
      this.editor?.refreshSelection?.();
    }
    this.emit();
  }

  // Place a record in the current area (live + saved).
  addRecord(rec, summary) {
    const key = this.key();
    const a = (this.patch().areas[key] ||= { objects: [], removals: [], warps: [] });
    a.objects.push(rec);
    this.remember(key, rec);
    this.engine.spawn(rec);
    this.send({ type: 'edit', op: { type: 'add', key, summary: summary || `Placed ${rec.name}`, records: [rec] } });
    this.registerWarps(key, true);
    this.pushZones();
    this.emit();
    return rec;
  }

  // Save a record in another area (it appears when that area loads).
  addRecordIn(key, rec, summary) {
    if (key === this.key()) return this.addRecord(rec, summary);
    const a = (this.patch().areas[key] ||= { objects: [], removals: [], warps: [] });
    a.objects.push(rec);
    this.remember(key, rec);
    this.send({ type: 'edit', op: { type: 'add', key, summary: summary || `Placed ${rec.name}`, records: [rec] } });
    this.emit();
    return rec;
  }

  // Every warp of the project, for the map and Claude: [{ key, uid, name, kind, to, from }]
  allWarps() {
    const out = [];
    for (const [key, a] of Object.entries(this.patch().areas || {})) {
      for (const r of this.records(key)) {
        if (!r.warp) continue;
        out.push({ key, uid: r.uid, name: r.name, kind: r.warp.kind, node: r.warp.node, to: r.warp.to || null, stars: r.warp.stars || 0, key_needed: r.warp.key ?? null, locked: !!r.warp.locked, x: r.x, y: r.y, z: r.z });
      }
      for (const w of a.warps || []) {
        // pipes from the chat's create_pipe
        if (w.destLevel !== undefined && !(a.objects || []).some((r) => r.warp?.node === w.node)) {
          out.push({ key, uid: null, name: 'Warp pipe', kind: 'pipe', node: w.node, to: { level: w.destLevel, area: w.destArea, node: w.destNode } });
        }
      }
    }
    return out;
  }

  // Map of the hack: nodes = areas (levels with their sub-areas), edges = warps.
  graph() {
    const nodes = [];
    const seen = new Set();
    const add = (key, extra = {}) => {
      if (seen.has(key)) return;
      seen.add(key);
      const pk = parseKey(key);
      nodes.push({ key, ...pk, name: this.areaName(pk), ...extra });
    };
    for (const l of this.getLevels()) for (const a of this.areasOf(l.id)) add(areaKeyOf({ custom: l.id, area: a.index }), { custom: l.id, levelName: l.name, areaName: a.name });
    const edges = [];
    for (const w of this.allWarps()) {
      add(w.key);
      let toKey = null;
      if (w.to?.hub) { const h = this.hubTarget(); toKey = h ? areaKeyOf(h) : '6:1'; } else if (w.to) toKey = areaKeyOf(w.to);
      if (toKey) { add(toKey); edges.push({ from: w.key, to: toKey, kind: w.kind, name: w.name, uid: w.uid, stars: w.stars, locked: w.locked, key_needed: w.key_needed }); }
    }
    const f = this.flow();
    if (f.start) add(areaKeyOf(f.start));
    if (f.hub) add(areaKeyOf(f.hub));
    return { nodes, edges, start: f.start ? areaKeyOf(f.start) : null, hub: f.hub ? areaKeyOf(f.hub) : null };
  }

  // ---- browser side of Claude's world tools -----------------------------------------

  registerRpcs() {
    const flow = this;
    registerRpc('world_state', function () { return flow.describe(); });
    registerRpc('world_goto_area', async function (p) {
      flow.goArea(p);
      await this.engine.waitArrival(p.custom ? STUDIO_LEVEL : p.level, 20000);
      return { ok: true, key: flow.key() };
    });
    registerRpc('world_place', function (p) {
      const pt = p.at ? p.at : this.points(p.where || { distance: 300 }, 1)[0];
      let yaw = p.yaw_deg !== undefined ? Math.round((p.yaw_deg / 360) * 65536) & 0xffff : null;
      if (yaw === null) {
        // face Mario
        const m = this.mario().mario;
        yaw = Math.round((Math.atan2(m.x - pt.x, m.z - pt.z) / Math.PI) * 32768) & 0xffff;
      }
      const rec = flow.makeWarpRecord(p.kind, { ...p, x: pt.x, y: (pt.y ?? 0) + (p.raise || 0), z: pt.z, yaw, size: p.size });
      flow.addRecord(rec, p.summary);
      return { key: flow.key(), uid: rec.uid, name: rec.name, node: rec.warp?.node, x: rec.x, y: rec.y, z: rec.z };
    });
    registerRpc('world_link', function (p) { return { changes: flow.link(p.from_key || flow.key(), p.uid, p.to, { twoWay: p.two_way !== false }).length }; });
    registerRpc('world_update', function (p) {
      const f = flow.findRecord(p.uid);
      if (!f) throw new Error(`no object with uid ${p.uid}`);
      const fields = {};
      if (p.warp) fields.warp = { ...(f.rec.warp || {}), ...p.warp };
      if (p.zone) fields.zone = { ...(f.rec.zone || {}), ...p.zone };
      if (p.painting) fields.painting = { ...(f.rec.painting || {}), ...p.painting };
      if (p.style && f.rec.warp?.kind === 'door') {
        const st = DOOR_STYLES.find((d) => d.id === p.style);
        if (st) { fields.model = st.model; fields.warp = { ...(fields.warp || f.rec.warp), style: st.id }; }
      }
      if (fields.zone?.kind && ZONES[fields.zone.kind] && f.rec.block) fields.block = { ...f.rec.block, color: ZONES[fields.zone.kind].color };
      flow.updateRecord(f.key, p.uid, fields, p.summary || `Changed ${f.rec.name}`);
      return { ok: true, record: { uid: p.uid, name: f.rec.name, warp: f.rec.warp, zone: f.rec.zone, painting: f.rec.painting } };
    });
    // Claude's destinations: here / another level or area / a spot there (arrival point) / a warp (uid) / the hub
    registerRpc('world_link_to', function (p) {
      const f = flow.findRecord(p.uid);
      if (!f?.rec.warp) throw new Error(`uid ${p.uid} is not a door, pipe, painting or warp zone`);
      const to = { ...(p.to || {}) };
      if (to.here) { Object.assign(to, flow.here()); to.area = p.to.area ?? flow.here().area; }
      if (to.areaName) {
        const a = to.custom && flow.areasOf(to.custom).find((x) => x.name.toLowerCase().includes(to.areaName.toLowerCase()));
        if (!a) throw new Error(`no area "${to.areaName}" in this level`);
        to.area = a.index;
      }
      delete to.here;
      delete to.areaName;
      if (to.hub) return { changes: flow.link(f.key, p.uid, { hub: true }, { twoWay: false }).length, to: 'the hub' };
      if (to.at && !to.uid) {
        const key = areaKeyOf(to);
        let y = to.at.y;
        if (key === flow.key() && y === undefined) { const fy = this.engine.floor(to.at.x, 20000, to.at.z); y = fy > -30000 ? fy : 0; }
        const rec = flow.makeWarpRecord('arrival', { x: to.at.x, y: y ?? 800, z: to.at.z, yaw: 0, spawn: y === undefined ? 'spin' : 'walk' });
        rec.warp.node = flow.freeNode(key);
        rec.name = `Arrival from ${flow.areaName(parseKey(f.key))}`;
        if (key === flow.key()) flow.addRecord(rec, 'Placed an arrival point');
        else flow.addRecordIn(key, rec, 'Placed an arrival point');
        to.uid = rec.uid;
      }
      delete to.at;
      const clean = to.custom ? { custom: to.custom, area: to.area || 1, uid: to.uid } : { level: to.level, area: to.area || 1, uid: to.uid };
      if (!clean.uid) delete clean.uid;
      const n = flow.link(f.key, p.uid, clean, { twoWay: p.two_way !== false }).length;
      return { changes: n, to: flow.destName ? flow.destName(clean) : flow.areaName(clean), two_way: n > 1 };
    });
    registerRpc('world_env', function (p) { return { env: flow.setEnv(p.env || {}, p.summary) }; });
    registerRpc('world_flow', function (p) { return { world: flow.setFlow(p.world || {}) }; });
    registerRpc('world_area_create', async function (p) {
      const level = p.level || this.engine.customLevel;
      if (!level || !flow.levelOf(level)) throw new Error('areas belong to custom levels: go to one first or give level');
      const m = p.door && flow.ui ? await flow.ui.createArea(level, p.name || 'New area', p.template || 'room', true) : await flow.createArea(level, { name: p.name, template: p.template });
      if (p.go !== false) { flow.goArea({ custom: level, area: m.index }); await this.engine.waitArrival(STUDIO_LEVEL, 20000); }
      return { level, index: m.index, name: m.name, key: areaKeyOf({ custom: level, area: m.index }) };
    });
    registerRpc('door_lock', function (p) { return { ok: flow.setLocked(p.uid, p.locked !== false, { persist: !!p.persist }) }; });
    registerRpc('world_map', function () { return flow.graph(); });
  }

  // What Claude needs to know about the structure.
  describe() {
    const levels = this.getLevels().map((l) => ({ id: l.id, name: l.name, areas: this.areasOf(l.id).map((a) => ({ index: a.index, name: a.name, key: areaKeyOf({ custom: l.id, area: a.index }) })) }));
    const here = this.here();
    return {
      here: { ...here, key: this.key(), name: this.areaName(here) },
      levels, flow: { start: this.flow().start || null, hub: this.flow().hub || null, goal: this.flow().goal || null },
      env_here: this.area().settings?.env || {},
      warps: this.allWarps().map((w) => ({ ...w, to_name: w.to ? (w.to.hub ? 'the hub' : this.areaName(w.to)) : null })),
    };
  }
}

// ---- area templates ----------------------------------------------------------------

// A new sub-area: a room (walls, floor, ceiling of blocks), a cave, or an open area.
export function makeAreaTemplate(template = 'room') {
  const B = (x, y, z, sx, sy, sz, top, side = top, extra = {}) => ({ uid: randUid(), block: { shape: 0, sx, sy, sz, top: material(top), side: material(side), surface: 0, flags: 0, color: 0xffffff, steps: 0, ...extra }, x, y, z, yaw: 0, pitch: 0, roll: 0, name: `${top} block` });
  const base = { objects: [], removals: [], warps: [] };
  if (template === 'room' || template === 'castle_room' || template === 'house') {
    const W = template === 'house' ? 1400 : 2400, D = template === 'house' ? 1400 : 2400, H = template === 'house' ? 700 : 1000;
    const floor = template === 'castle_room' ? 'checker' : template === 'house' ? 'wood floor' : 'wood floor';
    const wall = template === 'castle_room' ? 'castle stone' : template === 'house' ? 'wood planks' : 'grey brick';
    base.objects.push(B(0, -60, 0, W, 60, D, floor, floor));
    base.objects.push(B(0, H, 0, W, 60, D, wall, wall));
    base.objects.push(B(0, 0, -D / 2 - 30, W + 120, H, 60, wall));
    base.objects.push(B(0, 0, D / 2 + 30, W + 120, H, 60, wall));
    base.objects.push(B(-W / 2 - 30, 0, 0, 60, H, D, wall));
    base.objects.push(B(W / 2 + 30, 0, 0, 60, H, D, wall));
    base.settings = { sky: 6, music: 4, spawn: { x: 0, y: 150, z: D / 2 - 400, yaw: 0x8000 }, env: { camera: { mode: 'close' }, light: { ambient: 0.55 } } };
    return base;
  }
  if (template === 'cave') {
    const W = 3600, D = 3600, H = 1200;
    base.objects.push(B(0, -100, 0, W, 100, D, 'rock', 'rock'));
    base.objects.push(B(0, H, 0, W, 200, D, 'rock', 'rock'));
    base.objects.push(B(0, 0, -D / 2 - 100, W + 400, H, 200, 'rock'));
    base.objects.push(B(0, 0, D / 2 + 100, W + 400, H, 200, 'rock'));
    base.objects.push(B(-W / 2 - 100, 0, 0, 200, H, D, 'rock'));
    base.objects.push(B(W / 2 + 100, 0, 0, 200, H, D, 'rock'));
    base.objects.push(B(-700, 0, -500, 500, 420, 600, 'rock'));
    base.objects.push(B(900, 0, 700, 700, 260, 500, 'rock'));
    base.settings = { sky: 6, music: 12, spawn: { x: 0, y: 150, z: D / 2 - 500, yaw: 0x8000 }, env: { fog: { on: true, color: '#141820', near: 600, far: 4200 }, light: { tint: '#9aa8c8', ambient: 0.35 }, ambient: 'drone', camera: { mode: 'close' } } };
    return base;
  }
  if (template === 'void') {
    base.objects.push(B(0, -60, 0, 1000, 60, 1000, 'checker', 'checker'));
    base.settings = { sky: 8, music: 4, spawn: { x: 0, y: 150, z: 0, yaw: 0 } };
    return base;
  }
  return null; // a level template: the caller makes it (World.newLevelArea)
}

// A data URL image -> w*h RGBA16 (the N64 texture format, big-endian 5551 like the game's).
export async function imageToRgba16(url, w, h) {
  const img = await new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = url; });
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const s = Math.max(w / img.width, h / img.height);
  g.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
  const d = g.getImageData(0, 0, w, h).data;
  const out = new Uint16Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const v = ((d[i * 4] >> 3) << 11) | ((d[i * 4 + 1] >> 3) << 6) | ((d[i * 4 + 2] >> 3) << 1) | 1;
    out[i] = ((v & 0xff) << 8) | (v >> 8); // the renderer reads bytes big-endian
  }
  return out;
}
