// 3D model importers: Wavefront OBJ (+ MTL), glTF 2.0 (.gltf + .bin, .glb) and
// binary FBX. Each turns the dropped files into one neutral scene:
//
//   { name, meshes: [{ positions, normals?, uvs?, colors?, indices, material }],
//     materials: [{ name, color: [r,g,b,a], image, alphaMode, alphaCutoff, doubleSided, wrapS, wrapT }],
//     upAxis: 'y' | 'z', unit: game units per file unit guess, warnings: [] }
//
// Node transforms are already applied (positions are in the file's world space).
// image is an ImageBitmap (or null); colors are 0..1.

const lower = (s) => String(s || '').toLowerCase();
const baseName = (p) => lower(String(p || '').replace(/\\/g, '/').split('/').pop());

// Files by lower-case base name, so "Textures\\Wood.PNG" finds wood.png.
function fileIndex(files) {
  const m = new Map();
  for (const f of files) m.set(baseName(f.name), f);
  return m;
}

async function bitmapFrom(blobOrFile) {
  try {
    return await createImageBitmap(blobOrFile, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  } catch {
    // some formats (TGA) need a decoder of our own
    const buf = new Uint8Array(await blobOrFile.arrayBuffer());
    const tga = decodeTGA(buf);
    if (tga) return createImageBitmap(new ImageData(tga.rgba, tga.w, tga.h));
    return null;
  }
}

// Uncompressed and RLE TGA (common in older OBJ/FBX packs).
function decodeTGA(b) {
  if (b.length < 18) return null;
  const idLen = b[0], cmapType = b[1], type = b[2], w = b[12] | (b[13] << 8), h = b[14] | (b[15] << 8), bpp = b[16], desc = b[17];
  if (cmapType !== 0 || ![2, 3, 10, 11].includes(type) || !w || !h || ![8, 24, 32].includes(bpp)) return null;
  const px = bpp / 8, rgba = new Uint8ClampedArray(w * h * 4);
  let p = 18 + idLen, i = 0;
  const put = (o) => {
    if (px === 1) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = b[o]; rgba[i * 4 + 3] = 255; } else {
      rgba[i * 4] = b[o + 2]; rgba[i * 4 + 1] = b[o + 1]; rgba[i * 4 + 2] = b[o]; rgba[i * 4 + 3] = px === 4 ? b[o + 3] : 255;
    }
    i++;
  };
  if (type === 2 || type === 3) { while (i < w * h && p + px <= b.length) { put(p); p += px; } } else {
    while (i < w * h && p < b.length) {
      const c = b[p++], n = (c & 127) + 1;
      if (c & 128) { for (let k = 0; k < n && i < w * h; k++) put(p); p += px; } else { for (let k = 0; k < n && i < w * h; k++) { put(p); p += px; } }
    }
  }
  if (!(desc & 0x20)) { // bottom-up: flip
    const row = w * 4, tmp = new Uint8ClampedArray(row);
    for (let y = 0; y < h >> 1; y++) {
      const a = y * row, c = (h - 1 - y) * row;
      tmp.set(rgba.subarray(a, a + row)); rgba.copyWithin(a, c, c + row); rgba.set(tmp, c);
    }
  }
  return { rgba, w, h };
}

const newMaterial = (name, extra = {}) => ({ name: name || 'material', color: [1, 1, 1, 1], image: null, imageName: null, alphaMode: 'OPAQUE', alphaCutoff: 0.5, doubleSided: false, wrapS: 'repeat', wrapT: 'repeat', ...extra });

// ---------------------------------------------------------------------------
// OBJ + MTL

