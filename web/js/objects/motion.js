// Motion of blocks and objects: paths (moving platforms, elevators), rotation,
// swinging, seesaws, falling / crumbling / blinking platforms, conveyors,
// trampolines, sinking platforms. Saved in the record as `motion`, applied to
// the engine (src/studio/motion.c) every time the record spawns.
//
// Also the paths of the game's own path objects (Koopa the Quick's race, the
// racing penguin, platforms on tracks), saved per area as `paths`.

import { el, esc, svg, clamp, round, deepCopy, withFloats } from './common.js';

export const MOTION_TYPES = [
  { id: 'path', label: 'Path', help: 'Moves along points you draw: moving platforms, elevators, patrols' },
  { id: 'rotate', label: 'Rotate', help: 'Spins around its own axis, carrying Mario' },
  { id: 'swing', label: 'Swing', help: 'Swings back and forth like a pendulum' },
  { id: 'tilt', label: 'Seesaw', help: 'Tilts toward the side Mario stands on' },
  { id: 'fall', label: 'Falls', help: 'Shakes, then falls when Mario stands on it' },
  { id: 'crumble', label: 'Crumbles', help: 'Breaks apart when Mario stands on it' },
  { id: 'blink', label: 'Blinks', help: 'Disappears and comes back on a timer' },
  { id: 'conveyor', label: 'Conveyor', help: 'Carries Mario along its surface' },
  { id: 'bounce', label: 'Trampoline', help: 'Throws Mario into the air' },
  { id: 'sink', label: 'Sinks', help: 'Sinks while Mario stands on it' },
];

export const MOTION_DEFAULTS = {
  path: { points: [[0, 0, 0], [800, 0, 0]], speed: 8, mode: 'pingpong', wait: 1, smooth: false, trigger: 'always', radius: 800, phase: 0, face: false },
  rotate: { yaw: 45, pitch: 0, roll: 0 },
  swing: { axis: 'roll', angle: 35, period: 3, pivot: 0, phase: 0 },
  tilt: { angle: 20, speed: 1.2 },
  fall: { delay: 0.5, respawn: 4 },
  crumble: { delay: 0.6, respawn: 5 },
  blink: { on: 2.5, off: 1.5, phase: 0 },
  conveyor: { speed: 8, dir: 0 },
  bounce: { power: 85 },
  sink: { depth: 150 },
};

// Ready-made motions for the most common platforms.
export const MOTION_PRESETS = [
  { id: 'mover', label: 'Moving platform', motion: { path: { ...MOTION_DEFAULTS.path, points: [[0, 0, 0], [800, 0, 0]] } } },
  { id: 'elevator', label: 'Elevator', motion: { path: { ...MOTION_DEFAULTS.path, points: [[0, 0, 0], [0, 900, 0]], speed: 6, mode: 'pingpong', trigger: 'while_standing', wait: 0 } } },
  { id: 'loop', label: 'Loop', motion: { path: { ...MOTION_DEFAULTS.path, points: [[0, 0, 0], [700, 0, 0], [700, 0, 700], [0, 0, 700]], mode: 'loop', smooth: true, wait: 0 } } },
  { id: 'spinner', label: 'Spinner', motion: { rotate: { yaw: 60, pitch: 0, roll: 0 } } },
  { id: 'ferris', label: 'Wheel', motion: { rotate: { yaw: 0, pitch: 0, roll: 40 } } },
  { id: 'falling', label: 'Falling', motion: { fall: { ...MOTION_DEFAULTS.fall } } },
  { id: 'blinking', label: 'Blinking', motion: { blink: { ...MOTION_DEFAULTS.blink } } },
];

const F = { PATH: 1, ROTATE: 2, SWING: 4, FALL: 8, BLINK: 16, CRUMBLE: 32, TILT: 64, CONVEYOR: 128, BOUNCE: 256, FACE: 512, EXTERNAL: 1024, SINK: 2048 };
const MODES = { loop: 0, pingpong: 1, once: 2 };
const TRIGGERS = { always: 0, stand: 1, while_standing: 2, near: 3, event: 4 };
const AXES = { pitch: 0, roll: 1, yaw: 2 };
const CFG_POINTS = 32;

export const isActor = (rec) => rec?.bhv === 'bhvStudioActor';
// paths walked by the object itself (motion.c leaves it be): custom enemies' patrols, race courses (vehicles.js)
export const ownPath = (rec) => isActor(rec) || !!rec?.race;
export const motionKinds = (m) => (m ? MOTION_TYPES.map((t) => t.id).filter((k) => m[k]) : []);
export const motionLabel = (m) => motionKinds(m).map((k) => MOTION_TYPES.find((t) => t.id === k).label).join(' + ');

