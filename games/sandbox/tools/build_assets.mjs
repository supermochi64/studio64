#!/usr/bin/env node
// Makes every asset of the game from code: textures, the city (chunk models, world.bin, the map),
// characters, vehicles, weapons. Output: assets/ (inputs of the ROM build: .glb -> .t3dm,
// .png -> .sprite, .bin as is). Run by the Makefile; `node tools/build_assets.mjs --stats` prints sizes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeTextures } from './textures.mjs';
import { City, WORLD, LINES, DMAP, GANG_OF, DISTRICT_NAMES } from './city.mjs';
import { Canvas } from './lib/png.mjs';
import { writeModels } from './models.mjs';
import { writeFonts } from './fonts.mjs';
import { buildAudio } from './audio.mjs';
import { buildSfx } from './sfx.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..', 'assets');
const stats = process.argv.includes('--stats');
fs.mkdirSync(path.join(OUT, 'city'), { recursive: true });
for (const f of fs.readdirSync(path.join(OUT, 'city'))) fs.rmSync(path.join(OUT, 'city', f));

const t0 = Date.now();
const textures = writeTextures(OUT);
writeFonts(path.join(OUT, 'fonts'));
const city = new City(64).build();

// ---- the chunk models ----
let tris = 0, maxTris = 0, files = 0;
const chunkFlags = new Uint8Array(WORLD.chunks * WORLD.chunks);
const GROUP_NAMES = ['q0', 'q1', 'q2', 'q3', 'f0', 'f1', 'f2', 'f3', 'n0', 'n1', 'n2', 'n3']; // src/stream.c draws them by these names
const prepare = (c, builder, shade) => {
  // shading baked into the vertex colours: walls darken toward the ground (the light the street and
  // the neighbours block), the way the console's games paint their levels
  if (shade) for (const g of builder.groups.values()) {
    for (let v = 0; v < g.pos.length / 3; v++) {
      if (Math.abs(g.nrm[v * 3 + 1]) > 0.6) continue;
      const x = g.pos[v * 3], y = g.pos[v * 3 + 1], z = g.pos[v * 3 + 2];
      const ground = Math.max(0, city.heightAt(x, z));
      const t = Math.max(0, Math.min(1, (y - ground) / 3.2)), f = 0.66 + 0.34 * t * t * (3 - 2 * t);
      for (let k = 0; k < 3; k++) g.col[v * 4 + k] *= Math.pow(f, 2.2); // (the colours are linear)
    }
  }
  // faces that look down at the ground from just above it can never be seen: drop them
  for (const g of builder.groups.values()) {
    const keep = [];
    for (let t = 0; t < g.idx.length; t += 3) {
      const [a, b, c] = [g.idx[t], g.idx[t + 1], g.idx[t + 2]];
      const ny = (g.nrm[a * 3 + 1] + g.nrm[b * 3 + 1] + g.nrm[c * 3 + 1]) / 3;
      if (ny < -0.7) {
        const low = [a, b, c].every((v) => g.pos[v * 3 + 1] <= Math.max(0, city.heightAt(g.pos[v * 3], g.pos[v * 3 + 2])) + 0.4);
        if (low) continue;
      }
      keep.push(a, b, c);
    }
    g.idx = keep;
  }
  // see-through materials last, so they blend over what is behind them
  const late = (mt) => mt.name === 'shadow' || mt.name === 'lightpool';
  builder.groups = new Map([...builder.groups.entries()].sort(([a], [b]) => late(a) - late(b)));
  // (vertices stay in world space: every chunk is drawn with one shared matrix, so the edges two chunks
  // share land on exactly the same pixels; the Makefile converts the city at 32 units a metre to fit)
  void c;
};
for (const c of city.chunks.values()) {
  const parts = c.detail.parts.map((b, i) => [GROUP_NAMES[i], b]).filter(([, b]) => !b.empty);
  if (parts.length) {
    let n = 0;
    for (const [name, b] of parts) { prepare(c, b, true); c.detail.g.mesh(name, b); n += b.triangleCount; }
    c.detail.g.save(path.join(OUT, 'city', `d${c.cx}_${c.cz}.glb`));
    files++; tris += n; maxTris = Math.max(maxTris, n);
    chunkFlags[c.cz * WORLD.chunks + c.cx] |= 1;
  }
  if (!c.lod.b.empty) {
    prepare(c, c.lod.b, false);
    c.lod.g.mesh('cl', c.lod.b);
    if (!c.lod.night.empty) { prepare(c, c.lod.night, false); c.lod.g.mesh('nl', c.lod.night); }
    c.lod.g.save(path.join(OUT, 'city', `l${c.cx}_${c.cz}.glb`));
    files++;
    chunkFlags[c.cz * WORLD.chunks + c.cx] |= 2;
  }
}

