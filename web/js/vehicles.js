// Vehicles: the drivable cars and races ported from the Shoggoth World hack (the browser side).
//
//   installVehicles(...)        studio and standalone player (from installObjectsEngine): every car
//                               and race record gets its settings in the engine when it spawns, the
//                               HUD over the game (speedometer, prompts, the race's panels and
//                               banners), events for the story ("vehicle", "race")
//   installVehiclesEditor(...)  build mode (from installObjectsEditor): defaults for new cars and
//                               races, the inspector's Car and Race sections, the race course with
//                               the path tool
//
// Records: { entry: 'vehicle:<look>', vehicle: { look, top (km/h), accel, handling, color, boost,
// radio } } for cars; races are { entry: 'vehicle:race', vehicle: {...the rival's car},
// race: { laps, difficulty, width, rival, player: { look, color }, traffic, rubber, lines },
// star: { name }, motion: { path } } (the course: the motion path tool, the race reads it back).
// Engine side: engine/src/studio/vehicle.c, vehicle_race.c, vehicle_models.c (docs/vehicles.md).

import { el, esc, svg, clamp, deepCopy, withFloats } from './objects/common.js';
import { registerRpc } from './studio.js';
import { GAME_SONGS } from './music.js';

export const KMH = 1.08; // units per frame -> km/h on the dial (New York's)
export const RACE_ENTRY = 'vehicle:race';

// The looks, in the engine's order (vehicle_models.c sSources): paint = their lacquer can be repainted
export const LOOKS = [
  { id: 'sportscar', name: 'Sportscar', paint: '#d42020', top: 95, open: true, about: "New York's red convertible" },
  { id: 'racer', name: 'Race car', paint: '#d42020', top: 120, open: true, about: "Mario's car on the Shuto" },
  { id: 'drift_king', name: "Drift King's car", top: 120, open: true, about: 'The Drift King\'s silver racer' },
  { id: 'taxi', name: 'Taxi', paint: '#f2b81c', top: 80, about: 'A yellow New York cab' },
  { id: 'sedan', name: 'Sedan', top: 80, about: 'A black sedan' },
  { id: 'bus', name: 'Bus', top: 58, about: 'A city bus' },
  { id: 'shuto_van', name: 'Delivery van', top: 80, about: 'A white delivery van from the Shuto' },
  { id: 'shuto_cab', name: 'Tokyo cab', top: 85, about: 'A black Tokyo taxi' },
  { id: 'kei', name: 'Kei car', top: 70, about: 'A tiny Japanese car' },
  { id: 'kei_truck', name: 'Kei truck', top: 65, about: 'A tiny Japanese truck' },
];
const lookIndex = (id) => Math.max(0, LOOKS.findIndex((l) => l.id === id));
export const lookOf = (rec) => LOOKS.find((l) => l.id === (rec?.vehicle?.look || String(rec?.entry || '').slice(8))) || LOOKS[rec?.entry === RACE_ENTRY ? 2 : 0];
export const isVehicle = (rec) => String(rec?.entry || '').startsWith('vehicle:');
export const isRace = (rec) => rec?.entry === RACE_ENTRY;

export const DIFFICULTY = { easy: 0.84, normal: 0.92, hard: 0.97, expert: 1.02 };
export const COLORS = ['#d42020', '#2860e0', '#f2b81c', '#20a050', '#f4f4f4', '#202024', '#e060b0', '#f07818', '#8040d0', '#40c8e0'];

// The Drift King's lines (the hack's text_strings.h.in and dialogs)
export const LINES = {
  start: 'Try to keep up, plumber.',
  ahead: 'Too slow! Enjoy my tail lights.',
  passed: 'Tch... not bad. For a plumber.',
  final: 'Final lap. No more games!',
  crash: 'Ha! The wall wins again.',
  back: 'Out of my mirror, rookie!',
  close: "You're still there?!",
  won: 'Heh. Too slow, plumber. Want another go?',
  lost: '...Impossible. Take it, plumber -- tonight YOU are the champion.',
};
const LINE_ORDER = ['start', 'ahead', 'passed', 'final', 'crash', 'back', 'close', 'won', 'lost'];
const LINE_LABELS = { start: 'At the start', ahead: 'He passes Mario', passed: 'Mario passes him', final: 'His final lap', crash: 'Mario crashes', back: 'Mario right behind', close: 'Mario just ahead', won: 'He wins', lost: 'He loses' };

export const RACE_DEFAULTS = { laps: 3, difficulty: 'normal', width: 900, rival: 'Drift King', player: { look: 'racer', color: '' }, traffic: 0, rubber: true, lines: {} };