// Fill in defaults and clamp values (records come from users, Claude and old projects).
export function normalizeMotion(m) {
  if (!m || typeof m !== 'object') return null;
  const out = {};
  for (const k of Object.keys(MOTION_DEFAULTS)) {
    if (!m[k]) continue;
    out[k] = { ...MOTION_DEFAULTS[k], ...(m[k] === true ? {} : m[k]) };
  }
  if (out.path) {
    let pts = Array.isArray(out.path.points) ? out.path.points.filter((p) => Array.isArray(p) && p.length >= 3).map((p) => p.slice(0, 3).map((v) => Math.round(Number(v) || 0))) : [];
    if (!pts.length || pts[0].some((v) => v !== 0)) pts.unshift([0, 0, 0]);
    out.path.points = pts.slice(0, 64);
    out.path.speed = clamp(Number(out.path.speed) || 0, 0, 200);
    if (!(out.path.mode in MODES)) out.path.mode = 'pingpong';
    if (!(out.path.trigger in TRIGGERS)) out.path.trigger = 'always';
  }
  return Object.keys(out).length ? out : null;
}

// The float array of src/studio/motion.c (CFG_* layout).
export function encodeMotion(motion, rec) {
  const m = normalizeMotion(motion);
  const c = new Array(CFG_POINTS).fill(0);
  if (!m) return c;
  let flags = 0;
  const p = m.path;
  if (p && p.points.length >= 2) {
    flags |= F.PATH;
    if (p.face) flags |= F.FACE;
    if (ownPath(rec)) flags |= F.EXTERNAL;
    c[1] = p.points.length; c[2] = p.speed; c[3] = MODES[p.mode]; c[4] = Math.round((p.wait || 0) * 30);
    c[5] = p.smooth ? 1 : 0; c[6] = TRIGGERS[p.trigger]; c[7] = p.radius || 800; c[8] = clamp(p.phase || 0, 0, 0.999);
    for (const q of p.points) c.push(q[0], q[1], q[2]);
  }
  if (m.rotate) { flags |= F.ROTATE; c[9] = m.rotate.pitch || 0; c[10] = m.rotate.yaw || 0; c[11] = m.rotate.roll || 0; }
  if (m.swing) {
    flags |= F.SWING;
    c[12] = AXES[m.swing.axis] ?? 1; c[13] = m.swing.angle || 0; c[14] = Math.max(0.2, m.swing.period || 3); c[15] = m.swing.pivot || 0; c[16] = m.swing.phase || 0;
  }
  if (m.fall) { flags |= F.FALL; c[17] = Math.round((m.fall.delay || 0) * 30); c[18] = Math.round((m.fall.respawn || 0) * 30); }
  if (m.blink) { flags |= F.BLINK; c[19] = Math.max(1, Math.round((m.blink.on || 0) * 30)); c[20] = Math.max(1, Math.round((m.blink.off || 0) * 30)); c[21] = Math.round((m.blink.phase || 0) * 30); }
  if (m.crumble) { flags |= F.CRUMBLE; c[22] = Math.round((m.crumble.delay || 0) * 30); c[23] = Math.round((m.crumble.respawn || 0) * 30); }
  if (m.tilt) {
    flags |= F.TILT; c[24] = m.tilt.angle || 20; c[25] = m.tilt.speed || 1.2;
    c[26] = rec?.block ? rec.block.sx / 2 : 250 * (rec?.scale || 1); c[27] = rec?.block ? rec.block.sz / 2 : 250 * (rec?.scale || 1);
  }
  if (m.conveyor) { flags |= F.CONVEYOR; c[28] = m.conveyor.speed || 0; c[29] = m.conveyor.dir || 0; }
  if (m.bounce) { flags |= F.BOUNCE; c[30] = m.bounce.power || 85; }
  if (m.sink) { flags |= F.SINK; c[31] = m.sink.depth || 150; }
  c[0] = flags;
  return c;
}

export function applyMotion(engine, rec, slot) {
  const M = engine.M;
  if (!M?._studio_motion_set || slot < 0) return false;
  if (!rec.motion) { M._studio_motion_clear(slot); return false; }
  const cfg = encodeMotion(rec.motion, rec);
  return withFloats(engine, cfg, (p, n) => M._studio_motion_set(slot, p, n)) === 1;
}

// Paths of the game's own path objects in this area.
export function applyPathOverrides(engine, paths) {
  const M = engine.M;
  if (!M?._studio_path_override_clear) return;
  M._studio_path_override_clear();
  for (const p of paths || []) {
    const b = engine.bhvIndex.get(p.bhv);
    if (b === undefined || !Array.isArray(p.points) || p.points.length < 2) continue;
    withFloats(engine, p.points.flat(), (ptr) => M._studio_path_override_add(b, p.x, p.y, p.z, p.r || 250, p.uid || 0, ptr, p.points.length));
  }
  // unchanged paths kept their waypoints; objects on removed ones go back to their own
  M._studio_path_override_done?.();
}

// The path an original object follows ({ kind, points } or null).
export function objectPathInfo(engine, slot) {
  try { return engine.json('studio_path_info_json', slot); } catch { return null; }
}

