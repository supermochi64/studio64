// Claude's tools for objects, motion, custom behaviours and gameplay rules.
// The browser does the placement work (web/js/objects/index.js registers the rpc
// methods); project-wide data (rules, custom object definitions, prefabs) lives in
// the patch area "@game", per-level paths of original objects in the area's `paths`.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
let sSounds = null;
function soundId(v) {
  if (v === undefined || v === null || v === '') return v;
  sSounds ||= JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'web', 'data', 'sounds.json'), 'utf8'));
  const t = String(v).toLowerCase().trim();
  const hit = sSounds.find((x) => x.id.toLowerCase() === t) || sSounds.find((x) => x.name.toLowerCase() === t)
    || sSounds.find((x) => x.name.toLowerCase().startsWith(t)) || sSounds.find((x) => `${x.group} ${x.name}`.toLowerCase().includes(t));
  return hit ? hit.id : undefined;
}
const newId = () => crypto.randomBytes(5).toString('base64url');

export default ({ tool, z, card, rpc, commit, text, where, opts, project: p, projects, agent, findCustom, levelByKey, getEntry }) => {
  const GAME = '@game';
  const game = (field, fallback) => p.areas[GAME]?.[field] ?? fallback;
  const setGame = (field, value, summary) => {
    const change = projects.updateArea(p, GAME, field, value, summary);
    agent.hub.patchChanged(p, agent.turn?.client, { key: GAME, reloadArea: true });
    return change;
  };
  const findDef = (q) => {
    const s = String(q || '').toLowerCase();
    const list = game('objdefs', []).filter((d) => !d.deleted);
    return list.find((d) => d.id === q) || list.find((d) => d.name.toLowerCase() === s) || list.find((d) => d.name.toLowerCase().includes(s));
  };
  const findPrefab = (q) => {
    const s = String(q || '').toLowerCase();
    const list = game('prefabs', []);
    return list.find((d) => d.id === q) || list.find((d) => d.name.toLowerCase() === s) || list.find((d) => d.name.toLowerCase().includes(s));
  };
  const modelOk = (id) => {
    if (!id) return false;
    if (String(id).startsWith('asset:')) {
      const a = String(id).slice(6).toLowerCase();
      return (p.assets?.models || []).some((m) => m.id.toLowerCase() === a || m.name.toLowerCase() === a);
    }
    try { return !!getEntry(id); } catch { return false; }
  };

  const point = z.object({ x: z.number(), y: z.number().optional(), z: z.number() });
  const motion = z.object({
    path: z.object({
      absolute: z.array(point).optional().describe('points in level coordinates; the object itself is the first point'),
      points: z.array(z.array(z.number())).optional().describe('or offsets [[dx,dy,dz],...] from the object, first [0,0,0]'),
      speed: z.number().optional().describe('units per frame (Mario runs ~32); default 8'),
      mode: z.enum(['pingpong', 'loop', 'once']).optional().describe('back & forth (default), loop back to the start, once'),
      wait: z.number().optional().describe('seconds to wait at each point'),
      smooth: z.boolean().optional().describe('curve through the points'),
      trigger: z.enum(['always', 'stand', 'while_standing', 'near', 'event']).optional().describe('when it moves: always, after Mario stands on it, only while he stands on it (elevator: returns when he leaves), when he comes near, when an event starts it'),
      radius: z.number().optional().describe('trigger near: distance'),
      phase: z.number().optional().describe('0..1 start offset along the path (stagger copies)'),
      face: z.boolean().optional().describe('turn to face the direction it moves'),
    }).optional(),
    rotate: z.object({ yaw: z.number().optional(), pitch: z.number().optional(), roll: z.number().optional() }).optional().describe('spin in degrees per second around each axis'),
    swing: z.object({ axis: z.enum(['roll', 'pitch', 'yaw']).optional(), angle: z.number().optional(), period: z.number().optional().describe('seconds'), pivot: z.number().optional().describe('hangs from this far above (pendulum)'), phase: z.number().optional() }).optional(),
    tilt: z.object({ angle: z.number().optional(), speed: z.number().optional() }).optional().describe('seesaw: tilts toward where Mario stands'),
    fall: z.object({ delay: z.number().optional(), respawn: z.number().optional().describe('seconds until it is back, 0 never') }).optional().describe('falls after Mario stands on it'),
    crumble: z.object({ delay: z.number().optional(), respawn: z.number().optional() }).optional().describe('breaks when Mario stands on it'),
    blink: z.object({ on: z.number().optional(), off: z.number().optional(), phase: z.number().optional() }).optional().describe('seconds visible / gone'),
    conveyor: z.object({ speed: z.number().optional(), dir: z.number().optional().describe('degrees relative to the block') }).optional(),
    bounce: z.object({ power: z.number().optional().describe('upward speed, default 85') }).optional().describe('trampoline'),
    sink: z.object({ depth: z.number().optional() }).optional().describe('sinks while Mario stands on it'),
  });

  const actorFields = {
    name: z.string().optional(),
    model: z.string().optional().describe('catalog id of any model (search_catalog), e.g. goomba, koopa, boo, bobomb, spiny, sms:pianta; or "asset:<id>" for an imported model (list_assets)'),
    scale: z.number().optional(),
    move: z.enum(['stand', 'wander', 'patrol', 'chase', 'turret']).optional(),
    speed: z.number().optional().describe('walk speed (goomba ~5)'), chaseSpeed: z.number().optional(),
    sight: z.number().optional().describe('sees Mario from this far'), leash: z.number().optional().describe('stays within this distance of home'),
    turn: z.number().optional().describe('degrees per frame'), fly: z.boolean().optional(), hover: z.number().optional(), faceMario: z.boolean().optional(),
    jump: z.enum(['none', 'hop', 'at_mario', 'walls']).optional(), jumpHeight: z.number().optional().describe('jump speed, 40 normal'), jumpEvery: z.number().optional().describe('seconds'),
    health: z.number().optional().describe('hits to defeat'), damage: z.number().optional().describe('health wedges Mario loses on contact (0..8)'),
    stomp: z.boolean().optional(), punch: z.boolean().optional().describe('punches and kicks defeat it'), invincible: z.boolean().optional(), knockback: z.boolean().optional(),
    defeat: z.enum(['poof', 'squish', 'explode', 'launch', 'shrink']).optional(), coins: z.number().optional(), coinKind: z.enum(['yellow', 'blue']).optional(),
    respawn: z.number().optional().describe('seconds until it comes back, 0 = stays defeated'),
    shoot: z.boolean().optional(), projectile: z.string().optional().describe('flame:red_flame, flame:blue_flame, prop:metallic_ball, prop:spiny_ball, prop:water_bomb, prop:bubble, prop:yoshi_egg'),
    fireEvery: z.number().optional().describe('seconds'), projSpeed: z.number().optional(), projDamage: z.number().optional(), projArc: z.number().optional().describe('gravity of the shot, 0 straight'), projScale: z.number().optional(), burns: z.boolean().optional(),
    sounds: z.object({ alert: z.string().optional(), hit: z.string().optional(), defeat: z.string().optional(), attack: z.string().optional() }).optional().describe('game sound names, e.g. "Goomba alert", "Koopa damage"'),
    hitR: z.number().optional(), hitH: z.number().optional(), anim: z.number().optional().describe('animation index of the model (0 = its main one)'),
  };
  const cleanDef = (a) => {
    const d = {};
    for (const k of Object.keys(actorFields)) if (a[k] !== undefined) d[k] = a[k];
    if (d.model && String(d.model).startsWith('asset:')) {
      const q = String(d.model).slice(6).toLowerCase();
      const m = (p.assets?.models || []).find((x) => x.id.toLowerCase() === q || x.name.toLowerCase() === q);
      if (m) d.model = `asset:${m.id}`;
    }
    if (d.sounds) for (const k of Object.keys(d.sounds)) d.sounds[k] = soundId(d.sounds[k]) ?? '';
    if (d.projectile && !modelOk(d.projectile)) delete d.projectile;
    return d;
  };

  const placeDef = async (def, a, summaryPrefix = 'Placed') => {
    const items = [{ bhv: 'bhvStudioActor', model: def.model, def: def.id, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, bparams: 0, scale: def.scale || 1, name: def.name }];
    const r = await rpc('objects_place_records', { items, where: a.where || {}, yaw_deg: a.yaw_deg || 0, count: a.count || 1, path_points: a.patrol });
    if (!r.records.length) throw new Error('could not place it (object pool full?)');
    const summary = `${summaryPrefix} ${r.records.length > 1 ? `${r.records.length} × ` : ''}${def.name}`;
    const change = commit('spawn', r, summary, { objects: r.records, remote: { spawn: r.records } });
    return { r, summary, change };
  };

  const resolveLevelKey = async (level) => {
    if (level === undefined || level === null || level === 'here') {
      const s = await rpc('state', {});
      return s.custom ? `c:${s.custom}` : String(s.level_num);
    }
    const c = findCustom(level);
    if (c) return `c:${c.id}`;
    const l = levelByKey(level);
    if (!l?.num) throw new Error(`unknown level ${level}`);
    return String(l.num);
  };

  return [
    tool('list_scene', 'Everything in the current area with uids: blocks, placed objects, custom objects, the level\'s own objects; with their motions. Use it to find uids for attach_motion, make_prefab and arrange_objects.', {
      query: z.string().optional(), kind: z.enum(['block', 'placed', 'custom', 'original']).optional(), limit: z.number().optional(),
    }, card('list_scene', (a) => (a.query ? `Looking for ${a.query}` : 'Listing the scene'), async (a) => ({ result: text(await rpc('objects_scene', a)) })), opts),

    tool('attach_motion', 'Make a block or object move (Mario rides it, collision moves along): a path (moving platform, elevator with trigger while_standing, patrol), rotate (spinning platform, wheel), swing (pendulum), tilt (seesaw), fall or crumble when stood on, blink (disappearing platform), conveyor, bounce (trampoline), sink. Motions combine (path + rotate). Fields you give are merged into its current motion; set a motion to null to remove it, replace=true to start over, none=true to stop all motion. Original platforms with collision become movers (their model + collision follow the motion).', {
      uid: z.number().optional(), slot: z.number().optional(),
      motion: motion.optional(), replace: z.boolean().optional(), none: z.boolean().optional(),
    }, card('attach_motion', (a) => (a.none ? 'Stopping a motion' : `Adding ${Object.keys(a.motion || {}).join(' + ') || 'motion'}`), async (a) => {
      const r = await rpc('objects_attach_motion', { uid: a.uid, slot: a.slot, motion: a.none ? null : a.motion || {}, replace: a.replace || a.none });
      const what = r.fields.motion ? Object.keys(r.fields.motion).join(' + ') : 'no motion';
      const summary = `${r.name}: ${what}`;
      let change;
      if (r.adopted) change = commit('modify', r, summary, { objects: [r.record], removals: r.adopted.rules, remote: { spawn: [r.record], addRules: r.adopted.rules } });
      else {
        change = projects.updateObject(p, r.uid, r.fields, summary);
        agent.hub.patchChanged(p, agent.turn?.client, { key: change?.key, deleteUids: [r.uid], spawn: [r.record] });
      }
      return { summary, result: text({ uid: r.uid, motion: r.fields.motion, mover: r.fields.bhv === 'bhvStudioMover' || undefined, change_id: change?.id }) };
    }), opts),

    tool('set_object_path', 'Redraw the path of one of the game\'s own path objects: Koopa the Quick\'s race, the racing penguin, platforms on tracks (and a few swimmers). Points in level coordinates (y optional: on the ground). reset=true goes back to the original path. Move the race finish flag with modify if needed.', {
      uid: z.number().optional(), slot: z.number().optional(), points: z.array(point).optional(), reset: z.boolean().optional(),
    }, card('set_object_path', (a) => (a.reset ? 'Restoring a path' : 'Drawing a race path'), async (a) => {
      const r = await rpc('objects_set_object_path', a);
      const summary = a.reset ? `${r.name} follows its original path` : `New path for ${r.name}`;
      const change = projects.updateArea(p, r.key, 'paths', r.paths, summary);
      agent.hub.patchChanged(p, agent.turn?.client, null);
      return { summary, result: text({ ok: true, points: a.points?.length, change_id: change.id }) };
    }), opts),

    tool('get_object_path', 'The path an original path object follows (Koopa the Quick, racing penguin, track platforms), to edit it with set_object_path.', {
      uid: z.number().optional(), slot: z.number().optional(),
    }, card('get_object_path', () => 'Reading a path', async (a) => ({ result: text(await rpc('objects_path_info', a)) })), opts),

    tool('create_custom_object', 'Make a custom enemy or character without code: a model plus behaviour building blocks (movement, jumping, health, contact damage, what defeats it, defeat effect, coins, shooting, sounds, size). Saved in the project library "My objects" and placed in the level (count, where; place=false only saves it). patrol: points in level coordinates for move=patrol. Copies are addressable by uid; events get "defeated", "hurt_mario", "spotted" from them.', {
      ...actorFields,
      place: z.boolean().optional(), count: z.number().optional(), where: where.optional(), yaw_deg: z.number().optional(),
      patrol: z.array(point).optional(),
    }, card('create_custom_object', (a) => `Making ${a.name || 'a custom object'}`, async (a) => {
      if (a.model && !modelOk(a.model)) throw new Error(`unknown model ${a.model} (use search_catalog)`);
      const def = { id: newId(), name: String(a.name || 'Custom enemy').slice(0, 40), model: a.model || 'goomba', ...cleanDef(a) };
      def.name = String(a.name || 'Custom enemy').slice(0, 40);
      setGame('objdefs', [...game('objdefs', []), def], `Made the custom object “${def.name}”`);
      if (a.place === false) return { summary: `Made ${def.name}`, result: text({ id: def.id, saved: true }) };
      const { r, summary, change } = await placeDef(def, a, `Made and placed`);
      return { summary, result: text({ id: def.id, placed: r.records.map((x) => ({ uid: x.uid, x: x.x, y: x.y, z: x.z })), change_id: change.id }) };
    }), opts),

    tool('edit_custom_object', 'Change a custom object definition (by id or name from list_custom_objects): every copy in every level changes.', {
      id: z.string().describe('id or name'), ...actorFields,
    }, card('edit_custom_object', (a) => `Changing ${a.id}`, async (a) => {
      const def = findDef(a.id);
      if (!def) throw new Error(`no custom object ${a.id}`);
      if (a.model && !modelOk(a.model)) throw new Error(`unknown model ${a.model}`);
      const next = { ...def, ...cleanDef(a), sounds: { ...(def.sounds || {}), ...(cleanDef(a).sounds || {}) } };
      setGame('objdefs', game('objdefs', []).map((d) => (d.id === def.id ? next : d)), `Changed the custom object “${next.name}”`);
      return { summary: `Changed ${next.name}`, result: text({ id: next.id, def: next }) };
    }), opts),

    tool('place_custom_object', 'Place copies of a custom object or a prefab from My objects (by id or name).', {
      id: z.string().describe('custom object or prefab id / name'), count: z.number().optional(), where: where.optional(), yaw_deg: z.number().optional(),
      patrol: z.array(point).optional(),
    }, card('place_custom_object', (a) => `Placing ${a.id}`, async (a) => {
      const def = findDef(a.id);
      if (def) {
        const { r, summary, change } = await placeDef(def, a);
        return { summary, result: text({ placed: r.records.map((x) => ({ uid: x.uid, x: x.x, y: x.y, z: x.z })), change_id: change.id }) };
      }
      const pf = findPrefab(a.id);
      if (!pf) throw new Error(`nothing called ${a.id} in My objects (list_custom_objects)`);
      const r = await rpc('objects_place_records', { items: pf.items, where: a.where || {}, yaw_deg: a.yaw_deg || 0, count: a.count || 1 });
      const summary = `Placed the prefab “${pf.name}”`;
      const change = commit('spawn', r, summary, { objects: r.records, remote: { spawn: r.records } });
      return { summary, result: text({ placed: r.records.length, uids: r.records.map((x) => x.uid).slice(0, 40), change_id: change.id }) };
    }), opts),

    tool('list_custom_objects', 'The project library "My objects": custom object definitions and prefabs.', {},
      card('list_custom_objects', () => 'Checking My objects', async () => ({
        result: text({ custom_objects: game('objdefs', []).filter((d) => !d.deleted), prefabs: game('prefabs', []).map((x) => ({ id: x.id, name: x.name, items: x.items.length, kinds: [...new Set(x.items.map((i) => i.name))].slice(0, 12) })) }),
      })), opts),

    tool('make_prefab', 'Save objects/blocks (uids or slots, from list_scene) as a reusable prefab in My objects, placeable in any level.', {
      name: z.string(), uids: z.array(z.number()).optional(), slots: z.array(z.number()).optional(),
    }, card('make_prefab', (a) => `Saving the prefab ${a.name}`, async (a) => {
      const r = await rpc('objects_records_of', { uids: a.uids || [], slots: a.slots || [] });
      const prefab = { id: newId(), name: String(a.name).slice(0, 40), items: r.items, created: Date.now() };
      setGame('prefabs', [...game('prefabs', []), prefab], `Saved the prefab “${prefab.name}”`);
      return { summary: `Saved prefab ${prefab.name}`, result: text({ id: prefab.id, items: r.count }) };
    }), opts),

    tool('arrange_objects', 'Group edits as one undo step: align (axis x/y/z, where min/center/max), distribute (even spacing along axis), drop (onto the ground), move (dx, dy, dz) or rotate (yaw_deg around their center).', {
      uids: z.array(z.number()).optional(), slots: z.array(z.number()).optional(),
      op: z.enum(['align', 'distribute', 'drop', 'move', 'rotate']), axis: z.enum(['x', 'y', 'z']).optional(), where: z.enum(['min', 'center', 'max']).optional(),
      dx: z.number().optional(), dy: z.number().optional(), dz: z.number().optional(), yaw_deg: z.number().optional(),
    }, card('arrange_objects', (a) => `${a.op[0].toUpperCase()}${a.op.slice(1)} objects`, async (a) => {
      const r = await rpc('objects_arrange', a);
      const n = r.updates.length + r.adopted.records.length;
      const summary = `${a.op[0].toUpperCase()}${a.op.slice(1)}ed ${n} objects`.replace('eed', 'ed').replace('Droped', 'Dropped');
      let change = null;
      if (r.updates.length) {
        change = projects.updateObjects(p, r.updates, summary);
        const uids = new Set(r.updates.map((u) => u.uid));
        const recs = Object.values(p.areas).flatMap((x) => x.objects).filter((o) => uids.has(o.uid));
        agent.hub.patchChanged(p, agent.turn?.client, { key: r.key, deleteUids: [...uids], spawn: recs });
      }
      if (r.adopted.records.length) change = commit('modify', r, summary, { objects: r.adopted.records, removals: r.adopted.rules, remote: { spawn: r.adopted.records, addRules: r.adopted.rules } });
      return { summary, result: text({ moved: n, change_id: change?.id }) };
    }), opts),

    tool('set_game_rules', 'Gameplay rules for the whole game (scope game) or one level (scope level; level = name/number/custom id, default the current one). Fields merge into what is set: runSpeed, jump, doubleJump, tripleJump, backflip, sideFlip, longJump, wallKick (height multipliers, 1 = normal), longJumpSpeed, gravity, airControl, swimSpeed (multipliers), fallDamage (height that hurts, 1150 normal, 0 = none), damage (multiplier, 0 = no damage), oneHit, infiniteLives, startLives, coinLife (1-up every N coins, 0 off), coinHeal, coinStar (100-coin star), wingTime/metalTime/vanishTime (seconds), moves {longJump, backflip, sideFlip, tripleJump, doubleJump, wallKick, groundPound, dive, slideKick, punch, ledgeGrab, crouch: false switches a move off}, noBlj, hud {lives, coins, stars, power, keys: false hides}, timer (show a level timer), timeLimit (seconds, 0 none). preset: classic, moon, speedy, hardcore, kids. reset=true clears the scope.', {
      scope: z.enum(['game', 'level']).optional(), level: z.union([z.string(), z.number()]).optional(),
      rules: z.record(z.string(), z.any()).optional(), preset: z.enum(['classic', 'moon', 'speedy', 'hardcore', 'kids']).optional(), reset: z.boolean().optional(),
    }, card('set_game_rules', (a) => (a.preset ? `Game rules: ${a.preset}` : 'Changing the game rules'), async (a) => {
      const PRESETS = { classic: {}, moon: { gravity: 0.45, airControl: 1.5, fallDamage: 0 }, speedy: { runSpeed: 1.6, gravity: 1.3, jump: 1.3, airControl: 1.4 }, hardcore: { oneHit: true, startLives: 1, coinHeal: false, noBlj: true }, kids: { damage: 0, infiniteLives: true, fallDamage: 0 } };
      const all = JSON.parse(JSON.stringify(game('rules', { base: {}, levels: {} })));
      all.base ||= {};
      all.levels ||= {};
      const key = a.scope === 'level' ? await resolveLevelKey(a.level) : null;
      let target = key ? (all.levels[key] ||= {}) : all.base;
      if (a.reset || a.preset) { for (const k of Object.keys(target)) delete target[k]; }
      Object.assign(target, a.preset ? PRESETS[a.preset] : {});
      for (const [k, v] of Object.entries(a.rules || {})) {
        if (v && typeof v === 'object' && !Array.isArray(v)) target[k] = { ...(target[k] || {}), ...v };
        else if (v === null) delete target[k];
        else target[k] = v;
      }
      if (key && !Object.keys(target).length) delete all.levels[key];
      const summary = a.preset ? `Game rules: ${a.preset}${key ? ' (one level)' : ''}` : `Changed the game rules${key ? ' of one level' : ''}`;
      const change = setGame('rules', all, summary);
      return { summary, result: text({ scope: key ? `level ${key}` : 'game', rules: key ? all.levels[key] || {} : all.base, change_id: change.id }) };
    }), opts),

    tool('get_game_rules', 'The project\'s gameplay rules: for the whole game and the per-level overrides.', {},
      card('get_game_rules', () => 'Checking the game rules', async () => ({ result: text(game('rules', { base: {}, levels: {} })) })), opts),

    tool('trigger_motion', 'Start the motion of an object whose path waits for an event (trigger "event"), e.g. a bridge that extends when a switch is pressed. Lasts until the area reloads.', {
      uid: z.number(),
    }, card('trigger_motion', () => 'Starting a motion', async (a) => ({ result: text(await rpc('objects_trigger', a)) })), opts),
  ];
};
