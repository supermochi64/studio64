// Roads & nature: roads and walks. A road record keeps its control points, style and width,
// plus the ground under it sampled when it was last edited (`prof`, `drop`), so it is rebuilt
// the same way on every load, in the studio and in the player.
//
// Build: sample the curve every 32 units -> heights -> junctions with the other roads of the area
// (a road that ends on another one runs under it and the other one gets a gap in its markings,
// curbs and fences; crossing roads get the same) -> bands across the road (surface, curbs,
// sidewalks, soft edges, markings) -> steps on steep parts -> collision with a fitting surface.

import { Mesh, V, MAT, SURF, prism } from './mesh.js';
import { sampleCurve, closestOnCurve, segCross, resample, mergeRanges, inRanges, clamp, lerp, smooth01, rightOf } from './geom.js';
import * as T from './textures.js';
import { buildLine, LINE_STYLES } from './lines.js';

export const STEP = 32; // sample spacing along a road

// Game block materials used (src/studio/editor.c order): 1 dirt, 2 cobblestone, 3 stone path, 12 wood planks
export const ROAD_STYLES = {
  asphalt:   { label: 'Asphalt road', width: 440, tex: 'asphalt', texScale: 160, surf: SURF.not_slippery, markings: true, caps: 'square', skirt: 'dirt', stairs: false, icon: '#4a4c52' },
  street:    { label: 'Street with sidewalks', width: 680, tex: 'asphalt', texScale: 160, surf: SURF.not_slippery, markings: true, sidewalks: true, caps: 'square', skirt: 'curb', stairs: false, icon: '#6d6f76' },
  sidewalk:  { label: 'Sidewalk', width: 220, tex: 'concrete', texScale: 96, surf: SURF.not_slippery, raised: 14, caps: 'square', skirt: 'curb', stairs: true, icon: '#b9b6ae' },
  dirt:      { label: 'Dirt path', width: 230, tex: 'dirt', texScale: 128, surf: SURF.normal, fade: 70, caps: 'round', skirt: 'dirt', stairs: true, icon: '#8a6236' },
  cobble:    { label: 'Cobblestone', width: 280, tex: 'game:2', texScale: 110, surf: SURF.not_slippery, border: true, caps: 'round', skirt: 'game:2', stairs: true, icon: '#8d8a84' },
  gravel:    { label: 'Gravel path', width: 230, tex: 'gravel', texScale: 96, surf: SURF.normal, fade: 50, caps: 'round', skirt: 'dirt', stairs: true, icon: '#a39886' },
  boardwalk: { label: 'Wooden boardwalk', width: 230, tex: 'planks', texScale: 96, surf: SURF.not_slippery, deck: 28, caps: 'square', skirt: null, stairs: true, icon: '#a8743e' },
  stone:     { label: 'Stone path', width: 240, tex: 'game:3', texScale: 128, surf: SURF.not_slippery, caps: 'round', skirt: 'game:3', stairs: true, icon: '#a49c8a' },
};
export const ROAD_IDS = Object.keys(ROAD_STYLES);
export const CUSTOM_STYLE = (slot) => ({ label: 'Custom material', width: 260, tex: `custom:${slot}`, texScale: 128, surf: SURF.not_slippery, caps: 'round', skirt: `custom:${slot}`, stairs: true, icon: '#c080ff' });

export function styleOf(road) {
  if (road.style === 'custom') return CUSTOM_STYLE(road.material | 0);
  return ROAD_STYLES[road.style] || ROAD_STYLES.asphalt;
}

const STAIR_GRADE = 0.42; // about 23 degrees: steeper parts of walks become steps
const STAIR_RISE = 36;
const LIFT = 3;           // the road surface floats this much over the ground it was fitted to

// ---- textures -------------------------------------------------------------------------

function texture(name, ctx) {
  if (name.startsWith('game:')) return T.gameTexture(ctx.engine, Number(name.slice(5))) || T.concrete();
  if (name.startsWith('custom:')) return ctx.customMaterial?.(Number(name.slice(7))) || T.concrete();
  return ({ asphalt: T.asphalt, concrete: T.concrete, dirt: () => T.gameTexture(ctx.engine, 1) || T.dirtTex(), gravel: T.gravel, planks: T.planks, curb: T.curbStone })[name]?.() || T.concrete();
}

