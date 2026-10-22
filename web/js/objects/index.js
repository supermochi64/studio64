// Objects, motion, custom behaviours and gameplay rules: wires the feature into the app.
//
//   installObjectsEngine(...)  before the engine boots: spawn hook, level hook, rules, RPCs
//   installObjectsEditor(...)  once build mode exists: inspector, path tool, scene panel,
//                              custom object builder, My objects, Game panel
//
// Other features can use window.studio64Objects (see docs/objects.md).

import { Store, el, esc, svg, newUid, deepCopy, levelKeyOf, GAME_KEY } from './common.js';
import { applyMotion, applyPathOverrides, normalizeMotion, objectPathInfo, MotionUI, MOTION_DEFAULTS, isActor } from './motion.js';
import { applyActor, actorRecord, normalizeDef, ActorBuilder, ACTOR_TEMPLATES } from './actors.js';
import { GameRules, effectiveRules } from './game_rules.js';
import { Placer, placeItems, relativeItems } from './placer.js';
import { ScenePanel } from './scene.js';
import { askConfirm } from '../dialogs.js';
import { registerRpc } from '../studio.js';
import { installShotgun } from '../shotgun.js';
import { installKatana, installKatanaEditor } from '../katana.js';
import { installVehicles, installVehiclesEditor } from '../vehicles.js';

const EVENTS = { 1: 'defeated', 2: 'hurt_mario', 3: 'spotted', 4: 'hit' };

