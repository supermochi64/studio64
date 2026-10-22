// The story runtime: makes a project's story happen in the game. Used by the studio and by
// the standalone player.
//
//  - texts: the project's dialogs and its replaced game texts are written into the engine
//    (story.c) whenever the game starts or the story changes;
//  - characters: when Mario talks to a tagged object the engine asks which dialog it says;
//  - events ("When -> If -> Then"): triggers are watched every frame (zones, talks, stars,
//    coins, defeated objects, switches, timers, level entry, variables), conditions checked, and
//    actions run one after another (a dialog waits until it is closed, a cutscene until it ends);
//  - cutscenes: camera shots with easing, dialog lines, waits, object moves, fades, captions;
//    Mario is frozen and Start skips;
//  - progress (flags, counters, finished events, shown/hidden objects) is saved per project and
//    save file in the browser, so it survives deaths, level changes and reloads.
import { DIALOG_BASE, encodeBytes, dialogText, loadTexts, courseText, creditsText, texts } from './text.js';

const FPS = 30;
const EASE = {
  linear: (t) => t,
  smooth: (t) => t * t * (3 - 2 * t),
  in: (t) => t * t * t,
  out: (t) => 1 - (1 - t) ** 3,
  cut: () => 1,
};
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
// the game's sounds (web/data/sounds.json)
const SND = { secret: 2154471553, door: 805748865, star: 811073425, spawn: 2154025089 };
// level number -> course number (the game's course name table is indexed by course - 1)
export const LEVEL_COURSE = { 9: 1, 24: 2, 12: 3, 5: 4, 4: 5, 7: 6, 22: 7, 8: 8, 23: 9, 10: 10, 11: 11, 36: 12, 13: 13, 14: 14, 15: 15,
  17: 16, 19: 17, 21: 18, 27: 19, 28: 20, 29: 21, 18: 22, 31: 23, 20: 24 };
const CAPS = { wing: 3, metal: 4, vanish: 5 };
const CAP_BITS = { wing: 1, metal: 2, vanish: 4 };
const ANIM_SETS = { toad: [1, 6], bobomb: [2, 0], koopa: [3, 7], goomba: [4, 0], penguin: [5, 3], ukiki: [6, 0], yoshi: [7, 0], peach: [8, 0], chuckya: [9, 5] };
export const ZONE_COLOR = 0x50b4ff;

export function emptyStory() {
  return { version: 1, dialogs: [], texts: { dialogs: {}, courses: {}, acts: {}, ending: {}, credits: {} }, npcs: {}, vars: [], events: [], cutscenes: [], hidden: [], start: {} };
}

// Fill in what older stories miss.
export function normalizeStory(s) {
  const d = emptyStory();
  s = s && typeof s === 'object' ? s : {};
  for (const k of Object.keys(d)) if (s[k] === undefined) s[k] = d[k];
  for (const k of Object.keys(d.texts)) s.texts[k] ||= {};
  return s;
}

// An area key ('9:1', 'c:abc') is in a level picked as '9' or 'c:abc' (or the exact key).
// 'c:<id>' is the level with all its areas, 'c:<id>:<n>' one area ('c:<id>:1' the main area only).
export const inLevel = (key, level) => {
  if (!level || level === 'any' || key === level) return true;
  const main = /^c:[^:]+:1$/.exec(level);
  if (main) return key === level.slice(0, -2);
  return /^c:[^:]+$/.test(level) || /^\d+$/.test(level) ? key.startsWith(`${level}:`) : false;
};
// A level/area key from the pickers -> a warp destination.
export function keyTarget(key) {
  const m = /^c:([^:]+)(?::(\d+))?$/.exec(String(key || ''));
  if (m) return { custom: m[1], area: Number(m[2] || 1) };
  const [l, a] = String(key || '').split(':').map(Number);
  return l ? { level: l, area: a || 1 } : null;
}
const posOf = (a) => a?.pos || (a?.x != null ? { x: a.x, y: a.y, z: a.z, yaw: a.yaw } : null);

const cmp = (a, op, b) => {
  switch (op) {
    case '<': return a < b; case '<=': return a <= b; case '>': return a > b; case '>=': return a >= b;
    case '!=': return a !== b; default: return a === b;
  }
};

export class StoryRuntime {
  constructor({ engine, getStory, projectId, frame = null, toast = () => {}, isEditing = () => false, world = null, getLevels = () => [], autoStart = true, flow = () => null, resetSave = null }) {
    this.flow = flow;           // () => the WorldFlow (doors, warps, areas)
    this.resetSave = resetSave; // () => a fresh save of everything (savegame.js); calls resetProgress
    this.engine = engine;
    this.getStory = getStory;
    this.projectId = projectId;
    this.frameEl = frame;
    this.toast = toast;
    this.isEditing = isEditing;
    this.world = world;
    this.getLevels = getLevels;
    this.autoStart = autoStart; // the studio starts the story right away; the player waits for begin()
    this.begun = false;
    this.queue = [];          // event runs waiting
    this.running = null;      // the run in progress
    this.inZones = new Set(); // zone uids Mario is inside
    this.visit = 0;           // counts area loads (per-visit events)
    this.levelFrames = 0;
    this.frameWaiters = [];
    this.timers = new Map();  // event id -> fired this visit
    this.textsKey = null;
    this.editing = false;
    this.cut = null;          // the cutscene playing
    this.listeners = [];
    this.log = [];            // what happened (the panel's debugger shows it)
    loadTexts().then(() => this.applyTexts());
    this.hook();
  }

  get story() { return normalizeStory(this.getStory() || {}); }
  get M() { return this.engine.M; }
  on(fn) { this.listeners.push(fn); }
  emit(what) { for (const fn of this.listeners) { try { fn(what); } catch (e) { console.error(e); } } }
  note(text) {
    this.log.push({ t: Date.now(), text });
    if (this.log.length > 60) this.log.shift();
    this.emit('log');
  }