// ---- sampling -------------------------------------------------------------------------

export function samplesOf(road) {
  const st = styleOf(road);
  return sampleCurve(road.pts || [], { closed: !!road.closed, smooth: road.smooth !== false, step: STEP, width: road.width || st.width });
}

// Fit a road to the ground: heights along it and how far the ground drops at its edges.
// ground(x, z, yHint) -> height or null (the caller leaves the road's own geometry out).
export function fitProfile(road, ground) {
  const st = styleOf(road);
  const S = samplesOf(road);
  const n = S.length;
  if (!n) return { prof: [], drop: [] };
  const gmax = new Array(n), gmin = new Array(n);
  for (let i = 0; i < n; i++) {
    const s = S[i], [rx, rz] = rightOf(s), hw = (s.w / 2) * 0.92;
    const hs = [ground(s.x, s.z, s.y), ground(s.x + rx * hw, s.z + rz * hw, s.y), ground(s.x - rx * hw, s.z - rz * hw, s.y)].filter((v) => v != null);
    gmax[i] = hs.length ? Math.max(...hs) : s.y;
    gmin[i] = hs.length ? Math.min(...hs) : s.y - 40;
  }
  const follow = road.follow !== 'points';
  const clear = st.deck || 0;
  let Y = follow ? gmax.map((g) => g + clear) : S.map((s) => s.y + clear);
  const smoothPass = (arr) => arr.map((_, i) => {
    let sum = 0, w = 0;
    for (let k = -3; k <= 3; k++) {
      let j = i + k;
      if (S.closed) j = (j + n - 1) % (n - 1);
      else if (j < 0 || j >= n) continue;
      const wt = 4 - Math.abs(k);
      sum += arr[j] * wt; w += wt;
    }
    return sum / w;
  });
  for (let it = 0; it < 4; it++) {
    Y = smoothPass(Y);
    if (follow) Y = Y.map((y, i) => Math.max(y, gmax[i] + clear - 2)); // never sunk into the ground
  }
  // the ends stay where they were clicked on, so a road starts exactly on a ledge or a bridge
  return { prof: Y.map((y) => Math.round(y)), drop: Y.map((y, i) => Math.max(0, Math.round(y - gmin[i]))) };
}

// ---- the network: all roads of an area ----------------------------------------------------