export function installObjectsEngine({ engine, studio, send, toast, flash }) {
  const store = new Store({ engine, send, toast, flash });
  const ctx = { engine, studio, store, toast, listeners: [] };
  const defs = () => store.game('objdefs', []);
  ctx.defs = defs;
  // every definition seen in this session: copies whose definition was undone keep behaving
  const knownDefs = new Map();
  const remember = (list) => { for (const d of list || []) knownDefs.set(d.id, d); };
  const actorDefs = () => {
    const list = defs();
    remember(list);
    const extra = [...knownDefs.values()].filter((d) => !list.some((x) => x.id === d.id));
    return extra.length ? [...list, ...extra] : list;
  };
  ctx.rules = new GameRules({ engine, store, toast, levelName: () => studio.levelName(engine.level) });

  // every spawned record gets its motion, custom behaviour and mover collision
  const spawn = engine._spawnRecord.bind(engine);
  engine._spawnRecord = (rec) => {
    const slot = spawn(rec);
    if (slot >= 0 && engine.M?._studio_motion_set) {
      try {
        if (rec.bhv === 'bhvStudioMover') engine.M._studio_mover_setup(slot, engine.entryIndex.get(rec.model) ?? -1, rec.pitch | 0, rec.roll | 0);
        // imported models (assets): drawn (and for movers, solid) once they are loaded
        if ((rec.bhv === 'bhvStudioActor' || rec.bhv === 'bhvStudioMover') && String(rec.model || '').startsWith('asset:')) {
          window.studio64?.assets?.ensureModel(rec.model.slice(6)).then((mslot) => {
            const o = engine.objects().find((x) => x.uid === rec.uid);
            if (o) engine.M._studio_object_asset_model?.(o.slot, mslot);
          }).catch((err) => console.warn('objects: imported model', err.message));
        }
        if (rec.bhv === 'bhvStudioActor') applyActor(engine, rec, slot, actorDefs());
        if (rec.motion) applyMotion(engine, rec, slot);
        if (rec.editor?.hidden && ctx.building) engine.M._studio_set_visible?.(slot, 0);
      } catch (err) { console.error('objects: spawn hook', err); }
    }
    return slot;
  };

  // a level loads: motions and custom objects start over, its paths and rules apply
  engine.levelHooks.push((level, area, key) => {
    const M = engine.M;
    if (!M?._studio_motion_reset_all) return;
    M._studio_motion_reset_all();
    M._studio_actors_reset?.();
    applyPathOverrides(engine, engine.patch.areas?.[key]?.paths);
    ctx.rules.onArea();
    M.studioObjectEvent ||= (uid, ev) => {
      const event = EVENTS[ev] || String(ev);
      const detail = { uid, event, record: store.recordOf(uid) };
      for (const fn of ctx.listeners) { try { fn(detail); } catch (err) { console.error(err); } }
      window.dispatchEvent(new CustomEvent('studio:object', { detail }));
    };
  });

  // the patch changed (here, by Claude, by someone else, undo): rules and custom objects follow
  const setPatch = engine.setPatch.bind(engine);
  let lastDefs = '', lastPaths = '';
  engine.setPatch = (patch) => {
    setPatch(patch);
    if (!engine.ready) return;
    try {
      ctx.rules.apply();
      const d = JSON.stringify(defs());
      if (d !== lastDefs) {
        const before = lastDefs ? JSON.parse(lastDefs) : null;
        lastDefs = d;
        if (before) { remember(before); respawnChangedActors(before, defs()); }
      }
      const key = engine.areaKey();
      const p = JSON.stringify(engine.patch.areas?.[key]?.paths || []);
      if (p !== lastPaths) { lastPaths = p; applyPathOverrides(engine, engine.patch.areas?.[key]?.paths); }
    } catch (err) { console.error('objects: patch', err); }
  };
  engine.on('ready', () => { lastDefs = JSON.stringify(defs()); ctx.rules.apply(); });

  function respawnChangedActors(before, after) {
    const changed = new Set();
    for (const d of after) if (JSON.stringify(d) !== JSON.stringify(before.find((x) => x.id === d.id))) changed.add(d.id);
    // definitions that went (an undo): their copies are spawned again with the one they had
    for (const d of before) if (!after.some((x) => x.id === d.id)) changed.add(d.id);
    if (!changed.size) return;
    for (const rec of store.records()) {
      if (!isActor(rec) || !changed.has(rec.def)) continue;
      const def = after.find((x) => x.id === rec.def);
      if (def) { rec.model = def.model; rec.scale = def.scale || 1; }
      engine.deleteUid(rec.uid);
      engine.spawn(rec);
    }
  }

  registerRpcs(ctx);
  ctx.shotgun = installShotgun({ engine, rules: ctx.rules }); // Shotgun Mario (../shotgun.js)
  ctx.katana = installKatana({ engine, rules: ctx.rules, store, studio, toast }); // Katana Mario and the fighters (../katana.js)
  ctx.vehicles = installVehicles({ engine, studio, store, toast }); // cars and races (../vehicles.js)

  // for other features (events, story): find, start and change things by uid
  window.studio64Objects = {
    on: (fn) => ctx.listeners.push(fn),
    trigger: (uid) => engine.M._studio_motion_trigger(uid >>> 0),
    setMotion: (uid, motion) => {
      const rec = store.recordOf(uid);
      const o = engine.objects().find((x) => x.uid === uid);
      if (!rec || !o) return false;
      rec.motion = normalizeMotion(motion);
      return applyMotion(engine, rec, o.slot);
    },
    defs,
    spawnDef: (defId, p, yaw = 0) => {
      const def = defs().find((x) => x.id === defId || x.name === defId);
      if (!def) return null;
      const rec = actorRecord(def, p, yaw, newUid());
      return { record: rec, slot: engine.spawn(rec) };
    },
    rules: () => effectiveRules(ctx.rules.rules(), levelKeyOf(engine)),
  };
  return ctx;
}

// ---------------------------------------------------------------------------
// Claude's tools (server/tools/objects.js) call these in the browser.

