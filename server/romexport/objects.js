// A level's object records -> the objects its level script places, the models and actor banks they
// need, the props to bake into the level geometry, and what cannot go into the ROM.
import { getEntry, friendlyName, catalog } from '../catalog.js';
import { bankSlot } from './decompindex.js';
import { RENAMES } from './base.js';
import { OVERLAYS, NINTENDO_IDS } from './overlays.js';
import { KINDS } from '../../web/js/paths/nature.js';

const deg = (v) => Math.round(((((v | 0) % 65536) + 65536) % 65536) / 65536 * 360) % 360;

// Studio 64's own objects: they need its code (a module of the base ROM, overlays.js)
const STUDIO_IDS = /^(sms|sg|kt|vehicle|tokyo):/;
// behaviors that stand still: when their model only exists in a level, the prop is baked in
const STATIC_BHV = new Set(['bhvStaticObject', 'bhvRockSolid', 'bhvStaticCheckeredPlatform']);
// Studio 64's behaviors the ROM has (n64/s64_behaviors.inc): placed with a catalog model as their look
const STUDIO_BHV = new Set(['bhvStudioActor', 'bhvStudioNpc', 'bhvStudioKey']);
// Studio 64's own objects that are only scenery: baked in too
const STUDIO_SCENERY = new Set(['tokyo:city']);

// the game's own trees of the nature brush (web/js/paths): objects in the ROM as in the browser
const GAME_TREES = new Map(KINDS.filter((k) => k.type === 'sm64').map((k) => [k.id, k]));
const treesOf = ({ area, rec }) => (rec.nature?.items || []).filter((it) => GAME_TREES.has(it[0])).map((it) => ({ area, rec: {
  entry: GAME_TREES.get(it[0]).entry, name: GAME_TREES.get(it[0]).label, uid: 0, x: it[1], y: it[2], z: it[3],
  yaw: Math.round(((it[4] || 0) / 360) * 65536), scale: (it[5] || 100) / 100,
} }));

