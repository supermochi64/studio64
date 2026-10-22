// Play-testing and debug tools: a debug overlay (collision colored by surface type, object
// hitboxes and names, Mario's state, FPS), frame advance and slow motion, instant save
// states, a speedrun timer, the save file (stars, keys, doors), a level validator and
// "Play from here". See docs/testing-tools.md.
import { registerRpc } from './studio.js';
import { Validator } from './validator.js';
import { Terrain } from './terrain.js';

const $ = (s, root = document) => root.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const P = {
  bug: '<path d="M8 2l1.9 1.9M16 2l-1.9 1.9M9 7.1V6a3 3 0 0 1 6 0v1.1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6zM12 20v-9M6.5 13H3M21 13h-3.5M6 9.5 3.5 8M18 9.5 20.5 8M6.5 17 4 19M17.5 17 20 19"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  step: '<path d="M5 5v14l10-7zM19 5v14"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  load: '<path d="M3 12a9 9 0 1 0 9-9 9.7 9.7 0 0 0-6.7 2.7L3 8"/><path d="M3 3v5h5"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6M12 2v3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>',
  star: '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-3-3 8-8-1.3-1.3a4 4 0 0 0-5-5L14 2z"/>',
  flag: '<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',
  run: '<circle cx="14" cy="4" r="2"/><path d="m6 20 3-5 3 2 1-6-4-1-3 3M13 11l3 3 4-1"/>',
};
const ic = (n, cls = 'sm') => `<svg class="i ${cls}" viewBox="0 0 24 24">${P[n] || P.bug}</svg>`;

// surface type -> color (collision view); kind fallbacks for the rest
const SURF = {
  0x0001: ['#ff4d1a', 'lava'], 0x000a: ['#7a2cff', 'death plane'], 0x0005: ['#ff5ad1', 'hangable ceiling'],
  0x0013: ['#5fe1ff', 'very slippery'], 0x0014: ['#7fb8ff', 'slippery'], 0x0015: ['#7dff7a', 'not slippery'],
  0x000d: ['#2d7bff', 'water'], 0x000e: ['#2d7bff', 'flowing water'], 0x0012: ['#999', 'intangible'],
  0x0021: ['#c08a4a', 'quicksand'], 0x0022: ['#c08a4a', 'quicksand'], 0x0023: ['#c08a4a', 'quicksand'], 0x0024: ['#c08a4a', 'quicksand'], 0x0025: ['#c08a4a', 'quicksand'], 0x0026: ['#c08a4a', 'quicksand'], 0x0027: ['#c08a4a', 'quicksand'], 0x0028: ['#c08a4a', 'quicksand'], 0x002c: ['#ffffff', 'wind'], 0x0038: ['#ffffff', 'wind'],
  0x0076: ['#ffd23f', 'warp'], 0x001b: ['#ffd23f', 'warp'], 0x001c: ['#ffd23f', 'warp'], 0x001d: ['#ffd23f', 'warp'], 0x001e: ['#ffd23f', 'warp'],
  0x0032: ['#ffd23f', 'painting warp'], 0x002d: ['#c08a4a', 'shallow quicksand'],
};
const KIND = [['#4f8cff', 'floor'], ['#ffa23a', 'wall'], ['#ff4b6e', 'ceiling']];
const surfColor = (type, kind) => (SURF[type] || KIND[kind])[0];
const LEGEND = [['#4f8cff', 'Floor'], ['#ffa23a', 'Wall'], ['#ff4b6e', 'Ceiling'], ['#7fb8ff', 'Slippery'], ['#5fe1ff', 'Very slippery'], ['#7dff7a', 'Not slippery'], ['#ff4d1a', 'Lava'], ['#7a2cff', 'Death'], ['#ff5ad1', 'Hangable'], ['#c08a4a', 'Quicksand'], ['#ffd23f', 'Warp'], ['#2d7bff', 'Water'], ['#ffffff', 'Wind']];

const COURSES = ['Bob-omb Battlefield', 'Whomp\'s Fortress', 'Jolly Roger Bay', 'Cool, Cool Mountain', 'Big Boo\'s Haunt', 'Hazy Maze Cave', 'Lethal Lava Land', 'Shifting Sand Land', 'Dire, Dire Docks', 'Snowman\'s Land', 'Wet-Dry World', 'Tall, Tall Mountain', 'Tiny-Huge Island', 'Tick Tock Clock', 'Rainbow Ride',
  'Bowser in the Dark World', 'Bowser in the Fire Sea', 'Bowser in the Sky', 'Princess\'s Secret Slide', 'Cavern of the Metal Cap', 'Tower of the Wing Cap', 'Vanish Cap under the Moat', 'Wing Mario over the Rainbow', 'Secret Aquarium'];
const COURSE_STARS = [7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 1, 1, 1, 2, 1, 1, 1, 1, 1];
const CASTLE_STARS = 5; // Toad's 3 and MIPS' 2, kept in the flags (bits 24+)
const FLAG_LABELS = [
  ['HAVE_KEY_1', 'Basement key'], ['HAVE_KEY_2', 'Upstairs key'], ['UNLOCKED_BASEMENT_DOOR', 'Basement door open'], ['UNLOCKED_UPSTAIRS_DOOR', 'Upstairs door open'],
  ['HAVE_WING_CAP', 'Wing cap switch'], ['HAVE_METAL_CAP', 'Metal cap switch'], ['HAVE_VANISH_CAP', 'Vanish cap switch'],
  ['UNLOCKED_PSS_DOOR', 'Slide door (1 star)'], ['UNLOCKED_WF_DOOR', 'Whomp door (1 star)'], ['UNLOCKED_JRB_DOOR', 'Jolly Roger door (3)'], ['UNLOCKED_CCM_DOOR', 'Cool Mountain door (3)'],
  ['UNLOCKED_BITDW_DOOR', 'Dark World door (8)'], ['UNLOCKED_BITFS_DOOR', 'Fire Sea door (30)'], ['UNLOCKED_50_STAR_DOOR', '50 star door'], ['MOAT_DRAINED', 'Moat drained'], ['DDD_MOVED_BACK', 'Docks moved back'],
];
const SPEEDS = [1, 2, 4, 8];