  // ---- hooks into the engine -----------------------------------------------------------

  hook() {
    const e = this.engine;
    // objects hidden until an event shows them, zones invisible while playing
    const spawn = e._spawnRecord.bind(e);
    e._spawnRecord = (o) => {
      if (o && o.zone && o.block) {
        const vis = this.isEditing();
        const block = { ...o.block, flags: ((o.block.flags | 0) & ~1) | 2 | 4 | (vis ? 0 : 1), color: o.block.color ?? ZONE_COLOR };
        return spawn({ ...o, block });
      }
      if (o && o.uid && !this.isEditing() && this.isHidden(o.uid)) return -1;
      return spawn(o);
    };
    // the star select screen shows the project's course names too (the studio gives it the title)
    let introInfo = e.introInfo;
    Object.defineProperty(e, 'introInfo', {
      configurable: true,
      get: () => (introInfo ? (lvl) => this.courseTitle(lvl, introInfo(lvl)) : null),
      set: (fn) => { introInfo = fn; },
    });
    e.levelHooks.push(() => this.onAreaLoad());
    e.on('area', () => this.afterArea());
    e.on('frame', () => this.tick());
    e.on('star', (ev) => this.fire('star', { uid: ev.uid, key: ev.key }));
    // cars and races (../vehicles.js): "vehicle" { uid, event }, "race" { uid, result }
    window.addEventListener('studio:vehicle', (ev) => { if (ev.detail?.engine === e) this.fire(ev.detail.kind, ev.detail); });
    // katana duels (../katana.js): "katana_duel" { uid, result }; a won duel is remembered in the save
    window.addEventListener('studio:katana', (ev) => {
      const d = ev.detail;
      if (d?.engine !== e || d.kind !== 'katana_duel') return;
      if (d.result === 'won') { this.progress.katanaWon = { ...(this.progress.katanaWon || {}), [d.uid]: true }; this.save(); }
      this.fire('katana_duel', d);
    });
    e.on('ready', () => { this.installCallbacks(); this.applyTexts(true); });
    if (e.ready) this.installCallbacks();
  }

  installCallbacks() {
    const M = this.M;
    if (!M) return;
    M.studioNpcDialog = (uid, orig) => this.npcDialog(uid, orig);
    M.studioStoryEvent = (kind, a, b, c) => setTimeout(() => this.onEngineEvent(kind, a, b, c), 0);
  }

  has(fn) { return !!this.M && typeof this.M[`_${fn}`] === 'function'; }

  // ---- progress (per project and save file) --------------------------------------------

  progressKey() { return `studio64.story.${this.projectId()}.f${this.has('studio_story_file') ? this.M._studio_story_file() : 1}`; }
  get progress() {
    if (!this._progress || this._progressKey !== this.progressKey()) {
      this._progressKey = this.progressKey();
      try { this._progress = JSON.parse(localStorage.getItem(this._progressKey) || 'null'); } catch { this._progress = null; }
      this._progress ||= { vars: {}, done: {}, objects: {}, started: false };
    }
    return this._progress;
  }
  save() { try { localStorage.setItem(this.progressKey(), JSON.stringify(this.progress)); } catch { /* private mode */ } this.emit('progress'); }
  resetProgress() {
    const locks = Object.keys(this._progress?.locks || {});
    this._progress = { vars: {}, done: {}, objects: {}, locks: {}, started: false };
    const wf = this.flow();
    if (wf) { for (const uid of locks) wf.lockOverrides.delete(Number(uid)); try { if (this.engine.ready) wf.registerLocks(); } catch { /* loading */ } }
    this.save();
    this.note('Progress reset');
  }

  varDef(id) { return this.story.vars.find((v) => v.id === id || v.name === id); }
  getVar(id) {
    const def = this.varDef(id);
    const key = def?.id || id;
    if (key in this.progress.vars) return this.progress.vars[key];
    if (def) return def.kind === 'flag' ? !!def.initial : Number(def.initial || 0);
    return 0;
  }
  setVar(id, value) {
    const def = this.varDef(id);
    const key = def?.id || id;
    const before = this.getVar(key);
    if (def?.kind === 'flag') value = !!value; else if (typeof value !== 'boolean') value = Number(value) || 0;
    this.progress.vars[key] = value;
    this.save();
    if (before !== value) {
      this.note(`${def?.name || key} = ${value}`);
      this.fire('var', { var: key });
    }
  }

  isHidden(uid) {
    const st = this.progress.objects[uid];
    if (st === 'hidden') return true;
    if (st === 'shown') return false;
    return (this.story.hidden || []).includes(uid);
  }

  // ---- texts ------------------------------------------------------------------------------

