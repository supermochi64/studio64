// The asset studio: import 3D models (with a preview before placing), the "Models"
// tab of the build library, the game's textures (browse, replace, paint, recolour),
// custom block/terrain materials, custom skies and Mario's colours.

import { Assets, ANIM_NAMES, MARIO_PARTS, MARIO_PRESETS } from './assets.js';
import { importModel, isModelFile } from './asset_import.js';
import { buildPackage, encodePackage, decodePackage, defaultMaterialMeta, SURFACE_NAMES } from './asset_mesh.js';
import { ModelPreview, thumbnail } from './asset_preview.js';
import { openPixelEditor } from './pixel_editor.js';
import { askConfirm, askText, askChoice } from './dialogs.js';
import { TEX_FORMATS, toCanvas, toDataURL, rasterize, recolor, quantize, pattern, PATTERNS, blobToRGBA, pow2, hex, parseColor } from './texcodec.js';

const $ = (s, root = document) => root.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (path, cls = 'i sm') => `<svg class="${cls}" viewBox="0 0 24 24">${path}</svg>`;
const ICON = {
  cube: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>',
  upload: '<path d="M12 16V4M6 10l6-6 6 6M4 20h16"/>',
  brush: '<path d="M4 20c2 0 4-1 4-3a2 2 0 0 0-4 0M8 17 19 6a2 2 0 0 0-3-3L5 14"/>',
  palette: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="16" cy="10" r="1.2"/><path d="M12 21a3 3 0 0 1 0-6h2"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  place: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  level: '<path d="M3 20h18M5 20l5-9 4 6 3-4 3 7"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14.1H3a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 4.3 7.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  sky: '<path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.8 6 6 0 0 0-11.6 2.3A3.5 3.5 0 0 0 6 19z"/>',
  mario: '<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
};
const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const MARIO_H = 160;

export class AssetsUI {
  constructor({ assets, engine, editor, editorUI, levelsUI, toast, chat }) {
    Object.assign(this, { assets, engine, editor, editorUI, levelsUI, toast, chat });
    this.tab = 'models';
    this.tex = { query: '', group: '', here: true, replaced: false, sel: null };
    this.buildDom();
    this.buildLibrary();
    this.wireDrops();
    if (editorUI) editorUI.assetInspector = { html: (sel, rec) => this.inspectorHtml(sel, rec), wire: (box, sel, rec) => this.inspectorWire(box, sel, rec) };
    assets.on((what) => {
      if (what === 'models' || what === 'meta' || what === 'load' || what === 'spawned') this.renderLibrary();
      if (what === 'materials' && editorUI) {
        // custom materials join the block and terrain material lists
        for (let i = 48; i < 64; i++) { delete editorUI.swatches[`${i}:0`]; delete editorUI.swatches[`${i}:1`]; }
        clearTimeout(this.matTimer);
        this.matTimer = setTimeout(() => { try { editorUI.buildBlocks(); editorUI.buildTerrain(); } catch (err) { console.error(err); } }, 100);
      }
      if (this.isOpen()) this.render(what);
    });
  }

  // ---- shell ---------------------------------------------------------------------