// Absolute positions along a path, the way the engine samples it.
export function samplePath(points, { smooth = false, closed = false } = {}) {
  const n = points.length;
  if (n < 2) return points.slice();
  const out = [];
  const segs = closed ? n : n - 1;
  const at = (i) => points[((i % n) + n) % n];
  for (let s = 0; s < segs; s++) {
    const p1 = points[s], p2 = at(s + 1);
    const p0 = s > 0 ? points[s - 1] : closed ? at(n - 1) : p1;
    const p3 = s + 2 < n ? points[s + 2] : closed ? at(s + 2) : p2;
    const sub = smooth ? 12 : 1;
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t;
      out.push(smooth ? [0, 1, 2].map((i) => 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3)) : p1.slice());
    }
  }
  out.push((closed ? points[0] : points[n - 1]).slice());
  return out;
}

const len3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Where something on the path is after `t` seconds (preview marker in build mode).
function previewAt(path, abs, t) {
  const closed = path.mode === 'loop';
  const s = samplePath(abs, { smooth: path.smooth, closed });
  const cum = [0];
  for (let i = 1; i < s.length; i++) cum.push(cum[i - 1] + len3(s[i], s[i - 1]));
  const total = cum[cum.length - 1];
  if (total < 1 || path.speed <= 0) return s[0];
  // node waits make the cycle longer; approximate them evenly
  const wait = (path.wait || 0) * 30 * (abs.length - (closed ? 0 : 1));
  const travel = total / path.speed;
  const cycle = closed ? travel + wait : 2 * (travel + wait);
  let f = (t * 30) % cycle;
  let d;
  if (closed) d = Math.min(total, (f / (travel + wait)) * total);
  else if (f < travel + wait) d = Math.min(total, (f / (travel + wait)) * total);
  else d = Math.max(0, total - ((f - travel - wait) / (travel + wait)) * total);
  if (path.mode === 'once') d = Math.min(total, ((t * 30) / (travel + wait)) * total);
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1, u = (d - cum[i - 1]) / seg;
  return [0, 1, 2].map((k) => s[i - 1][k] + (s[i][k] - s[i - 1][k]) * u);
}

// ---------------------------------------------------------------------------
// Build mode: the Motion section of the inspector and the path tool.

export class MotionUI {
  constructor({ engine, editor, editorUI, store, toast }) {
    this.engine = engine;
    this.editor = editor;
    this.editorUI = editorUI;
    this.store = store;
    this.toast = toast;
    this.edit = null; // { uid, kind: 'motion' | 'override', points (absolute), dragging, hover }
    this.t0 = performance.now();
  }

  // ---- inspector --------------------------------------------------------------

  section(box, sel) {
    const rec = sel.rec;
    const actor = isActor(rec);
    const info = !rec ? objectPathInfo(this.engine, sel.slot) : null;
    const sec = el('div', 'insp-sec obj-motion');
    if (info?.points?.length) {
      // an original path object: its path can be redrawn
      const ov = this.overrideFor(sel.obj);
      sec.innerHTML = `<div class="insp-label">${info.kind === 'race' ? 'Race path' : info.kind === 'track' ? 'Track' : 'Path'}</div>
        <div class="om-note">${esc(sel.name)} follows ${ov ? 'your path' : 'its original path'} (${(ov?.points || info.points).length} points).</div>
        <div class="btn-row"><button class="btn sm primary" data-a="edit">${svg('edit')}Edit path</button>${ov ? '<button class="btn sm" data-a="reset">Original path</button>' : ''}</div>`;
      sec.querySelector('[data-a=edit]').onclick = () => this.startOverrideEdit(sel, ov ? ov.points : info.points);
      const reset = sec.querySelector('[data-a=reset]');
      if (reset) reset.onclick = () => this.saveOverride(sel.obj, null);
      return sec;
    }
    const m = normalizeMotion(rec?.motion) || {};
    if (actor) {
      sec.innerHTML = '<div class="insp-label">Patrol path</div>';
      if (m.path) sec.appendChild(this.pathCard(sel, m, true));
      else {
        const b = el('button', 'btn sm', `${svg('path')}Draw a patrol path`);
        b.onclick = () => this.setMotion(sel, { ...m, path: { ...MOTION_DEFAULTS.path, points: [[0, 0, 0], [600, 0, 0]], mode: 'pingpong', wait: 1 } }, 'Added a patrol path', true);
        sec.appendChild(b);
        sec.appendChild(el('div', 'om-note', 'Set its movement to “Patrols a path” in the custom object to walk it.'));
      }
      return sec;
    }
    sec.innerHTML = `<div class="insp-label">Motion${Object.keys(m).length ? ` <span class="om-sum">${esc(motionLabel(m))}</span>` : ''}</div>`;
    const chips = el('div', 'om-chips');
    for (const t of MOTION_TYPES) {
      const c = el('button', `om-chip${m[t.id] ? ' on' : ''}`, `${svg(t.id === 'tilt' ? 'tilt' : t.id)}<span>${esc(t.label)}</span>`);
      c.title = t.help;
      c.dataset.kind = t.id;
      c.onclick = () => {
        const next = deepCopy(m);
        if (next[t.id]) delete next[t.id];
        else next[t.id] = deepCopy(MOTION_DEFAULTS[t.id]);
        // these exclude each other: a block can't fall and crumble at once
        if (t.id === 'fall' && next.fall) delete next.crumble;
        if (t.id === 'crumble' && next.crumble) delete next.fall;
        this.setMotion(sel, next, next[t.id] ? `Added ${t.label.toLowerCase()} motion` : `Removed ${t.label.toLowerCase()} motion`);
        if (t.id === 'path' && next.path) setTimeout(() => this.startEdit(this.editor.sel), 50);
      };
      chips.appendChild(c);
    }
    sec.appendChild(chips);
    if (!Object.keys(m).length) {
      const pre = el('div', 'om-presets');
      pre.innerHTML = '<span>Quick:</span>';
      for (const p of MOTION_PRESETS) {
        const b = el('button', 'om-preset', esc(p.label));
        b.onclick = () => this.setMotion(sel, deepCopy(p.motion), `Made it a ${p.label.toLowerCase()}`);
        pre.appendChild(b);
      }
      sec.appendChild(pre);
      return sec;
    }
    if (m.path) sec.appendChild(this.pathCard(sel, m));
    for (const k of ['rotate', 'swing', 'tilt', 'fall', 'crumble', 'blink', 'conveyor', 'bounce', 'sink']) if (m[k]) sec.appendChild(this.card(sel, m, k));
    return sec;
  }

