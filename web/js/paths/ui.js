// Roads & nature in build mode: the Roads tab (draw roads and walks, fences and walls along lines,
// edit them by their points) and the Nature tab (a brush that plants trees, flowers, grass, rocks
// and mushrooms). Works with the mouse alone; the AI's tools call the same operations (ops.js).

import { ROAD_STYLES, ROAD_IDS, styleOf, samplesOf } from './roads.js';
import { LINE_STYLES, LINE_IDS } from './lines.js';
import { KINDS, KIND, GROUPS, PRESETS, kindIcon } from './nature.js';
import { PathsOps, lengthOf, describeItems } from './ops.js';
import { touchNature, prepareLine } from './runtime.js';
import * as T from './textures.js';
import { sampleCurve, closestOnCurve } from './geom.js';
import { icon } from '../icons.js';
import { askConfirm } from '../dialogs.js';
import { MATERIALS } from '../generators.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ACCENT = '#ffc83d';
const TOOL = 'paths';
const MAX_TRIS = 60000; // plants per area: beyond this the game slows down

function loadCss() {
  if (document.querySelector('link[data-paths-css]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'css/paths.css';
  l.dataset.pathsCss = '1';
  document.head.appendChild(l);
}

export class PathsUI {
  constructor({ rt, editor, editorUI, studio, toast }) {
    Object.assign(this, { rt, editor, editorUI, studio, toast });
    this.engine = rt.engine;
    this.ops = new PathsOps(rt, editor);
    this.tab = null;          // 'roads' | 'nature' while one of the tabs is open
    this.mode = null;         // 'draw' | 'edit' | 'paint'
    this.draft = null;        // { kind: 'road'|'line', rec } while drawing
    this.sel = null;          // { uid, point, seg } the road or line being edited
    this.drag = null;
    this.hover = null;
    this.newRoad = { style: 'asphalt', widths: {} };
    this.newLine = { style: 'picket' };
    this.brush = { radius: 520, density: 50, jitter: 30, rotate: true, align: true, avoidPaths: true, avoidWater: true, eraseKinds: false };
    this.palette = new Map(Object.entries(PRESETS.meadow.kinds));
    this.preset = 'meadow';
    this.closed = new Set();
    loadCss();
    this.buildTabs();
    this.wrapEditor();
    (editor.drawHooks ||= []).push((ed, g) => { try { this.draw(g); } catch (err) { console.error('paths draw', err); } });
    rt.on(() => this.onRuntime());
    this.engine.on('area', () => { this.cancelDraft(); this.sel = null; this.mode = this.tab === 'nature' ? 'paint' : null; this.render(); });
    this.registerCommands();
  }

  // ---- tabs -------------------------------------------------------------------------------

  buildTabs() {
    const tabs = $('#library .lib-tabs');
    if (!tabs || $('#lib-roads')) return;
    for (const [id, label, title] of [['roads', 'Roads', 'Roads, walks, fences, walls and street lamps'], ['nature', 'Nature', 'Paint trees, flowers, grass, rocks and mushrooms']]) {
      const t = el('button', 'lib-tab', label);
      t.dataset.lib = id;
      t.title = title;
      tabs.appendChild(t);
      const pane = el('div', 'lib-pane pn-pane');
      pane.id = `lib-${id}`;
      pane.hidden = true;
      $('#library').appendChild(pane);
      // keep slider drags from re-rendering under the mouse
      pane.addEventListener('pointerdown', () => { this.interacting = true; });
      window.addEventListener('pointerup', () => { if (this.interacting) { this.interacting = false; if (this.renderLater) { this.renderLater = false; this.render(); } } });
      t.addEventListener('click', () => this.openTab(id));
    }
    // another tab: our tools stop
    document.addEventListener('click', (e) => {
      const t = e.target.closest?.('.lib-tab');
      if (t && t.dataset.lib !== 'roads' && t.dataset.lib !== 'nature') this.closeTab();
    }, true);
  }

  openTab(id) {
    if (!this.editor.active) this.editor.enter();
    document.querySelectorAll('.lib-tab').forEach((x) => x.classList.toggle('active', x.dataset.lib === id));
    if (this.editor.sel) this.editor.select(null);
    document.querySelectorAll('#library > .lib-pane').forEach((p) => { p.hidden = p.id !== `lib-${id}`; });
    if (this.tab !== id) { this.cancelDraft(); this.deselect(false); }
    this.tab = id;
    this.mode = id === 'nature' ? 'paint' : this.sel ? 'edit' : null;
    this.setTool();
    this.render();
  }

  closeTab() {
    if (!this.tab) return;
    this.finishDraft();
    this.endStroke();
    this.tab = null;
    this.deselect(false);
    this.mode = null;
    this.setTool();
  }

  setTool() {
    const ed = this.editor;
    const want = this.mode ? TOOL : 'select';
    if (ed.tool === TOOL && want === 'select') ed.tool = 'select';
    else if (want === TOOL && ed.tool !== TOOL) {
      ed.cancelPlacing?.(); ed.cancelGenerator?.(); ed.stopSculpt?.();
      ed.tool = TOOL;
    }
    ed.ui.onToolChange();
    this.hint();
  }

  hint() {
    const h = $('#tool-hint');
    if (!h || !this.editor.active) return;
    let text = '';
    if (this.mode === 'draw' && this.draft) {
      const kind = this.draft.kind === 'road' ? 'road' : 'line';
      const n = (this.draft.rec.road || this.draft.rec.line).pts.length - (this.draft.hover ? 1 : 0);
      text = n === 0 ? `Click on the ground where the ${kind} starts${kind === 'road' ? ' (on another road: a junction)' : ''} · <kbd>Esc</kbd> stop`
        : `Click to add points · double-click or <kbd>Enter</kbd> finishes · click the first point to close a loop · <kbd>Backspace</kbd> undoes a point · <kbd>Esc</kbd> stop`;
    } else if (this.mode === 'edit' && this.sel) {
      const rec = this.ops.find(this.sel.uid);
      text = rec?.line
        ? 'Drag the points · drag the line to add one · click a section for a gap or gate · <kbd>Del</kbd> removes the point · <kbd>Esc</kbd> done'
        : 'Drag the points · drag the road\'s middle line to add one · <kbd>Del</kbd> removes the point · <kbd>Esc</kbd> done';
    } else if (this.mode === 'paint') {
      text = this.palette.size ? `Hold the left mouse button to plant · <kbd>Shift</kbd> erases · <kbd>[</kbd><kbd>]</kbd> brush size ${this.brush.radius} · <kbd>Esc</kbd> stop`
        : 'Pick what to plant in the Nature tab · <kbd>Shift</kbd>+drag erases';
    } else if (this.tab === 'roads') {
      text = 'Pick a style to draw · click a road or fence to change it';
    }
    if (text) { h.innerHTML = text; h.hidden = false; }
  }

  // ---- the editor's mouse and keys --------------------------------------------------------

  wrapEditor() {
    const ed = this.editor;
    const wrap = (name, before) => {
      const orig = ed[name].bind(ed);
      ed[name] = (...args) => {
        let handled = false;
        try { handled = before(...args); } catch (err) { console.error(`paths ${name}`, err); }
        return handled ? undefined : orig(...args);
      };
    };
    wrap('onDown', (e) => this.down(e));
    wrap('onMove', (e) => this.move(e));
    wrap('onUp', (e) => this.up(e));
    wrap('onKey', (e, down) => this.key(e, down));
    wrap('onWheel', (e) => this.wheel(e));
    wrap('onDblClick', (e) => this.dblclick(e));
    wrap('exit', () => { this.finishDraft(); this.endStroke(); this.deselect(false); this.mode = this.tab === 'nature' ? 'paint' : null; return false; });
    const onToolChange = ed.ui.onToolChange;
    ed.ui.onToolChange = () => { onToolChange(); if (this.mode || this.tab) this.hint(); };
  }

  local(e) { return this.editor.local(e); }
  isNav(e, m) { return this.editor.navHit(m.x, m.y) || this.editor.navMode(e); }
  groundHit(m) { return this.editor.pick(m.x, m.y, { objects: false }); }

  down(e) {
    const ed = this.editor;
    if (!ed.active) return false;
    const m = this.local(e);
    if (e.button !== 0 || this.isNav(e, m)) return false;
    if (this.mode === 'draw') { this.capture(e, m); return true; }
    if (this.mode === 'paint') { this.capture(e, m); this.beginStroke(m, e.shiftKey); return true; }
    if (this.mode === 'edit' && this.sel) {
      const rec = this.ops.find(this.sel.uid);
      if (rec) {
        const h = this.pointAt(rec, m);
        if (h >= 0) {
          this.capture(e, m);
          this.sel.point = h;
          this.sel.seg = null;
          this.drag = { uid: rec.uid, point: h, before: JSON.stringify(rec.road || rec.line) };
          this.rt.setEditing(true);
          this.render();
          return true;
        }
        const ln = this.lineAt(rec, m);
        if (ln) { this.capture(e, m); this.drag = { uid: rec.uid, pending: ln, m }; return true; }
      }
      // somewhere else: another road, or back to selecting things
      const other = this.itemUnder(m);
      if (other) { this.capture(e, m); this.select(other.rec.uid); this.downPick = true; return true; }
      this.deselect();
      return false;
    }
    return false;
  }

  capture(e, m) {
    this.editor.overlay.setPointerCapture?.(e.pointerId);
    this.editor.downAt = { ...m, button: e.button, moved: false };
  }

  move(e) {
    const ed = this.editor;
    if (!ed.active) return false;
    const m = this.local(e);
    if (ed.downAt && Math.hypot(m.x - ed.downAt.x, m.y - ed.downAt.y) > 4) ed.downAt.moved = true;
    this.mouse = m;
    if (ed.drag?.nav) return false;
    if (this.stroke) { this.stroke.m = m; this.stroke.shift = e.shiftKey; this.dab(); return true; }
    if (this.mode === 'paint') { this.mouseHit = this.groundHit(m); this.eraseHover = e.shiftKey; return false; }
    if (this.mode === 'draw' && this.draft) { this.hoverDraft(m); return false; }
    if (this.drag) {
      if (this.drag.pending && ed.downAt?.moved) {
        // dragging the line: a new point there
        const rec = this.ops.find(this.drag.uid);
        const body = rec.road || rec.line;
        const at = this.drag.pending;
        body.pts.splice(at.seg + 1, 0, [Math.round(at.x), Math.round(at.y), Math.round(at.z)]);
        this.drag = { uid: rec.uid, point: at.seg + 1, before: this.drag.before || null, inserted: true };
        this.sel.point = at.seg + 1;
        this.rt.setEditing(true);
      }
      if (this.drag.point != null) { this.dragPoint(m); return true; }
      return true;
    }
    if (this.tab === 'roads' && !this.mode && (!this.hoverAt || performance.now() - this.hoverAt > 60)) {
      this.hoverAt = performance.now();
      this.hover = this.itemUnder(m)?.rec.uid ?? null;
    }
    return false;
  }

  up(e) {
    const ed = this.editor;
    if (!ed.active) return false;
    const m = this.local(e);
    const click = ed.downAt && !ed.downAt.moved;
    const done = () => { if (ed.downAt?.moved) ed.suppressClickUntil = performance.now() + 250; ed.drag = null; ed.downAt = null; return true; };
    if (this.stroke) { this.endStroke(); return done(); }
    if (this.downPick) { this.downPick = false; return done(); }
    if (this.mode === 'draw' && this.draft) {
      if (e.button === 2 && click) { this.finishDraft(); return done(); }
      if (e.button === 0 && click) { this.addDraftPoint(m); return done(); }
      if (e.button === 0) return done();
      return false;
    }
    if (this.drag) {
      const d = this.drag;
      this.drag = null;
      const rec = this.ops.find(d.uid);
      if (d.pending && click && rec?.line) { this.sel.seg = d.pending.seg; this.sel.point = null; this.render(); }
      else if (rec && d.point != null) {
        this.ops.update(rec, {}, d.inserted ? `Added a point to the ${rec.name.toLowerCase()}` : `Moved a point of the ${rec.name.toLowerCase()}`);
        this.rt.setEditing(false);
        this.render();
      }
      return done();
    }
    // a click on a road or fence (any tool tab, plain selecting): edit it
    if (click && e.button === 0 && ed.tool === 'select' && !ed.drag) {
      const hit = this.groundHit(m);
      const id = hit?.paths;
      if (id && (id.startsWith('r:') || id.startsWith('l:'))) {
        const uid = Number(id.slice(2));
        if (this.ops.find(uid)) {
          if (this.tab !== 'roads') this.openTab('roads');
          this.select(uid);
          return done();
        }
      }
    }
    return false;
  }

  dblclick(e) {
    if (!this.editor.active) return false;
    if (this.mode === 'draw' && this.draft) {
      // the double-click's clicks added the same point twice
      const body = this.draft.rec.road || this.draft.rec.line;
      const real = body.pts.length - (this.draft.hover ? 1 : 0);
      if (real >= 2) {
        const a = body.pts[real - 1], b = body.pts[real - 2];
        if (Math.hypot(a[0] - b[0], a[2] - b[2]) < 30) { body.pts.splice(real - 1, 1); }
      }
      this.finishDraft();
      e.preventDefault?.();
      return true;
    }
    return this.mode === 'paint';
  }

  wheel(e) {
    if (!this.editor.active) return false;
    if (this.mode === 'paint' && e.altKey) {
      e.preventDefault();
      this.setRadius(this.brush.radius * (e.deltaY > 0 ? 0.88 : 1.14));
      return true;
    }
    return false;
  }

  key(e, down) {
    const ed = this.editor;
    if (!ed.active || ed.typing() || !down) return false;
    if (!this.mode && !this.tab) return false;
    const code = e.code;
    if (this.mode === 'draw') {
      if (code === 'Escape') { this.finishDraft(); this.mode = null; this.setTool(); this.render(); e.preventDefault(); return true; }
      if (code === 'Enter' || code === 'NumpadEnter') { this.finishDraft(); e.preventDefault(); return true; }
      if (code === 'Backspace' || code === 'Delete') { this.undoDraftPoint(); e.preventDefault(); return true; }
    }
    if (this.mode === 'edit' && this.sel) {
      if (code === 'Escape') { this.deselect(); e.preventDefault(); return true; }
      if (code === 'Delete' || code === 'Backspace') { this.deletePointOrItem(); e.preventDefault(); return true; }
    }
    if (this.mode === 'paint') {
      if (code === 'BracketLeft' || code === 'BracketRight') { this.setRadius(this.brush.radius * (code === 'BracketLeft' ? 0.85 : 1.18)); e.preventDefault(); return true; }
      if (code === 'Escape') { this.mode = null; this.setTool(); e.preventDefault(); return true; }
    }
    return false;
  }

  // ---- hit tests ----------------------------------------------------------------------------

  itemUnder(m) {
    const hit = this.groundHit(m);
    if (!hit) return null;
    if (hit.paths?.startsWith('r:') || hit.paths?.startsWith('l:')) {
      const rec = this.ops.find(Number(hit.paths.slice(2)));
      if (rec) return { rec };
    }
    const p = this.rt.pickAt(hit.x, hit.z, 20);
    return p ? { rec: p.rec } : null;
  }

  // the control point under the mouse (index) or -1
  pointAt(rec, m) {
    const pts = (rec.road || rec.line).pts;
    let best = -1, bd = 12;
    pts.forEach((p, i) => {
      const s = this.editor.project([p[0], this.heightAt(rec, i), p[2]]);
      if (!s) return;
      const d = Math.hypot(s.x - m.x, s.y - m.y);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  // the middle line under the mouse: { seg, x, y, z }
  lineAt(rec, m) {
    const body = rec.road || rec.line;
    const S = this.curve(rec);
    let best = null, bd = 9;
    for (let i = 0; i + 1 < S.length; i++) {
      const a = this.editor.project([S[i].x, S[i].yy, S[i].z]), b = this.editor.project([S[i + 1].x, S[i + 1].yy, S[i + 1].z]);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
      const f = Math.max(0, Math.min(1, ((m.x - a.x) * dx + (m.y - a.y) * dy) / L2));
      const d = Math.hypot(m.x - (a.x + dx * f), m.y - (a.y + dy * f));
      if (d < bd) { bd = d; best = { seg: S[i].seg, x: S[i].x + (S[i + 1].x - S[i].x) * f, y: S[i].yy, z: S[i].z + (S[i + 1].z - S[i].z) * f }; }
    }
    void body;
    return best;
  }

  // the curve of a record with drawn heights
  curve(rec) {
    if (rec.road) {
      const R = this.rt.net.find((x) => x.rec.uid === rec.uid);
      const S = R ? R.S : samplesOf(rec.road);
      return S.map((s, i) => ({ ...s, yy: (R ? R.Y[i] : s.y) + 6 }));
    }
    const L = prepareLine(rec);
    return L ? L.S.map((s) => ({ ...s, yy: s.y + 6 })) : [];
  }

  heightAt(rec, i) {
    const p = (rec.road || rec.line).pts[i];
    const S = this.curve(rec);
    const c = closestOnCurve(S, p[0], p[2]);
    return c ? c.y + 6 : p[1];
  }

  // ---- drawing new roads and lines --------------------------------------------------------

  startDraw(kind, style) {
    this.finishDraft();
    this.deselect(false);
    if (kind === 'road') this.newRoad.style = style; else this.newLine.style = style;
    const rec = kind === 'road'
      ? this.ops.roadRecord({ style, pts: [], width: this.newRoad.widths[style] || undefined, material: this.newRoad.material })
      : this.ops.lineRecord({ style, pts: [] });
    this.draft = { kind, rec, hover: false };
    this.mode = 'draw';
    this.setTool();
    this.render();
  }

  draftBody() { return this.draft.rec.road || this.draft.rec.line; }

  ensureDraftInPatch() {
    const recs = this.editor.records();
    if (!recs.includes(this.draft.rec)) recs.push(this.draft.rec);
  }

  // A clicked point, snapped onto another road for a junction (roads, first and last points).
  draftPoint(m) {
    const hit = this.groundHit(m);
    if (!hit) return null;
    let p = [Math.round(hit.x), Math.round(hit.y), Math.round(hit.z)];
    this.snapHint = null;
    if (this.draft.kind === 'road') {
      const near = this.rt.roadNear(hit.x, hit.z, 0);
      if (near && near.R.rec !== this.draft.rec) {
        const c = near.c;
        const y = near.R.Y[c.i] + (near.R.Y[c.i + 1] - near.R.Y[c.i]) * c.f;
        p = [Math.round(c.x), Math.round(y), Math.round(c.z)];
        this.snapHint = p;
      }
    }
    return p;
  }

  hoverDraft(m) {
    const body = this.draftBody();
    const p = this.draftPoint(m);
    if (this.draft.hover) body.pts.pop();
    this.draft.hover = false;
    if (p && body.pts.length) { body.pts.push(p); this.draft.hover = true; }
    this.previewDraft();
  }

  addDraftPoint(m) {
    const body = this.draftBody();
    if (this.draft.hover) { body.pts.pop(); this.draft.hover = false; }
    // the first point again: a loop
    if (body.pts.length >= 3) {
      const f = body.pts[0], s = this.editor.project([f[0], f[1] + 6, f[2]]);
      if (s && Math.hypot(s.x - m.x, s.y - m.y) < 14) { body.closed = true; this.finishDraft(); return; }
    }
    const p = this.draftPoint(m);
    if (!p) return;
    const last = body.pts[body.pts.length - 1];
    if (last && Math.hypot(last[0] - p[0], last[2] - p[2]) < 20) return;
    body.pts.push(p);
    if (body.pts.length === 1) this.rt.setEditing(true);
    this.previewDraft();
    this.hint();
  }

  undoDraftPoint() {
    const body = this.draftBody();
    if (this.draft.hover) { body.pts.pop(); this.draft.hover = false; }
    body.pts.pop();
    if (!body.pts.length) { this.removeDraftFromPatch(); this.rt.sync({ collision: false }); }
    else this.previewDraft();
    this.hint();
  }

  previewDraft() {
    const body = this.draftBody();
    if (body.pts.length < 2) { this.removeDraftFromPatch(); this.rt.sync({ collision: false }); return; }
    this.ensureDraftInPatch();
    this.throttle(() => { this.rt.fit(this.draft.rec); this.rt.sync({ collision: false }); });
  }

  throttle(fn) {
    this.nextFn = fn;
    if (this.throttleT) return;
    const run = () => { const f = this.nextFn; this.nextFn = null; this.throttleT = null; if (f) { try { f(); } catch (err) { console.error('paths', err); } } };
    this.throttleT = setTimeout(run, 35);
  }

  removeDraftFromPatch() {
    if (!this.draft) return;
    const recs = this.editor.records();
    const i = recs.indexOf(this.draft.rec);
    if (i >= 0) recs.splice(i, 1);
  }

  finishDraft() {
    if (!this.draft) return;
    const d = this.draft;
    clearTimeout(this.throttleT); this.throttleT = null; this.nextFn = null;
    const body = this.draftBody();
    if (d.hover) { body.pts.pop(); d.hover = false; }
    this.removeDraftFromPatch();
    this.draft = null;
    if (body.pts.length >= 2) {
      const rec = d.kind === 'road' ? this.ops.addRoad(d.rec) : this.ops.addLine(d.rec);
      this.lastMade = rec.uid;
      this.toast(`${rec.name} built (${lengthOf(rec).toLocaleString()} long)`, 'check');
    } else this.rt.sync({ collision: false });
    this.rt.setEditing(false);
    // keep drawing the same style: the next click starts a new one
    if (this.mode === 'draw' && this.tab === 'roads') {
      const style = d.kind === 'road' ? this.newRoad.style : this.newLine.style;
      const rec = d.kind === 'road' ? this.ops.roadRecord({ style, pts: [], width: this.newRoad.widths[style] || undefined, material: this.newRoad.material }) : this.ops.lineRecord({ style, pts: [] });
      this.draft = { kind: d.kind, rec, hover: false };
    }
    this.render();
    this.hint();
  }

  cancelDraft() {
    if (!this.draft) return;
    this.removeDraftFromPatch();
    this.draft = null;
    this.rt.setEditing(false);
    this.rt.sync();
  }

  // ---- editing --------------------------------------------------------------------------------

  select(uid) {
    this.finishDraft();
    this.draft = null;
    this.sel = { uid, point: null, seg: null };
    this.mode = 'edit';
    this.setTool();
    this.render();
  }

  deselect(rerender = true) {
    if (!this.sel) return;
    this.sel = null;
    if (this.mode === 'edit') this.mode = null;
    this.setTool();
    if (rerender) this.render();
  }

  dragPoint(m) {
    const rec = this.ops.find(this.drag.uid);
    if (!rec) return;
    const hit = this.groundHit(m);
    if (!hit) return;
    const body = rec.road || rec.line;
    const old = body.pts[this.drag.point];
    let p = [Math.round(hit.x), Math.round(hit.y), Math.round(hit.z)];
    // road ends snap onto other roads
    const end = this.drag.point === 0 || this.drag.point === body.pts.length - 1;
    if (rec.road && end && !body.closed) {
      const near = this.rt.roadNear(hit.x, hit.z, 0);
      if (near && near.R.rec !== rec) { const c = near.c; p = [Math.round(c.x), Math.round(near.R.Y[c.i]), Math.round(c.z)]; }
    }
    if (old?.[3]) p.push(old[3]);
    body.pts[this.drag.point] = p;
    this.throttle(() => { this.rt.fit(rec); this.rt.sync({ collision: false }); });
  }

  deletePointOrItem() {
    const rec = this.ops.find(this.sel.uid);
    if (!rec) return;
    const body = rec.road || rec.line;
    if (this.sel.point != null && body.pts.length > 2) {
      const pts = body.pts.slice();
      pts.splice(this.sel.point, 1);
      this.sel.point = null;
      this.ops.update(rec, { pts, closed: body.closed && pts.length > 2 }, `Removed a point of the ${rec.name.toLowerCase()}`);
      this.render();
      return;
    }
    this.deleteItem(rec);
  }

  async deleteItem(rec) {
    this.sel = null;
    this.mode = null;
    this.setTool();
    this.ops.remove(rec, `Removed the ${rec.name.toLowerCase()}`);
    this.toast(`${rec.name} removed · Ctrl+Z brings it back`, 'trash');
    this.render();
  }

  // ---- painting plants ----------------------------------------------------------------------

  setRadius(r) {
    this.brush.radius = Math.round(Math.max(80, Math.min(3000, r)));
    const s = $('#pn-brush-radius');
    if (s) { s.value = this.brush.radius; s.nextElementSibling && (s.nextElementSibling.textContent = this.brush.radius); }
    this.hint();
  }

  beginStroke(m, erase) {
    this.stroke = { m, shift: erase, erase, items: [], rec: null, touched: new Map(), lastAt: null, warned: false };
    this.dab();
    this.strokeTimer = setInterval(() => this.dab(true), 140);
  }

  dab(still = false) {
    const st = this.stroke;
    if (!st) return;
    const hit = this.groundHit(st.m);
    this.mouseHit = hit;
    if (!hit) return;
    const r = this.brush.radius;
    if (!still && st.lastAt && Math.hypot(hit.x - st.lastAt[0], hit.z - st.lastAt[1]) < r * 0.3) return;
    st.lastAt = [hit.x, hit.z];
    if (st.erase || st.shift) { this.eraseAt(hit.x, hit.z, r); return; }
    if (!this.palette.size) return;
    if (this.rt.stats.tris > MAX_TRIS) {
      if (!st.warned) { st.warned = true; this.toast('This area has a lot of plants already: more would slow the game down. Erase some, or plant in another area.', 'x'); }
      return;
    }
    st.index ||= this.ops.plantIndex();
    const items = this.ops.scatter({
      kinds: Object.fromEntries(this.palette), cx: hit.x, cz: hit.z, r, density: this.brush.density, scaleJitter: this.brush.jitter / 100,
      rotate: this.brush.rotate, align: this.brush.align, avoidPaths: this.brush.avoidPaths, avoidWater: this.brush.avoidWater, existing: st.index,
    });
    if (!items.length) return;
    st.items.push(...items);
    if (!st.rec) st.rec = { uid: 0x7e3fffff - (Date.now() % 4096), name: 'Plants', nature: { items: st.items } };
    // (a patch from the server may have replaced the area's records meanwhile)
    if (!this.editor.records().includes(st.rec)) this.editor.records().push(st.rec);
    touchNature(st.rec);
    this.rt.sync({ collision: false });
  }

  eraseAt(x, z, r) {
    const st = this.stroke;
    const only = this.brush.eraseKinds ? this.palette : null;
    let any = false;
    for (const rec of this.editor.records().filter((q) => q.nature && q !== st.rec)) {
      const items = rec.nature.items || [];
      const keep = items.filter((it) => Math.hypot(it[1] - x, it[3] - z) > r || (only && !only.has(it[0])));
      if (keep.length === items.length) continue;
      if (!st.touched.has(rec)) st.touched.set(rec, items.length);
      rec.nature.items = keep;
      touchNature(rec);
      any = true;
    }
    if (any) this.rt.sync({ collision: false });
  }

  endStroke() {
    const st = this.stroke;
    if (!st) return;
    clearInterval(this.strokeTimer);
    this.stroke = null;
    if (st.rec) {
      const recs = this.editor.records();
      const i = recs.indexOf(st.rec);
      if (i >= 0) recs.splice(i, 1);
    }
    if (st.items.length) this.ops.addPlants(st.items);
    if (st.touched.size) {
      let n = 0;
      const updates = [];
      for (const [rec, before] of st.touched) { n += before - rec.nature.items.length; updates.push({ uid: rec.uid, fields: { nature: { items: rec.nature.items } } }); }
      this.editor.commit({ type: 'update_many', updates, summary: `Removed ${n} plant${n === 1 ? '' : 's'}` });
    }
    this.rt.sync();
    this.render();
  }

  // ---- overlay ------------------------------------------------------------------------------

  draw(g) {
    const ed = this.editor;
    if (!ed.active || !ed.camData) return;
    const proj = (p) => ed.project(p);
    const poly = (pts, color, width = 2, dash = null) => {
      g.save();
      g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round';
      if (dash) g.setLineDash(dash);
      g.beginPath();
      let on = false;
      for (const p of pts) { const s = proj(p); if (!s) { on = false; continue; } if (on) g.lineTo(s.x, s.y); else { g.moveTo(s.x, s.y); on = true; } }
      g.stroke();
      g.restore();
    };
    const dot = (p, r, fill, stroke = '#111') => {
      const s = proj(p); if (!s) return;
      g.beginPath(); g.arc(s.x, s.y, r, 0, Math.PI * 2);
      g.fillStyle = fill; g.fill(); g.lineWidth = 2; g.strokeStyle = stroke; g.stroke();
    };
    const outline = (rec, color, width) => {
      const S = this.curve(rec);
      if (!S.length) return;
      poly(S.map((s) => [s.x, s.yy, s.z]), color, width);
      if (rec.road) {
        for (const sg of [-1, 1]) poly(S.map((s) => [s.x - s.tz * sg * s.w / 2, s.yy, s.z + s.tx * sg * s.w / 2]), color, 1, [6, 5]);
      }
    };
    if (this.hover && !this.mode) {
      const rec = this.ops.find(this.hover);
      if (rec) outline(rec, 'rgba(255,200,61,0.55)', 2);
    }
    if (this.draft) {
      const body = this.draftBody();
      if (body.pts.length) {
        outline(this.draft.rec, 'rgba(255,200,61,0.9)', 2);
        body.pts.forEach((p, i) => { if (!(this.draft.hover && i === body.pts.length - 1)) dot([p[0], p[1] + 6, p[2]], i === 0 ? 7 : 5, i === 0 ? ACCENT : '#fff'); });
      }
      if (this.snapHint) { const s = proj([this.snapHint[0], this.snapHint[1] + 6, this.snapHint[2]]); if (s) { g.beginPath(); g.arc(s.x, s.y, 13, 0, 7); g.strokeStyle = '#7ce0ff'; g.lineWidth = 3; g.stroke(); } }
    }
    if (this.mode === 'edit' && this.sel) {
      const rec = this.ops.find(this.sel.uid);
      if (rec) {
        outline(rec, ACCENT, 2.5);
        // a selected section of a line
        if (rec.line && this.sel.seg != null) {
          const S = this.curve(rec).filter((s) => s.seg === this.sel.seg);
          if (S.length) poly(S.map((s) => [s.x, s.yy, s.z]), '#7ce0ff', 6);
        }
        const pts = (rec.road || rec.line).pts;
        pts.forEach((p, i) => dot([p[0], this.heightAt(rec, i), p[2]], this.sel.point === i ? 8 : 6, this.sel.point === i ? ACCENT : '#fff'));
      }
    }
    if (this.mode === 'paint' && this.mouse) {
      const hit = this.stroke ? this.mouseHit : (this.mouseHit || null);
      if (hit) {
        const erase = this.stroke ? (this.stroke.erase || this.stroke.shift) : (ed.keys?.has('ShiftLeft') || ed.keys?.has('ShiftRight') || this.eraseHover);
        const r = this.brush.radius, pts = [];
        for (let k = 0; k <= 40; k++) {
          const a = (k / 40) * Math.PI * 2, x = hit.x + Math.cos(a) * r, z = hit.z + Math.sin(a) * r;
          const y = this.rt.groundAt(x, z, hit.y + 300) ?? hit.y;
          pts.push([x, y + 8, z]);
        }
        poly(pts, erase ? 'rgba(255,110,110,0.95)' : 'rgba(140,240,120,0.95)', 2.5);
        dot([hit.x, hit.y + 8, hit.z], 3, erase ? '#ff6e6e' : '#8cf078', 'rgba(0,0,0,0.5)');
      }
    }
  }

  onRuntime() {
    if (this.interacting) { this.renderLater = true; return; }
    clearTimeout(this.renderT);
    this.renderT = setTimeout(() => this.render(), 120);
  }

  // ---- panels ---------------------------------------------------------------------------------

  render() {
    if (this.tab === 'roads' || $('#lib-roads') && !$('#lib-roads').hidden) this.renderRoads();
    if (this.tab === 'nature' || $('#lib-nature') && !$('#lib-nature').hidden) this.renderNature();
    this.hint();
  }

  section(id, title, body, { count = null } = {}) {
    const s = el('div', `pn-sec${this.closed.has(id) ? ' closed' : ''}`);
    s.dataset.sec = id;
    const h = el('button', 'pn-sec-h', `<span>${esc(title)}${count != null ? ` <em>${count}</em>` : ''}</span><svg class="i sm" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>`);
    h.onclick = () => { if (this.closed.has(id)) this.closed.delete(id); else this.closed.add(id); s.classList.toggle('closed'); };
    const b = el('div', 'pn-sec-b');
    b.appendChild(body);
    s.append(h, b);
    return s;
  }

  styleSwatch(style) {
    const st = ROAD_STYLES[style];
    const tex = st.tex === 'asphalt' ? T.asphalt() : st.tex === 'concrete' ? T.concrete() : st.tex === 'gravel' ? T.gravel() : st.tex === 'planks' ? T.planks()
      : st.tex === 'dirt' ? (T.gameTexture(this.engine, 1) || T.dirtTex()) : st.tex.startsWith('game:') ? T.gameTexture(this.engine, Number(st.tex.slice(5))) : null;
    return tex ? T.swatch(tex, 36) : '';
  }

  renderRoads() {
    const pane = $('#lib-roads');
    if (!pane) return;
    const scroll = pane.scrollTop;
    pane.innerHTML = '';
    const rec = this.sel && this.ops.find(this.sel.uid);
    if (this.sel && !rec) this.sel = null;
    if (rec) pane.appendChild(rec.road ? this.roadPanel(rec) : this.linePanel(rec));

    // styles
    const grid = el('div', 'pn-grid');
    for (const id of ROAD_IDS) {
      const st = ROAD_STYLES[id];
      const active = this.mode === 'draw' && this.draft?.kind === 'road' && this.newRoad.style === id && !this.newRoad.material;
      const b = el('button', `pn-style${active ? ' active' : ''}`, `<span class="pn-sw" style="background-image:url(${this.styleSwatch(id)});background-color:${st.icon}"></span><span>${esc(st.label)}</span>`);
      b.dataset.style = id;
      b.title = `Draw ${st.label.toLowerCase()}: click points on the ground`;
      b.onclick = () => { this.newRoad.material = undefined; this.startDraw('road', id); };
      grid.appendChild(b);
    }
    // your own materials (Assets › Materials)
    for (let slot = 0; slot < 16; slot++) {
      const name = MATERIALS[48 + slot];
      if (!name) continue;
      const active = this.mode === 'draw' && this.draft?.kind === 'road' && this.newRoad.style === 'custom' && this.newRoad.material === slot;
      const sw = this.engine.materialSwatch?.(48 + slot);
      const b = el('button', `pn-style${active ? ' active' : ''}`, `<span class="pn-sw" style="${sw ? `background-image:url(${sw})` : 'background:#a070e0'}"></span><span>${esc(name)}</span>`);
      b.dataset.style = `custom:${slot}`;
      b.title = `Draw a path in your material “${name}”`;
      b.onclick = () => { this.newRoad.material = slot; this.startDraw('road', 'custom'); };
      grid.appendChild(b);
    }
    const drawBox = el('div');
    drawBox.appendChild(grid);
    const style = this.newRoad.style === 'custom' ? null : ROAD_STYLES[this.newRoad.style];
    const w = this.newRoad.widths[this.newRoad.style] || style?.width || 260;
    drawBox.appendChild(this.slider('Width', w, 80, 1600, 10, (v) => {
      this.newRoad.widths[this.newRoad.style] = v;
      if (this.draft?.kind === 'road') { this.draft.rec.road.width = v; this.previewDraft(); }
    }));
    drawBox.appendChild(el('div', 'pn-tip', 'Click points on the ground, double-click to finish. Start or end on another road for a junction. Steep walks get steps by themselves.'));
    pane.appendChild(this.section('roads', 'Roads & walks', drawBox));

    // lines
    const lgrid = el('div', 'pn-grid pn-grid-lines');
    for (const id of LINE_IDS) {
      const st = LINE_STYLES[id];
      const active = this.mode === 'draw' && this.draft?.kind === 'line' && this.newLine.style === id;
      const b = el('button', `pn-style${active ? ' active' : ''}`, `<span class="pn-sw pn-line-ico" style="--c:${st.icon}">${lineIcon(id)}</span><span>${esc(st.label)}</span>`);
      b.dataset.line = id;
      b.title = `${st.label}: click points along the line, double-click to finish`;
      b.onclick = () => this.startDraw('line', id);
      lgrid.appendChild(b);
    }
    const lbox = el('div');
    lbox.appendChild(lgrid);
    lbox.appendChild(el('div', 'pn-tip', 'Each click is a corner. To put a fence along a road, select the road and pick its sides.'));
    pane.appendChild(this.section('lines', 'Fences, walls & lamps', lbox));

    // what is here
    const items = this.editor.records().filter((r) => (r.road || r.line) && r !== this.draft?.rec);
    const list = el('div', 'pn-list');
    if (!items.length) list.appendChild(el('div', 'pn-empty', 'No roads or fences in this area yet. Pick a style above and click on the ground.'));
    for (const r of items) {
      const isRoad = !!r.road;
      const st = isRoad ? styleOf(r.road) : LINE_STYLES[r.line.style];
      const row = el('div', `pn-row${this.sel?.uid === r.uid ? ' active' : ''}`);
      row.innerHTML = `<span class="pn-dot" style="background:${st?.icon || '#888'}"></span><span class="pn-row-t"><b>${esc(r.name || st?.label)}</b><small>${lengthOf(r).toLocaleString()} long${isRoad && r.road.closed ? ' · loop' : ''}</small></span>`;
      const del = el('button', 'btn icon ghost sm', icon('trash', 'sm'));
      del.title = 'Delete';
      del.onclick = (ev) => { ev.stopPropagation(); this.deleteItem(r); };
      row.appendChild(del);
      row.onclick = () => { this.select(r.uid); this.frame(r); };
      row.onmouseenter = () => { this.hover = r.uid; };
      row.onmouseleave = () => { this.hover = null; };
      list.appendChild(row);
    }
    pane.appendChild(this.section('list', 'In this area', list, { count: items.length || null }));
    pane.scrollTop = scroll;
  }

  frame(rec) {
    const pts = (rec.road || rec.line).pts;
    if (!pts.length) return;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y = 0;
    for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); y += p[1] / pts.length; }
    this.editor.frameTo?.([(x0 + x1) / 2, y, (z0 + z1) / 2], Math.max(400, Math.hypot(x1 - x0, z1 - z0) / 2 + 200));
  }

  slider(label, value, min, max, step, onInput, { onChange = null, unit = '' } = {}) {
    const row = el('label', 'pn-slider');
    row.innerHTML = `<span>${esc(label)}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}"><b>${value}${unit}</b>`;
    const inp = row.querySelector('input');
    inp.oninput = () => { row.querySelector('b').textContent = `${inp.value}${unit}`; onInput(Number(inp.value)); };
    if (onChange) inp.onchange = () => onChange(Number(inp.value));
    return row;
  }

  toggle(label, on, fn, title = '') {
    const b = el('label', 'pn-toggle');
    b.innerHTML = `<input type="checkbox"${on ? ' checked' : ''}><span>${esc(label)}</span>`;
    if (title) b.title = title;
    b.querySelector('input').onchange = (e) => fn(e.target.checked);
    return b;
  }

  select_(label, value, options, fn) {
    const row = el('label', 'pn-select');
    row.innerHTML = `<span>${esc(label)}</span><select>${options.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    row.querySelector('select').onchange = (e) => fn(e.target.value);
    return row;
  }

  seg(label, value, options, fn) {
    const row = el('div', 'pn-seg-row');
    row.innerHTML = `<span>${esc(label)}</span>`;
    const box = el('div', 'pn-seg');
    for (const [v, t] of options) {
      const b = el('button', String(v) === String(value) ? 'active' : '', esc(t));
      b.onclick = () => fn(v);
      box.appendChild(b);
    }
    row.appendChild(box);
    return row;
  }

  // live change while dragging a slider, one edit when it is let go
  liveRoad(rec, changes) {
    Object.assign(rec.road || rec.line, changes);
    this.throttle(() => { this.rt.fit(rec); this.rt.sync({ collision: false }); });
  }

  roadPanel(rec) {
    const road = rec.road;
    const st = styleOf(road);
    const box = el('div', 'pn-insp');
    const head = el('div', 'pn-insp-h', `<span class="pn-sw" style="background-image:url(${road.style !== 'custom' ? this.styleSwatch(road.style) : ''});background-color:${st.icon}"></span><div><b>${esc(rec.name)}</b><small>${lengthOf(rec).toLocaleString()} long · ${road.pts.length} points</small></div>`);
    const close = el('button', 'btn icon ghost sm', icon('x', 'sm'));
    close.title = 'Done (Esc)';
    close.onclick = () => this.deselect();
    head.appendChild(close);
    box.appendChild(head);
    const upd = (changes, summary, refit = true) => { this.ops.update(rec, changes, summary, { refit }); this.render(); };
    box.appendChild(this.select_('Style', road.style === 'custom' ? `custom:${road.material}` : road.style,
      [...ROAD_IDS.map((id) => [id, ROAD_STYLES[id].label]), ...Array.from({ length: 16 }, (_, s) => MATERIALS[48 + s] ? [`custom:${s}`, MATERIALS[48 + s]] : null).filter(Boolean)],
      (v) => {
        const custom = v.startsWith('custom:');
        const ns = custom ? 'custom' : v;
        const label = custom ? MATERIALS[48 + Number(v.slice(7))] : ROAD_STYLES[v].label;
        upd({ style: ns, material: custom ? Number(v.slice(7)) : undefined, name: label }, `Made the road ${label.toLowerCase()}`);
      }));
    box.appendChild(this.slider('Width', road.width, 80, 1600, 10, (v) => this.liveRoad(rec, { width: v }), { onChange: (v) => { this.rt.setEditing(false); upd({ width: v }, `Changed the width of the ${rec.name.toLowerCase()}`); } }));
    if (this.sel.point != null && road.pts[this.sel.point]) {
      const p = road.pts[this.sel.point];
      const wHere = p[3] || road.width;
      const row = this.slider('Width at this point', wHere, 60, 1600, 10, (v) => { p[3] = v; this.liveRoad(rec, {}); },
        { onChange: (v) => { p[3] = v === road.width ? undefined : v; if (p[3] === undefined) p.length = 3; this.rt.setEditing(false); upd({ pts: road.pts }, 'Changed the width at a point'); } });
      row.classList.add('pn-point');
      box.appendChild(row);
    }
    const tg = el('div', 'pn-toggles');
    tg.appendChild(this.toggle('Smooth curve', road.smooth !== false, (v) => upd({ smooth: v }, v ? 'Smoothed the road' : 'Made the road straight between its points')));
    tg.appendChild(this.toggle('Closed loop', !!road.closed, (v) => upd({ closed: v && road.pts.length > 2 }, v ? 'Closed the road into a loop' : 'Opened the loop')));
    tg.appendChild(this.toggle('Steps on steep parts', road.stairs ?? st.stairs, (v) => upd({ stairs: v }, v ? 'Steps on the steep parts' : 'Ramps on the steep parts', false), 'Walks get stairs where they climb steeply; off: a grippy ramp'));
    tg.appendChild(this.toggle('Follow the ground', road.follow !== 'points', (v) => upd({ follow: v ? undefined : 'points' }, v ? 'The road follows the ground' : 'The road goes straight between its points (a bridge)'), 'Off: straight between the points you clicked, like a bridge'));
    if (this.rt.world?.terrain && this.engine.level === this.engine.studioLevel) tg.appendChild(this.toggle('Shape the terrain', road.conform !== false, (v) => upd({ conform: v ? undefined : false }, v ? 'The terrain makes room for the road' : 'The terrain stays as it is', false), 'Your own levels: the ground is cut and filled under the road'));
    box.appendChild(tg);
    if (st.markings) {
      box.appendChild(this.seg('Lanes', road.lanes ?? 2, [[1, 'One'], [2, 'Two'], [4, 'Four']], (v) => upd({ lanes: Number(v) }, 'Changed the lanes', false)));
      box.appendChild(this.seg('Centre line', road.marking === 'yellow' ? 'yellow' : 'white', [['white', 'White'], ['yellow', 'Yellow']], (v) => upd({ marking: v === 'white' ? undefined : v }, 'Changed the markings', false)));
    }
    if (!road.closed) box.appendChild(this.seg('Ends', road.caps || 'auto', [['auto', 'Auto'], ['round', 'Round'], ['square', 'Square']], (v) => upd({ caps: v === 'auto' ? undefined : v }, 'Changed the road\'s ends', false)));
    const sides = [['', 'Nothing'], ...LINE_IDS.map((id) => [id, LINE_STYLES[id].label])];
    const sb = el('div', 'pn-sides');
    sb.appendChild(this.select_('Left side', road.left || '', sides, (v) => upd({ left: v || undefined }, v ? `${LINE_STYLES[v].label} on the left` : 'Nothing on the left side', false)));
    sb.appendChild(this.select_('Right side', road.right || '', sides, (v) => upd({ right: v || undefined }, v ? `${LINE_STYLES[v].label} on the right` : 'Nothing on the right side', false)));
    box.appendChild(sb);
    const acts = el('div', 'pn-actions');
    const fit = el('button', 'btn sm', `${icon('mountain', 'sm')}Fit to ground`);
    fit.title = 'Lay the road on the ground again (after you changed the level under it)';
    fit.onclick = () => { upd({}, `Fitted the ${rec.name.toLowerCase()} to the ground`); this.toast('Fitted to the ground', 'check'); };
    const del = el('button', 'btn sm danger', `${icon('trash', 'sm')}Delete`);
    del.onclick = () => this.deleteItem(rec);
    acts.append(fit, del);
    box.appendChild(acts);
    box.appendChild(el('div', 'pn-tip', 'Drag the points to bend it. Drag the middle line to add a point; select a point and press <kbd>Del</kbd> to remove it.'));
    return box;
  }

  linePanel(rec) {
    const line = rec.line;
    const st = LINE_STYLES[line.style] || LINE_STYLES.picket;
    const box = el('div', 'pn-insp');
    const head = el('div', 'pn-insp-h', `<span class="pn-sw pn-line-ico" style="--c:${st.icon}">${lineIcon(line.style)}</span><div><b>${esc(rec.name)}</b><small>${lengthOf(rec).toLocaleString()} long · ${line.pts.length} points</small></div>`);
    const close = el('button', 'btn icon ghost sm', icon('x', 'sm'));
    close.title = 'Done (Esc)';
    close.onclick = () => this.deselect();
    head.appendChild(close);
    box.appendChild(head);
    const upd = (changes, summary, refit = true) => { this.ops.update(rec, changes, summary, { refit }); this.render(); };
    box.appendChild(this.select_('Style', line.style, LINE_IDS.map((id) => [id, LINE_STYLES[id].label]), (v) => upd({ style: v, name: LINE_STYLES[v].label }, `Made it a ${LINE_STYLES[v].label.toLowerCase()}`, false)));
    box.appendChild(this.slider('Height', Math.round((line.scale || 1) * 100), 50, 250, 5, (v) => { line.scale = v / 100; this.throttle(() => this.rt.sync({ collision: false })); }, { unit: '%', onChange: (v) => upd({ scale: v === 100 ? undefined : v / 100 }, 'Changed the height', false) }));
    const tg = el('div', 'pn-toggles');
    tg.appendChild(this.toggle('Smooth curve', !!line.smooth, (v) => upd({ smooth: v || undefined }, v ? 'Rounded the line' : 'Straight between the corners')));
    tg.appendChild(this.toggle('Closed loop', !!line.closed, (v) => upd({ closed: v && line.pts.length > 2 }, v ? 'Closed the line' : 'Opened the line')));
    box.appendChild(tg);
    // sections: gaps and gates
    const k = this.sel.seg;
    const segBox = el('div', 'pn-gaps');
    if (k == null) segBox.innerHTML = '<div class="pn-tip">Click a section of the line (between two points) to leave a gap or put a gate in it.</div>';
    else {
      const kind = (line.gates || []).includes(k) ? 'gate' : (line.gaps || []).includes(k) ? 'gap' : 'solid';
      segBox.appendChild(this.seg(`Section ${k + 1}`, kind, [['solid', 'Closed'], ['gap', 'Gap'], ['gate', 'Gate']], (v) => {
        const gaps = (line.gaps || []).filter((x) => x !== k), gates = (line.gates || []).filter((x) => x !== k);
        if (v === 'gap') gaps.push(k);
        if (v === 'gate') gates.push(k);
        upd({ gaps: gaps.length ? gaps : undefined, gates: gates.length ? gates : undefined }, v === 'gap' ? 'Left a gap in the fence' : v === 'gate' ? 'Put a gate in the fence' : 'Closed the gap', false);
      }));
    }
    box.appendChild(segBox);
    const acts = el('div', 'pn-actions');
    const fit = el('button', 'btn sm', `${icon('mountain', 'sm')}Fit to ground`);
    fit.onclick = () => { upd({}, 'Fitted the line to the ground'); this.toast('Fitted to the ground', 'check'); };
    const del = el('button', 'btn sm danger', `${icon('trash', 'sm')}Delete`);
    del.onclick = () => this.deleteItem(rec);
    acts.append(fit, del);
    box.appendChild(acts);
    return box;
  }

  renderNature() {
    const pane = $('#lib-nature');
    if (!pane) return;
    const scroll = pane.scrollTop;
    pane.innerHTML = '';
    // presets
    const pre = el('div', 'pn-presets');
    for (const [id, p] of Object.entries(PRESETS)) {
      const b = el('button', `chip${this.preset === id ? ' active' : ''}`, esc(p.label));
      b.dataset.preset = id;
      b.onclick = () => { this.preset = id; this.palette = new Map(Object.entries(p.kinds)); this.brush.density = p.density; this.mode = 'paint'; this.setTool(); this.render(); };
      pre.appendChild(b);
    }
    const none = el('button', 'chip', 'None');
    none.title = 'Clear the palette';
    none.onclick = () => { this.preset = null; this.palette.clear(); this.render(); };
    pre.appendChild(none);
    pane.appendChild(this.section('presets', 'Presets', pre));

    // the palette
    const pal = el('div', 'pn-palette');
    for (const group of GROUPS) {
      pal.appendChild(el('div', 'pn-group', esc(group)));
      const grid = el('div', 'pn-kinds');
      for (const k of KINDS.filter((x) => x.group === group)) {
        const on = this.palette.has(k.id);
        const b = el('button', `pn-kind${on ? ' active' : ''}`, `<img alt="" src="${kindIcon(k)}"><span>${esc(k.label)}</span>`);
        b.dataset.kind = k.id;
        b.title = `${k.label}${k.climb ? ' (the game\'s own: Mario can climb it)' : ''}${k.water === 'on' ? ' (on water)' : ''} · click to add or remove · Shift+click: only this`;
        b.onclick = (ev) => {
          if (ev.shiftKey) this.palette = new Map([[k.id, 1]]);
          else if (on) this.palette.delete(k.id);
          else this.palette.set(k.id, 1);
          this.preset = null;
          this.mode = 'paint';
          this.setTool();
          this.render();
        };
        grid.appendChild(b);
      }
      pal.appendChild(grid);
    }
    pane.appendChild(this.section('palette', 'What to plant', pal, { count: this.palette.size || null }));

    // the brush
    const br = el('div');
    br.appendChild(this.slider('Brush size', this.brush.radius, 80, 3000, 10, (v) => { this.brush.radius = v; this.hint(); }));
    br.querySelector('input').id = 'pn-brush-radius';
    br.appendChild(this.slider('Density', this.brush.density, 1, 100, 1, (v) => { this.brush.density = v; }, { unit: '%' }));
    br.appendChild(this.slider('Size variation', this.brush.jitter, 0, 100, 5, (v) => { this.brush.jitter = v; }, { unit: '%' }));
    const tg = el('div', 'pn-toggles');
    tg.appendChild(this.toggle('Random rotation', this.brush.rotate, (v) => { this.brush.rotate = v; }));
    tg.appendChild(this.toggle('Lean with the slope', this.brush.align, (v) => { this.brush.align = v; }, 'Flowers, grass and rocks tilt with the ground (trees stay upright)'));
    tg.appendChild(this.toggle('Keep off roads', this.brush.avoidPaths, (v) => { this.brush.avoidPaths = v; }));
    tg.appendChild(this.toggle('Keep out of water', this.brush.avoidWater, (v) => { this.brush.avoidWater = v; }, 'Lily pads always go on water, reeds may stand in it'));
    tg.appendChild(this.toggle('Eraser: only these kinds', this.brush.eraseKinds, (v) => { this.brush.eraseKinds = v; }, 'Shift+drag removes only the kinds picked above'));
    br.appendChild(tg);
    pane.appendChild(this.section('brush', 'Brush', br));

    // here
    const s = this.rt.stats;
    const info = el('div', 'pn-stats');
    const heavy = s.tris > MAX_TRIS * 0.75;
    info.innerHTML = `<div><b>${s.plants.toLocaleString()}</b> plants here${s.trees ? ` · ${s.trees} game trees` : ''}</div><div class="${heavy ? 'pn-warn' : ''}">${s.tris.toLocaleString()} triangles${heavy ? ' · a lot: the game may slow down' : ''}</div>`;
    const clear = el('button', 'btn sm danger', `${icon('trash', 'sm')}Remove all plants here`);
    clear.disabled = !s.plants;
    clear.onclick = async () => {
      if (!await askConfirm({ title: 'Remove all plants in this area?', text: 'Every tree, flower and rock painted here goes. Ctrl+Z brings them back.', ok: 'Remove all', danger: true })) return;
      const n = this.ops.erasePlants(() => true, 'Removed all plants here');
      this.toast(`${n} plants removed`, 'trash');
      this.render();
    };
    info.appendChild(clear);
    pane.appendChild(this.section('stats', 'In this area', info));
    pane.scrollTop = scroll;
  }

  registerCommands() {
    const go = () => {
      const sh = window.studioShell;
      if (!sh?.register) return;
      sh.register({ id: 'paths.road', label: 'Draw a road', group: 'Build tools', icon: 'road', run: () => { this.openTab('roads'); this.startDraw('road', this.newRoad.style || 'asphalt'); } });
      sh.register({ id: 'paths.walk', label: 'Draw a dirt path', group: 'Build tools', icon: 'road', run: () => { this.openTab('roads'); this.startDraw('road', 'dirt'); } });
      sh.register({ id: 'paths.fence', label: 'Build a fence', group: 'Build tools', icon: 'route', run: () => { this.openTab('roads'); this.startDraw('line', 'picket'); } });
      sh.register({ id: 'paths.nature', label: 'Plant trees and flowers', group: 'Build tools', icon: 'tree', run: () => this.openTab('nature') });
    };
    if (window.studioShell?.register) go(); else window.addEventListener('studio-shell-ready', go, { once: true });
  }
}

// tiny icons for the line styles
function lineIcon(id) {
  const P = {
    picket: '<path d="M4 20V8l2-3 2 3v12M11 20V8l2-3 2 3v12M18 20V8l2-3 2 3v12M2 11h22M2 16h22"/>',
    rustic: '<path d="M5 21V5M19 21V5M5 9h14M5 15h14"/>',
    iron: '<path d="M4 21V6l1-2 1 2v15M10 21V6l1-2 1 2v15M16 21V6l1-2 1 2v15M2 9h20M2 18h20"/>',
    chain: '<path d="M4 21V4M20 21V4M4 6h16M4 8l16 13M4 21 20 8M4 14l9 7M20 14l-9 7"/>',
    bamboo: '<path d="M5 21V4M10 21V4M15 21V4M20 21V4M3 9h19M3 16h19M5 12h0M10 7h0"/>',
    railing: '<path d="M4 21V7M12 21V7M20 21V7M2 7h20M2 13h20"/>',
    guardrail: '<path d="M5 21v-9M19 21v-9M2 10h20v4H2z"/>',
    wall: '<path d="M2 20h20v-9H2zM2 15h20M8 11v4M15 15v5M12 11v4"/>',
    hedge: '<path d="M2 20h20v-8c0-3-3-4-5-3-1-2-4-3-6-1-2-1-6 0-6 3-2 0-3 2-3 3z"/>',
    kerb: '<path d="M2 18h20M2 14h20v4H2z"/>',
    bollards: '<path d="M5 20v-9a2 2 0 0 1 4 0v9M15 20v-9a2 2 0 0 1 4 0v9M3 20h18"/>',
    lamps: '<path d="M7 21V5h7M14 5v3M11 8h6l-1 3h-4z"/>',
    posts: '<path d="M5 21V8l2-2 2 2v13M15 21V8l2-2 2 2v13"/>',
  };
  return `<svg class="i" viewBox="0 0 24 24">${P[id] || P.picket}</svg>`;
}

void KIND; void sampleCurve; void describeItems;