// records: one level's records from all its areas, [{ area, rec }]; ix: the base ROM's index
// -> { perArea: Map(area -> [{ model, x, y, z, ax, ay, az, bparams, bhv, name, uid }]), models: [[MODEL, geo]],
//      groups: { a, b }, bake: Map(area -> [uid]), movers: Map(area -> [record]), issues: [],
//      spawns: Map(area -> [{ index, x, y, z, pitch, yaw, roll, bparams, uid, scale }]) (module objects, made
//      when the area loads), modules: Set(module name) }
// opts: { groups: the banks an original level loads (fixed), ownLevel: its folder (its models are loaded) }
export function mapObjects(records, ix, { groups: fixed = null, ownLevel = null } = {}) {
  const geoBank = (g) => ix.geoBank[g];
  const issues = [];
  const perArea = new Map();
  const bake = new Map();
  const models = new Map();
  const want = new Map(); // bank -> number of objects needing it
  const pending = [];

  const issue = (rec, what, why) => issues.push({ uid: rec.uid, name: rec.name || what, what, why });

  const movers = new Map(); // area -> [records]: blocks and models that move are objects of their own
  const spawns = new Map(), modules = new Set();
  // Studio 64's modules: the one of a catalog entry, of a behavior the game does not have itself
  const moduleOfEntry = (id) => OVERLAYS.find((m) => m.ids.test(id || '')) || null;
  const moduleOfBehavior = (bhv) => (bhv in ix.symbols ? null : moduleOfEntry(catalog.entries.find((x) => x.behavior === bhv && STUDIO_IDS.test(x.id))?.id));
  const kitModule = (ov) => (ix.modules?.list || []).find((m) => m.name === ov.name);
  const moduleSpawns = []; // [{ area, rec, spawn, mods }]: placed once the level's banks are known
  const spawnModuleObject = (area, rec, mods, spawn) => {
    if (mods.some((m) => !kitModule(m))) { issue(rec, rec.name || friendlyName(rec.entry || rec.model || ''), 'uses Studio 64\'s own code (not in this base ROM)'); return; }
    for (const m of mods) for (const b of kitModule(m).banks || []) want.set(b, (want.get(b) || 0) + 1);
    moduleSpawns.push({ area, rec, mods, spawn: { x: rec.x, y: rec.y, z: rec.z, pitch: rec.pitch | 0, yaw: rec.yaw | 0, roll: rec.roll | 0,
      bparams: (rec.bparams >>> 0) || 0, uid: rec.uid >>> 0, scale: rec.scale > 0 ? rec.scale : 1, ...spawn } });
  };
  // roads, fences and plants are drawn by the area's own geometry (the engine's dump has them)
  records = records.flatMap((r) => (r.rec.road || r.rec.line || r.rec.nature ? treesOf(r) : [r]));
  for (const { area, rec } of records) {
    if (rec.block || rec.asset) {
      if (rec.motion && !rec.zone) {
        if (!movers.has(area)) movers.set(area, []);
        movers.get(area).push(rec);
      }
      continue; // (the others are part of the level geometry)
    }
    if (STUDIO_SCENERY.has(rec.entry)) {
      if (!bake.has(area)) bake.set(area, []);
      bake.get(area).push(rec.uid);
      continue;
    }
    if ((rec.entry && NINTENDO_IDS.test(rec.entry)) || (!rec.entry && rec.model && NINTENDO_IDS.test(rec.model)) || /^bhvSms/.test(rec.bhv || '')) {
      issue(rec, rec.name || friendlyName(rec.entry || rec.model || ''), 'is a Sunshine character: Nintendo\'s model, which a ROM hack you share must not contain');
      continue;
    }
    if (rec.entry && STUDIO_IDS.test(rec.entry)) {
      const e = getEntry(rec.entry);
      if (!e) { issue(rec, rec.name || rec.entry, 'unknown object'); continue; }
      spawnModuleObject(area, rec, [moduleOfEntry(rec.entry)], { index: e.index });
      continue;
    }
    // a behavior with a catalog model as its look, either of them from a module: made by the area too
    if (!rec.entry && rec.bhv && !rec.warp) {
      const look = rec.model ? getEntry(rec.model) : null;
      const mods = [...new Set([moduleOfBehavior(rec.bhv), look && moduleOfEntry(look.id)].filter(Boolean))];
      if (mods.length) {
        const bhv = catalog.behaviors.indexOf(rec.bhv);
        if (bhv < 0) { issue(rec, rec.name || rec.bhv, 'its behavior is not in the catalog'); continue; }
        spawnModuleObject(area, rec, mods, { custom: true, bhv, model: look ? look.index : -1 });
        continue;
      }
    }
    // Studio 64's own objects that the ROM runs (the engine's code): their look is a catalog model
    let e = null;
    if (!rec.entry && STUDIO_BHV.has(rec.bhv)) {
      const look = rec.model ? getEntry(rec.model) : null;
      e = { id: rec.model || rec.bhv, behavior: rec.bhv, model: look?.model || 'MODEL_NONE', gfx: look?.gfx || null };
    } else if (!rec.entry) {
      if (rec.warp && rec.warp.kind !== 'pipe') { /* doors, paintings: rom.js writes them */ }
      else if (/^bhvStudio/.test(rec.bhv || '')) issue(rec, rec.name || rec.bhv, 'uses Studio 64\'s own code (not in the ROM yet)');
      else issue(rec, rec.name || rec.bhv || 'object', 'not supported in the ROM yet');
      continue;
    }
    e ||= getEntry(rec.entry);
    // (the catalog has the names of the engine's older decomp)
    if (e) e = { ...e, behavior: RENAMES[e.behavior] || e.behavior, model: RENAMES[e.model] || e.model, gfx: RENAMES[e.gfx] || e.gfx };
    if (!e) { issue(rec, rec.name || rec.entry, 'unknown object'); continue; }
    const bank = e.gfx ? geoBank(e.gfx) : null;
    // models of a level's own (its geo is not loaded in the hack's levels): props are baked in
    if (bank && bank.startsWith('level:') && bank !== `level:${ownLevel}`) {
      if (STATIC_BHV.has(e.behavior)) {
        if (!bake.has(area)) bake.set(area, []);
        bake.get(area).push(rec.uid);
      } else {
        issue(rec, rec.name || friendlyName(rec.entry), `its model only exists in ${bank.slice(6).toUpperCase()}`);
      }
      continue;
    }
    if (!(e.behavior in ix.symbols)) { issue(rec, rec.name || friendlyName(rec.entry), `its behavior (${e.behavior}) is not in the ROM`); continue; }
    if (bank && /^group\d+$/.test(bank)) want.set(bank, (want.get(bank) || 0) + 1);
    pending.push({ area, rec, e, bank });
  }

  // one bank per segment: the one most objects need (an original level keeps its own)
  const groups = fixed || {};
  if (!fixed) {
    for (const slot of ['a', 'b']) {
      const best = [...want].filter(([b]) => bankSlot(b) === slot).sort((x, y) => y[1] - x[1])[0];
      if (best) groups[slot] = { name: best[0], func: ix.funcOfBank[best[0]] };
    }
  }
  const loaded = new Set([groups.a?.name, groups.b?.name, 'common0', 'common1', 'group0', ownLevel && `level:${ownLevel}`]);

  for (const { area, rec, mods, spawn } of moduleSpawns) {
    const missing = mods.flatMap((m) => kitModule(m).banks || []).filter((b) => !loaded.has(b));
    if (missing.length) {
      issue(rec, rec.name || friendlyName(rec.entry || rec.model || ''), `needs the ${missing.join(' and ')} enemies, but this level ${fixed ? 'loads' : 'already uses'} ${[groups.a?.name, groups.b?.name].filter(Boolean).join(' and ') || 'other ones'} (the N64 loads one bank of each kind per level)`);
      continue;
    }
    for (const m of mods) modules.add(m.name);
    if (!spawns.has(area)) spawns.set(area, []);
    spawns.get(area).push(spawn);
  }

  for (const { area, rec, e, bank } of pending) {
    if (bank && !loaded.has(bank)) {
      issue(rec, rec.name || friendlyName(rec.entry), `needs the ${bank} enemies, but this level ${fixed ? 'loads' : 'already uses'} ${[groups.a?.name, groups.b?.name].filter(Boolean).join(' and ') || 'other ones'} (the N64 loads one bank of each kind per level)`);
      continue;
    }
    const model = e.model && e.model !== 'MODEL_NONE' ? e.model : 'MODEL_NONE';
    if (model !== 'MODEL_NONE' && !(model in ix.models)) { issue(rec, rec.name || friendlyName(rec.entry), `unknown model ${model}`); continue; }
    // models of the always-loaded banks that no global script loads
    if (model !== 'MODEL_NONE' && e.gfx && (bank === 'common0' || bank === 'common1' || bank === 'group0')
        && ix.globalModels[model] !== e.gfx) models.set(model, e.gfx);
    if (!perArea.has(area)) perArea.set(area, []);
    perArea.get(area).push({
      model, x: Math.round(rec.x), y: Math.round(rec.y), z: Math.round(rec.z),
      ax: deg(rec.pitch), ay: deg(rec.yaw), az: deg(rec.roll), bparams: (rec.bparams >>> 0) || 0, bhv: e.behavior,
      name: rec.name || friendlyName(rec.entry), uid: rec.uid >>> 0, scale: rec.scale && rec.scale !== 1 ? rec.scale : 1,
    });
  }

  return { perArea, models: [...models], groups, bake, movers, issues, spawns, modules };
}