  card(sel, m, kind) {
    const t = MOTION_TYPES.find((x) => x.id === kind);
    const v = m[kind];
    const c = el('div', 'om-card');
    c.innerHTML = `<div class="om-card-head">${svg(kind)}<b>${esc(t.label)}</b><button class="om-x" title="Remove">${svg('x')}</button></div>`;
    c.querySelector('.om-x').onclick = () => { const n = deepCopy(m); delete n[kind]; this.setMotion(sel, n, `Removed ${t.label.toLowerCase()} motion`); };
    const set = (field, value, final) => {
      const n = deepCopy(m);
      n[kind][field] = value;
      if (final) this.setMotion(sel, n, `Changed ${t.label.toLowerCase()} motion`);
      else this.liveMotion(sel, n);
    };
    const slider = (label, field, min, max, step, unit = '', fmt = (x) => x) => {
      const row = el('label', 'om-row');
      row.innerHTML = `<span>${esc(label)}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${esc(v[field])}"><b>${esc(fmt(v[field]))}${unit}</b>`;
      const r = row.querySelector('input'), b = row.querySelector('b');
      r.oninput = () => { b.textContent = fmt(Number(r.value)) + unit; set(field, Number(r.value), false); };
      r.onchange = () => set(field, Number(r.value), true);
      c.appendChild(row);
    };
    const seg = (label, field, options) => {
      const row = el('div', 'om-row');
      row.innerHTML = `<span>${esc(label)}</span><div class="seg small">${options.map(([k, l]) => `<button class="seg-btn${v[field] === k ? ' active' : ''}" data-v="${k}">${esc(l)}</button>`).join('')}</div>`;
      row.querySelectorAll('[data-v]').forEach((b) => { b.onclick = () => set(field, b.dataset.v, true); });
      c.appendChild(row);
    };
    if (kind === 'rotate') {
      slider('Turn (yaw)', 'yaw', -360, 360, 5, '°/s');
      slider('Tumble (pitch)', 'pitch', -360, 360, 5, '°/s');
      slider('Roll', 'roll', -360, 360, 5, '°/s');
    } else if (kind === 'swing') {
      seg('Swings', 'axis', [['roll', 'Side'], ['pitch', 'Front'], ['yaw', 'Turn']]);
      slider('Angle', 'angle', 2, 90, 1, '°');
      slider('Period', 'period', 0.5, 10, 0.1, ' s', (x) => round(x, 1));
      slider('Hangs from', 'pivot', 0, 2000, 25, ' up');
    } else if (kind === 'tilt') {
      slider('Max tilt', 'angle', 2, 45, 1, '°');
      slider('Speed', 'speed', 0.2, 5, 0.1, '°', (x) => round(x, 1));
    } else if (kind === 'fall' || kind === 'crumble') {
      slider('Delay', 'delay', 0, 5, 0.1, ' s', (x) => round(x, 1));
      slider('Comes back', 'respawn', 0, 20, 0.5, ' s', (x) => (x ? round(x, 1) : 'never '));
    } else if (kind === 'blink') {
      slider('Visible', 'on', 0.2, 10, 0.1, ' s', (x) => round(x, 1));
      slider('Gone', 'off', 0.2, 10, 0.1, ' s', (x) => round(x, 1));
      slider('Offset', 'phase', 0, 10, 0.1, ' s', (x) => round(x, 1));
    } else if (kind === 'conveyor') {
      slider('Speed', 'speed', -40, 40, 1, '');
      slider('Direction', 'dir', 0, 359, 5, '°');
    } else if (kind === 'bounce') {
      slider('Power', 'power', 30, 200, 5, '');
    } else if (kind === 'sink') {
      slider('Depth', 'depth', 20, 1000, 10, '');
    }
    return c;
  }

