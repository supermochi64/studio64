// The game's collision data (what COL_* macros compile to) from the dumped surfaces.
import { COL } from './n64.js';
import { simplifyCollision } from './simplify.js';

// surface types that carry a force parameter (surface_has_force in the game)
const HAS_FORCE = new Set([0x0004, 0x000E, 0x0024, 0x0025, 0x0027, 0x002C, 0x002D]);
const SURFACE_DEATH_PLANE = 0x000A;
const WORLD = 16000;
const GROUP = 8000; // the game reads a group's triangle count as a signed 16-bit number
// big areas get simpler collision (simplify.js): within this distance of what they draw
const SIMPLIFY_FROM = 6000, SIMPLIFY_TOLERANCE = 8;

// Writes the collision of an area into seg at label name. -> stats
// object: an object's collision (its own coordinates; no death plane, no water)
export function buildCollision(seg, dump, name, { deathY = null, object = false } = {}) {
  const verts = [];
  const vindex = new Map();
  const vid = (x, y, z) => {
    const k = `${x},${y},${z}`;
    if (!vindex.has(k)) { vindex.set(k, verts.length); verts.push([x, y, z]); }
    return vindex.get(k);
  };
  const groups = new Map(); // type -> [[a, b, c, force]]
  let minY = Infinity;
  const source = !object && dump.collision.length > SIMPLIFY_FROM ? simplifyCollision(dump.collision, SIMPLIFY_TOLERANCE) : dump.collision;
  for (const c of source) {
    const v = c.v;
    const a = vid(v[0], v[1], v[2]), b = vid(v[3], v[4], v[5]), d = vid(v[6], v[7], v[8]);
    if (a === b || b === d || a === d) continue;
    minY = Math.min(minY, v[1], v[4], v[7]);
    let type = c.type & 0xFFFF;
    if (type >= 0x40 && type < 0x65) type = 0; // the loader reads these as commands
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push([a, b, d, c.force]);
  }

  // a death plane below everything, as in the game's courses: falling off ends the attempt
  const planeY = object ? null : Math.max(-15000, Math.round(deathY ?? (Number.isFinite(minY) ? minY - 1500 : -3000)));
  if (!object) {
    const p = [vid(-WORLD, planeY, -WORLD), vid(WORLD, planeY, -WORLD), vid(WORLD, planeY, WORLD), vid(-WORLD, planeY, WORLD)];
    if (!groups.has(SURFACE_DEATH_PLANE)) groups.set(SURFACE_DEATH_PLANE, []);
    groups.get(SURFACE_DEATH_PLANE).push([p[0], p[2], p[1], 0], [p[0], p[3], p[2], 0]);
  }

  if (verts.length > 32767) throw new Error(`too many collision vertices (${verts.length}, the game allows 32767)`);

  seg.align(4).label(name);
  seg.s16(COL.VERTICES).s16(verts.length);
  for (const v of verts) seg.s16(v[0]).s16(v[1]).s16(v[2]);
  let tris = 0;
  for (const [type, all] of groups) {
    for (let i = 0; i < all.length; i += GROUP) {
      const list = all.slice(i, i + GROUP);
      seg.s16(type).s16(list.length);
      for (const t of list) {
        seg.s16(t[0]).s16(t[1]).s16(t[2]);
        if (HAS_FORCE.has(type)) seg.s16(t[3]);
      }
      tris += list.length;
    }
  }
  seg.s16(COL.CONTINUE);
  const water = object ? [] : (dump.water || []);
  if (water.length) {
    seg.s16(COL.ENVIRONMENT).s16(water.length);
    for (const w of water) seg.s16(w.id).s16(w.x1).s16(w.z1).s16(w.x2).s16(w.z2).s16(w.y);
  }
  seg.s16(COL.END);
  return { verts: verts.length, tris, water: water.length, deathPlane: planeY, drawnTris: dump.collision.length };
}