function parseMTL(text) {
  const mats = new Map();
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const [key, ...rest] = line.split(/\s+/);
    const k = lower(key);
    if (k === 'newmtl') { cur = newMaterial(rest.join(' ')); mats.set(cur.name, cur); continue; }
    if (!cur) continue;
    if (k === 'kd') cur.color = [Number(rest[0]), Number(rest[1] ?? rest[0]), Number(rest[2] ?? rest[0]), cur.color[3]];
    else if (k === 'd') cur.color[3] = Number(rest[0]);
    else if (k === 'tr') cur.color[3] = 1 - Number(rest[0]);
    else if (k === 'map_kd') cur.imageName = rest.filter((x, i) => !(x.startsWith('-') || (i > 0 && rest[i - 1].startsWith('-')))).pop() || rest.pop();
    else if (k === 'map_d') cur.alphaMapName = rest.pop();
  }
  for (const m of mats.values()) if (m.color[3] < 0.999) m.alphaMode = 'BLEND';
  return mats;
}

async function importOBJ(file, files) {
  const text = await file.text();
  const idx = fileIndex(files);
  const pos = [], uv = [], nrm = [], col = [];
  const warnings = [];
  let mats = new Map();
  for (const m of text.matchAll(/^mtllib\s+(.+)$/gm)) {
    const f = idx.get(baseName(m[1].trim()));
    if (f) mats = new Map([...mats, ...parseMTL(await f.text())]);
    else warnings.push(`Material file ${m[1].trim()} was not dropped with the model (drop the .mtl and textures too).`);
  }
  const materials = [];
  const matIndex = new Map();
  const getMat = (name) => {
    if (!matIndex.has(name)) {
      matIndex.set(name, materials.length);
      materials.push(mats.get(name) ? { ...mats.get(name) } : newMaterial(name || 'default'));
    }
    return matIndex.get(name);
  };
  // one output mesh per material; vertices de-duplicated by (v, vt, vn)
  const meshes = new Map();
  let curMat = getMat('');
  const meshOf = (m) => {
    if (!meshes.has(m)) meshes.set(m, { positions: [], uvs: [], normals: [], colors: [], indices: [], material: m, keys: new Map(), hasUV: false, hasN: false, hasC: false });
    return meshes.get(m);
  };
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const c0 = raw.charCodeAt(0);
    if (c0 !== 118 && c0 !== 102 && c0 !== 117) continue; // v f u
    const parts = raw.trim().split(/\s+/);
    const k = parts[0];
    if (k === 'v') {
      pos.push(+parts[1], +parts[2], +parts[3]);
      if (parts.length >= 7) col.push(+parts[4], +parts[5], +parts[6]); else col.push(NaN, NaN, NaN);
    } else if (k === 'vt') uv.push(+parts[1], +(parts[2] ?? 0));
    else if (k === 'vn') nrm.push(+parts[1], +parts[2], +parts[3]);
    else if (k === 'usemtl') curMat = getMat(parts.slice(1).join(' '));
    else if (k === 'f') {
      const mesh = meshOf(curMat);
      const ids = [];
      for (let i = 1; i < parts.length; i++) {
        const key = parts[i];
        let id = mesh.keys.get(key);
        if (id === undefined) {
          const [vs, ts, ns] = key.split('/');
          let vi = parseInt(vs, 10); vi = vi < 0 ? pos.length / 3 + vi : vi - 1;
          id = mesh.positions.length / 3;
          mesh.positions.push(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]);
          if (!Number.isNaN(col[vi * 3])) { mesh.hasC = true; mesh.colors.push(col[vi * 3], col[vi * 3 + 1], col[vi * 3 + 2], 1); } else mesh.colors.push(1, 1, 1, 1);
          if (ts) { let ti = parseInt(ts, 10); ti = ti < 0 ? uv.length / 2 + ti : ti - 1; mesh.uvs.push(uv[ti * 2] ?? 0, 1 - (uv[ti * 2 + 1] ?? 0)); mesh.hasUV = true; } else mesh.uvs.push(0, 0);
          if (ns) { let ni = parseInt(ns, 10); ni = ni < 0 ? nrm.length / 3 + ni : ni - 1; mesh.normals.push(nrm[ni * 3] ?? 0, nrm[ni * 3 + 1] ?? 1, nrm[ni * 3 + 2] ?? 0); mesh.hasN = true; } else mesh.normals.push(0, 0, 0);
          mesh.keys.set(key, id);
        }
        ids.push(id);
      }
      for (let i = 1; i + 1 < ids.length; i++) mesh.indices.push(ids[0], ids[i], ids[i + 1]);
    }
  }
  for (const m of materials) {
    if (m.imageName) {
      const f = idx.get(baseName(m.imageName));
      if (f) m.image = await bitmapFrom(f);
      else warnings.push(`Texture ${m.imageName} (material ${m.name}) was not dropped with the model.`);
    }
  }
  const out = [];
  for (const mesh of meshes.values()) {
    if (!mesh.indices.length) continue;
    out.push({
      positions: new Float32Array(mesh.positions), indices: new Uint32Array(mesh.indices), material: mesh.material,
      uvs: mesh.hasUV ? new Float32Array(mesh.uvs) : null, normals: mesh.hasN ? new Float32Array(mesh.normals) : null,
      colors: mesh.hasC ? new Float32Array(mesh.colors) : null,
    });
  }
  return { name: file.name.replace(/\.[^.]+$/, ''), meshes: out, materials, upAxis: 'y', warnings };
}

