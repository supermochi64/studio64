// Collision with fewer triangles: a level's terrain has as many collision triangles as it draws, and
// on the N64 every one costs memory (48 bytes, and its grid cells) and time (Mario's floor and wall
// checks). Edges collapse (into one of their corners, so corners stay where they were) while the
// surface moves less than a tolerance from the original (quadric error), only within one kind of
// surface: the borders of the mesh and between kinds stay as they are, no triangle flips or turns
// from floor to wall to ceiling.

const NY_FLOOR = 0.01; // the game: a floor above, a ceiling below, a wall between

// tris: [{ v: [x0, y0, z0, x1, y1, z1, x2, y2, z2], type, force }] -> the same kind of list
export function simplifyCollision(tris, tolerance = 6) {
  const pos = [];
  const ids = new Map();
  const vid = (x, y, z) => {
    const k = `${x},${y},${z}`;
    if (!ids.has(k)) { ids.set(k, pos.length); pos.push([x, y, z]); }
    return ids.get(k);
  };
  const groupIds = new Map();
  const faces = [];
  for (const t of tris) {
    const a = vid(t.v[0], t.v[1], t.v[2]), b = vid(t.v[3], t.v[4], t.v[5]), c = vid(t.v[6], t.v[7], t.v[8]);
    if (a === b || b === c || a === c) continue;
    const g = `${t.type}:${t.force}`;
    if (!groupIds.has(g)) groupIds.set(g, groupIds.size);
    faces.push({ v: [a, b, c], g: groupIds.get(g), type: t.type, force: t.force, alive: true });
  }
  const n = pos.length;
  const vfaces = Array.from({ length: n }, () => new Set());
  faces.forEach((f, i) => { for (const v of f.v) vfaces[v].add(i); });

  // fixed corners: on the mesh's border, between kinds of surface, where the mesh is not a surface
  const locked = new Uint8Array(n);
  const edgeFaces = new Map();
  const ek = (a, b) => (a < b ? a * n + b : b * n + a);
  faces.forEach((f, i) => {
    for (let k = 0; k < 3; k++) {
      const key = ek(f.v[k], f.v[(k + 1) % 3]);
      if (!edgeFaces.has(key)) edgeFaces.set(key, []);
      edgeFaces.get(key).push(i);
    }
  });
  for (const [key, list] of edgeFaces) {
    if (list.length !== 2 || faces[list[0]].g !== faces[list[1]].g) { locked[Math.floor(key / n)] = 1; locked[key % n] = 1; }
  }
  for (let v = 0; v < n; v++) {
    let g = -1;
    for (const fi of vfaces[v]) { if (g < 0) g = faces[fi].g; else if (faces[fi].g !== g) { locked[v] = 1; break; } }
  }

  // quadrics (unweighted: the error is a distance to the original planes)
  const Q = Array.from({ length: n }, () => new Float64Array(10));
  const normalOf = (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    return len > 1e-9 ? [nx / len, ny / len, nz / len, len / 2] : null;
  };
  for (const f of faces) {
    const nn = normalOf(pos[f.v[0]], pos[f.v[1]], pos[f.v[2]]);
    if (!nn) continue;
    const [a, b, c] = nn, d = -(a * pos[f.v[0]][0] + b * pos[f.v[0]][1] + c * pos[f.v[0]][2]);
    const q = [a * a, a * b, a * c, a * d, b * b, b * c, b * d, c * c, c * d, d * d];
    for (const v of f.v) for (let k = 0; k < 10; k++) Q[v][k] += q[k];
  }
  const err = (q, p) => {
    const [x, y, z] = p;
    return q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9];
  };
  const kind = (ny) => (ny > NY_FLOOR ? 1 : ny < -NY_FLOOR ? -1 : 0);

  // the heap of collapses (u into v), stale entries skipped by the corners' versions
  const ver = new Uint32Array(n);
  const heap = [];
  const push = (cost, u, v) => {
    heap.push([cost, u, v, ver[u], ver[v]]);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const limit = tolerance * tolerance;
  const sumQ = (u, v) => { const q = new Float64Array(10); for (let k = 0; k < 10; k++) q[k] = Q[u][k] + Q[v][k]; return q; };
  const consider = (u, v) => {
    if (locked[u]) return;
    const cost = err(sumQ(u, v), pos[v]);
    if (cost <= limit) push(cost, u, v);
  };
  const neighbors = (v) => {
    const s = new Set();
    for (const fi of vfaces[v]) for (const w of faces[fi].v) if (w !== v) s.add(w);
    return s;
  };
  for (let v = 0; v < n; v++) for (const w of neighbors(v)) consider(v, w);

  // can u move to v? (a manifold stays one, every triangle keeps its side and kind)
  const canCollapse = (u, v) => {
    const shared = [...vfaces[u]].filter((fi) => faces[fi].v.includes(v));
    if (shared.length !== 2) return false;
    const opp = new Set(shared.map((fi) => faces[fi].v.find((w) => w !== u && w !== v)));
    const nu = neighbors(u), nv = neighbors(v);
    for (const w of nu) if (w !== v && nv.has(w) && !opp.has(w)) return false;
    for (const fi of vfaces[u]) {
      const f = faces[fi];
      if (f.v.includes(v)) continue;
      const before = normalOf(pos[f.v[0]], pos[f.v[1]], pos[f.v[2]]);
      const after = normalOf(...f.v.map((w) => pos[w === u ? v : w]));
      if (!before || !after || after[3] < 1) return false;
      if (before[0] * after[0] + before[1] * after[1] + before[2] * after[2] < 0.9) return false;
      if (kind(before[1]) !== kind(after[1])) return false;
    }
    return true;
  };

  let removed = 0;
  while (heap.length) {
    const [, u, v, vu, vv] = pop();
    if (ver[u] !== vu || ver[v] !== vv || locked[u] || !vfaces[u].size) continue;
    if (!canCollapse(u, v)) continue;
    for (const fi of [...vfaces[u]]) {
      const f = faces[fi];
      if (f.v.includes(v)) {
        f.alive = false;
        for (const w of f.v) vfaces[w].delete(fi);
        removed++;
      } else {
        f.v = f.v.map((w) => (w === u ? v : w));
        vfaces[v].add(fi);
      }
    }
    vfaces[u].clear();
    for (let k = 0; k < 10; k++) Q[v][k] += Q[u][k];
    ver[u]++;
    ver[v]++;
    for (const w of neighbors(v)) { ver[w]++; }
    for (const w of neighbors(v)) { consider(v, w); consider(w, v); for (const x of neighbors(w)) consider(w, x); }
  }

  void removed;
  return faces.filter((f) => f.alive).map((f) => ({ v: f.v.flatMap((w) => pos[w]), type: f.type, force: f.force }));
}
