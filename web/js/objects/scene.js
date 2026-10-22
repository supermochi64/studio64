// The scene panel (outliner) of build mode, multi-selection (Shift/Ctrl+click,
// box-select), group move/rotate/duplicate/delete, align & distribute, hide/lock,
// copy & paste between levels, and prefabs ("My objects").

import { el, esc, svg, newUid, newId, deepCopy, round } from './common.js';
import { relativeItems } from './placer.js';
import { motionLabel, normalizeMotion, isActor } from './motion.js';

const NOISE = /Particle|Sparkle|Puff|Smoke|Mist|SoundLoop|AmbientSounds|Dust|Splash|WaveTrail|Bubble|Shard|Explosion|Fuse|Trail|bhvMario$|ShadowSpawn|CelebrationStar|StarKeyCollection|bhvStudioTerrain|bhvStudioProjectile|Tweester|Butterfly$|bhvBirdsSoundLoop|bhvHidden|Spawner$|SpawnCoord|Manager$|Controller$|bhvWaterLevel|bhvInstantActiveWarp|bhvWarp$|bhvFadingWarp|bhvAirborne|bhvDeathWarp|bhvPaintingStar|bhvStaticObject$/;
const ENEMY = /Goomba|Bobomb|Koopa|Boo|Bully|Whomp|Thwomp|Piranha|Spiny|FlyGuy|Snufit|Scuttlebug|Amp|Chuckya|HeaveHo|Skeeter|Monty|Klepto|Pokey|Blizzard|MrI|Swoop|BulletBill|Lakitu|Moneybag|Spindrift|Chomp|StudioActor/;
const CLIP_KEY = 'studio64.clipboard';
const yawRot = (dx, dz, dyaw) => { const a = (dyaw / 32768) * Math.PI, c = Math.cos(a), s = Math.sin(a); return [dx * c + dz * s, -dx * s + dz * c]; };

export class ScenePanel {
  constructor({ engine, editor, editorUI, studio, store, placer, toast, actors }) {
    this.engine = engine;
    this.editor = editor;
    this.editorUI = editorUI;
    this.studio = studio;
    this.store = store;
    this.placer = placer;
    this.toast = toast;
    this.actors = actors;
    this.multi = new Map(); // key -> { slot, uid }
    this.hidden = new Set(); // slots hidden in build mode (original objects, this session)
    this.filter = 'all';
    this.query = '';
    this.open = false;
    this.box = null;
    this.keepMulti = false;
    this.groupStart = null;
    this.collapsed = new Set(['original']);
    this.build();
  }

  // ---- data -----------------------------------------------------------------

  key(o) { return o.uid ? `u${o.uid}` : `s${o.slot}`; }

  // Everything in the area worth listing: the project's records and the level's own objects.
  items() {
    const objs = this.engine.objects();
    const bySlot = new Map(objs.map((o) => [o.slot, o]));
    const recs = this.editor.records();
    const out = [];
    const seen = new Set();
    for (const o of objs) {
      if (o.uid >= 0x7f000000) continue; // ghosts
      const rec = o.uid ? recs.find((r) => r.uid === o.uid) : null;
      if (o.uid && !rec) continue;
      if (!rec && (NOISE.test(o.bhv) || o.parent >= 0)) continue; // things other objects spawned come and go with them
      if (rec && seen.has(rec.uid)) continue;
      if (rec) seen.add(rec.uid);
      const name = rec?.label || rec?.name || this.studio.nameOfObject(o);
      const group = rec?.block ? 'blocks' : isActor(rec) ? 'custom' : rec ? 'placed' : 'original';
      out.push({ o, rec, name, group, key: this.key(o), moving: !!normalizeMotion(rec?.motion), enemy: ENEMY.test(o.bhv), locked: !!rec?.editor?.locked, hidden: rec ? !!rec.editor?.hidden : this.hidden.has(o.slot) });
    }
    return out;
  }

  selectedItems() {
    const objs = this.engine.objects();
    const out = [];
    for (const m of this.multi.values()) {
      const o = m.uid ? objs.find((x) => x.uid === m.uid) : objs.find((x) => x.slot === m.slot);
      if (o) out.push({ o, rec: o.uid ? this.store.recordOf(o.uid) : null });
    }
    return out;
  }

  // ---- panel ----------------------------------------------------------------