// recs: road records -> prepared roads with samples, heights and junction effects.
export function prepareNetwork(recs) {
  const roads = [];
  for (const rec of recs) {
    const road = rec.road;
    const st = styleOf(road);
    const S = samplesOf(road);
    if (S.length < 2) continue;
    const n = S.length;
    const Y = (resample(road.prof, n) || S.map((s) => s.y)).slice();
    const drop = resample(road.drop, n) || new Array(n).fill(30);
    const side = st.sidewalks ? Math.min(140, Math.max(70, (road.width || st.width) * 0.2)) : 0;
    roads.push({ rec, road, st, S, Y, drop, n, side, lift: new Array(n).fill(LIFT), under: new Array(n).fill(false), gaps: { L: [], R: [], mark: [] }, ends: { start: null, end: null } });
  }
  const hwAt = (R, i) => R.S[clamp(i, 0, R.n - 1)].w / 2;
  // junctions: a road that ends on another one
  for (const A of roads) {
    if (A.S.closed) continue;
    for (const end of ['start', 'end']) {
      const i = end === 'start' ? 0 : A.n - 1;
      const p = A.S[i];
      let best = null;
      for (const B of roads) {
        if (B === A) continue;
        const c = closestOnCurve(B.S, p.x, p.z);
        if (!c) continue;
        const yB = lerp(B.Y[c.i], B.Y[c.i + 1], c.f);
        if (c.d < c.w / 2 + 30 && Math.abs(yB - A.Y[i]) < 160 && (!best || c.d < best.c.d)) best = { B, c, yB };
      }
      if (!best) continue;
      const { B, c, yB } = best;
      A.ends[end] = { B, c };
      // heights ease into the other road's surface over the last few samples
      const reach = Math.max(160, c.w);
      for (let k = 0; k < A.n; k++) {
        const j = end === 'start' ? k : A.n - 1 - k;
        const d = A.S[end === 'start' ? 0 : A.n - 1].s - A.S[j].s;
        const dist = Math.abs(d);
        if (dist > reach) break;
        A.Y[j] = lerp(A.Y[j], yB, smooth01(1 - dist / reach));
      }
      // inside the other road it runs under it
      for (let j = 0; j < A.n; j++) {
        const q = closestOnCurve(B.S, A.S[j].x, A.S[j].z);
        if (q && q.d < q.w / 2 - 4) { A.under[j] = true; A.lift[j] = 1; A.Y[j] = lerp(B.Y[q.i], B.Y[q.i + 1], q.f); }
      }
      // the other road opens on that side
      const [rx, rz] = rightOf(B.S[c.i]);
      const sideKey = (p.x - c.x) * rx + (p.z - c.z) * rz >= 0 ? 'R' : 'L';
      const t = A.S[end === 'start' ? Math.min(2, A.n - 1) : Math.max(0, A.n - 3)];
      const sinA = Math.abs(t.tx * B.S[c.i].tz - t.tz * B.S[c.i].tx) || 1;
      const half = (hwAt(A, i) + 26) / Math.max(0.35, sinA);
      B.gaps[sideKey].push([c.s - half, c.s + half]);
      B.gaps.mark.push([c.s - half, c.s + half]);
    }
  }
  // crossings: the later road goes over, both lose their markings and curbs there
  for (let ai = 0; ai < roads.length; ai++) for (let bi = 0; bi < ai; bi++) {
    const A = roads[ai], B = roads[bi];
    for (let i = 0; i + 1 < A.n; i++) {
      for (let j = 0; j + 1 < B.n; j++) {
        const x = segCross(A.S[i], A.S[i + 1], B.S[j], B.S[j + 1]);
        if (!x) continue;
        const sA = lerp(A.S[i].s, A.S[i + 1].s, x.ta), sB = lerp(B.S[j].s, B.S[j + 1].s, x.tb);
        // a junction end already handles it
        if ((A.ends.start && sA < 200) || (A.ends.end && sA > A.S[A.n - 1].s - 200)) continue;
        if ((B.ends.start && sB < 200) || (B.ends.end && sB > B.S[B.n - 1].s - 200)) continue;
        const yA = lerp(A.Y[i], A.Y[i + 1], x.ta), yB = lerp(B.Y[j], B.Y[j + 1], x.tb);
        if (Math.abs(yA - yB) > 70) continue; // a bridge over the other one
        const sinA = Math.abs(A.S[i].tx * B.S[j].tz - A.S[i].tz * B.S[j].tx) || 1;
        const hA = (A.S[i].w / 2 + 26) / Math.max(0.35, sinA), hB = (B.S[j].w / 2 + 26) / Math.max(0.35, sinA);
        for (const k of ['L', 'R', 'mark']) { B.gaps[k].push([sB - hA, sB + hA]); A.gaps[k].push([sA - hB, sA + hB]); }
        for (let k = 0; k < A.n; k++) {
          if (Math.abs(A.S[k].s - sA) > hB + 40) continue;
          const q = closestOnCurve(B.S, A.S[k].x, A.S[k].z);
          if (q && q.d < q.w / 2 + 10) { A.lift[k] = LIFT + 1; A.Y[k] = lerp(A.Y[k], lerp(B.Y[q.i], B.Y[q.i + 1], q.f), 0.85); }
        }
      }
    }
  }
  for (const R of roads) for (const k of ['L', 'R', 'mark']) R.gaps[k] = mergeRanges(R.gaps[k]);
  return roads;
}

// Is (x, z) on a road (within `margin` of its edge)? Returns { R, c } of the nearest.
export function roadAt(roads, x, z, margin = 0) {
  let best = null;
  for (const R of roads) {
    const c = closestOnCurve(R.S, x, z);
    if (c && c.d <= c.w / 2 + margin && (!best || c.d < best.c.d)) best = { R, c };
  }
  return best;
}

// ---- one road's mesh ------------------------------------------------------------------------

const C = (k) => [255 * k, 255 * k, 255 * k];
const edgeAO = (f) => (f > 0.97 ? 0.74 : f > 0.7 ? 0.9 : 1); // darker at the edges, like baked AO

