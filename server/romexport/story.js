// The project's story for the ROM: dialogs, variables, events (When -> If -> Then), cutscenes,
// characters' lines, zones and hidden objects as a compact block that n64/s64_story.c runs (the
// same rules as the page's story runtime, web/js/story/runtime.js). Words are big-endian; offsets
// count from the block's start.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTexts, encodeBytes, dialogText, DIALOG_BASE } from '../../web/js/story/text.js';
import { Segment } from './n64.js';
import { NINTENDO_IDS } from './overlays.js';
import { catalog, getEntry } from '../catalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
useTexts(JSON.parse(fs.readFileSync(path.resolve(HERE, '..', '..', 'web', 'data', 'story_texts.json'), 'utf8')));

export const TRIGGER = { enter_zone: 1, leave_zone: 2, talk: 3, star: 4, defeat: 5, switch: 6, object_event: 7, coins: 8, red_coins: 9, timer: 10, level_enter: 11, var: 12, game_start: 13, vehicle: 14, race: 15, katana_duel: 16 };
export const COND = { flag: 1, var: 2, stars: 3, coins: 4, lives: 5, health: 6, cap: 7, act: 8, level: 9, event_done: 10, star: 11, random: 12, shotgun: 13, driving: 14, katana: 15, katana_duel_won: 16 };
export const ACTION = {
  dialog: 1, set_flag: 2, set_var: 3, open_door: 4, lock_door: 5, show: 6, hide: 7, spawn: 8, give_star: 9, start_motion: 10,
  coins: 11, lives: 12, health: 13, cap: 14, red_coin: 15, music: 16, sound: 17, warp: 18, shotgun: 19, katana: 20,
  start_race: 21, teleport: 22, cutscene: 23, timer: 24, shake: 25, wait: 26, caption: 27, finish_level: 28, ending: 29,
  if: 30, enable_event: 31,
};
export const STEP = { shot: 1, follow_mario: 2, dialog: 3, wait: 4, caption: 5, fade: 6, move: 7, mario: 8, action: 9 };
const OPS = { '==': 0, '!=': 1, '<': 2, '<=': 3, '>': 4, '>=': 5 };
const EASES = { linear: 0, smooth: 1, in: 2, out: 3, cut: 4 };
const OBJ_EVENTS = { defeated: 1, hurt_mario: 2, spotted: 3, hit: 4 }; // (actor.c's EV_*)
const SAVE_BITS = 52 * 8; // what a save file keeps of the progress (n64/s64_save.c)
const VEHICLE_EVENTS = { enter: 0, exit: 1, crash: 2 };
const RESULTS = { won: 0, lost: 1, start: 2 };
const CAPS = { wing: 3, metal: 4, vanish: 5 };
const CAP_BITS = { wing: 1, metal: 2, vanish: 4 };
const FPS = 30;
export const ACTION_WORDS = 8;
export const STEP_WORDS = 12;

const f32 = (v) => { const b = Buffer.alloc(4); b.writeFloatBE(Number(v) || 0); return b.readUInt32BE(0); };
const frames = (s, d = 1) => Math.max(0, Math.round((Number(s ?? d) || 0) * FPS));

/**
 * project: the project; levelOf(key) -> [levelNum, area] for a level key of the ROM ('9', '9:1',
 * 'c:<id>', 'c:<id>:2'), area 0 = all areas; null when the level is not in the ROM.
 * -> { data: Buffer, issues: [{ name, why }] }
 */
