// Build mode: free camera, mouse picking, gizmos, placement and generators.
//
// The world is paused while building. The camera is ours (studio_set_camera) and
// the engine reports its view matrix every frame, so the overlay (selection
// boxes, handles, pipe links) lines up with what the game draws.

import { isTyping } from './typing.js';
import { SHAPES, SHAPE_NAMES, MATERIALS, PRESETS, GENERATORS, blockDefaults, blockName, yawToRad, radToYaw } from './generators.js';

const GHOST_UID = 0x7f000000;
const ACCENT = '#ffc83d';
const AXES = [
  { id: 'x', dir: [1, 0, 0], color: '#ff5d5d' },
  { id: 'y', dir: [0, 1, 0], color: '#5ee08a' },
  { id: 'z', dir: [0, 0, 1], color: '#5aa7ff' },
];

// ---- small vector helpers ---------------------------------------------------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const snapTo = (v, g) => (g ? Math.round(v / g) * g : v);
// The game has no collision past ±16384 on X and Z (Studio 64's engine; the original's is ±8192):
// things put out there fall forever.
const WORLD_EDGE = 16300;
const inWorld = (v) => Math.max(-WORLD_EDGE, Math.min(WORLD_EDGE, v));
const WORLD_Y = 20000;
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// Rodrigues rotation of v around unit axis k by angle t.
function rotateAxis(v, k, t) {
  const c = Math.cos(t), s = Math.sin(t);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
}
const PITCH_MAX = 1.553; // 89 degrees: straight down would break the look-at

// The navigation widget in the corner of the view (like Blender's).
const NAV = { r: 44, right: 64, top: 104, btn: 15 };

// Rows of SM64's object rotation (mtxf_rotate_zxy_and_translate): world = x*r0 + y*r1 + z*r2.
function rotRows(pitch, yaw, roll) {
  const a = (v) => (v / 32768) * Math.PI;
  const sx = Math.sin(a(pitch)), cx = Math.cos(a(pitch));
  const sy = Math.sin(a(yaw)), cy = Math.cos(a(yaw));
  const sz = Math.sin(a(roll)), cz = Math.cos(a(roll));
  return [
    [cy * cz + sx * sy * sz, cx * sz, -sy * cz + sx * cy * sz],
    [-cy * sz + sx * sy * cz, cx * cz, sy * sz + sx * cy * cz],
    [cx * sy, -sx, cx * cy],
  ];
}
const toWorld = (R, p, l) => add(p, add(add(mul(R[0], l[0]), mul(R[1], l[1])), mul(R[2], l[2])));

