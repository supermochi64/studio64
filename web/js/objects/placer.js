// Placing several records at once (prefabs, pasted objects, custom objects):
// ghosts follow the mouse, R turns them, a click puts them in the level.

import { newUid, deepCopy } from './common.js';

const GHOST = 0x7f800000;

// Records relative to an anchor (bottom center), ready to be saved as a prefab or clipboard.
export function relativeItems(records) {
  if (!records.length) return [];
  const xs = records.map((r) => r.x), zs = records.map((r) => r.z), ys = records.map((r) => r.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2, by = Math.min(...ys);
  return records.map((r) => {
    const it = deepCopy(r);
    delete it.uid;
    it.x = Math.round(r.x - cx);
    it.y = Math.round(r.y - by);
    it.z = Math.round(r.z - cz);
    return it;
  });
}

// Absolute records for items placed at p, turned by yaw (0..65535).
export function placeItems(items, p, yaw = 0) {
  const a = (yaw / 32768) * Math.PI, c = Math.cos(a), s = Math.sin(a);
  return items.map((it) => {
    const r = deepCopy(it);
    // SM64 yaw turns +z toward +x
    const x = it.x * c + it.z * s, z = -it.x * s + it.z * c;
    r.x = Math.round(p[0] + x);
    r.y = Math.round(p[1] + it.y);
    r.z = Math.round(p[2] + z);
    r.yaw = ((it.yaw | 0) + yaw) & 0xffff;
    if (r.motion?.path?.points) {
      r.motion.path.points = r.motion.path.points.map((q) => [Math.round(q[0] * c + q[2] * s), q[1], Math.round(-q[0] * s + q[2] * c)]);
    }
    return r;
  });
}

export class Placer {
  constructor({ engine, editor, store, toast, onPlaced }) {
    this.engine = engine;
    this.editor = editor;
    this.store = store;
    this.toast = toast;
    this.onPlaced = onPlaced;
    this.active = null;
  }

  start(items, { name = 'objects', summary, onDone } = {}) {
    this.cancel();
    const ed = this.editor;
    if (!ed.active) ed.enter();
    ed.cancelPlacing?.();
    ed.cancelGenerator?.();
    ed.select(null);
    this.active = { items: deepCopy(items), name, summary, onDone, yaw: 0, ghosts: [], point: null };
    ed.tool = 'objects-place';
    ed.ui.onToolChange();
    this.hint();
  }

  hint() {
    const h = document.querySelector('#tool-hint');
    if (!h || !this.active) return;
    h.innerHTML = `Click to place ${String(this.active.name ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)} · <kbd>R</kbd> turn · <kbd>Shift</kbd>+click places more · right-click or <kbd>Esc</kbd> to stop`;
    h.hidden = false;
  }

  clearGhosts() {
    for (const g of this.active?.ghosts || []) this.engine.deleteUid(g.uid);
    if (this.active) this.active.ghosts = [];
  }

  cancel() {
    if (!this.active) return;
    this.clearGhosts();
    this.active = null;
    if (this.editor.tool === 'objects-place') { this.editor.tool = 'select'; this.editor.ui.onToolChange(); }
  }

  update(m) {
    const a = this.active;
    const ed = this.editor;
    const hit = ed.pick(m.x, m.y, { objects: false });
    if (!hit) return;
    const sn = ed.snap;
    const p = [sn ? Math.round(hit.x / sn) * sn : Math.round(hit.x), Math.round(hit.y), sn ? Math.round(hit.z / sn) * sn : Math.round(hit.z)];
    a.point = p;
    this.clearGhosts();
    const recs = placeItems(a.items, p, a.yaw);
    recs.forEach((r, i) => {
      r.uid = GHOST + ((performance.now() | 0) % 4096) * 64 + i;
      const slot = this.engine.spawn(r);
      if (slot >= 0) a.ghosts.push({ uid: r.uid, slot });
    });
  }

  commit(keep) {
    const a = this.active;
    if (!a?.point) return;
    const recs = placeItems(a.items, a.point, a.yaw).map((r) => ({ ...r, uid: newUid() }));
    this.editor.freshStars?.(recs); // pasted stars are new stars, not twins
    this.clearGhosts();
    const slots = [];
    for (const r of recs) {
      slots.push(this.engine.spawn(r)); // the spawn hook gives it its motion and behaviour
      this.store.records().push(r);
    }
    this.store.commit({ type: 'add', summary: a.summary || `Placed ${a.name}`, records: recs });
    this.editor.lastPoint = a.point;
    this.onPlaced?.(recs, slots);
    const done = a.onDone;
    if (!keep) {
      this.cancel();
      if (recs.length === 1 && slots[0] >= 0) this.editor.select(slots[0]);
    }
    done?.(recs);
  }

  // ---- editor events (return true when handled) ----
  down(m, e) { return !!this.active && e.button === 0; }
  move(m) { if (!this.active) return false; this.update(m); return true; }
  up(m, e, click) {
    if (!this.active) return false;
    if (!click) return e.button === 0;
    if (e.button === 2) { this.cancel(); return true; }
    if (e.button === 0) { this.commit(e.shiftKey); return true; }
    return false;
  }
  key(e, down) {
    if (!this.active || !down) return false;
    if (e.code === 'Escape') { this.cancel(); e.preventDefault(); return true; }
    if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
      this.active.yaw = (this.active.yaw + (e.shiftKey ? -8192 : 8192)) & 0xffff;
      if (this.editor.mouse) this.update(this.editor.mouse);
      e.preventDefault();
      return true;
    }
    return false;
  }
}
