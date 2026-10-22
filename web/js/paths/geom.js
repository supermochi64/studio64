// Roads & nature: geometry helpers (splines, arc-length sampling, closest points, noise).
// Pure math, no engine access, so the builders run the same in the studio and the player.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// Deterministic random numbers (mulberry32) and a hash for per-instance variation.
export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash2(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
export function noise2(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

// ---- splines --------------------------------------------------------------------------

// Control points [{x, y, z, w}] -> a dense polyline. Smooth: centripetal Catmull-Rom (no loops
// or cusps on uneven spacing); otherwise straight segments. Each dense point knows its segment.
function densify(pts, closed, smooth, per = 20) {
  const n = pts.length;
  const out = [];
  if (n === 0) return out;
  if (n === 1) return [{ ...pts[0], seg: 0, u: 0 }];
  const segs = closed ? n : n - 1;
  const at = (i) => pts[closed ? ((i % n) + n) % n : clamp(i, 0, n - 1)];
  for (let s = 0; s < segs; s++) {
    const p1 = at(s), p2 = at(s + 1);
    // ends of an open curve: mirror the neighbour so the tangent follows the first/last segment
    const p0 = !closed && s === 0 ? { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y, z: 2 * p1.z - p2.z, w: p1.w } : at(s - 1);
    const p3 = !closed && s === segs - 1 ? { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y, z: 2 * p2.z - p1.z, w: p2.w } : at(s + 2);
    const len = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const steps = smooth ? Math.max(4, Math.min(per * 3, Math.ceil(len / 24))) : 1;
    for (let k = 0; k < steps; k++) {
      const u = k / steps;
      out.push(smooth ? { ...catmull(p0, p1, p2, p3, u), seg: s, u } : { x: lerp(p1.x, p2.x, u), y: lerp(p1.y, p2.y, u), z: lerp(p1.z, p2.z, u), w: lerp(p1.w, p2.w, u), seg: s, u });
    }
  }
  if (closed) out.push({ ...at(0), seg: segs - 1, u: 1 });
  else out.push({ ...at(n - 1), seg: segs - 1, u: 1 });
  return out;
}

function catmull(p0, p1, p2, p3, u) {
  // centripetal parameterisation (alpha 0.5) in the ground plane
  const d = (a, b) => Math.max(1e-3, Math.sqrt(Math.hypot(b.x - a.x, b.z - a.z)));
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const t = lerp(t1, t2, u);
  const f = (k) => {
    const A1 = ((t1 - t) / (t1 - t0)) * p0[k] + ((t - t0) / (t1 - t0)) * p1[k];
    const A2 = ((t2 - t) / (t2 - t1)) * p1[k] + ((t - t1) / (t2 - t1)) * p2[k];
    const A3 = ((t3 - t) / (t3 - t2)) * p2[k] + ((t - t2) / (t3 - t2)) * p3[k];
    const B1 = ((t2 - t) / (t2 - t0)) * A1 + ((t - t0) / (t2 - t0)) * A2;
    const B2 = ((t3 - t) / (t3 - t1)) * A2 + ((t - t1) / (t3 - t1)) * A3;
    return ((t2 - t) / (t2 - t1)) * B1 + ((t - t1) / (t2 - t1)) * B2;
  };
  // height and width ease between the two points (no overshoot)
  const e = u * u * (3 - 2 * u);
  return { x: f('x'), z: f('z'), y: lerp(p1.y, p2.y, e), w: lerp(p1.w, p2.w, e) };
}

// Samples every `step` units of ground distance along the curve: [{ x, y, z, w, s, tx, tz, seg }]
// (s = distance from the start, t = unit tangent in the ground plane).
export function sampleCurve(points, { closed = false, smooth = true, step = 32, width = 300 } = {}) {
  const pts = points.map((p) => ({ x: p[0], y: p[1], z: p[2], w: p[3] || width }));
  if (pts.length < 2) return [];
  const dense = densify(pts, closed && pts.length > 2, smooth);
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z));
  const total = cum[cum.length - 1];
  if (total < 1) return [];
  const n = Math.max(1, Math.round(total / step));
  const out = [];
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const s = (total * i) / n;
    while (j < dense.length - 2 && cum[j + 1] < s) j++;
    const a = dense[j], b = dense[j + 1];
    const f = cum[j + 1] > cum[j] ? (s - cum[j]) / (cum[j + 1] - cum[j]) : 0;
    out.push({ x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), z: lerp(a.z, b.z, f), w: lerp(a.w, b.w, f), s, seg: f < 0.999 ? a.seg : b.seg });
  }
  // tangents (central differences; a closed curve wraps)
  const loop = closed && points.length > 2;
  for (let i = 0; i < out.length; i++) {
    const a = out[i === 0 ? (loop ? out.length - 2 : 0) : i - 1];
    const b = out[i === out.length - 1 ? (loop ? 1 : i) : i + 1];
    let tx = b.x - a.x, tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    out[i].tx = tx / l; out[i].tz = tz / l;
  }
  out.total = total;
  out.closed = loop;
  return out;
}

// Right-hand side of a tangent in the ground plane, seen from above (x right, z down the screen).
export const rightOf = (s) => [-s.tz, s.tx];

// Closest point of a sampled curve to (x, z): { i, f, d, x, z, s } (segment i..i+1 at fraction f).
export function closestOnCurve(samples, x, z) {
  let best = null;
  for (let i = 0; i + 1 < samples.length; i++) {
    const a = samples[i], b = samples[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    const f = clamp(((x - a.x) * dx + (z - a.z) * dz) / L2, 0, 1);
    const px = a.x + dx * f, pz = a.z + dz * f;
    const d = Math.hypot(x - px, z - pz);
    if (!best || d < best.d) best = { i, f, d, x: px, z: pz, s: lerp(a.s, b.s, f), y: lerp(a.y, b.y, f), w: lerp(a.w, b.w, f) };
  }
  return best;
}

// Where two segments cross in the ground plane: { ta, tb } (fractions) or null.
export function segCross(a0, a1, b0, b1) {
  const rx = a1.x - a0.x, rz = a1.z - a0.z, sx = b1.x - b0.x, sz = b1.z - b0.z;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-6) return null;
  const qx = b0.x - a0.x, qz = b0.z - a0.z;
  const ta = (qx * sz - qz * sx) / den, tb = (qx * rz - qz * rx) / den;
  return ta >= 0 && ta <= 1 && tb >= 0 && tb <= 1 ? { ta, tb } : null;
}

// Interpolated value of a per-sample array (cached heights) at sample count n.
export function resample(arr, n) {
  if (!arr?.length) return null;
  if (arr.length === n) return arr;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1)) * (arr.length - 1);
    const k = Math.floor(t), f = t - k;
    out[i] = lerp(arr[k], arr[Math.min(arr.length - 1, k + 1)], f);
  }
  return out;
}

// Ranges [s0, s1] merged and sorted.
export function mergeRanges(list) {
  const r = list.filter((x) => x[1] > x[0]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const x of r) {
    if (out.length && x[0] <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], x[1]);
    else out.push([...x]);
  }
  return out;
}
export const inRanges = (ranges, s) => ranges.some((r) => s >= r[0] && s <= r[1]);
