// Browser side of Claude's story tools (server/tools/story.js). `this` is the Studio.
import { registerRpc } from '../studio.js';
import { blockDefaults, material } from '../generators.js';
import { CHARACTERS } from './schema.js';
import { ZONE_COLOR } from './runtime.js';

const randUid = () => 1 + Math.floor(Math.random() * 0x7efffffe);
const toYaw = (deg) => Math.round((deg / 360) * 65536) & 0xffff;

function areaInfo(studio) {
  const s = studio.engine.state();
  return { key: studio.engine.areaKey(), level: s.level, area: s.area };
}

// A character placed live (the server saves it): { records: [rec], ... }
registerRpc('story_place_character', function ({ character = 'toad', where = {}, name, face = 'mario' }) {
  const ch = CHARACTERS.find((c) => c.id === character) || { id: character, label: name || character, ...(this.entries.get(character) ? { entry: character } : { model: 'toad_message', anim: [1, 6] }) };
  const [p] = this.points(where, 1);
  const m = this.mario().mario;
  const yaw = this.faceYaw(face, p, m);
  const uid = randUid();
  let rec;
  if (ch.entry) {
    const e = this.entries.get(ch.entry);
    rec = { uid, entry: ch.entry, x: p.x, y: p.y, z: p.z, yaw, pitch: 0, roll: 0, bparams: this.parseParams(e?.params?.[0]) || 0, scale: 1, name: name || ch.label };
  } else {
    const [set, anim] = ch.anim || [0, 0];
    if (!this.entries.get(ch.model)) throw new Error(`unknown model ${ch.model}`);
    rec = { uid, bhv: 'bhvStudioNpc', model: ch.model, x: p.x, y: p.y, z: p.z, yaw, bparams: ((set << 16) | (anim << 8)) >>> 0, scale: 1, name: name || ch.label };
  }
  const slot = this.engine.spawn(rec);
  if (slot < 0) throw new Error('the game could not place it (is the engine up to date?)');
  return { ...areaInfo(this), records: [rec], character: ch.id, label: ch.label };
});

// A trigger zone placed live.
registerRpc('story_add_zone', function ({ name = 'Zone', where = {}, size = {} }) {
  const [p] = this.points(where, 1);
  const rec = { uid: randUid(), block: blockDefaults({ shape: 0, sx: size.x || 600, sy: size.y || 400, sz: size.z || 600, top: material('water'), side: material('water'), flags: 6, color: ZONE_COLOR }),
    x: p.x, y: p.y - 20, z: p.z, yaw: toYaw(where.yaw_deg || 0), pitch: 0, roll: 0, name, zone: { name } };
  this.engine.spawn(rec);
  return { ...areaInfo(this), records: [rec] };
});

// Camera shots for cutscenes: explicit or "look at X from a direction".
registerRpc('story_shots', function ({ shots = [] }) {
  const m = this.mario().mario;
  const target = (t) => {
    if (t == null || t === 'mario') return [m.x, m.y + 80, m.z];
    if (typeof t === 'number') {
      const o = this.engine.objects().find((x) => x.uid === t);
      const r = this.recordOf(t);
      const src = o || r;
      if (!src) throw new Error(`no object with uid ${t} here`);
      return [src.x, src.y + (r?.block ? r.block.sy / 2 : 80), src.z];
    }
    return [t.x, t.y ?? m.y, t.z];
  };
  return {
    shots: shots.map((s) => {
      if (s.pos && s.focus) return { pos: s.pos, focus: s.focus };
      const f = target(s.target);
      const dist = s.distance ?? 900;
      const ang = ((s.angle_deg ?? ((m.yaw / 65536) * 360 + 180)) * Math.PI) / 180; // default: in front of Mario, looking back at him
      const height = s.height ?? 250;
      return { pos: [Math.round(f[0] + Math.sin(ang) * dist), Math.round(f[1] + height), Math.round(f[2] + Math.cos(ang) * dist)], focus: f.map(Math.round) };
    }),
  };
});

// Run something of the story now (testing), or read/reset the progress.
registerRpc('story_play', function ({ kind, id, from_start }) {
  const rt = this.storyRuntime;
  if (!rt) throw new Error('the story is not loaded');
  const s = rt.story;
  if (from_start || kind === 'start') { rt.playFromStart(); return { ok: true, started: 'from the start' }; }
  if (kind === 'event') {
    const ev = s.events.find((e) => e.id === id || e.name === id);
    if (!ev) throw new Error('no such event');
    rt.test(ev);
    return { ok: true };
  }
  if (kind === 'cutscene') {
    const cs = s.cutscenes.find((c) => c.id === id || c.name === id);
    if (!cs) throw new Error('no such cutscene');
    rt.playCutscene(cs, { preview: true });
    return { ok: true };
  }
  if (kind === 'dialog') {
    const n = rt.dialogNum(id);
    if (n < 0) throw new Error('no such dialog');
    rt.applyTexts(true);
    this.engine.M._studio_story_dialog(n);
    return { ok: true };
  }
  throw new Error('kind must be event, cutscene, dialog or start');
});

registerRpc('story_progress', function ({ reset = false, set = null }) {
  const rt = this.storyRuntime;
  if (!rt) throw new Error('the story is not loaded');
  if (reset) rt.resetProgress();
  if (set) for (const [k, v] of Object.entries(set)) rt.setVar(k, v);
  const vars = {};
  for (const v of rt.story.vars) vars[v.name] = rt.getVar(v.id);
  return { vars, events_done: Object.keys(rt.progress.done).map((id) => rt.story.events.find((e) => e.id === id)?.name || id), objects: rt.progress.objects, log: rt.log.slice(-15).map((l) => l.text) };
});