  build() {
    const frame = document.querySelector('#game-frame');
    const p = el('div', 'scene-panel');
    p.id = 'scene-panel';
    p.hidden = true;
    p.innerHTML = `<div class="sp-head">${svg('layers')}<b>Scene</b><span class="sp-count"></span><div class="spacer"></div>
      <button class="btn icon sm ghost" data-a="close" title="Close (O)">${svg('x')}</button></div>
      <div class="lib-search sp-search">${svg('search')}<input placeholder="Find in this level…" spellcheck="false"></div>
      <div class="chips sp-filters">${[['all', 'All'], ['blocks', 'Blocks'], ['placed', 'Placed'], ['moving', 'Moving'], ['enemies', 'Enemies'], ['original', 'Original']].map(([k, l]) => `<button class="chip${k === 'all' ? ' active' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
      <div class="sp-list"></div>
      <div class="sp-multi" hidden></div>`;
    frame.appendChild(p);
    this.panel = p;
    p.querySelector('[data-a=close]').onclick = () => this.toggle(false);
    const input = p.querySelector('.sp-search input');
    input.oninput = () => { this.query = input.value.trim().toLowerCase(); this.render(true); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') input.blur(); e.stopPropagation(); });
    p.querySelectorAll('[data-f]').forEach((c) => {
      c.onclick = () => { this.filter = c.dataset.f; p.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('active', x === c)); this.render(true); };
    });
    // the panel sits over the game: its clicks and wheel are its own
    for (const ev of ['pointerdown', 'wheel', 'dblclick', 'contextmenu']) p.addEventListener(ev, (e) => e.stopPropagation());

    // build bar button
    const bar = document.querySelector('#build-bar');
    if (bar) {
      const b = el('button', 'bar-btn', svg('layers'));
      b.id = 'scene-btn';
      b.title = 'Scene: everything in this level (O)';
      b.onclick = () => this.toggle();
      bar.insertBefore(b, bar.querySelector('#build-help'));
      this.btn = b;
    }
    setInterval(() => { if (this.open && this.editor.active) this.render(false); }, 1000);
  }

  toggle(on = !this.open) {
    this.open = on && this.editor.active;
    this.panel.hidden = !this.open;
    this.btn?.classList.toggle('active', this.open);
    if (this.open) this.render(true);
  }

  render(force) {
    if (!this.open || this.renaming) return;
    let list = [];
    try { list = this.items(); } catch { return; }
    const sig = list.map((x) => `${x.key}:${x.name}:${x.moving}:${x.locked}:${x.hidden}`).join('|') + `#${[...this.multi.keys()].join(',')}#${this.editor.sel ? this.key(this.editor.sel.obj || { uid: this.editor.sel.uid, slot: this.editor.sel.slot }) : ''}#${this.filter}#${this.query}`;
    if (!force && sig === this.sig) return;
    this.sig = sig;
    const q = this.query;
    const f = this.filter;
    const shown = list.filter((x) => (!q || (x.name + ' ' + x.o.bhv).toLowerCase().includes(q))
      && (f === 'all' || (f === 'moving' ? x.moving : f === 'enemies' ? x.enemy : f === 'placed' ? x.group === 'placed' || x.group === 'custom' : x.group === f)));
    this.panel.querySelector('.sp-count').textContent = `${list.length}`;
    const box = this.panel.querySelector('.sp-list');
    const scroll = box.scrollTop;
    box.innerHTML = '';
    const groups = [['blocks', 'Blocks'], ['custom', 'Custom objects'], ['placed', 'Placed objects'], ['original', 'Level objects']];
    const selKey = this.editor.sel ? (this.editor.sel.uid ? `u${this.editor.sel.uid}` : `s${this.editor.sel.slot}`) : null;
    for (const [g, label] of groups) {
      const rows = shown.filter((x) => x.group === g);
      if (!rows.length) continue;
      const collapsed = this.collapsed.has(g) && !q && f === 'all';
      const head = el('button', 'sp-group', `<svg class="i sm chev${collapsed ? '' : ' open'}" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>${esc(label)} <span>${rows.length}</span>`);
      head.onclick = () => { if (this.collapsed.has(g)) this.collapsed.delete(g); else this.collapsed.add(g); this.render(true); };
      box.appendChild(head);
      if (collapsed) continue;
      for (const x of rows.slice(0, 400)) box.appendChild(this.row(x, x.key === selKey));
    }
    if (!shown.length) box.appendChild(el('div', 'lib-tip', list.length ? 'Nothing matches.' : 'Nothing here yet.'));
    box.scrollTop = scroll;
    this.renderMulti();
  }

