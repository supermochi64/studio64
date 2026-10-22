// Level launcher (jump between levels, create new ones) and the Stars panel.
import { terrainFromImage, Terrain } from './terrain.js';
import { TEMPLATES } from './templates.js';
import { TOKYO, TOKYO_CARD, loadTokyo, tokyoAvailable, createTokyoLevel } from './tokyo_template.js';
import { World } from './world.js';
import { icon } from './icons.js';
import { loadPictures, levelPicture, templatePicture } from './pictures.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MAT_COLORS = ['#55b043', '#8a5a2b', '#8d8d8d', '#b8a98a', '#7aa0b0', '#6a4a3a', '#9a9a9a', '#c0503a', '#c87a3a', '#d8cfb0',
  '#c9c2b0', '#6b7a5a', '#a07040', '#b88a50', '#dddddd', '#b0a090', '#cccccc', '#e2c98a', '#f2f4f8', '#bfe3f5', '#ff5a1a',
  '#aaaabb', '#888899', '#f5c400', '#ff66aa', '#8a8178', '#7a5a4a', '#2f6a2a', '#3a7bd5'];
// Small in-app dialogs (instead of the browser's prompt/confirm).
export function ask(title, value = '', { ok = 'OK', danger = false, input = true } = {}) {
  return new Promise((resolve) => {
    const back = $('#modal-back');
    const m = $('#modal');
    m.innerHTML = `<h2>${esc(title)}</h2>${input ? `<div class="field"><input type="text" id="ask-in" value="${esc(value)}" maxlength="60"></div>` : `<p>${esc(value)}</p>`}
      <div class="actions"><button class="btn" id="ask-no">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="ask-ok">${esc(ok)}</button></div>`;
    back.hidden = false;
    // Esc cancels (also a confirm without a text field), Enter confirms it
    const onKey = (e) => {
      if (back.hidden) { window.removeEventListener('keydown', onKey, true); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
      else if (e.key === 'Enter' && !input) { e.preventDefault(); e.stopPropagation(); done(true); }
    };
    window.addEventListener('keydown', onKey, true);
    const done = (v) => { window.removeEventListener('keydown', onKey, true); back.hidden = true; resolve(v); };
    if (!input) setTimeout(() => m.querySelector('#ask-ok')?.focus(), 0);
    const inp = m.querySelector('#ask-in');
    m.querySelector('#ask-no').onclick = () => done(null);
    m.querySelector('#ask-ok').onclick = () => done(input ? inp.value.trim() || null : true);
    if (inp) {
      inp.focus();
      inp.select();
      inp.onkeydown = (e) => { if (e.key === 'Enter') done(inp.value.trim() || null); if (e.key === 'Escape') done(null); e.stopPropagation(); };
    }
  });
}

const SKY_COLORS = { 0: ['#7ec8ff', '#d9f1ff'], 8: ['#5aa8ff', '#e8f6ff'], 3: ['#9fb6d8', '#dfe7f2'], 4: ['#7aa0d8', '#e9f0fa'], 5: ['#f0b860', '#ffe9c0'],
  1: ['#7a1a10', '#f06a2a'], 9: ['#3a1a5a', '#9a5ad8'], 7: ['#2a5a3a', '#8ad8a8'], 6: ['#1a1a2a', '#4a4a6a'], 2: ['#1a3a6a', '#4a8ad8'] };

// A small top-down picture of a terrain (for template cards and level cards without a screenshot).
export function terrainPreview(t, settings = {}, size = 160) {
  const c = el('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const sky = SKY_COLORS[settings.sky ?? 0] || SKY_COLORS[0];
  const grad = g.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, sky[0]); grad.addColorStop(1, sky[1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  if (!t) {
    g.fillStyle = '#ddd';
    g.fillRect(size * 0.38, size * 0.6, size * 0.24, size * 0.06);
    return c;
  }
  const img = g.getImageData(0, 0, size, size);
  const water = settings.water?.on ? settings.water.height : null;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const i = Math.min(t.nx - 1, Math.floor((px / size) * t.nx)), j = Math.min(t.nz - 1, Math.floor((py / size) * t.nz));
    const h = t.h[t.idx(i, j)], hx = t.h[t.idx(i + 1, j)], hz = t.h[t.idx(i, j + 1)];
    const shade = Math.max(0.55, Math.min(1.25, 0.95 + ((h - hx) + (h - hz)) / 900));
    let col = MAT_COLORS[t.m[j * t.nx + i]] || '#888';
    let r = parseInt(col.slice(1, 3), 16), gg = parseInt(col.slice(3, 5), 16), b = parseInt(col.slice(5, 7), 16);
    if (water !== null && h < water) { const d = Math.min(1, (water - h) / 500); r = r * (1 - d) * 0.4 + 40; gg = gg * (1 - d) * 0.4 + 110; b = b * (1 - d) * 0.3 + 210; }
    const k = (py * size + px) * 4;
    img.data[k] = Math.min(255, r * shade); img.data[k + 1] = Math.min(255, gg * shade); img.data[k + 2] = Math.min(255, b * shade); img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

export class LevelsUI {
  constructor({ engine, world, editor, catalog, send, toast, getLevels, getThumbs, submitChat, setAttachments }) {
    this.engine = engine;
    this.world = world;
    this.editor = editor;
    // the launcher pictures (a fresh install makes them in the background): placeholders until they exist
    loadPictures();
    window.addEventListener('studio:pictures', () => { if (!$('#launcher').hidden && $('#launcher-body .lvl-grid') && !$('#nl-name')) this.render(); });
    this.catalog = catalog;
    this.send = send;
    this.toast = toast;
    this.getLevels = getLevels;
    this.getThumbs = getThumbs;
    this.submitChat = submitChat;
    this.setAttachments = setAttachments;
    this.cams = {};              // editor camera per level, for instant back-and-forth
    this.rebuild = false;        // re-enter build mode after the next level load
    this.thumbTimer = null;
    engine.on('area', () => this.onArrive());
    engine.on('star', (ev) => { world.onStarCollected(ev); this.renderStars(); });
    engine.on('intro', (on) => { if (on) this.onIntro(); });
    engine.on('ready', () => this.syncStarTotal());
    engine.introInfo = (level) => this.introInfo(level);
    engine.pauseLevels = () => this.pauseLevels();
    engine.starInfo = (uid, index) => ({ title: this.currentLabel(), name: this.world.findStar(engine.areaKey(), uid, index)?.name || 'Star' });
    world.on(() => this.renderStars());
    this.wire();
  }

  // ---- the star select screen ---------------------------------------------------

  // What the screen shows for a level: its name and the studio stars of all its areas.
  introInfo(level) {
    const e = this.engine;
    if (level === e.studioLevel) {
      const key = `c:${e.customLevel || 'default'}`;
      return { title: this.getLevels().find((l) => l.id === e.customLevel)?.name || 'Custom level', stars: this.world.levelStars(key), score: this.world.coinScore(key) };
    }
    const info = Object.values(this.catalog.levels).find((l) => l.num === level);
    const keys = Object.keys(this.engine.patch?.areas || {}).filter((k) => k.startsWith(`${level}:`)).sort();
    return { title: info?.name, stars: keys.flatMap((k) => this.world.stars(k)) };
  }

  // The castle's pause menu pages through the custom levels after the courses.
  pauseLevels() {
    return this.getLevels().map((l) => {
      const key = `c:${l.id}`;
      const stars = this.world.levelStars(key);
      return { name: l.name, stars: stars.filter((s) => s.kind !== 'coins100').map((s) => (s.done ? '1' : '0')).join(''),
        coins: this.world.coinScore(key), coinStar: stars.some((s) => s.kind === 'coins100' && s.done) };
    });
  }

  // The screen comes up: build mode steps aside and comes back in the level.
  onIntro() {
    this.close();
    const ed = this.editor;
    if (ed?.active) {
      this.cams[this.engine.areaKey()] = { ...ed.cam };
      this.rebuild = true;
      ed.exit();
    }
  }

  // Collected studio stars count on the game's star counter.
  syncStarTotal() { this.engine.setBonusStars(this.world.collectedTotal()); }

  // ---- jumping between levels ------------------------------------------------------

  currentLabel() {
    const e = this.engine;
    if (e.level === e.studioLevel) return this.getLevels().find((l) => l.id === e.customLevel)?.name || 'Custom level';
    for (const info of Object.values(this.catalog.levels)) if (info.num === e.level) return info.name;
    return 'Level';
  }

  go(target) {
    const e = this.engine;
    if (!e.ready) return;
    // a jump while another is still on its way: the game would drop it, so it waits for the
    // arrival and then goes (the last choice wins)
    const same = (a, b) => !!a && !!b && (a.custom ? a.custom === b.custom : !b.custom && a.num === b.num);
    if (this.traveling && performance.now() - this.traveling < 20000) {
      this.close();
      // already on the way there: nothing to do
      this.queued = same(target, this.travelTarget) ? null : target;
      return;
    }
    this.traveling = performance.now();
    this.travelTarget = target;
    // remember how the editor looked at this level, and come back to build mode
    const ed = this.editor;
    if (ed?.active) {
      this.cams[e.areaKey()] = { ...ed.cam };
      this.rebuild = true;
    }
    this.close();
    if (target.custom) e.warpFast(e.studioLevel, 0, target.custom);
    else e.warpFast(target.num, 0);
    this.toast(`Going to ${target.name}`, 'door');
  }

  onArrive() {
    const e = this.engine;
    this.traveling = 0;
    if (this.queued) { const q = this.queued; this.queued = null; setTimeout(() => this.go(q), 300); }
    const key = e.areaKey();
    $('#level-name').textContent = this.currentLabel();
    if (this.rebuild && this.editor) {
      this.rebuild = false;
      setTimeout(() => {
        this.editor.enter();
        const cam = this.cams[key];
        if (cam) { Object.assign(this.editor.cam, cam); this.editor.pushCamera(); }
      }, 350);
    }
    this.renderStars();
    clearTimeout(this.thumbTimer);
    // a thumbnail once the level is on screen
    this.thumbTimer = setTimeout(() => this.captureThumb(key), 2500);
  }

  async captureThumb(key) {
    if (this.engine.areaKey() !== key || this.engine.crashed) return;
    const url = await this.engine.screenshot();
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      const c = el('canvas');
      c.width = 320; c.height = 180;
      const s = Math.max(320 / img.width, 180 / img.height);
      c.getContext('2d').drawImage(img, (320 - img.width * s) / 2, (180 - img.height * s) / 2, img.width * s, img.height * s);
      const data = c.toDataURL('image/jpeg', 0.72);
      this.getThumbs()[key] = data;
      this.send({ type: 'thumb', key, data });
    };
    img.src = url;
  }

  // ---- launcher -------------------------------------------------------------------

  open() {
    const L = $('#launcher');
    L.hidden = false;
    const q = $('#launcher-search');
    q.value = ''; // before render(): it filters by the search field
    this.render();
    q.focus();
    this.engine.releaseKeys();
  }

  close() { $('#launcher').hidden = true; }

  starCount(key) {
    const s = this.world.levelStars(key).filter((x) => x.kind !== 'coins100');
    return s.length ? `★ ${s.filter((x) => x.done).length}/${s.length}` : '';
  }

  card({ title, sub, key, thumb, current, onClick, menu, preview }) {
    const c = el('button', `lvl-card${current ? ' current' : ''}`);
    const pic = el('div', 'lvl-pic');
    if (thumb) pic.style.backgroundImage = `url(${thumb})`;
    else if (preview) pic.appendChild(preview);
    else pic.classList.add('empty');
    c.appendChild(pic);
    const stars = key ? this.starCount(key) : '';
    c.appendChild(el('div', 'lvl-info', `<div class="lvl-title">${esc(title)}</div><div class="lvl-sub">${esc(sub || '')}${stars ? ` <span class="lvl-stars">${stars}</span>` : ''}</div>`));
    if (current) c.appendChild(el('span', 'lvl-here', 'Here'));
    c.onclick = onClick;
    if (menu) {
      const m = el('span', 'lvl-menu', icon('list', 'sm'));
      m.title = 'Rename, duplicate, delete';
      m.onclick = (e) => { e.stopPropagation(); menu(m); };
      c.appendChild(m);
    }
    c.dataset.search = `${title} ${sub || ''}`.toLowerCase();
    return c;
  }

  render() {
    const box = $('#launcher-body');
    box.innerHTML = '';
    const e = this.engine;
    const thumbs = this.getThumbs();
    const mine = el('div', 'lvl-grid');
    const newCard = el('button', 'lvl-card new', `<div class="lvl-pic newpic">${icon('plus')}</div><div class="lvl-info"><div class="lvl-title">New level</div><div class="lvl-sub">From a template or an image</div></div>`);
    newCard.dataset.search = 'new level create';
    newCard.onclick = () => this.newLevelDialog();
    mine.appendChild(newCard);
    for (const l of this.getLevels()) {
      const key = `c:${l.id}`;
      const area = this.world.area(key);
      let preview = null;
      if (!thumbs[key]) {
        try { preview = terrainPreview(area.terrain ? Terrain.decode(area.terrain) : null, area.settings || {}); } catch { preview = null; }
      }
      mine.appendChild(this.card({
        title: l.name, sub: TEMPLATES[l.template]?.label || (l.template === 'tokyo' ? TOKYO.label : 'Custom level'), key, thumb: thumbs[key], preview,
        current: e.level === e.studioLevel && e.customLevel === l.id,
        onClick: () => this.go({ custom: l.id, name: l.name }),
        menu: (anchor) => this.levelMenu(l, anchor),
      }));
    }
    box.appendChild(el('div', 'lvl-section', 'Your levels'));
    box.appendChild(mine);
    const orig = el('div', 'lvl-grid');
    const levels = Object.values(this.catalog.levels).filter((l) => l.num).sort((a, b) => (b.acts - a.acts) || a.name.localeCompare(b.name));
    for (const l of levels) {
      const key = `${l.num}:1`;
      orig.appendChild(this.card({ title: l.name, sub: l.acts ? 'Course' : 'Extra', key, thumb: thumbs[key] || levelPicture(l.num), current: e.level === l.num, onClick: () => this.go(l) }));
    }
    box.appendChild(el('div', 'lvl-section', 'Original levels'));
    box.appendChild(orig);
    this.filter();
  }

  filter() {
    const q = $('#launcher-search').value.trim().toLowerCase();
    for (const c of document.querySelectorAll('#launcher-body .lvl-card')) c.hidden = q && !c.dataset.search.includes(q);
  }

  levelMenu(l, anchor) {
    const menu = $('#level-card-menu');
    menu.innerHTML = '';
    const item = (label, fn, danger) => { const b = el('button', `menu-item${danger ? ' danger' : ''}`, `<span>${esc(label)}</span>`); b.onclick = (e) => { e.stopPropagation(); menu.hidden = true; fn(); }; menu.appendChild(b); };
    item('Rename', async () => {
      const name = await ask('Rename level', l.name, { ok: 'Rename' });
      if (name) this.send({ type: 'level_rename', id: l.id, name });
    });
    item('Duplicate', () => this.send({ type: 'level_duplicate', id: l.id }));
    item('Delete', async () => {
      if (!await ask(`Delete “${l.name}”?`, 'The level and everything in it is removed. This cannot be undone.', { ok: 'Delete', danger: true, input: false })) return;
      this.send({ type: 'level_delete', id: l.id });
      const e = this.engine;
      if (e.level === e.studioLevel && e.customLevel === l.id) {
        // don't stay in a level that no longer exists
        const other = this.getLevels().find((x) => x.id !== l.id);
        if (other) this.go({ custom: other.id, name: other.name });
        else this.go(this.catalog.levels[Object.keys(this.catalog.levels).find((k) => this.catalog.levels[k].num === 9)] || { num: 9, acts: 6, name: 'Bob-omb Battlefield' });
      }
    }, true);
    const r = anchor.getBoundingClientRect();
    menu.hidden = false;
    menu.style.left = `${r.left - 120}px`;
    menu.style.top = `${r.bottom + 4}px`;
  }

  // ---- new level ----------------------------------------------------------------

  newLevelDialog() {
    const box = $('#launcher-body');
    box.innerHTML = '';
    const head = el('div', 'new-head', `<button class="btn sm" id="nl-back">${icon('undo', 'sm')}Back</button>
      <input id="nl-name" class="nl-name" placeholder="Name your level" maxlength="60" value="My level ${this.getLevels().length + 1}">`);
    box.appendChild(head);
    head.querySelector('#nl-back').onclick = () => this.render();
    box.appendChild(el('div', 'lvl-section', 'Start from a template'));
    const grid = el('div', 'lvl-grid');
    for (const [id, t] of Object.entries(TEMPLATES)) {
      // pictures rendered by tools/make_template_thumbs.mjs
      grid.appendChild(this.card({ title: t.label, sub: '', thumb: templatePicture(id), onClick: () => this.createLevel(id) }));
    }
    // Tokyo from Shoggoth World (tools/import_shoggoth_tokyo.mjs): only when it was imported
    tokyoAvailable(this.engine).then(async (ok) => {
      if (!ok || !grid.isConnected || grid.querySelector('.tpl-tokyo')) return;
      // its picture (made by the import; an older import has none: then the card has no picture)
      const thumb = (await loadTokyo())?.card ? TOKYO_CARD : null;
      if (grid.querySelector('.tpl-tokyo')) return;
      const c = this.card({ title: TOKYO.label, sub: TOKYO.sub, thumb, onClick: () => createTokyoLevel(this, this.levelName()).catch((err) => this.toast(err.message, 'x')) });
      c.classList.add('tpl-tokyo');
      grid.appendChild(c);
    });
    box.appendChild(grid);
    box.appendChild(el('div', 'lvl-section', 'Or from an image'));
    const imgRow = el('div', 'img-drop', `${icon('upload')}<div><b>Drop an image here or click to choose one</b><span><span data-ai>A sketch, a map, concept art or a screenshot. Claude builds the level from it, or the image becomes the height of the ground.</span><span data-no-ai>A height map: bright is high, dark is low. It becomes the shape of the ground.</span></span></div>`);
    const file = el('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.hidden = true;
    imgRow.appendChild(file);
    imgRow.onclick = () => file.click();
    imgRow.ondragover = (e) => { e.preventDefault(); imgRow.classList.add('over'); };
    imgRow.ondragleave = () => imgRow.classList.remove('over');
    imgRow.ondrop = (e) => { e.preventDefault(); imgRow.classList.remove('over'); if (e.dataTransfer.files[0]) this.imageChosen(e.dataTransfer.files[0]); };
    file.onchange = () => { if (file.files[0]) this.imageChosen(file.files[0]); };
    box.appendChild(imgRow);
    box.appendChild(el('div', 'img-choice', ''));
    setTimeout(() => $('#nl-name')?.select(), 30);
  }

  levelName() { return ($('#nl-name')?.value || '').trim() || `My level ${this.getLevels().length + 1}`; }

  createLevel(template, area = null, name = this.levelName(), id = Math.random().toString(36).slice(2, 10)) {
    const a = area || World.newLevelArea(template);
    this.engine.patch.areas[`c:${id}`] = a; // so it loads right away, before the server echoes it
    this.send({ type: 'level_create', id, name, template, area: a });
    this.getLevels().push({ id, name, template, created: Date.now() });
    this.rebuild = true;
    this.go({ custom: id, name });
    return id;
  }

  imageChosen(file) {
    const box = $('.img-choice');
    const url = URL.createObjectURL(file);
    box.innerHTML = `<img src="${url}" alt=""><div class="img-actions">
      <button class="btn primary" id="img-claude" data-ai>${icon('sparkles', 'sm')}Let Claude build this level</button>
      <button class="btn" id="img-height">Use it as a heightmap</button></div>`;
    box.querySelector('#img-claude').onclick = async () => {
      const name = this.levelName();
      this.createLevel('flat', null, name);
      await this.setAttachments([file]);
      setTimeout(() => this.submitChat(`Build the level “${name}” from this picture: match its layout, landmarks and colors, make it fun to play, and add a few stars.`), 2500);
    };
    box.querySelector('#img-height').onclick = async () => {
      const t = await terrainFromImage(file, { min: -300, max: 2600 });
      const area = { objects: [], removals: [], warps: [], settings: { sky: 0, music: 3, water: { on: true, height: -100 }, spawn: { x: 0, y: Math.round(t.heightAt(0, 0) + 400), z: 0, yaw: 0 } }, terrain: t.encode() };
      this.createLevel('image', area);
    };
  }

  // ---- stars ----------------------------------------------------------------------

  renderStars() {
    this.syncStarTotal();
    const box = $('#stars-list');
    if (!box) return;
    // the level's own stars; the 100 coin star of custom levels is a note below, like in the game
    const all = this.world.stars();
    const stars = all.filter((s) => s.kind !== 'coins100');
    const coinStar = all.find((s) => s.kind === 'coins100');
    const done = stars.filter((s) => s.done).length;
    $('#stars-count').textContent = stars.length ? `${done}/${stars.length}` : '0';
    $('#stars-level').textContent = this.currentLabel();
    box.innerHTML = '';
    const coinNote = () => {
      if (coinStar) box.appendChild(el('div', 'star-note', `${coinStar.done ? '★' : '☆'} Plus the 100 coin star: collect 100 coins in this level${coinStar.done ? ' (collected)' : ''}.`));
    };
    if (!stars.length) {
      box.appendChild(el('div', 'edits-empty', `No stars in this level yet.<br>Add one below${document.body.classList.contains('no-ai') ? ' and click where it goes.' : ', or ask Claude for a few.'}`));
      coinNote();
      return;
    }
    for (const s of stars) {
      const row = el('div', `star-row${s.done ? ' done' : ''}`);
      const kind = s.kind === 'red_coins' ? 'Red coin star' : 'Star';
      row.innerHTML = `<span class="star-icon">${s.done ? '★' : '☆'}</span><div class="einfo"><div class="etitle">${esc(s.name)}</div><div class="emeta">${kind} · ${s.done ? 'collected' : 'not collected yet'}</div></div>`;
      const go = el('button', 'btn icon ghost', icon('crosshair', 'sm'));
      go.title = 'Show it';
      go.onclick = () => {
        if (!this.editor.active) this.editor.enter();
        setTimeout(() => this.editor.frameTo([s.x, s.y, s.z], 500), 50);
      };
      const ren = el('button', 'btn icon ghost', icon('message', 'sm'));
      ren.title = 'Rename';
      ren.onclick = async () => {
        const name = await ask('Rename star', s.name, { ok: 'Rename' });
        if (name) {
          const rec = this.world.area().objects.find((r) => r.uid === s.uid);
          if (rec) { rec.star = { name: name.trim() }; rec.name = name.trim(); this.send({ type: 'edit', op: { type: 'update', key: this.engine.areaKey(), uid: s.uid, fields: { star: rec.star, name: rec.name }, summary: `Renamed a star to “${name.trim()}”` } }); this.renderStars(); }
        }
      };
      row.append(go, ren);
      box.appendChild(row);
    }
    coinNote();
  }

  async addStar(kind, presetName) {
    const n = this.world.stars().length + 1;
    const name = presetName || await ask(kind === 'red_coins' ? 'Name the red coin star' : kind === 'shine' ? 'Name the Shine Sprite' : 'Name the new star', kind === 'red_coins' ? 'Eight Red Coins' : kind === 'shine' ? `Shine ${n}` : `Star ${n}`, { ok: 'Place it' });
    if (!name) return;
    // a Shine Sprite (Super Mario Sunshine) is a star with another look: sms:shine_sprite
    this.editor.startPlacing({ entry: kind === 'red_coins' ? 'hidden_red_coin_star' : kind === 'shine' ? 'sms:shine_sprite' : 'star', star: { name: name.trim() } });
    this.toast(kind === 'red_coins' ? 'Click where the star appears, then place 8 red coins' : 'Click where the star goes', 'sparkles');
  }

  // ---- wiring -----------------------------------------------------------------------

  wire() {
    $('#launcher-search').addEventListener('input', () => this.filter());
    $('#launcher-search').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      if (e.key === 'Enter') { const first = [...document.querySelectorAll('#launcher-body .lvl-card')].find((c) => !c.hidden); first?.click(); }
      e.stopPropagation();
    });
    $('#launcher').addEventListener('mousedown', (e) => { if (e.target.id === 'launcher') this.close(); });
    // Esc anywhere in the launcher: from the new-level page back to the list, else close it
    $('#launcher').addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if ($('#nl-name')) { this.render(); $('#launcher-search').focus(); } else this.close();
    });
    $('#launcher-close').onclick = () => this.close();
    document.addEventListener('click', () => { $('#level-card-menu').hidden = true; });
    window.addEventListener('keydown', (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') { e.preventDefault(); if ($('#launcher').hidden) this.open(); else this.close(); return; }
      if (!typing && e.code === 'KeyL' && !e.ctrlKey && !e.metaKey && (this.editor?.active || !document.querySelector('.game-frame.playing'))) { e.preventDefault(); this.open(); }
    });
    $('#add-star').onclick = () => this.addStar('star');
    $('#add-red-star').onclick = () => this.addStar('red_coins');
    if ($('#add-shine')) $('#add-shine').onclick = () => this.addStar('shine');
    $('#reset-stars').onclick = () => { this.world.resetProgress(); this.renderStars(); this.toast('Star progress reset', 'undo'); };
  }
}