  // Write the project's texts into the engine (only what changed since last time).
  applyTexts(force = false) {
    if (!this.engine.ready || !texts() || !this.has('studio_text_dialog')) return;
    const s = this.story;
    const key = JSON.stringify([s.dialogs, s.texts]);
    if (!force && key === this.textsKey) return;
    this.textsKey = key;
    const M = this.M;
    M._studio_text_reset();
    const put = (fn, ...head) => (text) => {
      const bytes = encodeBytes(text);
      const p = M._malloc(bytes.length);
      M.HEAPU8.set(bytes, p);
      M[fn](...head, p, bytes.length);
      M._free(p);
    };
    for (const d of s.dialogs) {
      if (!(d.num >= DIALOG_BASE)) continue;
      const [left, top] = d.box || [30, 200];
      this._dialogParams(d.num, d.lines || 4, left, top, d.voice | 0, d.question ? 1 : 0, dialogText(d));
    }
    for (const [id, o] of Object.entries(s.texts.dialogs || {})) {
      const orig = texts().dialogs[Number(id)];
      if (!orig || !o) continue;
      const d = { ...orig, ...o };
      this._dialogParams(Number(id), d.lines || orig.lines, d.left ?? orig.left, d.width ?? orig.width, d.voice | 0, d.question ? 1 : 0, d.wrap === true ? dialogText(d) : (d.text ?? orig.text));
    }
    for (const [i, name] of Object.entries(s.texts.courses || {})) if (name != null) put('_studio_text_course', Number(i))(courseText(Number(i), name));
    for (const [i, name] of Object.entries(s.texts.acts || {})) if (name != null) put('_studio_text_act', Number(i))(String(name).toUpperCase());
    for (const [i, line] of Object.entries(s.texts.ending || {})) if (line != null) put('_studio_text_ending', Number(i))(line);
    for (const [i, page] of Object.entries(s.texts.credits || {})) {
      const t = creditsText(page);
      if (t !== null) M.ccall('studio_text_credits', null, ['number', 'string'], [Number(i), t]);
    }
  }

  _dialogParams(id, lines, left, top, voice, question, text) {
    const M = this.M;
    const bytes = encodeBytes(text);
    const p = M._malloc(bytes.length);
    M.HEAPU8.set(bytes, p);
    M._studio_text_dialog(id, p, bytes.length, lines, left, top, voice, question);
    M._free(p);
  }

  courseTitle(level, info) {
    const c = LEVEL_COURSE[level];
    const name = c && this.story.texts.courses?.[c - 1];
    if (info && name) info.title = name;
    return info;
  }

  // The engine id of a dialog reference: a project dialog id, "game:20", or a number.
  dialogNum(ref) {
    if (ref == null || ref === '') return -1;
    if (typeof ref === 'number') return ref;
    if (/^game:\d+$/.test(ref)) return Number(ref.slice(5));
    const d = this.story.dialogs.find((x) => x.id === ref || x.name === ref);
    return d?.num ?? -1;
  }

  // ---- characters ------------------------------------------------------------------------

  // The engine asks (inside a frame) what a tagged object says. -1: its own line.
  npcDialog(uid, orig) {
    try {
      const npc = this.story.npcs?.[uid];
      if (!npc) return -1;
      for (const line of npc.lines || []) {
        if (this.check(line.if || [])) {
          const n = this.dialogNum(line.dialog);
          if (n >= 0) { this.lastTalk = { uid, dialog: line.dialog }; return n; }
        }
      }
    } catch (err) { console.error('npc dialog', err); }
    return -1;
  }

  onEngineEvent(kind, a, b, c) {
    if (kind === 1) {
      // a talk ended: uid, answer (1 first choice, 2 second), dialog id
      const answer = b === 1 ? 'yes' : b === 2 ? 'no' : null;
      const npc = this.story.npcs?.[a];
      this.note(`Talked to ${npc?.name || `object ${a}`}${answer ? ` (answer: ${answer})` : ''}`);
      this.fire('talk', { uid: a, answer, dialog: c });
    } else if (kind === 2) {
      this.fire(b === 1 ? 'switch' : 'defeat', { uid: a });
    }
  }

  // ---- areas ------------------------------------------------------------------------------

  onAreaLoad() {
    // runs while the engine loads the area, before the patch spawns
    this.visit++;
    this.levelFrames = 0;
    this.inZones.clear();
    this.coinsFired = new Set();
    this.timers.clear();
    if (this.cut) this.endCutscene(true);
  }

  afterArea() {
    if (!this.engine.ready || this.engine.inIntro) return;
    this.syncLocks();
    this.installCallbacks();
    this.applyTexts();
    this.registerWatches();
    // the opening: a new game's first arrival
    if (!this.progress.started && (this.autoStart || this.begun)) {
      this.progress.started = true;
      this.save();
      this.fire('game_start', {});
    }
    this.fire('level_enter', { key: this.engine.areaKey() });
  }

  // Doors and warps that events opened or locked in this save (worldflow.js lock overrides).
  syncLocks() {
    const wf = this.flow();
    if (!wf) return;
    const locks = this.progress.locks || {};
    let changed = false;
    for (const [uid, v] of Object.entries(locks)) {
      if (wf.lockOverrides.get(Number(uid)) !== v) { wf.lockOverrides.set(Number(uid), v); changed = true; }
    }
    if (changed) { try { wf.registerLocks(); } catch { /* loading */ } }
  }

  // Open (locked = false) or lock a door, pipe, painting or warp zone for this save.
  setDoorLock(uid, locked) {
    const wf = this.flow();
    const found = wf?.findRecord?.(uid);
    if (!found?.rec?.warp) return false;
    (this.progress.locks ||= {})[uid] = !!locked;
    this.save();
    wf.setLocked(uid, !!locked, { persist: false });
    this.note(`${locked ? 'Locked' : 'Opened'} ${found.rec.name || 'a door'}`);
    if (found.key === this.engine.areaKey()) this.engine.playGameSound?.(locked ? SND.door : SND.secret);
    return true;
  }

  // The engine reports defeated objects and pressed switches for the triggers that need them.
  registerWatches() {
    if (!this.has('studio_story_watch')) return;
    this.M._studio_story_watch_clear();
    for (const ev of this.story.events) {
      const t = ev.trigger || {};
      if ((t.type === 'defeat' || t.type === 'switch') && t.uid) this.M._studio_story_watch(t.uid, t.type === 'switch' ? 1 : 0);
    }
  }

  // ---- every frame ------------------------------------------------------------------------

