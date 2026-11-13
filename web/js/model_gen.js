// AI-authored models: a model is a list of mesh "parts" (flat position/index arrays, like a
// minimal glTF primitive) coming straight from the create_model tool's arguments -- the model
// designs the geometry itself as plain numbers (something an LLM writes out reliably); this file
// turns that into an actual, valid .glb buffer, the same artifact a dropped file would be, so it
// can go through the ordinary import pipeline (importModel -> buildPackage -> encodePackage ->
// Assets.addModel) unchanged. See server/tools/assets.js (create_model) and
// registerRpc('asset_generate', ...) in assets.js.

export const MAX_PARTS = 64;
export const MAX_TRIS = 20000; // generous for a hand-built prop; keeps a bad request fast to reject

function parseHexColor(hex, fallback = [0.82, 0.82, 0.82]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// One part -> { positions, normals, colors, indices } (all flat arrays), fully resolved
// (computed smooth normals if none given, solid colour if no per-vertex colours given).
function resolvePart(part, index) {
  const positions = part.positions;
  if (!Array.isArray(positions) || positions.length < 9 || positions.length % 3 !== 0) {
    throw new Error(`part ${index + 1}: positions must be a flat x,y,z,... array, at least 3 vertices (got ${positions?.length || 0} numbers)`);
  }
  for (const v of positions) if (!Number.isFinite(v)) throw new Error(`part ${index + 1}: positions must all be finite numbers`);
  const vertCount = positions.length / 3;

  const indices = part.indices;
  if (!Array.isArray(indices) || indices.length < 3 || indices.length % 3 !== 0) {
    throw new Error(`part ${index + 1}: indices must be a flat array, 3 per triangle (got ${indices?.length || 0} numbers)`);
  }
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 0 || i >= vertCount) throw new Error(`part ${index + 1}: index ${i} is out of range for ${vertCount} vertices`);
  }

  let normals = part.normals;
  if (normals !== undefined) {
    if (!Array.isArray(normals) || normals.length !== positions.length) throw new Error(`part ${index + 1}: normals must have one x,y,z per vertex (${positions.length} numbers)`);
  } else {
    // smooth normals: sum each triangle's face normal into its three vertices, then normalize
    const acc = new Float64Array(positions.length);
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
      const pa = positions.slice(a * 3, a * 3 + 3), pb = positions.slice(b * 3, b * 3 + 3), pc = positions.slice(c * 3, c * 3 + 3);
      const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      for (const v of [a, b, c]) for (let k = 0; k < 3; k++) acc[v * 3 + k] += n[k];
    }
    normals = new Array(positions.length);
    for (let v = 0; v < vertCount; v++) {
      const x = acc[v * 3], y = acc[v * 3 + 1], z = acc[v * 3 + 2], len = Math.hypot(x, y, z) || 1;
      normals[v * 3] = x / len; normals[v * 3 + 1] = y / len; normals[v * 3 + 2] = z / len;
    }
  }

  let colors = part.colors;
  if (colors !== undefined) {
    if (!Array.isArray(colors) || (colors.length !== vertCount * 3 && colors.length !== vertCount * 4)) {
      throw new Error(`part ${index + 1}: colors must have one r,g,b (or r,g,b,a) per vertex`);
    }
    if (colors.length === vertCount * 3) { const c4 = new Array(vertCount * 4); for (let v = 0; v < vertCount; v++) { c4[v * 4] = colors[v * 3]; c4[v * 4 + 1] = colors[v * 3 + 1]; c4[v * 4 + 2] = colors[v * 3 + 2]; c4[v * 4 + 3] = 1; } colors = c4; }
  } else {
    const [r, g, b] = parseHexColor(part.color);
    colors = new Array(vertCount * 4);
    for (let v = 0; v < vertCount; v++) { colors[v * 4] = r; colors[v * 4 + 1] = g; colors[v * 4 + 2] = b; colors[v * 4 + 3] = 1; }
  }

  return { positions, normals, colors, indices };
}