  row(x, primary) {
    const r = el('div', `sp-row${primary ? ' primary' : ''}${this.multi.has(x.key) ? ' multi' : ''}${x.hidden ? ' dim' : ''}`);
    const ic = x.group === 'blocks' ? 'block' : x.enemy ? 'enemy' : x.o.bhv === 'bhvStar' ? 'star' : 'obj';
    r.innerHTML = `${svg(ic)}<span class="sp-name" title="${esc(x.o.bhv)}">${esc(x.name)}</span>
      ${x.moving ? `<span class="sp-badge" title="${esc(motionLabel(x.rec.motion))}">${svg('path')}</span>` : ''}
      <button class="sp-tog${x.hidden ? ' on' : ''}" data-t="hide" title="${x.hidden ? 'Show' : 'Hide while building'}">${svg(x.hidden ? 'eyeOff' : 'eye')}</button>
      ${x.rec ? `<button class="sp-tog${x.locked ? ' on' : ''}" data-t="lock" title="${x.locked ? 'Unlock' : 'Lock (can\'t be picked or moved)'}">${svg(x.locked ? 'lock' : 'unlock')}</button>` : '<span class="sp-tog-pad"></span>'}`;
    r.onclick = (e) => {
      if (e.target.closest('[data-t]') || e.target.closest('.sp-rename')) return;
      // a double click (the list may have been redrawn by the first click): rename or frame
      if (e.detail >= 2) {
        if (e.target.classList.contains('sp-name') && x.rec) this.rename(r.querySelector('.sp-name'), x);
        else if (!x.locked) this.editor.frameSelection();
        return;
      }
      if (e.shiftKey || e.ctrlKey || e.metaKey) this.toggleMember(x.o);
      else this.selectOnly(x.o, x.locked);
    };
    r.querySelector('[data-t=hide]').onclick = () => this.setHidden(x, !x.hidden);
    const lock = r.querySelector('[data-t=lock]');
    if (lock) lock.onclick = () => this.setLocked(x, !x.locked);
    return r;
  }

  rename(span, x) {
    this.renaming = true;
    const inp = el('input', 'sp-rename');
    inp.value = x.name;
    span.replaceWith(inp);
    inp.focus();
    inp.select();
    let finished = false;
    const done = (save) => {
      if (finished) return;
      finished = true;
      this.renaming = false;
      const name = inp.value.trim().slice(0, 60);
      if (save && name && name !== x.name) {
        x.rec.name = name;
        x.rec.label = name;
        this.store.commit({ type: 'update', uid: x.rec.uid, fields: { name, label: name }, summary: `Renamed ${x.name} to ${name}` });
        if (this.editor.sel?.uid === x.rec.uid) { this.editor.sel.name = name; this.editor.ui.onSelect(this.editor.sel); }
      }
      this.render(true);
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    inp.addEventListener('blur', () => done(true));
  }

  setHidden(x, hidden) {
    if (x.rec) {
      const editor = { ...(x.rec.editor || {}), hidden };
      x.rec.editor = editor;
      this.store.commit({ type: 'update', uid: x.rec.uid, fields: { editor }, summary: `${hidden ? 'Hid' : 'Showed'} ${x.name}` });
    } else if (hidden) this.hidden.add(x.o.slot); else this.hidden.delete(x.o.slot);
    this.engine.M._studio_set_visible?.(x.o.slot, hidden ? 0 : 1);
    this.render(true);
  }

  setLocked(x, locked) {
    const editor = { ...(x.rec.editor || {}), locked };
    x.rec.editor = editor;
    this.store.commit({ type: 'update', uid: x.rec.uid, fields: { editor }, summary: `${locked ? 'Locked' : 'Unlocked'} ${x.name}` });
    if (locked && this.editor.sel?.uid === x.rec.uid) this.editor.select(null);
    this.render(true);
  }

  // Build mode hides what is hidden; playing shows everything.
  applyHidden(building) {
    for (const rec of this.editor.records()) {
      if (!rec.editor?.hidden) continue;
      const o = this.engine.objects().find((x) => x.uid === rec.uid);
      if (o) this.engine.M._studio_set_visible?.(o.slot, building ? 0 : 1);
    }
    for (const slot of this.hidden) this.engine.M._studio_set_visible?.(slot, building ? 0 : 1);
    if (!building) this.hidden.clear();
  }

  isLocked(slot) {
    const o = this.editor.objectAt(slot);
    return !!(o?.uid && this.store.recordOf(o.uid)?.editor?.locked);
  }

  // ---- selection -------------------------------------------------------------

  selectOnly(o, locked) {
    this.multi.clear();
    if (locked) { this.toast?.('Locked: unlock it in the scene panel to edit it', 'lock'); this.flash(o); return; }
    this.editor.select(o.slot);
    this.render(true);
  }

  flash(o) {
    this.flashObj = { o, until: performance.now() + 900 };
  }

  toggleMember(o) {
    const ed = this.editor;
    const k = this.key(o);
    if (this.isLocked(o.slot)) { this.toast?.('Locked: unlock it to select it', 'lock'); return; }
    if (!this.multi.size && ed.sel) this.multi.set(ed.sel.uid ? `u${ed.sel.uid}` : `s${ed.sel.slot}`, { slot: ed.sel.slot, uid: ed.sel.uid });
    if (this.multi.has(k)) {
      this.multi.delete(k);
      const first = [...this.multi.values()][0];
      this.keepMulti = true;
      if (!first) ed.select(null);
      else if (ed.sel && (ed.sel.uid ? `u${ed.sel.uid}` : `s${ed.sel.slot}`) === k) ed.select(this.slotOf(first));
      this.keepMulti = false;
    } else {
      this.multi.set(k, { slot: o.slot, uid: o.uid });
      this.keepMulti = true;
      ed.select(o.slot);
      this.keepMulti = false;
    }
    if (this.multi.size === 1) this.multi.clear();
    this.render(true);
  }

  slotOf(m) {
    if (!m.uid) return m.slot;
    const o = this.engine.objects().find((x) => x.uid === m.uid);
    return o ? o.slot : -1;
  }

  // The editor selected something (click, inspector, undo...).
  onSelect(sel) {
    if (this.keepMulti) return;
    if (!sel) { this.multi.clear(); }
    else if (this.multi.size && !this.multi.has(sel.uid ? `u${sel.uid}` : `s${sel.slot}`)) this.multi.clear();
    if (this.open) this.render(false);
  }

  setMulti(objs) {
    this.multi.clear();
    for (const o of objs) if (!this.isLocked(o.slot)) this.multi.set(this.key(o), { slot: o.slot, uid: o.uid });
    const first = objs.find((o) => this.multi.has(this.key(o)));
    this.keepMulti = true;
    this.editor.select(first ? first.slot : null);
    this.keepMulti = false;
    if (this.multi.size === 1) this.multi.clear();
    this.render(true);
  }

  // ---- editor events ----------------------------------------------------------

  // Shift/Ctrl+click toggles, a click on a locked object doesn't select it.
  up(m, e, click) {
    const ed = this.editor;
    if (this.box) {
      const b = this.box;
      this.box = null;
      if (Math.abs(b.x1 - b.x0) > 6 && Math.abs(b.y1 - b.y0) > 6) { this.boxSelect(b, e.shiftKey || e.ctrlKey); return true; }
      return false;
    }
    if (!click || e.button !== 0 || ed.tool !== 'select') return false;
    if (ed.hitHandle(m.x, m.y)) return false;
    const hit = ed.pick(m.x, m.y);
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (hit && hit.slot >= 0) { const o = ed.objectAt(hit.slot); if (o && o.bhv !== 'bhvMario') this.toggleMember(o); }
      ed.downAt = null;
      return true;
    }
    if (hit && hit.slot >= 0 && this.isLocked(hit.slot)) {
      ed.lastPoint = [Math.round(hit.x), Math.round(hit.y), Math.round(hit.z)];
      ed.select(null);
      return true;
    }
    return false;
  }