  tick() {
    for (const w of this.frameWaiters.splice(0)) w();
    this.hookObjects();
    const editing = this.isEditing();
    if (editing !== this.editing) { this.editing = editing; this.refreshEditorView(); }
    if (editing || !this.engine.ready || this.engine.inIntro) return;
    this.levelFrames++;
    if (this.cut) this.cutFrame();
    // positions and counters, a few times a second is plenty for coins
    let st = null;
    try { st = this.engine.state(); } catch { return; }
    const m = st?.mario;
    if (!m) return;
    this.mario = m;
    this.checkZones(m);
    if (this.levelFrames % 5 === 0) this.checkCounters(m);
    if (!this.running && this.queue.length) this.runNext();
  }

  // Custom objects (web/js/objects, window.studio64Objects) report spotted / hit / hurt_mario / defeated.
  hookObjects() {
    const O = typeof window !== 'undefined' ? window.studio64Objects : null;
    if (!O || this.objectsHooked === O || typeof O.on !== 'function') return;
    this.objectsHooked = O;
    O.on(({ uid, event }) => { if (!this.isEditing()) this.fire('object_event', { uid: Number(uid), event }); });
  }

  // Build mode shows zones and hidden objects; playing hides them again.
  refreshEditorView() {
    const key = this.engine.areaKey();
    const recs = this.engine.patch.areas?.[key]?.objects || [];
    for (const r of recs) {
      if (r.zone || this.isHidden(r.uid)) {
        this.engine.deleteUid(r.uid);
        this.engine._spawnRecord(r);
      }
    }
    if (this.editing && this.cut) this.endCutscene(true);
  }

  zones(key = this.engine.areaKey()) {
    return (this.engine.patch.areas?.[key]?.objects || []).filter((r) => r.zone && r.block);
  }

  static inside(r, p) {
    const a = -((r.yaw || 0) / 65536) * Math.PI * 2;
    const dx = p.x - r.x, dz = p.z - r.z;
    const lx = dx * Math.cos(a) + dz * Math.sin(a), lz = -dx * Math.sin(a) + dz * Math.cos(a);
    const b = r.block;
    return Math.abs(lx) <= b.sx / 2 && Math.abs(lz) <= b.sz / 2 && p.y >= r.y - 40 && p.y <= r.y + b.sy;
  }

  checkZones(m) {
    for (const z of this.zones()) {
      const inside = StoryRuntime.inside(z, m);
      const was = this.inZones.has(z.uid);
      if (inside && !was) { this.inZones.add(z.uid); this.note(`Entered zone ${z.zone.name || z.uid}`); this.fire('enter_zone', { uid: z.uid }); }
      else if (!inside && was) { this.inZones.delete(z.uid); this.fire('leave_zone', { uid: z.uid }); }
    }
  }

  checkCounters(m) {
    for (const ev of this.story.events) {
      const t = ev.trigger || {};
      if (t.type === 'coins' && m.coins >= (t.count | 0)) this.fire('coins', { id: ev.id });
      else if (t.type === 'red_coins' && this.has('studio_story_red_coins') && this.M._studio_story_red_coins() >= (t.count | 0)) this.fire('red_coins', { id: ev.id });
      else if (t.type === 'timer' && this.levelFrames >= (Number(t.seconds) || 0) * FPS) this.fire('timer', { id: ev.id });
      else if (t.type === 'var' && t.var) this.fire('var', { var: t.var });
    }
  }

  // ---- events -----------------------------------------------------------------------------

  matches(ev, type, d) {
    const t = ev.trigger || {};
    if (ev.enabled === false || t.type !== type || this.progress.vars[`__off_${ev.id}`]) return false;
    const here = this.engine.areaKey();
    if (ev.level && !inLevel(here, ev.level) && type !== 'game_start') return false;
    switch (type) {
      case 'enter_zone': case 'leave_zone': return t.zone === d.uid;
      case 'talk': return (!t.uid || t.uid === d.uid) && (!t.answer || t.answer === 'any' || t.answer === d.answer)
        && (!t.dialog || this.dialogNum(t.dialog) === d.dialog);
      case 'star': return !t.uid || t.uid === 'any' || t.uid === d.uid;
      case 'defeat': case 'switch': return t.uid === d.uid;
      case 'object_event': return (!t.uid || Number(t.uid) === d.uid) && (t.event || 'defeated') === d.event;
      case 'coins': case 'red_coins': case 'timer': return ev.id === d.id;
      case 'level_enter': return inLevel(d.key, t.level);
      case 'var': return t.var === d.var && this.check([{ type: 'var', var: t.var, op: t.op || '>=', value: t.value ?? true }]);
      case 'game_start': return true;
      case 'vehicle': return (!t.uid || Number(t.uid) === d.uid) && (t.event || 'enter') === d.event; // (../vehicles.js)
      case 'race': return (!t.uid || Number(t.uid) === d.uid) && (t.result || 'won') === d.result;
      case 'katana_duel': return (!t.uid || Number(t.uid) === d.uid) && (t.result || 'won') === d.result; // (../katana.js)
      default: return false;
    }
  }

  // Something happened: queue every event it starts.
  fire(type, d = {}) {
    for (const ev of this.story.events) {
      if (!this.matches(ev, type, d)) continue;
      const repeat = ev.repeat || 'once';
      const doneKey = ev.id;
      if (repeat === 'once' && this.progress.done[doneKey]) continue;
      if (repeat === 'visit' && this.timers.get(ev.id) === this.visit) continue;
      // level-bound triggers that fire every frame (coins, timers, vars) only once per visit
      if (['coins', 'red_coins', 'timer', 'var'].includes(type) && this.timers.get(ev.id) === this.visit) continue;
      if (this.queue.some((r) => r.ev.id === ev.id) || this.running?.ev.id === ev.id) continue;
      if (!this.check(ev.conditions || [])) continue;
      this.timers.set(ev.id, this.visit);
      if (repeat === 'once') { this.progress.done[doneKey] = Date.now(); this.save(); }
      this.queue.push({ ev, d });
      this.note(`▶ ${ev.name || 'Event'}`);
    }
  }