function registerRpcs(ctx) {
  const { engine, store } = ctx;
  const find = (studio, { uid, slot }) => studio.findObject({ uid, slot });

  // Original objects become owned copies first (like the editor does).
  function adopt(studio, o, fields = {}) {
    if (o.cat < 0) throw new Error('this object cannot be changed (unknown model); remove it and place a new one');
    const r = studio.remove({ slots: [o.slot] });
    const rec = { uid: newUid(), entry: studio.catalog.entries[o.cat].id, x: o.x, y: o.y, z: o.z, yaw: o.yaw & 0xffff, pitch: o.pitch | 0, roll: o.roll | 0, bparams: o.bparams >>> 0, scale: o.scale || 1, name: studio.nameOfObject(o), ...fields };
    return { rec, rules: r.rules };
  }

  registerRpc('objects_attach_motion', function ({ uid, slot, motion, replace = false }) {
    const s = this.mario();
    const o = find(this, { uid, slot });
    if (!o) throw new Error('no such object (use list_scene or list_objects for uid/slot)');
    let rec = this.recordOf(o.uid);
    motion = { ...(motion || {}) };
    // a path given in level coordinates: offsets from the object
    if (motion.path?.absolute?.length) {
      const base = rec ? [rec.x, rec.y, rec.z] : [o.x, o.y, o.z];
      const pts = motion.path.absolute.map((p) => [Math.round(p.x - base[0]), Math.round((p.y ?? base[1]) - base[1]), Math.round(p.z - base[2])]);
      motion.path = { ...motion.path, points: [[0, 0, 0], ...pts.filter((q) => q.some((v) => v !== 0))] };
      delete motion.path.absolute;
    }
    for (const k of Object.keys(motion)) if (motion[k] === false || motion[k] === null) motion[k] = undefined;
    const merged = replace || !rec?.motion ? motion : { ...rec.motion, ...motion };
    for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
    const m = normalizeMotion(merged);
    const fields = { motion: m };
    const entry = rec?.entry || (o.cat >= 0 ? this.catalog.entries[o.cat].id : null);
    if (m && entry && !rec?.block && (!rec || rec.entry)) {
      let info = null;
      try { info = engine.json('studio_catalog_info_json', engine.entryIndex.get(entry)); } catch { /* old engine */ }
      if (info?.collision && info.surface) Object.assign(fields, { bhv: 'bhvStudioMover', model: entry, entry: null });
    }
    let adopted = null;
    if (!rec) {
      const a = adopt(this, o, fields);
      rec = a.rec;
      adopted = { record: rec, rules: a.rules };
    } else {
      Object.assign(rec, fields);
      engine.deleteUid(rec.uid);
    }
    engine.spawn(rec);
    return { level: s.level, area: s.area, key: engine.areaKey(), uid: rec.uid, fields, record: rec, adopted, name: rec.name };
  });

  registerRpc('objects_path_info', function ({ uid, slot }) {
    const o = find(this, { uid, slot });
    if (!o) throw new Error('no such object');
    const ov = (store.area().paths || []).find((p) => p.bhv === o.bhv && Math.hypot(p.x - (o.hx || o.x), p.z - (o.hz || o.z)) < (p.r || 250));
    return { name: this.nameOfObject(o), info: objectPathInfo(engine, o.slot), override: ov || null };
  });

  registerRpc('objects_set_object_path', function ({ uid, slot, points, reset = false }) {
    const o = find(this, { uid, slot });
    if (!o) throw new Error('no such object');
    const info = objectPathInfo(engine, o.slot);
    if (!info && !o.uid) throw new Error(`${this.nameOfObject(o)} does not follow a path (only Koopa the Quick, the racing penguin, platforms on tracks and a few others do); use attach_motion instead`);
    const hx = o.hx || o.x, hz = o.hz || o.z;
    const list = (store.area().paths || []).filter((p) => !(p.bhv === o.bhv && Math.hypot(p.x - hx, p.z - hz) < (p.r || 250)));
    if (!reset) {
      if (!Array.isArray(points) || points.length < 2) throw new Error('give at least 2 points');
      const pts = points.map((p) => {
        const y = p.y ?? this.ground(p.x, p.z, 20000) ?? o.y;
        return [Math.round(p.x), Math.round(y), Math.round(p.z)];
      });
      list.push({ bhv: o.bhv, x: Math.round(hx), y: Math.round(o.hy || o.y), z: Math.round(hz), r: 250, uid: o.uid || 0, name: this.nameOfObject(o), points: pts });
    }
    applyPathOverrides(engine, list);
    // the project's own path objects start over on their new path right away
    const rec = o.uid ? this.recordOf(o.uid) : null;
    if (rec) { engine.deleteUid(rec.uid); engine.spawn(rec); }
    return { key: engine.areaKey(), paths: list, name: this.nameOfObject(o) };
  });

  // Places records given relative to an anchor (prefabs, custom objects).
  registerRpc('objects_place_records', function ({ items, where = {}, yaw_deg = 0, count = 1, spacing = 300, path_points }) {
    const s = this.mario();
    const n = Math.max(1, Math.min(count | 0 || 1, 30));
    const pts = this.points(where.mode || where.x !== undefined ? where : { distance: 400, ...where }, n);
    const yaw = Math.round(((yaw_deg % 360) / 360) * 65536) & 0xffff;
    const records = [];
    for (const p of pts) {
      for (const r of placeItems(items, [p.x, p.y, p.z], yaw)) {
        r.uid = newUid();
        if (Array.isArray(path_points) && path_points.length && isActor(r)) {
          const pts = path_points.map((q) => [Math.round(q.x - r.x), Math.round((q.y ?? r.y) - r.y), Math.round(q.z - r.z)]);
          r.motion = { path: { ...MOTION_DEFAULTS.path, mode: 'loop', wait: 0.5, points: [[0, 0, 0], ...pts] } };
        }
        if (engine.spawn(r) < 0) continue;
        records.push(r);
      }
    }
    void spacing;
    return { level: s.level, area: s.area, key: engine.areaKey(), records };
  });

  registerRpc('objects_records_of', function ({ uids = [], slots = [] }) {
    const objs = engine.objects();
    const recs = [];
    for (const o of objs) {
      if (!(uids.includes(o.uid) || slots.includes(o.slot))) continue;
      const rec = this.recordOf(o.uid);
      if (rec) recs.push(deepCopy(rec));
      else if (o.cat >= 0) recs.push({ entry: this.catalog.entries[o.cat].id, x: o.x, y: o.y, z: o.z, yaw: o.yaw & 0xffff, pitch: 0, roll: 0, bparams: o.bparams >>> 0, scale: o.scale || 1, name: this.nameOfObject(o) });
    }
    if (!recs.length) throw new Error('none of those objects are here');
    return { items: relativeItems(recs), count: recs.length };
  });

  // Group edits: align, distribute, move/turn a group, drop to the ground.
  registerRpc('objects_arrange', function ({ uids = [], slots = [], op, axis = 'x', where = 'center', dx = 0, dy = 0, dz = 0, yaw_deg = 0 }) {
    const s = this.mario();
    const ax = { x: 0, y: 1, z: 2 }[axis] ?? 0;
    const objs = engine.objects().filter((o) => uids.includes(o.uid) || slots.includes(o.slot));
    if (!objs.length) throw new Error('none of those objects are here');
    const mbs = objs.map((o) => { const rec = this.recordOf(o.uid); return { o, rec, p: rec ? [rec.x, rec.y, rec.z] : [o.x, o.y, o.z], yaw: (rec ? rec.yaw : o.yaw) & 0xffff }; });
    const targets = new Map();
    const size = (m) => (m.rec?.block ? [m.rec.block.sx, m.rec.block.sy, m.rec.block.sz][ax] : ax === 1 ? (m.o.h || 100) : (m.o.r || 60) * 2);
    const lowOf = (m) => (ax === 1 ? m.p[1] : m.p[ax] - size(m) / 2);
    if (op === 'align') {
      const lo = Math.min(...mbs.map(lowOf)), hi = Math.max(...mbs.map((m) => lowOf(m) + size(m)));
      for (const m of mbs) {
        const p = [...m.p], off = p[ax] - lowOf(m);
        p[ax] = where === 'min' ? lo + off : where === 'max' ? hi - size(m) + off : (lo + hi) / 2 - size(m) / 2 + off;
        targets.set(m, { p });
      }
    } else if (op === 'distribute') {
      mbs.sort((a, b) => a.p[ax] - b.p[ax]);
      const a = mbs[0].p[ax], b = mbs[mbs.length - 1].p[ax];
      mbs.forEach((m, i) => { const p = [...m.p]; p[ax] = a + ((b - a) * i) / Math.max(1, mbs.length - 1); targets.set(m, { p }); });
    } else if (op === 'drop') {
      for (const m of mbs) { const y = engine.floor(m.p[0], m.p[1] + 50, m.p[2]); if (y > -20000) targets.set(m, { p: [m.p[0], y, m.p[2]] }); }
    } else if (op === 'move' || op === 'rotate') {
      const cx = mbs.reduce((t, m) => t + m.p[0], 0) / mbs.length, cz = mbs.reduce((t, m) => t + m.p[2], 0) / mbs.length;
      const dyaw = Math.round((yaw_deg / 360) * 65536);
      const a = (dyaw / 32768) * Math.PI, c = Math.cos(a), sn = Math.sin(a);
      for (const m of mbs) {
        const rx = m.p[0] - cx, rz = m.p[2] - cz;
        targets.set(m, { p: [cx + rx * c + rz * sn + dx, m.p[1] + dy, cz - rx * sn + rz * c + dz], yaw: (m.yaw + dyaw) & 0xffff });
      }
    } else throw new Error(`unknown op ${op} (align, distribute, drop, move, rotate)`);
    const updates = [], adopted = [];
    for (const [m, t] of targets) {
      const fields = { x: Math.round(t.p[0]), y: Math.round(t.p[1]), z: Math.round(t.p[2]) };
      if (t.yaw !== undefined) fields.yaw = t.yaw;
      if (m.rec) {
        Object.assign(m.rec, fields);
        engine.transform(m.o.slot, fields.x, fields.y, fields.z, m.rec.pitch | 0, m.rec.yaw | 0, m.rec.roll | 0, m.rec.block ? 0 : m.rec.scale || 1);
        updates.push({ uid: m.rec.uid, fields });
      } else {
        const a = adopt(this, m.o, fields);
        engine.spawn(a.rec);
        adopted.push(a);
      }
    }
    return { level: s.level, area: s.area, key: engine.areaKey(), updates, adopted: { records: adopted.map((a) => a.rec), rules: adopted.flatMap((a) => a.rules) } };
  });

  registerRpc('objects_scene', function ({ query, kind, limit = 120 } = {}) {
    const m = this.mario().mario;
    const recs = store.records();
    const q = String(query || '').toLowerCase();
    const out = [];
    for (const o of engine.objects()) {
      if (o.uid >= 0x7f000000 || o.bhv === 'bhvMario') continue;
      const rec = o.uid ? recs.find((r) => r.uid === o.uid) : null;
      if (o.uid && !rec) continue;
      if (!rec && (o.parent >= 0 || /Particle|Sparkle|Puff|Smoke|Mist|SoundLoop|AmbientSounds|Dust|Splash|Bubble|Shard|Explosion|Trail|ShadowSpawn|bhvStudioTerrain|bhvStudioProjectile/.test(o.bhv))) continue;
      const k = rec?.block ? 'block' : isActor(rec) ? 'custom' : rec ? 'placed' : 'original';
      if (kind && kind !== k) continue;
      const name = rec?.name || this.nameOfObject(o);
      if (q && !(name + o.bhv).toLowerCase().includes(q)) continue;
      out.push({ uid: o.uid || undefined, slot: o.slot, name, kind: k, x: o.x, y: o.y, z: o.z, dist: Math.round(Math.hypot(o.x - m.x, o.z - m.z)),
        motion: rec?.motion ? Object.keys(rec.motion) : undefined, def: rec?.def, path_object: !rec && objectPathInfo(engine, o.slot) ? true : undefined,
        size: rec?.block ? [rec.block.sx, rec.block.sy, rec.block.sz] : undefined, locked: rec?.editor?.locked || undefined });
    }
    out.sort((a, b) => a.dist - b.dist);
    return { total: out.length, objects: out.slice(0, limit) };
  });

  registerRpc('objects_trigger', function ({ uid }) {
    return { started: engine.M._studio_motion_trigger(uid >>> 0) };
  });

  // For tests: the engine's view of a motion / custom object.
  registerRpc('objects_debug', function ({ slot, uid }) {
    const o = find(this, { uid, slot });
    if (!o) return null;
    return { object: o, motion: engine.json('studio_motion_state_json', o.slot), actor: engine.json('studio_actor_state_json', o.slot), rules: engine.json('studio_rules_json') };
  });
}