// ---------------------------------------------------------------------------
// glTF 2.0 / GLB

const COMPONENTS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const WRAP = { 33071: 'clamp', 33648: 'mirror', 10497: 'repeat' };

function mat4Mul(a, b) {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
// column-major TRS (glTF convention)
function mat4TRS(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return new Float64Array([
    (1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ]);
}
const IDENT = () => new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function transformMesh(mesh, m) {
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    p[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    p[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    p[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  if (mesh.normals) {
    const n = mesh.normals;
    for (let i = 0; i < n.length; i += 3) {
      const x = n[i], y = n[i + 1], z = n[i + 2];
      let a = m[0] * x + m[4] * y + m[8] * z, b = m[1] * x + m[5] * y + m[9] * z, c = m[2] * x + m[6] * y + m[10] * z;
      const l = Math.hypot(a, b, c) || 1;
      n[i] = a / l; n[i + 1] = b / l; n[i + 2] = c / l;
    }
  }
  // a mirroring transform flips the winding
  const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
  if (det < 0) {
    const ix = mesh.indices;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  }
}

// A damaged or cut-off file says so, instead of a raw JSON parser message.
function parseJSON(bytes, file) {
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch {
    throw new Error(`${file.name} is damaged or not a glTF model (cut off while copying or downloading?). Export it again, or try .obj or .fbx.`);
  }
}

async function importGLTF(file, files) {
  const idx = fileIndex(files);
  const warnings = [];
  let json, bin = null;
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0x67 && buf[1] === 0x6c && buf[2] === 0x54 && buf[3] === 0x46) { // glTF binary
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let off = 12;
    while (off + 8 <= buf.length) {
      const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
      const chunk = buf.subarray(off + 8, off + 8 + len);
      if (type === 0x4e4f534a) json = parseJSON(chunk, file);
      else if (type === 0x004e4942) bin = chunk;
      off += 8 + len;
    }
  } else json = parseJSON(buf, file);
  if (!json) throw new Error(`${file.name} is not a glTF model`);
  if (json.extensionsRequired?.includes('KHR_draco_mesh_compression')) throw new Error('Draco-compressed glTF is not supported: export without mesh compression');
  if (json.extensionsRequired?.includes('EXT_meshopt_compression')) throw new Error('meshopt-compressed glTF is not supported: export without compression');

  const buffers = await Promise.all((json.buffers || []).map(async (b, i) => {
    if (b.uri === undefined) return bin;
    if (b.uri.startsWith('data:')) return new Uint8Array(await (await fetch(b.uri)).arrayBuffer());
    const f = idx.get(baseName(decodeURIComponent(b.uri)));
    if (!f) throw new Error(`buffer ${b.uri} is missing: drop the .bin file together with the .gltf`);
    return new Uint8Array(await f.arrayBuffer());
  }));
  const viewBytes = (vi) => {
    const v = json.bufferViews[vi];
    const b = buffers[v.buffer];
    return { bytes: b.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength), stride: v.byteStride || 0 };
  };
  const accessor = (ai) => {
    const a = json.accessors[ai];
    const n = NCOMP[a.type], T = COMPONENTS[a.componentType];
    const out = new Float32Array(a.count * n);
    if (a.bufferView === undefined) return out;
    const { bytes, stride } = viewBytes(a.bufferView);
    const es = T.BYTES_PER_ELEMENT;
    const st = stride || n * es;
    const dv = new DataView(bytes.buffer, bytes.byteOffset + (a.byteOffset || 0));
    const get = {
      5120: (o) => dv.getInt8(o), 5121: (o) => dv.getUint8(o), 5122: (o) => dv.getInt16(o, true), 5123: (o) => dv.getUint16(o, true),
      5125: (o) => dv.getUint32(o, true), 5126: (o) => dv.getFloat32(o, true),
    }[a.componentType];
    const norm = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] : 0;
    for (let i = 0; i < a.count; i++) {
      for (let k = 0; k < n; k++) {
        let v = get(i * st + k * es);
        if (norm) v = Math.max(-1, v / norm);
        out[i * n + k] = v;
      }
    }
    return out;
  };
  const images = await Promise.all((json.images || []).map(async (im) => {
    try {
      if (im.bufferView !== undefined) return await bitmapFrom(new Blob([viewBytes(im.bufferView).bytes], { type: im.mimeType || 'image/png' }));
      if (im.uri?.startsWith('data:')) return await bitmapFrom(await (await fetch(im.uri)).blob());
      const f = im.uri && idx.get(baseName(decodeURIComponent(im.uri)));
      if (f) return await bitmapFrom(f);
      warnings.push(`Texture ${im.uri} was not dropped with the model.`);
    } catch (e) { warnings.push(`A texture could not be read (${e.message}).`); }
    return null;
  }));
  const materials = (json.materials || []).map((m, i) => {
    const pbr = m.pbrMetallicRoughness || {};
    const ti = pbr.baseColorTexture?.index;
    const t = ti !== undefined ? json.textures?.[ti] : null;
    const samp = t?.sampler !== undefined ? json.samplers?.[t.sampler] : null;
    const src = t ? (t.source ?? t.extensions?.EXT_texture_webp?.source ?? t.extensions?.KHR_texture_basisu?.source) : undefined;
    const unlit = !!m.extensions?.KHR_materials_unlit;
    return newMaterial(m.name || `material ${i + 1}`, {
      color: pbr.baseColorFactor ? [...pbr.baseColorFactor] : [1, 1, 1, 1],
      image: src !== undefined ? images[src] : null,
      alphaMode: m.alphaMode || 'OPAQUE', alphaCutoff: m.alphaCutoff ?? 0.5, doubleSided: !!m.doubleSided,
      wrapS: WRAP[samp?.wrapS] || 'repeat', wrapT: WRAP[samp?.wrapT] || 'repeat', unlit,
    });
  });
  const defaultMat = () => {
    if (materials.defaultIndex === undefined) { materials.defaultIndex = materials.length; materials.push(newMaterial('default')); }
    return materials.defaultIndex;
  };

  const meshes = [];
  const visit = (ni, parent) => {
    const node = json.nodes[ni];
    const local = node.matrix ? new Float64Array(node.matrix) : mat4TRS(node.translation, node.rotation, node.scale);
    const world = mat4Mul(parent, local);
    if (node.mesh !== undefined) {
      for (const prim of json.meshes[node.mesh].primitives) {
        const mode = prim.mode ?? 4;
        if (![4, 5, 6].includes(mode)) continue; // points and lines
        const at = prim.attributes;
        if (at.POSITION === undefined) continue;
        const positions = accessor(at.POSITION);
        const count = positions.length / 3;
        let indices = prim.indices !== undefined ? Uint32Array.from(accessor(prim.indices)) : Uint32Array.from({ length: count }, (_, i) => i);
        if (mode === 5 || mode === 6) {
          const tri = [];
          for (let i = 2; i < indices.length; i++) {
            if (mode === 5) tri.push(...(i % 2 ? [indices[i - 1], indices[i - 2], indices[i]] : [indices[i - 2], indices[i - 1], indices[i]]));
            else tri.push(indices[0], indices[i - 1], indices[i]);
          }
          indices = Uint32Array.from(tri);
        }
        let colors = null;
        if (at.COLOR_0 !== undefined) {
          const c = accessor(at.COLOR_0);
          const n = NCOMP[json.accessors[at.COLOR_0].type];
          colors = new Float32Array(count * 4);
          for (let i = 0; i < count; i++) {
            colors[i * 4] = c[i * n]; colors[i * 4 + 1] = c[i * n + 1]; colors[i * 4 + 2] = c[i * n + 2]; colors[i * 4 + 3] = n === 4 ? c[i * n + 3] : 1;
          }
        }
        const mesh = {
          positions, indices, material: prim.material ?? defaultMat(),
          normals: at.NORMAL !== undefined ? accessor(at.NORMAL) : null,
          uvs: at.TEXCOORD_0 !== undefined ? accessor(at.TEXCOORD_0) : null,
          colors,
        };
        transformMesh(mesh, world);
        meshes.push(mesh);
      }
    }
    for (const c of node.children || []) visit(c, world);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  const roots = scene ? scene.nodes : (json.nodes || []).map((_, i) => i);
  for (const r of roots || []) visit(r, IDENT());
  if (json.skins?.length) warnings.push('Skinned meshes are imported in their rest pose (no bones or animation).');
  return { name: file.name.replace(/\.[^.]+$/, ''), meshes, materials, upAxis: 'y', unit: 100, warnings };
}

// ---------------------------------------------------------------------------
// FBX (binary). Geometry, UVs, vertex colours, materials (diffuse colour and
// texture, embedded or dropped next to the file), the model hierarchy.

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

async function parseFBXBinary(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const version = dv.getUint32(23, true);
  const wide = version >= 7500;
  const td = new TextDecoder();
  let pos = 27;
  const u = () => { const v = wide ? Number(dv.getBigUint64(pos, true)) : dv.getUint32(pos, true); pos += wide ? 8 : 4; return v; };
  const readArray = async (type) => {
    const len = dv.getUint32(pos, true), enc = dv.getUint32(pos + 4, true), clen = dv.getUint32(pos + 8, true);
    pos += 12;
    let bytes = buf.subarray(pos, pos + clen);
    pos += clen;
    if (enc === 1) bytes = await inflate(bytes);
    const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = type === 'd' || type === 'f' ? new Float64Array(len) : new Float64Array(len);
    for (let i = 0; i < len; i++) {
      out[i] = type === 'd' ? d.getFloat64(i * 8, true) : type === 'f' ? d.getFloat32(i * 4, true) : type === 'i' ? d.getInt32(i * 4, true)
        : type === 'l' ? Number(d.getBigInt64(i * 8, true)) : d.getUint8(i);
    }
    return out;
  };
  const readNode = async () => {
    const end = u(), nprops = u();
    u(); // property list length
    const nameLen = dv.getUint8(pos); pos += 1;
    if (end === 0) return null;
    const name = td.decode(buf.subarray(pos, pos + nameLen)); pos += nameLen;
    const props = [];
    for (let i = 0; i < nprops; i++) {
      const t = String.fromCharCode(dv.getUint8(pos)); pos += 1;
      switch (t) {
        case 'Y': props.push(dv.getInt16(pos, true)); pos += 2; break;
        case 'C': props.push(!!dv.getUint8(pos)); pos += 1; break;
        case 'I': props.push(dv.getInt32(pos, true)); pos += 4; break;
        case 'F': props.push(dv.getFloat32(pos, true)); pos += 4; break;
        case 'D': props.push(dv.getFloat64(pos, true)); pos += 8; break;
        case 'L': props.push(Number(dv.getBigInt64(pos, true))); pos += 8; break;
        case 'S': { const l = dv.getUint32(pos, true); pos += 4; props.push(td.decode(buf.subarray(pos, pos + l))); pos += l; break; }
        case 'R': { const l = dv.getUint32(pos, true); pos += 4; props.push(buf.slice(pos, pos + l)); pos += l; break; }
        default: props.push(await readArray(t));
      }
    }
    const children = [];
    while (pos < end) {
      const c = await readNode();
      if (!c) break;
      children.push(c);
    }
    pos = end;
    return { name, props, children };
  };
  const root = [];
  while (pos < buf.length - 160) {
    const n = await readNode();
    if (!n) break;
    root.push(n);
  }
  return root;
}

const child = (n, name) => n?.children.find((c) => c.name === name);
const props70 = (n) => {
  const out = {};
  for (const p of child(n, 'Properties70')?.children || []) out[p.props[0]] = p.props.slice(4);
  return out;
};

function eulerXYZ(deg) {
  const [x, y, z] = deg.map((d) => (d * Math.PI) / 180);
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  // R = Rz * Ry * Rx (column-major)
  return new Float64Array([
    cy * cz, cy * sz, -sy, 0,
    sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy, 0,
    cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy, 0,
    0, 0, 0, 1,
  ]);
}

async function importFBX(file, files) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const magic = new TextDecoder().decode(buf.subarray(0, 18));
  if (magic !== 'Kaydara FBX Binary') throw new Error('only binary FBX files can be imported: export as binary FBX (or glTF)');
  const idx = fileIndex(files);
  const warnings = [];
  const root = await parseFBXBinary(buf);
  const objects = root.find((n) => n.name === 'Objects');
  const conns = root.find((n) => n.name === 'Connections')?.children || [];
  const settings = props70(root.find((n) => n.name === 'GlobalSettings'));
  const upAxis = settings.UpAxis?.[0] === 2 ? 'z' : 'y';
  const unitCm = settings.UnitScaleFactor?.[0] ?? 1; // file unit in cm
  const byId = new Map();
  for (const o of objects?.children || []) byId.set(o.props[0], o);
  const parents = new Map(), childrenOf = new Map();
  for (const c of conns) {
    const [kind, from, to, prop] = c.props;
    if (!parents.has(from)) parents.set(from, []);
    parents.get(from).push({ to, prop, kind });
    if (!childrenOf.has(to)) childrenOf.set(to, []);
    childrenOf.get(to).push({ from, prop, kind });
  }
  const kids = (id, type) => (childrenOf.get(id) || []).map((c) => byId.get(c.from)).filter((o) => o && o.name === type);

  // materials and their textures
  const matCache = new Map();
  const materialOf = async (mo) => {
    if (matCache.has(mo.props[0])) return matCache.get(mo.props[0]);
    const p = props70(mo);
    const m = newMaterial(String(mo.props[1]).split('\0')[0] || 'material');
    const dc = p.DiffuseColor || p.Diffuse;
    if (dc) m.color = [dc[0], dc[1], dc[2], 1];
    if (p.Opacity) m.color[3] = p.Opacity[0];
    if (p.TransparencyFactor && p.TransparencyFactor[0] > 0 && p.TransparencyFactor[0] < 1) m.color[3] = 1 - p.TransparencyFactor[0];
    if (m.color[3] < 0.999) m.alphaMode = 'BLEND';
    const tex = (childrenOf.get(mo.props[0]) || []).filter((c) => /Diffuse|Base/i.test(c.prop || '')).map((c) => byId.get(c.from)).find((o) => o?.name === 'Texture')
      || kids(mo.props[0], 'Texture')[0];
    if (tex) {
      const fname = child(tex, 'RelativeFilename')?.props[0] || child(tex, 'FileName')?.props[0] || '';
      const video = kids(tex.props[0], 'Video')[0];
      const content = video && child(video, 'Content')?.props[0];
      if (content instanceof Uint8Array && content.length > 16) m.image = await bitmapFrom(new Blob([content]));
      else if (idx.get(baseName(fname))) m.image = await bitmapFrom(idx.get(baseName(fname)));
      else if (fname) warnings.push(`Texture ${baseName(fname)} was not dropped with the model.`);
      m.imageName = baseName(fname);
    }
    matCache.set(mo.props[0], m);
    return m;
  };

  const localMatrix = (model) => {
    const p = props70(model);
    const T = p['Lcl Translation'] || [0, 0, 0], R = p['Lcl Rotation'] || [0, 0, 0], S = p['Lcl Scaling'] || [1, 1, 1];
    const pre = p.PreRotation || [0, 0, 0];
    let m = mat4TRS(T, [0, 0, 0, 1], [1, 1, 1]);
    m = mat4Mul(m, eulerXYZ(pre));
    m = mat4Mul(m, eulerXYZ(R));
    m = mat4Mul(m, mat4TRS([0, 0, 0], [0, 0, 0, 1], S));
    return m;
  };
  const worldMatrix = (model) => {
    let m = localMatrix(model);
    let cur = model;
    for (let guard = 0; guard < 64; guard++) {
      const up = (parents.get(cur.props[0]) || []).map((x) => byId.get(x.to)).find((o) => o?.name === 'Model');
      if (!up) break;
      m = mat4Mul(localMatrix(up), m);
      cur = up;
    }
    return m;
  };

  const materials = [];
  const matIndex = new Map();
  const meshes = [];
  for (const geo of (objects?.children || []).filter((o) => o.name === 'Geometry' && o.props[2] === 'Mesh')) {
    const verts = child(geo, 'Vertices')?.props[0];
    const pvi = child(geo, 'PolygonVertexIndex')?.props[0];
    if (!verts || !pvi) continue;
    const layer = (name) => child(geo, name);
    const elem = (name, dataName, idxName) => {
      const l = layer(name);
      if (!l) return null;
      return { map: child(l, 'MappingInformationType')?.props[0], ref: child(l, 'ReferenceInformationType')?.props[0], data: child(l, dataName)?.props[0], index: child(l, idxName)?.props[0] };
    };
    const nrm = elem('LayerElementNormal', 'Normals', 'NormalsIndex');
    const uvE = elem('LayerElementUV', 'UV', 'UVIndex');
    const colE = elem('LayerElementColor', 'Colors', 'ColorIndex');
    const matE = elem('LayerElementMaterial', 'Materials', null);
    const pick = (e, n, pvIndex, cpIndex, polyIndex) => {
      if (!e?.data) return null;
      let i = /ByPolygonVertex/.test(e.map) ? pvIndex : /ByPolygon$/.test(e.map) ? polyIndex : /AllSame/.test(e.map) ? 0 : cpIndex;
      if (/Index/.test(e.ref || '') && e.index) i = e.index[i];
      return Array.from(e.data.subarray(i * n, i * n + n));
    };
    // models using this geometry
    const models = (parents.get(geo.props[0]) || []).map((x) => byId.get(x.to)).filter((o) => o?.name === 'Model');
    for (const model of models.length ? models : [null]) {
      const mats = model ? kids(model.props[0], 'Material') : [];
      const slot = [];
      for (const mo of mats) {
        if (!matIndex.has(mo.props[0])) { matIndex.set(mo.props[0], materials.length); materials.push(await materialOf(mo)); }
        slot.push(matIndex.get(mo.props[0]));
      }
      if (!slot.length) {
        if (!matIndex.has('default')) { matIndex.set('default', materials.length); materials.push(newMaterial('default')); }
        slot.push(matIndex.get('default'));
      }
      const perMat = new Map();
      const out = (mi) => {
        if (!perMat.has(mi)) perMat.set(mi, { positions: [], normals: [], uvs: [], colors: [], indices: [], material: slot[mi] ?? slot[0] });
        return perMat.get(mi);
      };
      let poly = [], polyIndex = 0;
      for (let k = 0; k < pvi.length; k++) {
        let cp = pvi[k];
        const last = cp < 0;
        if (last) cp = ~cp;
        poly.push({ cp, pv: k });
        if (!last) continue;
        const mi = matE ? (pick(matE, 1, 0, 0, polyIndex)?.[0] ?? 0) : 0;
        const mesh = out(mi);
        const base = mesh.positions.length / 3;
        for (const { cp: c, pv } of poly) {
          mesh.positions.push(verts[c * 3], verts[c * 3 + 1], verts[c * 3 + 2]);
          const n = pick(nrm, 3, pv, c, polyIndex) || [0, 0, 0];
          mesh.normals.push(...n);
          const t = pick(uvE, 2, pv, c, polyIndex) || [0, 0];
          mesh.uvs.push(t[0], 1 - t[1]);
          const col = pick(colE, 4, pv, c, polyIndex) || [1, 1, 1, 1];
          mesh.colors.push(...col);
        }
        for (let i = 1; i + 1 < poly.length; i++) mesh.indices.push(base, base + i, base + i + 1);
        poly = [];
        polyIndex++;
      }
      const wm = model ? worldMatrix(model) : IDENT();
      for (const m of perMat.values()) {
        const mesh = {
          positions: new Float32Array(m.positions), indices: new Uint32Array(m.indices), material: m.material,
          normals: nrm ? new Float32Array(m.normals) : null, uvs: uvE ? new Float32Array(m.uvs) : null, colors: colE ? new Float32Array(m.colors) : null,
        };
        transformMesh(mesh, wm);
        meshes.push(mesh);
      }
    }
  }
  if (!meshes.length) throw new Error('no meshes found in this FBX file');
  return { name: file.name.replace(/\.[^.]+$/, ''), meshes, materials, upAxis, unit: unitCm, warnings };
}

// ---------------------------------------------------------------------------

export const MODEL_EXTS = ['obj', 'gltf', 'glb', 'fbx', 'zip'];
export const isModelFile = (f) => MODEL_EXTS.includes(lower(f.name).split('.').pop());

// The files inside a .zip (models from Sketchfab and friends come zipped).
export async function unzip(file) {
  const b = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error(`${file.name} is not a zip file`);
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let n = 0; n < count && p + 46 <= b.length; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || /(^|\/)(__MACOSX|\.)/.test(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    let data = b.subarray(start, start + csize);
    if (method === 8) {
      const ds = new DecompressionStream('deflate-raw');
      data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer());
    } else if (method !== 0) continue;
    out.push(new File([data], name.split('/').pop()));
  }
  return out;
}

// The dropped files -> one scene (the first model file among them).
export async function importModel(fileList) {
  let files = Array.from(fileList);
  for (const z of files.filter((f) => /\.zip$/i.test(f.name))) files = files.filter((f) => f !== z).concat(await unzip(z));
  const main = files.find((f) => /\.(glb|gltf)$/i.test(f.name)) || files.find((f) => /\.fbx$/i.test(f.name)) || files.find((f) => /\.obj$/i.test(f.name));
  if (!main) throw new Error('drop a .obj, .gltf, .glb or .fbx file (with its textures)');
  const ext = lower(main.name).split('.').pop();
  let scene;
  try {
    scene = ext === 'obj' ? await importOBJ(main, files) : ext === 'fbx' ? await importFBX(main, files) : await importGLTF(main, files);
  } catch (err) {
    // reading past the end of the data: the file is cut off (a raw "Offset is outside the bounds of the DataView" helps nobody)
    if (err instanceof RangeError) throw new Error(`${main.name} is damaged: it ends too early (cut off while copying or downloading?). Export it again.`);
    throw err;
  }
  scene.format = ext;
  scene.sourceSize = files.reduce((s, f) => s + f.size, 0);
  let tris = 0;
  for (const m of scene.meshes) tris += m.indices.length / 3;
  scene.tris = tris;
  if (!tris) throw new Error('the model has no triangles');
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const m of scene.meshes) {
    const P = m.positions || [];
    for (let i = 0; i < P.length; i++) if (Number.isFinite(P[i])) { const a = i % 3; if (P[i] < lo[a]) lo[a] = P[i]; if (P[i] > hi[a]) hi[a] = P[i]; }
  }
  if (!(Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) > 1e-6)) throw new Error('the model has no size: all its points are in one place');
  return scene;
}