export class Editor {
  constructor({ engine, studio, world, frame, overlay, ui, commit, records, toast }) {
    this.world = world;
    this.brush = { mode: 'raise', radius: 600, strength: 40, material: 0, materialName: 'grass' };
    this.stroke = null;
    this.engine = engine;
    this.studio = studio;
    this.frame = frame;
    this.overlay = overlay;
    this.ctx = overlay.getContext('2d');
    this.ui = ui;            // { onSelect(sel), onModeChange(active), onToolChange() }
    this.commit = commit;    // (op) => send to the server
    this.records = records;  // () => patch objects of the current area
    this.toast = toast;
    this.active = false;
    this.tool = 'select';
    this.gizmo = 'move';
    this.snap = 50;
    this.cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 50 };
    this.keys = new Set();
    this.sel = null;
    this.hover = null;
    this.placing = null;
    this.gen = null;
    this.drag = null;
    this.camData = null;
    this.focusDist = 1000;
    this.anim = null;
    this.lastPoint = null;
    this.ghostSeq = 0;
    this.lastTick = performance.now();
    this.bind();
    engine.on('frame', () => this.onFrame());
  }

  // ---- mode -----------------------------------------------------------------

  enter() {
    if (this.active || !this.engine.ready) return;
    const c = this.engine.camOut();
    const d = sub(c.focus, c.pos);
    this.cam.x = c.pos[0]; this.cam.y = c.pos[1]; this.cam.z = c.pos[2];
    this.cam.yaw = Math.atan2(d[0], d[2]);
    this.cam.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, Math.atan2(d[1], Math.hypot(d[0], d[2]))));
    const m = this.engine.state().mario;
    this.focusDist = m ? Math.max(200, Math.hypot(m.x - c.pos[0], m.y - c.pos[1], m.z - c.pos[2])) : 1000;
    this.active = true;
    this.engine.releaseKeys();
    this.engine.setPaused(true, true);
    this.pushCamera();
    this.overlay.classList.add('on');
    this.frame.classList.add('building');
    this.ui.onModeChange(true);
  }

  exit() {
    if (!this.active) return;
    this.stopSculpt();
    this.cancelPlacing();
    this.cancelGenerator();
    this.active = false;
    this.keys.clear();
    this.drag = null;
    this.engine.setCamera(false);
    this.engine.setPaused(false, false);
    this.overlay.classList.remove('on');
    this.frame.classList.remove('building');
    this.clearOverlay();
    this.ui.onModeChange(false);
  }

  toggle() { if (this.active) this.exit(); else this.enter(); }

  setGizmo(mode) { this.gizmo = mode; this.ui.onToolChange(); }

  // ---- camera ---------------------------------------------------------------

  camDir() {
    const cp = Math.cos(this.cam.pitch);
    return [Math.sin(this.cam.yaw) * cp, Math.sin(this.cam.pitch), Math.cos(this.cam.yaw) * cp];
  }

  camPos() { return [this.cam.x, this.cam.y, this.cam.z]; }
  setCamPos(p) { this.cam.x = p[0]; this.cam.y = p[1]; this.cam.z = p[2]; }
  camRight() { return [-Math.cos(this.cam.yaw), 0, Math.sin(this.cam.yaw)]; }
  camUp() { return norm(cross(this.camRight(), this.camDir())); }

  pushCamera() {
    const d = this.camDir();
    const p = this.camPos();
    this.engine.setCamera(true, p, add(p, mul(d, 500)), this.cam.fov);
  }

  // Point the view is centered on: what is under the screen center, else a
  // point at the last used distance.
  viewCenter() {
    const { w, h } = this.size();
    const hit = this.camData ? this.pick(w / 2, h / 2, { objects: false }) : null;
    if (hit && hit.t < 20000) { this.focusDist = hit.t; return [hit.x, hit.y, hit.z]; }
    return add(this.camPos(), mul(this.camDir(), this.focusDist));
  }

  // The 3D point under the mouse (for orbit pivots and zooming), or a point at
  // the focus distance along the mouse ray.
  pointUnder(px, py) {
    if (!this.camData) return this.viewCenter();
    const hit = this.pick(px, py);
    if (hit && hit.t < 30000) return [hit.x, hit.y, hit.z];
    const r = this.ray(px, py);
    return add(r.o, mul(r.d, this.focusDist));
  }

  // Turntable orbit around `pivot`: the pivot stays where it is on screen.
  orbitBy(dx, dy, pivot) {
    this.anim = null;
    const k = 0.0075;
    const dyaw = -dx * k;
    const pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, this.cam.pitch - dy * k));
    const dp = pitch - this.cam.pitch;
    let off = sub(this.camPos(), pivot);
    // yaw: rotate the offset around world Y the same way the view turns
    const c = Math.cos(dyaw), s = Math.sin(dyaw);
    off = [off[0] * c + off[2] * s, off[1], off[2] * c - off[0] * s];
    this.cam.yaw += dyaw;
    // pitch: rotate around the camera's right axis, in the sense that raises the view by dp
    const r = this.camRight();
    const before = this.camDir();
    const test = rotateAxis(before, r, dp);
    const sign = Math.abs(test[1] - Math.sin(pitch)) < Math.abs(rotateAxis(before, r, -dp)[1] - Math.sin(pitch)) ? 1 : -1;
    off = rotateAxis(off, r, sign * dp);
    this.cam.pitch = pitch;
    this.setCamPos(add(pivot, off));
    this.pushCamera();
  }

  // Look around in place (fly-through, right mouse + WASD).
  lookBy(dx, dy) {
    this.anim = null;
    this.cam.yaw -= dx * 0.005;
    this.cam.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, this.cam.pitch - dy * 0.005));
    this.pushCamera();
  }

  // Pan so that a point at `depth` stays under the mouse.
  panBy(dx, dy, depth) {
    this.anim = null;
    const { h } = this.size();
    const s = (2 * Math.max(depth, 50) * Math.tan((this.cam.fov * Math.PI) / 360)) / h;
    const mv = add(mul(this.camRight(), -dx * s), mul(this.camUp(), dy * s));
    this.setCamPos(add(this.camPos(), mv));
    this.pushCamera();
  }

  // Move toward (amount > 0) or away from a point; never through it.
  zoomToward(point, amount) {
    this.anim = null;
    const pos = this.camPos();
    const to = sub(point, pos);
    const d = len(to);
    let f = amount;
    if (d * (1 - f) < 40) f = 1 - 40 / Math.max(d, 41);
    this.setCamPos(add(pos, mul(to, f)));
    this.focusDist = Math.max(60, d * (1 - f));
    this.pushCamera();
  }

  // Smoothly fly the camera to a new pose.
  animateTo(pos, yaw = this.cam.yaw, pitch = this.cam.pitch, ms = 380) {
    let dy = yaw - this.cam.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy)); // shortest way round
    this.anim = { from: { pos: this.camPos(), yaw: this.cam.yaw, pitch: this.cam.pitch }, to: { pos, yaw: this.cam.yaw + dy, pitch }, t0: performance.now(), ms };
  }

  // Frame a sphere, keeping the current view direction.
  frameTo(center, radius) {
    const dist = Math.max(250, (radius * 1.25) / Math.sin((this.cam.fov * Math.PI) / 360));
    this.focusDist = dist;
    this.animateTo(sub(center, mul(this.camDir(), dist)));
  }

  frameSelection() {
    const pose = this.selPose();
    if (pose) {
      const b = pose.block;
      const r = b ? Math.hypot(b.sx, b.sy, b.sz) / 2 : Math.max(120, (this.sel.obj.r || 80) * 2) * (pose.scale || 1);
      this.frameTo(b ? add(pose.p, [0, b.sy / 2, 0]) : add(pose.p, [0, 60, 0]), r);
      return;
    }
    const m = this.engine.state().mario;
    if (m) this.frameTo([m.x, m.y + 80, m.z], 700);
  }

  // The whole level from high up at an angle (Shift+Home).
  overview() {
    let b = { minX: -8192, maxX: 8192, minZ: -8192, maxZ: 8192 };
    if (this.world?.isCustom()) {
      if (this.world.terrain) b = this.world.terrain.bounds();
      else {
        // no ground (sky levels): frame what is built
        const recs = (this.world.area().objects || []).filter((r) => Number.isFinite(r.x));
        if (recs.length) {
          b = { minX: Math.min(...recs.map((r) => r.x)) - 600, maxX: Math.max(...recs.map((r) => r.x)) + 600,
            minZ: Math.min(...recs.map((r) => r.z)) - 600, maxZ: Math.max(...recs.map((r) => r.z)) + 600 };
        }
      }
    }
    const c = [(b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2];
    const r = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.62;
    const pitch = -0.95, yaw = this.cam.yaw;
    const cp = Math.cos(pitch);
    const look = [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
    const dist = r / Math.tan((this.cam.fov * Math.PI) / 360);
    this.focusDist = dist;
    this.animateTo(sub(c, mul(look, dist)), yaw, pitch);
  }

  // Look along `dir` at the current view center (top/front/side views).
  viewAlong(dir) {
    const pivot = this.viewCenter();
    const dist = len(sub(pivot, this.camPos()));
    const d = norm(dir);
    const pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, Math.asin(Math.max(-1, Math.min(1, d[1])))));
    const yaw = Math.abs(d[1]) > 0.99 ? this.cam.yaw : Math.atan2(d[0], d[2]);
    const cp = Math.cos(pitch);
    const look = [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
    this.animateTo(sub(pivot, mul(look, dist)), yaw, pitch);
  }

  tickCamera() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    if (!this.active) return;
    if (this.anim) {
      const a = this.anim;
      const t = Math.min(1, (now - a.t0) / a.ms);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.setCamPos(add(a.from.pos, mul(sub(a.to.pos, a.from.pos), e)));
      this.cam.yaw = a.from.yaw + (a.to.yaw - a.from.yaw) * e;
      this.cam.pitch = a.from.pitch + (a.to.pitch - a.from.pitch) * e;
      if (t >= 1) this.anim = null;
      this.pushCamera();
      return;
    }
    if (this.typing()) return;
    const k = this.keys;
    let speed = 1400 * (k.has('ShiftLeft') || k.has('ShiftRight') ? 3 : 1) * dt;
    const f = this.camDir();
    const flat = norm([f[0], 0, f[2]]);
    const right = [-flat[2], 0, flat[0]];
    let m = [0, 0, 0];
    if (k.has('KeyW')) m = add(m, f);
    if (k.has('KeyS')) m = sub(m, f);
    if (k.has('KeyD')) m = add(m, right);
    if (k.has('KeyA')) m = sub(m, right);
    if (k.has('KeyE')) m = add(m, [0, 1, 0]);
    if (k.has('KeyQ')) m = sub(m, [0, 1, 0]);
    if (len(m) > 0) {
      m = mul(norm(m), speed);
      this.cam.x += m[0]; this.cam.y += m[1]; this.cam.z += m[2];
    }
    this.pushCamera();
  }

  focusOn(p, dist = 900) {
    this.focusDist = dist;
    this.animateTo(sub(p, mul(this.camDir(), dist)));
  }

  // ---- projection -------------------------------------------------------------

  size() { return { w: this.overlay.clientWidth, h: this.overlay.clientHeight }; }

  project(p) {
    const c = this.camData;
    if (!c) return null;
    const v = c.view;
    const vx = p[0] * v[0] + p[1] * v[4] + p[2] * v[8] + v[12];
    const vy = p[0] * v[1] + p[1] * v[5] + p[2] * v[9] + v[13];
    const vz = p[0] * v[2] + p[1] * v[6] + p[2] * v[10] + v[14];
    if (vz > -10) return null; // behind the camera
    const { w, h } = this.size();
    const f = 1 / Math.tan((c.fov * Math.PI) / 360);
    const aspect = w / h;
    return { x: ((vx * f / aspect) / -vz + 1) * w / 2, y: (1 - (vy * f) / -vz) * h / 2, depth: -vz };
  }

  ray(px, py) {
    const c = this.camData;
    const { w, h } = this.size();
    const f = 1 / Math.tan((c.fov * Math.PI) / 360);
    const nx = (2 * px) / w - 1, ny = 1 - (2 * py) / h;
    const dv = [nx * (w / h) / f, ny / f, -1];
    const v = c.view;
    // view = world * R + t, so world direction = R * dv (R rows are v[0..2], v[4..6], v[8..10])
    const d = norm([
      dv[0] * v[0] + dv[1] * v[1] + dv[2] * v[2],
      dv[0] * v[4] + dv[1] * v[5] + dv[2] * v[6],
      dv[0] * v[8] + dv[1] * v[9] + dv[2] * v[10],
    ]);
    return { o: [...c.pos], d };
  }

  pick(px, py, { ignoreSlot = -1, objects = true } = {}) {
    if (!this.camData) return null;
    const r = this.ray(px, py);
    const hit = this.engine.raycast(r.o, r.d, ignoreSlot, objects);
    if (hit) hit.ray = r;
    return hit;
  }

  // ---- objects & records ----------------------------------------------------

  objectAt(slot) {
    return this.engine.objects().find((o) => o.slot === slot) || null;
  }

  recordOf(uid) {
    return uid ? this.records().find((r) => r.uid === uid) || null : null;
  }

  describe(o) {
    const rec = this.recordOf(o.uid);
    const cat = o.cat >= 0 ? this.studio.catalog.entries[o.cat] : null;
    return {
      slot: o.slot, uid: o.uid || 0, obj: o, rec,
      kind: rec?.block ? 'block' : rec ? 'added' : 'original',
      name: rec?.block ? blockName(rec.block) : rec?.name || this.studio.nameOfObject(o),
      entry: rec?.entry || cat?.id || null,
      movable: !!rec || o.cat >= 0,
    };
  }

  select(slot) {
    if (slot == null || slot < 0) {
      this.sel = null;
    } else {
      const o = this.objectAt(slot);
      this.sel = o ? this.describe(o) : null;
    }
    this.ui.onSelect(this.sel);
  }

  refreshSelection() {
    if (!this.sel) return;
    let o = null;
    if (this.sel.uid) o = this.engine.objects().find((x) => x.uid === this.sel.uid);
    else o = this.objectAt(this.sel.slot);
    this.sel = o ? this.describe(o) : null;
    this.ui.onSelect(this.sel);
  }

  // Transform info of the selection (from its record when it has one).
  selPose() {
    const s = this.sel;
    if (!s) return null;
    const src = s.rec || s.obj;
    return {
      p: [src.x, src.y, src.z], yaw: src.yaw | 0, pitch: src.pitch | 0, roll: src.roll | 0,
      scale: s.rec?.scale ?? s.obj.scale ?? 1, block: s.rec?.block || null,
    };
  }

  // ---- edits ----------------------------------------------------------------

  newUid() { return 1 + Math.floor(Math.random() * 0x7efffffe); }

  // Live-apply a pose to the selected object (no commit).
  applyPose(pose) {
    const s = this.sel;
    if (!s) return;
    pose.p[0] = inWorld(pose.p[0]); pose.p[2] = inWorld(pose.p[2]);
    pose.p[1] = Math.max(-WORLD_Y, Math.min(WORLD_Y, pose.p[1])); // block collision is s16: far up it wraps around
    this.engine.transform(s.slot, pose.p[0], pose.p[1], pose.p[2], pose.pitch, pose.yaw, pose.roll, pose.block ? 0 : pose.scale);
    if (s.rec) Object.assign(s.rec, { x: pose.p[0], y: pose.p[1], z: pose.p[2], yaw: pose.yaw, pitch: pose.pitch, roll: pose.roll });
    else Object.assign(s.obj, { x: pose.p[0], y: pose.p[1], z: pose.p[2], yaw: pose.yaw });
  }

  // Save the selection's current pose (and other fields) to the project.
  commitPose(pose, summary = 'Moved') {
    const s = this.sel;
    if (!s) return;
    const fields = { x: Math.round(pose.p[0]), y: Math.round(pose.p[1]), z: Math.round(pose.p[2]), yaw: pose.yaw & 0xffff, pitch: pose.pitch | 0, roll: pose.roll | 0 };
    if (!pose.block && pose.scale) fields.scale = Math.round(pose.scale * 1000) / 1000;
    if (s.rec) {
      this.commit({ type: 'update', uid: s.uid, fields, summary: `${summary} ${s.name}` });
    } else {
      this.adopt(fields, summary);
    }
  }

  // An original object becomes ours: hide it for good and place an owned copy.
  adopt(fields, summary = 'Moved') {
    const s = this.sel;
    const o = s.obj;
    if (o.cat < 0) { this.toast('This object can only be deleted, not changed', 'x'); return null; }
    const useHome = o.hx || o.hy || o.hz;
    const rule = { bhv: o.bhv, x: useHome ? o.hx : o.x, y: useHome ? o.hy : o.y, z: useHome ? o.hz : o.z, r: 60, name: s.name,
      restore: { entry: this.studio.catalog.entries[o.cat].id, x: o.hx || o.x, y: o.hy || o.y, z: o.hz || o.z, yaw: o.yaw, bparams: o.bparams } };
    const record = { uid: this.newUid(), entry: this.studio.catalog.entries[o.cat].id, x: o.x, y: o.y, z: o.z, yaw: o.yaw & 0xffff, pitch: 0, roll: 0, bparams: o.bparams >>> 0, scale: o.scale || 1, name: s.name, ...fields };
    this.engine.deleteSlot(o.slot);
    this.engine.addRemoval(rule);
    const slot = this.engine.spawn(record);
    this.commit({ type: 'add', summary: `${summary} ${s.name}`, records: [record], rules: [rule] });
    this.localRecords.push(record);
    this.sel = { ...s, slot, uid: record.uid, rec: record, kind: 'added' };
    this.ui.onSelect(this.sel);
    return record;
  }

  get localRecords() {
    // records() returns the live patch array for this area; adding to it keeps
    // lookups working before the server echoes the new patch
    return this.records();
  }

  // Replace a record's object (shape/size/material/params changed).
  respawn(rec) {
    this.engine.deleteUid(rec.uid);
    const slot = this.engine.spawn(rec);
    if (this.sel && this.sel.uid === rec.uid) {
      this.sel = { ...this.sel, slot, rec, name: rec.block ? blockName(rec.block) : this.sel.name };
    }
    return slot;
  }

  updateSelected(fields, summary) {
    const s = this.sel;
    if (!s) return;
    let rec = s.rec;
    if (!rec) {
      rec = this.adopt({}, 'Changed');
      if (!rec) return;
    }
    if (fields.block) fields.block = { ...rec.block, ...fields.block };
    Object.assign(rec, fields);
    const needsRespawn = 'block' in fields || 'bparams' in fields || 'entry' in fields || 'asset' in fields;
    if (needsRespawn) this.respawn(rec);
    else this.engine.transform(this.sel.slot, rec.x, rec.y, rec.z, rec.pitch | 0, rec.yaw | 0, rec.roll | 0, rec.block ? 0 : rec.scale || 1);
    this.commit({ type: 'update', uid: rec.uid, fields, summary: summary || `Changed ${this.sel.name}` });
    if (rec.block) this.sel.name = blockName(rec.block);
    this.ui.onSelect(this.sel);
  }

  deleteSelected() {
    const s = this.sel;
    if (!s) return;
    if (s.rec) {
      this.engine.deleteUid(s.uid);
      this.commit({ type: 'remove', summary: `Removed ${s.name}`, uids: [s.uid], rules: [] });
    } else {
      const o = s.obj;
      const useHome = o.hx || o.hy || o.hz;
      const rule = { bhv: o.bhv, x: useHome ? o.hx : o.x, y: useHome ? o.hy : o.y, z: useHome ? o.hz : o.z, r: 60, name: s.name,
        restore: o.cat >= 0 ? { entry: this.studio.catalog.entries[o.cat].id, x: o.x, y: o.y, z: o.z, yaw: o.yaw, bparams: o.bparams } : undefined };
      this.engine.deleteSlot(o.slot);
      this.engine.addRemoval(rule);
      this.commit({ type: 'remove', summary: `Removed ${s.name}`, uids: [], rules: [rule] });
    }
    this.select(null);
  }

  duplicateSelected() {
    const s = this.sel;
    if (!s) return;
    const pose = this.selPose();
    const off = pose.block ? Math.max(pose.block.sx, 120) + 20 : 200;
    const R = rotRows(0, pose.yaw, 0);
    const p = toWorld(R, pose.p, [off, 0, 0]);
    let rec;
    if (s.rec) rec = { ...JSON.parse(JSON.stringify(s.rec)), uid: this.newUid(), x: Math.round(p[0]), y: Math.round(p[1]), z: Math.round(p[2]) };
    else if (s.obj.cat >= 0) rec = { uid: this.newUid(), entry: this.studio.catalog.entries[s.obj.cat].id, x: Math.round(p[0]), y: Math.round(p[1]), z: Math.round(p[2]), yaw: s.obj.yaw & 0xffff, pitch: 0, roll: 0, bparams: s.obj.bparams >>> 0, scale: 1, name: s.name };
    else return;
    this.freshStars([rec]);
    const slot = this.engine.spawn(rec);
    this.records().push(rec);
    this.commit({ type: 'add', summary: `Duplicated ${s.name}`, records: [rec] });
    this.select(slot);
  }

  rotateSelected(deg) {
    const pose = this.selPose();
    if (!pose) return;
    pose.yaw = (pose.yaw + Math.round((deg / 360) * 65536)) & 0xffff;
    this.applyPose(pose);
    this.commitPose(pose, 'Rotated');
  }

  dropSelectedToGround() {
    const pose = this.selPose();
    if (!pose) return;
    const y = this.engine.floor(pose.p[0], pose.p[1] + 50, pose.p[2]);
    if (y < -20000) return;
    pose.p[1] = y;
    this.applyPose(pose);
    this.commitPose(pose, 'Dropped');
  }

  // ---- sculpting -------------------------------------------------------------

  startSculpt(mode) {
    this.cancelPlacing();
    this.cancelGenerator();
    if (!this.active) this.enter();
    if (mode) this.brush.mode = mode;
    this.tool = 'sculpt';
    this.select(null);
    this.ui.onToolChange();
  }

  stopSculpt() {
    if (this.stroke) this.endStroke();
    if (this.tool === 'sculpt') { this.tool = 'select'; this.ui.onToolChange(); }
  }

  strokeMode(e) {
    const m = this.brush.mode;
    if (e?.ctrlKey && m !== 'paint') return 'smooth';
    if (e?.shiftKey && m === 'raise') return 'lower';
    if (e?.shiftKey && m === 'lower') return 'raise';
    return m;
  }

  beginStroke(m, e) {
    const hit = this.pick(m.x, m.y, { objects: false });
    if (!hit) return;
    this.stroke = this.world.beginStroke(this.strokeMode(e), hit, { ...this.brush });
    if (this.stroke) { this.stroke.mouse = m; this.world.dab(this.stroke, hit.x, hit.z); this.keepAboveGround(); }
  }

  sculptTick() {
    const s = this.stroke;
    if (!s || !this.mouse) return;
    const hit = this.pick(this.mouse.x, this.mouse.y, { objects: false });
    if (hit) { this.world.dab(s, hit.x, hit.z); this.keepAboveGround(); }
  }

  // a raised hill must not swallow the camera (it would see the ground from below)
  keepAboveGround() {
    const f = this.engine.floor(this.cam.x, this.cam.y + 400, this.cam.z);
    if (f > -10000 && f > this.cam.y - 80) { this.cam.y = f + 120; this.pushCamera(); }
  }

  endStroke() {
    const s = this.stroke;
    this.stroke = null;
    if (s) this.world.endStroke(s);
  }

  // ---- placement ------------------------------------------------------------

  startPlacing(item) {
    this.cancelPlacing();
    this.cancelGenerator();
    if (this.tool === 'sculpt') this.tool = 'select';
    if (!this.active) this.enter();
    // item: { entry } or { block, wall }
    this.placing = { ...item, yaw: 0, ghostUid: GHOST_UID + (++this.ghostSeq), slot: -1, point: null };
    this.tool = 'place';
    this.select(null);
    this.ui.onToolChange();
  }

  cancelPlacing() {
    if (this.placing) {
      this.engine.deleteUid(this.placing.ghostUid);
      this.placing = null;
    }
    if (this.tool === 'place') { this.tool = 'select'; this.ui.onToolChange(); }
  }

  // Where an object/block goes for a surface hit.
  placementPose(hit, item, yaw) {
    let p = [hit.x, hit.y, hit.z];
    const n = [hit.nx, hit.ny, hit.nz];
    let y = yaw;
    if (item.block) {
      const b = blockDefaults(item.block);
      if (Math.abs(n[1]) < 0.5) {
        // on a wall: face away from it, touching it
        y = radToYaw(Math.atan2(n[0], n[2]));
        p = add(p, mul(norm([n[0], 0, n[2]]), b.sz / 2 + 2));
        p[1] = hit.y - b.sy / 2;
      } else if (n[1] < -0.5) {
        p[1] = hit.y - b.sy;
      }
    } else if (Math.abs(n[1]) < 0.5) {
      p = add(p, mul(norm([n[0], 0, n[2]]), 80));
    } else if (n[1] < -0.5) {
      p[1] -= 160;
    }
    if (this.snap && n[1] > 0.5) {
      // on the ground: the snapped spot stands on the ground there (a slope is higher or lower a
      // few units away); a snap off the ground's edge (past a cliff, off the level) keeps the spot
      // under the mouse, else the object falls out of the level when the game runs
      const sx = snapTo(p[0], this.snap), sz = snapTo(p[2], this.snap);
      const down = this.engine.raycast([sx, hit.y + 200, sz], [0, -1, 0], item.slot ?? -1, false, 400);
      const g = down && down.ny > 0.5 ? down.y : -32000;
      if (g > -10000 && Math.abs(g - hit.y) < 200) {
        p[1] += g - hit.y;
        p[0] = sx; p[2] = sz;
      }
    }
    p[0] = inWorld(p[0]); p[2] = inWorld(p[2]);
    return { p: p.map(Math.round), yaw: y & 0xffff };
  }

  updateGhost(px, py) {
    const pl = this.placing;
    const hit = this.pick(px, py, { ignoreSlot: pl.slot, objects: false });
    if (!hit) return;
    const pose = this.placementPose(hit, pl, pl.yaw);
    pl.point = pose;
    if (pl.slot < 0) {
      pl.slot = this.engine.spawn(this.makeRecord(pl, pose, pl.ghostUid));
    } else {
      this.engine.transform(pl.slot, pose.p[0], pose.p[1], pose.p[2], 0, pose.yaw, 0, pl.block ? 0 : pl.scale || 1);
    }
  }

  makeRecord(item, pose, uid) {
    if (item.asset) {
      // an imported model (assets.js): prop or level geometry
      return { uid, asset: { ...item.asset }, x: pose.p[0], y: pose.p[1], z: pose.p[2], yaw: pose.yaw, pitch: 0, roll: 0, scale: item.scale || 1, name: item.name || 'Model' };
    }
    if (item.block) {
      const block = blockDefaults(item.block);
      return { uid, block, x: pose.p[0], y: pose.p[1], z: pose.p[2], yaw: pose.yaw, pitch: 0, roll: 0, name: blockName(block) };
    }
    const e = this.studio.entries.get(item.entry);
    const rec = { uid, entry: item.entry, x: pose.p[0], y: pose.p[1], z: pose.p[2], yaw: pose.yaw, pitch: 0, roll: 0,
      bparams: this.studio.parseParams(e?.params?.[0]) || 0, scale: 1, name: e?.name || item.entry };
    if (item.star) {
      // studio stars: a name and a star number of their own in this level
      const used = new Set(this.world.stars().map((s) => s.index));
      let index = 0;
      while (used.has(index) && index < 30) index++;
      rec.bparams = (index << 24) >>> 0;
      rec.star = { name: item.star.name };
      rec.name = item.star.name;
      if (item.entry === 'star') rec.y += 120; // floating, easy to see
    }
    if (item.entry === 'red_coin') rec.y += 60;
    return rec;
  }

  // Copies of studio stars (duplicate, paste, prefabs) become stars of their own: an unused
  // star number in this level and a name of their own ("Star 2"), not a twin of the original.
  freshStars(recs) {
    const stars = this.world?.stars?.() || [];
    const used = new Set(stars.map((x) => x.index));
    const names = new Set(stars.map((x) => x.name));
    for (const r of recs) {
      if (!r.star) continue;
      let index = 0;
      while (used.has(index) && index < 30) index++;
      used.add(index);
      r.bparams = (((r.bparams >>> 0) & 0x00ffffff) | (index << 24)) >>> 0;
      const base = String(r.star.name || 'Star').replace(/ \d+$/, '');
      let n = 2, name = base;
      while (names.has(name)) name = `${base} ${n++}`;
      names.add(name);
      r.star = { ...r.star, name };
      r.name = name;
    }
    return recs;
  }

  commitPlacement() {
    const pl = this.placing;
    if (!pl?.point) return;
    const rec = this.makeRecord(pl, pl.point, this.newUid());
    const slot = this.engine.spawn(rec);
    this.records().push(rec);
    this.commit({ type: 'add', summary: rec.star ? `Added star “${rec.star.name}”` : `Placed ${rec.name}`, records: [rec] });
    this.lastPoint = pl.point.p;
    this.ui.onRecordsChanged?.();
    if (pl.entry === 'hidden_red_coin_star') {
      // a red coin star needs its 8 red coins next
      this.startPlacing({ entry: 'red_coin', redCoinsLeft: 8 });
      this.toast('Now place the 8 red coins', 'sparkles');
    } else if (pl.redCoinsLeft) {
      pl.redCoinsLeft--;
      if (pl.redCoinsLeft <= 0) { this.cancelPlacing(); this.toast('Red coin star ready: collect all 8 coins!', 'check'); }
      this.ui.onToolChange();
    } else if (pl.star) {
      // a named star goes in one place (another click would make a second star of that name)
      this.cancelPlacing();
    }
    return slot;
  }

  // ---- generators -------------------------------------------------------------

  startGenerator(kind, params = {}) {
    this.cancelPlacing();
    this.cancelGenerator();
    if (this.tool === 'sculpt') this.tool = 'select';
    if (!this.active) this.enter();
    const g = GENERATORS[kind];
    this.gen = { kind, params: { ...g.params, ...params }, anchor: null, anchor2: null, ghosts: [], awaiting: 'anchor' };
    this.tool = 'generator';
    this.select(null);
    this.ui.onToolChange();
  }

  setGenParam(k, v) {
    if (!this.gen) return;
    this.gen.params[k] = v;
    this.previewGenerator();
  }

  genArgs() {
    const g = this.gen;
    if (!g?.anchor) return null;
    const a = { ...g.params, x: g.anchor.p[0], y: g.anchor.p[1], z: g.anchor.p[2], yaw: g.anchor.yaw };
    if (g.anchor2) { a.x2 = g.anchor2.p[0]; a.y2 = g.anchor2.p[1]; a.z2 = g.anchor2.p[2]; }
    return a;
  }

  previewGenerator() {
    const g = this.gen;
    for (const uid of g.ghosts) this.engine.deleteUid(uid);
    g.ghosts = [];
    const args = this.genArgs();
    if (!args) return;
    const recs = GENERATORS[g.kind].build(args);
    for (const r of recs) {
      const uid = GHOST_UID + (++this.ghostSeq);
      this.engine.spawn({ ...r, uid });
      g.ghosts.push(uid);
    }
    g.count = recs.length;
    this.ui.onToolChange();
  }

  genClick(hit) {
    const g = this.gen;
    const n = [hit.nx, hit.ny, hit.nz];
    const onWall = Math.abs(n[1]) < 0.5;
    // face away from walls; otherwise build away from the camera
    const yaw = onWall ? radToYaw(Math.atan2(n[0], n[2])) : radToYaw(this.cam.yaw);
    const p = [Math.round(hit.x), Math.round(hit.y), Math.round(hit.z)];
    if (g.kind === 'wall_climb' && !onWall) { this.toast('Click a wall to start the climb', 'x'); return; }
    if (g.kind === 'bridge' && g.awaiting === 'anchor2') {
      g.anchor2 = { p, yaw };
      g.awaiting = null;
    } else {
      g.anchor = { p, yaw };
      g.anchor2 = null;
      g.awaiting = g.kind === 'bridge' ? 'anchor2' : null;
    }
    this.previewGenerator();
  }

  applyGenerator() {
    const g = this.gen;
    const args = this.genArgs();
    if (!args) return;
    const recs = GENERATORS[g.kind].build(args).map((r) => ({ ...r, uid: this.newUid(), name: blockName(r.block) }));
    if (!recs.length) return;
    for (const uid of g.ghosts) this.engine.deleteUid(uid);
    g.ghosts = [];
    for (const r of recs) { this.engine.spawn(r); this.records().push(r); }
    this.commit({ type: 'add', summary: `Built ${GENERATORS[g.kind].label.toLowerCase()} (${recs.length} blocks)`, records: recs });
    this.toast(`Built ${GENERATORS[g.kind].label.toLowerCase()}`, 'check');
    g.anchor = null; g.anchor2 = null; g.awaiting = 'anchor';
    this.ui.onToolChange();
  }

  rotateGenerator(deg) {
    const g = this.gen;
    if (!g?.anchor) return;
    g.anchor.yaw = (g.anchor.yaw + Math.round((deg / 360) * 65536)) & 0xffff;
    this.previewGenerator();
  }

  cancelGenerator() {
    if (this.gen) {
      for (const uid of this.gen.ghosts) this.engine.deleteUid(uid);
      this.gen = null;
    }
    if (this.tool === 'generator') { this.tool = 'select'; this.ui.onToolChange(); }
  }

  // ---- gizmo geometry -------------------------------------------------------

  // Screen-space handles for the current selection and gizmo mode.
  handles() {
    const pose = this.selPose();
    if (!pose || !this.camData) return [];
    const center = pose.block ? add(pose.p, [0, pose.block.sy / 2, 0]) : add(pose.p, [0, 60, 0]);
    const c = this.project(center);
    if (!c) return [];
    const out = [];
    if (this.gizmo === 'move') {
      for (const ax of AXES) {
        const q = this.project(add(center, mul(ax.dir, 100)));
        if (!q) continue;
        let dx = q.x - c.x, dy = q.y - c.y;
        const l = Math.hypot(dx, dy) || 1;
        dx = (dx / l) * 78; dy = (dy / l) * 78;
        out.push({ type: 'axis', axis: ax, from: c, to: { x: c.x + dx, y: c.y + dy }, world: center });
      }
      out.push({ type: 'free', at: c, world: center });
    } else if (this.gizmo === 'rotate') {
      const q = this.project(add(center, [100, 0, 0])) || c;
      const q2 = this.project(add(center, [0, 0, 100])) || c;
      const s = Math.max(Math.hypot(q.x - c.x, q.y - c.y), Math.hypot(q2.x - c.x, q2.y - c.y)) / 100 || 1;
      const R = 75 / s;
      const pts = [];
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const pp = this.project(add(center, [Math.sin(a) * R, 0, Math.cos(a) * R]));
        if (pp) pts.push(pp);
      }
      out.push({ type: 'ring', pts, center, R, yaw: pose.yaw });
    } else if (this.gizmo === 'size' && pose.block) {
      const b = pose.block;
      const Rm = rotRows(pose.pitch, pose.yaw, pose.roll);
      const faces = [
        { k: 'sx', sign: 1, l: [b.sx / 2, b.sy / 2, 0] }, { k: 'sx', sign: -1, l: [-b.sx / 2, b.sy / 2, 0] },
        { k: 'sy', sign: 1, l: [0, b.sy, 0] }, { k: 'sy', sign: -1, l: [0, 0, 0] },
        { k: 'sz', sign: 1, l: [0, b.sy / 2, b.sz / 2] }, { k: 'sz', sign: -1, l: [0, b.sy / 2, -b.sz / 2] },
      ];
      const localAxis = { sx: [1, 0, 0], sy: [0, 1, 0], sz: [0, 0, 1] };
      for (const f of faces) {
        const wp = toWorld(Rm, pose.p, f.l);
        const sp = this.project(wp);
        if (!sp) continue;
        const dirW = norm(sub(toWorld(Rm, [0, 0, 0], mul(localAxis[f.k], f.sign)), [0, 0, 0]));
        out.push({ type: 'face', at: sp, world: wp, key: f.k, sign: f.sign, dir: dirW });
      }
    } else if (this.gizmo === 'size') {
      out.push({ type: 'scale', at: { x: c.x + 60, y: c.y - 60 }, center: c, world: center });
    }
    return out;
  }

  hitHandle(px, py) {
    let best = null, bestD = 10;
    for (const h of this.handles()) {
      let d = Infinity;
      if (h.type === 'axis') d = segDist(px, py, h.from, h.to);
      else if (h.type === 'free') d = Math.hypot(px - h.at.x, py - h.at.y) - 4;
      else if (h.type === 'face' || h.type === 'scale') d = Math.hypot(px - h.at.x, py - h.at.y) - 3;
      else if (h.type === 'ring') for (let i = 1; i < h.pts.length; i++) d = Math.min(d, segDist(px, py, h.pts[i - 1], h.pts[i]));
      if (d < bestD) { bestD = d; best = h; }
    }
    return best;
  }

  // Closest point parameter on line (c + s*a) to the mouse ray.
  axisParam(c, a, px, py) {
    const r = this.ray(px, py);
    const w0 = sub(c, r.o);
    const b = dot(a, r.d), d = dot(a, w0), e = dot(r.d, w0);
    const den = 1 - b * b;
    if (Math.abs(den) < 1e-4) return null;
    return (b * e - d) / den;
  }

  planeHit(y, px, py) {
    const r = this.ray(px, py);
    if (Math.abs(r.d[1]) < 1e-4) return null;
    const t = (y - r.o[1]) / r.d[1];
    if (t < 0) return null;
    return add(r.o, mul(r.d, t));
  }

  // ---- navigation widget ----------------------------------------------------

  navLayout() {
    const { w } = this.size();
    const cx = w - NAV.right, cy = NAV.top;
    const balls = [];
    if (this.camData) {
      const v = this.camData.view;
      const names = ['X', 'Y', 'Z'];
      const colors = ['#ff5d5d', '#5ee08a', '#5aa7ff'];
      for (let i = 0; i < 3; i++) {
        const sx = v[i * 4], sy = -v[i * 4 + 1], depth = v[i * 4 + 2];
        const dir = [0, 0, 0];
        dir[i] = 1;
        balls.push({ x: cx + sx * NAV.r * 0.78, y: cy + sy * NAV.r * 0.78, depth, label: names[i], color: colors[i], dir, pos: true });
        balls.push({ x: cx - sx * NAV.r * 0.78, y: cy - sy * NAV.r * 0.78, depth: -depth, label: '', color: colors[i], dir: mul(dir, -1), pos: false });
      }
    }
    const buttons = [
      { id: 'pan', x: cx, y: cy + NAV.r + 26, title: 'Drag to pan' },
      { id: 'zoom', x: cx, y: cy + NAV.r + 62, title: 'Drag to zoom' },
      { id: 'frame', x: cx, y: cy + NAV.r + 98, title: 'Frame selection (F)' },
    ];
    return { cx, cy, balls, buttons };
  }

  navHit(px, py) {
    const L = this.navLayout();
    for (const b of L.buttons) if (Math.hypot(px - b.x, py - b.y) <= NAV.btn + 2) return { type: 'button', id: b.id };
    // nearest ball in front wins
    const balls = [...L.balls].sort((a, b) => b.depth - a.depth);
    for (const b of balls) if (Math.hypot(px - b.x, py - b.y) <= (b.pos ? 10 : 8)) return { type: 'ball', dir: b.dir };
    if (Math.hypot(px - L.cx, py - L.cy) <= NAV.r + 4) return { type: 'disc' };
    return null;
  }

  // Which navigation a mouse press starts: Blender (middle), Maya (Alt+buttons),
  // and right mouse for people without a middle button.
  navMode(e) {
    const { button, shiftKey: shift, ctrlKey: ctrl, altKey: alt, metaKey: meta } = e;
    if (button === 1) return alt ? 'pan' : shift ? 'pan' : (ctrl || meta) ? 'zoom' : 'orbit';
    if (button === 2) return alt ? 'zoom' : shift ? 'pan' : (ctrl || meta) ? 'zoom' : 'orbit';
    if (button === 0 && alt) return shift ? 'pan' : (ctrl || meta) ? 'zoom' : 'orbit';
    return null;
  }

  startNav(type, m, e, pivot) {
    // orbit/zoom around what is under the mouse, like Blender's "orbit around selection + auto depth"
    const p = pivot || this.pointUnder(m.x, m.y);
    this.focusDist = Math.max(60, len(sub(p, this.camPos())));
    const depth = Math.max(60, dot(sub(p, this.camPos()), this.camDir()));
    this.drag = { type, nav: true, x: e.clientX, y: e.clientY, pivot: p, depth, startMouse: m, button: e.button };
    this.overlay.style.cursor = type === 'orbit' ? 'grabbing' : type === 'pan' ? 'move' : 'ns-resize';
  }

  // ---- input ----------------------------------------------------------------

  typing() { return isTyping(); }

  bind() {
    const ov = this.overlay;
    ov.addEventListener('contextmenu', (e) => e.preventDefault());
    ov.addEventListener('pointerdown', (e) => this.onDown(e));
    ov.addEventListener('pointermove', (e) => this.onMove(e));
    ov.addEventListener('pointerup', (e) => this.onUp(e));
    ov.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    ov.addEventListener('dblclick', (e) => this.onDblClick(e));
    ov.addEventListener('auxclick', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    // a drag released over the page (chat, buttons) must not click what is there
    window.addEventListener('click', (e) => {
      if (performance.now() < (this.suppressClickUntil || 0)) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }

  local(e) {
    const r = this.overlay.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onDown(e) {
    if (!this.active) return;
    document.activeElement?.blur?.();
    this.overlay.setPointerCapture(e.pointerId);
    const m = this.local(e);
    this.downAt = { ...m, button: e.button, moved: false };
    this.anim = null;
    if (e.button === 1) e.preventDefault();
    // the navigation widget
    if (e.button === 0) {
      const nh = this.navHit(m.x, m.y);
      if (nh) {
        if (nh.type === 'button' && nh.id === 'pan') this.startNav('pan', m, e, this.viewCenter());
        else if (nh.type === 'button' && nh.id === 'zoom') this.startNav('zoom', m, e, this.viewCenter());
        else if (nh.type === 'button') this.drag = { type: 'navclick', nav: true, hit: nh };
        else this.drag = { type: 'navball', nav: true, hit: nh, x: e.clientX, y: e.clientY, startMouse: m };
        return;
      }
    }
    const nav = this.navMode(e);
    if (nav) { this.startNav(nav, m, e); return; }
    if (e.button === 0 && this.tool === 'sculpt') { this.mouse = m; this.beginStroke(m, e); return; }
    if (e.button !== 0 || this.tool !== 'select') return;
    const h = this.hitHandle(m.x, m.y);
    const pose = this.selPose();
    if (h && pose) {
      this.drag = { type: h.type, handle: h, start: pose, startMouse: m };
      if (h.type === 'axis') this.drag.s0 = this.axisParam(h.world, h.axis.dir, m.x, m.y);
      if (h.type === 'face') this.drag.s0 = this.axisParam(h.world, h.dir, m.x, m.y);
      if (h.type === 'ring') {
        const p = this.planeHit(h.center[1], m.x, m.y);
        this.drag.a0 = p ? Math.atan2(p[0] - h.center[0], p[2] - h.center[2]) : 0;
      }
      if (h.type === 'free') {
        const hit = this.pick(m.x, m.y, { ignoreSlot: this.sel.slot, objects: false });
        this.drag.offset = hit ? [pose.p[0] - hit.x, pose.p[2] - hit.z] : [0, 0];
      }
      return;
    }
    // drag the selected object by its body: it slides over the ground
    const hit = this.pick(m.x, m.y);
    if (hit && this.sel && hit.slot === this.sel.slot && pose) {
      this.drag = { type: 'free', start: pose, startMouse: m, offset: [pose.p[0] - hit.x, pose.p[2] - hit.z] };
    }
  }

  onMove(e) {
    if (!this.active) return;
    const m = this.local(e);
    if (this.downAt && Math.hypot(m.x - this.downAt.x, m.y - this.downAt.y) > 4) this.downAt.moved = true;
    const d = this.drag;
    if (d?.nav) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      d.x = e.clientX; d.y = e.clientY;
      if (d.type === 'navball') {
        // dragging the widget orbits around the view center
        if (this.downAt?.moved) { d.type = 'orbit'; d.pivot = this.viewCenter(); this.overlay.style.cursor = 'grabbing'; }
        return;
      }
      if (d.type === 'orbit') {
        // right mouse with fly keys held looks around in place, like a game editor
        const flying = d.button === 2 && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].some((k) => this.keys.has(k));
        if (flying) this.lookBy(dx, dy); else this.orbitBy(dx, dy, d.pivot);
      } else if (d.type === 'pan') {
        this.panBy(dx, dy, d.depth);
      } else if (d.type === 'zoom') {
        this.zoomToward(d.pivot, Math.max(-0.5, Math.min(0.3, -dy * 0.006)));
      }
      return;
    }
    if (d && this.sel) { this.dragTo(d, m, e); return; }
    if (this.tool === 'place' && this.placing) { this.updateGhost(m.x, m.y); return; }
    if (this.tool === 'sculpt') { this.mouse = m; return; }
    // hover
    this.mouse = m;
    const now = performance.now();
    if (!this.hoverAt || now - this.hoverAt > 60) {
      this.hoverAt = now;
      this.navHover = this.navHit(m.x, m.y);
      if (this.navHover) this.overlay.style.cursor = this.navHover.type === 'disc' ? 'grab' : 'pointer';
      else if (this.tool === 'select') {
        const hh = this.hitHandle(m.x, m.y);
        this.overlay.style.cursor = hh ? 'grab' : 'default';
        const hit = this.pick(m.x, m.y);
        this.hover = hit && hit.slot >= 0 ? hit.slot : null;
      }
    }
  }

  dragTo(d, m, e) {
    const pose = { ...d.start, p: [...d.start.p], block: d.start.block ? { ...d.start.block } : null };
    const snap = e.altKey ? 0 : this.snap;
    if (d.type === 'axis') {
      const s = this.axisParam(d.handle.world, d.handle.axis.dir, m.x, m.y);
      if (s == null || d.s0 == null) return;
      const delta = snapTo(s - d.s0, snap);
      pose.p = add(pose.p, mul(d.handle.axis.dir, delta));
    } else if (d.type === 'free') {
      const hit = this.pick(m.x, m.y, { ignoreSlot: this.sel.slot, objects: false });
      if (!hit) return;
      if (e.shiftKey) {
        // vertical: follow the mouse's height change
        pose.p[1] = d.start.p[1] + snapTo((d.startMouse.y - m.y) * 3, snap);
      } else {
        pose.p[0] = snapTo(hit.x + d.offset[0], snap);
        pose.p[2] = snapTo(hit.z + d.offset[1], snap);
        pose.p[1] = hit.ny > 0.5 ? hit.y : pose.p[1];
      }
    } else if (d.type === 'ring') {
      const p = this.planeHit(d.handle.center[1], m.x, m.y);
      if (!p) return;
      const a = Math.atan2(p[0] - d.handle.center[0], p[2] - d.handle.center[2]);
      let deg = ((a - d.a0) * 180) / Math.PI;
      if (snap) deg = Math.round(deg / 15) * 15;
      pose.yaw = (d.start.yaw + Math.round((deg / 360) * 65536)) & 0xffff;
    } else if (d.type === 'face') {
      const s = this.axisParam(d.handle.world, d.handle.dir, m.x, m.y);
      if (s == null || d.s0 == null) return;
      const k = d.handle.key;
      const want = Math.max(20, snapTo(d.start.block[k] + (s - d.s0), snap ? 25 : 0));
      const grow = want - d.start.block[k];
      pose.block[k] = want;
      if (k !== 'sy') pose.p = add(pose.p, mul(d.handle.dir, grow / 2));
      else if (d.handle.sign < 0) pose.p = add(pose.p, mul(d.handle.dir, grow));
      // live: respawn the block with the new size
      const rec = this.sel.rec;
      if (rec && (rec.block[k] !== want || rec.x !== pose.p[0] || rec.z !== pose.p[2] || rec.y !== pose.p[1])) {
        Object.assign(rec, { block: pose.block, x: pose.p[0], y: pose.p[1], z: pose.p[2] });
        this.respawn(rec);
      }
      d.last = pose;
      return;
    } else if (d.type === 'scale') {
      const dy = d.startMouse.y - m.y + (m.x - d.startMouse.x);
      pose.scale = Math.max(0.1, Math.min(10, Math.round(d.start.scale * Math.pow(2, dy / 150) * 20) / 20));
    }
    d.last = pose;
    this.applyPose(pose);
  }

  onUp(e) {
    if (!this.active) return;
    const m = this.local(e);
    const d = this.drag;
    const click = this.downAt && !this.downAt.moved;
    if (this.downAt?.moved) this.suppressClickUntil = performance.now() + 250;
    if (this.stroke) { this.endStroke(); this.drag = null; this.downAt = null; return; }
    this.drag = null;
    this.downAt = null;
    if (d?.nav) {
      this.overlay.style.cursor = 'default';
      if (d.type === 'navclick') { this.frameSelection(); return; }
      if (d.type === 'navball' && click) {
        if (d.hit.type === 'ball') {
          // look along the clicked axis; clicking the axis you already look down flips the view
          let look = mul(d.hit.dir, -1);
          if (dot(this.camDir(), look) > 0.99) look = d.hit.dir;
          this.viewAlong(look);
        }
        return;
      }
      if (!click) return;
      // a right/middle click without dragging falls through to the click handling below
    }
    if (d && d.last && this.sel) {
      const summary = d.type === 'ring' ? 'Rotated' : d.type === 'face' ? 'Resized' : d.type === 'scale' ? 'Scaled' : 'Moved';
      if (d.type === 'face' && this.sel.rec) {
        this.commit({ type: 'update', uid: this.sel.uid, fields: { block: d.last.block, x: Math.round(d.last.p[0]), y: Math.round(d.last.p[1]), z: Math.round(d.last.p[2]) }, summary: `${summary} ${this.sel.name}` });
      } else {
        this.commitPose(d.last, summary);
      }
      this.refreshSelection();
      return;
    }
    if (!click) return;
    if (e.button === 2 && (this.tool === 'place' || this.tool === 'generator')) {
      this.cancelPlacing();
      this.cancelGenerator();
      return;
    }
    if (e.button !== 0) return;
    if (this.tool === 'place') { this.commitPlacement(); return; }
    if (this.tool === 'sculpt') return;
    if (this.tool === 'generator') {
      const hit = this.pick(m.x, m.y, { objects: false });
      if (hit) this.genClick(hit);
      return;
    }
    const hit = this.pick(m.x, m.y);
    if (hit) this.lastPoint = [Math.round(hit.x), Math.round(hit.y), Math.round(hit.z)];
    this.select(hit && hit.slot >= 0 ? hit.slot : null);
  }

  onWheel(e) {
    if (!this.active) return;
    e.preventDefault();
    if (this.tool === 'place' && this.placing && e.shiftKey) {
      this.placing.yaw = (this.placing.yaw + (e.deltaY > 0 ? 1 : -1) * 2048) & 0xffff;
      if (this.mouse) this.updateGhost(this.mouse.x, this.mouse.y);
      return;
    }
    const m = this.local(e);
    if (this.tool === 'sculpt' && e.altKey) {
      this.brush.radius = Math.max(60, Math.min(4000, Math.round(this.brush.radius * (e.deltaY > 0 ? 0.88 : 1.14))));
      this.ui.onToolChange();
      return;
    }
    // zoom toward the point under the mouse; trackpad pinch arrives as ctrl+wheel
    let notches = -e.deltaY / (e.deltaMode === 1 ? 3 : 100);
    if (e.ctrlKey) notches *= 2.5;
    notches = Math.max(-4, Math.min(4, notches));
    const f = 1 - Math.pow(0.8, notches);
    this.zoomToward(this.pointUnder(m.x, m.y), Math.max(-1.5, f));
  }

  onDblClick(e) {
    if (!this.active) return;
    e.preventDefault();
    const m = this.local(e);
    if (this.navHit(m.x, m.y)) return;
    const hit = this.pick(m.x, m.y);
    if (!hit) return;
    if (hit.slot >= 0 && this.sel && hit.slot === this.sel.slot) { this.frameSelection(); return; }
    // center the view on the clicked spot
    const p = [hit.x, hit.y, hit.z];
    const dist = Math.min(len(sub(p, this.camPos())), 1600);
    this.focusOn(p, dist);
  }

  onKey(e, down) {
    this.keyMods = { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey };
    if (!down) this.keys.delete(e.code); // a fly key let go while typing must not stay held
    if (!this.active) return;
    if (this.typing()) return;
    const code = e.code;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight'].includes(code) && !e.ctrlKey && !e.metaKey) {
      if (down) this.keys.add(code); else this.keys.delete(code);
      e.preventDefault();
      return;
    }
    if (!down) return;
    const mod = e.ctrlKey || e.metaKey;
    if ((code === 'Delete' || code === 'Backspace') && this.sel) { this.deleteSelected(); e.preventDefault(); }
    else if (mod && code === 'KeyD') { this.duplicateSelected(); e.preventDefault(); }
    else if (code === 'KeyR' && !mod) {
      const deg = e.shiftKey ? -45 : 45;
      if (this.tool === 'place' && this.placing) { this.placing.yaw = (this.placing.yaw + Math.round(deg / 360 * 65536)) & 0xffff; if (this.mouse) this.updateGhost(this.mouse.x, this.mouse.y); }
      else if (this.tool === 'generator') this.rotateGenerator(deg);
      else this.rotateSelected(deg);
      e.preventDefault();
    }
    else if (code === 'KeyF' || code === 'NumpadDecimal') { this.frameSelection(); e.preventDefault(); }
    else if (code === 'Home' && e.shiftKey) { this.overview(); e.preventDefault(); }
    else if (code === 'Home') { const s = this.sel; this.sel = null; this.frameSelection(); this.sel = s; e.preventDefault(); }
    // numpad views like Blender: 1 front, 3 right, 7 top (Ctrl: the opposite side), 2/4/6/8 orbit, +/- zoom
    else if (code === 'Numpad1') { this.viewAlong(mod ? [0, 0, -1] : [0, 0, 1]); e.preventDefault(); }
    else if (code === 'Numpad3') { this.viewAlong(mod ? [1, 0, 0] : [-1, 0, 0]); e.preventDefault(); }
    else if (code === 'Numpad7') { this.viewAlong(mod ? [0, 1, 0] : [0, -1, 0]); e.preventDefault(); }
    else if (['Numpad2', 'Numpad4', 'Numpad6', 'Numpad8'].includes(code)) {
      const step = 15 / (0.0075 * 180 / Math.PI); // 15 degrees in orbit pixels
      const dx = code === 'Numpad4' ? -step : code === 'Numpad6' ? step : 0;
      const dy = code === 'Numpad8' ? -step : code === 'Numpad2' ? step : 0;
      this.orbitBy(dx, dy, this.viewCenter());
      e.preventDefault();
    }
    else if (code === 'NumpadAdd' || code === 'NumpadSubtract' || ((code === 'Equal' || code === 'Minus') && !mod)) {
      this.zoomToward(this.viewCenter(), code === 'NumpadAdd' || code === 'Equal' ? 0.2 : -0.25);
      e.preventDefault();
    }
    else if (code === 'KeyG' && this.sel) { this.dropSelectedToGround(); e.preventDefault(); }
    else if (code === 'Digit1') this.setGizmo('move');
    else if (code === 'Digit2') this.setGizmo('rotate');
    else if (code === 'Digit3') this.setGizmo('size');
    else if (code === 'Enter' && this.tool === 'generator') { this.applyGenerator(); e.preventDefault(); }
    else if ((code === 'BracketLeft' || code === 'BracketRight') && this.tool === 'sculpt') {
      this.brush.radius = Math.max(60, Math.min(4000, Math.round(this.brush.radius * (code === 'BracketLeft' ? 0.85 : 1.18))));
      this.ui.onToolChange();
    }
    else if (code === 'Escape') {
      if (this.tool === 'sculpt') this.stopSculpt();
      else if (this.tool === 'place') this.cancelPlacing();
      else if (this.tool === 'generator') this.cancelGenerator();
      else this.select(null);
      e.preventDefault();
    }
  }

  // ---- per frame ------------------------------------------------------------

  onFrame() {
    if (!this.active) return;
    if (this.stroke) this.sculptTick();
    this.tickCamera();
    this.camData = this.engine.camOut();
    this.draw();
  }

  clearOverlay() {
    // a fresh bitmap, not only clearRect (it leaves the transform and, on some GPUs, the last
    // presented picture: build-mode handles were seen frozen over the game while racing)
    const c = this.overlay;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, c.width, c.height);
    c.width = c.width; // eslint-disable-line no-self-assign
  }

  draw() {
    const cv = this.overlay;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round';
    g.lineJoin = 'round';

    const recs = this.records();
    // invisible blocks and pipe links: things you can't otherwise see
    for (const r of recs) {
      if (r.block && (r.block.flags & 1)) this.drawBlockBox(r, 'rgba(120,200,255,0.8)', [6, 5]);
    }
    this.drawPipeLinks(recs);
    for (const fn of this.drawHooks || []) { try { fn(this, g, recs); } catch (err) { console.error('draw hook', err); } } // world_ui.js: warp links, zone labels

    if (this.hover != null && (!this.sel || this.hover !== this.sel.slot) && this.tool === 'select') {
      const o = this.hoverObj?.slot === this.hover ? this.hoverObj : (this.hoverObj = this.objectAt(this.hover));
      if (o) {
        const rec = this.recordOf(o.uid);
        if (rec?.block) this.drawBlockBox(rec, 'rgba(255,255,255,0.55)');
        else this.drawObjectBox(o, 'rgba(255,255,255,0.55)');
      }
    }
    if (this.sel) {
      const pose = this.selPose();
      if (pose.block) this.drawBlockBox({ ...pose, x: pose.p[0], y: pose.p[1], z: pose.p[2] }, ACCENT);
      else this.drawObjectBox({ ...this.sel.obj, x: pose.p[0], y: pose.p[1], z: pose.p[2] }, ACCENT);
      this.drawLabel(pose, this.sel.name);
      if (this.tool === 'select') this.drawHandles();
    }
    if (this.placing?.point) this.drawCursor(this.placing.point.p);
    if (this.gen?.anchor) this.drawCursor(this.gen.anchor.p);
    if (this.tool === 'sculpt' && this.mouse && !this.drag?.nav) this.drawBrush();
    if (this.drag?.nav && this.drag.pivot && (this.drag.type === 'orbit' || this.drag.type === 'zoom')) this.drawPivot(this.drag.pivot);
    this.drawNav();
  }

  // Brush outline that follows the ground.
  drawBrush() {
    const hit = this.pick(this.mouse.x, this.mouse.y, { objects: false });
    if (!hit) return;
    const g = this.ctx;
    const r = this.brush.radius;
    const target = this.world.brushTarget(hit.x, hit.z);
    const color = !target ? 'rgba(255,90,90,0.9)' : this.brush.mode === 'paint' ? '#5ee08a' : this.strokeMode(this.keyMods) === 'lower' ? '#5aa7ff' : ACCENT;
    for (const [rr, a] of [[r, 1], [r * 0.5, 0.45]]) {
      g.strokeStyle = color;
      g.globalAlpha = a;
      g.lineWidth = 2;
      g.beginPath();
      let started = false;
      for (let i = 0; i <= 40; i++) {
        const t = (i / 40) * Math.PI * 2;
        const x = hit.x + Math.sin(t) * rr, z = hit.z + Math.cos(t) * rr;
        let y = this.engine.floor(x, hit.y + 1500, z);
        if (y < -20000) y = hit.y;
        const q = this.project([x, y + 6, z]);
        if (!q) { started = false; continue; }
        if (!started) { g.moveTo(q.x, q.y); started = true; } else g.lineTo(q.x, q.y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    const c = this.project([hit.x, hit.y, hit.z]);
    if (c) { g.fillStyle = color; g.beginPath(); g.arc(c.x, c.y, 3, 0, Math.PI * 2); g.fill(); }
  }

  drawPivot(p) {
    const q = this.project(p);
    if (!q) return;
    const g = this.ctx;
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(q.x, q.y, 4, 0, Math.PI * 2); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.arc(q.x, q.y, 11, 0, Math.PI * 2); g.stroke();
  }

  // Axis widget: drag to orbit, click an axis for top/front/side views.
  drawNav() {
    const g = this.ctx;
    const L = this.navLayout();
    const hover = this.navHover;
    const active = this.drag?.nav && this.drag.type !== 'navclick';
    g.fillStyle = hover?.type === 'disc' || active ? 'rgba(40,40,48,0.62)' : 'rgba(12,12,16,0.38)';
    g.beginPath(); g.arc(L.cx, L.cy, NAV.r, 0, Math.PI * 2); g.fill();
    // back to front
    const balls = [...L.balls].sort((a, b) => a.depth - b.depth);
    for (const b of balls) {
      if (b.pos) {
        g.strokeStyle = b.color;
        g.lineWidth = 2.5;
        g.beginPath(); g.moveTo(L.cx, L.cy); g.lineTo(b.x, b.y); g.stroke();
      }
    }
    for (const b of balls) {
      const hot = hover?.type === 'ball' && hover.dir.every((v, i) => v === b.dir[i]);
      g.beginPath();
      g.arc(b.x, b.y, b.pos ? 9 : 7, 0, Math.PI * 2);
      if (b.pos) {
        g.fillStyle = hot ? '#fff' : b.color;
        g.fill();
        g.fillStyle = '#111';
        g.font = '700 10px Inter, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(b.label, b.x, b.y + 0.5);
      } else {
        g.fillStyle = hot ? 'rgba(255,255,255,0.8)' : b.color + '55';
        g.strokeStyle = b.color;
        g.lineWidth = 1.5;
        g.fill(); g.stroke();
      }
    }
    g.textAlign = 'start';
    g.textBaseline = 'alphabetic';
    const icons = {
      pan: (x, y) => { g.beginPath(); g.moveTo(x - 6, y); g.lineTo(x + 6, y); g.moveTo(x, y - 6); g.lineTo(x, y + 6); g.stroke(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { g.beginPath(); g.moveTo(x + dx * 7, y + dy * 7); g.lineTo(x + dx * 4 + dy * 2.5, y + dy * 4 + dx * 2.5); g.moveTo(x + dx * 7, y + dy * 7); g.lineTo(x + dx * 4 - dy * 2.5, y + dy * 4 - dx * 2.5); g.stroke(); } },
      zoom: (x, y) => { g.beginPath(); g.arc(x - 1.5, y - 1.5, 4.5, 0, Math.PI * 2); g.moveTo(x + 2, y + 2); g.lineTo(x + 6, y + 6); g.stroke(); },
      frame: (x, y) => { g.beginPath(); for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.moveTo(x + sx * 6, y + sy * 2); g.lineTo(x + sx * 6, y + sy * 6); g.lineTo(x + sx * 2, y + sy * 6); } g.stroke(); g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fill(); },
    };
    for (const b of L.buttons) {
      const hot = hover?.type === 'button' && hover.id === b.id;
      const on = this.drag?.nav && ((b.id === 'pan' && this.drag.type === 'pan') || (b.id === 'zoom' && this.drag.type === 'zoom')) && this.drag.startMouse && Math.hypot(this.drag.startMouse.x - b.x, this.drag.startMouse.y - b.y) < NAV.btn + 3;
      g.fillStyle = on ? 'rgba(255,200,61,0.9)' : hot ? 'rgba(255,255,255,0.22)' : 'rgba(12,12,14,0.55)';
      g.strokeStyle = 'rgba(255,255,255,0.14)';
      g.lineWidth = 1;
      g.beginPath(); g.arc(b.x, b.y, NAV.btn, 0, Math.PI * 2); g.fill(); g.stroke();
      g.strokeStyle = on ? '#2b1a00' : '#fff';
      g.fillStyle = on ? '#2b1a00' : '#fff';
      g.lineWidth = 1.6;
      g.lineCap = 'round';
      icons[b.id](b.x, b.y);
    }
  }

  line(a, b, color, width = 2, dash = null) {
    const p = this.project(a), q = this.project(b);
    if (!p || !q) return;
    const g = this.ctx;
    g.strokeStyle = color;
    g.lineWidth = width;
    g.setLineDash(dash || []);
    g.beginPath();
    g.moveTo(p.x, p.y);
    g.lineTo(q.x, q.y);
    g.stroke();
    g.setLineDash([]);
  }

  drawBlockBox(r, color, dash) {
    const b = r.block;
    const R = rotRows(r.pitch | 0, r.yaw | 0, r.roll | 0);
    const p = [r.x, r.y, r.z];
    const c = [];
    for (const y of [0, b.sy]) for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) c.push(toWorld(R, p, [x * b.sx / 2, y, z * b.sz / 2]));
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [i, j] of edges) this.line(c[i], c[j], color, 2, dash);
  }

  drawObjectBox(o, color) {
    const sc = o.scale || 1;
    const r = Math.max(50, Math.min(400, o.r || 70)) * sc;
    const h = Math.max(80, Math.min(600, o.h || 140)) * sc;
    const base = [o.x, o.y - (o.down || 0) * sc, o.z];
    const ring = (y) => {
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        pts.push(this.project([base[0] + Math.sin(a) * r, y, base[2] + Math.cos(a) * r]));
      }
      const g = this.ctx;
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      let started = false;
      for (const p of pts) { if (!p) { started = false; continue; } if (!started) { g.moveTo(p.x, p.y); started = true; } else g.lineTo(p.x, p.y); }
      g.stroke();
    };
    ring(base[1]);
    ring(base[1] + h);
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) this.line([base[0] + x * r, base[1], base[2] + z * r], [base[0] + x * r, base[1] + h, base[2] + z * r], color, 1.5);
  }

  drawLabel(pose, text) {
    const top = pose.block ? pose.p[1] + pose.block.sy : pose.p[1] + 180 * (pose.scale || 1);
    const p = this.project([pose.p[0], top, pose.p[2]]);
    if (!p) return;
    const g = this.ctx;
    g.font = '600 12px Inter, sans-serif';
    const w = g.measureText(text).width + 16;
    const x = p.x - w / 2, y = p.y - 34;
    g.fillStyle = 'rgba(12,12,14,0.85)';
    roundRect(g, x, y, w, 22, 11);
    g.fill();
    g.strokeStyle = 'rgba(255,200,61,0.6)';
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = '#fff';
    g.fillText(text, x + 8, y + 15);
  }

  drawHandles() {
    const g = this.ctx;
    const active = this.drag?.handle;
    for (const h of this.handles()) {
      const hot = active === h || (this.mouse && this.hitHandle(this.mouse.x, this.mouse.y) === h);
      if (h.type === 'axis') {
        g.strokeStyle = h.axis.color;
        g.lineWidth = hot ? 5 : 3.5;
        g.beginPath(); g.moveTo(h.from.x, h.from.y); g.lineTo(h.to.x, h.to.y); g.stroke();
        const a = Math.atan2(h.to.y - h.from.y, h.to.x - h.from.x);
        g.fillStyle = h.axis.color;
        g.beginPath();
        g.moveTo(h.to.x + Math.cos(a) * 12, h.to.y + Math.sin(a) * 12);
        g.lineTo(h.to.x + Math.cos(a + 2.5) * 9, h.to.y + Math.sin(a + 2.5) * 9);
        g.lineTo(h.to.x + Math.cos(a - 2.5) * 9, h.to.y + Math.sin(a - 2.5) * 9);
        g.closePath(); g.fill();
      } else if (h.type === 'free') {
        g.fillStyle = hot ? '#fff' : 'rgba(255,255,255,0.85)';
        g.strokeStyle = 'rgba(0,0,0,0.5)';
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(h.at.x, h.at.y, 7, 0, Math.PI * 2); g.fill(); g.stroke();
      } else if (h.type === 'ring') {
        g.strokeStyle = hot ? '#fff' : ACCENT;
        g.lineWidth = hot ? 4 : 3;
        g.beginPath();
        h.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.stroke();
        const a = yawToRad(h.yaw);
        const tip = this.project(add(h.center, [Math.sin(a) * h.R, 0, Math.cos(a) * h.R]));
        if (tip) { g.fillStyle = ACCENT; g.beginPath(); g.arc(tip.x, tip.y, 6, 0, Math.PI * 2); g.fill(); }
      } else if (h.type === 'face' || h.type === 'scale') {
        g.fillStyle = hot ? '#fff' : ACCENT;
        g.strokeStyle = 'rgba(0,0,0,0.55)';
        g.lineWidth = 1.5;
        g.beginPath(); g.rect(h.at.x - 6, h.at.y - 6, 12, 12); g.fill(); g.stroke();
      }
    }
  }

  drawCursor(p) {
    const g = this.ctx;
    const pts = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      pts.push(this.project([p[0] + Math.sin(a) * 90, p[1] + 2, p[2] + Math.cos(a) * 90]));
    }
    g.strokeStyle = ACCENT;
    g.lineWidth = 2;
    g.setLineDash([5, 5]);
    g.beginPath();
    let s = false;
    for (const q of pts) { if (!q) { s = false; continue; } if (!s) { g.moveTo(q.x, q.y); s = true; } else g.lineTo(q.x, q.y); }
    g.stroke();
    g.setLineDash([]);
  }

  drawPipeLinks(recs) {
    const area = this.engine.patch.areas[this.engine.areaKey()];
    if (!area?.warps?.length) return;
    const byNode = new Map();
    for (const r of recs) if (r.entry === 'warp_pipe') byNode.set((r.bparams >>> 16) & 0xff, r);
    for (const w of area.warps) {
      const a = byNode.get(w.node), b = byNode.get(w.destNode);
      if (!a || !b || a === b || w.node > w.destNode && area.warps.some((x) => x.node === w.destNode && x.destNode === w.node)) continue;
      // arc between the pipe tops
      const p0 = [a.x, a.y + 220, a.z], p1 = [b.x, b.y + 220, b.z];
      const mid = add(mul(add(p0, p1), 0.5), [0, Math.min(2500, len(sub(p1, p0)) * 0.35), 0]);
      let prev = null;
      for (let i = 0; i <= 32; i++) {
        const t = i / 32;
        const q = add(add(mul(p0, (1 - t) * (1 - t)), mul(mid, 2 * t * (1 - t))), mul(p1, t * t));
        if (prev) this.line(prev, q, 'rgba(94,224,138,0.85)', 2.5, [8, 6]);
        prev = q;
      }
    }
  }
}

// isTyping lives in typing.js (the player uses it without the editor)
export { isTyping };

function segDist(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export { SHAPES, SHAPE_NAMES, MATERIALS, PRESETS, GENERATORS };