function fmtTime(frames) {
  const t = Math.max(0, frames) / 30;
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

export class TestTools {
  constructor({ state, send, toast, hub }) {
    this.state = state;
    this.send = send;
    this.toast = toast;
    this.hub = hub;
    this.engine = state.engine;
    this.studio = state.studio;
    this.world = state.world;
    this.editor = state.editor;
    this.opts = { collision: false, hitboxes: false, info: false, fps: false, timer: false, ...store.get('studio64.test.opts', {}) };
    this.tab = store.get('studio64.test.tab', 'tools');
    this.names = { actions: {}, surfaces: {}, flags: {} };
    this.frozen = false;
    this.slow = 1;
    this.slots = [null, null, null];
    this.fps = { game: 0, n: 0, t: performance.now() };
    this.tris = null;
    this.trisAt = 0;
    this.objs = [];
    this.objsAt = 0;
    this.timer = { running: false, start: 0, end: 0, splits: [], label: '', pendingStart: true }; // the level that is loaded now counts too
    this.lastLevel = this.engine.level;
    this.lastKey = this.engine.areaKey();
    this.mouse = null;
    this.validator = new Validator({ engine: this.engine, studio: this.studio, world: this.world, catalog: state.catalog, getLevels: () => state.levels || [] });
    fetch('data/debug_names.json').then((r) => r.json()).then((n) => { this.names = n; }).catch(() => {});
    this.build();
    this.bind();
    this.rpc();
    this.applyOpts();
  }

  get M() { return this.engine.M; }
  has(fn) { return typeof this.M?.[`_${fn}`] === 'function'; }

  // ---- DOM -------------------------------------------------------------------------------

  build() {
    const frame = $('#game-frame');
    // overlay canvas between the game and the editor's overlay
    this.canvas = el('canvas', 'tt-canvas');
    $('#canvas').after(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.infoBox = el('div', 'tt-info');
    this.infoBox.hidden = true;
    this.timerBox = el('div', 'tt-timer');
    this.timerBox.hidden = true;
    this.badge = el('div', 'tt-badge');
    this.badge.hidden = true;
    frame.append(this.infoBox, this.timerBox, this.badge);

    // the Test button in the top bar
    const btn = el('button', 'btn ghost', `${ic('bug', '')}<span class="hide-sm">Test</span>`);
    btn.id = 'test-btn';
    btn.title = 'Play-testing tools: debug view, save states, timer, stars, level check (F3)';
    const anchor = $('#sound-btn') || $('#share-btn');
    anchor?.parentNode.insertBefore(btn, anchor);
    btn.onclick = () => this.toggle();

    // the panel
    const p = el('div', 'tt-panel');
    p.id = 'test-panel';
    p.hidden = true;
    p.innerHTML = `
      <div class="tt-head" id="tt-head">
        <div class="tt-title">${ic('bug')}Play-test</div>
        <div class="tt-tabs">
          <button class="tt-tab" data-tab="tools">Tools</button>
          <button class="tt-tab" data-tab="save">Save file</button>
          <button class="tt-tab" data-tab="check">Check level<span class="tt-count" id="tt-check-count"></span></button>
        </div>
        <button class="btn icon ghost sm" id="tt-close" title="Close (F3)">${ic('x')}</button>
      </div>
      <div class="tt-body" id="tt-body"></div>`;
    frame.appendChild(p);
    this.panel = p;
    $('#tt-close', p).onclick = () => this.toggle(false);
    for (const t of p.querySelectorAll('.tt-tab')) t.onclick = () => { this.tab = t.dataset.tab; store.set('studio64.test.tab', this.tab); this.render(); };
    // drag the panel by its head
    const head = $('#tt-head', p);
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = p.getBoundingClientRect(), fr = frame.getBoundingClientRect();
      const ox = e.clientX - r.left, oy = e.clientY - r.top;
      head.setPointerCapture(e.pointerId);
      const move = (ev) => {
        p.style.left = `${Math.max(0, Math.min(fr.width - r.width, ev.clientX - fr.left - ox))}px`;
        p.style.top = `${Math.max(0, Math.min(fr.height - 60, ev.clientY - fr.top - oy))}px`;
        p.style.right = 'auto';
      };
      const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
    });

    // "Play from here" in the build bar
    const bar = $('#build-bar');
    if (bar) {
      const b = el('button', 'bar-btn tt-playhere', `${ic('play')}<span>Play from here</span>`);
      b.title = 'Play from the spot the camera looks at (P: the spot under the mouse)';
      b.onclick = () => this.playFromHere();
      bar.appendChild(b);
    }
  }

  bind() {
    const e = this.engine;
    e.on('frame', () => this.onFrame());
    e.on('area', (lvl) => this.onArea(lvl));
    e.on('star', (ev) => this.onStar(ev));
    new ResizeObserver(() => this.resize()).observe($('#game-frame'));
    this.resize();
    $('#overlay')?.addEventListener('mousemove', (ev) => { const r = ev.currentTarget.getBoundingClientRect(); this.mouse = [ev.clientX - r.left, ev.clientY - r.top]; });
    // shortcuts work while playing and building, not while typing
    window.addEventListener('keydown', (ev) => {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || !$('#modal-back').hidden || document.body.classList.contains('home-open')) return;
      const k = ev.key;
      const act = {
        F2: () => this.toggleOverlay(),
        F3: () => this.toggle(),
        F4: () => this.resetTimer(true),
        F6: () => this.saveState(0),
        F7: () => this.loadState(0),
        F8: () => this.setFrozen(!this.frozen),
        F9: () => this.step(),
        F10: () => this.cycleSlow(),
      }[k];
      if (act) { ev.preventDefault(); ev.stopPropagation(); act(); return; }
      if (ev.code === 'KeyP' && this.editor?.active && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { ev.preventDefault(); this.playFromHere(true); }
    }, true);
  }

  toggle(on = this.panel.hidden) {
    this.panel.hidden = !on;
    $('#test-btn').classList.toggle('active', on);
    if (on) this.render();
  }

  resize() {
    const f = $('#game-frame');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.canvas.width = Math.round(f.clientWidth * dpr);
    this.canvas.height = Math.round(f.clientHeight * dpr);
  }

  applyOpts() {
    store.set('studio64.test.opts', this.opts);
    this.infoBox.hidden = !(this.opts.info || this.opts.fps);
    this.timerBox.hidden = !this.opts.timer;
    if (!this.opts.collision && !this.opts.hitboxes) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    $('#test-btn')?.classList.toggle('on', this.opts.collision || this.opts.hitboxes || this.opts.info || this.opts.fps || this.opts.timer || this.frozen || this.slow > 1);
  }

  toggleOverlay() {
    const any = this.opts.collision || this.opts.hitboxes || this.opts.info;
    this.opts.collision = this.opts.hitboxes = this.opts.info = !any;
    this.applyOpts();
    if (!this.panel.hidden) this.render();
    this.toast(any ? 'Debug view off' : 'Debug view on (F2)', 'eye');
  }

  // ---- the panel ---------------------------------------------------------------------------

  render() {
    if (this.panel.hidden) return;
    this.panel.querySelectorAll('.tt-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === this.tab));
    const body = $('#tt-body', this.panel);
    body.innerHTML = '';
    if (this.tab === 'tools') this.renderTools(body);
    else if (this.tab === 'save') this.renderSave(body);
    else this.renderCheck(body);
  }

  renderTools(body) {
    const o = this.opts;
    const chip = (key, label, hint) => `<button class="tt-chip${o[key] ? ' on' : ''}" data-opt="${key}" title="${esc(hint)}">${esc(label)}</button>`;
    body.innerHTML = `
      <div class="tt-sec"><div class="tt-sec-title">Show <span class="tt-key">F2</span></div>
        <div class="tt-chips">${chip('collision', 'Collision', 'Collision triangles colored by surface type')}${chip('hitboxes', 'Hitboxes', 'Object hitboxes and names')}${chip('info', 'Mario', 'Mario\'s action, position and speed')}${chip('fps', 'FPS', 'Frames per second')}${chip('timer', 'Timer', 'Speedrun timer')}</div>
        <div class="tt-legend" ${o.collision ? '' : 'hidden'}>${LEGEND.map(([c, n]) => `<span><i style="background:${c}"></i>${n}</span>`).join('')}</div>
      </div>
      <div class="tt-sec"><div class="tt-sec-title">Time</div>
        <div class="tt-row">
          <button class="btn sm${this.frozen ? ' primary' : ''}" id="tt-freeze" title="Pause the game (F8)">${this.frozen ? `${ic('play')}Resume` : `${ic('pause')}Pause`}</button>
          <button class="btn sm" id="tt-step" title="One frame forward (F9)">${ic('step')}Frame</button>
          <div class="tt-seg" title="Slow motion (F10)">${SPEEDS.map((s) => `<button class="${this.slow === s ? 'on' : ''}" data-slow="${s}">${s === 1 ? '1×' : `1/${s}`}</button>`).join('')}</div>
        </div>
      </div>
      <div class="tt-sec"><div class="tt-sec-title">Save states <span class="tt-key">F6</span> save <span class="tt-key">F7</span> load</div>
        <div class="tt-slots" id="tt-slots"></div>
      </div>
      <div class="tt-sec"><div class="tt-sec-title">Speedrun timer <span class="tt-key">F4</span> restart</div>
        <div class="tt-row"><button class="btn sm" id="tt-timer-reset">${ic('timer')}Restart timer</button><span class="tt-note">Starts when you enter a level, splits on every star.</span></div>
      </div>
      <div class="tt-sec"><div class="tt-sec-title">Play from here</div>
        <div class="tt-row"><button class="btn sm" id="tt-here">${ic('run')}Play from the camera</button><span class="tt-note">In build mode: <span class="tt-key">P</span> plays from the spot under the mouse.</span></div>
      </div>`;
    body.querySelectorAll('[data-opt]').forEach((b) => { b.onclick = () => { o[b.dataset.opt] = !o[b.dataset.opt]; this.applyOpts(); this.render(); }; });
    body.querySelector('#tt-freeze').onclick = () => this.setFrozen(!this.frozen);
    body.querySelector('#tt-step').onclick = () => this.step();
    body.querySelectorAll('[data-slow]').forEach((b) => { b.onclick = () => this.setSlow(Number(b.dataset.slow)); });
    body.querySelector('#tt-timer-reset').onclick = () => this.resetTimer(true);
    body.querySelector('#tt-here').onclick = () => this.playFromHere();
    this.renderSlots();
  }

  renderSlots() {
    const box = $('#tt-slots', this.panel);
    if (!box) return;
    box.innerHTML = '';
    this.slots.forEach((s, i) => {
      const d = el('div', `tt-slot${s ? '' : ' tt-empty'}`);
      d.innerHTML = `<div class="tt-slot-pic"${s?.thumb ? ` style="background-image:url('${s.thumb}')"` : ''}>${s ? '' : i + 1}</div>
        <div class="tt-slot-meta"><b>${s ? esc(s.label) : `Slot ${i + 1}`}</b><span>${s ? new Date(s.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'empty'}</span></div>
        <button class="btn sm" data-a="save" title="Save the game here${i === 0 ? ' (F6)' : ''}">${ic('save')}</button>
        <button class="btn sm" data-a="load" ${s ? '' : 'disabled'} title="Load${i === 0 ? ' (F7)' : ''}">${ic('load')}</button>`;
      d.querySelector('[data-a=save]').onclick = () => this.saveState(i);
      d.querySelector('[data-a=load]').onclick = () => this.loadState(i);
      box.appendChild(d);
    });
  }

  // ---- debug overlay ------------------------------------------------------------------------

  onFrame() {
    this.fps.n++;
    const now = performance.now();
    if (now - this.fps.t >= 1000) { this.fps.game = (this.fps.n * 1000) / (now - this.fps.t); this.fps.n = 0; this.fps.t = now; }
    const o = this.opts;
    if (o.collision || o.hitboxes) this.drawOverlay();
    if (o.info || o.fps) this.drawInfo();
    if (o.timer || this.timer.pendingStart) this.tickTimer();
  }

  center() {
    if (this.editor?.active && this.editor.camData) {
      const c = this.editor.camData;
      const d = [c.focus[0] - c.pos[0], c.focus[1] - c.pos[1], c.focus[2] - c.pos[2]];
      const l = Math.hypot(...d) || 1;
      return [c.pos[0] + (d[0] / l) * 1500, c.pos[1] + (d[1] / l) * 1500, c.pos[2] + (d[2] / l) * 1500];
    }
    try { const m = this.engine.state().mario; if (m) return [m.x, m.y, m.z]; } catch { /* menu */ }
    return null;
  }

  drawOverlay() {
    const g = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    if (this.editor?.active && !this.opts.collision && !this.opts.hitboxes) return;
    let cam;
    try { cam = this.engine.camOut(); } catch { return; }
    const v = cam.view;
    const f = 1 / Math.tan((cam.fov * Math.PI) / 360);
    const aspect = W / H;
    const toView = (x, y, z) => [x * v[0] + y * v[4] + z * v[8] + v[12], x * v[1] + y * v[5] + z * v[9] + v[13], x * v[2] + y * v[6] + z * v[10] + v[14]];
    const NEAR = -30;
    const proj = (p) => [((p[0] * f / aspect) / -p[2] + 1) * W / 2, (1 - (p[1] * f) / -p[2]) * H / 2];
    const center = this.center();
    if (!center) return;

    if (this.opts.collision && this.has('studio_debug_surfaces')) {
      const now = performance.now();
      if (!this.tris || now - this.trisAt > 250) {
        const ptr = this.M._studio_debug_surfaces(center[0], center[1], center[2], this.editor?.active ? 5000 : 3200, 9000);
        const n = new Float32Array(this.M.HEAPU8.buffer, ptr, 1)[0];
        this.tris = new Float32Array(this.M.HEAPU8.buffer, ptr, 1 + n * 13).slice(1);
        this.trisAt = now;
      }
      const T = this.tris;
      const polys = [];
      for (let i = 0; i < T.length; i += 13) {
        let poly = [toView(T[i], T[i + 1], T[i + 2]), toView(T[i + 3], T[i + 4], T[i + 5]), toView(T[i + 6], T[i + 7], T[i + 8])];
        if (poly.every((p) => p[2] > NEAR)) continue;
        if (poly.some((p) => p[2] > NEAR)) {
          // clip against the near plane
          const out = [];
          for (let k = 0; k < poly.length; k++) {
            const a = poly[k], b = poly[(k + 1) % poly.length];
            const ain = a[2] <= NEAR, bin = b[2] <= NEAR;
            if (ain) out.push(a);
            if (ain !== bin) { const t = (NEAR - a[2]) / (b[2] - a[2]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]); }
          }
          poly = out;
        }
        const depth = poly.reduce((s, p) => s + p[2], 0) / poly.length;
        polys.push({ pts: poly.map(proj), depth, color: surfColor(T[i + 9], T[i + 10]), dyn: T[i + 11] > 0 });
      }
      polys.sort((a, b) => a.depth - b.depth);
      g.lineJoin = 'round';
      g.lineWidth = Math.max(1, this.dpr * 0.8);
      for (const p of polys) {
        g.beginPath();
        g.moveTo(p.pts[0][0], p.pts[0][1]);
        for (let k = 1; k < p.pts.length; k++) g.lineTo(p.pts[k][0], p.pts[k][1]);
        g.closePath();
        g.globalAlpha = p.dyn ? 0.34 : 0.26;
        g.fillStyle = p.color;
        g.fill();
        g.globalAlpha = 0.75;
        g.strokeStyle = p.dyn ? '#ffffff' : p.color;
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    if (this.opts.hitboxes) {
      const now = performance.now();
      if (now - this.objsAt > 120) { try { this.objs = this.engine.objects(); } catch { this.objs = []; } this.objsAt = now; }
      const R = this.editor?.active ? 6000 : 3500;
      g.font = `${Math.round(11 * this.dpr)}px Inter, system-ui, sans-serif`;
      g.textAlign = 'center';
      for (const o of this.objs) {
        if (!(o.r > 0) || !o.list) continue;
        if (Math.hypot(o.x - center[0], o.y - center[1], o.z - center[2]) > R) continue;
        const y0 = o.y - (o.down || 0), y1 = y0 + (o.h || 0);
        const ring = (y) => {
          const pts = [];
          for (let k = 0; k <= 16; k++) {
            const a = (k / 16) * Math.PI * 2;
            const p = toView(o.x + Math.sin(a) * o.r, y, o.z + Math.cos(a) * o.r);
            if (p[2] > NEAR) return null;
            pts.push(proj(p));
          }
          return pts;
        };
        const lo = ring(y0), hi = ring(y1);
        if (!lo || !hi) continue;
        const mario = o.bhv === 'bhvMario';
        g.strokeStyle = mario ? '#ff3b3b' : o.uid ? '#ffd23f' : '#3be8b0';
        g.lineWidth = Math.max(1, this.dpr * 1.2);
        g.globalAlpha = 0.9;
        for (const ringPts of [lo, hi]) { g.beginPath(); ringPts.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke(); }
        g.beginPath();
        for (const k of [0, 4, 8, 12]) { g.moveTo(lo[k][0], lo[k][1]); g.lineTo(hi[k][0], hi[k][1]); }
        g.stroke();
        if (!mario) {
          const top = proj(toView(o.x, y1 + 30, o.z));
          const name = this.studio.nameOfObject(o);
          const w = g.measureText(name).width + 10 * this.dpr;
          g.globalAlpha = 0.8;
          g.fillStyle = 'rgba(10,10,14,0.75)';
          g.fillRect(top[0] - w / 2, top[1] - 15 * this.dpr, w, 17 * this.dpr);
          g.globalAlpha = 1;
          g.fillStyle = o.uid ? '#ffe28a' : '#d6fff1';
          g.fillText(name, top[0], top[1] - 2 * this.dpr);
        }
      }
      g.globalAlpha = 1;
    }
  }

  drawInfo() {
    if (!this.has('studio_debug_mario_json')) return;
    if ((this.infoTick = (this.infoTick || 0) + 1) % 2) return;
    let m;
    try { m = JSON.parse(this.M.UTF8ToString(this.M._studio_debug_mario_json())); } catch { return; }
    const lines = [];
    if (this.opts.fps) lines.push(`<b>FPS</b> ${this.fps.game.toFixed(0)} game${this.frozen ? ' · paused' : this.slow > 1 ? ` · 1/${this.slow} speed` : ''}`);
    if (this.opts.info && m.x !== undefined) {
      const act = this.names.actions[m.action >>> 0] || 'action';
      const floor = m.floorType >= 0 ? (this.names.surfaces[m.floorType]?.name || `type ${m.floorType}`) : 'none';
      const hs = Math.hypot(m.vx, m.vz);
      lines.push(
        `<b>ACTION</b> ${esc(act)} <span>0x${(m.action >>> 0).toString(16).padStart(8, '0')} · state ${m.actionState} · t ${m.actionTimer}</span>`,
        `<b>POS</b> ${m.x.toFixed(0)}, ${m.y.toFixed(0)}, ${m.z.toFixed(0)} <span>yaw ${Math.round(((m.yaw & 0xffff) / 65536) * 360)}°</span>`,
        `<b>SPEED</b> fwd ${m.fvel.toFixed(1)} · h ${hs.toFixed(1)} · y ${m.vy.toFixed(1)}`,
        `<b>FLOOR</b> ${esc(floor)} <span>y ${m.floorY.toFixed(0)} · ny ${m.floorNy.toFixed(2)}${m.ceilY < 20000 ? ` · ceil ${m.ceilY.toFixed(0)}` : ''}${m.wall ? ' · wall' : ''}</span>`,
        `<b>MARIO</b> hp ${m.health} · coins ${m.coins} · stars ${m.stars} <span>frame ${m.timer}</span>`,
      );
    }
    this.infoBox.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
  }

  // ---- time ---------------------------------------------------------------------------------

  setFrozen(on) {
    if (!this.has('studio_debug_speed')) { this.toast('Rebuild the engine for frame advance', 'x'); return; }
    if (on && this.editor?.active) { this.toast('Frame advance works while playing (Tab back to the game)', 'x'); return; }
    this.frozen = on;
    this.M._studio_debug_speed(on ? 1 : 0, this.slow);
    this.showBadge();
    this.applyOpts();
    this.render();
    if (!on) $('#canvas').focus();
  }

  step(n = 1) {
    if (!this.frozen) { this.setFrozen(true); return; }
    this.M._studio_debug_step(n);
  }

  setSlow(div) {
    if (!this.has('studio_debug_speed')) return;
    this.slow = div;
    this.M._studio_debug_speed(this.frozen ? 1 : 0, div);
    this.showBadge();
    this.applyOpts();
    this.render();
  }

  cycleSlow() { this.setSlow(SPEEDS[(SPEEDS.indexOf(this.slow) + 1) % SPEEDS.length]); this.toast(this.slow === 1 ? 'Normal speed' : `Slow motion 1/${this.slow}`, 'clock'); }

  showBadge() {
    this.badge.hidden = !(this.frozen || this.slow > 1);
    this.badge.innerHTML = this.frozen ? `${ic('pause')}Paused <span>F9 next frame · F8 resume</span>` : `${ic('clock')}1/${this.slow} speed <span>F10 change</span>`;
  }

  // ---- speedrun timer -------------------------------------------------------------------------

  frames() { return this.has('studio_debug_frames') ? this.M._studio_debug_frames() : Math.round(performance.now() / 33.333); }

  levelLabel() {
    const e = this.engine;
    if (e.level === e.studioLevel) return (this.state.levels || []).find((l) => l.id === e.customLevel)?.name || 'Custom level';
    return Object.values(this.state.catalog.levels).find((l) => l.num === e.level)?.name || `Level ${e.level}`;
  }

  onArea(lvl) {
    if (lvl !== this.lastLevel || this.engine.areaKey() !== this.lastKey) {
      if (lvl !== this.lastLevel) this.resetTimer(false);
      this.lastLevel = lvl;
      this.lastKey = this.engine.areaKey();
    }
    this.tris = null;
    this.objs = [];
  }

  resetTimer(manual) {
    this.timer = { running: false, start: 0, end: 0, splits: [], label: '', pendingStart: true };
    if (manual) { this.opts.timer = true; this.applyOpts(); this.toast('Timer restarts when Mario can move', 'clock'); }
  }

  tickTimer() {
    const t = this.timer;
    if (t.pendingStart) {
      let ready = false;
      try { ready = !!this.engine.state().mario && !this.engine.inIntro; } catch { /* loading */ }
      if (ready) { t.pendingStart = false; t.running = true; t.start = this.frames(); t.label = this.levelLabel(); }
    }
    if (!this.opts.timer) return;
    const now = t.running ? this.frames() : t.end;
    const pbKey = `studio64.pb.${this.state.projectId}.${this.engine.areaKey()}`;
    const pb = store.get(pbKey, null);
    const last = t.splits[t.splits.length - 1];
    this.timerBox.innerHTML = `<div class="tt-timer-main${t.running ? '' : ' done'}">${fmtTime(now - t.start)}</div>
      <div class="tt-timer-sub">${esc(t.label || this.levelLabel())}${last ? ` · ★ ${esc(last.name)} ${fmtTime(last.frames)}` : ''}${pb ? ` · best ${fmtTime(pb)}` : ''}</div>`;
  }

  onStar(ev) {
    const t = this.timer;
    if (!t.running) return;
    const frames = this.frames() - t.start;
    const s = this.world.findStar(ev.key, ev.uid, ev.index);
    t.splits.push({ name: s?.name || 'Star', frames });
    // a star ends the course: the run is over
    t.running = false;
    t.end = this.frames();
    const pbKey = `studio64.pb.${this.state.projectId}.${ev.key}`;
    const pb = store.get(pbKey, null);
    if (pb === null || frames < pb) { store.set(pbKey, frames); if (this.opts.timer) this.toast(`New best: ${fmtTime(frames)}`, 'sparkles'); }
  }

  // ---- save states -----------------------------------------------------------------------------

  async saveState(i) {
    const e = this.engine;
    if (!e.ready || e.crashed) return;
    if (!this.has('studio_heap_end')) { this.toast('Rebuild the engine for save states', 'x'); return; }
    if (this.editor?.active) { this.toast('Save states work while playing (Tab back to the game)', 'x'); return; }
    let thumb = null;
    try {
      const url = await e.screenshot(800);
      if (url) {
        const img = await new Promise((ok, err) => { const im = new Image(); im.onload = () => ok(im); im.onerror = err; im.src = url; });
        const c = el('canvas'); c.width = 128; c.height = 72;
        c.getContext('2d').drawImage(img, 0, 0, 128, 72);
        thumb = c.toDataURL('image/jpeg', 0.7);
      }
    } catch { /* no picture */ }
    const t0 = performance.now();
    const M = this.M;
    const end = M._studio_heap_end() >>> 0;
    const PAGE = 65536;
    const count = Math.ceil(end / PAGE);
    const pages = new Map();
    const buf = M.HEAPU8.buffer;
    for (let p = 0; p < count; p++) {
      const words = new Uint32Array(buf, p * PAGE, Math.min(PAGE, buf.byteLength - p * PAGE) >> 2);
      let nz = false;
      for (let k = 0; k < words.length; k++) if (words[k] !== 0) { nz = true; break; }
      if (nz) pages.set(p, new Uint8Array(buf, p * PAGE, words.length * 4).slice());
    }
    const key = e.areaKey();
    this.slots[i] = {
      pages, count, end, ts: Date.now(), thumb,
      label: this.levelLabel(), key, level: e.level, area: e.area, customLevel: e.customLevel,
      terrains: JSON.parse(JSON.stringify(e._terrains || {})), terrain: this.world.terrain ? this.world.terrain.encode() : null,
      patch: JSON.stringify(e.patch.areas?.[key] || null),
      timer: { ...this.timer, splits: [...this.timer.splits] },
    };
    const mb = [...pages.values()].reduce((n, b) => n + b.length, 0) / 1048576;
    this.toast(`Saved state ${i + 1} (${Math.round(performance.now() - t0)} ms, ${mb.toFixed(0)} MB)`, 'check');
    this.renderSlots();
  }

  loadState(i) {
    const s = this.slots[i];
    const e = this.engine;
    if (!s) { this.toast(`Save state ${i + 1} is empty (F6 saves)`, 'x'); return; }
    if (!e.ready || e.crashed) return;
    if (this.editor?.active) this.editor.exit();
    const t0 = performance.now();
    const M = this.M;
    M._studio_before_state_load();
    const PAGE = 65536;
    const heap = M.HEAPU8;
    const nowEnd = M._studio_heap_end() >>> 0;
    for (let p = 0; p < s.count; p++) {
      const data = s.pages.get(p);
      if (data) heap.set(data, p * PAGE);
      else heap.fill(0, p * PAGE, Math.min((p + 1) * PAGE, heap.length));
    }
    // memory the saved game never used is fresh again
    if (nowEnd > s.count * PAGE) heap.fill(0, s.count * PAGE, Math.min(nowEnd, heap.length));
    M._studio_after_state_load();
    e.releaseKeys();
    // a cutscene's lock (Mario frozen, Start skips) and camera live in the game's memory, the
    // cutscene itself in the page: a state saved during one would leave Mario frozen for good
    // (and one loaded during a cutscene would play on over the loaded game), so none survives
    try {
      const story = this.state.storyRuntime;
      if (story?.cut) story.endCutscene();
      else { M._studio_story_lock?.(0, 1); e.setCamera(false); }
    } catch (err) { console.warn('save state: story', err); }
    // the page's view of the game follows
    const moved = e.areaKey() !== s.key;
    e.level = s.level; e.area = s.area; e.customLevel = s.customLevel;
    e._terrains = JSON.parse(JSON.stringify(s.terrains));
    try { this.world.terrain = s.terrain ? Terrain.decode(s.terrain) : null; } catch { /* keep */ }
    // the frame counter lives in the game's memory: the clock goes on from the moment of the save
    this.timer = { ...s.timer, splits: [...s.timer.splits] };
    this.tris = null;
    if (moved) e.emit('area', s.level, s.area);
    const edited = JSON.stringify(e.patch.areas?.[s.key] || null) !== s.patch;
    this.toast(`Loaded state ${i + 1}${edited ? ' (from before your last edits here)' : ''} · ${Math.round(performance.now() - t0)} ms`, 'check');
    $('#canvas').focus();
  }

  // ---- play from here -----------------------------------------------------------------------

  // Where to start: the spot under the mouse (P), or what the camera looks at.
  async playFromHere(underMouse = false, at = null) {
    const e = this.engine;
    const ed = this.editor;
    let p = at;
    if (!p && ed?.active) {
      if (underMouse && this.mouse) { const h = ed.pick(this.mouse[0], this.mouse[1], { objects: false }); if (h) p = [h.x, h.y, h.z]; }
      if (!p) p = ed.viewCenter();
    }
    if (!p) {
      // playing: in front of the camera
      try {
        const c = e.camOut();
        const d = [c.focus[0] - c.pos[0], 0, c.focus[2] - c.pos[2]];
        const l = Math.hypot(d[0], d[2]) || 1;
        p = [c.focus[0] + (d[0] / l) * 200, c.focus[1] + 400, c.focus[2] + (d[2] / l) * 200];
      } catch { return null; }
    }
    let ground = e.floor(p[0], p[1] + 300, p[2]);
    if (ground < -20000) ground = e.floor(p[0], 20000, p[2]);
    if (ground < -20000) { this.toast('No ground there to stand on', 'x'); return null; }
    let yaw = 0;
    try { const c = ed?.camData || e.camOut(); yaw = Math.round((Math.atan2(c.focus[0] - c.pos[0], c.focus[2] - c.pos[2]) / Math.PI) * 32768) & 0xffff; } catch { /* default */ }
    if (ed?.active) ed.exit();
    await new Promise((r) => setTimeout(r, 60));
    e.teleport(p[0], ground + 20, p[2], yaw);
    $('#canvas').focus();
    this.toast('Playing from here', 'play');
    return { x: Math.round(p[0]), y: Math.round(ground), z: Math.round(p[2]) };
  }

  // ---- save file ------------------------------------------------------------------------------

  // A fresh save: the game's save file, your levels' stars, keys and doors, the story (savegame.js).
  resetSave() {
    const st = window.studio64 || window.studioPlayer || {};
    if (st.save) st.save.reset({ engine: this.engine, world: this.world, story: st.storyRuntime, flow: st.worldFlow });
    else { this.M._studio_save_reset(); st.storyRuntime?.resetProgress(); }
    st.levelsUI?.syncStarTotal?.();
  }

  saveFile() {
    if (!this.has('studio_save_json')) return null;
    try { return JSON.parse(this.M.UTF8ToString(this.M._studio_save_json())); } catch { return null; }
  }

  setStars(course, bits) {
    if (course === -1) {
      const sf = this.saveFile();
      const cur = (sf.flags >>> 24) & 0x7f;
      this.M._studio_save_set_flags(((bits & 0x7f) << 24) >>> 0, ((cur & ~bits) << 24) >>> 0);
    } else this.M._studio_save_set_course(course, bits);
  }

  // Fill the save file with n stars (courses in order), for testing star doors.
  giveStars(n) {
    let left = Math.max(0, Math.min(120, n));
    for (let c = 0; c < COURSES.length; c++) {
      const k = Math.min(left, COURSE_STARS[c]);
      this.M._studio_save_set_course(c, (1 << k) - 1);
      left -= k;
    }
    const castle = Math.min(left, CASTLE_STARS);
    const sf = this.saveFile();
    this.M._studio_save_set_flags((((1 << castle) - 1) << 24) >>> 0, (((~((1 << castle) - 1)) & 0x7f) << 24) >>> 0);
    void sf;
    return this.saveFile()?.total;
  }

  renderSave(body) {
    const sf = this.saveFile();
    if (!sf) { body.innerHTML = '<div class="tt-note">Rebuild the engine to edit the save file.</div>'; return; }
    const flags = this.names.flags || {};
    const castleBits = (sf.flags >>> 24) & 0x7f;
    const rows = COURSES.map((name, c) => `<div class="tt-course"><span class="nm" title="${esc(name)}">${c + 1}. ${esc(name)}</span><span class="stars">${Array.from({ length: COURSE_STARS[c] }, (_, k) => `<button class="tt-star${(sf.stars[c] >> k) & 1 ? ' on' : ''}" data-c="${c}" data-k="${k}" title="Star ${k + 1}">${ic('star', 'xs')}</button>`).join('')}</span></div>`).join('');
    const custom = (this.state.levels || []).map((l) => {
      // all the level's areas (sub-areas: c:<id>:<n>)
      const keys = [`c:${l.id}`, ...Object.keys(this.engine.patch.areas || {}).filter((k) => k.startsWith(`c:${l.id}:`)).sort()];
      const stars = keys.flatMap((k) => this.world.stars(k).map((s) => ({ ...s, key: k })));
      return `<div class="tt-course"><span class="nm">${esc(l.name)}</span><span class="stars">${stars.map((s) => `<button class="tt-star custom${s.done ? ' on' : ''}" data-key="${esc(s.key)}" data-uid="${esc(String(s.uid))}" title="${esc(s.name)}">${ic('star', 'xs')}</button>`).join('') || '<span class="tt-note">no stars</span>'}</span></div>`;
    }).join('');
    body.innerHTML = `
      <div class="tt-sec"><div class="tt-total"><b>${sf.total}</b> stars in the save file <span class="tt-note">(+ ${this.world.collectedTotal()} of your own)</span></div>
        <div class="tt-row wrap">${[0, 1, 3, 8, 30, 50, 70, 120].map((n) => `<button class="btn sm" data-give="${n}">${n === 0 ? 'None' : n}</button>`).join('')}</div>
        <div class="tt-note">Sets the stars for testing star doors and requirements.</div>
      </div>
      <div class="tt-sec"><div class="tt-sec-title">Courses</div><div class="tt-courses">${rows}
        <div class="tt-course"><span class="nm">Castle secret stars</span><span class="stars">${Array.from({ length: CASTLE_STARS }, (_, k) => `<button class="tt-star${(castleBits >> k) & 1 ? ' on' : ''}" data-c="-1" data-k="${k}">${ic('star', 'xs')}</button>`).join('')}</span></div></div>
      </div>
      ${custom ? `<div class="tt-sec"><div class="tt-sec-title">Your levels</div><div class="tt-courses">${custom}</div></div>` : ''}
      <div class="tt-sec"><div class="tt-sec-title">Keys, caps and doors</div><div class="tt-flags">${FLAG_LABELS.filter(([k]) => flags[k]).map(([k, label]) => `<label><input type="checkbox" data-flag="${flags[k]}" ${sf.flags & flags[k] ? 'checked' : ''}>${esc(label)}</label>`).join('')}</div></div>
      <div class="tt-sec tt-row"><button class="btn sm danger" id="tt-reset-save">Reset save file</button><button class="btn sm ghost" id="tt-reset-studio">Forget your levels' stars</button></div>`;
    body.querySelectorAll('[data-give]').forEach((b) => { b.onclick = () => { const t = this.giveStars(Number(b.dataset.give)); this.toast(`Save file: ${t} stars`, 'sparkles'); this.render(); }; });
    body.querySelectorAll('.tt-star:not(.custom)').forEach((b) => {
      b.onclick = () => {
        const c = Number(b.dataset.c), k = Number(b.dataset.k);
        const cur = c === -1 ? castleBits : sf.stars[c];
        this.setStars(c, cur ^ (1 << k));
        this.render();
      };
    });
    body.querySelectorAll('.tt-star.custom').forEach((b) => {
      b.onclick = () => {
        const id = `${b.dataset.key}|${b.dataset.uid}`;
        const p = this.world.progress();
        if (p[id]) delete p[id]; else p[id] = Date.now();
        try { localStorage.setItem(this.world.progressKey(), JSON.stringify(p)); } catch { /* private */ }
        this.engine.setBonusStars(this.world.collectedTotal());
        this.world.emit();
        this.render();
      };
    });
    body.querySelectorAll('[data-flag]').forEach((cb) => { cb.onchange = () => { const f = Number(cb.dataset.flag) >>> 0; if (cb.checked) this.M._studio_save_set_flags(f, 0); else this.M._studio_save_set_flags(0, f); }; });
    body.querySelector('#tt-reset-save').onclick = () => { this.resetSave(); this.toast('Save file reset: no stars, no keys, story from the beginning', 'check'); this.render(); };
    body.querySelector('#tt-reset-studio').onclick = () => { this.world.resetProgress(); this.engine.setBonusStars(0); this.world.emit(); this.toast('Your levels\' stars are uncollected again', 'check'); this.render(); };
  }

  // ---- level check ---------------------------------------------------------------------------

  runCheck() {
    this.lastCheck = this.validator.run();
    const c = this.lastCheck.counts;
    const badge = $('#tt-check-count', this.panel);
    if (badge) { badge.textContent = c.error + c.warn ? String(c.error + c.warn) : ''; badge.className = `tt-count${c.error ? ' err' : ''}`; }
    return this.lastCheck;
  }

  renderCheck(body) {
    const r = this.runCheck();
    const { counts } = r;
    body.innerHTML = `<div class="tt-check-head">
        <div class="tt-check-sum ${counts.error ? 'err' : counts.warn ? 'warn' : 'ok'}">${counts.error || counts.warn ? `${ic(counts.error ? 'error' : 'warn')}${counts.error ? `${counts.error} problem${counts.error > 1 ? 's' : ''}` : ''}${counts.error && counts.warn ? ', ' : ''}${counts.warn ? `${counts.warn} warning${counts.warn > 1 ? 's' : ''}` : ''}` : `${ic('check')}No problems found`}</div>
        <button class="btn sm" id="tt-recheck">Check again</button></div>
      <div class="tt-problems" id="tt-problems"></div>`;
    body.querySelector('#tt-recheck').onclick = () => this.render();
    const list = body.querySelector('#tt-problems');
    let lastLevel = null;
    for (const p of r.problems) {
      if (p.key !== lastLevel) { lastLevel = p.key; list.appendChild(el('div', 'tt-prob-level', `${esc(p.level)}${p.key === r.here ? ' <span>(here)</span>' : ''}`)); }
      const d = el('div', `tt-prob ${p.severity}`);
      d.innerHTML = `<span class="tt-prob-ic">${ic(p.severity === 'warn' ? 'warn' : p.severity)}</span><div class="tt-prob-txt"><b>${esc(p.title)}</b><span>${esc(p.detail || '')}</span></div>`;
      const btns = el('div', 'tt-prob-btns');
      if (p.pos || p.key !== r.here) {
        const go = el('button', 'btn sm', `${ic('target')}Show`);
        go.title = 'Jump there in build mode';
        go.onclick = () => this.jumpTo(p);
        btns.appendChild(go);
      }
      if (p.fix && p.key === r.here && (p.uid || p.fix.kind === 'spawn')) {
        const fx = el('button', 'btn sm', `${ic('wrench')}Fix`);
        fx.title = { lift: 'Move it up onto the ground', lower: 'Move it down within reach', spawn: 'Start Mario where he stands now' }[p.fix.kind] || 'Fix';
        fx.onclick = () => this.fix(p);
        btns.appendChild(fx);
      }
      d.appendChild(btns);
      list.appendChild(d);
    }
  }

  // Build mode, looking at the problem (in another level: go there first).
  async jumpTo(p) {
    const e = this.engine;
    if (p.key !== e.areaKey()) {
      const parts = p.key.split(':');
      const target = p.key.startsWith('c:') ? { custom: parts[1], name: p.level } : { num: Number(parts[0]), name: p.level };
      const sub = Number(p.key.startsWith('c:') ? parts[2] : parts[1]) || 1; // a sub-area: c:<id>:<n>, 9:2
      if (sub > 1 && this.state.worldFlow) this.state.worldFlow.goArea(target.custom ? { custom: target.custom, area: sub } : { level: target.num, area: sub });
      else if (this.state.levelsUI) this.state.levelsUI.go(target);
      else if (target.custom) e.warpFast(e.studioLevel, 0, target.custom); else e.warpFast(target.num, 0);
      await e.waitArrival(target.custom ? e.studioLevel : target.num, 30000);
      await new Promise((r) => setTimeout(r, 400));
    }
    if (!p.pos) return;
    if (!this.editor.active) this.editor.enter();
    await new Promise((r) => setTimeout(r, 80));
    if (p.uid) {
      const o = e.objects().find((x) => x.uid === p.uid);
      if (o) this.editor.select(o.slot);
    }
    this.editor.frameTo([p.pos[0], p.pos[1] + 60, p.pos[2]], 450);
  }

  fix(p) {
    const e = this.engine;
    if (p.fix.kind === 'spawn') {
      const m = e.state().mario;
      if (!m) return;
      this.world.setSettings({ spawn: { x: m.x, y: m.y + 50, z: m.z, yaw: m.yaw & 0xffff } }, 'Moved the start point');
    } else if (p.uid) {
      const rec = (e.patch.areas?.[e.areaKey()]?.objects || []).find((r) => r.uid === p.uid);
      if (!rec) return;
      rec.y = p.fix.y;
      const o = e.objects().find((x) => x.uid === p.uid);
      if (o) e.moveSlot(o.slot, rec.x, rec.y, rec.z, rec.yaw | 0);
      this.send({ type: 'edit', op: { type: 'update', key: e.areaKey(), uid: p.uid, fields: { y: rec.y }, summary: `Moved ${rec.star?.name ? `star “${rec.star.name}”` : rec.name || 'an object'} ${p.fix.kind === 'lower' ? 'down' : 'up'}` } });
    }
    this.toast('Fixed', 'check');
    setTimeout(() => this.render(), 200);
  }

  // ---- for Claude ------------------------------------------------------------------------------

  rpc() {
    const self = this;
    registerRpc('validate', () => {
      const r = self.runCheck();
      return { here: r.here, counts: r.counts, problems: r.problems.map((p) => ({ severity: p.severity, level: p.level, key: p.key, title: p.title, detail: p.detail, at: p.pos?.map(Math.round), uid: p.uid })) };
    });
    registerRpc('play_from_here', async (a = {}) => {
      const at = a.x !== undefined && a.z !== undefined ? [a.x, a.y ?? 20000, a.z] : null;
      const r = await self.playFromHere(false, at);
      if (!r) throw new Error('no ground to stand on there');
      return r;
    });
    registerRpc('debug_view', (a = {}) => {
      for (const k of ['collision', 'hitboxes', 'info', 'fps', 'timer']) if (typeof a[k] === 'boolean') self.opts[k] = a[k];
      self.applyOpts();
      self.render();
      return { ...self.opts };
    });
    registerRpc('save_file', (a = {}) => {
      if (a.reset) self.resetSave();
      if (Number.isFinite(a.stars)) self.giveStars(a.stars);
      for (const name of a.set_flags || []) { const f = self.names.flags?.[name]; if (f) self.M._studio_save_set_flags(f, 0); }
      for (const name of a.clear_flags || []) { const f = self.names.flags?.[name]; if (f) self.M._studio_save_set_flags(0, f); }
      self.render();
      const sf = self.saveFile();
      return { total_stars: sf.total, flags: Object.entries(self.names.flags || {}).filter(([, v]) => sf.flags & v).map(([k]) => k), stars_per_course: Object.fromEntries(COURSES.map((n, i) => [n, sf.stars[i].toString(2).split('').filter((x) => x === '1').length])) };
    });
  }
}
