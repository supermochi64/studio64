// A project -> a playable ROM: each custom level becomes one block of data (its level script, geo
// layouts, display lists, textures and collision, loaded into segment 0x0E) added after the base
// ROM, and the main level script's EXECUTE for its slot points at it. The hub (when the hack has
// one) takes the castle grounds, the other levels the 15 course slots, whose castle paintings
// then lead into them. An original level the hack edits gets a copy of its level script with the
// changes patched in (vanilla.js). Course names, the start level and the exits go into the info
// block the base ROM reads at boot (base.js).
import { parseDump } from './dump.js';
import { buildMesh, fogOf } from './mesh.js';
import { buildCollision } from './collision.js';
import { mapObjects } from './objects.js';
import { Segment, geo, gfx, script, lights1, executeCmd, COL } from './n64.js';
import { INFO_ROM, INFO_SIZE } from './base.js';
import { readLevel, levelData, readCollision, readMacros, presets, geoDisplayLists, flatDisplayList } from './vanilla.js';
import { bankSlot } from './decompindex.js';
import { writeCalls } from './calls.js';
import { buildStory } from './story.js';
import { getEntry, catalog } from '../catalog.js';
import { encodeSong } from '../../web/js/music.js';
import { OVERLAYS } from './overlays.js';
import { designBook, encode } from './vadpcm.js';

export const COURSE_SLOTS = ['bob', 'wf', 'jrb', 'ccm', 'bbh', 'hmc', 'lll', 'ssl', 'ddd', 'sl', 'wdw', 'ttm', 'thi', 'ttc', 'rr'];
const HUB_SLOT = 'castle_grounds';

// studio sky ids are the game's BACKGROUND numbers; the skybox images each needs
const SKYBOX = ['water_skybox', 'bitfs_skybox', 'wdw_skybox', 'cloud_floor_skybox', 'ccm_skybox', 'ssl_skybox',
  'bbh_skybox', 'bidw_skybox', 'clouds_skybox', 'bits_skybox'];
const DOOR_MODELS = {
  'door:castle_door': 'MODEL_CASTLE_DOOR', 'door:castle_door_1_star': 'MODEL_CASTLE_DOOR_1_STAR',
  'door:castle_door_3_stars': 'MODEL_CASTLE_DOOR_3_STARS', 'door:key_door': 'MODEL_CASTLE_KEY_DOOR',
  'prop:wooden_door': 'MODEL_CASTLE_WOODEN_DOOR', 'prop:metal_door': 'MODEL_CASTLE_METAL_DOOR',
  'prop:haunted_door': 'MODEL_BBH_HAUNTED_DOOR', 'prop:hazy_maze_door': 'MODEL_HMC_HAZY_MAZE_DOOR',
};
const DOOR_GEO = {
  MODEL_CASTLE_DOOR: 'castle_door_geo', MODEL_CASTLE_WOODEN_DOOR: 'wooden_door_geo',
  MODEL_CASTLE_DOOR_1_STAR: 'castle_door_1_star_geo', MODEL_CASTLE_DOOR_3_STARS: 'castle_door_3_stars_geo',
  MODEL_CASTLE_METAL_DOOR: 'metal_door_geo', MODEL_HMC_HAZY_MAZE_DOOR: 'hazy_maze_door_geo',
  MODEL_BBH_HAUNTED_DOOR: 'haunted_door_geo', MODEL_CASTLE_KEY_DOOR: 'key_door_geo',
};
const WARP_NODE_0A = 0x0A, WARP_NODE_SUCCESS = 0xF0, WARP_NODE_DEATH = 0xF1;
const ARRIVALS = { walk: 'bhvInstantActiveWarp', spin: 'bhvSpinAirborneWarp', fall: 'bhvAirborneWarp' };
const deg = (v) => Math.round(((((v | 0) % 65536) + 65536) % 65536) / 65536 * 360) % 360;