  pathCard(sel, m, actor = false) {
    const p = m.path;
    const c = el('div', 'om-card');
    const editing = this.edit && this.edit.uid === sel.uid;
    c.innerHTML = `<div class="om-card-head">${svg('path')}<b>Path</b><span class="om-sub">${p.points.length} points</span>
      ${actor ? '' : `<button class="om-x" title="Remove">${svg('x')}</button>`}</div>
      <div class="btn-row"><button class="btn sm ${editing ? '' : 'primary'}" data-a="edit">${svg('edit')}${editing ? 'Done' : 'Edit path'}</button>
      <button class="btn sm" data-a="reverse" title="Reverse the point order">Reverse</button></div>`;
    c.querySelector('[data-a=edit]').onclick = () => (editing ? this.stopEdit() : this.startEdit(sel));
    c.querySelector('[data-a=reverse]').onclick = () => {
      const n = deepCopy(m);
      const base = n.path.points[0];
      const rest = n.path.points.slice(1).reverse();
      // keep the object's own position as the first point
      n.path.points = [base, ...rest];
      this.setMotion(sel, n, 'Reversed the path');
    };
    const x = c.querySelector('.om-x');
    if (x) x.onclick = () => { const n = deepCopy(m); delete n.path; this.stopEdit(); this.setMotion(sel, n, 'Removed the path'); };
    const set = (field, value, final) => {
      const n = deepCopy(m);
      n.path[field] = value;
      if (final) this.setMotion(sel, n, 'Changed the path');
      else this.liveMotion(sel, n);
    };
    const row = (html) => { const r = el('div', 'om-row', html); c.appendChild(r); return r; };
    if (!actor) {
      const sp = row(`<span>Speed</span><input type="range" min="1" max="60" step="1" value="${p.speed}"><b>${p.speed}</b>`);
      const r = sp.querySelector('input');
      r.oninput = () => { sp.querySelector('b').textContent = r.value; set('speed', Number(r.value), false); };
      r.onchange = () => set('speed', Number(r.value), true);
    }
    const modes = [['pingpong', 'Back & forth'], ['loop', 'Loop'], ['once', 'Once']];
    const md = row(`<span>Goes</span><div class="seg small">${modes.map(([k, l]) => `<button class="seg-btn${p.mode === k ? ' active' : ''}" data-v="${k}">${l}</button>`).join('')}</div>`);
    md.querySelectorAll('[data-v]').forEach((b) => { b.onclick = () => set('mode', b.dataset.v, true); });
    if (!actor) {
      const trig = [['always', 'Always'], ['stand', 'When Mario stands on it'], ['while_standing', 'While Mario stands on it (elevator)'], ['near', 'When Mario comes near'], ['event', 'When an event starts it']];
      const tr = row(`<span>Starts</span><select>${trig.map(([k, l]) => `<option value="${k}" ${p.trigger === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`);
      tr.querySelector('select').onchange = (e) => set('trigger', e.target.value, true);
    }
    const wt = row(`<span>Waits</span><input type="range" min="0" max="5" step="0.1" value="${p.wait}"><b>${round(p.wait, 1)} s</b>`);
    const w = wt.querySelector('input');
    w.oninput = () => { wt.querySelector('b').textContent = `${round(Number(w.value), 1)} s`; set('wait', Number(w.value), false); };
    w.onchange = () => set('wait', Number(w.value), true);
    const checks = el('div', 'checks');
    checks.innerHTML = `<label><input type="checkbox" data-c="smooth" ${p.smooth ? 'checked' : ''}> Smooth curve</label>${actor ? '' : `<label><input type="checkbox" data-c="face" ${p.face ? 'checked' : ''}> Faces where it goes</label>`}`;
    checks.querySelectorAll('[data-c]').forEach((cb) => { cb.onchange = () => set(cb.dataset.c, cb.checked, true); });
    c.appendChild(checks);
    // exact heights of the points (elevators)
    const det = el('details', 'om-points');
    det.innerHTML = `<summary>Points</summary>${p.points.map((q, i) => `<div class="om-pt"><i>${i}</i>
      <label>x<input type="number" step="25" data-i="${i}" data-k="0" value="${q[0]}" ${i === 0 ? 'disabled' : ''}></label>
      <label>y<input type="number" step="25" data-i="${i}" data-k="1" value="${q[1]}" ${i === 0 ? 'disabled' : ''}></label>
      <label>z<input type="number" step="25" data-i="${i}" data-k="2" value="${q[2]}" ${i === 0 ? 'disabled' : ''}></label></div>`).join('')}<div class="om-note">Relative to the object. Point 0 is where it stands.</div>`;
    det.querySelectorAll('input[data-i]').forEach((inp) => {
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); e.stopPropagation(); });
      inp.onchange = () => {
        if (inp.value.trim() === '' || !Number.isFinite(Number(inp.value))) { inp.value = inp.defaultValue; return; } // empty is not 0
        const n = deepCopy(m);
        n.path.points[Number(inp.dataset.i)][Number(inp.dataset.k)] = Math.round(Number(inp.value));
        this.setMotion(sel, n, 'Moved a path point');
      };
    });
    c.appendChild(det);
    return c;
  }

  // Live: the engine gets the new motion, the record changes, nothing is saved yet.
  liveMotion(sel, motion) {
    const rec = sel.rec;
    if (!rec) return;
    rec.motion = normalizeMotion(motion);
    applyMotion(this.engine, rec, sel.slot);
  }

  // Saves the motion in the record (adopting an original object first).
  setMotion(sel, motion, summary, keepActor = false) {
    const ed = this.editor;
    if (!ed.sel) return;
    const m = normalizeMotion(motion);
    let rec = ed.sel.rec;
    const fields = { motion: m };
    // catalog platforms with their own collision become "movers": the model and its
    // collision, moved by the motion instead of the original behavior
    if (m && !keepActor && rec?.asset?.model) {
      Object.assign(fields, { bhv: 'bhvStudioMover', model: `asset:${rec.asset.model}`, asset: null });
    } else if (m && !keepActor && (!rec || rec.entry) && !rec?.block) {
      const entry = rec?.entry || ed.sel.entry;
      const idx = entry ? this.engine.entryIndex.get(entry) : undefined;
      if (idx !== undefined) {
        let info = null;
        try { info = this.engine.json('studio_catalog_info_json', idx); } catch { /* old engine */ }
        if (info?.collision && info.surface) {
          Object.assign(fields, { bhv: 'bhvStudioMover', model: entry, entry: null });
          this.toast?.(`${ed.sel.name} now moves as a platform`, 'check');
        }
      }
    }
    ed.updateSelected(fields, summary);
    rec = ed.sel?.rec;
    if (!rec) return;
    if (!fields.bhv) applyMotion(this.engine, rec, ed.sel.slot);
    if (this.edit && this.edit.uid === rec.uid && m?.path) this.edit.points = this.absPoints(rec);
    if (this.edit && !m?.path) this.stopEdit();
    ed.ui.onSelect(ed.sel);
  }

  // ---- the game's path objects -------------------------------------------------

  overrideFor(o) {
    if (!o) return null;
    const list = this.store.area().paths || [];
    return list.find((p) => p.bhv === o.bhv && Math.hypot(p.x - (o.hx || o.x), p.y - (o.hy || o.y), p.z - (o.hz || o.z)) < (p.r || 250)) || null;
  }

  saveOverride(o, points) {
    const list = (this.store.area().paths || []).filter((p) => p !== this.overrideFor(o));
    const name = this.editor.sel?.name || o.bhv;
    if (points) list.push({ bhv: o.bhv, x: Math.round(o.hx || o.x), y: Math.round(o.hy || o.y), z: Math.round(o.hz || o.z), r: 250, uid: o.uid || 0, name, points: points.map((p) => p.map(Math.round)) });
    this.store.setArea('paths', list, points ? `Changed the path of ${name}` : `${name} follows its original path`);
    applyPathOverrides(this.engine, list);
    // the project's own path objects start over on the new path; the level's track platforms
    // switch to the new track at once (motion.c)
    const rec = o.uid ? this.store.recordOf(o.uid) : null;
    if (rec) {
      this.engine.deleteUid(rec.uid);
      const slot = this.engine.spawn(rec);
      if (this.edit) this.edit.slot = slot;
      if (slot >= 0) this.editor.select(slot);
    }
    this.editor.ui.onSelect(this.editor.sel);
  }

  // ---- path tool ----------------------------------------------------------------

  absPoints(rec) {
    const p = normalizeMotion(rec.motion)?.path;
    if (!p) return [];
    return p.points.map((q) => [rec.x + q[0], rec.y + q[1], rec.z + q[2]]);
  }

  startEdit(sel) {
    if (!sel?.rec) return;
    const m = normalizeMotion(sel.rec.motion);
    if (!m?.path) return;
    this.edit = { uid: sel.uid, kind: 'motion', points: this.absPoints(sel.rec), ground: ownPath(sel.rec), dragging: null, hover: null };
    this.hint();
    this.editor.ui.onSelect(this.editor.sel);
  }

  startOverrideEdit(sel, points) {
    this.edit = { uid: 0, slot: sel.slot, obj: sel.obj, kind: 'override', points: points.map((p) => p.slice()), ground: true, dragging: null, hover: null };
    this.hint();
    this.editor.ui.onSelect(this.editor.sel);
  }

  stopEdit() {
    if (!this.edit) return;
    this.edit = null;
    this.editor.ui.onToolChange();
    if (this.editor.sel) this.editor.ui.onSelect(this.editor.sel);
  }

  hint() {
    const h = document.querySelector('#tool-hint');
    if (!h || !this.edit) return;
    h.innerHTML = 'Path: click adds · drag moves · <kbd>Shift</kbd> up/down · <kbd>Ctrl</kbd> on ground · right-click deletes · <kbd>Enter</kbd> done';
    h.hidden = false;
  }

  // Selection changed or build mode ended: the tool goes away.
  onSelect(sel) {
    if (!this.edit) return;
    if (!sel || !this.editor.active) { this.edit = null; return; }
    if (this.edit.kind === 'motion' && sel.uid !== this.edit.uid) this.edit = null;
    if (this.edit?.kind === 'override' && sel.slot !== this.edit.slot) this.edit = null;
  }

  pointAt(m) {
    const e = this.edit;
    let best = -1, bd = 12;
    e.points.forEach((p, i) => {
      if (i === 0 && e.kind === 'motion') return; // point 0 is the object itself: move the object instead
      const s = this.editor.project(p);
      if (!s) return;
      const d = Math.hypot(s.x - m.x, s.y - m.y);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  segmentAt(m) {
    const e = this.edit;
    const closed = this.pathMode() === 'loop';
    const n = e.points.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = this.editor.project(e.points[i]), b = this.editor.project(e.points[(i + 1) % n]);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
      const t = clamp(((m.x - a.x) * dx + (m.y - a.y) * dy) / L, 0, 1);
      if (Math.hypot(a.x + dx * t - m.x, a.y + dy * t - m.y) < 7 && t > 0.08 && t < 0.92) return { i: i + 1, t };
    }
    return null;
  }

  pathMode() {
    if (this.edit?.kind === 'override') return 'loop';
    const rec = this.store.recordOf(this.edit?.uid);
    return normalizeMotion(rec?.motion)?.path?.mode || 'pingpong';
  }

  // Where the mouse points for a path point: on the ground, or level with `y`.
  spotUnder(m, y, ground) {
    const ed = this.editor;
    if (ground || y === null) {
      const hit = ed.pick(m.x, m.y, { ignoreSlot: ed.sel?.slot ?? -1, objects: false });
      return hit ? [hit.x, hit.y, hit.z] : null;
    }
    return ed.planeHit(y, m.x, m.y);
  }

  down(m, e) {
    const ed = this.editor;
    if (!this.edit || e.button !== 0 || e.altKey) return false;
    const i = this.pointAt(m);
    if (i >= 0) {
      this.edit.dragging = { i, startY: m.y, y0: this.edit.points[i][1] };
      return true;
    }
    const seg = this.segmentAt(m);
    const pts = this.edit.points;
    if (seg) {
      const a = pts[seg.i - 1], b = pts[seg.i % pts.length];
      pts.splice(seg.i, 0, [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * seg.t)));
      this.edit.dragging = { i: seg.i, startY: m.y, y0: pts[seg.i][1], added: true };
      return true;
    }
    const last = pts[pts.length - 1];
    const snap = e.ctrlKey || e.metaKey || this.edit.ground;
    const q = this.spotUnder(m, last ? last[1] : null, snap);
    if (!q) return true;
    const sn = e.altKey ? 0 : ed.snap;
    const p = [sn ? Math.round(q[0] / sn) * sn : Math.round(q[0]), Math.round(q[1]), sn ? Math.round(q[2] / sn) * sn : Math.round(q[2])];
    pts.push(p);
    this.edit.dragging = { i: pts.length - 1, startY: m.y, y0: p[1], added: true };
    return true;
  }

  move(m, e) {
    const d = this.edit?.dragging;
    if (!this.edit) return false;
    if (!d) {
      this.edit.hover = this.pointAt(m);
      this.editor.overlay.style.cursor = this.edit.hover >= 0 ? 'grab' : 'crosshair';
      return false;
    }
    const p = this.edit.points[d.i];
    if (e.shiftKey) {
      p[1] = Math.round(d.y0 + (d.startY - m.y) * 4);
      const sn = this.editor.snap;
      if (sn && !e.altKey) p[1] = Math.round(p[1] / sn) * sn;
    } else {
      const q = this.spotUnder(m, p[1], e.ctrlKey || e.metaKey || this.edit.ground);
      if (q) {
        const sn = e.altKey ? 0 : this.editor.snap;
        p[0] = sn ? Math.round(q[0] / sn) * sn : Math.round(q[0]);
        p[2] = sn ? Math.round(q[2] / sn) * sn : Math.round(q[2]);
        if (e.ctrlKey || e.metaKey || this.edit.ground) p[1] = Math.round(q[1]);
      }
      d.startY = m.y;
      d.y0 = p[1];
    }
    d.moved = true;
    return true;
  }

  up(m, e, click) {
    if (!this.edit) return false;
    const d = this.edit.dragging;
    this.edit.dragging = null;
    if (d) { this.savePoints(d.added ? 'Added a path point' : 'Moved a path point'); return true; }
    if (e.button === 2 && click) {
      const i = this.pointAt(m);
      if (i >= 0) { this.deletePoint(i); return true; }
    }
    return false;
  }

  key(e, down) {
    if (!this.edit || !down) return false;
    if (e.code === 'Escape' || e.code === 'Enter') { this.stopEdit(); e.preventDefault(); return true; }
    if (e.code === 'Delete' || e.code === 'Backspace') {
      const i = this.edit.hover >= 0 ? this.edit.hover : this.edit.points.length - 1;
      this.deletePoint(i);
      e.preventDefault();
      return true;
    }
    return false;
  }

  deletePoint(i) {
    const e = this.edit;
    const min = e.kind === 'override' ? 2 : 2;
    if (e.points.length <= min || (i === 0 && e.kind === 'motion')) { this.toast?.('A path needs at least 2 points', 'x'); return; }
    e.points.splice(i, 1);
    e.hover = -1;
    this.savePoints('Deleted a path point');
  }

  savePoints(summary) {
    const e = this.edit;
    if (e.kind === 'override') { this.saveOverride(e.obj, e.points); return; }
    const rec = this.store.recordOf(e.uid);
    if (!rec) return;
    const m = normalizeMotion(rec.motion) || {};
    m.path ||= { ...MOTION_DEFAULTS.path };
    m.path.points = e.points.map((p) => [Math.round(p[0] - rec.x), Math.round(p[1] - rec.y), Math.round(p[2] - rec.z)]);
    m.path.points[0] = [0, 0, 0];
    this.setMotion(this.editor.sel, m, summary, ownPath(rec));
  }

  // ---- overlay --------------------------------------------------------------------

  draw(g) {
    const ed = this.editor;
    if (!ed.active || !ed.camData) return;
    const now = (performance.now() - this.t0) / 1000;
    // every path in the area, faint; the one being edited bright
    for (const rec of ed.records()) {
      const m = normalizeMotion(rec.motion);
      if (!m?.path || (this.edit && this.edit.uid === rec.uid)) continue;
      const abs = this.absPoints(rec);
      const sel = ed.sel?.uid === rec.uid;
      this.drawPath(g, abs, m.path, sel ? 'rgba(255,200,61,0.75)' : 'rgba(130,210,255,0.45)', false, now);
    }
    // conveyors show which way they carry
    for (const rec of ed.records()) {
      const cv = normalizeMotion(rec.motion)?.conveyor;
      if (!cv || !cv.speed) continue;
      const a = (((rec.yaw | 0) / 32768) * Math.PI) + (cv.dir * Math.PI) / 180;
      const top = rec.y + (rec.block ? rec.block.sy : 0) + 4;
      const L = Math.min(300, (rec.block ? Math.max(rec.block.sx, rec.block.sz) : 300) * 0.35) * Math.sign(cv.speed);
      const p0 = ed.project([rec.x - Math.sin(a) * L, top, rec.z - Math.cos(a) * L]);
      const p1 = ed.project([rec.x + Math.sin(a) * L, top, rec.z + Math.cos(a) * L]);
      if (!p0 || !p1) continue;
      const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      g.save();
      g.strokeStyle = 'rgba(130,210,255,0.85)';
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(p0.x, p0.y); g.lineTo(p1.x, p1.y);
      g.moveTo(p1.x, p1.y); g.lineTo(p1.x - 12 * Math.cos(ang - 0.5), p1.y - 12 * Math.sin(ang - 0.5));
      g.moveTo(p1.x, p1.y); g.lineTo(p1.x - 12 * Math.cos(ang + 0.5), p1.y - 12 * Math.sin(ang + 0.5));
      g.stroke();
      g.restore();
    }
    if (this.edit) {
      const rec = this.store.recordOf(this.edit.uid);
      const path = this.edit.kind === 'override' ? { mode: 'loop', smooth: false, speed: 0 } : normalizeMotion(rec?.motion)?.path || MOTION_DEFAULTS.path;
      this.drawPath(g, this.edit.points, path, '#ffc83d', true, now);
    }
  }

  drawPath(g, abs, path, color, editing, now) {
    const ed = this.editor;
    if (abs.length < 2) return;
    const closed = path.mode === 'loop';
    const s = samplePath(abs, { smooth: path.smooth, closed });
    g.save();
    g.lineWidth = editing ? 3 : 2;
    g.strokeStyle = color;
    g.setLineDash(editing ? [] : [7, 6]);
    g.beginPath();
    let pen = false;
    for (const p of s) {
      const q = ed.project(p);
      if (!q) { pen = false; continue; }
      if (pen) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y);
      pen = true;
    }
    g.stroke();
    g.setLineDash([]);
    // drop lines to the ground make heights readable
    if (editing) {
      for (const p of abs) {
        const f = this.engine.floor(p[0], p[1] + 20, p[2]);
        if (f < -20000 || p[1] - f < 30) continue;
        const a = ed.project(p), b = ed.project([p[0], f, p[2]]);
        if (!a || !b) continue;
        g.strokeStyle = 'rgba(255,200,61,0.35)';
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
    }
    abs.forEach((p, i) => {
      const q = ed.project(p);
      if (!q) return;
      const hot = editing && (this.edit?.hover === i || this.edit?.dragging?.i === i);
      g.fillStyle = i === 0 ? '#5ee08a' : hot ? '#fff' : color;
      g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(q.x, q.y, editing ? (hot ? 8 : 6.5) : 3.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (editing) {
        g.fillStyle = '#111';
        g.font = '600 10px Inter, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(i), q.x, q.y + 0.5);
      }
    });
    // a marker moving along at the path's speed
    if (path.speed > 0) {
      const pm = previewAt(path, abs, now);
      const q = ed.project(pm);
      if (q) {
        g.fillStyle = 'rgba(255,255,255,0.9)';
        g.beginPath(); g.arc(q.x, q.y, 4, 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
  }
}