export function buildStory(project, levelOf, songIndex = () => -1) {
  const story = project.story || {};
  const issues = [];
  const s = new Segment(0);
  const dialogs = (story.dialogs || []).filter((d) => d.num >= DIALOG_BASE);
  const vars = story.vars || [];
  const events = story.events || [];
  const cuts = story.cutscenes || [];
  const varIndex = (id) => vars.findIndex((v) => v.id === id || v.name === id);
  const eventIndex = (id) => events.findIndex((e) => e.id === id);
  const cutIndex = (id) => cuts.findIndex((c) => c.id === id || c.name === id);
  const dialogNum = (ref) => {
    if (ref == null || ref === '') return -1;
    if (typeof ref === 'number') return ref;
    if (/^game:\d+$/.test(ref)) return Number(ref.slice(5));
    return dialogs.find((x) => x.id === ref || x.name === ref)?.num ?? -1;
  };
  const level = (key) => {
    if (!key || key === 'any') return [0, 0];
    return levelOf(String(key)) || [-1, 0]; // (-1: a level not in the ROM: never matches)
  };

  // every record by uid (positions for spawns and stars, zones, the objects progress names)
  const records = new Map();
  for (const [key, a] of Object.entries(project.areas || {})) for (const r of a.objects || []) if (r.uid) records.set(r.uid >>> 0, { key, r });
  const objUids = new Set((story.hidden || []).map((u) => u >>> 0));
  const noteObj = (u) => { if (u) objUids.add(Number(u) >>> 0); };

  // ---- pieces written after the header, by label ----
  let n = 0;
  const lbl = (p) => `${p}${n++}`;
  const later = [];
  const text = (t) => { const l = lbl('t'); later.push(() => { s.align(4).label(l); s.bytes(Buffer.from(encodeBytes(t))); }); return l; };
  const uidList = (u) => {
    const list = [].concat(u || []).map((x) => Number(x) >>> 0).filter(Boolean);
    list.forEach(noteObj);
    const l = lbl('u');
    later.push(() => { s.align(4).label(l); s.u32(list.length); for (const x of list) s.u32(x); });
    return l;
  };
  const posOf = (a) => a?.pos || (a?.x != null ? { x: a.x, y: a.y, z: a.z, yaw: a.yaw } : null);
  const pos = (p) => { const l = lbl('p'); later.push(() => { s.align(4).label(l); s.u32(f32(p.x)).u32(f32(p.y ?? 0)).u32(f32(p.z)).u32(Math.round(((p.yaw || 0) / 360) * 65536) & 0xFFFF); }); return l; };

  const condList = (conds) => {
    const l = lbl('c');
    const list = (conds || []).map((c) => {
      const op = OPS[c.op] ?? OPS['>='];
      const t = COND[c.type];
      if (!t) { issues.push({ name: 'A condition', why: `${c.type} is not in the ROM yet` }); return null; }
      switch (c.type) {
        case 'flag': return [t, 0, varIndex(c.var), c.value !== false ? 1 : 0];
        case 'var': return [t, op, varIndex(c.var), typeof c.value === 'boolean' ? Number(c.value) : Math.round(Number(c.value) || 0)];
        case 'stars': case 'coins': case 'lives': case 'health': return [t, op, Math.round(Number(c.value) || 0), 0];
        case 'act': return [t, OPS[c.op] ?? 0, Math.round(Number(c.value) || 1), 0];
        case 'cap': return [t, 0, CAP_BITS[c.cap] || 0, c.value !== false ? 1 : 0];
        case 'level': { const [lv, ar] = level(c.key); return [t, 0, lv, ar]; }
        case 'event_done': return [t, 0, eventIndex(c.event), c.value !== false ? 1 : 0];
        case 'star': noteObj(c.uid); return [t, 0, Number(c.uid) >>> 0, c.value !== false ? 1 : 0];
        case 'random': return [t, 0, Math.round(Number(c.chance) || 50), 0];
        case 'katana_duel_won': if (c.uid) noteObj(c.uid); return [t, 0, Number(c.uid || 0) >>> 0, c.value !== false ? 1 : 0];
        default: return [t, 0, 0, c.value !== false ? 1 : 0];
      }
    }).filter(Boolean);
    later.push(() => { s.align(4).label(l); s.u32(list.length); for (const c of list) for (const w of c) s.u32(w); });
    return l;
  };

  const actionWords = (a) => {
    const t = ACTION[a.type];
    if (!t) { issues.push({ name: 'An action', why: `${a.type} is not in the ROM yet` }); return null; }
    const w = [t];
    const at = (x) => {
      if (!x || x === 'mario') return [0, 0, 0];
      if (typeof x === 'number' || /^\d+$/.test(String(x))) return [1, Number(x) >>> 0, 0];
      return [2, 0, pos(x)];
    };
    switch (a.type) {
      case 'dialog': w.push(dialogNum(a.dialog), a.answer_var ? varIndex(a.answer_var) : -1); break;
      case 'set_flag': w.push(varIndex(a.var), a.value === 'toggle' ? 2 : (a.value === false || a.value === 'false') ? 0 : 1); break;
      case 'set_var': w.push(varIndex(a.var), a.op === 'add' ? 1 : a.op === 'sub' ? 2 : 0, Math.round(Number(a.value) || 0)); break;
      case 'open_door': case 'lock_door': case 'start_motion': w.push(uidList(a.uid)); break;
      case 'show': case 'hide': w.push(uidList(a.uid), { none: 0, puff: 1, door: 2 }[a.effect || 'puff'] ?? 1); break;
      case 'spawn': {
        if (NINTENDO_IDS.test(a.entry || '')) { issues.push({ name: 'A spawn', why: 'it makes a Sunshine character: Nintendo\'s model, which a ROM hack you share must not contain' }); return null; }
        const idx = catalog.entries.findIndex((e) => e.id === (a.entry || 'yellow_coin'));
        const [kind, uid, p] = at(a.at);
        if (kind === 1) noteObj(uid);
        w.push(idx, Math.min(20, Math.max(1, a.count | 0 || 1)), kind, uid, p, Math.round(Number(a.y_offset) || 0));
        break;
      }
      case 'give_star': noteObj(a.uid); w.push(Number(a.uid) >>> 0, a.at === 'mario' ? 1 : 0); break;
      case 'coins': case 'lives': case 'red_coin': w.push(a.amount | 0 || 1); break;
      case 'health': w.push(a.amount | 0 || 8); break;
      case 'cap': w.push(CAPS[a.cap] || 3, Math.round(Number(a.seconds) || 0)); break;
      case 'music': // the game's sequence, or one of the project's songs (-2 - its index)
        if (a.song) w.push(-2 - Math.max(-1, songIndex({ song: a.song }, (why) => issues.push({ name: 'Story music', why }))));
        else w.push(Math.round(Number(a.seq ?? -1)));
        break;
      case 'sound': w.push(Number(a.bits || 0) >>> 0); break;
      case 'warp': {
        const lv = a.custom ? `c:${a.custom}${a.area > 1 ? `:${a.area}` : ''}` : String(a.level ?? '');
        const [ln, ar] = level(lv);
        const target = a.uid ? records.get(Number(a.uid) >>> 0)?.r : null;
        const p = posOf(a);
        w.push(ln, ar || 1, target?.warp?.node || 0, p ? 1 : 0, p ? pos(p) : 0, Number(a.act) || 1);
        break;
      }
      case 'shotgun': case 'katana': w.push(a.on === 'take' ? 0 : 1); break;
      case 'start_race': w.push(Number(a.uid) >>> 0); break;
      case 'teleport': { const p = posOf(a); w.push(p ? pos(p) : 0); break; }
      case 'cutscene': w.push(cutIndex(a.cutscene)); break;
      case 'timer': w.push({ hide: 0, start: 1, stop: 2, resume: 3 }[a.op] ?? 1); break;
      case 'shake': w.push(a.strength === 'big' ? 2 : 1); break;
      case 'wait': w.push(frames(a.seconds)); break;
      case 'caption': w.push(text(a.text || ''), frames(a.seconds, 3)); break;
      case 'if': w.push(a.answer === 'yes' ? 1 : a.answer === 'no' ? 2 : 0, condList(a.conditions), actionList(a.then), actionList(a.else)); break;
      case 'enable_event': w.push(eventIndex(a.event), a.on === false ? 0 : 1, a.reset ? 1 : 0); break;
      default: break;
    }
    return w;
  };
  function actionList(list) {
    const l = lbl('a');
    const words = (list || []).map(actionWords).filter(Boolean);
    later.push(() => { s.align(4).label(l); s.u32(words.length); for (const w of words) writeWords(w, ACTION_WORDS); });
    return l;
  }
  // words: numbers or labels (offsets)
  function writeWords(w, size) {
    for (let i = 0; i < size; i++) {
      const v = w[i];
      if (typeof v === 'string') s.ref(v); else s.u32((v ?? 0) >>> 0);
    }
  }

  // ---- the header ----
  s.u32(0x53363453).u32(1); // "S64S"
  const sections = ['dialogs', 'vars', 'events', 'cuts', 'npcs', 'hidden', 'zones', 'start', 'objs'];
  for (const k of sections) { s.u32(0); s.ref(`sec_${k}`); }
  const counts = {};

  // dialogs: num, lines, left, width, voice, question, text
  s.align(4).label('sec_dialogs');
  counts.dialogs = dialogs.length;
  for (const d of dialogs) {
    const [left, top] = d.box || [30, 200];
    s.u32(d.num).u32(d.lines || 4).u32(left).u32(top).u32(d.voice | 0).u32(d.question ? 1 : 0).ref(text(dialogText(d)));
  }
  // variables: kind (0 flag, 1 number), starting value
  s.align(4).label('sec_vars');
  counts.vars = vars.length;
  for (const v of vars) s.u32(v.kind === 'flag' ? 0 : 1).u32(v.kind === 'flag' ? (v.initial ? 1 : 0) : Math.round(Number(v.initial) || 0));
  // events
  s.align(4).label('sec_events');
  counts.events = events.length;
  const evLabels = events.map(() => lbl('e'));
  for (const l of evLabels) s.ref(l);
  events.forEach((ev, i) => {
    const t = ev.trigger || {};
    const type = TRIGGER[t.type] || 0;
    if (!type) issues.push({ name: ev.name || 'An event', why: `its trigger (${t.type}) is not in the ROM yet` });
    let args = [];
    switch (t.type) {
      case 'enter_zone': case 'leave_zone': args = [Number(t.zone) >>> 0]; break;
      case 'talk': args = [Number(t.uid || 0) >>> 0, t.answer === 'yes' ? 1 : t.answer === 'no' ? 2 : 0, t.dialog ? dialogNum(t.dialog) : -1]; break;
      case 'star': args = [t.uid && t.uid !== 'any' ? Number(t.uid) >>> 0 : 0]; break;
      case 'defeat': case 'switch': args = [Number(t.uid || 0) >>> 0]; break;
      case 'object_event': args = [Number(t.uid || 0) >>> 0, OBJ_EVENTS[t.event || 'defeated'] ?? 1]; break;
      case 'coins': case 'red_coins': args = [t.count | 0]; break;
      case 'timer': args = [frames(t.seconds, 0)]; break;
      case 'level_enter': args = level(t.level); break;
      case 'var': args = [varIndex(t.var), OPS[t.op || '>='] ?? 5, typeof t.value === 'boolean' ? Number(t.value) : Math.round(Number(t.value ?? 1) || 0)]; break;
      case 'vehicle': args = [Number(t.uid || 0) >>> 0, VEHICLE_EVENTS[t.event || 'enter'] ?? 0]; break;
      case 'race': case 'katana_duel': args = [Number(t.uid || 0) >>> 0, RESULTS[t.result || 'won'] ?? 0]; break;
      default: break;
    }
    const [lv, ar] = level(ev.level);
    later.push(() => {
      s.align(4).label(evLabels[i]);
      s.u32(type).u32({ once: 0, visit: 1, always: 2 }[ev.repeat || 'once'] ?? 0).u32(lv >>> 0).u32(ar).u32(ev.enabled === false ? 0 : 1);
      for (let k = 0; k < 6; k++) s.u32((args[k] ?? 0) >>> 0);
      s.ref(condList(ev.conditions)).ref(actionList(ev.actions));
    });
  });
  // cutscenes: skippable, hud, steps
  s.align(4).label('sec_cuts');
  counts.cuts = cuts.length;
  const cutLabels = cuts.map(() => lbl('k'));
  for (const l of cutLabels) s.ref(l);
  cuts.forEach((cs, i) => {
    const steps = (cs.steps || []).map((st) => {
      const t = STEP[st.type];
      if (!t) { issues.push({ name: cs.name || 'A cutscene', why: `its step ${st.type} is not in the ROM yet` }); return null; }
      switch (st.type) {
        case 'shot': return [t, frames(st.seconds, 0), EASES[st.ease || 'smooth'] ?? 1, (st.pos ? 1 : 0) | (st.focus ? 2 : 0) | (st.fov ? 4 : 0), f32(st.fov || 0),
          ...(st.pos || [0, 0, 0]).map(f32), ...(st.focus || [0, 0, 0]).map(f32)];
        case 'dialog': return [t, dialogNum(st.dialog)];
        case 'wait': return [t, frames(st.seconds)];
        case 'caption': return [t, text(st.text || ''), frames(st.seconds, 3)];
        case 'fade': return [t, st.to !== 'in' ? 1 : 0, frames(st.seconds, 0.6), parseInt(String(st.color || '#000').replace('#', ''), 16) || 0];
        case 'move': {
          noteObj(st.uid);
          const q = posOf(st) || {};
          return [t, Number(st.uid) >>> 0, Math.max(1, frames(st.seconds)), EASES[st.ease || 'smooth'] ?? 1, st.wait === false ? 0 : 1,
            (q.x != null ? 1 : 0) | (q.y != null ? 2 : 0) | (q.z != null ? 4 : 0) | (st.yaw != null ? 8 : 0), f32(q.x), f32(q.y), f32(q.z), Math.round(((st.yaw || 0) / 360) * 65536) & 0xFFFF];
        }
        case 'mario': { const q = posOf(st); return q ? [t, f32(q.x), f32(q.y ?? 0), f32(q.z), Math.round(((q.yaw || 0) / 360) * 65536) & 0xFFFF] : null; }
        case 'action': { const w = actionWords(st.action || {}); if (!w) return null; const l = lbl('s'); later.push(() => { s.align(4).label(l); writeWords(w, ACTION_WORDS); }); return [t, l]; }
        default: return [t];
      }
    }).filter(Boolean);
    later.push(() => {
      s.align(4).label(cutLabels[i]);
      s.u32(cs.skippable === false ? 0 : 1).u32(cs.hud ? 1 : 0).u32(steps.length);
      for (const st of steps) writeWords(st, STEP_WORDS);
    });
  });
  // characters: uid, lines (dialog, conditions)
  const npcs = Object.entries(story.npcs || {});
  s.align(4).label('sec_npcs');
  counts.npcs = npcs.length;
  for (const [uid, npc] of npcs) {
    const l = lbl('n');
    const lines = (npc.lines || []).map((ln) => [dialogNum(ln.dialog), condList(ln.if)]);
    later.push(() => { s.align(4).label(l); s.u32(lines.length); for (const [d, c] of lines) { s.u32(d >>> 0); s.ref(c); } });
    s.u32(Number(uid) >>> 0).ref(l);
  }

  // what happens later writes the texts, lists and nested actions (it can add more of them)
  while (later.length) later.shift()();

  // hidden at the start
  const hidden = (story.hidden || []).map((u) => u >>> 0);
  s.align(4).label('sec_hidden');
  counts.hidden = hidden.length;
  for (const u of hidden) s.u32(u);
  // zones: uid, level, area, position, yaw, size
  const zones = [...records.values()].filter(({ r }) => r.zone && r.block);
  s.align(4).label('sec_zones');
  counts.zones = zones.length;
  for (const { key, r } of zones) {
    const [lv, ar] = level(key);
    s.u32(r.uid >>> 0).u32(lv >>> 0).u32(ar || 1).u32(f32(r.x)).u32(f32(r.y)).u32(f32(r.z)).u32((r.yaw | 0) & 0xFFFF)
      .u32(f32(r.block.sx)).u32(f32(r.block.sy)).u32(f32(r.block.sz));
  }
  // the opening: dialog, cutscene, Mario's spot
  const st0 = story.start || {};
  s.align(4).label('sec_start');
  counts.start = 1;
  const sp = st0.pos && st0.pos.x != null ? st0.pos : null;
  s.u32(dialogNum(st0.dialog) >>> 0).u32(cutIndex(st0.cutscene) >>> 0).u32(sp ? 1 : 0).u32(f32(sp?.x)).u32(f32(sp?.y)).u32(f32(sp?.z)).u32(Math.round(((sp?.yaw || 0) / 360) * 65536) & 0xFFFF);
  // the objects progress names (shown / hidden for good), with what a spawn or a star needs
  const objs = [...objUids];
  s.align(4).label('sec_objs');
  counts.objs = objs.length;
  for (const u of objs) {
    const rec = records.get(u)?.r;
    const [lv, ar] = rec ? level(records.get(u).key) : [-1, 0];
    s.u32(u).u32(lv >>> 0).u32(ar).u32(f32(rec?.x)).u32(f32((rec?.y || 0) + (rec?.block ? rec.block.sy / 2 : 0))).u32(f32(rec?.z))
      .u32(((rec?.bparams >>> 24) & 0xFF) >>> 0);
  }
  const data = s.done();
  // the counts in the header
  sections.forEach((k, i) => data.writeUInt32BE(counts[k] || 0, 8 + i * 8));
  // the progress in the save file (s64_story_pack): 52 bytes per save file
  const bits = 1 + 32 + 1 + 2 * events.length + 5 * objs.length + vars.reduce((n, v) => n + (v.kind === 'flag' ? 1 : 16), 0);
  if (bits > SAVE_BITS) issues.push({ name: 'Story progress', why: `needs ${Math.ceil(bits / 8)} bytes in the save file, which has ${SAVE_BITS / 8}: what does not fit (the last variables first) starts over after a reset` });
  return { data, issues, empty: !dialogs.length && !events.length && !npcs.length && !hidden.length };
}

void getEntry;
