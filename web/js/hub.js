// Projects around the editor: the home screen (recent hacks, templates, samples, import by
// drag and drop), project settings, sharing and export (.s64hack file, standalone playable
// game), version history, and robustness (offline edit queue, engine crash recovery).
// See docs/projects.md.
import { TEMPLATES } from './templates.js';
import { World } from './world.js';
import { loadPictures, hubPicture, templatePicture } from './pictures.js';

const $ = (s, root = document) => root.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const P = {
  home: '<path d="M3 11 12 3l9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  gamepad: '<rect x="2" y="6" width="20" height="12" rx="6"/><path d="M6 12h4M8 10v4M15 12h.01M18 11h.01"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  star: '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
  restore: '<path d="M3 12a9 9 0 1 0 9-9 9.7 9.7 0 0 0-6.7 2.7L3 8"/><path d="M3 3v5h5"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  castle: '<path d="M3 21V9l3 2V7l3 2V4l3 3 3-3v5l3-2v4l3-2v12zM10 21v-4a2 2 0 0 1 4 0v4"/>',
  sparkles: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 3v4M17 5h4"/>',
};
const ic = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24">${P[n] || P.sparkles}</svg>`;

function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString();
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const isDraft = (p) => !p.edits && !p.levels && !p.objects && /^Untitled hack$/.test(p.name);
const hue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

// Messages that change the project: kept and sent again when the server is back.
// (story_op, world_set and area_* too: offline story and world edits were dropped silently)
const PERSIST = new Set(['edit', 'level_create', 'level_rename', 'level_delete', 'level_duplicate', 'thumb', 'song_save', 'sound_save', 'audio_delete', 'overrides_save', 'rename', 'boot_level', 'story_op', 'world_set', 'area_create', 'area_rename', 'area_delete', 'reset_edits']);
const NINTENDO = 'The playable game is built from your Super Mario 64 ROM: it contains Nintendo\'s copyrighted code, graphics and sounds. Play it yourself or share it privately with friends; do not upload it publicly or sell it.';

export class Hub {
  // api: { state, send(msg), rawSend(msg), toast(text, icon), modal(html, onReady), closeModal() }
  constructor(api) {
    this.api = api;
    this.home = null;
    this.projects = [];
    this.samples = [];
    this.query = '';
    this.sort = store.get('studio64.home.sort') || 'recent';
    this.showDrafts = false;
    this.outbox = [];
    this.crashes = [];
    this.wire();
  }