// ---- text ------------------------------------------------------------------------------------
// The letters the menus have (course and act names are shown in them).
export function gameText(s, max = 32) {
  return String(s || '').toUpperCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9 ,.'!?&:()-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
const CHARS = { ' ': 0x9E, "'": 0x3E, '.': 0x3F, ',': 0x6F, '-': 0x9F, '(': 0xE1, ')': 0xE3, '&': 0xE5, ':': 0xE6, '!': 0xF2, '?': 0xF4 };
// gameText() -> the game's character codes, ended by 0xFF, in a field of `size` bytes
export function encodeText(s, size = 32) {
  const out = Buffer.alloc(size, 0xFF);
  let n = 0;
  for (const ch of s) {
    if (n >= size - 1) break;
    let c;
    if (ch >= '0' && ch <= '9') c = ch.charCodeAt(0) - 48;
    else if (ch >= 'A' && ch <= 'Z') c = 0x0A + ch.charCodeAt(0) - 65;
    else c = CHARS[ch] ?? 0x9E;
    out[n++] = c;
  }
  out[n] = 0xFF;
  return out;
}

// ---- the plan ----------------------------------------------------------------------------------
const areaKeysOf = (project, id) => Object.keys(project.areas || {})
  .filter((k) => k === `c:${id}` || k.startsWith(`c:${id}:`))
  .sort((a, b) => Number(a.split(':')[2] || 1) - Number(b.split(':')[2] || 1));
const areaIndexOf = (key) => Number(key.split(':')[2] || 1);
const recordsOf = (project, areas) => areas.flatMap((a) => (project.areas[a.key]?.objects || []).map((rec) => ({ area: a.key, rec })));

// an original area the hack changes
const editedArea = (a) => !!a && ((a.objects || []).length > 0 || (a.removals || []).length > 0 || (a.warps || []).length > 0
  || Number.isFinite(a.settings?.music) || !!a.terrain || (a.sculpt || []).length > 0);
// ...with things the browser must read (blocks, models, terrain, baked props)
const needsDump = (a, bake) => (a.objects || []).some((r) => (r.block && !r.zone) || r.asset || r.road || r.line || r.nature)
  || !!a.terrain || (a.sculpt || []).length > 0 || bake.length > 0;

/**
 * Which level goes where, which areas the browser must read (and what to bake into each), and
 * what will not make it into the ROM. index: loadKit().index.
 * -> { levels: [{ id, name, folder, levelNum, course, vanilla, areas: [{ key, index, dump }] }], hub, bake: { areaKey: [uid] }, issues }
 */
export function planHack(project, index) {
  const issues = [];
  const all = project.levels || [];
  const flow = project.world || {};
  const folderOf = Object.fromEntries(Object.entries(index.folders).map(([f, n]) => [n, f]));
  const levelName = (num) => Object.values(catalog.levels).find((l) => l.num === num)?.name || folderOf[num];

  // original levels the hack edits keep their place
  const edited = new Map();
  for (const [key, a] of Object.entries(project.areas || {})) {
    const m = /^(\d+):(\d+)$/.exec(key);
    if (!m || !editedArea(a) || !folderOf[Number(m[1])]) continue;
    const num = Number(m[1]);
    if (!edited.has(num)) edited.set(num, []);
    edited.get(num).push({ key, index: Number(m[2]) });
  }
  const taken = new Set([...edited.keys()].map((n) => folderOf[n]));

  const hubId = flow.hub?.custom && all.some((l) => l.id === flow.hub.custom) ? flow.hub.custom : null;
  const free = COURSE_SLOTS.filter((f) => !taken.has(f));
  let hubSlot = HUB_SLOT;
  if (hubId && taken.has(HUB_SLOT)) {
    hubSlot = free.shift();
    issues.push({ name: 'Castle grounds', why: 'your hub takes the place of a course because the hack also changes the castle grounds' });
  }
  const courses = all.filter((l) => l.id !== hubId);
  if (courses.length > free.length) {
    issues.push({ name: `${courses.length - free.length} more levels`, why: `a ROM has ${COURSE_SLOTS.length} course slots: ${courses.slice(free.length).map((l) => l.name).join(', ')} are left out` });
  }
  const levels = [];
  const add = (l, folder) => {
    const keys = areaKeysOf(project, l.id);
    if (!keys.includes(`c:${l.id}`)) keys.unshift(`c:${l.id}`);
    const course = COURSE_SLOTS.indexOf(folder) + 1;
    levels.push({ id: l.id, name: l.name, folder, levelNum: index.folders[folder], course, vanilla: false, areas: keys.map((key) => ({ key, index: areaIndexOf(key), dump: true })) });
  };
  if (hubId && hubSlot) add(all.find((l) => l.id === hubId), hubSlot);
  courses.slice(0, free.length).forEach((l, i) => add(l, free[i]));
  for (const [num, areas] of edited) {
    levels.push({ id: `v:${num}`, name: levelName(num), folder: folderOf[num], levelNum: num, course: 0, vanilla: true, areas: areas.sort((a, b) => a.index - b.index) });
  }

  const bake = {}, skip = {};
  for (const lv of levels) {
    const records = recordsOf(project, lv.areas);
    const objs = mapObjects(records, index, { ownLevel: lv.vanilla ? lv.folder : null });
    for (const [area, uids] of objs.bake) bake[area] = uids;
    // moving blocks and models: objects of their own, read one by one
    for (const [area, recs] of objs.movers) skip[area] = recs.map((r) => r.uid >>> 0);
    // paintings: their pictures become part of the level
    for (const { area, rec } of records) if (rec.warp?.kind === 'painting') (bake[area] ||= []).push(rec.uid);
    for (const i of objs.issues) issues.push({ level: lv.name, ...i });
    if (lv.vanilla) {
      for (const a of lv.areas) {
        const pa = project.areas[a.key];
        a.dump = needsDump(pa, bake[a.key] || []) || !!skip[a.key];
      }
    }
  }
  return { levels, hub: hubId && hubSlot ? hubId : null, bake, skip, issues };
}

// ---- the ROM -----------------------------------------------------------------------------------
/**
 * kit: loadKit(); dumps: Map(areaKey -> Buffer from studio_romdump).
 * -> { rom, report: { levels: [{ name, slot, course, areas: [stats] }], issues, size } }
 */
export function buildRom(kit, project, dumps, { title, calls = new Map(), objects = new Map(), sounds = new Map() } = {}) {
  const ix = kit.index;
  const sym = (name) => {
    const v = ix.symbols[name];
    if (v === undefined) throw new Error(`the base ROM has no ${name}`);
    return v;
  };
  const plan = planHack(project, ix);
  const issues = [...plan.issues];
  const flow = project.world || {};
  const byId = new Map(plan.levels.map((l) => [l.id, l]));
  const hub = plan.hub ? byId.get(plan.hub) : null;
  const hubArea = hub ? (flow.hub.area || 1) : 1;
  const replaced = new Set(plan.levels.filter((l) => !l.vanilla).map((l) => l.levelNum));
  const issue = (lv, name, why) => issues.push({ level: lv.name, name, why });

  const rom = Buffer.alloc(INFO_ROM + 0x1000);
  kit.rom.copy(rom, 0);
  const blobs = [];
  let romAt = INFO_ROM + 0x1000; // the info block, then the levels
  const report = [];

  // where a warp leads: [level, area, node, flags], or null
  // the project's songs in the ROM: the sound studio's (encoded as the web build does) and imported
  // sequences (the Tokyo template's). -> index, or -1 (the game's music plays)
  const songs = [], songIds = new Map();
  const addSong = (key, make, issueFn) => {
    if (songIds.has(key)) return songIds.get(key);
    const sg = make();
    let index = -1;
    if (sg.bank < 0 || sg.bank >= (ix.soundBanks || GAME_BANKS)) issueFn('its song uses instruments that are not in the ROM: the game\'s music plays instead');
    else if (sg.bytes.length > 0x3000) issueFn('its song is too long for the game\'s music memory: the game\'s music plays instead');
    else { index = songs.length; songs.push(sg); }
    songIds.set(key, index);
    return index;
  };
  const songIndex = (settings, issueFn = () => {}) => {
    if (settings?.song) {
      const song = (project.audio?.songs || []).find((x) => x.id === settings.song);
      if (!song) return -1;
      return addSong(`song:${song.id}`, () => ({ bytes: Buffer.from(encodeSong(song)), bank: song.bank | 0 }), issueFn);
    }
    const m = settings?.m64Song;
    if (m?.data) return addSong(`m64:${m.bank}:${m.data.length}:${m.data.slice(0, 80)}`, () => ({ bytes: Buffer.from(m.data, 'base64'), bank: m.bank | 0 }), issueFn);
    return -1;
  };

  const destOf = (to) => {
    if (!to) return null;
    if (to.hub) return hub ? [hub.levelNum, hubArea, WARP_NODE_0A, 0] : null;
    if (to.custom) {
      const d = byId.get(to.custom);
      if (!d) return null;
      const area = to.area || 1;
      const rec = to.uid ? (project.areas[`c:${to.custom}${area > 1 ? `:${area}` : ''}`]?.objects || []).find((x) => x.uid === to.uid) : null;
      return [d.levelNum, area, (rec?.warp?.node || to.node || WARP_NODE_0A) & 0xFF, 0];
    }
    if (to.level) return replaced.has(to.level) ? null : [to.level, to.area || 1, (to.node ?? WARP_NODE_0A) & 0xFF, 0];
    return null;
  };

  // an area's warps: doors, pipes, paintings, warp and exit zones, arrival points
  // -> { objects: [object], nodes: [[id, level, area, node, flags]] }; door models go into models
  const areaWarps = (lv, key, areaIndex, models) => {
    const objects = [], nodes = [];
    const pa = project.areas[key] || {};
    for (const r of pa.objects || []) {
      const w = r.warp;
      if (!w || !w.kind) continue;
      const node = w.node & 0xFF;
      const label = r.name || `${w.kind[0].toUpperCase()}${w.kind.slice(1)}`;
      const pos = { x: Math.round(r.x), y: Math.round(r.y), z: Math.round(r.z), ax: 0, ay: deg(r.yaw), az: 0 };
      if (w.kind === 'arrival') {
        objects.push({ ...pos, model: 'MODEL_NONE', bparams: node << 16, bhv: ARRIVALS[r.zone?.spawn] || ARRIVALS.walk, uid: r.uid >>> 0 });
        nodes.push([node, lv.levelNum, areaIndex, node, 0]);
        continue;
      }
      if (!['door', 'pipe', 'painting', 'zone'].includes(w.kind)) continue;
      if (w.kind === 'zone' && r.zone?.kind !== 'warp' && r.zone?.kind !== 'exit') continue;
      if (!node) continue;
      const dest = destOf(w.to);
      if (!dest) { issue(lv, label, w.to ? 'leads somewhere outside the ROM\'s levels' : 'leads nowhere yet'); continue; }
      if (w.kind === 'door') {
        const model = DOOR_MODELS[r.model] || 'MODEL_CASTLE_DOOR';
        models.set(model, DOOR_GEO[model]);
        objects.push({ ...pos, model, bparams: (node << 16) | Math.min(255, w.stars || 0), bhv: 'bhvDoorWarp', uid: r.uid >>> 0 });
      } else if (w.kind === 'painting') {
        // the picture is part of the level (baked); jumping into it warps
        const size = 600 * (r.scale || 1);
        const a0 = ((r.yaw | 0) / 32768) * Math.PI;
        objects.push({ model: 'MODEL_NONE', x: Math.round(r.x + Math.sin(a0) * 60), y: Math.round(r.y - size * 0.2), z: Math.round(r.z + Math.cos(a0) * 60), ax: 0, ay: 0, az: 0,
          bparams: ((Math.min(255, Math.round(size * 0.4 / 10)) << 24) | (node << 16)) >>> 0, bhv: 'bhvWarp' });
      } else if (w.kind === 'zone') {
        const b = r.block || { sx: 300, sz: 300 };
        objects.push({ ...pos, ay: 0, model: 'MODEL_NONE', bparams: ((Math.min(255, Math.round(Math.max(b.sx, b.sz) / 20)) << 24) | (node << 16)) >>> 0, bhv: 'bhvWarp' });
      }
      // (a pipe's object is one of the level's objects: warp_pipe)
      nodes.push([node, ...dest]);
    }
    // the area's warp list (pipes into the original levels)
    for (const w of pa.warps || []) {
      if (nodes.some((n) => n[0] === (w.node & 0xFF))) continue;
      const dest = w.destCustom ? destOf({ custom: w.destCustom, area: w.destArea, node: w.destNode }) : destOf({ level: w.destLevel, area: w.destArea, node: w.destNode });
      if (!dest) { issue(lv, `Warp ${w.node}`, 'leads somewhere outside the ROM\'s levels'); continue; }
      nodes.push([w.node & 0xFF, ...dest]);
    }
    return { objects, nodes };
  };

  const placeObject = (s, o) => script.object(s, ix.models[o.model] ?? 0, o.x, o.y, o.z, o.ax, o.ay, o.az, o.bparams, sym(o.bhv));

  // Moving blocks and models of an area: each its own model and collision, an object that motion.c
  // moves (the engine's own code in the ROM). -> [object] (with geo, col: their labels)
  const writeMovers = (s, lv, key, lights, env = {}) => {
    const out = [];
    const recs = recordsOf(project, [{ key }]).map((x) => x.rec).filter((r) => (r.block || r.asset) && r.motion && !r.zone);
    for (const r of recs) {
      const buf = objects.get(r.uid >>> 0);
      const name = r.name || (r.asset ? 'Moving model' : 'Moving block');
      if (!buf) { issue(lv, name, 'was not loaded for the export'); continue; }
      const dump = parseDump(buf);
      const pre = `mv${r.uid >>> 0}`;
      const mesh = buildMesh(s, dump, pre, lights, { single: true, fog: env.fog, tint: env.tint });
      s.align(4).label(`${pre}_geo`);
      geo.start(s);
      geo.open(s);
      mesh.geo(s);
      geo.close(s);
      geo.end(s);
      let col = null;
      const solid = dump.collision.length > 0;
      const verts = new Set(dump.collision.flatMap((c) => [0, 3, 6].map((k) => c.v.slice(k, k + 3).join(',')))).size;
      if (solid && verts > 200) issue(lv, name, 'is too detailed to be solid on the N64 (at most 200 corners): it moves without collision');
      else if (solid) { buildCollision(s, dump, `${pre}_col`, { object: true }); col = `${pre}_col`; }
      out.push({ model: 'MODEL_NONE', x: Math.round(r.x), y: Math.round(r.y), z: Math.round(r.z), ax: deg(r.pitch), ay: deg(r.yaw), az: deg(r.roll),
        bparams: 0, bhv: r.asset ? 'bhvStudioModel' : 'bhvStudioBlock', uid: r.uid >>> 0, geo: `${pre}_geo`, col, scale: r.asset ? (r.scale || 1) : 1 });
    }
    return out;
  };

  // Studio 64's data of an area (n64/s64_core.c): the placed objects' uids and the recorded set-up
  // -> label of the area data, or null when there is nothing
  const usedModules = new Set();
  // the modules a level's objects need, as the level script asks for them (s64_ovl.c)
  const withRequired = (names) => {
    const all = new Set(names);
    for (const n of all) for (const r of OVERLAYS.find((o) => o.name === n)?.requires || []) all.add(r);
    return all;
  };
  const moduleMask = (names) => (ix.modules?.list || []).filter((m) => withRequired(names).has(m.name)).reduce((mask, m) => mask | (1 << m.index), 0);
  // ...and the ones the level's rules switch on (Shotgun Mario, Katana Mario: the recorded set-up)
  const RULE_MODULES = { studio_shotgun_rule: 'shotgun', studio_shotgun_level_start: 'shotgun', studio_katana_rule: 'katana', studio_katana_level_start: 'katana' };
  const ruleModules = (keys) => new Set(keys.flatMap((k) => (calls.get(k) || []).filter((c) => RULE_MODULES[c[0]] && Number(c[1])).map((c) => RULE_MODULES[c[0]]))
    .filter((m) => (ix.modules?.list || []).some((x) => x.name === m)));
  const writeStudioArea = (s, prefix, key, placed, song = -1, spawns = []) => {
    const tagged = placed.filter((o) => o.uid);
    // the area's locks: stars, a key, locked until an event opens it
    const locks = (project.areas[key]?.objects || []).filter((r) => r.warp && ((r.warp.stars | 0) > 0 || Number.isInteger(r.warp.key) || r.warp.locked))
      .map((r) => ['studio_lock_set', r.uid >>> 0, r.warp.stars | 0, Number.isInteger(r.warp.key) ? r.warp.key : -1, r.warp.locked ? 1 : 0]);
    const list = [...(calls.get(key) || []), ['studio_locks_reset'], ...locks];
    if (!tagged.length && !list.length && song < 0 && !spawns.length) return null;
    s.align(4).label(`${prefix}_tags`);
    s.u16(tagged.length).u16(0);
    for (const o of tagged) {
      s.u32(o.uid).u32(sym(o.bhv)).s16(o.x).s16(o.y).s16(o.z).s16(0);
      if (o.geo) s.ref(o.geo); else s.u32(0);
      if (o.col) s.ref(o.col); else s.u32(0);
      const f = Buffer.alloc(4); f.writeFloatBE(o.scale || 1); s.bytes(f);
    }
    const n = writeCalls(s, `${prefix}_calls`, list);
    s.align(4).label(`${prefix}_s64`);
    s.ref(`${prefix}_tags`);
    if (n) s.ref(`${prefix}_calls`); else s.u32(0);
    s.u32(song + 1);
    if (spawns.length) s.ref(`${prefix}_spawns`); else s.u32(0);
    // Studio 64's module objects: made when the area loads (catalog index, place, parameters, uid, size)
    if (spawns.length) {
      s.align(4).label(`${prefix}_spawns`);
      s.u16(spawns.length).u16(0);
      for (const o of spawns) {
        // a catalog object: its index; a behavior with a catalog model: 1 << 31, behavior << 16, model
        s.u32(o.custom ? ((0x80000000 | ((o.bhv & 0x7FFF) << 16) | (o.model & 0xFFFF)) >>> 0) : o.index);
        for (const v of [o.x, o.y, o.z]) { const f = Buffer.alloc(4); f.writeFloatBE(Number(v) || 0); s.bytes(f); }
        const ang = (v) => (((v | 0) & 0xFFFF) << 16) >> 16;
        s.s16(ang(o.pitch)).s16(ang(o.yaw)).s16(ang(o.roll)).s16(0).u32(o.bparams >>> 0).u32(o.uid >>> 0);
        const f = Buffer.alloc(4); f.writeFloatBE(o.scale || 1); s.bytes(f);
      }
    }
    return `${prefix}_s64`;
  };
  // the level's header: per area index, its data
  const writeStudioLevel = (s, areas) => {
    const withData = areas.filter((a) => a.s64);
    if (!withData.length) return null;
    s.align(4).label('s64_level');
    s.u32(0x5336344C);
    for (let i = 0; i < 8; i++) {
      const a = withData.find((x) => x.index === i);
      if (a) s.ref(a.s64); else s.u32(0);
    }
    return 's64_level';
  };
  const levelHeaders = new Map(); // level number -> offset of its header in its block

  // ---- a custom level: everything new -------------------------------------------------------------
  const buildCustom = (lv) => {
    const s = new Segment(0x0E);
    const objs = mapObjects(recordsOf(project, lv.areas), ix);
    const models = new Map(objs.models);

    // where stars and deaths lead: the hub, else where the course's painting is
    const exits = lv === hub
      ? null
      : hub
        ? { success: [hub.levelNum, hubArea, WARP_NODE_0A, 0], death: [hub.levelNum, hubArea, WARP_NODE_0A, 0] }
        : (ix.exits[lv.folder] || {});

    // sky: one skybox image per level (an area with another sky gets the first one's)
    const skyOf = (a) => Math.max(0, Math.min(9, Number(project.areas[a.key]?.settings?.sky ?? 0) | 0));
    const sky = skyOf(lv.areas[0]);
    for (const a of lv.areas) if (skyOf(a) !== sky) issue(lv, `area ${a.index}`, 'has another sky than the first area: a level has one sky in the ROM');

    // the areas' data
    const areas = [];
    for (const a of lv.areas) {
      const buf = dumps.get(a.key);
      if (!buf) { issue(lv, `area ${a.index}`, 'was not loaded for the export'); continue; }
      const st = project.areas[a.key]?.settings || {};
      const dump = parseDump(buf);
      const prefix = `a${a.index}`;
      const env = envOf(st.env || {}, (why) => issue(lv, `area ${a.index}`, why));
      s.align(8).label(`${prefix}_lights`);
      lights1(s, ...env.lights);
      const mesh = buildMesh(s, dump, prefix, `${prefix}_lights`, { fog: env.fog, tint: env.tint });
      const col = buildCollision(s, dump, `${prefix}_col`, { deathY: st.env?.deathY ?? null });
      writeAreaGeo(s, `${prefix}_geo`, mesh, sky, sym, env);
      const movers = writeMovers(s, lv, a.key, `${prefix}_lights`, env);
      areas.push({ ...a, settings: st, prefix, movers, warps: areaWarps(lv, a.key, a.index, models), stats: { ...mesh.stats, collision: col.tris, water: col.water, moving: movers.length } });
    }
    if (!areas.length) return null;

    // the level script (the block's entry)
    s.align(4).label('entry');
    script.initLevel(s);
    script.loadMio0Texture(s, 0x09, sym('_generic_mio0SegmentRomStart'), sym('_generic_mio0SegmentRomEnd'));
    script.loadMio0(s, 0x0A, sym(`_${SKYBOX[sky]}_mio0SegmentRomStart`), sym(`_${SKYBOX[sky]}_mio0SegmentRomEnd`));
    for (const [seg, geoSeg, g] of [[0x05, 0x0C, objs.groups.a], [0x06, 0x0D, objs.groups.b]]) {
      if (!g) continue;
      script.loadMio0(s, seg, sym(`_${g.name}_mio0SegmentRomStart`), sym(`_${g.name}_mio0SegmentRomEnd`));
      script.loadRaw(s, geoSeg, sym(`_${g.name}_geoSegmentRomStart`), sym(`_${g.name}_geoSegmentRomEnd`));
    }
    script.loadMio0(s, 0x08, sym('_common0_mio0SegmentRomStart'), sym('_common0_mio0SegmentRomEnd'));
    script.loadRaw(s, 0x0F, sym('_common0_geoSegmentRomStart'), sym('_common0_geoSegmentRomEnd'));
    for (const m of ruleModules(lv.areas.map((a) => a.key))) objs.modules.add(m);
    if (objs.modules.size) script.call(s, moduleMask(objs.modules), sym('s64_level_modules'));
    script.allocLevelPool(s);
    script.mario(s, ix.models.MODEL_MARIO, 0x01, sym('bhvMario'));
    script.jumpLink(s, sym('script_func_global_1'));
    for (const g of [objs.groups.a, objs.groups.b]) if (g) script.jumpLink(s, sym(`script_func_global_${g.func}`));
    for (const [m, g] of models) script.loadModelFromGeo(s, ix.models[m], sym(g));

    for (const a of areas) {
      const spawn = a.settings.spawn || { x: 0, y: 500, z: 0, yaw: 0 };
      script.area(s, a.index, `${a.prefix}_geo`);
      // Mario's arrival point (node 0x0A: the level's entry, and where doors and exits come back to)
      script.object(s, ix.models.MODEL_NONE ?? 0, Math.round(spawn.x), Math.round(spawn.y + 200), Math.round(spawn.z), 0, deg(spawn.yaw), 0, WARP_NODE_0A << 16, sym('bhvSpinAirborneWarp'));
      for (const o of [...(objs.perArea.get(a.key) || []), ...a.warps.objects, ...a.movers]) placeObject(s, o);
      script.warpNode(s, WARP_NODE_0A, lv.levelNum, a.index, WARP_NODE_0A, 0);
      for (const w of a.warps.nodes) script.warpNode(s, ...w);
      const self = [lv.levelNum, a.index, WARP_NODE_0A, 0];
      const success = exits ? exits.success : self, death = exits ? exits.death : self;
      if (success) script.warpNode(s, WARP_NODE_SUCCESS, ...success);
      if (death) script.warpNode(s, WARP_NODE_DEATH, ...death);
      script.terrain(s, `${a.prefix}_col`);
      a.song = songIndex(a.settings, (why) => issue(lv, `area ${a.index}`, why));
      script.backgroundMusic(s, 0, musicOf(a.settings, () => {}, 0x03, a.song));
      script.terrainType(s, 0);
      script.endArea(s);
    }
    script.freeLevelPool(s);
    const first = areas[0], fs0 = first.settings.spawn || { x: 0, y: 500, z: 0, yaw: 0 };
    script.marioPos(s, first.index, deg(fs0.yaw), Math.round(fs0.x), Math.round(fs0.y), Math.round(fs0.z));
    script.call(s, 0, sym('lvl_init_or_update'));
    script.callLoop(s, 1, sym('lvl_init_or_update'));
    script.clearLevel(s);
    script.sleepBeforeExit(s, 1);
    script.exit(s);
    for (const m of withRequired(objs.modules)) usedModules.add(m);
    for (const a of areas) a.s64 = writeStudioArea(s, a.prefix, a.key, [...(objs.perArea.get(a.key) || []), ...a.warps.objects, ...a.movers], a.song, objs.spawns.get(a.key) || []);
    const header = writeStudioLevel(s, areas);
    return { s, header, areas: areas.map((a) => ({ index: a.index, ...a.stats })) };
  };

  // ---- an original level: its own script, with the hack's changes patched in ----------------------
  let pre = null;
  const buildVanilla = (lv) => {
    const L = readLevel(kit.rom, ix, lv.folder);
    pre ||= presets(kit.rom, ix);
    let data = null;
    const seg7 = () => (data ||= levelData(kit.rom, L));
    const s = new Segment(0x0E);
    s.bytes(L.seg);

    // the object banks it loads
    const funcOf = new Map(Object.entries(ix.symbols).filter(([k]) => /^script_func_global_\d+$/.test(k)).map(([k, v]) => [v, Number(k.slice(19))]));
    const bankOf = new Map(Object.entries(ix.funcOfBank).map(([b, n]) => [n, b]));
    const groups = {};
    for (const g of L.globals) {
      const bank = bankOf.get(funcOf.get(g));
      if (bank && bankSlot(bank)) groups[bankSlot(bank)] = { name: bank, func: ix.funcOfBank[bank] };
    }
    const objs = mapObjects(recordsOf(project, lv.areas), ix, { groups, ownLevel: lv.folder });

    const areas = [];
    for (const a of lv.areas) {
      const A = L.areas.get(a.index);
      const pa = project.areas[a.key] || {};
      if (!A || A.terrainAt < 0) { issue(lv, `area ${a.index}`, 'is not in the game'); continue; }
      const prefix = `v${a.index}`;
      const models = new Map(objs.models);
      const warps = areaWarps(lv, a.key, a.index, models);
      const stats = { objects: 0, removed: 0, tris: 0, collision: 0 };
      const penv = pa.settings?.env || {};
      if (penv.fog?.on) issue(lv, `area ${a.index}`, 'fog is in the ROM for your own levels only: this original level keeps its look');
      if (penv.light && JSON.stringify(penv.light) !== '{}') issue(lv, `area ${a.index}`, 'its light is in the ROM for your own levels only: this original level keeps its look');

      // removed objects: script objects never spawn (no acts), macro and special objects are left out
      const removals = (pa.removals || []).map((rm) => ({ ...rm, addr: ix.symbols[rm.bhv], r: rm.r || 40, hit: false }));
      const removedHere = (bhv, x, y, z) => {
        const rm = removals.find((m) => m.addr === bhv && Math.hypot(m.x - x, m.y - y, m.z - z) <= m.r + 1);
        if (rm) { rm.hit = true; stats.removed++; }
        return !!rm;
      };
      for (const o of A.objects) if (removedHere(o.bhv, o.x, o.y, o.z)) s.buf[o.at + 2] = 0;
      if (removals.some((m) => !m.hit) && A.macroAt >= 0) {
        const list = readMacros(seg7(), L.seg.readUInt32BE(A.macroAt + 4), pre);
        const keep = list.filter((m) => !removedHere(m.behavior, m.shorts[1], m.shorts[2], m.shorts[3]));
        if (keep.length !== list.length) {
          s.align(4).label(`${prefix}_macros`);
          for (const m of keep) for (const v of m.shorts) s.s16(v);
          s.u16(0x001E);
          s.refAt(A.macroAt + 4, `${prefix}_macros`);
        }
      }

      // added blocks and models: drawn from a branch of the area's geo layout, solid in its collision
      let dump = null;
      if (a.dump) {
        const buf = dumps.get(a.key);
        if (!buf) issue(lv, `area ${a.index}`, 'was not loaded for the export');
        else dump = parseDump(buf);
      }
      const added = dump ? dump.collision.filter((c) => c.uid) : [];
      const terrainAddr = L.seg.readUInt32BE(A.terrainAt + 4);
      const sculpt = dump?.sculpt ? writeSculpt(s, L, A, prefix, dump.sculpt, seg7, (why) => issue(lv, `area ${a.index}`, why)) : null;
      let colLabel = null;
      const specialsHit = removals.some((m) => !m.hit);
      if (added.length || specialsHit || sculpt) {
        const col = readCollision(seg7(), terrainAddr, pre);
        const specials = col.specials.filter((sp) => !removedHere(sp.behavior, sp.shorts[0], sp.shorts[1], sp.shorts[2]));
        if (sculpt) Object.assign(col, sculpt.col);
        if (added.length || specials.length !== col.specials.length || sculpt) {
          colLabel = `${prefix}_col`;
          stats.collision = writeVanillaCollision(s, colLabel, col, specials, added);
          // the surface rooms (one per triangle, in the order the collision has them)
          if (sculpt && A.roomsAt >= 0 && sculpt.rooms) {
            s.label(`${prefix}_rooms`);
            for (let i = 0; i < stats.collision; i++) s.u8(sculpt.rooms[i] || 0);
            s.align(4);
            s.refAt(A.roomsAt + 4, `${prefix}_rooms`);
          }
        }
      }
      if (sculpt) stats.sculpted = sculpt.dls;
      for (const m of removals) if (!m.hit) issue(lv, m.name || m.bhv, 'could not be found to remove');
      if (dump && dump.tris.length) {
        const envfx = findGeoAsm(L.seg, A.geo, sym('geo_envfx_main'));
        if (envfx < 0) issue(lv, `area ${a.index}`, 'its new blocks cannot be drawn in this level yet');
        else {
          s.align(8).label(`${prefix}_lights`);
          lights1(s, ...envOf({}).lights);
          const mesh = buildMesh(s, dump, prefix, `${prefix}_lights`);
          s.align(4).label(`${prefix}_geo`);
          mesh.geo(s);
          geo.asm(s, L.seg.readUInt16BE(envfx + 2), sym('geo_envfx_main'));
          s.bbh(0x03, 0, 0); // GEO_RETURN
          s.put32(envfx, 0x02010000).refAt(envfx + 4, `${prefix}_geo`); // GEO_BRANCH(1, ...)
          stats.tris = mesh.stats.tris;
        }
      }

      // new objects and warps: the area's TERRAIN becomes a JUMP_LINK to them (and the terrain)
      if (!s.labels.has(`${prefix}_lights`)) { s.align(8).label(`${prefix}_lights`); lights1(s, ...envOf({}).lights); }
      const placed = [...(objs.perArea.get(a.key) || []), ...warps.objects, ...writeMovers(s, lv, a.key, `${prefix}_lights`)];
      s.align(4).label(`${prefix}_more`);
      s.bbh(0x2E, 0x08, 0);
      if (colLabel) s.ref(colLabel); else s.u32(terrainAddr);
      for (const [m, g] of models) script.loadModelFromGeo(s, ix.models[m], sym(g));
      for (const o of placed) placeObject(s, o);
      for (const w of warps.nodes) script.warpNode(s, ...w);
      script.return(s);
      s.put32(A.terrainAt, 0x06080000).refAt(A.terrainAt + 4, `${prefix}_more`);
      stats.objects = placed.length;

      const song = songIndex(pa.settings, (why) => issue(lv, `area ${a.index}`, why));
      for (const m of objs.modules) usedModules.add(m);
      const s64 = writeStudioArea(s, prefix, a.key, placed, song, objs.spawns.get(a.key) || []);
      if ((Number.isFinite(pa.settings?.music) || song >= 0) && A.musicAt >= 0) {
        s.buf.writeUInt16BE(musicOf(pa.settings, () => {}, s.buf.readUInt16BE(A.musicAt + 4), song), A.musicAt + 4);
      }
      areas.push({ index: a.index, s64, ...stats });
    }
    const header = writeStudioLevel(s, areas);
    // the modules its objects need: asked for right after the level starts (its INIT_LEVEL, then on)
    let entry = 0x0E000000 | L.entry;
    const mods = new Set([...objs.modules, ...ruleModules(lv.areas.map((a) => a.key))]);
    for (const m of withRequired(mods)) usedModules.add(m);
    if (mods.size) {
      if (s.buf.readUInt32BE(L.entry) !== 0x1B040000) issue(lv, 'Studio 64 objects', 'this level\'s script does not start as expected: they are left out');
      else {
        s.align(4).label('modules_entry');
        s.bbh(0x1B, 0x04, 0);
        script.call(s, moduleMask(mods), sym('s64_level_modules'));
        script.jump(s, 0x0E000000 | (L.entry + 4));
        entry = s.address('modules_entry');
      }
    }
    return { s, header, areas: areas.map(({ s64, ...rest }) => rest), entry };
  };

  for (const lv of plan.levels) {
    const built = lv.vanilla ? buildVanilla(lv) : buildCustom(lv);
    if (!built) continue;
    const data = built.s.done();
    const at = ix.execute[lv.folder];
    if (at === undefined) throw new Error(`the base ROM has no level script entry for ${lv.folder}`);
    blobs.push({ at: romAt, data });
    executeCmd(0x0E, romAt, romAt + data.length, lv.vanilla ? built.entry : built.s.address('entry')).copy(rom, at);
    if (built.header) levelHeaders.set(lv.levelNum, built.s.address(built.header) & 0xFFFFFF);
    romAt = align(romAt + data.length, 16);
    report.push({ name: lv.name, slot: lv.folder, course: lv.course, vanilla: lv.vanilla, bytes: data.length, areas: built.areas });
  }

  // the story (after the levels): level keys of the studio -> the ROM's levels
  const levelOf = (key) => {
    const m = /^c:([^:]+)(?::(\d+))?$/.exec(key);
    if (m) { const lv = byId.get(m[1]); return lv ? [lv.levelNum, Number(m[2] || 0)] : null; }
    const v = /^(\d+)(?::(\d+))?$/.exec(key);
    if (v) return replaced.has(Number(v[1])) ? null : [Number(v[1]), Number(v[2] || 0)];
    return null;
  };
  const story = buildStory(project, levelOf, songIndex);
  for (const i of story.issues) issues.push({ level: 'Story', ...i });
  let storyAt = 0;
  if (!story.empty) {
    storyAt = romAt;
    blobs.push({ at: romAt, data: story.data });
    romAt = align(romAt + story.data.length, 16);
  }

  // the songs the areas and the story play (s64_songs.c): a table, then the sequences
  let songsAt = 0;
  if (songs.length) {
    songsAt = romAt;
    const table = Buffer.alloc(songs.length * 16);
    let at = align(songsAt + table.length, 16);
    songs.forEach((sg, i) => {
      table.writeUInt32BE(at, i * 16);
      table.writeUInt32BE(sg.bytes.length, i * 16 + 4);
      table.writeUInt32BE(sg.bank, i * 16 + 8);
      blobs.push({ at, data: sg.bytes });
      at = align(at + sg.bytes.length + 16, 16); // (the game reads up to 15 bytes past the end)
    });
    blobs.push({ at: songsAt, data: table });
    romAt = at;
  }

  // the game sounds the project replaced (s64_sfx.c): per sound its sample (VADPCM), the sequence
  // that plays it once, and its codebook
  const sfx = [];
  (project.audio?.overrides || []).forEach((o, i) => {
    const label = o.name || 'A replaced sound';
    const pcmBuf = sounds.get(i);
    if (!pcmBuf || pcmBuf.length < 32) { issues.push({ level: 'Sounds', name: label, why: 'its sound was not read for the export: the game plays its own' }); return; }
    if (sfx.length >= MAX_SFX) { issues.push({ level: 'Sounds', name: label, why: `a ROM has room for ${MAX_SFX} replaced sounds: the game plays its own` }); return; }
    const pcm = new Int16Array(pcmBuf.buffer.slice(pcmBuf.byteOffset, pcmBuf.byteOffset + (pcmBuf.length & ~1)));
    const book = designBook(pcm);
    sfx.push({ key: (o.bits & 0xF0FF0000) >>> 0, data: encode(pcm, book), seq: sfxSequence(sfx.length, pcm.length / SFX_RATE), samples: pcm.length, book });
  });
  let sfxAt = 0;
  if (sfx.length) {
    sfxAt = romAt;
    const table = Buffer.alloc(sfx.length * 96);
    let at = align(sfxAt + table.length, 16);
    sfx.forEach((x, i) => {
      const o = i * 96;
      table.writeUInt32BE(x.key, o);
      table.writeUInt32BE(at, o + 4);
      table.writeUInt32BE(x.seq.length, o + 8);
      blobs.push({ at, data: x.seq });
      at = align(at + x.seq.length + 16, 16);
      table.writeUInt32BE(at, o + 12);
      table.writeUInt32BE(x.data.length, o + 16);
      table.writeUInt32BE(x.samples, o + 20);
      table.writeFloatBE(SFX_RATE / 32000, o + 24);
      x.book.forEach((v, k) => table.writeInt16BE(v, o + 32 + k * 2));
      blobs.push({ at, data: x.data });
      at = align(at + x.data.length + 16, 16);
    });
    blobs.push({ at: sfxAt, data: table });
    romAt = at;
  }

  // the info block
  const info = Buffer.alloc(INFO_SIZE);
  info.writeUInt32BE(sfxAt, 0xDF0);
  info.writeUInt32BE(sfx.length, 0xDF4);
  info.writeUInt32BE(songsAt, 0xDE8);
  // Studio 64's modules the hack's objects need (the base ROM has them: overlays.js)
  const mods = (ix.modules?.list || []).filter((m) => usedModules.has(m.name));
  if (mods.length) {
    info.writeUInt32BE(ix.modules.dir, 0x018);
    info.writeUInt32BE(mods.reduce((mask, m) => mask | (1 << m.index), 0) >>> 0, 0x01C);
  }
  info.writeUInt32BE(songs.length, 0xDEC);
  info.writeUInt32BE(storyAt, 0xDE0);
  info.writeUInt32BE(storyAt ? story.data.length : 0, 0xDE4);
  info.writeUInt32BE(0x53363448, 0);
  info.writeUInt16BE(1, 4);
  const start = flow.start?.custom ? byId.get(flow.start.custom) : null;
  info.writeInt16BE(start && start !== hub ? start.levelNum : (hub && hub.folder !== HUB_SLOT ? hub.levelNum : 0), 6);
  let named = 0;
  for (const lv of plan.levels) {
    if (!lv.course || lv.vanilla) continue;
    named |= 1 << (lv.course - 1);
    encodeText(`${String(lv.course).padStart(2, ' ')} ${gameText(lv.name, 26)}`).copy(info, 0x20 + (lv.course - 1) * 32);
    const stars = lv.areas.flatMap((a) => (project.areas[a.key]?.objects || []).filter((r) => r.star || getEntry(r.entry || '')?.behavior === 'bhvStar'))
      .sort((a, b) => ((a.bparams >>> 24) & 0xFF) - ((b.bparams >>> 24) & 0xFF));
    for (let k = 0; k < 6; k++) {
      const name = gameText(stars[k]?.star?.name || stars[k]?.name || '', 30) || '-';
      encodeText(name).copy(info, 0x200 + ((lv.course - 1) * 6 + k) * 32);
    }
  }
  info.writeUInt16BE(named, 8);
  info.writeUInt16BE(hub || start ? 1 : 0, 10); // no castle intro when the hack starts in its own level
  const mask = [0, 0];
  for (const lv of plan.levels) if (!lv.vanilla) mask[lv.levelNum >> 5] |= 1 << (lv.levelNum & 31);
  info.writeUInt32BE(mask[0] >>> 0, 12);
  info.writeUInt32BE(mask[1] >>> 0, 16);
  if (hub) { info.writeInt16BE(hub.levelNum, 20); info.writeUInt8(hubArea, 22); info.writeUInt8(WARP_NODE_0A, 23); }
  for (const [num, off] of levelHeaders) if (num < 40) info.writeUInt32BE(off, 0xD40 + num * 4);
  info.copy(rom, INFO_ROM);

  // the ROM's name in its header
  const name = gameText(title || project.name || 'STUDIO 64 HACK', 20).replace(/[^A-Z0-9 ]/g, ' ').padEnd(20).slice(0, 20);
  rom.write(name, 0x20, 20, 'latin1');

  // the modules this hack does not use leave the ROM (its patch carries only what it plays)
  if (ix.modules?.dir) {
    const dir = ix.modules.dir;
    for (const m of ix.modules.list || []) {
      if (withRequired(usedModules).has(m.name)) continue;
      const e = dir + 16 + m.index * 32, at = dir + rom.readUInt32BE(e), len = rom.readUInt32BE(e + 4);
      if (len && at + len <= rom.length) rom.fill(0, at, at + len);
    }
  }

  const size = align(romAt, 1 << 20);
  const out = Buffer.alloc(size);
  rom.copy(out, 0, 0, Math.min(rom.length, size));
  for (const b of blobs) b.data.copy(out, b.at);
  return { rom: out, report: { levels: report, issues, size, hub: hub?.name || null } };
}

const align = (v, a) => Math.ceil(v / a) * a;
// replaced sounds: how many a ROM holds (the instruments of its sound bank) and their sample rate
const MAX_SFX = 16, SFX_RATE = 16000;

// The sequence that plays a replaced sound once: its instrument (program) of the sounds' bank,
// middle C (the sample at its own speed), as long as the sound (48 ticks a beat, 120 beats a minute)
function sfxSequence(program, seconds) {
  const ticks = Math.min(0x7FFF, Math.ceil(seconds * 96) + 2);
  const len = (n) => (n < 0x80 ? [n] : [0x80 | (n >> 8), n & 0xFF]);
  const seq = [0xD3, 0x80, 0xD7, 0x00, 0x01, 0x90, 0, 0, 0xDD, 120, 0xDB, 127, 0xFD, ...len(ticks), 0xFF];
  const ch = seq.length;
  seq[6] = ch >> 8; seq[7] = ch & 0xFF;
  seq.push(0xC4, 0xC1, program, 0xDF, 127, 0xDD, 64, 0xD4, 0, 0x90, 0, 0, 0xFD, ...len(ticks), 0xFF);
  const layer = seq.length;
  seq[ch + 10] = layer >> 8; seq[ch + 11] = layer & 0xFF;
  seq.push(39, ...len(ticks), 127, 215, 0xFF);
  return Buffer.from(seq);
}
const SONG_SLOT = 0x1A;
const GAME_BANKS = 0x26; // the game's instrument banks (a base ROM without its index of them)

// An area's music: one of the game's 35 songs, or its own song (index into the songs: it plays
// from the credits' sequence slot, s64_songs.c)
function musicOf(settings, issue, fallback = 0x03, song = -1) {
  if (song >= 0) return SONG_SLOT;
  const seq = settings.music;
  return Number.isInteger(seq) && seq > 0 && seq < 0x23 ? seq : fallback;
}

// GEO_ASM(param, fn) in a geo layout -> its offset in the segment, or -1
// An original area's sculpted shape (dump.sculpt, engine/src/studio/world.c): the display lists it
// changed, rebuilt from the level's own commands (textures and all stay the ROM's) with the new
// triangles, and the geo layout pointed at them; plus its collision (and rooms) for the caller.
// -> { col: { verts, groups }, rooms, dls } or null (left as it is, report() says why)
function writeSculpt(s, L, A, prefix, sculpt, seg7, report) {
  const geoDls = geoDisplayLists(L.seg, A.geo);
  if (!geoDls || geoDls.order.length !== sculpt.dls.length) {
    report('its sculpted shape does not match this level\'s display lists: it keeps its original shape');
    return null;
  }
  const read = (addr) => {
    const seg = addr >>> 24;
    if (seg === 0x07) return seg7() && { buf: seg7(), at: addr & 0xFFFFFF };
    if (seg === 0x0E) return { buf: L.seg, at: addr & 0xFFFFFF };
    return null;
  };
  const flats = sculpt.dls.map((dl, i) => (dl.changed ? flatDisplayList(read, geoDls.order[i]) : null));
  if (sculpt.dls.some((dl, i) => dl.changed && flats[i]?.length !== dl.nraw)) {
    report('its sculpted shape does not match this level\'s display lists: it keeps its original shape');
    return null;
  }
  let written = 0;
  sculpt.dls.forEach((dl, i) => {
    if (!dl.changed) return;
    const name = `${prefix}_sdl${i}`;
    // each run in batches of up to 32 vertices (the RSP's buffer), shared corners loaded once
    const batches = [];
    let nv = 0;
    for (const run of dl.runs) {
      const list = [];
      let cur = null;
      for (let t = 0; t * 48 < run.vtx.length; t++) {
        const keys = [0, 1, 2].map((k) => run.vtx.subarray(t * 48 + k * 16, t * 48 + k * 16 + 16));
        const ids = keys.map((k) => k.toString('hex'));
        if (!cur || cur.verts.size + ids.filter((id) => !cur.verts.has(id)).length > 32) {
          cur = { verts: new Map(), data: [], tris: [] };
          list.push(cur);
        }
        const tri = ids.map((id, k) => {
          if (!cur.verts.has(id)) { cur.verts.set(id, cur.data.length); cur.data.push(keys[k]); }
          return cur.verts.get(id);
        });
        cur.tris.push(tri);
      }
      for (const b of list) { b.start = nv; nv += b.data.length; }
      batches.push(list);
    }
    s.align(16).label(`${name}_v`);
    for (const list of batches) for (const b of list) for (const v of b.data) {
      // Vtx (little endian in the engine): ob[3], flag, tc[2], cn[4]
      s.s16(v.readInt16LE(0)).s16(v.readInt16LE(2)).s16(v.readInt16LE(4)).u16(0).s16(v.readInt16LE(8)).s16(v.readInt16LE(10));
      s.bytes(v.subarray(12, 16));
    }
    s.align(8).label(name);
    let raw = 0, run = 0;
    for (const c of dl.cmds) {
      if (c < 0) { s.bytes(flats[i][raw++]); continue; }
      for (const b of batches[run++]) {
        gfx.vertex(s, `${name}_v`, b.start, b.data.length, 0);
        let k = 0;
        for (; k + 1 < b.tris.length; k += 2) gfx.tri2(s, ...b.tris[k], ...b.tris[k + 1]);
        if (k < b.tris.length) gfx.tri1(s, ...b.tris[k]);
      }
    }
    gfx.end(s);
    for (const at of geoDls.at.get(geoDls.order[i])) s.refAt(at + 4, name);
    written++;
  });

  // the collision, as sculpted
  const verts = [], index = new Map(), groups = [];
  const vid = (x, y, z) => {
    const k = `${x},${y},${z}`;
    if (!index.has(k)) { index.set(k, verts.length); verts.push([x, y, z]); }
    return index.get(k);
  };
  for (const t of sculpt.tris) {
    const v = t.v, type = t.type & 0xFFFF;
    if (!groups.length || groups[groups.length - 1].type !== type) groups.push({ type, tris: [] });
    groups[groups.length - 1].tris.push([vid(v[0], v[1], v[2]), vid(v[3], v[4], v[5]), vid(v[6], v[7], v[8]), t.force]);
  }
  return { col: { verts, groups }, rooms: sculpt.hasRooms ? sculpt.tris.map((t) => t.room & 0xFF) : null, dls: written };
}

function findGeoAsm(seg, from, fn) {
  for (let o = from; o + 8 <= seg.length; o += 4) {
    const w = seg.readUInt32BE(o);
    if (w === 0x01000000) return -1; // GEO_END
    if ((w >>> 16) === 0x1800 && seg.readUInt32BE(o + 4) === fn) return o;
  }
  return -1;
}

// An original area's collision with removed special objects left out and the added objects'
// triangles after its own (its triangles keep their order: levels with rooms count on it).
function writeVanillaCollision(s, label, col, specials, added) {
  const verts = col.verts.map((v) => [...v]);
  const index = new Map();
  const vid = (x, y, z) => {
    const k = `${x},${y},${z}`;
    if (!index.has(k)) { index.set(k, verts.length); verts.push([x, y, z]); }
    return index.get(k);
  };
  const extra = new Map();
  for (const c of added) {
    const v = c.v;
    const a = vid(v[0], v[1], v[2]), b = vid(v[3], v[4], v[5]), d = vid(v[6], v[7], v[8]);
    if (a === b || b === d || a === d) continue;
    let type = c.type & 0xFFFF;
    if (type >= 0x40 && type < 0x65) type = 0;
    if (!extra.has(type)) extra.set(type, []);
    extra.get(type).push([a, b, d, c.force]);
  }
  if (verts.length > 32767) throw new Error(`too many collision vertices (${verts.length}, the game allows 32767)`);
  const HAS_FORCE = new Set([0x0004, 0x000E, 0x0024, 0x0025, 0x0027, 0x002C, 0x002D]);
  s.align(4).label(label);
  s.s16(COL.VERTICES).s16(verts.length);
  for (const v of verts) s.s16(v[0]).s16(v[1]).s16(v[2]);
  let tris = 0;
  const group = (type, list) => {
    for (let i = 0; i < list.length; i += 8000) {
      const part = list.slice(i, i + 8000);
      s.s16(type).s16(part.length);
      for (const t of part) { s.s16(t[0]).s16(t[1]).s16(t[2]); if (HAS_FORCE.has(type)) s.s16(t[3] || 0); }
      tris += part.length;
    }
  };
  for (const g of col.groups) group(g.type, g.tris);
  for (const [type, list] of extra) group(type, list);
  s.s16(COL.CONTINUE);
  if (specials.length) {
    s.s16(0x43).s16(specials.length);
    for (const sp of specials) { s.s16(sp.preset); for (const v of sp.shorts) s.s16(v); }
  }
  if (col.env.length) {
    s.s16(COL.ENVIRONMENT).s16(col.env.length);
    for (const e of col.env) for (const v of e) s.s16(v);
  }
  s.s16(COL.END);
  return tris;
}

// The studio's camera modes (worldflow.js CAMERA_MODES) as the game's
const CAMERA = { default: 1, open: 16, radial: 1, close: 4, '8dir': 14, behind: 3, slide: 9, boss: 11 };
// weather (worldflow.js WEATHER) as the game's environment effects
const ENVFX = { none: 0, snow: 1, snow_water: 2, blizzard: 3, petals: 11, leaves: 11, lava_bubbles: 12 };

// An area's environment (settings.env) for the ROM: { lights: [ambient, colour, direction], envfx, camera }
export function envOf(env, issue = () => {}) {
  const l = env.light || {};
  const rgb = typeof l.color === 'string' ? parseInt(l.color.replace('#', ''), 16) : (l.color ?? 0xFFFFFF);
  const col = [(rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF];
  const amb = Math.max(0, Math.min(1, l.ambient ?? 0.42));
  const yaw = ((l.yaw ?? 45) * Math.PI) / 180, pitch = ((l.pitch ?? 57) * Math.PI) / 180;
  const dir = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)].map((v) => Math.round(v * 120) & 0xFF);
  const weather = env.weather || 'none';
  if (!(weather in ENVFX)) issue(`its weather (${weather}) is not in the ROM yet`);
  const mode = env.camera?.mode || 'default';
  if (!(mode in CAMERA)) issue(`its camera (${mode}) is not in the ROM yet: it gets the normal camera`);
  // tint: the web build multiplies what it draws; here the vertex colours and the sun
  const th = typeof l.tint === 'string' ? parseInt(l.tint.replace('#', ''), 16) : (l.tint ?? 0xFFFFFF);
  const tint = th === 0xFFFFFF ? null : [(th >> 16) & 0xFF, (th >> 8) & 0xFF, th & 0xFF].map((c) => c / 255);
  const lit = tint ? col.map((c, k) => Math.round(c * tint[k])) : col;
  return {
    lights: [lit.map((c) => Math.round(c * amb)), lit, dir],
    fog: fogOf(env.fog),
    tint,
    envfx: ENVFX[weather] ?? 0,
    camera: CAMERA[mode] ?? 1,
  };
}

// The area's geo layout: background, camera, the level's chunks, objects, weather.
function writeAreaGeo(s, name, mesh, sky, sym, env) {
  s.align(4).label(name);
  geo.screenArea(s, 10, 160, 120, 160, 120);
  geo.open(s);
  geo.zbuffer(s, 0);
  geo.open(s);
  geo.ortho(s, 100);
  geo.open(s);
  geo.background(s, sky, sym('geo_skybox_main'));
  geo.close(s);
  geo.close(s);
  geo.zbuffer(s, 1);
  geo.open(s);
  geo.frustumWithFunc(s, 45, 100, 32000, sym('geo_camera_fov'));
  geo.open(s);
  geo.camera(s, env.camera, 0, 2000, 6000, 0, 0, 0, sym('geo_camera_main'));
  geo.open(s);
  mesh.geo(s);
  geo.renderObj(s);
  geo.asm(s, env.envfx, sym('geo_envfx_main'));
  geo.close(s);
  geo.close(s);
  geo.close(s);
  geo.zbuffer(s, 0);
  geo.open(s);
  geo.asm(s, 0, sym('geo_cannon_circle_base'));
  geo.close(s);
  geo.close(s);
  geo.end(s);
}