export function buildRoadMesh(R, ctx) {
  const { st, S, n, road } = R;
  const mesh = new Mesh();
  const surf = mesh.mat('surf', texture(st.tex, ctx), 0);
  if (st.fade) mesh.mat('fade', texture(st.tex, ctx), MAT.BLEND);
  mesh.mat('mark', null, 0);
  mesh.mat('curb', T.curbStone(), 0);
  mesh.mat('walk', T.concrete(), 0);
  mesh.mat('skirt', texture(st.skirt || st.tex, ctx), 0);
  if (st.border) mesh.mat('border', T.gameTexture(ctx.engine, 3) || T.curbStone(), 0);
  if (st.deck) mesh.mat('beam', T.planks(), 0);
  const ts = st.texScale;
  const stairsOn = road.stairs ?? st.stairs;
  const Y = R.Y;
  const hw = (i) => S[i].w / 2;
  const sideW = R.side;
  const raised = st.raised || 0;
  const curbH = st.sidewalks ? 16 : raised;
  const coreHalf = (i) => (st.sidewalks ? hw(i) - sideW : hw(i));

  // steps: steep segments of walks get flat treads (drawn), the collision stays a grippy ramp
  const stairSeg = new Array(Math.max(0, n - 1)).fill(false);
  const treadSeg = new Array(Math.max(0, n - 1)).fill(null);
  if (stairsOn) {
    for (let i = 0; i + 1 < n; i++) {
      const g = (Y[i + 1] - Y[i]) / Math.max(1, S[i + 1].s - S[i].s);
      if (Math.abs(g) > STAIR_GRADE && !R.under[i] && !R.under[i + 1]) stairSeg[i] = true;
    }
    let i = 0;
    while (i < n - 1) {
      if (!stairSeg[i]) { i++; continue; }
      let j = i;
      while (j + 1 < n - 1 && stairSeg[j + 1]) j++;
      // segments i..j are one flight from sample i to sample j + 1
      const rise = Math.abs(Y[j + 1] - Y[i]);
      const count = Math.max(1, Math.min(j - i + 1, Math.round(rise / STAIR_RISE)));
      const per = (j - i + 1) / count;
      for (let k = 0; k < count; k++) {
        const a = i + Math.round(k * per), b = i + Math.round((k + 1) * per); // segments a..b-1
        const h = (Y[a] + Y[b]) / 2;
        for (let q = a; q < b && q <= j; q++) treadSeg[q] = h;
      }
      R.flights = (R.flights || 0) + 1;
      i = j + 1;
    }
  }
  // drawn surface height of segment i at its end sample j
  const H = (i, j) => (treadSeg[i] != null ? treadSeg[i] : Y[j]);
  const at = (j, off, y) => { const s = S[j], [rx, rz] = rightOf(s); return [s.x + rx * off, y, s.z + rz * off]; };
  const P = (i, j, off, up) => at(j, off, H(i, j) + R.lift[j] + up);
  const Pc = (j, off, up) => at(j, off, Y[j] + R.lift[j] + up);
  const gapOn = (side, j) => R.under[j] || inRanges(R.gaps[side], S[j].s);
  const segGap = (side, i) => gapOn(side, i) || gapOn(side, i + 1);

  // a band from offset a to b (functions of the sample), between samples i and i + 1
  const strip = (key, i, a, b, up, { col = 1, ao = true, collide = true, type = st.surf, alpha = null, down = 0 } = {}) => {
    const k = (j, off) => (ao ? edgeAO(Math.abs(off) / hw(j)) : 1) * col;
    const uv = (j, off) => [off / ts, S[j].s / ts];
    const pts = [[i, a(i)], [i, b(i)], [i + 1, b(i + 1)], [i + 1, a(i + 1)]];
    const vs = pts.map(([j, off], q) => {
      const p = P(i, j, off, up);
      if (down && Math.abs(off) > hw(j) + 1) p[1] -= down;
      return V(p, uv(j, off), C(k(j, off)), alpha ? alpha[q === 0 || q === 3 ? 0 : 1] : 255);
    });
    mesh.quad(key, vs[0], vs[1], vs[2], vs[3], [0, 1, 0]);
    if (collide) mesh.colQuad(Pc(i, a(i), up), Pc(i, b(i), up), Pc(i + 1, b(i + 1), up), Pc(i + 1, a(i + 1), up), type, [0, 1, 0]);
  };
  // a vertical face along the road at offset off(), from up0 to up1 over the surface (outward: +1 right, -1 left)
  const face = (key, i, off, up0, up1, outward, { col = 0.82, collide = true, scale = ts } = {}) => {
    const a0 = P(i, i, off(i), up0), a1 = P(i, i + 1, off(i + 1), up0), b1 = P(i, i + 1, off(i + 1), up1), b0 = P(i, i, off(i), up1);
    const [rx, rz] = rightOf(S[i]);
    const nrm = [rx * outward, 0, rz * outward];
    mesh.quad(key, V(a0, [S[i].s / scale, up0 / scale], C(col)), V(a1, [S[i + 1].s / scale, up0 / scale], C(col)),
      V(b1, [S[i + 1].s / scale, up1 / scale], C(col + 0.12)), V(b0, [S[i].s / scale, up1 / scale], C(col + 0.12)), nrm);
    if (collide && Math.abs(up1 - up0) > 6) {
      const c0 = Pc(i, off(i), up0), c1 = Pc(i + 1, off(i + 1), up0), d1 = Pc(i + 1, off(i + 1), up1), d0 = Pc(i, off(i), up1);
      mesh.colQuad(c0, c1, d1, d0, 0, nrm);
    }
  };
  // a face across the road at sample j, from absolute height y0 to y1 (dir: +1 faces along the road)
  const across = (key, j, o0, o1, y0, y1, dir, { col = 0.8, collide = true } = {}) => {
    const a = at(j, o0, y0), b = at(j, o1, y0), c = at(j, o1, y1), d = at(j, o0, y1);
    const nrm = [S[j].tx * dir, 0, S[j].tz * dir];
    mesh.quad(key, V(a, [o0 / ts, 0], C(col)), V(b, [o1 / ts, 0], C(col)), V(c, [o1 / ts, (y1 - y0) / ts], C(col + 0.12)), V(d, [o0 / ts, (y1 - y0) / ts], C(col + 0.12)), nrm);
    if (collide) mesh.colQuad(a, b, c, d, 0, nrm);
  };

  for (let i = 0; i + 1 < n; i++) {
    const depth = Math.max(12, Math.max(R.drop[i], R.drop[i + 1]) + 14);
    if (st.sidewalks) {
      strip(surf, i, (j) => -coreHalf(j), (j) => coreHalf(j), 0, { ao: false });
      for (const [side, sg] of [['L', -1], ['R', 1]]) {
        if (segGap(side, i)) {
          // a junction mouth: the asphalt goes on to the outer edge
          strip(surf, i, sg < 0 ? (j) => -hw(j) : (j) => coreHalf(j), sg < 0 ? (j) => -coreHalf(j) : (j) => hw(j), 0, { ao: false });
          continue;
        }
        const inner = (j) => sg * coreHalf(j), curbOut = (j) => sg * (coreHalf(j) + 14), outer = (j) => sg * hw(j);
        strip('curb', i, sg < 0 ? curbOut : inner, sg < 0 ? inner : curbOut, curbH, { ao: false, col: 1.05 });
        strip('walk', i, sg < 0 ? outer : curbOut, sg < 0 ? curbOut : outer, curbH, { col: 1 });
        face('curb', i, inner, 0, curbH, -sg, { col: 0.86 });
        face('skirt', i, outer, -depth, curbH, sg, { col: 0.7, collide: depth > 30 });
      }
    } else if (raised) {
      const cw = 14;
      strip('walk', i, (j) => -hw(j) + cw, (j) => hw(j) - cw, raised, { col: 1 });
      for (const [side, sg] of [['L', -1], ['R', 1]]) {
        strip('curb', i, sg < 0 ? (j) => -hw(j) : (j) => hw(j) - cw, sg < 0 ? (j) => -hw(j) + cw : (j) => hw(j), raised, { ao: false, col: 1.06 });
        if (!R.under[i] || !segGap(side, i)) face('skirt', i, (j) => sg * hw(j), -depth, raised, sg, { col: 0.74, collide: true });
      }
    } else {
      strip(surf, i, (j) => -hw(j), (j) => hw(j), 0);
      if (st.border && !R.under[i]) for (const sg of [-1, 1]) {
        strip('border', i, sg < 0 ? (j) => -hw(j) : (j) => hw(j) - 18, sg < 0 ? (j) => -hw(j) + 18 : (j) => hw(j), 1.5, { ao: false, col: 0.92, collide: false });
      }
      if (st.deck) {
        for (const sg of [-1, 1]) face('beam', i, (j) => sg * hw(j), -24, 0, sg, { col: 0.78, scale: 64, collide: false });
      } else if (!R.under[i]) {
        for (const [side, sg] of [['L', -1], ['R', 1]]) {
          if (segGap(side, i)) continue;
          face('skirt', i, (j) => sg * hw(j), -depth, 0, sg, { col: 0.66, collide: depth > 40 });
        }
      }
      // soft edges that fade into the ground
      if (st.fade && !R.under[i] && !R.under[i + 1] && !stairSeg[i]) {
        const f = st.fade, sink = Math.min(10, R.drop[i] * 0.25);
        strip('fade', i, (j) => -hw(j) - f, (j) => -hw(j), -0.5, { col: 0.86, ao: false, collide: false, alpha: [0, 255], down: sink });
        strip('fade', i, (j) => hw(j), (j) => hw(j) + f, -0.5, { col: 0.86, ao: false, collide: false, alpha: [255, 0], down: sink });
      }
    }
    // the side walls of a flight of steps
    if (stairSeg[i]) {
      for (const sg of [-1, 1]) {
        const top = treadSeg[i] + Math.max(R.lift[i], R.lift[i + 1]) + (st.sidewalks ? curbH : raised);
        const bottom = Math.min(Y[i], Y[i + 1]) - 14;
        const p = [at(i, sg * hw(i), bottom), at(i + 1, sg * hw(i + 1), bottom), at(i + 1, sg * hw(i + 1), top), at(i, sg * hw(i), top)];
        const [rx, rz] = rightOf(S[i]);
        mesh.quad('skirt', V(p[0], [S[i].s / ts, 0], C(0.6)), V(p[1], [S[i + 1].s / ts, 0], C(0.6)), V(p[2], [S[i + 1].s / ts, (top - bottom) / ts], C(0.8)), V(p[3], [S[i].s / ts, (top - bottom) / ts], C(0.8)), [rx * sg, 0, rz * sg]);
      }
    }
  }
  // risers where one segment's surface ends higher or lower than the next one starts
  for (let j = 1; j + 1 < n; j++) {
    const hEnd = H(j - 1, j), hStart = H(j, j);
    if (Math.abs(hEnd - hStart) < 1.5) continue;
    const lo = Math.min(hEnd, hStart) + R.lift[j], hi = Math.max(hEnd, hStart) + R.lift[j];
    const up = st.sidewalks ? 0 : raised;
    across(st.sidewalks || !raised ? surf : 'walk', j, -hw(j), hw(j), lo + up, hi + up, hStart > hEnd ? -1 : 1, { col: 0.7, collide: false });
  }

  // lane markings
  if (st.markings) {
    const lanes = road.lanes ?? 2;
    const white = [242, 242, 232], yellow = [246, 200, 70];
    const centerCol = road.marking === 'yellow' ? yellow : white;
    const mark = (i, a, b, colr) => {
      const p = [P(i, i, a, 1), P(i, i, b, 1), P(i, i + 1, b, 1), P(i, i + 1, a, 1)];
      mesh.quad('mark', V(p[0], [0, 0], colr), V(p[1], [0, 0], colr), V(p[2], [0, 0], colr), V(p[3], [0, 0], colr), [0, 1, 0]);
    };
    for (let i = 0; i + 1 < n; i++) {
      if (R.under[i] || R.under[i + 1] || stairSeg[i]) continue;
      const sMid = (S[i].s + S[i + 1].s) / 2;
      if (inRanges(R.gaps.mark, sMid)) continue;
      const ch = coreHalf(i);
      const dash = (sMid % 256) < 136;
      if (lanes === 2 && dash) mark(i, -5, 5, centerCol);
      if (lanes >= 4) {
        mark(i, -12, -5, yellow); mark(i, 5, 12, yellow);
        if (dash) { mark(i, -ch / 2 - 4, -ch / 2 + 4, white); mark(i, ch / 2 - 4, ch / 2 + 4, white); }
      }
      if (!st.sidewalks) {
        if (!inRanges(R.gaps.L, sMid)) mark(i, -ch + 16, -ch + 25, white);
        if (!inRanges(R.gaps.R, sMid)) mark(i, ch - 25, ch - 16, white);
      }
    }
  }

  // boardwalk posts down to the ground
  if (st.deck) {
    for (let i = 0; i < n; i += 5) {
      if (R.under[i]) continue;
      for (const sg of [-1, 1]) {
        const p = at(i, sg * (hw(i) - 12), Y[i] + R.lift[i] - 20);
        const d = Math.max(40, R.drop[i] + 50);
        prism(mesh, 'beam', [p[0], p[1] - d, p[2]], { n: 4, r0: 11, r1: 11, h: d, col: [190, 150, 110], rot: Math.atan2(S[i].tz, S[i].tx) + Math.PI / 4, uvScale: 64, cap: false });
      }
    }
  }

  // ends: a round cap for paths, the end faces of everything else
  if (!S.closed) {
    for (const [end, j, dir] of [['start', 0, -1], ['end', n - 1, 1]]) {
      if (R.ends[end]) continue; // it joins another road there
      const i = end === 'start' ? 0 : n - 2;
      const capStyle = road.caps && road.caps !== 'auto' ? road.caps : st.caps;
      const depth = Math.max(12, R.drop[j] + 14);
      if (capStyle === 'round' && !raised && !st.sidewalks && !st.deck) {
        const s = S[j], c = P(i, j, 0, 0), h0 = hw(j), segs = 8;
        const [rx, rz] = rightOf(s);
        const pt = (a, k = 1) => [s.x + (rx * Math.cos(a) + s.tx * dir * Math.sin(a)) * h0 * k, c[1], s.z + (rz * Math.cos(a) + s.tz * dir * Math.sin(a)) * h0 * k];
        const uvp = (p) => [((p[0] - s.x) * rx + (p[2] - s.z) * rz) / ts, (s.s + ((p[0] - s.x) * s.tx + (p[2] - s.z) * s.tz)) / ts];
        for (let k = 0; k < segs; k++) {
          const a0 = (k / segs) * Math.PI, a1 = ((k + 1) / segs) * Math.PI;
          const p0 = pt(a0), p1 = pt(a1);
          mesh.tri(surf, V(c, uvp(c), C(1)), V(p0, uvp(p0), C(0.76)), V(p1, uvp(p1), C(0.76)), [0, 1, 0]);
          mesh.colTri(Pc(j, 0, 0), [p0[0], Pc(j, 0, 0)[1], p0[2]], [p1[0], Pc(j, 0, 0)[1], p1[2]], st.surf, [0, 1, 0]);
          if (st.fade) {
            const kf = 1 + st.fade / h0;
            const q0 = pt(a0, kf), q1 = pt(a1, kf);
            q0[1] -= 0.5; q1[1] -= 0.5;
            mesh.quad('fade', V(p0, uvp(p0), C(0.86), 255), V(q0, uvp(q0), C(0.86), 0), V(q1, uvp(q1), C(0.86), 0), V(p1, uvp(p1), C(0.86), 255), [0, 1, 0]);
          } else {
            const b0 = [p0[0], p0[1] - depth, p0[2]], b1 = [p1[0], p1[1] - depth, p1[2]];
            mesh.quad('skirt', V(b0, [a0, 0], C(0.62)), V(b1, [a1, 0], C(0.62)), V(p1, [a1, depth / ts], C(0.78)), V(p0, [a0, depth / ts], C(0.78)),
              [(p0[0] + p1[0]) / 2 - c[0], 0, (p0[2] + p1[2]) / 2 - c[2]]);
          }
        }
      } else {
        const base = H(i, j) + R.lift[j];
        if (st.sidewalks) {
          across('skirt', j, -coreHalf(j), coreHalf(j), base - depth, base, dir, { col: 0.66 });
          for (const sg of [-1, 1]) across('skirt', j, sg < 0 ? -hw(j) : coreHalf(j), sg < 0 ? -coreHalf(j) : hw(j), base - depth, base + curbH, dir, { col: 0.7 });
        } else if (st.deck) {
          across('beam', j, -hw(j), hw(j), base - 24, base, dir, { col: 0.76, collide: false });
        } else {
          across('skirt', j, -hw(j), hw(j), base - depth, base + raised, dir, { col: 0.68 });
        }
      }
    }
  }

  // fences, lamps and kerbs along the sides
  for (const [side, sg] of [['L', -1], ['R', 1]]) {
    const ls = side === 'L' ? road.left : road.right;
    if (!ls || !LINE_STYLES[ls]) continue;
    const off = (j) => sg * (hw(j) + (road.sideOffset ?? 24));
    const up = st.sidewalks ? curbH : raised;
    const runs = [];
    let cur = null;
    for (let j = 0; j < n; j++) {
      if (gapOn(side, j)) { if (cur && cur.pts.length > 1) runs.push(cur); cur = null; continue; }
      const i = Math.min(j, n - 2);
      (cur ||= { pts: [] }).pts.push(at(j, off(j), H(i, j) + up));
    }
    if (cur && cur.pts.length > 1) runs.push(cur);
    // lamps lean over the road: the road is on their right
    if (ls === 'lamps' && sg > 0) for (const r of runs) r.pts.reverse();
    buildLine(mesh, ls, runs, { scale: road.sideScale || 1 });
  }
  return mesh;
}