  get state() { return this.api.state; }
  icon(name) { return ic(name, 'sm'); }
  headers(extra = {}) { return { 'x-studio-key': this.state.password || '', ...extra }; }
  async fetchJson(url, opts = {}) {
    const r = await fetch(url, { ...opts, headers: this.headers(opts.headers) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `${r.status}`);
    return data;
  }
  toast(text, icon = 'check') { this.api.toast(text, icon); }

  wire() {
    // the brand opens the home screen
    const brand = $('.brand');
    if (brand) { brand.title = 'All projects (home)'; brand.style.cursor = 'pointer'; brand.addEventListener('click', () => this.openHome()); }
    // wide modals give the app's modal back its normal size when they close
    const back = $('#modal-back');
    if (back) new MutationObserver(() => { if (back.hidden) $('#modal').classList.remove('hub-wide', 'hub-mid'); }).observe(back, { attributes: true, attributeFilter: ['hidden'] });
    const after = sessionStorage.getItem('studio64.afterReload');
    if (after) { sessionStorage.removeItem('studio64.afterReload'); setTimeout(() => this.toast(after, 'history'), 1500); }
  }

  // ---- startup -------------------------------------------------------------------------

  // The home screen instead of a project: asked for (?home), or nothing to open yet.
  startHome() {
    const url = new URL(location.href);
    if (url.searchParams.has('home') || (!url.searchParams.get('p') && !store.get('studio64.lastProject'))) {
      this.openHome({ boot: true });
      return true;
    }
    return false;
  }

  openProject(id) { location.href = `/?p=${encodeURIComponent(id)}`; }

  // ---- the home screen -------------------------------------------------------------------

  openHome({ boot = false } = {}) {
    if (!this.home) this.buildHome();
    this.homeBoot = boot || this.homeBoot;
    this.home.hidden = false;
    this.home.classList.toggle('boot', !!this.homeBoot);
    this.state.engine?.releaseKeys?.();
    document.body.classList.add('home-open');
    $('#home-close').hidden = !!this.homeBoot;
    this.refresh();
    setTimeout(() => $('#home-search')?.focus({ preventScroll: true }), 50);
  }

  closeHome() {
    if (this.homeBoot || !this.home) return;
    this.home.hidden = true;
    document.body.classList.remove('home-open');
    $('#canvas')?.focus();
  }

  buildHome() {
    const h = el('div', 'home');
    h.id = 'home';
    h.hidden = true;
    h.innerHTML = `
      <header class="home-top">
        <div class="home-brand"><span class="brand-mark">${ic('star')}</span><span>Studio 64</span></div>
        <label class="home-search">${ic('search', 'sm')}<input id="home-search" placeholder="Search your hacks…" spellcheck="false" autocomplete="off"></label>
        <div class="home-actions">
          <button class="btn" id="home-import" title="Import a .s64hack or project file (or drop it anywhere)">${ic('upload')}<span class="hide-sm">Import</span></button>
          <button class="btn primary" id="home-new">${ic('plus')}<span>New hack</span></button>
          <button class="btn icon ghost" id="home-close" title="Back to the editor (Esc)">${ic('x')}</button>
        </div>
      </header>
      <div class="home-scroll" id="home-scroll">
        <section class="home-hero">
          <h1>What will you make today?</h1>
          <p>Build levels by hand<span data-ai> or with Claude</span>, play them instantly, and share the result as a file or a playable game.</p>
        </section>
        <section class="home-sec">
          <div class="home-sec-head"><h2>Start a new hack</h2></div>
          <div class="tpl-row" id="home-templates"></div>
        </section>
        <section class="home-sec">
          <div class="home-sec-head">
            <h2>Your hacks <span class="home-count" id="home-count"></span></h2>
            <div class="seg home-sort"><button class="seg-btn" data-sort="recent">Recent</button><button class="seg-btn" data-sort="name">Name</button></div>
          </div>
          <div class="proj-grid" id="home-grid"></div>
          <div class="home-drafts" id="home-drafts"></div>
        </section>
      </div>
      <div class="home-drop" id="home-drop"><div>${ic('upload')}<b>Drop to import</b><span>.s64hack project files and Studio 64 exports</span></div></div>
      <input type="file" id="home-file" accept=".s64hack,.zip,.json,application/zip,application/json" multiple hidden>`;
    document.body.appendChild(h);
    this.home = h;
    $('#home-close', h).onclick = () => this.closeHome();
    $('#home-new', h).onclick = () => this.newHackModal();
    $('#home-import', h).onclick = () => $('#home-file', h).click();
    $('#home-file', h).onchange = (e) => { this.importFiles([...e.target.files]); e.target.value = ''; };
    $('#home-search', h).oninput = (e) => { this.query = e.target.value.trim().toLowerCase(); this.renderGrid(); };
    for (const b of h.querySelectorAll('.home-sort .seg-btn')) {
      b.classList.toggle('active', b.dataset.sort === this.sort);
      b.onclick = () => { this.sort = b.dataset.sort; store.set('studio64.home.sort', this.sort); h.querySelectorAll('.home-sort .seg-btn').forEach((x) => x.classList.toggle('active', x === b)); this.renderGrid(); };
    }
    // keys stay on the home screen while it is open
    // (the home's own cards and fields, its menus and dialogs get their keys first: Enter on a card,
    // Enter/Esc in the rename box; nothing reaches the game or the editor behind it)
    const homeKey = (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || '');
      if (e.key === 'Escape' && $('#modal-back')?.hidden !== false && !document.querySelector('.hub-menu, .dlg-back')) {
        e.preventDefault();
        if (e.target?.id === 'home-search' && e.target.value) { e.target.value = ''; this.query = ''; this.renderGrid(); } else this.closeHome();
      }
      if (!typing && e.key === '/') { e.preventDefault(); $('#home-search', h).focus(); }
    };
    window.addEventListener('keydown', (e) => {
      if (h.hidden) return;
      if (e.target?.closest?.('#home, #modal-back, .hub-menu, .dlg-back') || $('#modal-back')?.hidden === false) return; // handled where it happens (below; open dialogs: app.js)
      homeKey(e);
      e.stopImmediatePropagation();
    }, true);
    h.addEventListener('keydown', (e) => { homeKey(e); e.stopPropagation(); });
    // drag and drop import anywhere on the home screen
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file');
    h.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; h.classList.add('dropping'); });
    h.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    h.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) h.classList.remove('dropping'); });
    h.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; h.classList.remove('dropping'); this.importFiles([...(e.dataTransfer?.files || [])]); });
    this.renderTemplates();
    // the card pictures (a fresh install makes them in the background, pictures.js)
    loadPictures().then(() => this.renderTemplates());
    window.addEventListener('studio:pictures', () => this.renderTemplates());
  }

  async refresh() {
    try {
      const [list, samples] = await Promise.all([
        this.fetchJson('/api/hub/projects'),
        this.samples.length ? this.samples : this.fetchJson('/api/hub/samples').catch(() => []),
      ]);
      this.projects = list;
      this.samples = samples;
    } catch (err) {
      if (/password/.test(err.message)) { this.askPassword(); return; }
      this.toast(`Could not load your projects: ${err.message}`, 'x');
    }
    this.renderTemplates();
    this.renderGrid();
  }

  renderTemplates() {
    const row = $('#home-templates', this.home);
    row.innerHTML = '';
    const card = (title, sub, pic, onClick, badge) => {
      const b = el('button', 'tpl-card');
      b.innerHTML = `<div class="tpl-pic" style="${pic ? `background-image:url('${pic}')` : ''}">${badge ? `<span class="tpl-badge">${esc(badge)}</span>` : ''}</div>
        <div class="tpl-meta"><div class="tpl-title">${esc(title)}</div><div class="tpl-sub">${esc(sub)}</div></div>`;
      b.title = sub; // the card shows three lines of it
      b.onclick = onClick;
      row.appendChild(b);
    };
    card('Castle', 'The original game to remix: start in the castle grounds', hubPicture('castle'), () => this.createModal('empty'));
    card('From scratch', 'Your own world, no castle: pick a landscape to start on', templatePicture('island'), () => this.createModal('scratch'), 'New world');
    for (const s of this.samples) {
      card(s.name, s.description || `${plural(s.levels || 0, 'level')}`, s.hasCover ? `/api/hub/samples/${encodeURIComponent(s.file)}/cover` : null, () => this.createModal('sample', s), 'Sample');
    }
  }

  filtered() {
    let list = this.projects.filter((p) => !this.query || `${p.name} ${p.author} ${p.description}`.toLowerCase().includes(this.query));
    if (this.sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }

  renderGrid() {
    if (!this.home) return;
    const grid = $('#home-grid', this.home);
    const all = this.filtered();
    const drafts = this.query ? [] : all.filter(isDraft);
    const shown = this.query || this.showDrafts ? all : all.filter((p) => !isDraft(p));
    $('#home-count', this.home).textContent = shown.length ? `${shown.length}` : '';
    grid.innerHTML = '';
    // someone with hacks comes back to them: "Your hacks" above the starts (below them while there are none)
    const projSec = grid.closest('.home-sec'), tplSec = $('#home-templates', this.home)?.closest('.home-sec');
    if (projSec && tplSec) { if (this.projects.some((p) => !isDraft(p))) tplSec.before(projSec); else tplSec.after(projSec); }
    if (!shown.length) {
      grid.appendChild(el('div', 'home-empty', this.query ? `No hack matches “${esc(this.query)}”.` : `${ic('sparkles')}<b>No hacks yet</b><span>Pick a start above, or drop a .s64hack file here.</span>`));
    }
    for (const p of shown) grid.appendChild(this.projectCard(p));
    const d = $('#home-drafts', this.home);
    d.innerHTML = '';
    if (drafts.length && !this.query) {
      const t = el('button', 'btn sm ghost', this.showDrafts ? `Hide ${plural(drafts.length, 'empty draft')}` : `Show ${plural(drafts.length, 'empty draft')}`);
      t.onclick = () => { this.showDrafts = !this.showDrafts; this.renderGrid(); };
      const c = el('button', 'btn sm ghost danger', `${ic('trash', 'sm')}Delete empty drafts`);
      c.onclick = () => this.confirm(`Delete ${plural(drafts.length, 'empty draft')}?`, 'Projects without any edits, levels or name. They move to the server\'s trash folder.', 'Delete drafts', async () => {
        let n = 0;
        for (const p of drafts) { if (p.id === this.state.projectId) continue; try { await this.fetchJson(`/api/projects/${p.id}`, { method: 'DELETE' }); n++; } catch { /* skip */ } }
        this.toast(`Deleted ${plural(n, 'empty draft')}`, 'trash');
        this.refresh();
      }, true);
      d.append(t, c);
    }
  }

  projectCard(p) {
    const c = el('div', `proj-card${p.id === this.state.projectId ? ' current' : ''}`);
    c.tabIndex = 0;
    c.dataset.id = p.id;
    const initials = p.name.split(/\s+/).map((w) => (w.match(/[\p{L}\p{N}]/u) || [''])[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'S';
    const h1 = hue(p.id);
    c.innerHTML = `
      <div class="proj-pic" style="--h1:${h1};--h2:${(h1 + 50) % 360}">
        <span class="proj-initials">${esc(initials)}</span>
        ${p.hasThumb ? `<img loading="lazy" alt="" src="/api/projects/${encodeURIComponent(p.id)}/thumb?v=${encodeURIComponent(p.thumbVersion)}">` : ''}
        ${p.id === this.state.projectId ? '<span class="proj-badge">Open now</span>' : ''}
      </div>
      <div class="proj-meta">
        <div class="proj-name">${esc(p.name)}</div>
        <div class="proj-sub">${esc([p.author && `by ${p.author}`, timeAgo(p.updatedAt)].filter(Boolean).join(' · '))}</div>
        <div class="proj-stats">${p.levels ? `<span>${ic('castle', 'xs')}${plural(p.levels, 'level')}</span>` : ''}<span>${plural(p.edits, 'edit')}</span></div>
      </div>
      <button class="btn icon ghost proj-more" title="More">${ic('more')}</button>`;
    const img = c.querySelector('img');
    if (img) img.onerror = () => img.remove();
    c.onclick = (e) => { if (!e.target.closest('.proj-more')) this.openProject(p.id); };
    c.onkeydown = (e) => { if (e.key === 'Enter') this.openProject(p.id); };
    c.querySelector('.proj-more').onclick = (e) => { e.stopPropagation(); this.cardMenu(p, e.currentTarget); };
    c.oncontextmenu = (e) => { e.preventDefault(); this.cardMenu(p, c.querySelector('.proj-more')); };
    return c;
  }

  // A small menu of our own (the home screen also runs without the editor).
  menu(anchor, items) {
    document.querySelectorAll('.hub-menu').forEach((m) => m.remove());
    const m = el('div', 'menu floating hub-menu');
    for (const it of items) {
      if (it === '-') { m.appendChild(el('div', 'menu-sep')); continue; }
      const b = el('button', `menu-item${it.danger ? ' danger' : ''}`, `${ic(it.icon, 'sm')}<span>${esc(it.label)}</span>${it.sub ? `<span class="sub">${esc(it.sub)}</span>` : ''}`);
      b.onclick = (e) => { e.stopPropagation(); m.remove(); it.run(); };
      m.appendChild(b);
    }
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    const w = 230;
    m.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
    m.style.top = `${Math.max(8, Math.min(window.innerHeight - m.offsetHeight - 8, r.bottom + 6))}px`;
    setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
    // keyboard: the first item gets focus, arrows move, Esc closes (back to the ⋯ button)
    m.setAttribute('role', 'menu');
    const btns = [...m.querySelectorAll('.menu-item')];
    btns.forEach((b) => b.setAttribute('role', 'menuitem'));
    m.addEventListener('keydown', (e) => {
      const i = btns.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); m.remove(); anchor.focus?.(); } else if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); } else if (e.key === 'Tab') { m.remove(); anchor.focus?.(); }
      e.stopPropagation();
    });
    btns[0]?.focus({ preventScroll: true });
  }

  cardMenu(p, anchor) {
    this.menu(anchor, [
      { label: 'Open', icon: 'play', run: () => this.openProject(p.id) },
      { label: 'Rename', icon: 'edit', run: () => this.renameModal(p) },
      { label: 'Settings…', icon: 'gear', run: () => this.settingsModal(p.id) },
      { label: 'Duplicate', icon: 'copy', run: () => this.duplicate(p) },
      '-',
      { label: 'Export project file', icon: 'file', sub: '.s64hack', run: () => this.download(`/api/projects/${p.id}/export.s64hack`) },
      { label: 'Download playable game', icon: 'gamepad', sub: '.zip', run: () => this.downloadPlayable(p.id) },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, run: () => this.deleteProject(p) },
    ]);
  }

  // ---- dialogs ----------------------------------------------------------------------------

  // The app's modal; `size` widens it.
  modal(html, onReady, size = '') {
    this.api.modal(html, (m) => {
      m.classList.remove('hub-wide', 'hub-mid');
      if (size) m.classList.add(size);
      onReady?.(m);
    });
  }
  close() { this.api.closeModal(); }

  confirm(title, text, ok, onOk, danger = false) {
    this.modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="actions"><button class="btn" id="hc-no">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="hc-ok">${esc(ok)}</button></div>`, (m) => {
      m.querySelector('#hc-no').onclick = () => this.close();
      m.querySelector('#hc-ok').onclick = () => { this.close(); onOk(); };
      m.querySelector('#hc-ok').focus();
    });
  }

  // A server with STUDIO_PASSWORD, opened on the home screen: ask, then load the projects.
  askPassword(wrong = false) {
    if (document.getElementById('hpw') && $('#modal-back')?.hidden === false) return; // (closed dialogs stay in the DOM, hidden)
    this.modal(`<h2>Password</h2><p>${wrong ? 'That password is not right. Try again.' : 'This Studio 64 server is protected. Enter its password to see the hacks.'}</p>
      <form id="hpw-form" class="field"><input type="password" id="hpw" placeholder="Password" autocomplete="current-password" aria-label="Password"><button class="btn primary">Enter</button></form>`, (m) => {
      const inp = m.querySelector('#hpw');
      inp.focus();
      m.querySelector('#hpw-form').onsubmit = async (e) => {
        e.preventDefault();
        this.state.password = inp.value;
        store.set('studio64.password', inp.value);
        this.close();
        try { await this.fetchJson('/api/hub/projects'); this.refresh(); } catch { this.askPassword(true); }
      };
    });
  }

  renameModal(p) {
    this.modal(`<h2>Rename</h2><div class="field"><input type="text" id="hr-name" maxlength="80" value="${esc(p.name)}"></div>
      <div class="actions"><button class="btn" id="hr-no">Cancel</button><button class="btn primary" id="hr-ok">Rename</button></div>`, (m) => {
      const inp = m.querySelector('#hr-name');
      inp.focus(); inp.select();
      const go = async () => {
        const name = inp.value.trim();
        if (!name) return;
        this.close();
        await this.fetchJson(`/api/projects/${p.id}/meta`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
        this.toast(`Renamed to “${name}”`, 'edit');
        this.refresh();
      };
      inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
      m.querySelector('#hr-no').onclick = () => this.close();
      m.querySelector('#hr-ok').onclick = go;
    });
  }

  async duplicate(p) {
    const r = await this.fetchJson(`/api/projects/${p.id}/duplicate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    this.toast(`Made “${r.name}”`, 'copy');
    await this.refresh();
    this.home?.querySelector(`.proj-card[data-id="${r.id}"]`)?.classList.add('flash');
  }

  deleteProject(p) {
    this.confirm(`Delete “${p.name}”?`, 'Its levels, edits and history go to the server\'s trash folder. You can undo this right after.', 'Delete', async () => {
      await this.fetchJson(`/api/projects/${p.id}`, { method: 'DELETE' });
      if (p.id === this.state.projectId) { store.del('studio64.lastProject'); }
      this.undoToast(`Deleted “${p.name}”`, async () => {
        await this.fetchJson(`/api/projects/${p.id}/undelete`, { method: 'POST' });
        this.toast(`Restored “${p.name}”`, 'restore');
        this.refresh();
      });
      this.refresh();
    }, true);
  }

  // A toast with an Undo button (home screen).
  undoToast(text, onUndo) {
    let box = $('#hub-toasts');
    if (!box) { box = el('div', 'hub-toasts'); box.id = 'hub-toasts'; document.body.appendChild(box); }
    const t = el('div', 'hub-toast', `<span>${esc(text)}</span>`);
    const b = el('button', 'btn sm', 'Undo');
    b.onclick = () => { t.remove(); onUndo(); };
    t.appendChild(b);
    box.appendChild(t);
    setTimeout(() => t.remove(), 9000);
  }

  // ---- creating hacks ------------------------------------------------------------------------

  newHackModal() {
    const tpls = [
      { kind: 'empty', title: 'Castle', sub: 'Remix the original game', pic: hubPicture('castle') },
      { kind: 'scratch', title: 'From scratch', sub: 'Your own world, no castle', pic: templatePicture('island') },
      ...this.samples.map((s) => ({ kind: 'sample', sample: s, title: s.name, sub: s.description || 'Sample hack', pic: s.hasCover ? `/api/hub/samples/${encodeURIComponent(s.file)}/cover` : null })),
    ];
    this.modal(`<h2>New hack</h2><p>How do you want to start?</p><div class="hub-pick" id="hn-pick"></div>
      <div class="actions"><button class="btn" id="hn-no">Cancel</button></div>`, (m) => {
      const pick = m.querySelector('#hn-pick');
      for (const t of tpls) {
        const b = el('button', 'hub-pick-card', `<div class="pic" style="${t.pic ? `background-image:url('${t.pic}')` : ''}"></div><div><b>${esc(t.title)}</b><span>${esc(t.sub)}</span></div>`);
        b.title = t.sub;
        b.onclick = () => this.createModal(t.kind, t.sample);
        pick.appendChild(b);
      }
      m.querySelector('#hn-no').onclick = () => this.close();
    }, 'hub-mid');
  }

  // Name (and for "from scratch" the landscape) of a new hack, then create and open it.
  createModal(kind, sample) {
    const lastAuthor = store.get('studio64.author') || '';
    const title = kind === 'scratch' ? 'A new world' : kind === 'sample' ? sample.name : 'Castle remix';
    let tpl = 'island';
    const tplPick = kind === 'scratch'
      ? `<div class="hub-label">Landscape of your first level</div><div class="hub-tpls" id="hk-tpls">${Object.entries(TEMPLATES).map(([id, t]) => `<button class="hub-tpl${id === tpl ? ' active' : ''}" data-id="${id}"><span${templatePicture(id) ? ` style="background-image:url('${templatePicture(id)}')"` : ''}></span>${esc(t.label)}</button>`).join('')}</div>`
      : '';
    const intro = kind === 'scratch' ? 'Your hack starts in a level of its own. Add more levels any time.'
      : kind === 'sample' ? (sample.description || 'A finished example to play and take apart.') : 'The whole original game, ready to change. Your edits are saved as you go.';
    this.modal(`<h2>${esc(kind === 'sample' ? `Start from “${sample.name}”` : kind === 'scratch' ? 'Start from scratch' : 'Remix the castle')}</h2><p>${esc(intro)}</p>
      <div class="hub-form">
        <label>Name<input type="text" id="hk-name" maxlength="80" value="${esc(kind === 'sample' ? sample.name : title)}"></label>
        <label><span>Author <span class="opt">(optional)</span></span><input type="text" id="hk-author" maxlength="60" value="${esc(lastAuthor)}" placeholder="Your name"></label>
      </div>
      ${tplPick}
      <div class="actions"><button class="btn" id="hk-no">Cancel</button><button class="btn primary" id="hk-ok">${ic('sparkles', 'sm')}Create</button></div>`, (m) => {
      const name = m.querySelector('#hk-name');
      name.focus(); name.select();
      m.querySelectorAll('.hub-tpl').forEach((b) => { b.onclick = () => { tpl = b.dataset.id; m.querySelectorAll('.hub-tpl').forEach((x) => x.classList.toggle('active', x === b)); }; });
      m.querySelector('#hk-no').onclick = () => this.close();
      const go = async () => {
        const ok = m.querySelector('#hk-ok');
        ok.disabled = true;
        ok.innerHTML = '<span class="mini-spin"></span>Creating…';
        const author = m.querySelector('#hk-author').value.trim();
        store.set('studio64.author', author);
        const body = { name: name.value.trim() || title, author, template: kind };
        if (kind === 'empty') body.level = 16;
        if (kind === 'sample') body.sample = sample.file;
        if (kind === 'scratch') {
          body.level = 16;
          body.startInLevel = true;
          body.levels = [{ name: `${TEMPLATES[tpl]?.label || 'My level'}`, template: tpl, area: World.newLevelArea(tpl) }];
        }
        try {
          const r = await this.fetchJson('/api/hub/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
          this.close();
          this.openProject(r.id);
        } catch (err) {
          ok.disabled = false;
          ok.textContent = 'Create';
          this.toast(`Could not create it: ${err.message}`, 'x');
        }
      };
      name.onkeydown = (e) => { if (e.key === 'Enter') go(); };
      m.querySelector('#hk-ok').onclick = go;
    }, kind === 'scratch' ? 'hub-mid' : '');
  }

  // ---- import / export ----------------------------------------------------------------------

  async importFiles(files) {
    const all = files;
    files = files.filter((f) => /\.(s64hack|zip|json)$/i.test(f.name) || /zip|json/.test(f.type));
    if (!files.length) { this.toast(all.length === 1 ? `${all[0].name} is not a project file. Studio 64 opens .s64hack files.` : 'Those are not project files. Studio 64 opens .s64hack files.', 'x'); return; }
    let last = null;
    for (const f of files) {
      this.toast(`Importing ${f.name}…`, 'upload');
      try {
        const r = await fetch('/api/hub/import', { method: 'POST', headers: this.headers({ 'content-type': 'application/octet-stream' }), body: f });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || r.status);
        last = data;
        this.toast(`Imported “${data.name}”`, 'check');
      } catch (err) {
        this.toast(`${f.name}: ${err.message}`, 'x');
      }
    }
    if (last && files.length === 1) this.openProject(last.id);
    else this.refresh();
  }

  download(url) {
    const a = el('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  downloadPlayable(id) {
    this.modal(`<h2>${ic('gamepad')} Download the playable game</h2>
      <p>A folder with the game and your hack that runs in any browser, from any static web host (no Studio 64 needed).</p>
      <div class="hub-warn">${ic('warn')}<span>${esc(NINTENDO)}</span></div>
      <div class="actions"><button class="btn" id="hp-no">Cancel</button><button class="btn primary" id="hp-ok">${ic('download', 'sm')}Download .zip</button></div>`, (m) => {
      m.querySelector('#hp-no').onclick = () => this.close();
      m.querySelector('#hp-ok').onclick = () => { this.close(); this.toast('Building the playable game…', 'gamepad'); this.download(`/api/projects/${id}/standalone.zip`); };
    }, 'hub-mid');
  }

  // The Share dialog of the editor: link, project file, playable game.
  share() {
    const id = this.state.projectId;
    const url = `${location.origin}/?p=${id}`;
    this.modal(`<h2>Share “${esc($('#project-name')?.value || 'this hack')}”</h2>
      <div class="share-opt">
        <div class="share-ic">${ic('link')}</div>
        <div class="share-body"><b>Build together</b><span>Anyone with this link edits the same project live<span data-ai> and can chat with Claude</span>.</span>
          <div class="field"><input type="text" id="sh-url" readonly value="${esc(url)}"><button class="btn" id="sh-copy">Copy</button></div>
          <span class="hint">Others need to reach this server: start it with HOST=0.0.0.0 and a STUDIO_PASSWORD, or use a tunnel.</span></div>
      </div>
      <div class="share-opt">
        <div class="share-ic">${ic('file')}</div>
        <div class="share-body"><b>Project file</b><span>One .s64hack file with everything: levels, edits, stars, music, sounds and assets. Anyone with Studio 64 can open it (drop it on the home screen).</span>
          <label class="check" data-ai><input type="checkbox" id="sh-chat" checked> Include the chat with Claude</label>
          <div class="row"><button class="btn" id="sh-file">${ic('download', 'sm')}Download .s64hack</button></div></div>
      </div>
      <div class="share-opt">
        <div class="share-ic">${ic('gamepad')}</div>
        <div class="share-body"><b>Playable game</b><span>Your hack as a small website that plays in any browser, offline, from any static host. No editor, no chat.</span>
          <div class="row"><button class="btn" id="sh-play">${ic('download', 'sm')}Download .zip</button><a class="btn ghost" id="sh-preview" href="/play.html?p=${encodeURIComponent(id)}" target="_blank" rel="noopener">${ic('play', 'sm')}Try the player</a></div>
          <div class="hub-warn">${ic('warn')}<span>${esc(NINTENDO)}</span></div></div>
      </div>
      <div class="actions"><button class="btn" id="sh-import">${ic('upload', 'sm')}Import a project…</button><span class="spacer"></span><button class="btn primary" id="sh-done">Done</button></div>`, (m) => {
      m.querySelector('#sh-copy').onclick = async () => { try { await navigator.clipboard.writeText(url); this.toast('Link copied'); } catch { m.querySelector('#sh-url').select(); } };
      m.querySelector('#sh-file').onclick = () => this.download(`/api/projects/${id}/export.s64hack${m.querySelector('#sh-chat').checked ? '' : '?chat=0'}`);
      m.querySelector('#sh-play').onclick = () => { this.toast('Building the playable game…', 'gamepad'); this.download(`/api/projects/${id}/standalone.zip`); };
      m.querySelector('#sh-import').onclick = () => { this.close(); this.pickImport(); };
      m.querySelector('#sh-done').onclick = () => this.close();
    }, 'hub-mid');
  }

  pickImport() {
    const f = el('input');
    f.type = 'file';
    f.accept = '.s64hack,.zip,.json';
    f.onchange = () => { if (f.files.length) this.importFiles([...f.files]); };
    f.click();
  }

  // The edits of the original levels as level script C code for the SM64 decomp (real ROM builds).
  async decompModal() {
    const id = this.state.projectId;
    let files = [];
    try { files = await this.fetchJson(`/api/projects/${id}/decomp.zip?list=1`); } catch (err) { this.toast(err.message, 'x'); return; }
    const total = files.reduce((n, f) => n + f.objects, 0);
    this.modal(`<h2>${ic('file')} Export for the decomp</h2>
      <p>The objects and pipes you added to the original levels, as level script commands for the <b>SM64 decompilation</b>, to build a real ROM. Each file says where it goes.</p>
      ${files.length ? `<div class="dc-list">${files.map((f) => `<div class="dc-file"><b>${esc(f.path)}</b><span>${esc(f.level)}${f.area > 1 ? `, area ${f.area}` : ''} · ${plural(f.objects, 'object')}${f.warps ? ` · ${plural(f.warps, 'warp')}` : ''}</span>${f.notes.length ? `<ul>${f.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}</div>`).join('')}</div>`
        : '<div class="vh-empty">No edits in the original levels yet. Your own levels (new geometry) are not part of this export.</div>'}
      <div class="actions"><button class="btn" id="dc-no">Close</button><button class="btn primary" id="dc-ok" ${total || files.length ? '' : 'disabled'}>${ic('download', 'sm')}Download .zip</button></div>`, (m) => {
      m.querySelector('#dc-no').onclick = () => this.close();
      m.querySelector('#dc-ok').onclick = () => { this.close(); this.download(`/api/projects/${id}/decomp.zip`); };
    }, 'hub-mid');
  }

  // ---- project settings ----------------------------------------------------------------------

  async settingsModal(id = this.state.projectId) {
    let info;
    try { info = await this.fetchJson(`/api/projects/${id}/info`); } catch (err) { this.toast(err.message, 'x'); return; }
    const inApp = id === this.state.projectId && this.state.engine?.ready;
    let cover = info.hasCover ? `/api/projects/${id}/thumb?v=${Date.now()}` : null;
    let coverData; // undefined: unchanged, null: removed, string: new
    const levels = this.state.catalog?.levels ? Object.values(this.state.catalog.levels).filter((l) => l.num).sort((a, b) => a.name.localeCompare(b.name)) : [];
    const custom = id === this.state.projectId ? (this.state.levels || []) : [];
    const startOpts = [
      ...custom.map((l) => `<option value="c:${esc(l.id)}"${info.boot?.custom === l.id ? ' selected' : ''}>${esc(l.name)} (your level)</option>`),
      ...levels.map((l) => `<option value="${l.num}"${!info.boot?.custom && info.boot?.level === l.num ? ' selected' : ''}>${esc(l.name)}</option>`),
    ].join('');
    const s = info.stats || {};
    this.modal(`<h2>${ic('gear')} Project settings</h2>
      <div class="set-grid">
        <div class="set-cover">
          <div class="cover-box" id="ps-cover">${cover ? `<img src="${cover}" alt="">` : `<span>${ic('image')}No cover picture</span>`}</div>
          <div class="row">
            <button class="btn sm" id="ps-upload">${ic('upload', 'sm')}Upload</button>
            ${inApp ? `<button class="btn sm" id="ps-shot" title="Use what the game shows right now">${ic('camera', 'sm')}Game view</button>` : ''}
            <button class="btn sm ghost" id="ps-remove"${cover ? '' : ' hidden'}>Remove</button>
          </div>
        </div>
        <div class="hub-form">
          <label>Name<input type="text" id="ps-name" maxlength="80" value="${esc(info.name)}"></label>
          <label>Author<input type="text" id="ps-author" maxlength="60" value="${esc(info.meta?.author || '')}" placeholder="Your name"></label>
          <label>Description<textarea id="ps-desc" maxlength="600" rows="4" placeholder="What is this hack about?">${esc(info.meta?.description || '')}</textarea></label>
          ${startOpts ? `<label>Starts in<select id="ps-start">${startOpts}</select></label>` : ''}
        </div>
      </div>
      <div class="set-stats">${[plural(s.levels || 0, 'level'), plural(s.objects || 0, 'object'), plural(s.edits || 0, 'edit'), s.songs ? plural(s.songs, 'song') : '', info.files ? plural(info.files, 'asset file') : '', `created ${new Date(info.createdAt).toLocaleDateString()}`].filter(Boolean).join(' · ')}</div>
      <div class="actions"><button class="btn" id="ps-no">Cancel</button><button class="btn primary" id="ps-ok">Save</button></div>
      <input type="file" id="ps-file" accept="image/*" hidden>`, (m) => {
      const setCover = (url) => {
        m.querySelector('#ps-cover').innerHTML = url ? `<img src="${url}" alt="">` : `<span>${ic('image')}No cover picture</span>`;
        m.querySelector('#ps-remove').hidden = !url;
      };
      m.querySelector('#ps-upload').onclick = () => m.querySelector('#ps-file').click();
      m.querySelector('#ps-file').onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        coverData = await this.coverFromBlob(f);
        setCover(coverData);
      };
      m.querySelector('#ps-shot')?.addEventListener('click', async () => {
        const shot = await this.state.engine.screenshot();
        if (!shot) { this.toast('No picture: is the game running?', 'x'); return; }
        coverData = await this.coverFromUrl(shot);
        setCover(coverData);
      });
      m.querySelector('#ps-remove').onclick = () => { coverData = null; setCover(null); };
      m.querySelector('#ps-no').onclick = () => this.close();
      m.querySelector('#ps-ok').onclick = async () => {
        const body = { name: m.querySelector('#ps-name').value, author: m.querySelector('#ps-author').value, description: m.querySelector('#ps-desc').value };
        if (coverData !== undefined) body.cover = coverData;
        const start = m.querySelector('#ps-start')?.value;
        if (start) body.boot = start.startsWith('c:') ? { level: info.boot?.level || 16, custom: start.slice(2) } : { level: Number(start) };
        try {
          await this.fetchJson(`/api/projects/${id}/meta`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
          if (body.author) store.set('studio64.author', body.author.trim());
          this.close();
          this.toast('Project settings saved', 'check');
          if (this.home && !this.home.hidden) this.refresh();
        } catch (err) { this.toast(`Could not save: ${err.message}`, 'x'); }
      };
    }, 'hub-wide');
  }

  async coverFromBlob(blob) {
    const url = URL.createObjectURL(blob);
    try { return await this.coverFromUrl(url); } finally { URL.revokeObjectURL(url); }
  }

  // 16:9, 960×540, jpeg
  async coverFromUrl(url) {
    const img = await new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = url; });
    const c = el('canvas');
    c.width = 960; c.height = 540;
    const s = Math.max(960 / img.width, 540 / img.height);
    c.getContext('2d').drawImage(img, (960 - img.width * s) / 2, (540 - img.height * s) / 2, img.width * s, img.height * s);
    return c.toDataURL('image/jpeg', 0.84);
  }

  // ---- version history ---------------------------------------------------------------------

  async saveVersion(label) {
    const id = this.state.projectId;
    const v = await this.fetchJson(`/api/projects/${id}/versions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label }) });
    this.toast(`Saved version “${v.label}”`, 'save');
    return v;
  }

  saveVersionModal() {
    this.modal(`<h2>${ic('save')} Save a version</h2><p>A snapshot of the whole hack you can go back to any time. Studio 64 also saves one by itself every few minutes while you edit.</p>
      <div class="field"><input type="text" id="sv-label" maxlength="80" placeholder="Name it, e.g. “Before the boss room”"></div>
      <div class="actions"><button class="btn" id="sv-no">Cancel</button><button class="btn primary" id="sv-ok">Save version</button></div>`, (m) => {
      const inp = m.querySelector('#sv-label');
      inp.focus();
      const go = async () => { this.close(); await this.saveVersion(inp.value.trim() || `Version of ${new Date().toLocaleString()}`); };
      inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
      m.querySelector('#sv-no').onclick = () => this.close();
      m.querySelector('#sv-ok').onclick = go;
    });
  }

  async historyModal() {
    const id = this.state.projectId;
    let list = [];
    try { list = await this.fetchJson(`/api/projects/${id}/versions`); } catch (err) { this.toast(err.message, 'x'); return; }
    let sel = list[0]?.id || null;
    let against = 'current';
    this.modal(`<div class="vh-head"><h2>${ic('history')} Version history</h2><button class="btn sm" id="vh-save">${ic('save', 'sm')}Save version now</button></div>
      <div class="vh">
        <div class="vh-list" id="vh-list"></div>
        <div class="vh-detail" id="vh-detail"></div>
      </div>
      <div class="actions"><span class="hint">Undo and redo (Ctrl+Z / Ctrl+Shift+Z) step through single edits; versions hold the whole hack.</span><span class="spacer"></span><button class="btn" id="vh-close">Close</button></div>`, (m) => {
      const renderList = () => {
        const box = m.querySelector('#vh-list');
        box.innerHTML = '';
        const cur = el('button', `vh-item current${sel === null ? ' active' : ''}`, `<b>Now</b><span>The hack as it is</span>`);
        cur.onclick = () => { sel = null; renderList(); renderDetail(); };
        box.appendChild(cur);
        if (!list.length) box.appendChild(el('div', 'vh-empty', 'No versions yet. Save one, or keep editing: one is saved automatically every few minutes.'));
        let day = '';
        for (const v of list) {
          const d = new Date(v.ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
          if (d !== day) { day = d; box.appendChild(el('div', 'vh-day', esc(d))); }
          const b = el('button', `vh-item${sel === v.id ? ' active' : ''}${v.auto ? ' auto' : ''}`,
            `<b>${esc(v.label)}</b><span>${new Date(v.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${plural(v.stats?.edits || 0, 'edit')}${v.stats?.levels ? ` · ${plural(v.stats.levels, 'level')}` : ''}</span>`);
          b.onclick = () => { sel = v.id; against = 'current'; renderList(); renderDetail(); };
          box.appendChild(b);
        }
      };
      const renderDetail = async () => {
        const box = m.querySelector('#vh-detail');
        if (!sel) {
          box.innerHTML = `<div class="vh-empty big">${ic('history')}<b>Pick a version</b><span>See what changed since then, and bring it back.</span></div>`;
          return;
        }
        const v = list.find((x) => x.id === sel);
        const opts = [`<option value="current">now</option>`, ...list.filter((x) => x.ts > v.ts).map((x) => `<option value="${x.id}"${against === x.id ? ' selected' : ''}>${esc(x.label)} (${timeAgo(x.ts)})</option>`)].join('');
        box.innerHTML = `<div class="vh-top"><div><div class="vh-title">${esc(v.label)}</div><div class="vh-when">${new Date(v.ts).toLocaleString()}${v.auto ? ' · saved automatically' : ''}</div></div>
          <div class="vh-btns"><button class="btn sm" id="vh-rename" title="Name it (named versions are kept)">${ic('edit', 'sm')}</button><button class="btn sm danger" id="vh-del" title="Delete this version">${ic('trash', 'sm')}</button><button class="btn sm primary" id="vh-restore">${ic('restore', 'sm')}Restore</button></div></div>
          <div class="vh-cmp">Changes from this version to <select id="vh-against">${opts}</select></div>
          <div class="vh-diff" id="vh-diff"><span class="mini-spin"></span></div>`;
        box.querySelector('#vh-against').onchange = (e) => { against = e.target.value; renderDetail(); };
        box.querySelector('#vh-restore').onclick = () => this.confirm(`Restore “${v.label}”?`, 'The hack goes back to this version. What you have now is saved as a version first, so nothing is lost.', 'Restore', async () => {
          try {
            sessionStorage.setItem('studio64.afterReload', `Restored “${v.label}”`);
            await this.fetchJson(`/api/projects/${id}/versions/${v.id}/restore`, { method: 'POST' });
            this.reloadSoon();
          } catch (err) { this.toast(err.message, 'x'); }
        });
        box.querySelector('#vh-del').onclick = async () => { await this.fetchJson(`/api/projects/${id}/versions/${v.id}`, { method: 'DELETE' }); list = list.filter((x) => x.id !== v.id); sel = list[0]?.id || null; renderList(); renderDetail(); };
        box.querySelector('#vh-rename').onclick = () => {
          const t = box.querySelector('.vh-title');
          t.innerHTML = `<input type="text" maxlength="80" value="${esc(v.label)}">`;
          const inp = t.querySelector('input');
          inp.focus(); inp.select();
          const done = async () => { const nv = await this.fetchJson(`/api/projects/${id}/versions/${v.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: inp.value }) }); Object.assign(v, nv); renderList(); renderDetail(); };
          inp.onkeydown = (e) => { if (e.key === 'Enter') done(); if (e.key === 'Escape') renderDetail(); e.stopPropagation(); };
          inp.onblur = done;
        };
        try {
          const d = await this.fetchJson(`/api/projects/${id}/versions/${v.id}/diff?against=${encodeURIComponent(against)}`);
          const dbox = box.querySelector('#vh-diff');
          if (!dbox) return;
          if (d.same) { dbox.innerHTML = `<div class="vh-same">${ic('check')}Nothing changed.</div>`; return; }
          dbox.innerHTML = d.sections.map((s) => `<div class="vh-sec"><div class="vh-sec-title">${esc(s.title)}</div>${s.items.map((it) => `<div class="vh-line ${it.kind}"><i></i>${esc(it.text)}</div>`).join('')}</div>`).join('');
        } catch (err) { box.querySelector('#vh-diff').textContent = err.message; }
      };
      m.querySelector('#vh-save').onclick = async () => {
        const v = await this.saveVersion(`Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
        list.unshift(v);
        sel = v.id;
        renderList(); renderDetail();
      };
      m.querySelector('#vh-close').onclick = () => this.close();
      renderList();
      renderDetail();
    }, 'hub-wide');
  }

  reloadSoon() {
    this.toast('Loading the restored version…', 'history');
    setTimeout(() => location.reload(), 400);
  }

  // ---- the project menu of the editor ----------------------------------------------------------

  // Items for the editor's ⋯ menu: (label, run, { ic, sub, danger })
  menuItems() {
    return [
      { label: 'All projects', icon: 'home', run: () => this.openHome() },
      { label: 'New hack…', icon: 'plus', run: () => { this.openHome(); this.newHackModal(); } },
      { label: 'Project settings…', icon: 'gear', run: () => this.settingsModal() },
      '-',
      { label: 'Save version…', icon: 'save', run: () => this.saveVersionModal() },
      { label: 'Version history', icon: 'history', run: () => this.historyModal() },
      '-',
      { label: 'Share & export…', icon: 'link', run: () => this.share() },
      { label: 'Export project file', icon: 'file', sub: '.s64hack', run: () => this.download(`/api/projects/${this.state.projectId}/export.s64hack`) },
      { label: 'Download playable game', icon: 'gamepad', sub: '.zip', run: () => this.downloadPlayable(this.state.projectId) },
      { label: 'Export for the decomp', icon: 'file', sub: 'C', run: () => this.decompModal() },
      { label: 'Import project…', icon: 'upload', run: () => this.pickImport() },
    ];
  }

  // ---- server messages -------------------------------------------------------------------------

  onMessage(msg) {
    switch (msg.type) {
      case 'project_reload':
        sessionStorage.setItem('studio64.afterReload', msg.reason || 'The project was restored');
        this.reloadSoon();
        return true;
      case 'project_deleted':
        store.del('studio64.lastProject');
        this.toast('This project was deleted', 'trash');
        this.openHome({ boot: true });
        return true;
      case 'no_project': { // a link (or the last project of this browser) to a project that is gone
        store.del('studio64.lastProject');
        const u = new URL(location.href);
        u.searchParams.delete('p');
        history.replaceState(null, '', u);
        if ($('#loading')) $('#loading').hidden = true;
        this.toast('That project is not on this server (any more). Pick one of your hacks or start a new one.', 'x');
        this.openHome({ boot: true });
        return true;
      }
      case 'meta':
        this.state.projectMeta = msg.meta;
        if (msg.boot && this.state.project) this.state.project.boot = msg.boot;
        return true;
      case 'versions_changed':
      case 'version_saved':
        return true;
      default:
        return false;
    }
  }

  // ---- offline edits -----------------------------------------------------------------------------

  outboxKey() { return `studio64.outbox.${this.state.projectId}`; }

  // send() could not reach the server: keep project changes for later.
  queue(msg) {
    if (!PERSIST.has(msg.type) || !this.state.projectId) return false;
    this.outbox.push(msg);
    store.set(this.outboxKey(), JSON.stringify(this.outbox.slice(-500)));
    this.showOffline();
    return true;
  }

  showOffline() {
    const s = $('#save-state');
    if (!s) return;
    if (this.outbox.length) { s.textContent = `Offline · ${plural(this.outbox.length, 'change')} waiting`; s.classList.add('saving', 'offline'); }
    else s.classList.remove('offline');
  }

  // Connected again (welcome): send what waited, oldest first.
  flush(rawSend) {
    let saved = [];
    try { saved = JSON.parse(store.get(this.outboxKey()) || '[]'); } catch { /* ignore */ }
    const list = this.outbox.length ? this.outbox : saved;
    this.outbox = [];
    store.del(this.outboxKey());
    if (!list.length) { this.showOffline(); return; }
    for (const m of list) rawSend(m);
    this.showOffline();
    this.toast(`Saved ${plural(list.length, 'change')} made while offline`, 'check');
  }

  // ---- crash recovery ------------------------------------------------------------------------------

  watchEngine(engine) {
    this.engine = engine;
    engine.on('crash', (what) => this.onCrash(String(what || '')));
    // a game that stops drawing for a long time (not paused by the debug tools) has hung
    setInterval(() => {
      if (!engine.ready || engine.crashed || document.hidden || this.state.testing?.frozen) return;
      if (engine.lastFrame && performance.now() - engine.lastFrame > 8000 && !this.hangShown) {
        this.hangShown = true;
        this.onCrash('the game stopped responding', true);
      }
    }, 2000);
  }

  crashLog() { try { return JSON.parse(sessionStorage.getItem('studio64.crashes') || '[]'); } catch { return []; } }

  onCrash(what, hang = false) {
    let key = '';
    try { key = this.engine.areaKey(); } catch { /* ignore */ }
    const log = [...this.crashLog().filter((c) => Date.now() - c.t < 3 * 60 * 1000), { t: Date.now(), key, what: what.slice(0, 200) }];
    try { sessionStorage.setItem('studio64.crashes', JSON.stringify(log)); } catch { /* ignore */ }
    const again = log.filter((c) => c.key === key).length >= 2; // crashes again in this level: don't loop
    const box = $('#crash');
    if (!box) return;
    box.hidden = false;
    $('#start') && ($('#start').hidden = true);
    const card = box.querySelector('.crash-card') || box;
    card.innerHTML = `
      <div class="crash-title">${hang ? 'The game stopped responding' : 'The game crashed'}</div>
      <p>${again ? 'It crashed in this level again. Undo the last edit, or start somewhere safe and fix it from there.' : 'Usually one object that does not like this level. Your edits are saved; the game restarts where you were.'}</p>
      <div class="crash-why">${esc(what)}</div>
      <div class="crash-row">
        <button class="btn" id="cr-undo">${ic('restore', 'sm')}Undo last edit &amp; restart</button>
        <button class="btn" id="cr-safe">${ic('castle', 'sm')}Restart in the castle</button>
        <button class="btn primary" id="cr-restart">Restart${again ? '' : ' <span id="cr-count">in 10</span>'}</button>
      </div>`;
    const restart = (where) => {
      clearInterval(this.crashTimer);
      if (where === 'castle') store.set(`studio64.last.${this.state.projectId}`, JSON.stringify({ num: 16 }));
      location.reload();
    };
    card.querySelector('#cr-restart').onclick = () => restart();
    card.querySelector('#cr-safe').onclick = () => restart('castle');
    card.querySelector('#cr-undo').onclick = () => {
      // the level that crashed loads again; its last edit goes first
      this.api.send({ type: 'undo' });
      setTimeout(() => restart(), 400);
    };
    clearInterval(this.crashTimer);
    if (!again && !hang) {
      let n = 10;
      this.crashTimer = setInterval(() => {
        n--;
        const c = card.querySelector('#cr-count');
        if (c) c.textContent = `in ${n}`;
        if (n <= 0) restart();
      }, 1000);
      card.addEventListener('mouseenter', () => { clearInterval(this.crashTimer); const c = card.querySelector('#cr-count'); if (c) c.textContent = ''; }, { once: true });
    }
  }
}