  buildDom() {
    // top bar button, next to the sound studio
    const btn = el('button', 'btn ghost', `${ic(ICON.cube, 'i')}<span class="hide-sm">Assets</span>`);
    btn.id = 'assets-btn';
    btn.title = 'Assets: import 3D models, game textures, materials, sky, Mario colours';
    btn.onclick = () => (this.isOpen() ? this.close() : this.open());
    const sound = $('#sound-btn');
    if (sound) sound.parentNode.insertBefore(btn, sound); else $('.topbar')?.appendChild(btn);

    const d = el('div', 'as-drawer');
    d.id = 'as-drawer';
    d.hidden = true;
    d.innerHTML = `<div class="as-head"><div class="as-title">${ic(ICON.cube, 'i')}Assets</div>
      <div class="as-tabs">${[['models', 'Models'], ['textures', 'Textures'], ['materials', 'Materials'], ['sky', 'Sky'], ['mario', 'Mario']].map(([k, l]) => `<button class="as-tab" data-tab="${k}">${l}</button>`).join('')}</div>
      <button class="btn icon ghost" data-a="close" title="Close (Esc)">${ic(ICON.close, 'i')}</button></div>
      <div class="as-body"></div>`;
    document.body.appendChild(d);
    this.drawer = d;
    d.querySelector('[data-a=close]').onclick = () => this.close();
    d.querySelectorAll('.as-tab').forEach((b) => { b.onclick = () => this.open(b.dataset.tab); });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen() && !document.querySelector('.as-modal, .px-back')) this.close();
    });
  }

  isOpen() { return !this.drawer.hidden; }
  open(tab = this.tab) {
    this.tab = tab;
    this.drawer.hidden = false;
    this.drawer.querySelectorAll('.as-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    this.engine.releaseKeys?.();
    if (tab !== 'mario') this.lookAtMario(false);
    this.render();
  }
  close() {
    this.drawer.hidden = true;
    this.lookAtMario(false);
    this.preview?.stop();
  }

  render() {
    const body = this.drawer.querySelector('.as-body');
    if (!this.assets.loaded) { body.innerHTML = '<div class="as-empty">Loading…</div>'; return; }
    if (this.renderLock) return;
    ({ models: () => this.renderModels(body), textures: () => this.renderTextures(body), materials: () => this.renderMaterials(body), sky: () => this.renderSky(body), mario: () => this.renderMario(body) })[this.tab]?.();
  }

  // Run an async action with a busy state and an error toast.
  async busy(btn, fn) {
    const label = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.classList.add('busy'); }
    try { return await fn(); } catch (err) { console.error(err); this.toast(err.message || String(err), 'x'); return null; } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('busy'); if (label !== undefined && btn.isConnected) btn.innerHTML = label; }
    }
  }

  pickFiles({ accept = '', multiple = true } = {}) {
    return new Promise((resolve) => {
      const inp = el('input');
      inp.type = 'file';
      inp.accept = accept;
      inp.multiple = multiple;
      inp.onchange = () => resolve([...inp.files]);
      inp.click();
    });
  }

  // ---- drag & drop -----------------------------------------------------------------

  wireDrops() {
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    let hint = null;
    window.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      // models can be dropped anywhere; images on the asset drawer
      if (this.drawer.contains(e.target) || e.target.closest?.('#lib-models')) { e.preventDefault(); this.drawer.classList.add('drop'); }
      else if (!hint && !e.target.closest?.('.side, .composer, .chat, .launcher, .px-back, .as-modal')) {
        hint = el('div', 'as-drop-hint', `${ic(ICON.cube, 'i')}Drop a 3D model (.glb .gltf .obj .fbx or a .zip, with its textures) to import it`);
        document.body.appendChild(hint);
      }
    });
    window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) { hint?.remove(); hint = null; this.drawer.classList.remove('drop'); } });
    window.addEventListener('drop', (e) => {
      hint?.remove(); hint = null;
      this.drawer.classList.remove('drop');
      const files = [...(e.dataTransfer?.files || [])];
      if (!files.length) return;
      if (files.some(isModelFile)) {
        e.preventDefault();
        e.stopPropagation();
        this.openImport(files);
        return;
      }
      const img = files.find((f) => /^image\//.test(f.type) || /\.(tga)$/i.test(f.name));
      if (img && this.drawer.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        this.droppedImage(img);
      }
    }, true);
  }

  async droppedImage(file) {
    if (this.tab === 'textures' && this.tex.sel) return this.replaceFromFile(this.tex.sel, file);
    if (this.tab === 'sky') return this.skyFromFile(file);
    if (this.tab === 'materials') return this.materialFromFile(file);
    this.toast('Open Textures, Materials or Sky to use a picture', 'x');
  }

  // ---- library tab (build mode) ------------------------------------------------------

  buildLibrary() {
    const tabs = $('#library .lib-tabs');
    if (!tabs || $('#lib-models')) return;
    const t = el('button', 'lib-tab', 'Models');
    t.dataset.lib = 'models';
    t.title = 'Your imported 3D models';
    tabs.appendChild(t);
    const pane = el('div', 'lib-pane');
    pane.id = 'lib-models';
    pane.hidden = true;
    $('#library').appendChild(pane);
    t.addEventListener('click', () => {
      document.querySelectorAll('.lib-tab').forEach((x) => x.classList.toggle('active', x === t));
      if (this.editor?.sel) this.editor.select(null);
      document.querySelectorAll('#library > .lib-pane').forEach((p) => { p.hidden = p.id !== 'lib-models'; });
    });
    this.renderLibrary();
  }

  renderLibrary() {
    const pane = $('#lib-models');
    if (!pane) return;
    const models = this.assets.meta.models;
    pane.innerHTML = `<div class="lib-label">My models <span class="lib-sub">${models.length ? `${models.length}` : ''}</span></div>
      <button class="as-import-btn">${ic(ICON.upload)}<span>Import a 3D model</span><small>.glb .gltf .obj .fbx .zip · or drop files here</small></button>
      <div class="as-lib-grid"></div>
      <div class="lib-tip">Click a model, then click in the level to place it (as often as you like). <kbd>R</kbd> turns it. Big models can become level geometry with full collision: use <b>⋯</b>.</div>`;
    pane.querySelector('.as-import-btn').onclick = async () => {
      const files = await this.pickFiles({ accept: '.glb,.gltf,.obj,.mtl,.fbx,.zip,.bin,.png,.jpg,.jpeg,.tga,.webp' });
      if (files.length) this.openImport(files);
    };
    const grid = pane.querySelector('.as-lib-grid');
    for (const m of models) {
      const c = el('div', 'as-lib-card');
      c.innerHTML = `<button class="as-lib-main" title="Place ${esc(m.name)}">${m.thumb ? `<img src="${esc(m.thumb)}" alt="">` : ic(ICON.cube, 'i big')}<span>${esc(m.name)}</span></button>
        <button class="as-lib-more" title="More">⋯</button>`;
      c.querySelector('.as-lib-main').onclick = () => this.place(m.id, 'prop');
      c.querySelector('.as-lib-more').onclick = (e) => this.modelMenu(m, e.currentTarget);
      grid.appendChild(c);
    }
  }

  modelMenu(m, anchor) {
    document.querySelector('.as-menu')?.remove();
    const menu = el('div', 'as-menu');
    const items = [
      [ICON.place, 'Place as prop', () => this.place(m.id, 'prop')],
      [ICON.level, 'Place as level geometry', () => this.place(m.id, 'level')],
      [ICON.level, 'New level from this model', () => this.newLevelFrom(m)],
      [ICON.gear, 'Settings (materials, collision)', () => this.openSettings(m)],
      [ICON.brush, 'Rename', () => this.rename(m)],
      [ICON.trash, 'Delete', () => this.removeModel(m)],
    ];
    for (const [i, label, fn] of items) {
      const b = el('button', label === 'Delete' ? 'danger' : '', `${ic(i)}${esc(label)}`);
      b.onclick = () => { menu.remove(); fn(); };
      menu.appendChild(b);
    }
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.left = `${Math.min(window.innerWidth - 250, r.left)}px`;
    menu.style.top = `${Math.min(window.innerHeight - 260, r.bottom + 4)}px`;
    setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', off); } }), 0);
  }

  async place(id, mode = 'prop') {
    const m = this.assets.model(id);
    if (!m || !this.editor) return;
    try { await this.assets.ensureModel(m.id); } catch (err) { this.toast(err.message, 'x'); return; }
    if (!this.editor.active) this.editor.enter();
    const d = m.defaults || {};
    this.editor.startPlacing({ asset: { model: m.id, mode, collision: d.collision !== false, anim: mode === 'level' ? 'none' : d.anim || 'none', speed: d.speed || 1 }, name: m.name, scale: d.scale || 1 });
    this.toast(mode === 'level' ? `Click where ${m.name} goes (its origin)` : `Click to place ${m.name}`, 'sparkles');
  }

  async rename(m) {
    const name = await askText({ title: 'Rename model', value: m.name, placeholder: 'Model name', ok: 'Rename' });
    if (name && name.trim()) await this.busy(null, () => this.assets.updateModel(m.id, { name: name.trim().slice(0, 60) }));
  }

  async removeModel(m) {
    const n = this.assets.placementsOf(m.id);
    if (!(await askConfirm({ title: `Delete ${m.name}?`, text: n ? `Its ${n} placement${n > 1 ? 's' : ''} in your levels go too.` : '', ok: 'Delete', danger: true }))) return;
    await this.busy(null, () => this.assets.deleteModel(m.id));
    this.toast(`Deleted ${m.name}`, 'check');
  }

  // A new custom level made of this model, Mario dropping in above its middle.
  async newLevelFrom(m) {
    if (!this.levelsUI) return;
    try { await this.assets.ensureModel(m.id); } catch (err) { this.toast(err.message, 'x'); return; }
    const b = m.bounds || { min: [-500, 0, -500], max: [500, 200, 500] };
    const rec = this.assets.makeRecord(m.id, { x: 0, y: 0, z: 0, yaw: 0 }, { mode: 'level', collision: true });
    const cx = Math.round((b.min[0] + b.max[0]) / 2), cz = Math.round((b.min[2] + b.max[2]) / 2);
    // an invisible death floor far below, like the game's levels have
    const floor = { uid: 1 + Math.floor(Math.random() * 0x7efffffe), block: { shape: 0, sx: 16000, sy: 100, sz: 16000, steps: 0, top: 0, side: 0, surface: 0x0A, flags: 1, color: 0xffffff }, x: 0, y: Math.round(Math.max(-8000, b.min[1] - 2500)), z: 0, yaw: 0, pitch: 0, roll: 0, name: 'Death floor' };
    const area = { objects: [rec, floor], removals: [], warps: [], settings: { sky: 0, music: 3, spawn: { x: cx, y: Math.round(Math.min(30000, b.max[1] + 300)), z: cz, yaw: 0 } } };
    this.levelsUI.createLevel('model', area, m.name);
    this.toast(`New level: ${m.name}`, 'check');
  }

  // ---- inspector section for placed models ---------------------------------------------

  inspectorHtml(sel, rec) {
    const a = rec.asset;
    const m = this.assets.model(a.model);
    return `<div class="insp-sec as-insp"><div class="insp-label">Imported model</div>
      <div class="as-insp-name">${m?.thumb ? `<img src="${esc(m.thumb)}" alt="">` : ''}<span>${esc(m?.name || 'missing model')}</span>${m ? `<button class="btn sm ghost" data-as="settings">${ic(ICON.gear)}Settings</button>` : ''}</div>
      <label class="as-row"><span>Use</span><select data-as="mode"><option value="prop" ${a.mode !== 'level' ? 'selected' : ''}>Prop</option><option value="level" ${a.mode === 'level' ? 'selected' : ''}>Level geometry</option></select></label>
      <label class="as-check"><input type="checkbox" data-as="collision" ${a.collision !== false ? 'checked' : ''}> Solid (Mario can stand on it)</label>
      ${a.mode !== 'level' ? `<label class="as-row"><span>Animation</span><select data-as="anim">${Object.entries(ANIM_NAMES).map(([k, v]) => `<option value="${k}" ${k === (a.anim || 'none') ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      ${a.anim && a.anim !== 'none' ? `<label class="as-row"><span>Speed</span><input type="range" min="0.1" max="4" step="0.1" data-as="speed" value="${a.speed || 1}"><b>${(a.speed || 1).toFixed(1)}×</b></label>` : ''}` : ''}
    </div>`;
  }

  inspectorWire(box, sel, rec) {
    const set = (fields, summary) => this.editor.updateSelected({ asset: { ...rec.asset, ...fields } }, summary);
    box.querySelector('[data-as=settings]')?.addEventListener('click', () => { const m = this.assets.model(rec.asset.model); if (m) this.openSettings(m); });
    box.querySelector('[data-as=mode]')?.addEventListener('change', (e) => set({ mode: e.target.value, ...(e.target.value === 'level' ? { anim: 'none' } : {}) }, `Changed ${sel.name}`));
    box.querySelector('[data-as=collision]')?.addEventListener('change', (e) => set({ collision: e.target.checked }, `Changed ${sel.name} collision`));
    box.querySelector('[data-as=anim]')?.addEventListener('change', (e) => set({ anim: e.target.value }, `Animated ${sel.name}`));
    const sp = box.querySelector('[data-as=speed]');
    if (sp) {
      sp.oninput = () => { sp.nextElementSibling.textContent = `${Number(sp.value).toFixed(1)}×`; };
      sp.onchange = () => set({ speed: Number(sp.value) }, `Changed ${sel.name} speed`);
    }
  }

  // ---- Models tab ---------------------------------------------------------------------

  renderModels(body) {
    const models = this.assets.meta.models;
    body.innerHTML = `<div class="as-drop">
        ${ic(ICON.cube, 'i big')}<div><b>Import a 3D model</b><span>Drop .glb, .gltf (+ .bin), .obj (+ .mtl), binary .fbx or a .zip with the textures here, or</span></div>
        <button class="btn primary" data-a="import">${ic(ICON.upload)}Choose files</button></div>
      <div class="as-section">My models <span>${models.length}</span></div>
      <div class="as-models">${models.length ? '' : '<div class="as-empty">No models yet. Free models: Sketchfab, Poly Pizza, Kenney (export glTF from Blender for the best result).</div>'}</div>`;
    body.querySelector('[data-a=import]').onclick = async () => {
      const files = await this.pickFiles({ accept: '.glb,.gltf,.obj,.mtl,.fbx,.zip,.bin,.png,.jpg,.jpeg,.tga,.webp' });
      if (files.length) this.openImport(files);
    };
    const list = body.querySelector('.as-models');
    for (const m of models) {
      const size = m.bounds ? m.bounds.max.map((v, i) => Math.round(v - m.bounds.min[i])) : [0, 0, 0];
      const n = this.assets.placementsOf(m.id);
      const card = el('div', 'as-model');
      card.innerHTML = `<div class="as-model-pic">${m.thumb ? `<img src="${esc(m.thumb)}" alt="">` : ic(ICON.cube, 'i big')}</div>
        <div class="as-model-info"><div class="as-model-name">${esc(m.name)}</div>
        <div class="as-model-sub">${m.tris.toLocaleString()} triangles · ${size.join(' × ')} units · ${(m.materials || []).length} material${(m.materials || []).length === 1 ? '' : 's'}${n ? ` · placed ${n}×` : ''}</div>
        <div class="as-model-acts">
          <button class="btn sm primary" data-a="prop">${ic(ICON.place)}Place</button>
          <button class="btn sm" data-a="level" title="Level geometry: full collision, large">${ic(ICON.level)}As level</button>
          <button class="btn sm ghost" data-a="settings">${ic(ICON.gear)}Settings</button>
          ${this.placedHere(m.id).length ? `<button class="btn sm ghost" data-a="select" title="Select its placements in this level one after another (level geometry can't be clicked)">Select</button>` : ''}
          <button class="btn sm ghost" data-a="more">⋯</button></div></div>`;
      card.querySelector('[data-a=select]')?.addEventListener('click', () => this.selectPlaced(m.id));
      card.querySelector('[data-a=prop]').onclick = () => this.place(m.id, 'prop');
      card.querySelector('[data-a=level]').onclick = () => this.place(m.id, 'level');
      card.querySelector('[data-a=settings]').onclick = () => this.openSettings(m);
      card.querySelector('[data-a=more]').onclick = (e) => this.modelMenu(m, e.currentTarget);
      list.appendChild(card);
    }
  }

  placedHere(id) { return (this.engine.patch.areas?.[this.engine.areaKey()]?.objects || []).filter((r) => r.asset?.model === id); }

  // Select the next placement of a model in this level (and frame it).
  selectPlaced(id) {
    const recs = this.placedHere(id);
    if (!recs.length || !this.editor) return;
    this.selCycle = ((this.selCycle ?? -1) + 1) % recs.length;
    const rec = recs[this.selCycle];
    const o = this.engine.objects().find((x) => x.uid === rec.uid);
    if (!o) { this.toast('It is still loading', 'x'); return; }
    if (!this.editor.active) this.editor.enter();
    this.editor.select(o.slot);
    this.editor.frameSelection?.();
  }

  // ---- import dialog -------------------------------------------------------------------

  modal(cls, html) {
    const back = el('div', `as-modal ${cls || ''}`);
    back.innerHTML = `<div class="as-modal-win">${html}</div>`;
    document.body.appendChild(back);
    this.engine.releaseKeys?.();
    // the keyboard belongs to the dialog: Esc closes it, and Delete, Tab, R... must not reach
    // the editor behind it
    back.tabIndex = -1;
    back.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); back.querySelector('[data-a=close]')?.click(); }
    });
    setTimeout(() => { if (back.isConnected && !back.contains(document.activeElement)) back.focus({ preventScroll: true }); }, 0);
    return back;
  }

  async openImport(files) {
    const back = this.modal('as-import', `<div class="as-modal-head"><div class="as-title">${ic(ICON.cube, 'i')}Import model</div><span class="as-file"></span>
        <button class="btn icon ghost" data-a="close">${ic(ICON.close, 'i')}</button></div>
      <div class="as-modal-body"><div class="as-pv"><canvas></canvas><div class="as-pv-info"></div><div class="as-pv-hint">Drag to turn · wheel to zoom · red box: Mario</div></div>
      <div class="as-opts"><div class="as-loading"><span class="spin"></span>Reading the model…</div></div></div>
      <div class="as-modal-foot"><div class="as-warn"></div><span class="spacer"></span>
        <button class="btn ghost" data-a="close">Cancel</button>
        <button class="btn" data-a="save" disabled>Save to My models</button>
        <button class="btn primary" data-a="saveplace" disabled>${ic(ICON.place)}Save & place</button></div>`);
    const close = () => { this.importPreview?.dispose(); this.importPreview = null; back.remove(); };
    back.querySelectorAll('[data-a=close]').forEach((b) => { b.onclick = close; });
    back.querySelector('.as-file').textContent = files.map((f) => f.name).join(', ').slice(0, 120);
    let scene;
    try {
      scene = await importModel(files);
    } catch (err) {
      back.querySelector('.as-opts').innerHTML = `<div class="as-error"><b>Could not import this model</b><p>${esc(err.message)}</p></div>`;
      return;
    }
    const pv = new ModelPreview(back.querySelector('.as-pv canvas'));
    this.importPreview = pv;
    pv.start();
    // first guess of the size: a person-sized thing should be about Mario's size, a level a few thousand units
    const raw = this.rawBounds(scene);
    const rawH = raw.max[1] - raw.min[1], rawMax = Math.max(raw.max[0] - raw.min[0], rawH, raw.max[2] - raw.min[2]) || 1;
    let scale = scene.format === 'fbx' ? (scene.unit || 1) : scene.format === 'gltf' || scene.format === 'glb' ? 100 : 1;
    if (scene.format === 'obj') scale = rawMax < 20 ? 100 : 1;
    if (rawMax * scale > 30000) scale = 30000 / rawMax;
    const big = rawMax * scale > 2500 || scene.tris > 3000;
    const o = {
      name: scene.name.replace(/[_-]+/g, ' ').trim() || 'Model', scale: Number(scale.toPrecision(4)), rotate: [0, 0, 0], zUp: scene.upAxis === 'z',
      origin: 'bottom', texMax: 64, texFormat: 'rgba16', lighting: 'baked', use: big ? 'level' : 'prop', collision: true,
    };
    let pkg = null, mats = null, building = 0;
    const opts = back.querySelector('.as-opts');
    const rebuild = async () => {
      const my = ++building;
      opts.classList.add('working');
      try {
        const p = await buildPackage(scene, { scale: o.scale, rotate: o.rotate, zUp: o.zUp, origin: o.origin, texMax: o.texMax, texFormat: o.texFormat });
        if (my !== building) return;
        const fresh = defaultMaterialMeta(p);
        mats = mats ? fresh.map((d, i) => ({ ...d, ...(mats[i] || {}) })) : fresh;
        pkg = p;
        pv.setPackage(pkg, { materials: mats, lighting: o.lighting });
        info();
        back.querySelectorAll('[data-a=save],[data-a=saveplace]').forEach((b) => { b.disabled = false; });
      } catch (err) {
        back.querySelector('.as-warn').textContent = err.message;
        back.querySelectorAll('[data-a=save],[data-a=saveplace]').forEach((b) => { b.disabled = true; });
      } finally { if (my === building) opts.classList.remove('working'); }
    };
    const info = () => {
      if (!pkg) return;
      const s = pkg.bounds.max.map((v, i) => v - pkg.bounds.min[i]);
      const texs = pkg.materials.filter((m) => m.tex);
      back.querySelector('.as-pv-info').innerHTML = `<b>${Math.round(s[0])} × ${Math.round(s[1])} × ${Math.round(s[2])}</b> units · ${(s[1] / MARIO_H).toFixed(1)} Marios tall<br>
        ${pkg.tris.toLocaleString()} triangles · ${pkg.materials.filter((m) => m.used).length} materials · ${texs.length} textures${texs.length ? ` (${[...new Set(texs.map((t) => `${t.tex.w}×${t.tex.h}`))].join(', ')})` : ''}`;
      const warn = [...(scene.warnings || [])];
      if (pkg.tris > 20000) warn.push(`${pkg.tris.toLocaleString()} triangles is a lot for an N64-style level; it works, but consider decimating.`);
      const ext = Math.max(...pkg.bounds.max.map(Math.abs), ...pkg.bounds.min.map(Math.abs));
      if (ext > 16000 && o.use === 'level') warn.push('Collision only works within ±16384 units of the level center: parts further out are not solid.');
      back.querySelector('.as-warn').innerHTML = warn.map(esc).join('<br>');
      renderMats();
    };
    const renderMats = () => {
      const box = opts.querySelector('.as-mats');
      if (!box || !pkg) return;
      box.innerHTML = '';
      pkg.materials.forEach((m, i) => {
        if (!m.used) return;
        box.appendChild(this.materialRow(m, mats[i], () => pv.setPackage(pkg, { materials: mats, lighting: o.lighting })));
      });
    };
    opts.innerHTML = `
      <label class="as-row"><span>Name</span><input type="text" data-o="name" value="${esc(o.name)}" maxlength="60"></label>
      <div class="as-row"><span>Use as</span><div class="seg">
        <button class="seg-btn" data-use="prop" title="Placeable many times; optional collision and animation">Prop</button>
        <button class="seg-btn" data-use="level" title="Level geometry: full mesh collision, any size">Level geometry</button></div></div>
      <div class="as-group">Size</div>
      <label class="as-row"><span>Scale</span><input type="number" data-o="scale" value="${o.scale}" step="0.1" min="0.001"><span class="unit">×</span></label>
      <label class="as-row"><span>Height</span><input type="number" data-o="height" step="10" min="1"><span class="unit">units</span>
        <button class="btn sm ghost" data-fit="160" title="As tall as Mario">Mario</button><button class="btn sm ghost" data-fit="600" title="A house">House</button><button class="btn sm ghost" data-fit="3000" title="A hill or castle">Hill</button></label>
      <div class="as-group">Orientation</div>
      <div class="as-row"><span>Up axis</span><div class="seg"><button class="seg-btn" data-up="y">Y up</button><button class="seg-btn" data-up="z">Z up (Blender, 3ds Max)</button></div></div>
      <div class="as-row"><span>Turn</span>${['X', 'Y', 'Z'].map((a, i) => `<button class="btn sm" data-rot="${i}">${a} +90°</button>`).join('')}<button class="btn sm ghost" data-rot="reset">Reset</button></div>
      <label class="as-row"><span>Origin</span><select data-o="origin"><option value="bottom">Bottom center (stands on the ground)</option><option value="center">Center</option><option value="file">As in the file</option></select></label>
      <div class="as-group">Textures</div>
      <label class="as-row"><span>Max size</span><select data-o="texMax">${[32, 64, 128, 256, 512].map((s) => `<option value="${s}" ${s === o.texMax ? 'selected' : ''}>${s}×${s}${s <= 64 ? ' (N64)' : s === 128 ? ' (sharper)' : ' (HD)'}</option>`).join('')}</select></label>
      <label class="as-row"><span>Format</span><select data-o="texFormat">${Object.entries(TEX_FORMATS).map(([k, v]) => `<option value="${k}" ${k === o.texFormat ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
      <label class="as-row"><span>Light</span><select data-o="lighting"><option value="baked">Shaded like the game</option><option value="flat">Flat (vertex colours only)</option></select></label>
      <div class="as-group">Materials <span class="as-hint">surface type = how Mario reacts to it</span></div>
      <div class="as-mats"></div>`;
    const syncSeg = () => {
      opts.querySelectorAll('[data-use]').forEach((b) => b.classList.toggle('active', b.dataset.use === o.use));
      opts.querySelectorAll('[data-up]').forEach((b) => b.classList.toggle('active', (b.dataset.up === 'z') === o.zUp));
      opts.querySelector('[data-o=origin]').value = o.origin;
      opts.querySelector('[data-o=lighting]').value = o.lighting;
      opts.querySelector('[data-o=scale]').value = o.scale;
      if (pkg) opts.querySelector('[data-o=height]').value = Math.round(pkg.bounds.max[1] - pkg.bounds.min[1]);
    };
    let timer = null;
    const later = () => { clearTimeout(timer); timer = setTimeout(async () => { await rebuild(); syncSeg(); }, 180); };
    opts.querySelector('[data-o=name]').oninput = (e) => { o.name = e.target.value; };
    opts.querySelector('[data-o=scale]').onchange = (e) => { const v = Number(e.target.value); if (v > 0) { o.scale = v; later(); } };
    opts.querySelector('[data-o=height]').onchange = (e) => {
      const v = Number(e.target.value);
      if (v > 0 && pkg) { o.scale = Math.round(o.scale * (v / Math.max(1, pkg.bounds.max[1] - pkg.bounds.min[1])) * 10000) / 10000; later(); }
    };
    opts.querySelectorAll('[data-fit]').forEach((b) => { b.onclick = () => { opts.querySelector('[data-o=height]').value = b.dataset.fit; opts.querySelector('[data-o=height]').onchange({ target: { value: b.dataset.fit } }); }; });
    opts.querySelectorAll('[data-use]').forEach((b) => { b.onclick = () => { o.use = b.dataset.use; syncSeg(); info(); }; });
    opts.querySelectorAll('[data-up]').forEach((b) => { b.onclick = () => { o.zUp = b.dataset.up === 'z'; syncSeg(); later(); }; });
    opts.querySelectorAll('[data-rot]').forEach((b) => {
      b.onclick = () => {
        if (b.dataset.rot === 'reset') o.rotate = [0, 0, 0];
        else o.rotate[Number(b.dataset.rot)] = (o.rotate[Number(b.dataset.rot)] + 90) % 360;
        later();
      };
    });
    for (const k of ['origin', 'texMax', 'texFormat']) opts.querySelector(`[data-o=${k}]`).onchange = (e) => { o[k] = k === 'texMax' ? Number(e.target.value) : e.target.value; later(); };
    opts.querySelector('[data-o=lighting]').onchange = (e) => { o.lighting = e.target.value; if (pkg) pv.setPackage(pkg, { materials: mats, lighting: o.lighting }); };
    await rebuild();
    syncSeg();

    const save = async (andPlace) => {
      if (!pkg) return;
      const bytes = await encodePackage(pkg);
      const thumb = thumbnail(pkg, { materials: mats, lighting: o.lighting });
      const meta = await this.assets.addModel({
        bytes, pkg, name: o.name || scene.name, materials: mats, lighting: o.lighting, thumb,
        source: { files: files.map((f) => f.name).slice(0, 20), format: scene.format, scale: o.scale, rotate: o.rotate, zUp: o.zUp, origin: o.origin },
      });
      if (o.use === 'level') await this.assets.updateModel(meta.id, { defaults: { ...meta.defaults, mode: 'level' } });
      this.toast(`${meta.name} is in My models (${fmtSize(bytes.length)})`, 'check');
      close();
      this.renderLibrary();
      if (this.isOpen()) this.render();
      if (andPlace) this.place(meta.id, o.use);
    };
    back.querySelector('[data-a=save]').onclick = (e) => this.busy(e.currentTarget, () => save(false));
    back.querySelector('[data-a=saveplace]').onclick = (e) => this.busy(e.currentTarget, () => save(true));
  }

  rawBounds(scene) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const zUp = scene.upAxis === 'z';
    for (const m of scene.meshes) {
      const p = m.positions;
      for (let i = 0; i < p.length; i += 3) {
        const v = zUp ? [p[i], p[i + 2], p[i + 1]] : [p[i], p[i + 1], p[i + 2]];
        for (let a = 0; a < 3; a++) { if (v[a] < min[a]) min[a] = v[a]; if (v[a] > max[a]) max[a] = v[a]; }
      }
    }
    return { min, max };
  }

  // One material's game settings (surface, transparency, sides, wrap).
  materialRow(m, s, onChange) {
    const row = el('div', 'as-mat');
    const sw = m.tex ? toDataURL(m.tex.rgba, m.tex.w, m.tex.h) : null;
    const c = m.color || [1, 1, 1, 1];
    row.innerHTML = `<div class="as-mat-sw" style="${sw ? `background-image:url(${sw})` : `background:${hex(c.slice(0, 3).map((v) => v * 255))}`}"></div>
      <div class="as-mat-main"><div class="as-mat-name" title="${esc(m.name)}">${esc(m.name)}${m.tex ? ` <small>${m.tex.w}×${m.tex.h}</small>` : ''}</div>
      <div class="as-mat-opts">
        <select data-m="surface" title="Surface: how Mario reacts">${Object.entries(SURFACE_NAMES).map(([k, v]) => `<option value="${k}" ${k === s.surface ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
        <select data-m="alpha" title="Transparency"><option value="opaque">Solid</option><option value="cutout">Cut-out (leaves, fences)</option><option value="blend">See-through (glass, water)</option></select>
        <label class="as-mini"><input type="checkbox" data-m="double" ${s.double ? 'checked' : ''}> 2-sided</label>
        ${m.tex ? `<select data-m="wrapS" title="Horizontal texture repeat"><option value="repeat">↔ Repeat</option><option value="mirror">↔ Mirror</option><option value="clamp">↔ Clamp</option></select>
        <select data-m="wrapT" title="Vertical texture repeat"><option value="repeat">↕ Repeat</option><option value="mirror">↕ Mirror</option><option value="clamp">↕ Clamp</option></select>` : ''}
      </div></div>`;
    row.querySelector('[data-m=alpha]').value = s.alpha;
    if (m.tex) { row.querySelector('[data-m=wrapS]').value = s.wrapS || 'repeat'; row.querySelector('[data-m=wrapT]').value = s.wrapT || 'repeat'; }
    row.querySelectorAll('[data-m]').forEach((inp) => {
      inp.onchange = () => {
        s[inp.dataset.m] = inp.type === 'checkbox' ? inp.checked : inp.value;
        if (inp.dataset.m === 'surface' && inp.value === 'water' && s.alpha === 'opaque') { s.alpha = 'blend'; row.querySelector('[data-m=alpha]').value = 'blend'; }
        onChange();
      };
    });
    return row;
  }

  // Edit an imported model's material settings (and defaults) after the fact.
  async openSettings(m) {
    const back = this.modal('as-import', `<div class="as-modal-head"><div class="as-title">${ic(ICON.gear, 'i')}${esc(m.name)}</div><span class="as-file">${m.tris.toLocaleString()} triangles</span>
        <button class="btn icon ghost" data-a="close">${ic(ICON.close, 'i')}</button></div>
      <div class="as-modal-body"><div class="as-pv"><canvas></canvas><div class="as-pv-hint">Drag to turn · wheel to zoom</div></div>
      <div class="as-opts"><div class="as-loading"><span class="spin"></span>Loading…</div></div></div>
      <div class="as-modal-foot"><span class="spacer"></span><button class="btn ghost" data-a="close">Cancel</button><button class="btn primary" data-a="save">Save</button></div>`);
    const pv = new ModelPreview(back.querySelector('canvas'));
    pv.start();
    const close = () => { pv.dispose(); back.remove(); };
    back.querySelectorAll('[data-a=close]').forEach((b) => { b.onclick = close; });
    let pkg;
    try { pkg = await decodePackage(await this.assets.fileBytes(m.file)); } catch (err) { back.querySelector('.as-opts').innerHTML = `<div class="as-error">${esc(err.message)}</div>`; return; }
    const mats = (m.materials || defaultMaterialMeta(pkg)).map((x) => ({ ...x }));
    const d = { mode: 'prop', collision: true, anim: 'none', speed: 1, scale: 1, ...(m.defaults || {}) };
    let lighting = m.lighting || 'baked';
    const opts = back.querySelector('.as-opts');
    opts.innerHTML = `<label class="as-row"><span>Light</span><select data-o="lighting"><option value="baked">Shaded like the game</option><option value="flat">Flat (vertex colours only)</option></select></label>
      <div class="as-group">New placements</div>
      <label class="as-row"><span>Use as</span><select data-d="mode"><option value="prop">Prop</option><option value="level">Level geometry</option></select></label>
      <label class="as-check"><input type="checkbox" data-d="collision" ${d.collision ? 'checked' : ''}> Solid (collision)</label>
      <label class="as-row"><span>Animation</span><select data-d="anim">${Object.entries(ANIM_NAMES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
      <label class="as-row"><span>Scale</span><input type="number" data-d="scale" value="${d.scale}" step="0.1" min="0.05"><span class="unit">×</span></label>
      <div class="as-group">Materials</div><div class="as-mats"></div>
      <div class="as-tip">Changing materials updates every placement. Moving props (animated) collide with a simplified shape.</div>`;
    opts.querySelector('[data-o=lighting]').value = lighting;
    opts.querySelector('[data-d=mode]').value = d.mode;
    opts.querySelector('[data-d=anim]').value = d.anim;
    const redraw = () => pv.setPackage(pkg, { materials: mats, lighting });
    opts.querySelector('[data-o=lighting]').onchange = (e) => { lighting = e.target.value; redraw(); };
    opts.querySelectorAll('[data-d]').forEach((inp) => { inp.onchange = () => { d[inp.dataset.d] = inp.type === 'checkbox' ? inp.checked : inp.dataset.d === 'scale' ? Math.max(0.05, Number(inp.value) || 1) : inp.value; }; });
    const box = opts.querySelector('.as-mats');
    pkg.materials.forEach((pm, i) => { if (pm.used !== false) box.appendChild(this.materialRow(pm, mats[i] ||= defaultMaterialMeta(pkg)[i], redraw)); });
    redraw();
    back.querySelector('[data-a=save]').onclick = (e) => this.busy(e.currentTarget, async () => {
      await this.assets.updateModel(m.id, { materials: mats, lighting, defaults: d, thumb: thumbnail(pkg, { materials: mats, lighting }) });
      this.toast(`Saved ${m.name}`, 'check');
      close();
    });
  }

  // ---- Textures tab ---------------------------------------------------------------------

  async renderTextures(body) {
    const t = this.tex;
    body.innerHTML = `<div class="as-tex-top">
        <div class="as-search">${ic(ICON.search)}<input type="search" placeholder="Search 1,200 textures…" value="${esc(t.query)}"></div>
        <select class="as-group-sel"><option value="">All groups</option></select>
        <label class="as-toggle"><input type="checkbox" data-f="here" ${t.here ? 'checked' : ''}> In this level</label>
        <label class="as-toggle"><input type="checkbox" data-f="replaced" ${t.replaced ? 'checked' : ''}> Replaced</label></div>
      <div class="as-tex-detail"></div>
      <div class="as-tex-grid"><div class="as-loading"><span class="spin"></span>Finding the game's textures…</div></div>`;
    const list = await this.assets.catalog();
    await this.assets.locate();
    if (this.tab !== 'textures' || !body.isConnected) return;
    const sel = body.querySelector('.as-group-sel');
    for (const g of [...new Set(list.map((x) => x.group))]) sel.appendChild(new Option(g, g, false, g === t.group));
    body.querySelector('.as-search input').oninput = (e) => { t.query = e.target.value; this.fillTexGrid(body); };
    sel.onchange = () => { t.group = sel.value; this.fillTexGrid(body); };
    body.querySelectorAll('[data-f]').forEach((c) => { c.onchange = () => { t[c.dataset.f] = c.checked; this.fillTexGrid(body); }; });
    this.fillTexGrid(body);
    this.renderTexDetail(body);
  }

  async fillTexGrid(body) {
    const t = this.tex;
    const grid = body.querySelector('.as-tex-grid');
    const list = await this.assets.catalog();
    const seen = t.here ? this.assets.seenPaths() : null;
    const words = t.query.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = list.filter((x) => x.addr !== undefined && (!t.group || x.group === t.group) && (!seen || seen.has(x.path))
      && (!t.replaced || this.assets.meta.textures[x.path]) && words.every((w) => `${x.path} ${x.group}`.toLowerCase().includes(w)));
    grid.innerHTML = shown.length ? '' : `<div class="as-empty">${t.here ? 'Nothing drawn here matches. Turn off “In this level” to see every texture.' : 'No texture matches.'}</div>`;
    const io = new IntersectionObserver((ents) => {
      for (const en of ents) {
        if (!en.isIntersecting) continue;
        io.unobserve(en.target);
        const tx = en.target._tex;
        this.assets.texturePixels(tx).then((img) => { if (img) en.target.querySelector('.as-tex-pic').style.backgroundImage = `url(${toDataURL(img.rgba, img.w, img.h)})`; });
      }
    }, { root: grid });
    for (const x of shown.slice(0, 900)) {
      const b = el('button', `as-tex${this.assets.meta.textures[x.path] ? ' replaced' : ''}${t.sel?.path === x.path ? ' active' : ''}`);
      b.title = `${x.path}\n${x.w}×${x.h} ${x.fmt.toUpperCase()}${x.bits}`;
      b.innerHTML = `<span class="as-tex-pic"></span><span class="as-tex-name">${esc(x.name)}</span>`;
      b._tex = x;
      b.onclick = () => { t.sel = x; grid.querySelectorAll('.as-tex.active').forEach((y) => y.classList.remove('active')); b.classList.add('active'); this.renderTexDetail(body); };
      grid.appendChild(b);
      io.observe(b);
    }
    if (shown.length > 900) grid.appendChild(el('div', 'as-empty', `${shown.length - 900} more: search to narrow it down`));
  }

  async renderTexDetail(body) {
    const box = body.querySelector('.as-tex-detail');
    const x = this.tex.sel;
    if (!x || !box) { if (box) box.innerHTML = '<div class="as-tip">Pick a texture to replace it with a picture, paint it pixel by pixel or recolour it. Drop an image here to replace the selected one.</div>'; return; }
    const r = this.assets.meta.textures[x.path];
    const orig = this.assets.originalPixels(x);
    const cur = await this.assets.texturePixels(x);
    if (this.tex.sel !== x) return;
    box.innerHTML = `<div class="as-td"><div class="as-td-pics">
        <div><canvas class="as-td-orig"></canvas><span>Original</span></div>
        ${r ? '<div><canvas class="as-td-cur"></canvas><span>Yours</span></div>' : ''}</div>
      <div class="as-td-info"><div class="as-td-name">${esc(x.name)}</div><div class="as-td-sub">${esc(x.group)} · ${x.w}×${x.h} · ${x.fmt.toUpperCase()}${x.bits}${x.dupes ? ` · shared by ${x.dupes} copies` : ''}</div>
      <div class="as-td-path">${esc(x.path)}</div>
      <div class="as-td-acts">
        <button class="btn sm primary" data-a="upload">${ic(ICON.upload)}Replace with image…</button>
        <button class="btn sm" data-a="paint">${ic(ICON.brush)}Edit pixels</button>
        <button class="btn sm" data-a="recolor">${ic(ICON.palette)}Recolour</button>
        <button class="btn sm" data-a="material" title="Use it on blocks and terrain">Use on blocks</button>
        ${r ? `<button class="btn sm ghost" data-a="reset">${ic(ICON.reset)}Original</button>` : ''}</div></div></div>
      <div class="as-recolor" hidden></div>`;
    const draw = (cv, img) => {
      const s = Math.max(1, Math.floor(96 / Math.max(img.w, img.h)));
      const c = toCanvas(img.rgba, img.w, img.h, s);
      cv.width = c.width; cv.height = c.height;
      cv.getContext('2d').drawImage(c, 0, 0);
    };
    if (orig) draw(box.querySelector('.as-td-orig'), orig);
    if (r && cur) draw(box.querySelector('.as-td-cur'), cur);
    box.querySelector('[data-a=upload]').onclick = async () => { const [f] = await this.pickFiles({ accept: 'image/*,.tga', multiple: false }); if (f) this.replaceFromFile(x, f); };
    box.querySelector('[data-a=paint]').onclick = async () => {
      const res = await openPixelEditor({ title: `Edit ${x.name}`, rgba: cur.rgba, w: cur.w, h: cur.h, original: orig, format: x.fmt === 'rgba' && x.bits === 16 ? 'rgba16' : x.fmt === 'ia' ? 'ia8' : 'rgba32' });
      if (res) await this.busy(null, async () => { await this.assets.replaceTexture(x, res.rgba, res.w, res.h, 'painted'); this.toast(`Replaced ${x.name}`, 'check'); this.render(); });
    };
    box.querySelector('[data-a=recolor]').onclick = () => this.recolorPanel(box.querySelector('.as-recolor'), x, orig);
    box.querySelector('[data-a=material]').onclick = () => this.busy(null, async () => {
      const i = await this.assets.saveMaterial({ name: x.name, rgba: cur.rgba, w: cur.w, h: cur.h, sharp: cur.w > 32 });
      this.toast(`“${x.name}” is now block material #${i}`, 'check');
    });
    box.querySelector('[data-a=reset]')?.addEventListener('click', () => this.busy(null, async () => { await this.assets.resetTexture(x); this.render(); }));
  }

  recolorPanel(box, x, orig) {
    if (!orig) return;
    box.hidden = !box.hidden;
    if (box.hidden) return;
    const p = { hue: 0, saturation: 1, brightness: 1, contrast: 1, tint: '#ff4040', tint_amount: 0 };
    box.innerHTML = `<canvas class="as-rc-pv"></canvas><div class="as-rc-sliders">
      <label><span>Hue</span><input type="range" min="-180" max="180" value="0" data-p="hue"></label>
      <label><span>Saturation</span><input type="range" min="0" max="3" step="0.05" value="1" data-p="saturation"></label>
      <label><span>Brightness</span><input type="range" min="0.2" max="2" step="0.05" value="1" data-p="brightness"></label>
      <label><span>Contrast</span><input type="range" min="0.2" max="2.5" step="0.05" value="1" data-p="contrast"></label>
      <label><span>Tint</span><input type="color" value="${p.tint}" data-p="tint"><input type="range" min="0" max="1" step="0.05" value="0" data-p="tint_amount"></label>
      <div class="as-row"><button class="btn sm primary" data-a="apply">Apply</button><button class="btn sm ghost" data-a="cancel">Cancel</button></div></div>`;
    const cv = box.querySelector('canvas');
    const draw = () => {
      const img = recolor(orig.rgba, p);
      const s = Math.max(1, Math.floor(96 / Math.max(orig.w, orig.h)));
      const c = toCanvas(img, orig.w, orig.h, s);
      cv.width = c.width; cv.height = c.height;
      cv.getContext('2d').drawImage(c, 0, 0);
      return img;
    };
    box.querySelectorAll('[data-p]').forEach((inp) => { inp.oninput = () => { p[inp.dataset.p] = inp.type === 'color' ? inp.value : Number(inp.value); draw(); }; });
    draw();
    box.querySelector('[data-a=cancel]').onclick = () => { box.hidden = true; };
    box.querySelector('[data-a=apply]').onclick = (e) => this.busy(e.currentTarget, async () => {
      await this.assets.replaceTexture(x, draw(), orig.w, orig.h, 'recoloured');
      this.toast(`Recoloured ${x.name}`, 'check');
      this.render();
    });
  }

  async replaceFromFile(x, file) {
    const big = await createImageBitmap(file).then((b) => b.width >= x.w * 2 || b.height >= x.h * 2).catch(() => false);
    const hd = big && await askChoice({ title: 'How sharp should it be?', text: `The picture is bigger than the game's ${x.w}×${x.h} texture.`, choices: [{ id: 'hd', label: 'Keep it sharp', sub: `Up to ${x.w * 4}×${x.h * 4}, uses more memory` }, { id: 'n64', label: 'N64 size', sub: `${x.w}×${x.h}, like the original` }] });
    if (big && !hd) return;
    await this.busy(null, async () => {
      const bmp = await createImageBitmap(file);
      // the game's size by default; bigger pictures may stay sharper (up to 4x)
      const keepHd = hd === 'hd';
      const w = keepHd ? Math.min(x.w * 4, pow2(bmp.width, 512)) : x.w, h = keepHd ? Math.min(x.h * 4, pow2(bmp.height, 512)) : x.h;
      const rgba = rasterize(bmp, w, h);
      if (!keepHd) quantize(rgba, x.fmt === 'rgba' && x.bits === 16 ? 'rgba16' : x.fmt === 'ia' ? 'rgba32' : 'rgba16');
      await this.assets.replaceTexture(x, rgba, w, h, file.name);
      this.toast(`Replaced ${x.name}`, 'check');
      this.render();
    });
  }

  // ---- Materials tab -------------------------------------------------------------------

  renderMaterials(body) {
    const mats = this.assets.meta.materials || [];
    body.innerHTML = `<div class="as-tip">Your own textures for blocks and terrain painting. They show up at the end of the material lists in build mode (16 slots). Tip: in <b>Textures</b>, “Use on blocks” turns any game texture into one.</div>
      <div class="as-new-mat">
        <button class="btn sm primary" data-a="image">${ic(ICON.image)}From an image…</button>
        <button class="btn sm" data-a="draw">${ic(ICON.brush)}Draw one</button>
        <button class="btn sm" data-a="pattern">${ic(ICON.sparkle)}Pattern</button></div>
      <div class="as-pattern" hidden></div>
      <div class="as-mat-grid"></div>`;
    const grid = body.querySelector('.as-mat-grid');
    if (!mats.length) grid.innerHTML = '<div class="as-empty">No custom materials yet.</div>';
    for (const m of mats) {
      const c = el('div', 'as-cmat');
      c.innerHTML = `<span class="as-cmat-sw"></span><div class="as-cmat-main"><input type="text" value="${esc(m.name)}" maxlength="40" title="Name">
        <div class="as-cmat-sub">#${48 + m.slot} · ${m.w}×${m.h}${m.w > 32 ? ` · <label><input type="checkbox" data-a="sharp" ${m.sharp ? 'checked' : ''}> sharp</label>` : ''}</div></div>
        <button class="btn sm ghost" data-a="edit" title="Edit pixels">${ic(ICON.brush)}</button><button class="btn sm ghost danger" data-a="del" title="Delete">${ic(ICON.trash)}</button>`;
      this.assets.fileRGBA(m.file).then((img) => { c.querySelector('.as-cmat-sw').style.backgroundImage = `url(${toDataURL(img.rgba, img.w, img.h)})`; c._img = img; });
      c.querySelector('input[type=text]').onchange = (e) => this.busy(null, async () => {
        const list = this.assets.meta.materials.map((x) => (x.slot === m.slot ? { ...x, name: e.target.value.trim() || x.name } : x));
        await this.assets.save('materials', list);
        this.assets.applyMaterials();
      });
      c.querySelector('[data-a=sharp]')?.addEventListener('change', (e) => this.busy(null, async () => {
        await this.assets.save('materials', this.assets.meta.materials.map((x) => (x.slot === m.slot ? { ...x, sharp: e.target.checked } : x)));
        this.assets.applyMaterials();
      }));
      c.querySelector('[data-a=edit]').onclick = async () => {
        const img = c._img || await this.assets.fileRGBA(m.file);
        const res = await openPixelEditor({ title: `Edit ${m.name}`, rgba: img.rgba, w: img.w, h: img.h, format: 'rgba16' });
        if (res) await this.busy(null, () => this.assets.saveMaterial({ slot: m.slot, name: m.name, rgba: res.rgba, w: res.w, h: res.h, sharp: m.sharp }));
      };
      c.querySelector('[data-a=del]').onclick = async () => { if (await askConfirm({ title: `Delete material “${m.name}”?`, text: 'Blocks using it turn white.', ok: 'Delete', danger: true })) this.busy(null, () => this.assets.deleteMaterial(m.slot)); };
      grid.appendChild(c);
    }
    body.querySelector('[data-a=image]').onclick = async () => { const [f] = await this.pickFiles({ accept: 'image/*,.tga', multiple: false }); if (f) this.materialFromFile(f); };
    body.querySelector('[data-a=draw]').onclick = async () => {
      const res = await openPixelEditor({ title: 'New material', rgba: pattern('noise', 32, 32, { a: '#7a9a4a', b: '#5a7a34' }), w: 32, h: 32, format: 'rgba16' });
      if (res) await this.busy(null, () => this.assets.saveMaterial({ name: 'My material', rgba: res.rgba, w: res.w, h: res.h }));
    };
    body.querySelector('[data-a=pattern]').onclick = () => this.patternPanel(body.querySelector('.as-pattern'));
  }

  patternPanel(box) {
    box.hidden = !box.hidden;
    if (box.hidden) return;
    const p = { kind: 'bricks', a: '#b0503a', b: '#e8dccb', scale: 1, size: 32 };
    box.innerHTML = `<canvas width="96" height="96"></canvas><div class="as-rc-sliders">
      <label><span>Pattern</span><select data-p="kind">${PATTERNS.map((k) => `<option ${k === p.kind ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
      <label><span>Colours</span><input type="color" data-p="a" value="${p.a}"><input type="color" data-p="b" value="${p.b}"></label>
      <label><span>Scale</span><input type="range" min="0.5" max="4" step="0.5" value="1" data-p="scale"></label>
      <label><span>Size</span><select data-p="size"><option>32</option><option>64</option></select></label>
      <label><span>Name</span><input type="text" data-p="name" value="Bricks"></label>
      <div class="as-row"><button class="btn sm primary" data-a="add">Add material</button></div></div>`;
    const cv = box.querySelector('canvas');
    const draw = () => {
      const img = quantize(pattern(p.kind, Number(p.size), Number(p.size), p), 'rgba16');
      const c = toCanvas(img, Number(p.size), Number(p.size));
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = false;
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) g.drawImage(c, x * 48, y * 48, 48, 48);
      return img;
    };
    box.querySelectorAll('[data-p]').forEach((inp) => { inp.oninput = () => { p[inp.dataset.p] = inp.dataset.p === 'scale' ? Number(inp.value) : inp.value; if (inp.dataset.p === 'kind') box.querySelector('[data-p=name]').value = inp.value[0].toUpperCase() + inp.value.slice(1); draw(); }; });
    draw();
    box.querySelector('[data-a=add]').onclick = (e) => this.busy(e.currentTarget, async () => {
      const s = Number(p.size);
      const i = await this.assets.saveMaterial({ name: box.querySelector('[data-p=name]').value || p.kind, rgba: draw(), w: s, h: s, sharp: s > 32 });
      this.toast(`Added material #${i}`, 'check');
    });
  }

  async materialFromFile(file) {
    await this.busy(null, async () => {
      const bmp = await createImageBitmap(file);
      const s = bmp.width >= 64 && bmp.height >= 64 ? 64 : 32;
      const rgba = quantize(rasterize(bmp, s, s), 'rgba16');
      const i = await this.assets.saveMaterial({ name: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), rgba, w: s, h: s, sharp: s > 32 });
      this.toast(`Added material #${i}`, 'check');
    });
  }

  // ---- Sky tab ---------------------------------------------------------------------------

  renderSky(body) {
    const key = this.engine.areaKey();
    const mine = this.assets.meta.skies?.[key];
    const all = this.assets.meta.skies?.['*'];
    const cur = this.assets.skyFor(key);
    const g = this.skyGen ||= { top: '#2a6fd6', horizon: '#bfe3ff', bottom: '#8fb0c8', clouds: 0.5, sun: true, stars: 0, mountains: 0.5, mountain_color: '#4f7a5a', seed: 3 };
    body.innerHTML = `<div class="as-sky-now"><canvas class="as-sky-pv"></canvas><div>
        <div class="as-td-name">${cur ? esc(cur.name) : 'The level’s own sky'}</div>
        <div class="as-td-sub">${mine ? 'This level' : all ? 'All levels (no sky of its own here)' : 'No custom sky here'}${cur ? ` · ${cur.quality === 'hd' ? 'sharp' : 'N64'} quality` : ''}</div>
        <div class="as-td-acts">${mine ? `<button class="btn sm ghost" data-a="clear">${ic(ICON.reset)}Remove from this level</button>` : ''}${all ? `<button class="btn sm ghost" data-a="clearall">${ic(ICON.reset)}Remove from all levels</button>` : ''}</div></div></div>
      <div class="as-tip">Skies show in levels that have a skybox (outdoor levels and your own levels). Inside the castle the background is a plain colour.</div>
      <div class="as-section">From a picture</div>
      <div class="as-sky-up">
        <label class="as-row"><span>Picture</span><select data-s="mode"><option value="panorama">360° panorama (2:1)</option><option value="picture">Any picture (mirrored around)</option></select></label>
        <label class="as-row"><span>Horizon</span><input type="range" min="-0.3" max="0.3" step="0.02" value="0" data-s="horizon"></label>
        <label class="as-row"><span>Quality</span><select data-s="quality"><option value="n64">N64 (32 px tiles)</option><option value="hd">Sharp (64 px tiles)</option></select></label>
        <label class="as-row"><span>For</span><select data-s="scope"><option value="here">This level</option><option value="all">All levels</option></select></label>
        <button class="btn primary" data-a="upload">${ic(ICON.upload)}Choose a picture…</button><span class="as-hint">or drop one here</span></div>
      <div class="as-section">Make one</div>
      <div class="as-sky-gen"><canvas class="as-gen-pv" width="512" height="256"></canvas><div class="as-rc-sliders">
        <label><span>Sky</span><input type="color" data-g="top" value="${g.top}"><input type="color" data-g="horizon" value="${g.horizon}"><input type="color" data-g="bottom" value="${g.bottom}"></label>
        <label><span>Clouds</span><input type="range" min="0" max="1.5" step="0.05" data-g="clouds" value="${g.clouds}"></label>
        <label><span>Stars</span><input type="range" min="0" max="1" step="0.05" data-g="stars" value="${g.stars}"></label>
        <label><span>Mountains</span><input type="range" min="0" max="1.5" step="0.05" data-g="mountains" value="${g.mountains}"><input type="color" data-g="mountain_color" value="${g.mountain_color}"></label>
        <label class="as-check"><input type="checkbox" data-g="sun" ${g.sun ? 'checked' : ''}> Sun</label>
        <div class="as-presets">${Object.entries(SKY_PRESETS).map(([k, v]) => `<button class="chip" data-preset="${k}">${esc(v.label)}</button>`).join('')}</div>
        <div class="as-row"><button class="btn sm" data-a="reroll">New clouds</button><button class="btn sm primary" data-a="gen">Use this sky</button></div></div></div>`;
    const pv = body.querySelector('.as-sky-pv');
    if (cur) this.assets.fileRGBA(cur.file).then((img) => { const c = toCanvas(img.rgba, img.w, img.h); pv.width = 248; pv.height = 124; pv.getContext('2d').drawImage(c, 0, img.h * 0.15, img.w, img.h * 0.5, 0, 0, 248, 124); });
    else { pv.width = 248; pv.height = 124; const gg = pv.getContext('2d'); gg.fillStyle = '#1b1b20'; gg.fillRect(0, 0, 248, 124); }
    const sOpt = () => Object.fromEntries([...body.querySelectorAll('[data-s]')].map((x) => [x.dataset.s, x.dataset.s === 'horizon' ? Number(x.value) : x.value]));
    const gpv = body.querySelector('.as-gen-pv');
    const drawGen = () => { const c = Assets.generateSky(g); gpv.getContext('2d').drawImage(c, 0, 0, 512, 256); return c; };
    drawGen();
    body.querySelectorAll('[data-g]').forEach((inp) => { inp.oninput = () => { g[inp.dataset.g] = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? Number(inp.value) : inp.value; drawGen(); }; });
    body.querySelectorAll('[data-preset]').forEach((b) => { b.onclick = () => { Object.assign(g, SKY_PRESETS[b.dataset.preset].sky); this.renderSky(body); }; });
    body.querySelector('[data-a=reroll]').onclick = () => { g.seed = 1 + Math.floor(Math.random() * 999); drawGen(); };
    body.querySelector('[data-a=gen]').onclick = (e) => this.busy(e.currentTarget, async () => {
      const o = sOpt();
      await this.assets.setSky(o.scope === 'all' ? '*' : key, drawGen(), { mode: 'panorama', quality: o.quality, name: 'Made sky' });
      this.toast('New sky', 'check');
      this.renderSky(body);
    });
    body.querySelector('[data-a=upload]').onclick = async () => { const [f] = await this.pickFiles({ accept: 'image/*', multiple: false }); if (f) this.skyFromFile(f); };
    body.querySelector('[data-a=clear]')?.addEventListener('click', () => this.busy(null, async () => { await this.assets.clearSky(key); this.renderSky(body); }));
    body.querySelector('[data-a=clearall]')?.addEventListener('click', () => this.busy(null, async () => { await this.assets.clearSky('*'); this.renderSky(body); }));
  }

  async skyFromFile(file) {
    const body = this.drawer.querySelector('.as-body');
    const o = Object.fromEntries([...body.querySelectorAll('[data-s]')].map((x) => [x.dataset.s, x.dataset.s === 'horizon' ? Number(x.value) : x.value]));
    await this.busy(body.querySelector('[data-a=upload]'), async () => {
      const bmp = await createImageBitmap(file);
      const mode = o.mode || (Math.abs(bmp.width / bmp.height - 2) < 0.15 ? 'panorama' : 'picture');
      await this.assets.setSky(o.scope === 'all' ? '*' : this.engine.areaKey(), bmp, { mode, quality: o.quality || 'n64', horizon: o.horizon || 0, name: file.name.replace(/\.[^.]+$/, '') });
      this.toast('New sky', 'check');
      if (this.tab === 'sky') this.renderSky(body);
    });
  }

  // ---- Mario tab -------------------------------------------------------------------------

  renderMario(body) {
    const cur = { ...(this.assets.meta.mario?.colors || {}) };
    const def = this.assets.marioDefaults();
    body.innerHTML = `<div class="as-presets big">${Object.entries(MARIO_PRESETS).map(([k, p]) => {
      const c = { ...def, ...p.colors };
      return `<button class="as-preset ${this.assets.meta.mario?.preset === k ? 'active' : ''}" data-preset="${k}"><span class="as-preset-sw"><i style="background:${c.cap}"></i><i style="background:${c.overalls}"></i><i style="background:${c.skin}"></i></span>${esc(p.name)}</button>`;
    }).join('')}</div>
      <div class="as-parts"></div>
      <div class="as-row"><label class="as-toggle"><input type="checkbox" data-a="look" ${this.looking ? 'checked' : ''}> ${ic(ICON.camera)} Look at Mario</label><span class="spacer"></span><button class="btn sm ghost" data-a="reset">${ic(ICON.reset)}All back to Mario</button></div>
      <div class="as-tip">Colours change live and are saved in the project.<span data-ai> Claude can do it too: “make Mario look like Luigi”.</span></div>`;
    const parts = body.querySelector('.as-parts');
    let timer = null;
    const commit = (preset = null) => {
      this.assets.applyMario(cur);
      clearTimeout(timer);
      timer = setTimeout(() => this.assets.setMario(cur, preset).catch((err) => this.toast(err.message, 'x')), 350);
    };
    for (const [k, label] of MARIO_PARTS) {
      const row = el('label', 'as-part');
      row.innerHTML = `<input type="color" value="${cur[k] || def[k]}"><span>${esc(label)}</span>${cur[k] ? `<button class="btn sm ghost" title="Back to Mario's">${ic(ICON.reset)}</button>` : ''}`;
      row.querySelector('input').oninput = (e) => { cur[k] = e.target.value; commit(); };
      row.querySelector('input').onchange = () => this.renderMario(body);
      row.querySelector('button')?.addEventListener('click', (e) => { e.preventDefault(); delete cur[k]; commit(); this.assets.meta.mario = { colors: cur }; this.renderMario(body); });
      parts.appendChild(row);
    }
    body.querySelectorAll('[data-preset]').forEach((b) => {
      b.onclick = () => this.busy(null, async () => { await this.assets.setMario({ ...MARIO_PRESETS[b.dataset.preset].colors }, b.dataset.preset); this.renderMario(body); });
    });
    body.querySelector('[data-a=reset]').onclick = () => this.busy(null, async () => { await this.assets.setMario({}, 'mario'); this.renderMario(body); });
    body.querySelector('[data-a=look]').onchange = (e) => this.lookAtMario(e.target.checked);
  }

  // A turntable close-up of Mario while his colours are edited.
  lookAtMario(on) {
    if (on === !!this.looking) return;
    const e = this.engine;
    if (!on) {
      this.looking = false;
      e.off('frame', this.lookFn);
      if (!this.editor?.active) e.setCamera(false);
      return;
    }
    if (this.editor?.active) { this.toast('Leave build mode to look at Mario', 'x'); return; }
    this.looking = true;
    let t = 0, m = null, n = 0;
    this.lookFn = () => {
      if (n++ % 6 === 0) { try { m = e.state().mario; } catch { m = null; } }
      if (!m) return;
      t += 0.012;
      const r = 330, fov = 45;
      const pos = [m.x + Math.sin(t) * r, m.y + 130, m.z + Math.cos(t) * r];
      // keep Mario in the part of the game the drawer does not cover
      const frame = document.querySelector('#game-frame')?.getBoundingClientRect();
      const d = this.drawer.getBoundingClientRect();
      let shift = 0;
      if (frame && this.isOpen() && d.left < frame.right && d.left > frame.left) {
        const visible = (d.left - frame.left) / frame.width; // 0..1 of the width still visible
        const halfW = Math.tan((fov / 2) * Math.PI / 180) * r * (frame.width / frame.height);
        shift = (0.5 - visible / 2) * 2 * halfW;
      }
      // the camera's right vector (horizontal)
      const fx = m.x - pos[0], fz = m.z - pos[2], fl = Math.hypot(fx, fz) || 1;
      const rx = -fz / fl, rz = fx / fl;
      e.setCamera(true, pos, [m.x + rx * shift, m.y + 80, m.z + rz * shift], fov);
    };
    e.on('frame', this.lookFn);
  }
}

const SKY_PRESETS = {
  day: { label: 'Sunny day', sky: { top: '#2a6fd6', horizon: '#bfe3ff', bottom: '#8fb0c8', clouds: 0.5, sun: true, stars: 0, mountains: 0.5, mountain_color: '#4f7a5a' } },
  sunset: { label: 'Sunset', sky: { top: '#2b1d5c', horizon: '#ff8a4a', bottom: '#5a2a3a', clouds: 0.6, sun: true, stars: 0.1, mountains: 0.6, mountain_color: '#3a2240' } },
  night: { label: 'Night', sky: { top: '#03061a', horizon: '#1a2a5a', bottom: '#0a0f24', clouds: 0.15, sun: false, stars: 1, mountains: 0.5, mountain_color: '#0e1630' } },
  storm: { label: 'Storm', sky: { top: '#2a2f38', horizon: '#6a7280', bottom: '#30343c', clouds: 1.4, sun: false, stars: 0, mountains: 0.3, mountain_color: '#22262c' } },
  lava: { label: 'Lava', sky: { top: '#1a0505', horizon: '#c83a10', bottom: '#3a0a05', clouds: 0.8, sun: false, stars: 0, mountains: 1.0, mountain_color: '#1a0808' } },
  candy: { label: 'Candy', sky: { top: '#ff7ad2', horizon: '#fff0a8', bottom: '#a0e8ff', clouds: 0.9, sun: true, stars: 0.2, mountains: 0.4, mountain_color: '#c27aff' } },
  space: { label: 'Space', sky: { top: '#000000', horizon: '#0a0420', bottom: '#000000', clouds: 0, sun: false, stars: 1, mountains: 0, mountain_color: '#000000' } },
};

export { Assets, SKY_PRESETS };
