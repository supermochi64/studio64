// The Title screen editor: the hack's launch screen with a live preview. Tabs: Logo (logo maker,
// upload, the game's logo; animation, place and size), Title (background, Press Start, music),
// Splash screens, File select. Every change is saved as one undoable edit (title/index.js).
import { icon } from '../icons.js';
import { askConfirm } from '../dialogs.js';
import { GAME_SONGS } from '../music.js';
import { normalizeTitle, clone, LOGO_ANIMS, BG_KINDS, FONTS, WEB_FONTS, EMBLEMS, FILLS, PRESETS, MAKER_DEFAULT, normalizeMaker, makerHash } from './schema.js';
import { drawStage, loadImage, TitleScreen } from './title_screen.js';
import { renderLogo, linkFonts, fontReady } from './logo_maker.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const TABS = [['logo', 'Logo', 'star'], ['title', 'Title', 'image'], ['splash', 'Splash screens', 'film'], ['files', 'File select', 'folder']];
const SUMMARY = { logo: 'Changed the title screen logo', title: 'Changed the title screen', splash: 'Changed the splash screens', files: 'Changed the file select screen' };

export class TitleUI {
  constructor({ ctl, state }) {
    this.ctl = ctl;
    this.S = state;
    this.tab = 'logo';
    this.splashSel = 0;
    this.t = clone(ctl.title);
    this.dirty = false;
    this.t0 = performance.now();
    this.screen = new TitleScreen({ host: document.body, headers: () => ({ 'x-studio-key': this.S()?.password || '' }), base: () => `/api/projects/${encodeURIComponent(this.S()?.projectId)}/assets/` });
    this.build();
    // a reload or a closed tab within the save delay must not lose the last edit
    window.addEventListener('pagehide', () => { if (this.dirty || this.busy) { clearTimeout(this.saveTimer); this.dirty = false; this.ctl.saveOnLeave(clone(this.t), this.pendingSummary || 'Changed the title screen'); } });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && this.dirty) this.flush(); });
    ctl.on((why) => {
      if (why === 'saved') return;
      // another tab, an undo or the AI: take it unless we are in the middle of an edit
      if (!this.dirty) { this.t = clone(ctl.title); if (this.isOpen()) { this.loadImages(); this.render(); } }
    });
  }

  isOpen() { return !this.root.hidden; }

  build() {
    const root = h('div', 'title-studio');
    root.id = 'title-studio';
    root.hidden = true;
    root.innerHTML = `<div class="ttl-window">
      <div class="ttl-head">
        <div class="ttl-title">${icon('star')}<span>Title screen</span></div>
        <div class="ttl-tabs" role="tablist">${TABS.map(([id, label, ic]) => `<button class="ttl-tab" role="tab" data-tab="${id}">${icon(ic, 'sm')}<span>${label}</span></button>`).join('')}</div>
        <div class="ttl-spacer"></div>
        <span class="ttl-status" aria-live="polite"></span>
        <label class="ttl-switch" title="Players see this launch screen when the hack starts"><input type="checkbox" data-k="on"><span class="ttl-knob"></span><span class="ttl-switch-label">Use it</span></label>
        <button class="btn sm" data-act="preview" title="Plays the launch screen in the game, then brings you back">${icon('play', 'sm')}Preview in the game</button>
        <button class="btn icon ghost" data-act="close" title="Close (Esc)">${icon('x')}</button>
      </div>
      <div class="ttl-body">
        <section class="ttl-stage">
          <div class="ttl-preview"><canvas></canvas><div class="ttl-hint"></div></div>
          <div class="ttl-strip"></div>
        </section>
        <aside class="ttl-side"></aside>
      </div>
    </div>`;
    document.body.appendChild(root);
    this.root = root;
    this.canvas = root.querySelector('.ttl-preview canvas');
    root.querySelectorAll('.ttl-tab').forEach((b) => { b.onclick = () => { this.tab = b.dataset.tab; this.t0 = performance.now(); this.render(); }; });
    root.querySelector('[data-act=close]').onclick = () => this.close();
    root.querySelector('[data-act=preview]').onclick = () => this.tryInGame();
    root.querySelector('[data-k=on]').onchange = (e) => this.edit((t) => { t.on = e.target.checked; }, e.target.checked ? 'Turned the title screen on' : 'Turned the title screen off', { now: true });
    root.addEventListener('keydown', (e) => {
      e.stopPropagation();
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
      if (e.key === 'Escape' && !typing) { e.preventDefault(); this.close(); }
      if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyZ' || e.code === 'KeyY') && !typing && window.studio64Undo) {
        e.preventDefault();
        this.flush();
        if (e.code === 'KeyY' || e.shiftKey) window.studio64Undo.redoEdit(); else window.studio64Undo.undoHere();
      }
    });
    this.wirePreview();
    // another workspace (rail, level chip) takes the stage
    document.addEventListener('click', (e) => { if (this.isOpen() && e.target.closest?.('.rail, #level-chip, #story-btn, #sound-btn')) this.close(); }, true);
  }

  open(tab) {
    if (tab) this.tab = tab;
    linkFonts(WEB_FONTS);
    if (!this.dirty) this.t = clone(this.ctl.title);
    this.root.hidden = false;
    this.S()?.engine?.releaseKeys?.();
    this.loadImages();
    this.render();
    this.t0 = performance.now();
    cancelAnimationFrame(this.raf);
    const loop = () => { if (!this.isOpen()) return; this.draw(); this.raf = requestAnimationFrame(loop); };
    loop();
    document.fonts?.ready?.then(() => { this.liveLogo = null; this.renderPresets?.(); });
  }

  close() {
    this.flush();
    this.stopMusic();
    this.root.hidden = true;
    cancelAnimationFrame(this.raf);
    this.S()?.engine?.canvas?.focus?.();
  }

  setStatus(s) { const e = this.root.querySelector('.ttl-status'); if (e) e.textContent = s; }

  // ---- editing --------------------------------------------------------------------------------

  // Change the working copy, redraw, and save soon (typing and sliders become one edit).
  edit(fn, summary = SUMMARY[this.tab], { render = false, now = false, logo = false } = {}) {
    fn(this.t);
    this.t = normalizeTitle(this.t);
    if (logo) { this.liveLogo = null; this.makerDirty = true; }
    this.dirty = true;
    this.pendingSummary = summary;
    this.setStatus('Saving…');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), now ? 0 : 900);
    if (render) this.render();
    else this.syncHead();
    this.t0Anim ||= 0;
  }

  // Saves run one after another (a slow logo render must not overwrite a newer edit).
  flush() {
    clearTimeout(this.saveTimer);
    if (!this.dirty) return this.saveChain || Promise.resolve();
    this.saveChain = (this.saveChain || Promise.resolve()).then(() => this.saveNow());
    return this.saveChain;
  }

  async saveNow() {
    if (!this.dirty) return;
    this.dirty = false;
    this.busy = true;
    const t = clone(this.t);
    const summary = this.pendingSummary || 'Changed the title screen';
    try {
      const saved = await this.ctl.save(t, summary);
      // keep what was changed meanwhile; take the files the save made
      if (!this.dirty) this.t = clone(saved);
      else {
        if (makerHash(this.t.logo.maker) === saved.logo.made) { this.t.logo.file = saved.logo.file; this.t.logo.made = saved.logo.made; this.t.logo.w = saved.logo.w; this.t.logo.h = saved.logo.h; }
        this.t.cover = saved.cover;
      }
      this.makerDirty = this.dirty && makerHash(this.t.logo.maker) !== this.t.logo.made;
      await this.loadImages();
      if (!this.dirty) this.setStatus('Saved');
    } catch (err) {
      this.setStatus('Not saved');
      this.S()?.toast?.(err.message, 'x');
    } finally {
      this.busy = false;
    }
  }

  async loadImages() {
    const t = this.t;
    this.imgs = await this.screen.load(t, { levelPicture: (k) => this.ctl.levelPicture(k) });
  }

  // ---- the preview ---------------------------------------------------------------------------------

  stageNow() {
    if (this.tab === 'splash') return this.t.splashes.length ? { kind: 'splash', index: Math.min(this.splashSel, this.t.splashes.length - 1) } : { kind: 'black' };
    if (this.tab === 'files') return { kind: 'files' };
    return { kind: 'title' };
  }

  draw() {
    const c = this.canvas;
    const box = c.parentElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(2, Math.round(box.clientWidth * dpr)), H = Math.max(2, Math.round(box.clientHeight * dpr));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d');
    const t = this.t;
    const imgs = { ...(this.imgs || { splash: {} }) };
    if (t.logo.kind === 'maker') {
      const hash = makerHash(t.logo.maker);
      // the saved picture when it shows these settings, else a quick render
      if (!(imgs.logo && t.logo.made === hash && !this.makerDirty)) {
        if (!this.liveLogo || this.liveHash !== hash) { this.liveLogo = renderLogo(t.logo.maker, { scale: 0.4 }); this.liveHash = hash; }
        imgs.logo = this.liveLogo;
      }
    }
    const st = this.stageNow();
    let time = (performance.now() - this.t0) / 1000;
    if (st.kind === 'splash') { const s = t.splashes[st.index]; time %= (s.seconds + 0.6); }
    else if (st.kind === 'title') time %= 9; // the animation again every few seconds
    this.rects = drawStage(g, t, W, H, imgs, { ...st, t: time, ready: true, canContinue: true, stars: this.ctl.stars?.() || 0, name: this.S()?.project?.name || document.querySelector('#project-name')?.value || 'My hack', sel: this.fileSel || 0 }, { live: false });
    if (st.kind === 'title' && (t.bg.kind === 'game' || t.bg.kind === 'level')) {
      const hint = this.root.querySelector('.ttl-hint');
      hint.textContent = t.bg.kind === 'game' ? 'In the game: Mario\'s face, live (Preview in the game)' : 'In the game: a camera flies around the level';
      hint.hidden = false;
    } else this.root.querySelector('.ttl-hint').hidden = true;
  }

  wirePreview() {
    const c = this.canvas;
    let drag = false;
    const at = (ev) => { const r = c.getBoundingClientRect(); return [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height]; };
    const canMove = () => (this.tab === 'logo' || this.tab === 'title') && (this.t.logo.kind === 'maker' || this.t.logo.kind === 'image' || this.t.logo.kind === 'game');
    c.addEventListener('mousedown', (ev) => {
      if (!canMove() || ev.button !== 0) return;
      drag = true;
      const [x, y] = at(ev);
      this.edit((t) => { t.logo.x = x; t.logo.y = y; }, 'Moved the title screen logo');
      this.t0 = performance.now() - 3000; // show it still, not mid-animation
    });
    window.addEventListener('mousemove', (ev) => {
      if (!drag) return;
      const [x, y] = at(ev);
      this.edit((t) => { t.logo.x = Math.max(0, Math.min(1, x)); t.logo.y = Math.max(0, Math.min(1, y)); }, 'Moved the title screen logo');
      this.t0 = performance.now() - 3000;
    });
    window.addEventListener('mouseup', () => { if (drag) { drag = false; this.render(); } });
    c.addEventListener('wheel', (ev) => {
      if (!canMove()) return;
      ev.preventDefault();
      this.edit((t) => { t.logo.scale = Math.max(0.1, Math.min(1.2, t.logo.scale * (ev.deltaY < 0 ? 1.06 : 1 / 1.06))); }, 'Resized the title screen logo');
      this.t0 = performance.now() - 3000;
      clearTimeout(this.wheelRender);
      this.wheelRender = setTimeout(() => this.render(), 300);
    }, { passive: false });
    c.addEventListener('click', (ev) => {
      if (this.tab !== 'files') return;
      const r = c.getBoundingClientRect();
      const x = (ev.clientX - r.left) * (c.width / r.width), y = (ev.clientY - r.top) * (c.height / r.height);
      const i = (this.rects || []).findIndex((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
      if (i >= 0) this.fileSel = i;
    });
  }

  async tryInGame() {
    await this.flush();
    this.close();
    try { await this.ctl.preview(); } catch (err) { this.S()?.toast?.(err.message, 'x'); }
    this.open();
  }

  // ---- the controls ---------------------------------------------------------------------------------

  syncHead() {
    const r = this.root;
    r.querySelectorAll('.ttl-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === this.tab));
    r.querySelector('[data-k=on]').checked = this.t.on;
    r.classList.toggle('is-off', !this.t.on);
    this.renderStrip();
  }

  renderStrip() {
    const s = this.root.querySelector('.ttl-strip');
    const t = this.t;
    const chips = [];
    t.splashes.forEach((sp, i) => chips.push({ tab: 'splash', i, label: sp.kind === 'studio' ? 'Made with Studio 64' : sp.text || (sp.kind === 'image' ? 'Picture' : 'Text'), sub: `${sp.seconds}s` }));
    chips.push({ tab: 'title', label: 'Title', sub: 'Press Start' });
    if (t.files.on) chips.push({ tab: 'files', label: 'File select', sub: '' });
    chips.push({ tab: null, label: 'The game starts', sub: '' });
    s.innerHTML = `<span class="ttl-strip-label">${t.on ? 'Players see' : 'Off · players would see'}</span>` + chips.map((c, k) => `${k ? '<span class="ttl-arrow">›</span>' : ''}<button class="ttl-chip${c.tab === this.tab && (c.tab !== 'splash' || c.i === this.splashSel) ? ' active' : ''}${c.tab ? '' : ' end'}" ${c.tab ? `data-tab="${c.tab}" data-i="${c.i ?? ''}"` : 'disabled'}><b>${esc(c.label)}</b>${c.sub ? `<span>${esc(c.sub)}</span>` : ''}</button>`).join('');
    s.querySelectorAll('.ttl-chip[data-tab]').forEach((b) => {
      b.onclick = () => {
        this.tab = b.dataset.tab === 'title' && this.tab === 'logo' ? 'logo' : b.dataset.tab;
        if (b.dataset.i !== '') this.splashSel = Number(b.dataset.i);
        this.t0 = performance.now();
        this.render();
      };
    });
  }

  render() {
    if (!this.isOpen()) return;
    this.syncHead();
    const side = this.root.querySelector('.ttl-side');
    const scroll = side.scrollTop;
    side.innerHTML = '';
    ({ logo: () => this.renderLogo(side), title: () => this.renderTitle(side), splash: () => this.renderSplash(side), files: () => this.renderFiles(side) })[this.tab]();
    side.scrollTop = scroll;
    side.querySelectorAll('input, textarea, select').forEach((x) => x.addEventListener('keydown', (e) => e.stopPropagation()));
  }

  // small builders
  sec(parent, title, note = '') {
    const s = h('div', 'ttl-sec');
    s.innerHTML = `<div class="ttl-sec-h">${esc(title)}</div>${note ? `<div class="ttl-note">${note}</div>` : ''}`;
    parent.appendChild(s);
    return s;
  }
  row(parent, label, el, cls = '') {
    const r = h('label', `ttl-row ${cls}`);
    r.innerHTML = `<span>${esc(label)}</span>`;
    r.appendChild(el);
    parent.appendChild(r);
    return r;
  }
  text(value, on, { placeholder = '', max = 40 } = {}) {
    const i = h('input');
    i.type = 'text'; i.value = value || ''; i.placeholder = placeholder; i.maxLength = max;
    i.oninput = () => on(i.value);
    return i;
  }
  color(value, on) {
    const i = h('input');
    i.type = 'color'; i.value = value;
    i.oninput = () => on(i.value);
    return i;
  }
  range(value, min, max, step, on, fmt = (v) => v) {
    const w = h('div', 'ttl-range');
    w.innerHTML = `<input type="range" min="${min}" max="${max}" step="${step}" value="${value}"><output>${fmt(value)}</output>`;
    const i = w.querySelector('input'), o = w.querySelector('output');
    i.oninput = () => { o.textContent = fmt(Number(i.value)); on(Number(i.value)); };
    return w;
  }
  select(options, value, on) {
    const s = h('select');
    s.innerHTML = options.map((o) => (o.group ? `<optgroup label="${esc(o.group)}">${o.items.map((x) => `<option value="${esc(x[0])}" ${String(x[0]) === String(value) ? 'selected' : ''}>${esc(x[1])}</option>`).join('')}</optgroup>` : `<option value="${esc(o[0])}" ${String(o[0]) === String(value) ? 'selected' : ''}>${esc(o[1])}</option>`)).join('');
    s.onchange = () => on(s.value);
    return s;
  }
  check(label, value, on) {
    const l = h('label', 'ttl-check');
    l.innerHTML = `<input type="checkbox" ${value ? 'checked' : ''}><span>${esc(label)}</span>`;
    l.querySelector('input').onchange = (e) => on(e.target.checked);
    return l;
  }
  seg(options, value, on, cls = '') {
    const s = h('div', `ttl-seg ${cls}`);
    s.setAttribute('role', 'radiogroup');
    for (const [id, label, about] of options) {
      const b = h('button', `ttl-seg-btn${id === value ? ' active' : ''}`, esc(label));
      b.type = 'button';
      if (about) b.title = about;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', id === value ? 'true' : 'false');
      b.onclick = () => on(id);
      s.appendChild(b);
    }
    return s;
  }
  // A picture drop zone: click or drop a file.
  dropZone(label, file, onFile) {
    const z = h('div', 'ttl-drop');
    z.tabIndex = 0;
    z.innerHTML = `${file ? `<img alt="">` : icon('upload')}<div><b>${esc(label)}</b><span>${file ? 'Click or drop to replace' : 'PNG (see-through works), SVG, JPG or WebP · click or drop'}</span></div><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" hidden>`;
    const input = z.querySelector('input');
    if (file) { const img = z.querySelector('img'); loadImage(this.ctl.url(file), { 'x-studio-key': this.S()?.password || '' }).then((i) => { if (i) img.src = i.src; }); }
    const take = async (f) => {
      if (!f) return;
      z.classList.add('busy');
      try { await onFile(await this.ctl.uploadPicture(f)); } catch (err) { this.S()?.toast?.(err.message, 'x'); }
      z.classList.remove('busy');
    };
    z.onclick = () => input.click();
    z.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
    input.onchange = () => take(input.files[0]);
    z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('over'); });
    z.addEventListener('dragleave', () => z.classList.remove('over'));
    z.addEventListener('drop', (e) => { e.preventDefault(); z.classList.remove('over'); take(e.dataTransfer.files[0]); });
    return z;
  }

  // ---- Logo ------------------------------------------------------------------------------------

  renderLogo(side) {
    const t = this.t, L = t.logo;
    const s0 = this.sec(side, 'Logo', 'Shown in place of the game\'s “SUPER MARIO 64” logo. Drag it in the preview to move it, scroll to resize.');
    s0.appendChild(this.seg([['maker', 'Logo maker', 'Text with a font, colours, outline and 3D'], ['image', 'Upload', 'Your own picture'], ['game', 'Game\'s logo', 'The original 3D logo (with the game\'s title background)'], ['none', 'None', 'No logo']], L.kind, (k) => this.edit((x) => {
      x.logo.kind = k;
      if (k === 'game') { x.bg.kind = 'game'; }
    }, 'Changed the title screen logo', { render: true, logo: k === 'maker' })));
    if (L.kind === 'image') {
      s0.appendChild(this.dropZone('Your logo', L.file, ({ file, w, h: hh }) => this.edit((x) => { x.logo.file = file; x.logo.made = null; x.logo.w = w; x.logo.h = hh; }, 'Uploaded a title screen logo', { render: true, now: true })));
    }
    if (L.kind === 'game') s0.appendChild(h('div', 'ttl-note', 'The game\'s 3D logo zooms in over its own title background, then Mario\'s face appears. Your Press Start text and music still apply.'));
    if (L.kind === 'maker') this.renderMaker(side);
    if (L.kind !== 'none') {
      const s = this.sec(side, 'Animation');
      s.appendChild(this.seg(LOGO_ANIMS, L.anim, (a) => { this.t0 = performance.now(); this.edit((x) => { x.logo.anim = a; }, 'Changed the logo animation', { render: true }); }, 'wrap'));
      const p = this.sec(side, 'Place and size');
      this.row(p, 'Size', this.range(Math.round(L.scale * 100), 10, 120, 1, (v) => { this.t0 = performance.now() - 3000; this.edit((x) => { x.logo.scale = v / 100; }, 'Resized the title screen logo'); }, (v) => `${v}%`));
      this.row(p, 'Left · right', this.range(Math.round(L.x * 100), 0, 100, 1, (v) => { this.t0 = performance.now() - 3000; this.edit((x) => { x.logo.x = v / 100; }, 'Moved the title screen logo'); }, (v) => `${v}%`));
      this.row(p, 'Up · down', this.range(Math.round(L.y * 100), 0, 100, 1, (v) => { this.t0 = performance.now() - 3000; this.edit((x) => { x.logo.y = v / 100; }, 'Moved the title screen logo'); }, (v) => `${v}%`));
      const b = h('div', 'ttl-btns');
      const center = h('button', 'btn sm', 'Centre it');
      center.onclick = () => this.edit((x) => { x.logo.x = 0.5; x.logo.y = 0.34; x.logo.scale = 0.62; }, 'Moved the title screen logo', { render: true });
      const replay = h('button', 'btn sm', `${icon('play', 'sm')}Replay`);
      replay.onclick = () => { this.t0 = performance.now(); };
      b.append(center, replay);
      p.appendChild(b);
    }
  }

  renderMaker(side) {
    const m = this.t.logo.maker;
    const set = (fn, summary = 'Changed the logo') => this.edit((x) => { fn(x.logo.maker); }, summary, { logo: true });
    const setR = (fn, summary) => { set(fn, summary); this.render(); };
    const pre = this.sec(side, 'Style', 'Pick a look, then change anything below.');
    const grid = h('div', 'ttl-presets');
    pre.appendChild(grid);
    this.renderPresets = () => {
      grid.innerHTML = '';
      for (const p of PRESETS) {
        const b = h('button', 'ttl-preset');
        b.type = 'button';
        b.title = p.name;
        const spec = normalizeMaker({ ...MAKER_DEFAULT, ...p.maker, text: m.text || 'LOGO', sub: m.sub });
        b.innerHTML = `<span class="pic"></span><span class="nm">${esc(p.name)}</span>`;
        fontReady(spec).then(() => { try { const c = renderLogo(spec, { scale: 0.12 }); c.className = 'ttl-preset-c'; b.querySelector('.pic').appendChild(c); } catch { /* no font yet */ } });
        b.onclick = () => setR((mm) => { const keep = { text: mm.text, sub: mm.sub }; Object.assign(mm, normalizeMaker({ ...MAKER_DEFAULT, ...p.maker, ...keep })); }, `Logo style: ${p.name}`);
        grid.appendChild(b);
      }
    };
    this.renderPresets();

    const tx = this.sec(side, 'Text');
    this.row(tx, 'Main line', this.text(m.text, (v) => set((mm) => { mm.text = v; }), { placeholder: 'SUPER MARIO', max: 40 }));
    this.row(tx, 'Second line', this.text(m.sub, (v) => set((mm) => { mm.sub = v; }), { placeholder: '64', max: 24 }));
    const fontSel = this.select(FONTS, m.font, (v) => setR((mm) => { mm.font = v; }, 'Changed the logo font'));
    for (const o of fontSel.options) o.style.fontFamily = `"${o.value}"`;
    this.row(tx, 'Font', fontSel);
    this.row(tx, 'Second line size', this.range(Math.round(m.sub2.scale * 100), 40, 200, 5, (v) => set((mm) => { mm.sub2.scale = v / 100; }), (v) => `${v}%`));
    this.row(tx, 'Arc', this.range(m.arc, -40, 40, 1, (v) => set((mm) => { mm.arc = v; }), (v) => `${v}°`));
    this.row(tx, 'Tilt', this.range(m.tilt, -20, 20, 1, (v) => set((mm) => { mm.tilt = v; }), (v) => `${v}°`));
    this.row(tx, 'Letter spacing', this.range(m.spacing, -10, 30, 1, (v) => set((mm) => { mm.spacing = v; })));

    const col = this.sec(side, 'Colours');
    col.appendChild(this.seg(FILLS, m.fill, (v) => setR((mm) => { mm.fill = v; }, 'Changed the logo colours')));
    const sw = h('div', 'ttl-swatches');
    if (m.fill === 'letters') {
      m.colors.forEach((c, i) => sw.appendChild(this.color(c, (v) => set((mm) => { mm.colors[i] = v; }))));
      if (m.colors.length < 8) { const add = h('button', 'btn sm icon ghost', icon('plus', 'sm')); add.title = 'Add a colour'; add.onclick = () => setR((mm) => { mm.colors.push('#ffffff'); }); sw.appendChild(add); }
      if (m.colors.length > 1) { const rm = h('button', 'btn sm icon ghost', icon('trash', 'sm')); rm.title = 'Remove the last colour'; rm.onclick = () => setR((mm) => { mm.colors.pop(); }); sw.appendChild(rm); }
    } else {
      sw.appendChild(this.color(m.c1, (v) => set((mm) => { mm.c1 = v; })));
      if (m.fill === 'gradient') sw.appendChild(this.color(m.c2, (v) => set((mm) => { mm.c2 = v; })));
    }
    this.row(col, m.fill === 'letters' ? 'Letters (in turn)' : m.fill === 'gradient' ? 'Top · bottom' : 'Colour', sw);
    const sub = h('div', 'ttl-swatches');
    sub.append(this.color(m.sub2.color, (v) => set((mm) => { mm.sub2.color = v; })), this.color(m.sub2.c2, (v) => set((mm) => { mm.sub2.c2 = v; })));
    this.row(col, 'Second line', sub);
    this.row(col, 'Shine', this.check('A light top half', m.shine, (v) => set((mm) => { mm.shine = v; })));

    const look = this.sec(side, 'Outline and 3D');
    const ol = h('div', 'ttl-swatches');
    ol.appendChild(this.color(m.outline, (v) => set((mm) => { mm.outline = v; })));
    this.row(look, 'Outline colour', ol);
    this.row(look, 'Outline', this.range(m.outlineW, 0, 30, 1, (v) => set((mm) => { mm.outlineW = v; })));
    const ex = h('div', 'ttl-swatches');
    ex.appendChild(this.color(m.extrudeColor, (v) => set((mm) => { mm.extrudeColor = v; })));
    this.row(look, '3D colour', ex);
    this.row(look, '3D depth', this.range(m.extrude, 0, 40, 1, (v) => set((mm) => { mm.extrude = v; })));
    this.row(look, '3D direction', this.range(m.angle, 0, 360, 5, (v) => set((mm) => { mm.angle = v; }), (v) => `${v}°`));
    this.row(look, 'Shadow', this.range(Math.round(m.shadow * 100), 0, 100, 5, (v) => set((mm) => { mm.shadow = v / 100; }), (v) => `${v}%`));

    const em = this.sec(side, 'Emblem');
    this.row(em, 'Shape', this.select(EMBLEMS, m.emblem, (v) => setR((mm) => { mm.emblem = v; }, 'Changed the logo emblem')));
    if (m.emblem !== 'none') {
      const ec = h('div', 'ttl-swatches');
      ec.appendChild(this.color(m.emblemColor, (v) => set((mm) => { mm.emblemColor = v; })));
      this.row(em, 'Colour', ec);
      this.row(em, 'Where', this.seg([['left', 'Left'], ['top', 'Top'], ['right', 'Right'], ['behind', 'Behind']], m.emblemPos, (v) => setR((mm) => { mm.emblemPos = v; })));
    }
  }

  // ---- Title -----------------------------------------------------------------------------------

  renderTitle(side) {
    const t = this.t, B = t.bg;
    const setR = (fn, summary = 'Changed the title screen background') => this.edit(fn, summary, { render: true });
    const bg = this.sec(side, 'Background');
    const cards = h('div', 'ttl-bgcards');
    for (const [id, label, about] of BG_KINDS) {
      const b = h('button', `ttl-bgcard k-${id}${B.kind === id ? ' active' : ''}`, `<span class="sw"></span><b>${esc(label)}</b><span>${esc(about)}</span>`);
      b.type = 'button';
      b.onclick = () => setR((x) => { x.bg.kind = id; if (id !== 'game' && x.logo.kind === 'game') x.logo.kind = 'maker'; });
      cards.appendChild(b);
    }
    bg.appendChild(cards);
    if (B.kind === 'game') {
      this.row(bg, 'Backdrop', this.seg([['auto', 'Automatic', 'Your logo when you have one, else the game\'s'], ['logo', 'Your logo'], ['plain', 'Colours'], ['game', 'The game\'s', 'The original SUPER MARIO 64 tiles']], B.tiles, (v) => setR((x) => { x.bg.tiles = v; }, 'Changed the title backdrop'), 'wrap'));
      if (B.tiles === 'logo' || B.tiles === 'plain' || (B.tiles === 'auto' && (t.logo.kind === 'maker' || t.logo.kind === 'image'))) {
        const sw = h('div', 'ttl-swatches');
        sw.append(this.color(B.color, (v) => this.edit((x) => { x.bg.color = v; })), this.color(B.color2, (v) => this.edit((x) => { x.bg.color2 = v; })));
        this.row(bg, 'Tile colours', sw);
      }
      bg.appendChild(this.check('Mario\'s face (the game\'s Goddard head, players can pull it)', B.head, (v) => setR((x) => { x.bg.head = v; }, v ? 'Mario\'s face on the title screen' : 'No Mario face on the title screen')));
    }
    if (B.kind === 'level') {
      const st = this.S();
      const custom = (st?.levels || []).map((l) => [`c:${l.id}`, l.name]);
      const originals = Object.values(st?.catalog?.levels || {}).filter((l) => l.num).sort((a, b) => a.name.localeCompare(b.name)).map((l) => [`${l.num}:1`, l.name]);
      const opts = [];
      if (custom.length) opts.push({ group: 'Your levels', items: custom });
      opts.push({ group: 'The game\'s levels', items: originals });
      this.row(bg, 'Level', this.select(opts, B.level, (v) => setR((x) => { x.bg.level = v; x.bg.orbit.center = null; })));
      this.row(bg, 'Camera speed', this.range(B.orbit.speed, -4, 4, 0.25, (v) => this.edit((x) => { x.bg.orbit.speed = v; })));
      this.row(bg, 'Distance', this.range(B.orbit.radius, 300, 12000, 100, (v) => this.edit((x) => { x.bg.orbit.radius = v; })));
      this.row(bg, 'Height', this.range(B.orbit.height, -2000, 6000, 100, (v) => this.edit((x) => { x.bg.orbit.height = v; })));
      const b = h('div', 'ttl-btns');
      const here = h('button', 'btn sm', `${icon('crosshair', 'sm')}Circle around what the camera sees`);
      here.title = 'Uses the current level and camera: the fly-over circles the spot the camera looks at';
      here.onclick = () => {
        const e = st.engine;
        let cam = null;
        try { cam = e.camOut(); } catch { /* none */ }
        if (!cam) return;
        const key = e.areaKey();
        const d = Math.hypot(cam.pos[0] - cam.focus[0], cam.pos[2] - cam.focus[2]);
        setR((x) => { x.bg.level = key; x.bg.orbit.center = cam.focus.map((n) => Math.round(n)); x.bg.orbit.radius = Math.max(300, Math.round(d)); x.bg.orbit.height = Math.round(cam.pos[1] - cam.focus[1]); }, 'Picked the title screen fly-over');
      };
      const reset = h('button', 'btn sm ghost', 'Around Mario\'s start');
      reset.onclick = () => setR((x) => { x.bg.orbit.center = null; });
      b.append(here, reset);
      bg.appendChild(b);
      bg.appendChild(h('div', 'ttl-note', B.orbit.center ? `Circles the spot ${B.orbit.center.join(', ')}.` : 'Circles where Mario starts in that level. Mario and the HUD are hidden while it plays.'));
    }
    if (B.kind === 'color' || B.kind === 'image') this.row(bg, B.kind === 'image' ? 'Behind the picture' : 'Colour', this.color(B.color, (v) => this.edit((x) => { x.bg.color = v; })));
    if (B.kind === 'gradient') {
      const sw = h('div', 'ttl-swatches');
      sw.append(this.color(B.color, (v) => this.edit((x) => { x.bg.color = v; })), this.color(B.color2, (v) => this.edit((x) => { x.bg.color2 = v; })));
      this.row(bg, 'Colours', sw);
      this.row(bg, 'Direction', this.range(B.angle, 0, 360, 15, (v) => this.edit((x) => { x.bg.angle = v; }), (v) => `${v}°`));
    }
    if (B.kind === 'image') bg.appendChild(this.dropZone('Background picture', B.file, ({ file }) => setR((x) => { x.bg.file = file; }, 'Uploaded a title screen background')));
    if (B.kind === 'image' || B.kind === 'level' || B.kind === 'game') this.row(bg, 'Darken', this.range(Math.round(B.dim * 100), 0, 90, 5, (v) => this.edit((x) => { x.bg.dim = v / 100; }), (v) => `${v}%`));

    const P = t.press;
    const ps = this.sec(side, 'Press Start');
    this.row(ps, 'Text', this.text(P.text, (v) => this.edit((x) => { x.press.text = v; }, 'Changed the Press Start text'), { placeholder: 'PRESS START' }));
    this.row(ps, 'Font', this.seg([['game', 'The game\'s'], ['sans', 'Bold'], ['serif', 'Serif']], P.font, (v) => this.edit((x) => { x.press.font = v; }, 'Changed the Press Start text', { render: true })));
    const sw = h('div', 'ttl-swatches');
    sw.append(this.color(P.color, (v) => this.edit((x) => { x.press.color = v; })), this.color(P.outline, (v) => this.edit((x) => { x.press.outline = v; })));
    this.row(ps, 'Colour · outline', sw);
    this.row(ps, 'Size', this.range(Math.round(P.size * 100), 40, 300, 10, (v) => this.edit((x) => { x.press.size = v / 100; }), (v) => `${v}%`));
    this.row(ps, 'Up · down', this.range(Math.round(P.y * 100), 5, 98, 1, (v) => this.edit((x) => { x.press.y = v / 100; }), (v) => `${v}%`));
    ps.appendChild(this.check('Blinks', P.blink, (v) => this.edit((x) => { x.press.blink = v; })));

    const M = t.music;
    const mu = this.sec(side, 'Music');
    const songs = (this.S()?.audio?.songs || []).map((s) => [`song:${s.id}`, s.name || 'Song']);
    const groups = {};
    for (const g of GAME_SONGS) (groups[g.group] ||= []).push([`seq:${g.seq}`, g.name]);
    const opts = [['none', 'No music']];
    if (songs.length) opts.push({ group: 'Your songs (Sound studio)', items: songs });
    for (const [g, items] of Object.entries(groups)) opts.push({ group: `The game: ${g}`, items });
    const cur = M.kind === 'none' ? 'none' : M.kind === 'song' ? `song:${M.song}` : `seq:${M.seq}`;
    const sel = this.select(opts, cur, (v) => this.edit((x) => {
      if (v === 'none') x.music.kind = 'none';
      else if (v.startsWith('song:')) { x.music.kind = 'song'; x.music.song = v.slice(5); }
      else { x.music.kind = 'game'; x.music.seq = Number(v.slice(4)); }
    }, 'Changed the title screen music'));
    const r = this.row(mu, 'Song', sel);
    const play = h('button', 'btn sm icon', icon(this.musicOn ? 'stop' : 'play', 'sm'));
    play.title = 'Listen';
    play.type = 'button';
    play.onclick = (e) => { e.preventDefault(); if (this.musicOn) this.stopMusic(); else this.playMusic(); play.innerHTML = icon(this.musicOn ? 'stop' : 'play', 'sm'); };
    r.appendChild(play);
  }

  async playMusic() {
    const e = this.S()?.engine;
    if (!e?.ready) return;
    e.audioHold(true);
    const { TitleStage } = await import('./title_screen.js');
    new TitleStage({ engine: e, songs: () => this.S()?.audio?.songs || [] }).music(this.t, false);
    this.musicOn = true;
  }
  stopMusic() {
    if (!this.musicOn) return;
    const e = this.S()?.engine;
    try { e.stopPreview(); e.restoreMusic(); e.audioHold(false); } catch { /* loading */ }
    this.musicOn = false;
  }

  // ---- Splash screens -------------------------------------------------------------------------------

  renderSplash(side) {
    const t = this.t;
    const s = this.sec(side, 'Splash screens', 'Short screens before the title, like the Nintendo logo: who made it, your studio\'s logo. Players can click to skip them.');
    const add = h('div', 'ttl-btns');
    for (const [kind, label] of [['studio', 'Made with Studio 64'], ['text', 'Text'], ['image', 'Picture']]) {
      const b = h('button', 'btn sm', `${icon('plus', 'sm')}${label}`);
      b.disabled = t.splashes.length >= 6;
      b.onclick = () => {
        const author = document.querySelector('#project-name')?.value || '';
        this.edit((x) => { x.splashes.push({ kind, text: kind === 'text' ? (author ? `${author}` : 'A hack by me') : '', sub: kind === 'text' ? 'presents' : '', bg: '#000000', color: '#ffffff', seconds: kind === 'studio' ? 2 : 2.5 }); }, 'Added a splash screen', { render: true, now: true });
        this.splashSel = this.t.splashes.length - 1;
        this.t0 = performance.now();
      };
      add.appendChild(b);
    }
    s.appendChild(add);
    if (!t.splashes.length) s.appendChild(h('div', 'ttl-empty', 'No splash screens: the title comes first.'));
    t.splashes.forEach((sp, i) => {
      const card = h('div', `ttl-card${i === this.splashSel ? ' active' : ''}`);
      card.innerHTML = `<div class="ttl-card-head"><b>${i + 1}. ${esc(sp.kind === 'studio' ? 'Made with Studio 64' : sp.kind === 'image' ? 'Picture' : 'Text')}</b><span class="ttl-spacer"></span></div>`;
      card.onclick = (e) => { if (this.splashSel !== i && !e.target.closest('input,button,select,.ttl-drop')) { this.splashSel = i; this.t0 = performance.now(); this.render(); } };
      const head = card.querySelector('.ttl-card-head');
      const mk = (ic, title, fn, dis = false) => { const b = h('button', 'btn icon ghost sm', icon(ic, 'sm')); b.title = title; b.disabled = dis; b.onclick = (e) => { e.stopPropagation(); fn(); }; head.appendChild(b); };
      mk('undo', 'Earlier', () => { this.edit((x) => { const [a] = x.splashes.splice(i, 1); x.splashes.splice(i - 1, 0, a); }, 'Moved a splash screen', { render: true }); this.splashSel = i - 1; }, i === 0);
      mk('route', 'Later', () => { this.edit((x) => { const [a] = x.splashes.splice(i, 1); x.splashes.splice(i + 1, 0, a); }, 'Moved a splash screen', { render: true }); this.splashSel = i + 1; }, i === t.splashes.length - 1);
      mk('trash', 'Delete', async () => { if (await askConfirm({ title: 'Delete this splash screen?', ok: 'Delete', danger: true })) { this.edit((x) => { x.splashes.splice(i, 1); }, 'Deleted a splash screen', { render: true, now: true }); this.splashSel = Math.max(0, i - 1); } });
      const set = (fn) => { this.splashSel = i; this.edit((x) => fn(x.splashes[i]), 'Changed a splash screen'); };
      if (sp.kind === 'text') {
        this.row(card, 'Text', this.text(sp.text, (v) => set((x) => { x.text = v; }), { max: 80 }));
        this.row(card, 'Small line', this.text(sp.sub, (v) => set((x) => { x.sub = v; }), { max: 120 }));
      }
      if (sp.kind === 'image') {
        card.appendChild(this.dropZone('Picture', sp.file, ({ file }) => { this.splashSel = i; this.edit((x) => { x.splashes[i].file = file; }, 'Changed a splash screen', { render: true, now: true }); }));
        this.row(card, 'Caption', this.text(sp.text, (v) => set((x) => { x.text = v; }), { max: 80, placeholder: 'optional' }));
      }
      const sw = h('div', 'ttl-swatches');
      sw.append(this.color(sp.bg, (v) => set((x) => { x.bg = v; })), this.color(sp.color, (v) => set((x) => { x.color = v; })));
      this.row(card, 'Background · text', sw);
      this.row(card, 'Shown for', this.range(sp.seconds, 0.5, 10, 0.5, (v) => set((x) => { x.seconds = v; }), (v) => `${v} s`));
      s.appendChild(card);
    });
  }

  // ---- File select -------------------------------------------------------------------------------

  renderFiles(side) {
    const F = this.t.files;
    const s = this.sec(side, 'File select', 'After Press Start: the save with its stars, Continue and New game.');
    s.appendChild(this.check('Show a file select', F.on, (v) => this.edit((x) => { x.files.on = v; }, v ? 'File select on' : 'File select off', { render: true })));
    if (!F.on) { s.appendChild(h('div', 'ttl-note', 'Off: Press Start goes on with the save the player has (a new player starts a new game).')); return; }
    this.row(s, 'Heading', this.text(F.heading, (v) => this.edit((x) => { x.files.heading = v; }), { placeholder: 'SELECT FILE' }));
    this.row(s, 'Small line', this.text(F.sub, (v) => this.edit((x) => { x.files.sub = v; }), { max: 80, placeholder: 'optional' }));
    s.appendChild(this.check('Show the hack\'s name', F.showName, (v) => this.edit((x) => { x.files.showName = v; })));
    const c = this.sec(side, 'Colours');
    this.row(c, 'Heading', this.color(F.color, (v) => this.edit((x) => { x.files.color = v; })));
    const sw = h('div', 'ttl-swatches');
    sw.append(this.color(F.bg, (v) => this.edit((x) => { x.files.bg = v; })), this.color(F.bg2, (v) => this.edit((x) => { x.files.bg2 = v; })));
    this.row(c, 'Background', sw);
    this.row(c, 'File card', this.color(F.card, (v) => this.edit((x) => { x.files.card = v; })));
  }
}