// A cheap, length-only pass over the raw (unvalidated) parts: rejects an oversized request
// before any per-vertex work (normals, colour expansion, merging) is attempted on it. This has
// to run first -- building those arrays with .push(...bigArray) for something already too big
// to be reasonable can itself blow the engine's call-stack/argument limit, which would surface
// as a confusing "Maximum call stack size exceeded" instead of a clear "too many triangles".
function checkBudget(parts) {
  if (!Array.isArray(parts) || !parts.length) throw new Error('at least one part is required');
  if (parts.length > MAX_PARTS) throw new Error(`too many parts (${parts.length} > ${MAX_PARTS})`);
  let triCount = 0;
  for (const p of parts) triCount += Math.ceil((Array.isArray(p?.indices) ? p.indices.length : 0) / 3);
  if (triCount > MAX_TRIS) throw new Error(`too many triangles (${triCount} > ${MAX_TRIS}): simplify the mesh or split it into a simpler model`);
}

// Appends every element of src onto dst without spreading it as call arguments (dst.push(...src)
// can exceed the engine's argument-count limit for a large array -- see checkBudget above).
function appendAll(dst, src) { for (let i = 0; i < src.length; i++) dst.push(src[i]); }

/** Merges parts (each in its own local space -- the model author positions them directly in the
 * shared positions array) into one mesh and packs it into a minimal, self-contained .glb buffer
 * (one primitive, vertex-coloured, no textures). Returns a Uint8Array. Throws on anything that
 * doesn't look like a usable mesh (NaN/Infinity, out-of-range indices, empty parts, over budget). */
export function partsToGLB(parts, name = 'Model') {
  checkBudget(parts);

  const positions = [], normals = [], colors = [], indices = [];
  let vOffset = 0;
  for (let i = 0; i < parts.length; i++) {
    const r = resolvePart(parts[i], i);
    appendAll(positions, r.positions); appendAll(normals, r.normals); appendAll(colors, r.colors);
    for (const idx of r.indices) indices.push(idx + vOffset);
    vOffset += r.positions.length / 3;
  }

  const vertCount = positions.length / 3;
  const posBuf = Float32Array.from(positions), normBuf = Float32Array.from(normals), colorBuf = Float32Array.from(colors);
  const idxBuf = Uint32Array.from(indices);
  const bin = new Uint8Array(posBuf.byteLength + normBuf.byteLength + colorBuf.byteLength + idxBuf.byteLength);
  let off = 0;
  for (const arr of [posBuf, normBuf, colorBuf, idxBuf]) { bin.set(new Uint8Array(arr.buffer), off); off += arr.byteLength; }

  const bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let v = 0; v < vertCount; v++) for (let k = 0; k < 3; k++) {
    const x = positions[v * 3 + k];
    if (x < bbox.min[k]) bbox.min[k] = x;
    if (x > bbox.max[k]) bbox.max[k] = x;
  }

  const gltf = {
    asset: { version: '2.0', generator: 'studio64-create_model' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0, mode: 4 }] }],
    materials: [{ name: 'Material', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.75 } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vertCount, type: 'VEC3', min: bbox.min, max: bbox.max },
      { bufferView: 1, componentType: 5126, count: vertCount, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: vertCount, type: 'VEC4' },
      { bufferView: 3, componentType: 5125, count: idxBuf.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBuf.byteLength, target: 34962 },
      { buffer: 0, byteOffset: posBuf.byteLength, byteLength: normBuf.byteLength, target: 34962 },
      { buffer: 0, byteOffset: posBuf.byteLength + normBuf.byteLength, byteLength: colorBuf.byteLength, target: 34962 },
      { buffer: 0, byteOffset: posBuf.byteLength + normBuf.byteLength + colorBuf.byteLength, byteLength: idxBuf.byteLength, target: 34963 },
    ],
    buffers: [{ byteLength: bin.length }],
  };

  const enc = new TextEncoder();
  const jsonBytes = enc.encode(JSON.stringify(gltf));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = new Uint8Array(jsonBytes.length + jsonPad);
  jsonChunk.set(jsonBytes); jsonChunk.fill(0x20, jsonBytes.length); // pad with spaces (valid in JSON whitespace)

  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = new Uint8Array(bin.length + binPad);
  binChunk.set(bin);

  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonChunk.length, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonChunk, 20);
  const binHeaderOff = 20 + jsonChunk.length;
  dv.setUint32(binHeaderOff, binChunk.length, true); dv.setUint32(binHeaderOff + 4, 0x004e4942, true);
  out.set(binChunk, binHeaderOff + 8);
  return out;
}