// ---------------------------------------------------------------------------
// Build mode UI.

export function installObjectsEditor(ctx, { editor, editorUI, catalog }) {
  const { engine, store, toast, studio } = ctx;
  const placer = new Placer({ engine, editor, store, toast });
  const motion = new MotionUI({ engine, editor, editorUI, store, toast });
  const builder = new ActorBuilder({
    engine, catalog, store, toast, thumbs: () => editorUI.thumbs || new Set(),
    onSaved: (def, { place }) => { renderMine(); if (place) placeDef(def); },
  });
  const scene = new ScenePanel({ engine, editor, editorUI, studio, store, placer, toast, actors: builder });
  ctx.motion = motion; ctx.scene = scene; ctx.placer = placer; ctx.builder = builder;

  function placeDef(def) {
    placer.start([actorRecord(def, [0, 0, 0], 0, 0)], { name: def.name, summary: `Placed ${def.name}` });
  }
  function placePrefab(p) {
    placer.start(p.items, { name: p.name, summary: `Placed the prefab “${p.name}”` });
  }

  // ---- editor events: the path tool, placing groups, the scene panel go first ----
  const wrap = (name, before, after) => {
    const orig = editor[name].bind(editor);
    editor[name] = (...args) => {
      if (before && before(...args)) return undefined;
      const r = orig(...args);
      if (after) after(...args);
      return r;
    };
  };
  const local = (e) => editor.local(e);
  wrap('onDown', (e) => {
    if (!editor.active) return false;
    const m = local(e);
    if (editor.navHit(m.x, m.y) || editor.navMode(e)) return false;
    scene.clearPending();
    if (placer.down(m, e)) { editor.downAt = { ...m, button: e.button, moved: false }; return true; }
    if (motion.down(m, e)) { editor.overlay.setPointerCapture(e.pointerId); editor.downAt = { ...m, button: e.button, moved: false }; return true; }
    return false;
  }, (e) => { if (editor.active) scene.afterDown(local(e), e); });
  wrap('onMove', (e) => {
    if (!editor.active) return false;
    const m = local(e);
    if (editor.downAt && Math.hypot(m.x - editor.downAt.x, m.y - editor.downAt.y) > 4) editor.downAt.moved = true;
    editor.mouse = m;
    if (editor.drag?.nav) return false;
    if (placer.move(m, e)) return true;
    if (motion.move(m, e)) return true;
    if (scene.move(m, e)) return true;
    return false;
  });
  wrap('onUp', (e) => {
    if (!editor.active) return false;
    const m = local(e);
    const click = editor.downAt && !editor.downAt.moved;
    scene.clearPending();
    if (editor.drag?.nav && !click) return false;
    let handled = placer.up(m, e, click) || motion.up(m, e, click) || scene.up(m, e, click);
    if (handled) {
      if (editor.downAt?.moved) editor.suppressClickUntil = performance.now() + 250;
      editor.drag = null;
      editor.downAt = null;
    }
    return handled;
  });
  wrap('onKey', (e, down) => {
    if (!editor.active || editor.typing()) return false;
    return placer.key(e, down) || motion.key(e, down) || scene.onKey(e, down);
  });
  wrap('draw', null, () => {
    if (!editor.active || !editor.camData) return;
    const g = editor.ctx;
    motion.draw(g);
    scene.draw(g);
  });
  // group transforms: the others follow the selected one
  wrap('applyPose', () => { scene.groupBefore(); return false; }, (pose) => scene.groupApply(pose));
  // names given in the scene panel show in the inspector too
  const describe = editor.describe.bind(editor);
  editor.describe = (o) => { const d = describe(o); if (d.rec?.label) d.name = d.rec.label; return d; };
  wrap('commitPose', (pose, summary) => scene.groupCommitAll(pose, summary || 'Moved'), (pose, summary) => scene.groupCommit(pose, summary || 'Moved'));
  wrap('deleteSelected', () => { if (scene.isGroup()) { scene.deleteGroup(); return true; } return false; });
  wrap('duplicateSelected', () => { if (scene.isGroup()) { scene.duplicateGroup(); return true; } return false; });
  wrap('exit', () => { placer.cancel(); motion.stopEdit(); scene.applyHidden(false); ctx.building = false; scene.toggle(false); return false; });
  wrap('enter', null, () => { ctx.building = editor.active; if (editor.active) scene.applyHidden(true); });

  // selection: the path tool and the multi-selection follow it
  const onSelect = editor.ui.onSelect;
  editor.ui.onSelect = (sel) => { motion.onSelect(sel); scene.onSelect(sel); onSelect(sel); };
  const onToolChange = editor.ui.onToolChange;
  editor.ui.onToolChange = () => { onToolChange(); if (motion.edit) motion.hint(); if (placer.active) placer.hint(); };

  // ---- inspector: the Motion section ----
  const renderInspector = editorUI.renderInspector.bind(editorUI);
  editorUI.renderInspector = (sel) => {
    renderInspector(sel);
    const box = document.querySelector('#inspector');
    if (!sel || !editor.active || box.hidden) return;
    try {
      const actions = box.querySelector('.insp-actions');
      const sec = motion.section(box, sel);
      if (sec) box.insertBefore(sec, actions);
      if (isActor(sel.rec)) box.insertBefore(actorSection(sel), sec || actions);
      if (scene.isGroup()) box.insertBefore(el('div', 'om-group-note', `${svg('layers')}<span><b>${scene.multi.size} selected</b>: moving or turning this one moves them all. Align and more in the scene panel (<kbd>O</kbd>).</span>`), box.querySelector('.insp-sec'));
    } catch (err) { console.error('objects: inspector', err); }
  };

  function actorSection(sel) {
    const def = ctx.defs().find((d) => d.id === sel.rec.def);
    const sec = el('div', 'insp-sec');
    sec.innerHTML = `<div class="insp-label">Custom object</div><div class="om-note">${def ? `An instance of <b>${esc(def.name)}</b>. Changing it changes every copy.` : 'Its definition was deleted.'}</div>
      ${def ? `<div class="btn-row"><button class="btn sm primary" data-a="edit">${svg('edit')}Edit behavior</button></div>` : ''}`;
    const b = sec.querySelector('[data-a=edit]');
    if (b) b.onclick = () => builder.open(def, { place: false });
    return sec;
  }

  // ---- library: My objects ----
  const cats = document.querySelector('#obj-cats');
  const mineChip = el('button', 'chip mine-chip', `${svg('prefab')}My objects`);
  mineChip.onclick = () => {
    editorUI.objCat = 'mine';
    cats.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === mineChip));
    editorUI.renderObjects();
  };
  cats.prepend(mineChip);
  const renderObjects = editorUI.renderObjects.bind(editorUI);
  editorUI.renderObjects = () => {
    if (editorUI.objCat !== 'mine') { mineChip.classList.remove('active'); return renderObjects(); }
    renderMine();
    return undefined;
  };

  function renderMine() {
    if (editorUI.objCat !== 'mine') return;
    const grid = document.querySelector('#obj-grid');
    const q = document.querySelector('#obj-search').value.trim().toLowerCase();
    grid.innerHTML = '';
    const add = el('button', 'obj mine-new', `<span class="thumb">${svg('plus', 'i')}</span><span class="obj-name">New custom object</span>`);
    add.title = 'Build an enemy or character from a model and behavior blocks';
    add.onclick = () => builder.open(null);
    grid.appendChild(add);
    const thumbs = editorUI.thumbs || new Set();
    const item = (cls, thumbHtml, name, title, onPlace, onEdit, onDelete, onDup) => {
      const b = el('div', `obj mine ${cls}`);
      b.tabIndex = 0;
      b.innerHTML = `<span class="thumb">${thumbHtml}</span><span class="obj-name">${esc(name)}</span><span class="mine-acts">
        ${onEdit ? `<button data-m="edit" title="Edit">${svg('edit')}</button>` : ''}${onDup ? `<button data-m="dup" title="Duplicate">${svg('copy')}</button>` : ''}<button data-m="del" title="Delete">${svg('trash')}</button></span>`;
      b.title = title;
      b.onclick = (e) => { if (!e.target.closest('[data-m]')) onPlace(); };
      b.onkeydown = (e) => { if (e.key === 'Enter') onPlace(); };
      b.querySelector('[data-m=del]').onclick = onDelete;
      if (onEdit) b.querySelector('[data-m=edit]').onclick = onEdit;
      if (onDup) b.querySelector('[data-m=dup]').onclick = onDup;
      grid.appendChild(b);
    };
    for (const d of ctx.defs().filter((x) => !x.deleted && (!q || x.name.toLowerCase().includes(q)))) {
      const img = thumbs.has(d.model) ? `<img alt="" src="thumbs/${encodeURIComponent(d.model.replace(/:/g, '__'))}.webp">` : svg('enemy', 'i');
      item('def', img, d.name, `${d.name}: click, then click in the level`, () => placeDef(d), () => builder.open(d, { place: false }),
        async () => { if (await askConfirm({ title: `Delete “${d.name}”?`, text: 'It goes from My objects. Copies in your levels stay.', ok: 'Delete', danger: true })) { store.setGame('objdefs', ctx.defs().map((x) => (x.id === d.id ? { ...x, deleted: true } : x)), `Deleted the custom object “${d.name}”`); renderMine(); } },
        () => { const c = { ...deepCopy(d), id: Math.random().toString(36).slice(2, 10), name: `${d.name} copy` }; store.setGame('objdefs', [...ctx.defs(), c], `Duplicated “${d.name}”`); renderMine(); });
    }
    for (const p of store.game('prefabs', []).filter((x) => !q || x.name.toLowerCase().includes(q))) {
      item('prefab', `${svg('prefab', 'i')}<em>${p.items.length}</em>`, p.name, `${p.name}: ${p.items.length} things`, () => placePrefab(p), null,
        async () => { if (await askConfirm({ title: `Delete the prefab “${p.name}”?`, ok: 'Delete', danger: true })) { store.setGame('prefabs', store.game('prefabs', []).filter((x) => x.id !== p.id), `Deleted the prefab “${p.name}”`); renderMine(); } });
    }
    if (!ctx.defs().filter((x) => !x.deleted).length && !store.game('prefabs', []).length) {
      grid.appendChild(el('div', 'lib-tip mine-tip', 'Make your own enemies with <b>New custom object</b>, or select things in the level and <b>Save as prefab</b> (scene panel, <kbd>O</kbd>) to reuse them anywhere.'));
    }
  }
  ctx.renderMine = renderMine;
  // the library follows the project's data
  const setPatch = engine.setPatch;
  engine.setPatch = (p) => { setPatch(p); if (editorUI.objCat === 'mine') renderMine(); };

  // ---- the Game button ----
  const gameBtn = el('button', 'btn ghost', `${svg('gamepad', 'i')}<span class="hide-sm">Game</span>`);
  gameBtn.id = 'game-btn';
  gameBtn.title = 'Game rules: physics, moves, lives, coins, HUD (P)';
  gameBtn.onclick = () => ctx.rules.open();
  const soundBtn = document.querySelector('#sound-btn');
  soundBtn?.parentNode.insertBefore(gameBtn, soundBtn);
  ctx.rules.onPlay = () => { if (editor.active) editor.exit(); document.querySelector('#canvas')?.focus(); };
  window.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    // in build mode P is "play from here" (testing.js); the rail and Ctrl+P reach the rules there
    if (!typing && e.code === 'KeyP' && !e.ctrlKey && !e.metaKey && !e.altKey && !ctx.rules.isOpen() && !editor.active && !document.querySelector('.game-frame.playing')) {
      e.preventDefault();
      ctx.rules.open();
    }
  });

  installVehiclesEditor(ctx, { editor, editorUI }); // the Car and Race sections (../vehicles.js)
  installKatanaEditor(ctx, { editor, editorUI }); // the duel's reward star (../katana.js)
  return ctx;
}

export { ACTOR_TEMPLATES, MOTION_DEFAULTS, normalizeDef, GAME_KEY };