  // A star's dance and the level exit after it (course complete, the warp out) come first: an
  // event started by the star ("When a star is collected") would otherwise lose its dialog with
  // the old level, and a cutscene would freeze the dance and keep Mario in the level for good.
  async afterStarDance() {
    const STAR = [0x1302, 0x1303, 0x1904, 0x1307]; // star dance (exit, water), falling after the grab, no exit
    const act = () => { try { return parseInt(this.engine.state().mario?.action, 16) >>> 0; } catch { return 0; } };
    const dbg = () => (this.has('studio_story_debug') ? this.M._studio_story_debug() : 0);
    if (!STAR.includes(act())) return;
    const v = this.visit;
    // (bits 1 and 2: a warp transition, not in normal play: the exit is on its way)
    await this.waitWhile(() => this.visit === v && (STAR.includes(act()) || (dbg() & 6)), FPS * 40);
    if (this.visit === v) return; // a star that stays in the level: the dance is over
    await this.waitWhile(() => {
      const e = this.engine;
      let m = null;
      try { m = e.state().mario; } catch { /* loading */ }
      // (and the course complete screen Mario lands into: ACT_EXIT_LAND_SAVE_DIALOG)
      return e.inIntro || !m || (dbg() & 6) !== 0 || act() === 0x1327;
    }, FPS * 60);
  }

  // Run an event's actions now (the panel's Test button).
  test(ev) { this.queue.push({ ev, d: {} }); }

  async runNext() {
    const run = this.queue.shift();
    if (!run) return;
    this.running = run;
    try {
      await this.afterStarDance();
      await this.runActions(run.ev.actions || [], run);
    } catch (err) {
      console.error('story event failed', err);
      this.note(`✖ ${run.ev.name || 'Event'}: ${err.message}`);
    }
    this.running = null;
  }

  // ---- conditions -----------------------------------------------------------------------

  check(conds) {
    for (const c of conds || []) if (!this.test1(c)) return false;
    return true;
  }

  test1(c) {
    const m = this.mario || {};
    switch (c.type) {
      case 'flag': return !!this.getVar(c.var) === (c.value !== false);
      case 'var': {
        const v = this.getVar(c.var);
        return cmp(typeof v === 'boolean' ? Number(v) : v, c.op || '>=', typeof c.value === 'boolean' ? Number(c.value) : Number(c.value));
      }
      case 'stars': return cmp(m.stars | 0, c.op || '>=', Number(c.value) || 0);
      case 'coins': return cmp(m.coins | 0, c.op || '>=', Number(c.value) || 0);
      case 'lives': return cmp(m.lives | 0, c.op || '>=', Number(c.value) || 0);
      case 'health': return cmp(m.health | 0, c.op || '>=', Number(c.value) || 0);
      case 'cap': return this.has('studio_story_caps') && ((this.M._studio_story_caps() & CAP_BITS[c.cap]) !== 0) === (c.value !== false);
      case 'act': return cmp(this.engine.state().act | 0, c.op || '==', Number(c.value) || 1);
      case 'level': return inLevel(this.engine.areaKey(), c.key);
      case 'event_done': return !!this.progress.done[c.event] === (c.value !== false);
      case 'star': return !!this.world?.progress?.()[`${c.key}|${c.uid}`] === (c.value !== false);
      case 'random': return Math.random() * 100 < (Number(c.chance) || 50);
      case 'driving': return !!window.studio64Vehicles?.driving() === (c.value !== false);
      case 'katana': return this.has('studio_katana_has') && (this.M._studio_katana_has() !== 0) === (c.value !== false);
      case 'katana_duel_won': { const w = this.progress.katanaWon || {}; return (c.uid ? !!w[c.uid] : Object.keys(w).length > 0) === (c.value !== false); }
      case 'shotgun': return this.has('studio_shotgun_has') && (this.M._studio_shotgun_has() !== 0) === (c.value !== false);
      default: return true;
    }
  }

  // ---- actions ----------------------------------------------------------------------------

  frames(n = 1) { return new Promise((r) => { const step = (k) => (k <= 0 ? r() : this.frameWaiters.push(() => step(k - 1))); step(n); }); }
  async waitWhile(fn, maxFrames = FPS * 600) {
    for (let i = 0; i < maxFrames && fn(); i++) await this.frames(1);
  }

  async runActions(list, run) {
    for (const a of list) {
      if (run?.stop) return;
      await this.runAction(a, run);
    }
  }