// ---- world.bin (big-endian, read by src/world.c) ----
class W {
  constructor() { this.buf = Buffer.alloc(8 << 20); this.o = 0; }
  u8(v) { this.buf.writeUInt8(v & 0xff, this.o); this.o += 1; }
  s16(v) { this.buf.writeInt16BE(Math.max(-32768, Math.min(32767, Math.round(v))), this.o); this.o += 2; }
  u16(v) { this.buf.writeUInt16BE(Math.max(0, Math.min(65535, Math.round(v))), this.o); this.o += 2; }
  u32(v) { this.buf.writeUInt32BE(v >>> 0, this.o); this.o += 4; }
  f32(v) { this.buf.writeFloatBE(v, this.o); this.o += 4; }
  str(s) { this.buf.write(s, this.o, 'latin1'); this.o += s.length; }
  align(n = 4) { while (this.o % n) this.u8(0); }
  done() { return this.buf.subarray(0, this.o); }
}
const w = new W();
w.str('SBW1');
w.s16(WORLD.min); w.u16(WORLD.size); w.u16(WORLD.chunk); w.u16(WORLD.chunks); w.u16(WORLD.hcell); w.u16(city.hn);
for (let i = 0; i < city.heights.length; i++) w.s16(city.heights[i] * 100);
for (let i = 0; i < city.ground.length; i++) w.u8(city.ground[i]);
w.align();
for (let i = 0; i < chunkFlags.length; i++) w.u8(chunkFlags[i]);
w.align();
// boxes
const boxes = city.boxes;
w.u32(boxes.length);
for (const b of boxes) {
  w.s16(b.cx * 10); w.s16(b.cz * 10); w.u16(b.hx * 100); w.u16(b.hz * 100);
  w.s16(b.y0 * 100); w.s16(b.y1 * 100); w.s16(b.r0 * 100); w.s16(b.r1 * 100);
  w.u8(Math.round((((b.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * 256)); w.u8(b.flags); w.u8(b.kind); w.u8(0);
}
// the box grid: 32 m cells over the world
const GS = 32, GN = Math.ceil(WORLD.size / GS);
const cells = Array.from({ length: GN * GN }, () => []);
boxes.forEach((b, i) => {
  const ext = b.yaw ? Math.hypot(b.hx, b.hz) : 0;
  const ex = b.yaw ? ext : b.hx, ez = b.yaw ? ext : b.hz;
  const i0 = Math.max(0, Math.floor((b.cx - ex - WORLD.min) / GS)), i1 = Math.min(GN - 1, Math.floor((b.cx + ex - WORLD.min) / GS));
  const j0 = Math.max(0, Math.floor((b.cz - ez - WORLD.min) / GS)), j1 = Math.min(GN - 1, Math.floor((b.cz + ez - WORLD.min) / GS));
  for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) cells[j * GN + k].push(i);
});
w.u16(GS); w.u16(GN);
let start = 0;
for (const c of cells) { w.u32(start); start += c.length; }
w.u32(start);
for (const c of cells) for (const i of c) w.u16(i);
w.align();
// streets
w.u16(city.streetNodes.length); w.u16(city.streetEdges.length);
for (const n of city.streetNodes) { w.s16(n.x * 10); w.s16(n.z * 10); w.u8(n.deg); w.u8(0); }
for (const e of city.streetEdges) { w.u16(e.a); w.u16(e.b); w.u8(e.lanes); w.u8(e.half * 10); w.u8({ grid: 0, local: 1, culdesac: 2 }[e.kind] ?? 0); w.u8(0); }
// sidewalks
w.u16(city.walkNodes.length); w.u16(city.walkEdges.length);
for (const n of city.walkNodes) { w.s16(n.x * 10); w.s16(n.z * 10); }
for (const e of city.walkEdges) { w.u16(e.a); w.u16(e.b); }
// spots
const blockOf = (x, z) => { let bx = -1, bz = -1; for (let i = 0; i < 9; i++) { if (x >= LINES[i] && x < LINES[i + 1]) bx = i; if (z >= LINES[i] && z < LINES[i + 1]) bz = i; } return bx < 0 || bz < 0 ? 255 : bz * 9 + bx; };
w.u16(city.spots.length);
for (const s of city.spots) { w.u8(s.type); w.u8(s.param); w.s16(s.x * 10); w.s16(s.z * 10); w.u8(Math.round((((s.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * 256)); w.u8(blockOf(s.x, s.z)); }
// districts: the 9x9 blocks, their kind and who holds them
for (let i = 0; i < 10; i++) w.s16(LINES[i]);
for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) w.u8(DMAP[j].charCodeAt(i));
for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) w.u8(GANG_OF[DMAP[j][i]] || 0);
w.align();
const world = w.done();
fs.writeFileSync(path.join(OUT, 'world.bin'), world);

// ---- the map ----
const map = city.drawMap(Canvas);
map.save(path.join(OUT, 'map.png'));
fs.writeFileSync(path.join(OUT, 'districts.json'), JSON.stringify({ names: DISTRICT_NAMES, map: DMAP }, null, 1));

// ---- characters, vehicles, weapons, effects ----
const models = writeModels(OUT);

const ms = Date.now() - t0;
console.log(`assets: ${textures.length} textures, ${files} chunk models (${tris} detailed triangles, at most ${maxTris} in a chunk), ${boxes.length} boxes, ${city.streetNodes.length}/${city.streetEdges.length} street nodes/edges, ${city.walkNodes.length}/${city.walkEdges.length} walk nodes/edges, ${city.spots.length} spots, world.bin ${(world.length / 1024).toFixed(0)} KB, ${models.length} models, ${ms} ms`);
if (stats) {
  const per = [...city.chunks.values()].map((c) => [`${c.cx},${c.cz}`, c.detail.parts.reduce((n, b) => n + b.triangleCount, 0), c.lod.b.triangleCount]).sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(per.map((p) => p.join(' ')).join('\n'));
}

// the music and voices (only when their sources changed: they take a few seconds)
{
  const src = ['audio.mjs', 'lib/synth.mjs'].map((f) => fs.statSync(path.join(HERE, f)).mtimeMs);
  const out = path.join(OUT, 'voices.bin');
  if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < Math.max(...src)) buildAudio(OUT);
}
buildSfx(OUT); // (quick: always)