const hex = (c) => (c && /^#?[0-9a-f]{6}$/i.test(c) ? parseInt(c.replace('#', ''), 16) || 0x010101 : 0);

// ---------------------------------------------------------------------------
// The engine side of a record

export function vehicleConfig(rec) {
  const v = rec.vehicle || {};
  const look = lookOf(rec);
  const top = Number(v.top) > 0 ? Number(v.top) / KMH : 0;
  return [lookIndex(look.id), top, Number(v.handling) || 1, Number(v.accel) || 1, look.paint ? hex(v.color) : 0, v.boost ? 1 : 0, Number(v.radio) || 0, v.lights ? 1 : 0];
}

export function raceConfig(rec, starDone) {
  const r = { ...RACE_DEFAULTS, ...(rec.race || {}) };
  const p = { ...RACE_DEFAULTS.player, ...(r.player || {}) };
  const pl = LOOKS.find((l) => l.id === p.look) || LOOKS[1];
  const path = rec.motion?.path;
  return [clamp(r.laps | 0 || 3, 1, 9), DIFFICULTY[r.difficulty] || Number(r.difficulty) || 0.92, clamp(Number(r.width) || 900, 300, 4000),
    lookIndex(pl.id), pl.paint ? hex(p.color) : 0, Number(p.top) > 0 ? Number(p.top) / KMH : 0, clamp(r.traffic | 0, 0, 10),
    rec.star ? 1 : 0, starDone ? 1 : 0, path?.smooth === false ? 0 : 1, r.rubber === false ? 0 : 1];
}

export function applyVehicle(engine, rec, slot, starDone = false) {
  const M = engine.M;
  if (!M?._studio_vehicle_config || slot < 0) return;
  withFloats(engine, vehicleConfig(rec), (p, n) => M._studio_vehicle_config(slot, p, n));
  if (isRace(rec)) withFloats(engine, raceConfig(rec, starDone), (p, n) => M._studio_race_config(slot, p, n));
}

// A first course in front of a new race: a rounded loop on the ground (points relative to it).
export function defaultCourse(engine, rec, length = 5200, width = 2600) {
  const a = ((rec.yaw | 0) / 65536) * Math.PI * 2;
  const fwd = [Math.sin(a), Math.cos(a)], right = [-Math.cos(a), Math.sin(a)];
  const shape = [[0, 0], [0, 0.42], [0.12, 0.5], [0.5, 0.56], [0.88, 0.5], [1, 0.42], [1, 0], [1, -0.42], [0.88, -0.5], [0.5, -0.56], [0.12, -0.5], [0, -0.42]];
  const pts = shape.map(([s, f]) => {
    const x = rec.x + fwd[0] * f * length + right[0] * s * width;
    const z = rec.z + fwd[1] * f * length + right[1] * s * width;
    let y = rec.y;
    try { const g = engine.floor(x, rec.y + 1500, z); if (g > -20000) y = g; } catch { /* no floor query */ }
    return [Math.round(x - rec.x), Math.round(y - rec.y), Math.round(z - rec.z)];
  });
  pts[0] = [0, 0, 0];
  return { path: { points: pts, speed: 60, mode: 'loop', wait: 0, smooth: true, trigger: 'always', radius: 800, phase: 0, face: false } };
}

// ---------------------------------------------------------------------------
// The HUD over the game

const HUD_FLOATS = 48;

function loadCss() {
  if (typeof document === 'undefined' || document.querySelector('link[data-vehicles-css]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.dataset.vehiclesCss = '1';
  l.href = new URL('../css/vehicles.css', import.meta.url).href;
  document.head.appendChild(l);
}

const fmtTime = (frames) => {
  const t = Math.max(0, frames) / 30;
  const m = Math.floor(t / 60), s = Math.floor(t % 60), cs = Math.floor((t * 100) % 100);
  return `${m}'${String(s).padStart(2, '0')}"${String(cs).padStart(2, '0')}`;
};

class Hud {
  constructor(host, vehicles) {
    this.v = vehicles;
    this.root = el('div', 'vh-hud');
    this.root.setAttribute('aria-hidden', 'true');
    this.root.innerHTML = `
      <div class="vh-speedo" hidden>
        <svg viewBox="0 0 120 120"><defs><linearGradient id="vh-grad" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#30f090"/><stop offset="1" stop-color="#f0e040"/></linearGradient></defs>
          <circle cx="60" cy="60" r="56" class="vh-glass"/><circle cx="60" cy="60" r="53" class="vh-bezel"/>
          <path class="vh-track"/><path class="vh-red"/><path class="vh-fill"/><path class="vh-over"/><g class="vh-ticks"></g></svg>
        <b class="vh-kmh">0</b><i>km/h</i>
        <div class="vh-drift"><span></span></div>
      </div>
      <div class="vh-prompt" hidden></div>
      <div class="vh-howto" hidden></div>
      <div class="vh-race" hidden>
        <div class="vh-panel vh-pos"><b class="vh-place">-</b><sup class="vh-suffix"></sup><span class="vh-sep"></span><span class="vh-lab">LAP</span><b class="vh-lap">1</b><span class="vh-laps">/3</span></div>
        <div class="vh-panel vh-time"><span class="vh-lab">TIME</span><b class="vh-clock">0'00"00</b><span class="vh-lab vh-sub-lab"></span><b class="vh-sub"></b></div>
        <canvas class="vh-map" width="150" height="150"></canvas>
      </div>
      <div class="vh-count" hidden></div>
      <div class="vh-banner" hidden><b></b><span></span></div>
      <div class="vh-flash" hidden></div>
      <div class="vh-taunt" hidden><em></em><span></span></div>`;
    host.appendChild(this.root);
    this.q = (s) => this.root.querySelector(s);
    this.buildDial();
    this.last = {};
  }

  buildDial() {
    // a 270 degree dial: 0 at the bottom left, round over the top to the bottom right
    const arc = (f0, f1, r) => {
      const a0 = (135 + f0 * 270) * Math.PI / 180, a1 = (135 + f1 * 270) * Math.PI / 180;
      const p = (a) => `${(60 + Math.cos(a) * r).toFixed(2)} ${(60 + Math.sin(a) * r).toFixed(2)}`;
      return `M ${p(a0)} A ${r} ${r} 0 ${f1 - f0 > 2 / 3 ? 1 : 0} 1 ${p(a1)}`;
    };
    this.arc = arc;
    this.q('.vh-track').setAttribute('d', arc(0, 1, 44));
    let ticks = '';
    for (let i = 0; i <= 12; i++) {
      const a = (135 + i / 12 * 270) * Math.PI / 180, r0 = i & 1 ? 36 : 34, r1 = 39;
      ticks += `<line x1="${60 + Math.cos(a) * r0}" y1="${60 + Math.sin(a) * r0}" x2="${60 + Math.cos(a) * r1}" y2="${60 + Math.sin(a) * r1}" class="${i & 1 ? 'minor' : ''}"/>`;
    }
    this.q('.vh-ticks').innerHTML = ticks;
  }

  set(sel, prop, value) {
    const k = sel + prop;
    if (this.last[k] === value) return;
    this.last[k] = value;
    const e = this.q(sel);
    if (prop === 'hidden') e.hidden = value;
    else if (prop === 'text') e.textContent = value;
    else if (prop === 'html') e.innerHTML = value;
    else if (prop === 'class') e.className = value;
    else e.setAttribute(prop, value);
  }

  hide() {
    if (this.last.all === false) return;
    this.last = { all: false };
    for (const s of ['.vh-speedo', '.vh-prompt', '.vh-race', '.vh-count', '.vh-banner', '.vh-flash', '.vh-taunt']) this.q(s).hidden = true;
  }

  update(h) {
    this.last.all = true;
    const driving = h[0] >= 1;
    // the speedometer
    this.set('.vh-speedo', 'hidden', !driving || (h[18] >= 1 && h[18] < 2));
    if (driving) {
      const top = h[2] * KMH, dial = top * 1.25, kmh = Math.abs(h[1]) * KMH;
      const f = Math.min(kmh / dial, 1), ft = top / dial;
      this.set('.vh-kmh', 'text', String(Math.round(kmh)));
      this.set('.vh-red', 'd', this.arc(ft, 1, 44));
      this.set('.vh-fill', 'd', f > 0.004 ? this.arc(0, Math.min(f, ft), 44) : '');
      this.set('.vh-over', 'd', f > ft ? this.arc(ft, f, 44) : '');
      const charge = h[3];
      this.set('.vh-drift', 'hidden', !(charge > 0));
      if (charge > 0) {
        this.set('.vh-drift span', 'style', `width:${Math.min(100, charge * 100).toFixed(0)}%`);
        this.set('.vh-drift', 'class', `vh-drift ${charge >= 1 ? 'fire' : charge >= 26 / 62 ? 'blue' : ''}`);
      }
      this.set('.vh-speedo', 'class', `vh-speedo${h[4] > 0 ? ' boost' : ''}`);
    }
    // B: get in / race
    const prompt = h[5] === 1 ? 'Get in' : h[5] === 2 ? 'Race!' : '';
    this.set('.vh-prompt', 'hidden', !prompt);
    if (prompt) this.set('.vh-prompt', 'html', `<span class="vh-btn">B</span><b>${prompt}</b><kbd>J</kbd>`);
    // the race
    const st = h[18] | 0;
    this.set('.vh-race', 'hidden', !(st >= 2 && st <= 5));
    this.set('.vh-count', 'hidden', !(st === 2 || (st === 3 && h[23] < 36)));
    if (st === 1) this.introBanner(h);
    if (st >= 2 && st <= 5) this.racePanels(h, st);
    if (st === 2) {
      const n = h[19] | 0, t = (h[35] | 0) % 30;
      this.set('.vh-count', 'text', n >= 1 ? String(n) : '');
      this.set('.vh-count', 'class', `vh-count c${n}`);
      this.set('.vh-count', 'style', `--t:${t}`);
    } else if (st === 3 && h[23] < 36) {
      this.set('.vh-count', 'text', 'GO!');
      this.set('.vh-count', 'class', 'vh-count go');
    }
    if (st !== 1) this.resultBanner(h, st);
    this.flash(h, st);
    this.tauntLine(h, st);
  }

  introBanner(h) {
    const race = this.v.activeRace();
    const r = { ...RACE_DEFAULTS, ...(race?.race || {}) };
    this.set('.vh-banner', 'hidden', false);
    this.set('.vh-banner', 'class', 'vh-banner intro');
    this.set('.vh-banner b', 'text', String(r.rival || 'Rival').toUpperCase());
    this.set('.vh-banner span', 'text', `${race?.name && race.name !== 'Race (rival car)' ? race.name.toUpperCase() + ' · ' : ''}${h[46] ? `${h[21] | 0} LAP${h[21] > 1 ? 'S' : ''}` : 'SPRINT'}`);
  }

  racePanels(h, st) {
    const pos = h[22] | 0;
    this.set('.vh-place', 'text', st >= 3 ? String(pos || 2) : '-');
    this.set('.vh-suffix', 'text', st >= 3 ? (pos === 1 ? 'ST' : 'ND') : '');
    this.set('.vh-pos', 'class', `vh-panel vh-pos${st >= 3 && pos === 1 ? ' first' : ''}`);
    this.set('.vh-lap', 'text', String(h[20] | 0 || 1));
    this.set('.vh-laps', 'text', `/${h[21] | 0}`);
    this.set('.vh-pos', 'data-sprint', h[46] ? '' : '1');
    this.set('.vh-clock', 'text', fmtTime(st >= 3 ? h[23] : 0));
    let lab = '', sub = '';
    if (st >= 4 && h[25] > 0 && h[46]) { lab = 'BEST'; sub = fmtTime(h[25]); }
    else if (h[39] > 0 && (h[39] > 30 || ((h[39] | 0) & 4)) && h[24] > 0) { lab = 'LAP'; sub = fmtTime(h[24]); }
    this.set('.vh-sub-lab', 'text', lab);
    this.set('.vh-sub', 'text', sub);
    this.drawMap(h);
  }

  drawMap(h) {
    const c = this.q('.vh-map');
    const course = this.v.course();
    if (!course?.pts?.length) return;
    const g = c.getContext('2d');
    const pts = course.pts;
    if (this.mapFor !== course) {
      this.mapFor = course;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const s = 120 / Math.max(x1 - x0, z1 - z0, 1);
      this.map = { s, ox: 75 - (x0 + x1) / 2 * s, oz: 75 - (z0 + z1) / 2 * s };
    }
    const { s, ox, oz } = this.map;
    // north up, seen from above: x to the right, z down (the game's camera default)
    const P = (x, z) => [ox + x * s, oz + z * s];
    g.clearRect(0, 0, 150, 150);
    g.lineJoin = 'round';
    g.beginPath();
    pts.forEach(([x, z], i) => { const [a, b] = P(x, z); if (i) g.lineTo(a, b); else g.moveTo(a, b); });
    if (course.closed) g.closePath();
    g.strokeStyle = 'rgba(6,10,24,0.55)'; g.lineWidth = 9; g.stroke();
    g.strokeStyle = 'rgba(210,222,255,0.85)'; g.lineWidth = 3.5; g.stroke();
    const [sx, sz] = P(pts[0][0], pts[0][1]);
    g.fillStyle = '#fff'; g.fillRect(sx - 3, sz - 3, 6, 6);
    const dot = (x, z, col, r) => { const [a, b] = P(x, z); g.beginPath(); g.arc(a, b, r, 0, Math.PI * 2); g.fillStyle = col; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.stroke(); };
    dot(h[44], h[45], '#c0c8d8', 4.5);
    if (h[0] >= 1) dot(h[9], h[11], '#ff4040', 5.5);
  }

  resultBanner(h, st) {
    const race = this.v.activeRace();
    const r = { ...RACE_DEFAULTS, ...(race?.race || {}) };
    if (st === 4 || st === 5) {
      const win = h[29] === 1;
      this.set('.vh-banner', 'hidden', false);
      this.set('.vh-banner', 'class', `vh-banner ${win ? 'win' : 'lose'}`);
      this.set('.vh-banner b', 'text', win ? '1ST' : '2ND');
      const again = st === 5 && !win ? ' · B: AGAIN' : '';
      this.set('.vh-banner span', 'text', (win ? `YOU BEAT ${String(r.rival || 'the rival').toUpperCase()}` : `${String(r.rival || 'the rival').toUpperCase()} WINS`) + again);
    } else if (st !== 1) {
      this.set('.vh-banner', 'hidden', true);
    }
  }

  flash(h, st) {
    let text = '', cls = '';
    if (st === 3) {
      if (h[26] > 30 && ((h[26] | 0) & 8)) { text = 'WRONG WAY'; cls = 'warn'; }
      else if (h[32] > 0 && h[20] === h[21] && h[21] > 1) { text = 'FINAL LAP'; cls = 'gold'; }
      else if (h[32] > 0) { text = `LAP ${h[20] | 0}`; cls = ''; }
      else if (h[28] === 1 && h[23] < 60) { text = 'ROCKET START!'; cls = 'gold'; }
      else if (h[28] === -1 && h[23] < 40) { text = 'STALLED'; cls = 'warn'; }
      else if (h[27] > 0) { text = 'SLIPSTREAM'; cls = 'slip'; }
    }
    this.set('.vh-flash', 'hidden', !text);
    if (text) { this.set('.vh-flash', 'text', text); this.set('.vh-flash', 'class', `vh-flash ${cls}`); }
  }

  tauntLine(h, st) {
    const which = h[30] | 0, on = h[31] > 0 && which >= 0 && st >= 1;
    this.set('.vh-taunt', 'hidden', !on);
    if (!on) return;
    const race = this.v.activeRace();
    const r = { ...RACE_DEFAULTS, ...(race?.race || {}) };
    const key = LINE_ORDER[which];
    this.set('.vh-taunt em', 'text', String(r.rival || 'Rival').toUpperCase());
    this.set('.vh-taunt span', 'text', (r.lines?.[key] || LINES[key] || '').toUpperCase());
    this.set('.vh-taunt', 'style', `opacity:${Math.min(1, h[31] / 12)}`);
  }

  howTo(look) {
    const box = this.q('.vh-howto');
    box.innerHTML = `<b>${esc(look?.name || 'Car')}</b>
      <span><kbd>W</kbd>/<kbd>Space</kbd> gas · <kbd>S</kbd>/<kbd>J</kbd> brake &amp; reverse · <kbd>A</kbd><kbd>D</kbd> steer</span>
      <span><kbd>R</kbd> handbrake drift · <kbd>↑</kbd> horn · <kbd>↓</kbd> look back · <kbd>Shift</kbd> get out</span>`;
    box.hidden = false;
    box.classList.remove('out');
    clearTimeout(this.howToT);
    this.howToT = setTimeout(() => box.classList.add('out'), 6000);
    setTimeout(() => { if (box.classList.contains('out')) box.hidden = true; }, 6800);
  }
}

// ---------------------------------------------------------------------------
// Studio and player: the runtime

export function installVehicles({ engine, studio, store, toast }) {
  loadCss();
  let hud = null;
  let course = null;
  let raceUid = 0;
  let howToShown = false;
  const world = () => studio?.world;
  const starDone = (rec, key = engine.areaKey()) => !!(rec.star && world()?.progress?.()[`${key}|${rec.uid}`]);

  const api = {
    driving: () => { try { return !!engine.M?._studio_vehicle_hud && new Float32Array(engine.M.HEAPU8.buffer, engine.M._studio_vehicle_hud(), 1)[0] >= 0.5; } catch { return false; } },
    state: () => { try { return engine.json('studio_vehicle_state_json'); } catch { return null; } },
    hud: () => { const M = engine.M; return M?._studio_vehicle_hud ? Array.from(new Float32Array(M.HEAPU8.buffer, M._studio_vehicle_hud(), HUD_FLOATS)) : null; },
    enter: (uid) => engine.M?._studio_vehicle_enter?.(uid >>> 0) === 1,
    exit: () => engine.M?._studio_vehicle_enter?.(0) === 1,
    startRace: (uid) => { const rec = store.recordOf(uid); if (rec) applyVehicle(engine, rec, slotOf(uid), starDone(rec)); return engine.M?._studio_race_start?.(uid >>> 0) === 1; },
    endRace: () => engine.M?._studio_race_start?.(0) === 1,
    autopilot: (on) => engine.M?._studio_race_autopilot?.(on ? 1 : 0),
    course: () => course,
    activeRace: () => (raceUid ? store.recordOf(raceUid) : null),
    looks: LOOKS,
  };
  api.course = () => course;
  const slotOf = (uid) => { try { return engine.objects().find((o) => o.uid === uid)?.slot ?? -1; } catch { return -1; } };

  // every car and race gets its settings when it spawns
  const spawn = engine._spawnRecord.bind(engine);
  engine._spawnRecord = (rec) => {
    const slot = spawn(rec);
    if (slot >= 0 && isVehicle(rec)) {
      try { applyVehicle(engine, rec, slot, starDone(rec)); applied.set(rec.uid, sig(rec)); } catch (err) { console.error('vehicles: spawn', err); }
    }
    return slot;
  };

  // the project changed (the inspector, Claude, another tab, undo): the engine gets the new settings
  const applied = new Map();
  const sig = (rec) => JSON.stringify([rec.vehicle, rec.race, !!rec.star, rec.motion?.path?.smooth]);
  const setPatch = engine.setPatch.bind(engine);
  engine.setPatch = (patch) => {
    setPatch(patch);
    if (!engine.ready || !engine.M?._studio_vehicle_config) return;
    try {
      const recs = store.records().filter(isVehicle);
      if (!recs.length) return;
      let objs = null;
      for (const rec of recs) {
        const k = sig(rec);
        if (applied.get(rec.uid) === k) continue;
        objs ||= engine.objects();
        const o = objs.find((x) => x.uid === rec.uid);
        if (o) { applyVehicle(engine, rec, o.slot, starDone(rec)); applied.set(rec.uid, k); }
      }
    } catch (err) { console.error('vehicles: patch', err); }
  };

  const onEvent = (name, uid, value) => {
    const rec = store.recordOf(uid);
    if (name === 'race_start') {
      raceUid = uid;
      try { course = engine.json('studio_race_course_json'); } catch { course = null; }
    }
    if (name === 'enter' && !howToShown && hud && !api.state()?.race) {
      howToShown = true;
      hud.howTo(lookOf(rec || { entry: 'vehicle:racer' }));
    }
    const map = { enter: ['vehicle', 'enter'], exit: ['vehicle', 'exit'], crash: ['vehicle', 'crash'], race_start: ['race', 'start'], race_won: ['race', 'won'], race_lost: ['race', 'lost'] };
    const m = map[name];
    const detail = { engine, name, uid, value, record: rec, kind: m?.[0], event: m?.[1], result: m?.[1] };
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('studio:vehicle', { detail }));
      if (name === 'race_won' && rec && !rec.star) toast?.(`You beat ${rec.race?.rival || 'the rival'}!`, 'sparkles');
    }, 0);
  };

  const install = () => {
    const M = engine.M;
    if (!M) return;
    M.studioVehicleEvent = onEvent;
  };
  engine.on('ready', install);
  if (engine.ready) install();

  engine.levelHooks.push(() => {
    install();
    engine.M?._studio_vehicle_area_reset?.();
    course = null;
    raceUid = 0;
  });

  engine.on('frame', () => {
    const M = engine.M;
    if (!M?._studio_vehicle_hud) return;
    if (!hud) {
      const host = document.querySelector('#game-frame') || document.querySelector('#stage');
      if (!host) return;
      hud = new Hud(host, api);
    }
    let h;
    try { h = new Float32Array(M.HEAPU8.buffer, M._studio_vehicle_hud(), HUD_FLOATS); } catch { return; }
    const building = document.body.classList.contains('building') || window.studio64?.editor?.active;
    if (building || (h[0] === 0 && h[5] === 0 && h[18] === 0)) { hud.hide(); return; }
    hud.update(h);
  });

  // the AI tools' browser side (server/tools/vehicles.js)
  registerRpc('vehicle_state', function () {
    const recs = store.records().filter(isVehicle).map((r) => ({ uid: r.uid, kind: isRace(r) ? 'race' : 'car', look: lookOf(r).id, name: r.name, x: r.x, y: r.y, z: r.z,
      top_kmh: r.vehicle?.top || lookOf(r).top, ...(isRace(r) ? { laps: r.race?.laps ?? 3, difficulty: r.race?.difficulty || 'normal', course_points: r.motion?.path?.points?.length || 0, star: r.star?.name || null } : {}) }));
    return { looks: LOOKS.map((l) => ({ id: l.id, name: l.name, about: l.about, paintable: !!l.paint, top_kmh: l.top })), placed: recs, driving: api.state(), hud: api.hud()?.slice(0, 24) };
  });
  registerRpc('vehicle_drive', function ({ uid, exit, race, end_race: endRace, autopilot } = {}) {
    if (autopilot !== undefined) api.autopilot(autopilot);
    if (endRace) return { ok: api.endRace() };
    if (exit) return { ok: api.exit() };
    if (race) return { ok: api.startRace(uid) };
    return { ok: api.enter(uid) };
  });

  window.studio64Vehicles = api;
  return api;
}