  async runAction(a, run) {
    const e = this.engine, M = this.M;
    switch (a.type) {
      case 'dialog': {
        const n = this.dialogNum(a.dialog);
        if (n < 0) return;
        M._studio_story_dialog(n);
        await this.frames(2);
        await this.waitWhile(() => M._studio_story_dialog_busy());
        const r = M._studio_story_response();
        if (a.answer_var) this.setVar(a.answer_var, r === 1);
        if (run) run.answer = r === 1 ? 'yes' : r === 2 ? 'no' : null;
        return;
      }
      case 'set_flag': this.setVar(a.var, a.value === 'toggle' ? !this.getVar(a.var) : !(a.value === false || a.value === 'false')); return;
      case 'set_var': {
        const v = Number(a.value) || 0;
        const cur = Number(this.getVar(a.var)) || 0;
        this.setVar(a.var, a.op === 'add' ? cur + v : a.op === 'sub' ? cur - v : v);
        return;
      }
      case 'open_door': case 'lock_door': {
        // doors, pipes, paintings and warp zones (warp records) open and lock; any other
        // object (a gate, a wall) is removed for good
        for (const uid of [].concat(a.uid || [])) {
          if (this.setDoorLock(Number(uid), a.type === 'lock_door')) continue;
          if (a.type === 'open_door') this.setObject(uid, false, 'door');
          else this.setObject(uid, true, 'none');
        }
        return;
      }
      case 'show': case 'hide': {
        for (const uid of [].concat(a.uid || [])) this.setObject(uid, a.type === 'show', a.effect);
        return;
      }
      case 'spawn': {
        const at = this.where(a.at);
        if (!at) return;
        const n = Math.min(20, Math.max(1, a.count | 0 || 1));
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2;
          const r = n > 1 ? 160 : 0;
          e.spawn({ uid: 0x7d000000 + Math.floor(Math.random() * 0xffffff), entry: a.entry || 'yellow_coin', x: at.x + Math.sin(ang) * r, y: at.y + (a.y_offset || 0), z: at.z + Math.cos(ang) * r, yaw: 0 });
        }
        e.playGameSound?.(SND.spawn);
        return;
      }
      case 'give_star': {
        const rec = this.recordOf(a.uid);
        if (!rec) return;
        if (this.isHidden(rec.uid)) this.setObject(rec.uid, true, 'none');
        if (a.at === 'mario' && this.mario) {
          e.deleteUid(rec.uid);
          const yaw = (this.mario.yaw / 65536) * Math.PI * 2;
          e.spawn({ ...rec, x: Math.round(this.mario.x + Math.sin(yaw) * 220), y: Math.round(this.mario.y + 160), z: Math.round(this.mario.z + Math.cos(yaw) * 220) });
        }
        e.playGameSound?.(SND.star);
        return;
      }
      case 'start_motion': for (const uid of [].concat(a.uid || [])) window.studio64Objects?.trigger?.(Number(uid)); return;
      case 'coins': M._studio_story_give(0, a.amount | 0 || 1); return;
      case 'lives': M._studio_story_give(1, a.amount | 0 || 1); return;
      case 'health': M._studio_story_give(2, a.amount | 0 || 8); return;
      case 'cap': M._studio_story_give(CAPS[a.cap] || 3, Math.round((Number(a.seconds) || 0) * 1)); return;
      case 'red_coin': M._studio_story_give(6, a.amount | 0 || 1); return;
      case 'music': {
        const v = a.song ? `song:${a.song}` : String(a.seq ?? '');
        if (v.startsWith('song:') && this.world) {
          const song = this.world.getSongs?.().find((x) => x.id === v.slice(5));
          if (song) { const { encodeSong } = await import('../music.js'); e.setLevelSong(encodeSong(song), song.bank); }
        } else if (v !== '') e.setMusic(Number(v));
        return;
      }
      case 'sound': if (a.bits) e.playGameSound(Number(a.bits) >>> 0); return;
      case 'warp': {
        // to: a level or area ('9', 'c:<id>', 'c:<id>:<n>'), optionally a warp object there
        // (a door, pipe or arrival point: Mario comes out of it) or a position
        const lv = a.custom ? `c:${a.custom}${a.area > 1 ? `:${a.area}` : ''}` : String(a.level ?? '');
        const to = keyTarget(lv);
        const wf = this.flow();
        const p = posOf(a);
        if (to && wf) {
          let node;
          if (a.uid) {
            const d = wf.resolve({ ...to, uid: Number(a.uid) });
            if (d && d.destNode) node = d.destNode;
          }
          // an original level without an area: its entry with the act chosen
          if (to.level && !/:/.test(lv) && !node) e.warpFast(to.level, Number(a.act) || 1, null, false);
          else wf.goArea(to, { intro: false, node });
        } else if (to?.custom) e.warpFast(e.studioLevel, 0, to.custom, false);
        else if (to?.level) e.warpFast(to.level, Number(a.act) || 1, null, false);
        if (to && (p || run)) {
          await e.waitArrival(null, 20000);
          if (p) e.teleport(p.x, p.y ?? 0, p.z, Math.round(((p.yaw || 0) / 360) * 65536));
        }
        return;
      }
      case 'shotgun': M._studio_shotgun_give?.(a.on === 'take' ? 0 : 1); return; // (../shotgun.js)
      case 'katana': M._studio_katana_give?.(a.on === 'take' ? 0 : 1); return; // (../katana.js)
      case 'start_race': window.studio64Vehicles?.startRace(Number(a.uid)); return; // (../vehicles.js)
      case 'teleport': { const p = posOf(a); if (p) e.teleport(p.x, p.y ?? 0, p.z, Math.round(((p.yaw || 0) / 360) * 65536)); return; }
      case 'cutscene': {
        const cs = this.story.cutscenes.find((c) => c.id === a.cutscene || c.name === a.cutscene);
        if (cs) await this.playCutscene(cs);
        return;
      }
      case 'timer': M._studio_story_timer({ hide: 0, start: 1, stop: 2, resume: 3 }[a.op] ?? 1); return;
      case 'shake': M._studio_story_shake(a.strength === 'big' ? 2 : 1); return;
      case 'wait': await this.frames(Math.round((Number(a.seconds) || 1) * FPS)); return;
      case 'caption': await this.caption(a.text, Number(a.seconds) || 3, false); return;
      case 'finish_level': M._studio_story_exit(0); return;
      case 'ending': M._studio_story_exit(1); return;
      case 'if': {
        const ok = (a.answer ? run?.answer === a.answer : true) && this.check(a.conditions || []);
        await this.runActions(ok ? a.then || [] : a.else || [], run);
        return;
      }
      case 'enable_event': {
        const ev = this.story.events.find((x) => x.id === a.event);
        if (ev) {
          if (a.reset) { delete this.progress.done[ev.id]; this.save(); }
          this.progress.vars[`__off_${ev.id}`] = a.on === false;
        }
        return;
      }
      default: console.warn('unknown story action', a.type);
    }
  }

  recordOf(uid) {
    for (const a of Object.values(this.engine.patch.areas || {})) {
      const r = (a.objects || []).find((x) => x.uid === uid);
      if (r) return r;
    }
    return null;
  }

  where(at) {
    const m = this.mario;
    if (!at || at === 'mario') {
      if (!m) return null;
      const yaw = (m.yaw / 65536) * Math.PI * 2;
      return { x: m.x + Math.sin(yaw) * 250, y: m.y + 20, z: m.z + Math.cos(yaw) * 250 };
    }
    if (typeof at === 'number' || /^\d+$/.test(String(at))) {
      const r = this.recordOf(Number(at));
      return r ? { x: r.x, y: r.y + (r.block ? r.block.sy / 2 : 0), z: r.z } : null;
    }
    return { x: Number(at.x) || 0, y: Number(at.y) || 0, z: Number(at.z) || 0 };
  }

  // Show or hide an object for good (saved in the progress).
  setObject(uid, show, effect = 'puff') {
    const rec = this.recordOf(uid);
    this.progress.objects[uid] = show ? 'shown' : 'hidden';
    this.save();
    const e = this.engine;
    const here = rec && Object.entries(e.patch.areas || {}).find(([, a]) => (a.objects || []).includes(rec))?.[0] === e.areaKey();
    if (!here) return;
    if (show) {
      e.deleteUid(uid);
      e._spawnRecord(rec);
      if (effect !== 'none') { e.playGameSound?.(SND.secret); this.puff(rec); }
    } else {
      e.deleteUid(uid);
      if (effect === 'door') e.playGameSound?.(SND.door);
      if (effect !== 'none') this.puff(rec);
    }
    this.note(`${show ? 'Showed' : 'Removed'} ${rec?.name || rec?.zone?.name || `object ${uid}`}`);
  }

  puff(rec) {
    if (rec && this.has('studio_story_puff')) this.M._studio_story_puff(rec.x, rec.y + (rec.block ? rec.block.sy / 2 : 60), rec.z);
  }

  // ---- captions and fades (drawn over the game) -----------------------------------------------

  overlay(cls) {
    if (!this.frameEl) return null;
    let o = this.frameEl.querySelector(`.story-${cls}`);
    if (!o) { o = document.createElement('div'); o.className = `story-${cls}`; this.frameEl.appendChild(o); }
    return o;
  }

  async caption(text, seconds = 3, keep = false) {
    const o = this.overlay('caption');
    if (!o) return;
    o.textContent = text || '';
    o.classList.add('on');
    if (keep) return;
    await this.frames(Math.round(seconds * FPS));
    o.classList.remove('on');
  }

  async fade(to, seconds = 0.6, color = '#000') {
    const o = this.overlay('fade');
    if (!o) return;
    o.style.background = color;
    o.style.transition = `opacity ${seconds}s linear`;
    o.style.opacity = to ? '1' : '0';
    await this.frames(Math.round(seconds * FPS));
  }

  // ---- cutscenes ----------------------------------------------------------------------------

  // Play a cutscene: Mario freezes, the camera follows the shots, Start skips.
  async playCutscene(cs, { preview = false } = {}) {
    if (this.cut) return;
    const e = this.engine, M = this.M;
    const cut = { cs, skip: false, cam: null, preview };
    this.cut = cut;
    this.emit('cutscene');
    this.note(`🎬 ${cs.name || 'Cutscene'}`);
    M._studio_story_lock(1, cs.hud ? 1 : 0);
    await this.waitWhile(() => !M._studio_story_locked() && this.cut === cut, FPS * 5);
    const c0 = e.camOut();
    cut.cam = { pos: c0.pos.slice(), focus: c0.focus.slice(), fov: c0.fov || 45 };
    cut.ownCam = false;
    try {
      for (const step of cs.steps || []) {
        if (cut.skip || this.cut !== cut) break;
        await this.cutStep(step, cut);
      }
    } finally {
      if (this.cut === cut) this.endCutscene(cut.skip);
    }
  }

  cutFrame() {
    const cut = this.cut;
    if (!cut) return;
    if ((cut.cs.skippable !== false) && this.M._studio_story_skip()) {
      cut.skip = true;
      this.note('Cutscene skipped');
      if (this.has('studio_story_close_dialog')) this.M._studio_story_close_dialog();
    }
    if (cut.ownCam && cut.cam) this.engine.setCamera(true, cut.cam.pos, cut.cam.focus, cut.cam.fov);
  }

  async cutStep(s, cut) {
    const e = this.engine, M = this.M;
    switch (s.type) {
      case 'shot': {
        const from = { pos: cut.cam.pos.slice(), focus: cut.cam.focus.slice(), fov: cut.cam.fov };
        const to = { pos: s.pos || from.pos, focus: s.focus || from.focus, fov: s.fov || from.fov };
        const n = Math.max(0, Math.round((Number(s.seconds) || 0) * FPS));
        const ease = EASE[s.ease || 'smooth'] || EASE.smooth;
        cut.ownCam = true;
        for (let i = 1; i <= n && !cut.skip; i++) {
          const t = ease(i / n);
          cut.cam = { pos: lerp3(from.pos, to.pos, t), focus: lerp3(from.focus, to.focus, t), fov: lerp(from.fov, to.fov, t) };
          await this.frames(1);
        }
        cut.cam = { pos: to.pos.slice(), focus: to.focus.slice(), fov: to.fov };
        if (!n) await this.frames(1);
        return;
      }
      case 'follow_mario': {
        // back to the game's own camera (the player's view) for the rest
        cut.ownCam = false;
        e.setCamera(false);
        return;
      }
      case 'dialog': {
        const n = this.dialogNum(s.dialog);
        if (n < 0) return;
        M._studio_story_dialog(n);
        await this.frames(2);
        await this.waitWhile(() => M._studio_story_dialog_busy() && !cut.skip);
        return;
      }
      case 'wait': await this.waitFrames(Math.round((Number(s.seconds) || 1) * FPS), cut); return;
      case 'caption': {
        this.caption(s.text, Number(s.seconds) || 3, true);
        await this.waitFrames(Math.round((Number(s.seconds) || 3) * FPS), cut);
        this.overlay('caption')?.classList.remove('on');
        return;
      }
      case 'fade': await this.fade(s.to !== 'in', Number(s.seconds) || 0.6, s.color || '#000'); return;
      case 'move': {
        const rec = this.recordOf(s.uid);
        if (!rec) return;
        const obj = e.objects().find((o) => o.uid === s.uid);
        if (!obj) return;
        const from = [obj.x, obj.y, obj.z];
        const q = posOf(s) || {};
        const to = [q.x ?? from[0], q.y ?? from[1], q.z ?? from[2]];
        const n = Math.max(1, Math.round((Number(s.seconds) || 1) * FPS));
        const ease = EASE[s.ease || 'smooth'] || EASE.smooth;
        const visit = this.visit;
        const go = async () => {
          for (let i = 1; i <= n; i++) {
            // another area: the slot is someone else now; skipped (Start): straight to the end
            if (this.visit !== visit) return;
            if (cut.skip) i = n;
            const p = lerp3(from, to, ease(i / n));
            e.moveSlot(obj.slot, p[0], p[1], p[2], s.yaw != null ? Math.round((s.yaw / 360) * 65536) : obj.yaw);
            await this.frames(1);
          }
        };
        if (s.wait === false) go(); else await go();
        return;
      }
      case 'mario': {
        // put Mario somewhere for the scene
        const q = posOf(s);
        if (q) e.teleport(q.x, q.y ?? 0, q.z, Math.round(((q.yaw || 0) / 360) * 65536));
        return;
      }
      case 'action': await this.runAction(s.action || {}, null); return;
      default: return;
    }
  }

  async waitFrames(n, cut) {
    for (let i = 0; i < n && !cut.skip; i++) await this.frames(1);
  }

  endCutscene() {
    const cut = this.cut;
    this.cut = null;
    if (!cut) return;
    try {
      this.engine.setCamera(false);
      this.M._studio_story_lock(0, 1);
    } catch { /* engine gone */ }
    const f = this.overlay('fade');
    if (f) { f.style.transition = 'opacity .3s'; f.style.opacity = '0'; }
    this.overlay('caption')?.classList.remove('on');
    this.emit('cutscene');
  }

  stop() {
    if (this.running) this.running.stop = true;
    this.queue.length = 0;
    if (this.cut) { this.cut.skip = true; this.endCutscene(); }
  }

  // ---- the hack's start ---------------------------------------------------------------------

  // The player pressed Play: a new save goes to the start, a saved one goes on.
  begin() {
    this.begun = true;
    if (this.progress.started) return;
    const s = this.story.start || {};
    if (s.level || s.custom || s.dialog || s.cutscene || s.intro || s.pos) this.playFromStart({ reset: false });
    else this.afterArea();
  }

  // Start the hack like a player would: fresh progress, the start level, the opening.
  async playFromStart({ reset = true } = {}) {
    const s = this.story.start || {};
    // a fresh save of everything (the game's save file, stars, keys, doors, story) when the
    // studio/player gave one; else the story's progress
    if (reset) { if (this.resetSave) this.resetSave(); else this.resetProgress(); }
    this.stop();
    const e = this.engine;
    const wf = this.flow();
    if (wf) { wf.goalShown = false; wf.returnTo = null; }
    // where: the story's start, else the world's start (World tab), else the castle grounds
    const ws = !s.custom && !s.level ? wf?.startTarget?.() : null;
    let level = Number(s.level) || 16;
    if (s.custom) {
      if (wf && (s.area || 1) > 1) wf.goArea({ custom: s.custom, area: s.area }, { intro: !!s.starSelect });
      else e.warpFast(e.studioLevel, 0, s.custom, !!s.starSelect);
    } else if (ws) {
      level = ws.custom ? e.studioLevel : ws.level;
      wf.goArea(ws, { intro: !!s.starSelect });
    } else e.warpFast(level, 1, null, !!s.starSelect); // default: the castle grounds
    await e.waitArrival(null, 30000);
    if (s.pos && s.pos.x != null) e.teleport(s.pos.x, s.pos.y, s.pos.z, Math.round(((s.pos.yaw || 0) / 360) * 65536));
    else if (!s.custom && !ws?.custom && level === 16 && !s.intro) e.teleport(-1328, 260, 4664, 0x8000); // where a new game starts
    // the game's own opening (castle grounds): Peach's letter, Lakitu and the pipe
    if (s.intro && this.has('studio_story_intro')) {
      await this.frames(2);
      if (this.M._studio_story_intro()) await this.waitWhile(() => (this.engine.state().mario?.action || '') === '0x04001301', FPS * 90);
    }
    if (s.dialog) this.queue.push({ ev: { id: '__opening', name: 'Opening', actions: [{ type: 'dialog', dialog: s.dialog }] }, d: {} });
    if (s.cutscene) this.queue.push({ ev: { id: '__opening_cs', name: 'Opening cutscene', actions: [{ type: 'cutscene', cutscene: s.cutscene }] }, d: {} });
  }

  // For the panel: a uid's NPC preset animation.
  static animFor(kind) { return ANIM_SETS[kind] || [0, 0]; }
}
