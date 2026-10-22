// Studio glue for the launch screen: loads and saves project.title (server/routes/title.js),
// plays it before "Play from start", renders the logo maker's picture and the cover still,
// the Title screen editor (title_ui.js), its palette commands, and the browser side of the AI
// tool (server/tools/title.js).
import { normalizeTitle, clone, makerHash, needsEngine, titleFileUrl } from './schema.js';
import { TitleScreen, TitleStage, titleStill, loadImage } from './title_screen.js';
import { registerRpc } from '../studio.js';
import { levelPicture } from '../pictures.js';

const S = () => window.studio64;
const pid = () => S()?.projectId;
const headers = (extra = {}) => ({ 'x-studio-key': S()?.password || '', 'x-studio-client': S()?.clientId || '', ...extra });
const api = (p) => `/api/projects/${encodeURIComponent(pid())}${p}`;
const base = () => `/api/projects/${encodeURIComponent(pid())}/assets/`;

export const titleCtl = {
  title: normalizeTitle(null),
  listeners: new Set(),
  loadedFor: null,
  playing: false,

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit(why) { for (const fn of this.listeners) { try { fn(why); } catch (err) { console.error('title listener', err); } } },

  async load() {
    if (!pid()) return this.title;
    try {
      const r = await fetch(api('/title'), { headers: headers() });
      if (r.ok) { this.title = normalizeTitle(await r.json()); this.loadedFor = pid(); this.emit('load'); }
    } catch (err) { console.warn('title load', err); }
    return this.title;
  },

  // Someone (another tab, an undo, the AI) changed it.
  remote(t) { this.title = normalizeTitle(t); this.emit('remote'); },

  url(file) { return titleFileUrl(file, base()); },

  async upload(blob, ext = 'png') {
    const r = await fetch(api(`/title/file?ext=${ext}`), { method: 'POST', headers: headers({ 'content-type': blob.type || 'application/octet-stream' }), body: blob });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'upload failed');
    return j.file;
  },

  // A picture file as it should be stored: SVGs (and huge pictures) become PNGs.
  async uploadPicture(file, { max = 2048 } = {}) {
    const isSvg = /svg/.test(file.type) || /\.svg$/i.test(file.name || '');
    const url = URL.createObjectURL(file);
    const img = await loadImage(url);
    if (!img) throw new Error('That picture could not be read (PNG, JPG, WebP or SVG).');
    let w = img.naturalWidth || img.width || 1024, h = img.naturalHeight || img.height || 512;
    if (isSvg && w < max) { const k = max / w; w = max; h = Math.round(h * k); } // vectors: sharp at any size
    if (!isSvg && w <= max && h <= max && /png|jpe?g|webp/.test(file.type)) {
      const ext = /png/.test(file.type) ? 'png' : /webp/.test(file.type) ? 'webp' : 'jpg';
      return { file: await this.upload(file, ext), w, h };
    }
    const k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return { file: await this.upload(blob, 'png'), w: c.width, h: c.height };
  },

  // The logo maker's picture for these settings (rendered and uploaded when they changed).
  async ensureLogo(t) {
    if (t.logo.kind !== 'maker') return t;
    const hash = makerHash(t.logo.maker);
    if (t.logo.file && t.logo.made === hash) return t;
    const { renderLogo, fontReady, linkFonts } = await import('./logo_maker.js');
    const { WEB_FONTS } = await import('./schema.js');
    linkFonts(WEB_FONTS);
    await fontReady(t.logo.maker);
    const c = renderLogo(t.logo.maker);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    t.logo.file = await this.upload(blob, 'png');
    t.logo.made = hash;
    t.logo.w = c.width; t.logo.h = c.height;
    return t;
  },

  // The still of the title for the home card (when the project has no cover of its own).
  async makeCover(t) {
    const scr = new TitleScreen({ host: document.body, headers, base });
    scr.setTitle(t);
    const imgs = await scr.load(t, { levelPicture: (k) => this.levelPicture(k) });
    const c = titleStill(t, imgs, 960, 540);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
    return this.upload(blob, 'jpg');
  },

  levelPicture(key) {
    const st = S();
    if (!key) return null;
    if (st?.thumbs?.[key]) return st.thumbs[key];
    if (key.startsWith('c:')) return st?.thumbs?.[key.split(':').slice(0, 2).join(':')] || null;
    return levelPicture(Number(key.split(':')[0]));
  },

  // Save: the logo picture and the cover first, then one undoable edit.
  async save(next, summary = 'Changed the title screen') {
    let t = normalizeTitle(next);
    t = await this.ensureLogo(t);
    // the cover still again only when what it shows changed
    const key = JSON.stringify([t.logo.kind, t.logo.file, t.logo.x, t.logo.y, t.logo.scale, t.bg, t.press]);
    try {
      if (t.on && (key !== this.coverKey || !t.cover)) { t.cover = await this.makeCover(t); this.coverKey = key; }
    } catch (err) { console.warn('title cover', err); }
    this.title = t;
    const r = await fetch(api('/title'), { method: 'PUT', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify({ title: t, summary }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'could not save the title screen');
    this.title = normalizeTitle(await r.json());
    this.emit('saved');
    return this.title;
  },

  // The page is going away (reload, tab closed) with an edit not saved yet: send the title as it
  // is now with a keepalive request, which outlives the page (the logo picture and the cover
  // still are made on the next save; a fetch started by save() would die with the page).
  saveOnLeave(t, summary = 'Changed the title screen') {
    try {
      const body = JSON.stringify({ title: normalizeTitle(t), summary });
      if (body.length > 60000) return false; // keepalive bodies are limited to 64 KB
      fetch(api('/title'), { method: 'PUT', keepalive: true, headers: headers({ 'content-type': 'application/json' }), body }).catch(() => {});
      return true;
    } catch { return false; }
  },

  // ---- playing it -------------------------------------------------------------------------

  screen() {
    const host = document.querySelector('#game-frame') || document.body;
    const scr = new TitleScreen({ host, headers, base });
    scr.setTitle(this.title);
    return scr;
  },

  stage() {
    const st = S();
    return new TitleStage({ engine: st.engine, flow: () => st.studio?.worldFlow || st.worldFlow, songs: () => st.audio?.songs || [] });
  },

  stars() {
    const st = S();
    try { const m = st.engine.state().mario; if (m && Number.isFinite(m.stars)) return m.stars; } catch { /* loading */ }
    try { return st.world.collectedTotal(); } catch { return 0; }
  },

  // Run the launch screen over the game. Resolves { choice } or { cancel }; the screen stays black
  // until done() is called (after the caller warped to the hack's start).
  async run({ cancelable = true } = {}) {
    const st = S();
    if (!st?.engine?.ready) throw new Error('the game is still loading');
    if (st.editor?.active) st.editor.exit();
    st.storyUI?.isOpen?.() && st.storyUI.close();
    window.studio64TitleUI?.close?.();
    st.engine.releaseKeys?.();
    const scr = this.screen();
    await scr.load(this.title, { levelPicture: (k) => this.levelPicture(k) });
    const stage = this.stage();
    this.playing = true;
    this.current = scr;
    const res = await scr.run({ stage, cancelable, canContinue: true, stars: this.stars(), name: st.project?.name || document.querySelector('#project-name')?.value || '' });
    return { ...res, done: () => { scr.close(); this.playing = false; this.current = null; st.engine.canvas?.focus?.(); } };
  },

  // Try the launch screen in the game, then come back to where Mario was.
  async preview() {
    const st = S();
    const e = st.engine;
    const back = { level: e.level, custom: e.customLevel, area: e.area, key: e.areaKey(), mario: (() => { try { return e.state().mario; } catch { return null; } })() };
    const r = await this.run({ cancelable: true });
    if (back.key !== e.areaKey()) {
      if (back.level === e.studioLevel) {
        const wf = st.studio?.worldFlow || st.worldFlow;
        if (back.area > 1 && wf?.goArea) wf.goArea({ custom: back.custom, area: back.area }, { intro: false });
        else e.warpFast(e.studioLevel, 0, back.custom, false);
      } else e.warpFast(back.level, 1, null, false);
      await e.waitArrival(null, 30000);
      if (back.mario) e.teleport(back.mario.x, back.mario.y, back.mario.z, back.mario.yaw || 0);
    }
    r.done();
    return r;
  },
};
window.studio64Title = titleCtl;

// "Play from start" (Story panel, World tab, Claude) shows the launch screen first.
function wrapPlayFromStart(rt) {
  if (!rt || rt.__titleWrapped) return;
  rt.__titleWrapped = true;
  const orig = rt.playFromStart.bind(rt);
  rt.playFromStart = async (opts = {}) => {
    const t = titleCtl.title;
    if (!t.on || opts.title === false || titleCtl.playing) return orig(opts);
    let r;
    try { r = await titleCtl.run({ cancelable: true }); } catch (err) { console.warn('title screen', err); return orig(opts); }
    // (Esc skips the launch screen: the hack starts all the same)
    const e = S().engine;
    let arrived = false;
    const onArea = () => { arrived = true; };
    e.on('area', onArea);
    const p = orig({ ...opts, reset: r.choice === 'continue' ? false : opts.reset !== false });
    // the black screen goes once the start level is there
    const t0 = performance.now();
    await new Promise((resolve) => {
      const poll = () => {
        let m = null;
        try { m = e.state().mario; } catch { /* loading */ }
        if ((arrived && m && !e.inIntro) || performance.now() - t0 > 30000) resolve(); else setTimeout(poll, 100);
      };
      poll();
    });
    e.off('area', onArea);
    r.done();
    return p;
  };
}

// The browser side of Claude's title tool: the logo maker renders here.
registerRpc('title_set', async function ({ title, summary } = {}) {
  const next = normalizeTitle({ ...clone(titleCtl.title), ...title, logo: { ...titleCtl.title.logo, ...(title?.logo || {}), maker: { ...titleCtl.title.logo.maker, ...(title?.logo?.maker || {}) } }, bg: { ...titleCtl.title.bg, ...(title?.bg || {}) }, press: { ...titleCtl.title.press, ...(title?.press || {}) }, music: { ...titleCtl.title.music, ...(title?.music || {}) }, files: { ...titleCtl.title.files, ...(title?.files || {}) } });
  if (title?.logo?.maker) next.logo.made = null;
  const saved = await titleCtl.save(next, summary || 'Changed the title screen');
  return { title: saved, logo: saved.logo.file ? titleCtl.url(saved.logo.file) : null };
});
registerRpc('title_preview', function () {
  // it runs until the player presses Start: answer now
  titleCtl.preview().catch((err) => console.warn('title preview', err));
  return { started: true, note: 'The launch screen is playing in the game; it ends when the player presses Start.' };
});

// ---- boot -------------------------------------------------------------------------------------

function boot() {
  const st = S();
  if (!st || !st.engine) { setTimeout(boot, 200); return; }
  const waitProject = () => {
    if (!pid() || !st.clientId) { setTimeout(waitProject, 200); return; }
    titleCtl.load();
  };
  waitProject();
  const waitRt = () => { if (st.storyRuntime) wrapPlayFromStart(st.storyRuntime); else setTimeout(waitRt, 300); };
  waitRt();
  window.addEventListener('studio-message', (ev) => {
    const msg = ev.detail || {};
    if (msg.type === 'title') titleCtl.remote(msg.title);
  });
  const reg = () => {
    const sh = window.studioShell;
    if (!sh?.register) return false;
    sh.register({ id: 'title.open', label: 'Title screen', group: 'Story', icon: 'star', hint: 'Launch screen: logo, background, music, splash screens, file select', run: () => openEditor() });
    sh.register({ id: 'title.preview', label: 'Preview the title screen', group: 'Story', icon: 'play', hint: 'Plays the launch screen in the game', run: () => titleCtl.preview().catch((err) => S().toast?.(err.message, 'x')) });
    return true;
  };
  if (!reg()) window.addEventListener('studio-shell-ready', reg, { once: true });
}

export async function openEditor(tab) {
  const { TitleUI } = await import('./title_ui.js');
  if (!window.studio64TitleUI) window.studio64TitleUI = new TitleUI({ ctl: titleCtl, state: S });
  window.studio64TitleUI.open(tab);
  return window.studio64TitleUI;
}
titleCtl.openEditor = openEditor;

// The card on the Story panel's "Start & end" page.
titleCtl.startCard = (box) => {
  const t = titleCtl.title;
  const card = document.createElement('div');
  card.className = 'ttl-startcard';
  card.innerHTML = `<div class="ttl-startcard-pic">${t.cover ? `<img alt="" src="${titleCtl.url(t.cover)}">` : '<span>★</span>'}</div>
    <div class="ttl-startcard-text"><b>Launch screen</b><span>${t.on ? 'On: players see your splash screens, title and file select first.' : 'Off: the game starts right away. Make a title with your own logo.'}</span></div>
    <button class="btn sm${t.on ? '' : ' primary'}" data-a="title">${t.on ? 'Edit title screen' : 'Make a title screen'}</button>`;
  card.querySelector('[data-a=title]').onclick = () => openEditor('logo');
  const img = card.querySelector('img');
  if (img) loadImage(img.src, headers()).then((i) => { if (i) img.src = i.src; });
  box.prepend(card);
};

if (typeof window !== 'undefined') {
  // the editor's styles
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'css/title.css';
  document.head.appendChild(l);
  boot();
}
void needsEngine;