// ---------------------------------------------------------------------------
// Build mode: new cars and races, the inspector

export function installVehiclesEditor(ctx, { editor, editorUI }) {
  const { engine, store } = ctx;
  const motion = ctx.motion;

  // new cars and races come with their settings (and a race with a course and a star)
  const makeRecord = editor.makeRecord.bind(editor);
  editor.makeRecord = (item, pose, uid) => {
    const rec = makeRecord(item, pose, uid);
    if (isVehicle(rec) && !rec.vehicle) {
      const look = isRace(rec) ? 'drift_king' : rec.entry.slice(8);
      rec.vehicle = { look, top: LOOKS.find((l) => l.id === look)?.top || 95, accel: 1, handling: 1, color: '', boost: look === 'racer' || look === 'drift_king', radio: 0 };
      rec.scale = 1;
      if (isRace(rec)) {
        rec.race = deepCopy(RACE_DEFAULTS);
        rec.name = 'Race';
        rec.motion = defaultCourse(engine, rec);
        // the reward: a star of this level (its own star number, like the Stars tab gives)
        const used = new Set((ctx.studio?.world?.stars?.() || []).map((s) => s.index));
        let index = 0;
        while (used.has(index) && index < 30) index++;
        rec.bparams = (index << 24) >>> 0;
        rec.star = { name: 'Win the race' };
      }
    }
    return rec;
  };
  const commitPlacement = editor.commitPlacement.bind(editor);
  editor.commitPlacement = () => {
    const entry = editor.placing?.entry;
    const slot = commitPlacement();
    if (entry === RACE_ENTRY && slot >= 0) {
      // one race at a time: select it, its course shows; drag the points to shape it
      editor.cancelPlacing();
      setTimeout(() => {
        editor.select(slot);
        ctx.toast?.('Race placed: shape its course with Edit course', 'path');
      }, 30);
    }
    return slot;
  };

  // the inspector: Car and Race sections instead of size, params and motion
  const render = editorUI.renderInspector.bind(editorUI);
  editorUI.renderInspector = (sel) => {
    render(sel);
    const box = document.querySelector('#inspector');
    if (!sel || !editor.active || box.hidden || !isVehicle(sel.rec)) return;
    try {
      for (const s of box.querySelectorAll('.insp-sec')) {
        const label = s.querySelector('.insp-label')?.textContent || '';
        if (/^(Size|Behavior params)/.test(label) || s.classList.contains('obj-motion')) s.remove();
      }
      const actions = box.querySelector('.insp-actions');
      if (isRace(sel.rec)) box.insertBefore(raceSection(sel), actions);
      box.insertBefore(carSection(sel), actions);
    } catch (err) { console.error('vehicles: inspector', err); }
  };

  const save = (sel, fields, summary) => {
    editor.updateSelected(fields, summary);
    const rec = editor.sel?.rec;
    if (rec) applyVehicle(engine, rec, editor.sel.slot, !!(rec.star && ctx.studio?.world?.progress?.()[`${engine.areaKey()}|${rec.uid}`]));
  };
  const setVehicle = (sel, patch, summary) => save(sel, { vehicle: { ...(sel.rec.vehicle || {}), ...patch } }, summary);
  const setRace = (sel, patch, summary) => save(sel, { race: { ...RACE_DEFAULTS, ...(sel.rec.race || {}), ...patch } }, summary);

  const slider = (label, value, min, max, step, fmt, onLive, onSave) => {
    const row = el('label', 'om-row');
    row.innerHTML = `<span>${esc(label)}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}"><b>${esc(fmt(value))}</b>`;
    const r = row.querySelector('input');
    r.oninput = () => { row.querySelector('b').textContent = fmt(Number(r.value)); onLive?.(Number(r.value)); };
    r.onchange = () => onSave(Number(r.value));
    return row;
  };
  const thumb = (id) => (editorUI.thumbs?.has(id) ? `<img alt="" src="thumbs/${encodeURIComponent(id.replace(/:/g, '__'))}.webp">` : `<i>${esc(id.replace('vehicle:', '').slice(0, 2))}</i>`);

  function lookPicker(current, onPick) {
    const grid = el('div', 'vh-looks');
    for (const l of LOOKS) {
      const b = el('button', `vh-look${l.id === current ? ' active' : ''}`, `${thumb(`vehicle:${l.id}`)}<span>${esc(l.name)}</span>`);
      b.title = l.about;
      b.type = 'button';
      b.onclick = () => onPick(l);
      grid.appendChild(b);
    }
    return grid;
  }

  function colorPicker(look, current, onPick) {
    const row = el('div', 'vh-colors');
    if (!look.paint) {
      row.innerHTML = '<span class="om-note">This look keeps its own colours.</span>';
      return row;
    }
    const sw = (c, title) => {
      const b = el('button', `vh-swatch${(current || '') === c ? ' active' : ''}`);
      b.type = 'button';
      b.title = title || c;
      b.style.background = c || look.paint;
      if (!c) b.classList.add('orig');
      b.onclick = () => onPick(c);
      row.appendChild(b);
    };
    sw('', 'Original');
    for (const c of COLORS) sw(c);
    const pick = el('input');
    pick.type = 'color';
    pick.value = current || look.paint;
    pick.title = 'Any colour';
    pick.onchange = () => onPick(pick.value);
    row.appendChild(pick);
    return row;
  }

  function carSection(sel) {
    const rec = sel.rec;
    const v = rec.vehicle || {};
    const look = lookOf(rec);
    const race = isRace(rec);
    const sec = el('div', 'insp-sec vh-sec');
    sec.innerHTML = `<div class="insp-label">${race ? 'Rival car' : 'Car'} <span class="om-sum">${esc(look.name)}</span></div>`;
    sec.appendChild(lookPicker(look.id, (l) => setVehicle(sel, { look: l.id, top: v.top && v.top !== look.top ? v.top : l.top, color: l.paint ? v.color : '' }, `${race ? 'Rival car' : 'Car'}: ${l.name}`)));
    sec.appendChild(el('div', 'vh-subhead', 'Colour'));
    sec.appendChild(colorPicker(look, v.color, (c) => setVehicle(sel, { color: c }, `Painted the ${look.name.toLowerCase()}`)));
    const card = el('div', 'om-card');
    const top = Number(v.top) || look.top;
    card.appendChild(slider('Top speed', top, 40, 260, 5, (x) => `${x} km/h`, null, (x) => setVehicle(sel, { top: x }, `Top speed ${x} km/h`)));
    card.appendChild(slider('Acceleration', v.accel || 1, 0.5, 1.6, 0.05, (x) => (x < 0.8 ? 'gentle' : x > 1.25 ? 'punchy' : 'normal'), null, (x) => setVehicle(sel, { accel: x }, 'Changed the acceleration')));
    card.appendChild(slider('Handling', v.handling || 1, 0.5, 1.6, 0.05, (x) => (x < 0.8 ? 'loose' : x > 1.25 ? 'sharp' : 'normal'), null, (x) => setVehicle(sel, { handling: x }, 'Changed the handling')));
    if (look.open) {
      const lights = el('div', 'checks');
      lights.innerHTML = `<label><input type="checkbox" ${v.lights ? 'checked' : ''}> Headlights on the road (night levels)</label>`;
      lights.querySelector('input').onchange = (e) => setVehicle(sel, { lights: e.target.checked }, e.target.checked ? 'Headlights on' : 'Headlights off');
      card.appendChild(lights);
    }
    if (!race) {
      const radio = el('label', 'om-row');
      radio.innerHTML = `<span>Radio</span><select><option value="0">Off (the level's music)</option>${GAME_SONGS.map((s) => `<option value="${s.seq}" ${Number(v.radio) === s.seq ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`;
      radio.querySelector('select').onchange = (e) => setVehicle(sel, { radio: Number(e.target.value) }, 'Changed the car radio');
      card.appendChild(radio);
      const checks = el('div', 'checks');
      checks.innerHTML = `<label><input type="checkbox" ${v.boost ? 'checked' : ''}> Drift boost (hold <kbd>R</kbd> through a bend, let go)</label>`;
      checks.querySelector('input').onchange = (e) => setVehicle(sel, { boost: e.target.checked }, e.target.checked ? 'Drift boost on' : 'Drift boost off');
      card.appendChild(checks);
    }
    sec.appendChild(card);
    if (!race) {
      const row = el('div', 'btn-row');
      const drive = el('button', 'btn sm primary', `${svg('play')}Drive it`);
      drive.title = 'Play from here, at the wheel';
      drive.onclick = () => { editor.select(null); editor.exit(); setTimeout(() => window.studio64Vehicles?.enter(rec.uid), 80); };
      row.appendChild(drive);
      sec.appendChild(row);
      sec.appendChild(el('div', 'om-note', 'Playing: stand by a door and press <kbd>J</kbd> (B) to get in, <kbd>Shift</kbd> (Z) to get out.'));
    }
    return sec;
  }

  function raceSection(sel) {
    const rec = sel.rec;
    const r = { ...RACE_DEFAULTS, ...(rec.race || {}) };
    const path = rec.motion?.path;
    const sec = el('div', 'insp-sec vh-sec');
    const pts = path?.points?.length || 0;
    const length = pts ? Math.round(courseLength(rec) / 100) / 10 : 0;
    const editing = motion?.edit && motion.edit.uid === rec.uid;
    sec.innerHTML = `<div class="insp-label">Race <span class="om-sum">${path?.mode === 'loop' ? `${r.laps} lap${r.laps > 1 ? 's' : ''}` : 'sprint'} · ${length}k units</span></div>`;
    const course = el('div', 'om-card');
    course.innerHTML = `<div class="om-card-head">${svg('path')}<b>Course</b><span class="om-sub">${pts} points</span></div>
      <div class="btn-row"><button class="btn sm ${editing ? '' : 'primary'}" data-a="edit">${svg('edit')}${editing ? 'Done' : 'Edit course'}</button>
      <button class="btn sm" data-a="reverse" title="Race the other way round">Reverse</button><button class="btn sm" data-a="reset" title="A new loop in front of the rival">New loop</button></div>
      <div class="om-row"><span>Kind</span><div class="seg small"><button class="seg-btn${path?.mode === 'loop' ? ' active' : ''}" data-k="loop">Circuit</button><button class="seg-btn${path?.mode !== 'loop' ? ' active' : ''}" data-k="once">Sprint (A to B)</button></div></div>
      <div class="checks"><label><input type="checkbox" data-c="smooth" ${path?.smooth !== false ? 'checked' : ''}> Smooth curves</label></div>
      <div class="om-note">Point 0 is the start line (the rival's car). The race follows the points in order${path?.mode === 'loop' ? ' and back to the start' : ' to the last one'}.</div>`;
    const setPath = (patch, summary) => {
      const m = deepCopy(rec.motion || defaultCourse(engine, rec));
      m.path = { ...m.path, ...patch };
      save(sel, { motion: m }, summary);
      motion?.liveMotion?.(editor.sel, m);
    };
    course.querySelector('[data-a=edit]').onclick = () => (editing ? motion.stopEdit() : motion.startEdit(editor.sel));
    course.querySelector('[data-a=reverse]').onclick = () => setPath({ points: [path.points[0], ...path.points.slice(1).reverse()] }, 'Reversed the race course');
    course.querySelector('[data-a=reset]').onclick = () => { const m = defaultCourse(engine, rec); save(sel, { motion: m }, 'A new race course'); motion?.liveMotion?.(editor.sel, m); };
    course.querySelectorAll('[data-k]').forEach((b) => { b.onclick = () => setPath({ mode: b.dataset.k }, b.dataset.k === 'loop' ? 'The race is a circuit' : 'The race is a sprint'); });
    course.querySelector('[data-c=smooth]').onchange = (e) => setPath({ smooth: e.target.checked }, 'Changed the course curves');
    if (path?.mode === 'loop') course.appendChild(slider('Laps', r.laps, 1, 9, 1, (x) => String(x), null, (x) => setRace(sel, { laps: x }, `${x} laps`)));
    course.appendChild(slider('Width', r.width, 300, 3000, 50, (x) => `${x}`, null, (x) => setRace(sel, { width: x }, 'Changed the course width')));
    course.appendChild(slider('Traffic', r.traffic, 0, 10, 1, (x) => (x ? `${x} cars` : 'none'), null, (x) => setRace(sel, { traffic: x }, x ? `${x} traffic cars` : 'No traffic')));
    sec.appendChild(course);

    const rival = el('div', 'om-card');
    rival.innerHTML = `<div class="om-card-head">${svg('enemy')}<b>Rival</b></div>
      <label class="om-row"><span>Name</span><input type="text" maxlength="24" value="${esc(r.rival)}"></label>
      <div class="om-row"><span>Difficulty</span><div class="seg small">${Object.keys(DIFFICULTY).map((k) => `<button class="seg-btn${r.difficulty === k ? ' active' : ''}" data-d="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div></div>
      <div class="checks"><label><input type="checkbox" data-c="rubber" ${r.rubber !== false ? 'checked' : ''}> Keeps it close (eases off ahead, pushes behind)</label></div>`;
    const name = rival.querySelector('input[type=text]');
    name.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') name.blur(); });
    name.onchange = () => setRace(sel, { rival: name.value.trim() || 'Rival' }, 'Renamed the rival');
    rival.querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => setRace(sel, { difficulty: b.dataset.d }, `Rival: ${b.dataset.d}`); });
    rival.querySelector('[data-c=rubber]').onchange = (e) => setRace(sel, { rubber: e.target.checked }, 'Changed the rival');
    const lines = el('details', 'vh-lines');
    lines.innerHTML = `<summary>His lines</summary>${LINE_ORDER.map((k) => `<label class="om-row"><span>${esc(LINE_LABELS[k])}</span><input type="text" maxlength="80" data-l="${k}" placeholder="${esc(LINES[k])}" value="${esc(r.lines?.[k] || '')}"></label>`).join('')}`;
    lines.querySelectorAll('input[data-l]').forEach((inp) => {
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); });
      inp.onchange = () => setRace(sel, { lines: { ...(r.lines || {}), [inp.dataset.l]: inp.value.trim() } }, 'Changed the rival\'s lines');
    });
    rival.appendChild(lines);
    sec.appendChild(rival);

    const player = el('div', 'om-card');
    const pl = LOOKS.find((l) => l.id === r.player?.look) || LOOKS[1];
    player.innerHTML = `<div class="om-card-head">${svg('gamepad')}<b>Mario's car</b><span class="om-sub">when he comes on foot</span></div>`;
    const plSel = el('label', 'om-row');
    plSel.innerHTML = `<span>Look</span><select>${LOOKS.map((l) => `<option value="${l.id}" ${l.id === pl.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>`;
    plSel.querySelector('select').onchange = (e) => setRace(sel, { player: { ...r.player, look: e.target.value } }, "Changed Mario's race car");
    player.appendChild(plSel);
    player.appendChild(colorPicker(pl, r.player?.color, (c) => setRace(sel, { player: { ...r.player, color: c } }, "Painted Mario's race car")));
    player.appendChild(el('div', 'om-note', 'Driving up in his own car (and honking, <kbd>↑</kbd>) races that one.'));
    sec.appendChild(player);

    const reward = el('div', 'om-card');
    reward.innerHTML = `<div class="om-card-head">${svg('star')}<b>Reward</b></div>
      <div class="checks"><label><input type="checkbox" data-c="star" ${rec.star ? 'checked' : ''}> A star for winning</label></div>
      ${rec.star ? `<label class="om-row"><span>Star name</span><input type="text" maxlength="40" value="${esc(rec.star.name || '')}"></label>` : ''}
      <div class="om-note">Story events can react too: <i>A race starts or ends</i>, <i>Mario gets in or out of a car</i>.</div>`;
    reward.querySelector('[data-c=star]').onchange = (e) => {
      if (e.target.checked) {
        const used = new Set((ctx.studio?.world?.stars?.() || []).map((s) => s.index));
        let index = 0;
        while (used.has(index) && index < 30) index++;
        save(sel, { star: { name: 'Win the race' }, bparams: (index << 24) >>> 0 }, 'The race gives a star');
      } else save(sel, { star: null }, 'The race gives no star');
      window.studio64?.levelsUI?.renderStars?.();
    };
    const sn = reward.querySelector('input[type=text]');
    if (sn) {
      sn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') sn.blur(); });
      sn.onchange = () => { save(sel, { star: { name: sn.value.trim() || 'Win the race' } }, 'Renamed the race star'); window.studio64?.levelsUI?.renderStars?.(); };
    }
    sec.appendChild(reward);

    const row = el('div', 'btn-row');
    const go = el('button', 'btn sm primary', `${svg('play')}Race now`);
    go.title = 'Play: Mario on the grid beside the rival';
    go.onclick = () => { editor.select(null); editor.exit(); setTimeout(() => window.studio64Vehicles?.startRace(rec.uid), 80); };
    row.appendChild(go);
    sec.appendChild(row);
    sec.appendChild(el('div', 'om-note', 'Playing: walk up to the rival and press <kbd>J</kbd> (B), or stop beside him in a car and honk (<kbd>↑</kbd>).'));
    return sec;
  }

  function courseLength(rec) {
    const p = rec.motion?.path?.points || [];
    let L = 0;
    for (let i = 1; i <= p.length; i++) {
      if (i === p.length && rec.motion.path.mode !== 'loop') break;
      const a = p[i - 1], b = p[i % p.length];
      L += Math.hypot(b[0] - a[0], b[2] - a[2]);
    }
    return L;
  }

  // the AI tools' build side
  registerRpc('vehicle_place', function ({ look = 'sportscar', race = false, x, y, z, yaw_deg, color, top_kmh, handling, accel, boost, radio, laps, difficulty, traffic, width, rival, star_name, course, sprint, player_look } = {}) {
    const m = engine.state().mario;
    const yaw = yaw_deg !== undefined ? Math.round((yaw_deg / 360) * 65536) & 0xffff : (m?.yaw ?? 0) & 0xffff;
    const a = (yaw / 65536) * Math.PI * 2;
    let px = x, pz = z;
    if (px === undefined || pz === undefined) { px = Math.round((m?.x || 0) + Math.sin(a) * 600); pz = Math.round((m?.z || 0) + Math.cos(a) * 600); }
    let py = y;
    if (py === undefined) { const g = engine.floor(px, (m?.y || 0) + 1500, pz); py = g > -20000 ? Math.round(g) : Math.round(m?.y || 0); }
    const entry = race ? RACE_ENTRY : `vehicle:${LOOKS.some((l) => l.id === look) ? look : 'sportscar'}`;
    const rec = editor.makeRecord({ entry }, { p: [px, py, pz], yaw }, 1 + Math.floor(Math.random() * 0x7efffffe));
    const v = rec.vehicle;
    if (race && LOOKS.some((l) => l.id === look) && look !== 'sportscar') v.look = look;
    if (color) v.color = color;
    if (top_kmh) v.top = clamp(top_kmh, 40, 260);
    if (handling) v.handling = clamp(handling, 0.5, 1.6);
    if (accel) v.accel = clamp(accel, 0.5, 1.6);
    if (boost !== undefined) v.boost = !!boost;
    if (radio !== undefined) v.radio = radio | 0;
    if (race) {
      Object.assign(rec.race, { ...(laps ? { laps: clamp(laps | 0, 1, 9) } : {}), ...(difficulty ? { difficulty } : {}), ...(traffic !== undefined ? { traffic: clamp(traffic | 0, 0, 10) } : {}), ...(width ? { width } : {}), ...(rival ? { rival } : {}) });
      if (player_look) rec.race.player.look = player_look;
      if (star_name === null || star_name === '') rec.star = null;
      else if (star_name) rec.star = { name: star_name };
      if (Array.isArray(course) && course.length >= 2) {
        const pts = course.map((q) => {
          const qx = q[0], qz = q[q.length - 1];
          let qy = q.length >= 3 ? q[1] : engine.floor(qx, py + 1500, qz);
          if (!(qy > -20000)) qy = py;
          return [Math.round(qx - px), Math.round(qy - py), Math.round(qz - pz)];
        });
        pts[0] = [0, 0, 0];
        rec.motion = { path: { ...rec.motion.path, points: pts.slice(0, 64) } };
      }
      if (sprint) rec.motion.path.mode = 'once';
    }
    const slot = engine.spawn(rec);
    const st = engine.state();
    return { level: st.level, area: st.area, key: engine.areaKey(), placed: [{ record: rec, slot }], errors: [] };
  });

  // change a placed car or race (Claude): the new fields and the whole record
  registerRpc('vehicle_edit', function ({ uid, look, color, top_kmh, handling, accel, boost, radio, lights, laps, difficulty, traffic, width, rival, star_name, course, sprint, circuit, player_look, player_color } = {}) {
    const rec = store.records().find((r) => r.uid === uid && isVehicle(r));
    if (!rec) throw new Error(`no car or race with uid ${uid} in this area`);
    const fields = {};
    const v = { ...(rec.vehicle || {}) };
    if (look && LOOKS.some((l) => l.id === look)) {
      v.look = look;
      if (!isRace(rec)) fields.entry = `vehicle:${look}`;
    }
    if (color !== undefined) v.color = color || '';
    if (top_kmh) v.top = clamp(top_kmh, 40, 260);
    if (handling) v.handling = clamp(handling, 0.5, 1.6);
    if (accel) v.accel = clamp(accel, 0.5, 1.6);
    if (boost !== undefined) v.boost = !!boost;
    if (radio !== undefined) v.radio = radio | 0;
    if (lights !== undefined) v.lights = !!lights;
    fields.vehicle = v;
    if (isRace(rec)) {
      const r = { ...RACE_DEFAULTS, ...(rec.race || {}) };
      if (laps) r.laps = clamp(laps | 0, 1, 9);
      if (difficulty) r.difficulty = difficulty;
      if (traffic !== undefined) r.traffic = clamp(traffic | 0, 0, 10);
      if (width) r.width = clamp(width, 300, 4000);
      if (rival) r.rival = String(rival).slice(0, 24);
      if (player_look || player_color !== undefined) r.player = { ...r.player, ...(player_look ? { look: player_look } : {}), ...(player_color !== undefined ? { color: player_color || '' } : {}) };
      fields.race = r;
      if (star_name === null || star_name === '') fields.star = null;
      else if (star_name) fields.star = { name: String(star_name).slice(0, 40) };
      if (Array.isArray(course) && course.length >= 2 || sprint || circuit) {
        const m = deepCopy(rec.motion || defaultCourse(engine, rec));
        if (Array.isArray(course) && course.length >= 2) {
          m.path.points = course.slice(0, 64).map((q) => {
            const qx = q[0], qz = q[q.length - 1];
            let qy = q.length >= 3 ? q[1] : engine.floor(qx, rec.y + 1500, qz);
            if (!(qy > -20000)) qy = rec.y;
            return [Math.round(qx - rec.x), Math.round(qy - rec.y), Math.round(qz - rec.z)];
          });
          m.path.points[0] = [0, 0, 0];
        }
        if (sprint) m.path.mode = 'once';
        if (circuit) m.path.mode = 'loop';
        fields.motion = m;
      }
    }
    return { uid, name: rec.name, fields, record: { ...rec, ...fields }, key: engine.areaKey() };
  });
}