// ---- terrain: cut and fill under the roads (custom levels) ------------------------------------

// heights: engine terrain view (Int16Array), T: the level's Terrain (uncarved, JS side).
// Returns the cell rectangle touched, or null.
export function carveTerrain(heights, T, roads) {
  if (!roads.length) return null;
  let rect = null;
  const best = new Map(); // vertex index -> { d, y, w }
  for (const R of roads) {
    if (R.road.conform === false) continue;
    const st = R.st;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, maxHw = 0;
    for (const s of R.S) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); maxHw = Math.max(maxHw, s.w / 2); }
    const shoulder = 150, inner = 34;
    const pad = maxHw + inner + shoulder;
    const i0 = Math.max(0, Math.floor(T.gx(x0 - pad))), i1 = Math.min(T.nx, Math.ceil(T.gx(x1 + pad)));
    const j0 = Math.max(0, Math.floor(T.gz(z0 - pad))), j1 = Math.min(T.nz, Math.ceil(T.gz(z1 + pad)));
    if (i0 > i1 || j0 > j1) continue;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = T.wx(i), z = T.wz(j);
      const c = closestOnCurve(R.S, x, z);
      if (!c) continue;
      const hw = c.w / 2;
      if (c.d > hw + inner + shoulder) continue;
      // past the open ends the road stops: no trench beyond them
      if (!R.S.closed && ((c.i === 0 && c.f === 0) || (c.i === R.n - 2 && c.f === 1))) {
        const endS = c.i === 0 ? R.S[0] : R.S[R.n - 1];
        const along = (x - endS.x) * endS.tx + (z - endS.z) * endS.tz;
        if ((c.i === 0 && along < -hw * 0.6) || (c.i !== 0 && along > hw * 0.6)) continue;
      }
      // steps are drawn below the ramp line: the ground goes under the lowest tread
      const steep = (R.road.stairs ?? st.stairs) && Math.abs(R.Y[c.i + 1] - R.Y[c.i]) / Math.max(1, R.S[c.i + 1].s - R.S[c.i].s) > STAIR_GRADE;
      const y = lerp(R.Y[c.i], R.Y[c.i + 1], c.f) - (st.deck ? st.deck + 6 : steep ? STAIR_RISE * 0.6 + 6 : 2);
      const idx = T.idx(i, j);
      const prev = best.get(idx);
      if (!prev || c.d < prev.d) best.set(idx, { d: c.d, y, hw, deck: !!st.deck });
      rect = rect ? { i0: Math.min(rect.i0, i0), j0: Math.min(rect.j0, j0), i1: Math.max(rect.i1, i1), j1: Math.max(rect.j1, j1) } : { i0, j0, i1, j1 };
    }
  }
  for (const [idx, b] of best) {
    const orig = heights[idx];
    let v;
    if (b.d <= b.hw + 34) v = b.y;
    else v = lerp(b.y, orig, smooth01((b.d - b.hw - 34) / 150));
    // a boardwalk stands on posts: the ground only gets out of its way
    if (b.deck) v = Math.min(orig, v);
    heights[idx] = clamp(Math.round(v), -32000, 32000);
  }
  return rect;
}