  // A plain left drag on nothing selected draws a selection box.
  afterDown(m, e) {
    const ed = this.editor;
    if (e.button !== 0 || ed.tool !== 'select' || ed.drag || e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;
    this.boxPending = { x0: m.x, y0: m.y };
  }

  move(m) {
    if (this.boxPending && !this.box) {
      if (Math.hypot(m.x - this.boxPending.x0, m.y - this.boxPending.y0) > 6 && !this.editor.drag) this.box = { ...this.boxPending, x1: m.x, y1: m.y };
    }
    if (this.box) { this.box.x1 = m.x; this.box.y1 = m.y; return true; }
    return false;
  }

  clearPending() { this.boxPending = null; }

  boxSelect(b, add) {
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    const inside = this.items().filter((x) => {
      const r = x.rec;
      const c = r?.block ? [r.x, r.y + r.block.sy / 2, r.z] : [x.o.x, x.o.y + 40, x.o.z];
      const s = this.editor.project(c);
      return s && s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1 && !x.locked;
    }).map((x) => x.o);
    if (add) {
      const cur = this.selectedItems().map((x) => x.o);
      if (!cur.length && this.editor.sel) cur.push(this.editor.sel.obj);
      for (const o of inside) if (!cur.some((c) => this.key(c) === this.key(o))) cur.push(o);
      this.setMulti(cur);
    } else this.setMulti(inside);
    if (inside.length) this.toast?.(`${this.multi.size || inside.length} selected`, 'check');
  }

  draw(g) {
    const ed = this.editor;
    if (!ed.active) return;
    if (this.multi.size > 1) {
      for (const { o, rec } of this.selectedItems()) {
        if (ed.sel && this.key(o) === (ed.sel.uid ? `u${ed.sel.uid}` : `s${ed.sel.slot}`)) continue;
        if (rec?.block) ed.drawBlockBox(rec, 'rgba(255,200,61,0.75)', [5, 4]);
        else ed.drawObjectBox(o, 'rgba(255,200,61,0.75)');
      }
    }
    if (this.flashObj && performance.now() < this.flashObj.until) ed.drawObjectBox(this.flashObj.o, 'rgba(255,120,120,0.9)');
    if (this.box) {
      const b = this.box;
      g.save();
      g.fillStyle = 'rgba(255,200,61,0.10)';
      g.strokeStyle = 'rgba(255,200,61,0.9)';
      g.setLineDash([5, 4]);
      g.lineWidth = 1.5;
      g.fillRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      g.strokeRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      g.restore();
    }
  }

  // ---- group edits --------------------------------------------------------------

  members() {
    // the selection as editable entries: { o, rec, pose }
    return this.selectedItems().map(({ o, rec }) => ({ o, rec, p: rec ? [rec.x, rec.y, rec.z] : [o.x, o.y, o.z], yaw: (rec ? rec.yaw : o.yaw) & 0xffff, pitch: rec?.pitch | 0, roll: rec?.roll | 0, scale: rec?.scale ?? o.scale ?? 1 }));
  }

  isGroup() { return this.multi.size > 1 && !!this.editor.sel; }

  // Before the editor moves the selected one: where the group starts from.
  groupBefore() {
    if (!this.isGroup() || this.groupStart) return;
    const ed = this.editor;
    const pk = ed.sel.uid ? `u${ed.sel.uid}` : `s${ed.sel.slot}`;
    const start = ed.drag?.start || ed.selPose();
    this.groupStart = { p: [...start.p], yaw: start.yaw, members: this.members().filter((x) => this.key(x.o) !== pk) };
  }

  // Live: the other members follow the selected one.
  groupApply(pose) {
    if (!this.isGroup()) return;
    this.groupBefore();
    const gs = this.groupStart;
    const dyaw = ((pose.yaw - gs.yaw) << 16) >> 16;
    for (const mb of gs.members) {
      const [rx, rz] = yawRot(mb.p[0] - gs.p[0], mb.p[2] - gs.p[2], dyaw);
      const np = [pose.p[0] + rx, mb.p[1] + (pose.p[1] - gs.p[1]), pose.p[2] + rz];
      mb.next = { p: np.map(Math.round), yaw: (mb.yaw + dyaw) & 0xffff };
      this.engine.transform(mb.o.slot, np[0], np[1], np[2], mb.pitch, mb.next.yaw, mb.roll, mb.rec?.block ? 0 : mb.scale);
    }
  }

  // The selected one is a record too: it goes into the same change as the others, so one
  // Ctrl+Z undoes the whole group move (true: handled, the editor commits nothing itself).
  groupCommitAll(pose, summary) {
    const ed = this.editor;
    if (!this.isGroup() || !this.groupStart || !ed.sel?.rec) return false;
    const gs = this.groupStart;
    const fields = { x: Math.round(pose.p[0]), y: Math.round(pose.p[1]), z: Math.round(pose.p[2]), yaw: pose.yaw & 0xffff, pitch: pose.pitch | 0, roll: pose.roll | 0 };
    if (!pose.block && pose.scale) fields.scale = Math.round(pose.scale * 1000) / 1000;
    const updates = [{ uid: ed.sel.rec.uid, fields }];
    const adopt = [];
    for (const mb of gs.members) {
      if (!mb.next) continue;
      const f = { x: mb.next.p[0], y: mb.next.p[1], z: mb.next.p[2], yaw: mb.next.yaw };
      if (mb.rec) { Object.assign(mb.rec, f); updates.push({ uid: mb.rec.uid, fields: f }); } else adopt.push({ o: mb.o, fields: f });
    }
    this.groupStart = null;
    this.store.commit({ type: 'update_many', updates, summary: `${summary} ${updates.length + adopt.length} objects` });
    if (adopt.length) this.adoptMany(adopt, summary);
    return true;
  }

  // Saved: one change for the records, one for adopted originals.
  groupCommit(pose, summary) {
    const gs = this.groupStart;
    this.groupStart = null;
    if (!gs) return;
    const updates = [];
    const adopt = [];
    for (const mb of gs.members) {
      if (!mb.next) continue;
      if (mb.rec) {
        Object.assign(mb.rec, { x: mb.next.p[0], y: mb.next.p[1], z: mb.next.p[2], yaw: mb.next.yaw });
        updates.push({ uid: mb.rec.uid, fields: { x: mb.next.p[0], y: mb.next.p[1], z: mb.next.p[2], yaw: mb.next.yaw } });
      } else adopt.push({ o: mb.o, fields: { x: mb.next.p[0], y: mb.next.p[1], z: mb.next.p[2], yaw: mb.next.yaw } });
    }
    if (updates.length) this.store.commit({ type: 'update_many', updates, summary: `${summary} ${updates.length + 1} objects` });
    if (adopt.length) this.adoptMany(adopt, summary);
  }

  // Original objects become the project's own copies (with the given fields).
  adoptMany(list, summary = 'Changed') {
    const records = [], rules = [];
    for (const { o, fields } of list) {
      if (o.cat < 0) continue;
      const entry = this.studio.catalog.entries[o.cat].id;
      const name = this.studio.nameOfObject(o);
      const useHome = o.hx || o.hy || o.hz;
      const rule = { bhv: o.bhv, x: useHome ? o.hx : o.x, y: useHome ? o.hy : o.y, z: useHome ? o.hz : o.z, r: 60, name, restore: { entry, x: o.hx || o.x, y: o.hy || o.y, z: o.hz || o.z, yaw: o.yaw, bparams: o.bparams } };
      const rec = { uid: newUid(), entry, x: o.x, y: o.y, z: o.z, yaw: o.yaw & 0xffff, pitch: 0, roll: 0, bparams: o.bparams >>> 0, scale: o.scale || 1, name, ...fields };
      this.engine.deleteSlot(o.slot);
      this.engine.addRemoval(rule);
      const slot = this.engine.spawn(rec);
      this.store.records().push(rec);
      records.push(rec);
      rules.push(rule);
      const k = `s${o.slot}`;
      if (this.multi.has(k)) { this.multi.delete(k); this.multi.set(`u${rec.uid}`, { slot, uid: rec.uid }); }
    }
    if (records.length) this.store.commit({ type: 'add', summary: `${summary} ${records.length} level objects`, records, rules });
    return records;
  }

  // Move members to new positions: { key -> [x,y,z] } as one change.
  moveMembers(targets, summary) {
    const updates = [], adopt = [];
    for (const mb of this.members()) {
      const t = targets.get(this.key(mb.o));
      if (!t) continue;
      const fields = { x: Math.round(t[0]), y: Math.round(t[1]), z: Math.round(t[2]) };
      if (mb.rec) {
        Object.assign(mb.rec, fields);
        this.engine.transform(mb.o.slot, fields.x, fields.y, fields.z, mb.pitch, mb.yaw, mb.roll, mb.rec.block ? 0 : mb.scale);
        updates.push({ uid: mb.rec.uid, fields });
      } else adopt.push({ o: mb.o, fields });
    }
    if (updates.length) this.store.commit({ type: 'update_many', updates, summary });
    if (adopt.length) this.adoptMany(adopt, summary);
    this.editor.refreshSelection();
    this.render(true);
  }

  // Extents of a member along an axis (blocks have a size, objects a hitbox).
  extent(mb, axis) {
    const b = mb.rec?.block;
    if (axis === 1) return b ? [mb.p[1], mb.p[1] + b.sy] : [mb.p[1], mb.p[1] + (mb.o.h || 100) * (mb.scale || 1)];
    const half = b ? (axis === 0 ? b.sx : b.sz) / 2 : (mb.o.r || 60) * (mb.scale || 1);
    return [mb.p[axis] - half, mb.p[axis] + half];
  }

  align(axis, where) {
    const mbs = this.members();
    if (mbs.length < 2) return;
    const ex = mbs.map((m) => this.extent(m, axis));
    const lo = Math.min(...ex.map((e) => e[0])), hi = Math.max(...ex.map((e) => e[1]));
    const targets = new Map();
    mbs.forEach((m, i) => {
      const p = [...m.p];
      const [a, b] = ex[i];
      const off = p[axis] - a, size = b - a;
      if (where === 'min') p[axis] = lo + off;
      else if (where === 'max') p[axis] = hi - size + off;
      else p[axis] = (lo + hi) / 2 - size / 2 + off;
      targets.set(this.key(m.o), p);
    });
    this.moveMembers(targets, `Aligned ${mbs.length} objects`);
  }

  distribute(axis) {
    const mbs = this.members().sort((a, b) => a.p[axis] - b.p[axis]);
    if (mbs.length < 3) { this.toast?.('Distribute needs 3 or more objects', 'x'); return; }
    const a = mbs[0].p[axis], b = mbs[mbs.length - 1].p[axis];
    const targets = new Map();
    mbs.forEach((m, i) => { const p = [...m.p]; p[axis] = a + ((b - a) * i) / (mbs.length - 1); targets.set(this.key(m.o), p); });
    this.moveMembers(targets, `Spaced out ${mbs.length} objects`);
  }

  dropAll() {
    const targets = new Map();
    for (const m of this.members()) {
      const y = this.engine.floor(m.p[0], m.p[1] + 50, m.p[2]);
      if (y > -20000) targets.set(this.key(m.o), [m.p[0], y, m.p[2]]);
    }
    this.moveMembers(targets, 'Dropped objects to the ground');
  }

  snapAll() {
    const g = this.editor.snap || 50;
    const targets = new Map();
    for (const m of this.members()) targets.set(this.key(m.o), [Math.round(m.p[0] / g) * g, Math.round(m.p[1] / g) * g, Math.round(m.p[2] / g) * g]);
    this.moveMembers(targets, `Snapped objects to the ${g} grid`);
  }

  // Records of the selection (originals as records of their catalog entry).
  selectionRecords() {
    const list = this.isGroup() ? this.selectedItems() : this.editor.sel ? [{ o: this.editor.sel.obj, rec: this.editor.sel.rec }] : [];
    const out = [];
    for (const { o, rec } of list) {
      if (rec) out.push(deepCopy(rec));
      else if (o && o.cat >= 0) out.push({ entry: this.studio.catalog.entries[o.cat].id, x: o.x, y: o.y, z: o.z, yaw: o.yaw & 0xffff, pitch: 0, roll: 0, bparams: o.bparams >>> 0, scale: o.scale || 1, name: this.studio.nameOfObject(o) });
    }
    return out;
  }

  deleteGroup() {
    const uids = [], rules = [];
    let n = 0;
    for (const { o, rec } of this.selectedItems()) {
      n++;
      if (rec) { this.engine.deleteUid(rec.uid); uids.push(rec.uid); continue; }
      const useHome = o.hx || o.hy || o.hz;
      const rule = { bhv: o.bhv, x: useHome ? o.hx : o.x, y: useHome ? o.hy : o.y, z: useHome ? o.hz : o.z, r: 60, name: this.studio.nameOfObject(o),
        restore: o.cat >= 0 ? { entry: this.studio.catalog.entries[o.cat].id, x: o.x, y: o.y, z: o.z, yaw: o.yaw, bparams: o.bparams } : undefined };
      this.engine.deleteSlot(o.slot);
      this.engine.addRemoval(rule);
      rules.push(rule);
    }
    this.store.commit({ type: 'remove', summary: `Removed ${n} objects`, uids, rules });
    this.multi.clear();
    this.editor.select(null);
    this.render(true);
  }

  duplicateGroup() {
    const recs = this.selectionRecords();
    if (!recs.length) return;
    const xs = recs.map((r) => r.x);
    const w = Math.max(200, Math.max(...xs) - Math.min(...xs) + 200);
    const copies = recs.map((r) => ({ ...r, uid: newUid(), x: r.x + w }));
    this.editor.freshStars?.(copies);
    const slots = copies.map((r) => { const s = this.engine.spawn(r); this.store.records().push(r); return s; });
    this.store.commit({ type: 'add', summary: `Duplicated ${copies.length} objects`, records: copies });
    const objs = this.engine.objects();
    this.setMulti(copies.map((c, i) => objs.find((o) => o.slot === slots[i])).filter(Boolean));
  }

  copy() {
    const recs = this.selectionRecords();
    if (!recs.length) return false;
    const items = relativeItems(recs);
    this.clip = items;
    try { localStorage.setItem(CLIP_KEY, JSON.stringify(items)); } catch { /* full */ }
    this.toast?.(`Copied ${items.length} object${items.length > 1 ? 's' : ''}: paste in any level with Ctrl+V`, 'copy');
    return true;
  }

  paste() {
    let items = this.clip;
    try { items = JSON.parse(localStorage.getItem(CLIP_KEY) || 'null') || items; } catch { /* keep */ }
    if (!items?.length) { this.toast?.('Nothing copied yet', 'x'); return false; }
    this.placer.start(items, { name: items.length > 1 ? `${items.length} objects` : items[0].name || 'object', summary: `Pasted ${items.length} object${items.length > 1 ? 's' : ''}` });
    return true;
  }

  savePrefab(name) {
    const recs = this.selectionRecords();
    if (!recs.length) { this.toast?.('Select something first', 'x'); return null; }
    const prefab = { id: newId(), name: String(name || 'Prefab').slice(0, 40), items: relativeItems(recs), created: Date.now() };
    const list = [...this.store.game('prefabs', []), prefab];
    this.store.setGame('prefabs', list, `Saved the prefab “${prefab.name}”`);
    this.toast?.(`“${prefab.name}” is in My objects`, 'check');
    return prefab;
  }

  askPrefabName() {
    const m = this.panel.querySelector('.sp-multi');
    const box = el('div', 'sp-prefab');
    box.innerHTML = `<input placeholder="Prefab name" maxlength="40" spellcheck="false"><button class="btn sm primary">Save</button>`;
    const inp = box.querySelector('input');
    const go = () => { const p = this.savePrefab(inp.value.trim() || 'Prefab'); if (p) box.remove(); };
    box.querySelector('button').onclick = go;
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); if (e.key === 'Escape') box.remove(); });
    (m.hidden ? this.panel.querySelector('.sp-list') : m).prepend(box);
    inp.focus();
  }

  renderMulti() {
    const m = this.panel.querySelector('.sp-multi');
    const n = this.multi.size;
    const single = !n && this.editor.sel;
    m.hidden = !n && !single;
    if (m.hidden) { m.innerHTML = ''; return; }
    if (single) {
      m.innerHTML = `<div class="sp-multi-head"><b>${esc(this.editor.sel.name)}</b></div><div class="sp-actions">
        <button class="btn sm" data-g="copy" title="Ctrl+C">${svg('copy')}Copy</button><button class="btn sm" data-g="prefab">${svg('prefab')}Save as prefab</button></div>`;
    } else {
      m.innerHTML = `<div class="sp-multi-head"><b class="count">${n} selected</b><button class="btn sm ghost" data-g="none">Clear</button></div>
      <div class="sp-tools">
        <span class="sp-ax">X</span><button data-al="0:min" title="Align left (smallest X)">${svg('alMin')}</button><button data-al="0:mid" title="Center on X">${svg('alMid')}</button><button data-al="0:max" title="Align right (largest X)">${svg('alMax')}</button><button data-di="0" title="Space evenly along X">${svg('spread')}</button>
        <span class="sp-ax">Z</span><button data-al="2:min" title="Align to the smallest Z">${svg('alMin')}</button><button data-al="2:mid" title="Center on Z">${svg('alMid')}</button><button data-al="2:max" title="Align to the largest Z">${svg('alMax')}</button><button data-di="2" title="Space evenly along Z">${svg('spread')}</button>
        <span class="sp-ax">Y</span><button data-al="1:min" title="Bottoms level">${svg('alBottom')}</button><button data-al="1:max" title="Tops level">${svg('alTop')}</button><button data-g="drop" title="Drop all to the ground (G)">${svg('ground')}</button><button data-g="snap" title="Snap all to the grid">${svg('grid')}</button>
      </div>
      <div class="sp-actions"><button class="btn sm" data-g="dup" title="Ctrl+D">Duplicate</button><button class="btn sm" data-g="copy" title="Ctrl+C">${svg('copy')}Copy</button>
        <button class="btn sm" data-g="prefab">${svg('prefab')}Prefab</button><button class="btn sm danger" data-g="del" title="Delete">${svg('trash')}Delete</button></div>`;
    }
    m.querySelectorAll('[data-al]').forEach((b) => { const [a, w] = b.dataset.al.split(':'); b.onclick = () => this.align(Number(a), w); });
    m.querySelectorAll('[data-di]').forEach((b) => { b.onclick = () => this.distribute(Number(b.dataset.di)); });
    const act = { none: () => { this.multi.clear(); this.editor.select(null); this.render(true); }, drop: () => this.dropAll(), snap: () => this.snapAll(), dup: () => this.duplicateGroup(), copy: () => this.copy(), prefab: () => this.askPrefabName(), del: () => this.deleteGroup() };
    m.querySelectorAll('[data-g]').forEach((b) => { b.onclick = () => act[b.dataset.g]?.(); });
  }

  // Keyboard: O toggles the panel, Ctrl+C/V copy/paste, Ctrl+A selects all, group delete/duplicate.
  onKey(e, down) {
    if (!down || !this.editor.active) return false;
    const mod = e.ctrlKey || e.metaKey;
    if (e.code === 'KeyO' && !mod) { this.toggle(); e.preventDefault(); return true; }
    if (e.code === 'F2' && this.open && this.editor.sel?.rec) {
      const k = this.editor.sel.uid ? `u${this.editor.sel.uid}` : '';
      const x = this.items().find((it) => it.key === k);
      const span = this.panel.querySelector('.sp-row.primary .sp-name');
      if (x && span) { this.rename(span, x); e.preventDefault(); return true; }
    }
    if (mod && e.code === 'KeyC' && !e.shiftKey) { if (this.copy()) { e.preventDefault(); return true; } return false; }
    if (mod && e.code === 'KeyV') { if (this.paste()) e.preventDefault(); return true; }
    if (mod && e.code === 'KeyA') {
      const all = this.items().filter((x) => x.group !== 'original' && !x.locked).map((x) => x.o);
      if (all.length) this.setMulti(all);
      e.preventDefault();
      return true;
    }
    if (this.isGroup() && (e.code === 'Delete' || e.code === 'Backspace')) { this.deleteGroup(); e.preventDefault(); return true; }
    if (this.isGroup() && mod && e.code === 'KeyD') { this.duplicateGroup(); e.preventDefault(); return true; }
    if (this.isGroup() && e.code === 'KeyG') { this.dropAll(); e.preventDefault(); return true; }
    return false;
  }
}

export { round };
