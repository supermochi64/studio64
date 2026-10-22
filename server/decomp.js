// Decomp export: the objects and pipe warps a hack adds to the original levels, as level
// script commands for the SM64 decompilation (github.com/n64decomp/sm64), to build a real ROM.
//
// For every edited original area: levels/<level>/studio_area_<n>.inc.c with one sub-script
// (WARP_NODE + OBJECT commands, RETURN) and notes for what a script cannot express (removed
// originals, blocks, terrain, sculpting, scaled objects). README.txt says where it goes.
import { zipWrite } from './zip.js';
import { catalog, getEntry } from './catalog.js';

const deg = (v) => Math.round(((((v | 0) % 65536) + 65536) % 65536) / 65536 * 360) % 360;
const hex = (v) => `0x${((v >>> 0) || 0).toString(16).padStart(8, '0').toUpperCase()}`;
const pad = (s, n) => String(s).padEnd(n);
const NOT_DECOMP = /^(sms|sg|kt|vehicle|tokyo):/; // Sunshine characters, Shotgun Mario's objects, Katana Mario's, cars and races, Tokyo (Shoggoth World): Studio 64's own code
const VANILLA_BHV = new Set(catalog.entries.filter((e) => !NOT_DECOMP.test(e.id)).map((e) => e.behavior));

function levelOf(num) {
  for (const [slug, info] of Object.entries(catalog.levels)) if (info.num === num) return { slug, ...info };
  return null;
}

// One original area -> { path, text, counts } (null when nothing exportable).
function areaFile(key, a, p) {
  const [num, areaIndex] = key.split(':').map(Number);
  const lv = levelOf(num);
  if (!lv) return null;
  const name = `studio_area_${areaIndex}`;
  const lines = [];
  const notes = [];
  const skipped = { blocks: 0, custom: 0, scaled: 0 };
  const warps = a.warps || [];
  for (const w of warps) {
    let dest;
    if (w.destCustom) { notes.push(`warp ${w.node} leads to your own level "${p.levels.find((l) => l.id === w.destCustom)?.name || w.destCustom}", which the decomp does not have: it points back to this area`); dest = { level: `LEVEL_${lv.slug.toUpperCase()}`, area: areaIndex, node: w.node }; }
    else {
      const d = levelOf(w.destLevel);
      dest = { level: d ? `LEVEL_${d.slug.toUpperCase()}` : `/* level ${w.destLevel} */ ${w.destLevel}`, area: w.destArea, node: w.destNode };
    }
    lines.push(`    WARP_NODE(/*id*/ ${hex(w.node).replace(/^0x0{6}/, '0x')}, /*destLevel*/ ${dest.level}, /*destArea*/ ${dest.area}, /*destNode*/ ${hex(dest.node).replace(/^0x0{6}/, '0x')}, /*flags*/ WARP_NO_CHECKPOINT),`);
  }
  for (const r of a.objects || []) {
    if (r.block) { skipped.blocks++; continue; }
    const e = r.entry ? getEntry(r.entry) : null;
    const bhv = e ? e.behavior : r.bhv;
    const modelEntry = e || (r.model ? getEntry(r.model) : null);
    const model = modelEntry?.model || 'MODEL_NONE';
    if (!bhv || !VANILLA_BHV.has(bhv) || (r.entry && NOT_DECOMP.test(r.entry)) || (r.model && NOT_DECOMP.test(String(r.model)))) { skipped.custom++; continue; }
    if (r.scale && Math.abs(r.scale - 1) > 0.01) skipped.scaled++;
    const loaded = !modelEntry || model === 'MODEL_NONE' || (modelEntry.levels || []).includes(lv.slug);
    const label = r.star?.name ? ` /* star "${String(r.star.name).replace(/\*\//g, '')}" */` : '';
    lines.push(`    OBJECT(/*model*/ ${pad(`${model},`, 32)} /*pos*/ ${String(Math.round(r.x)).padStart(6)}, ${String(Math.round(r.y)).padStart(6)}, ${String(Math.round(r.z)).padStart(6)}, /*angle*/ ${deg(r.pitch)}, ${deg(r.yaw)}, ${deg(r.roll)}, /*behParam*/ ${hex(r.bparams)}, /*beh*/ ${bhv}),${label}${loaded ? '' : ` /* ${model} is not loaded in ${lv.name}: add its LOAD_MODEL_FROM_GEO / group */`}`);
  }
  for (const rm of a.removals || []) notes.push(`remove the original ${rm.name && rm.name !== rm.bhv ? `${rm.name} (${rm.bhv})` : rm.bhv} at (${Math.round(rm.x)}, ${Math.round(rm.y)}, ${Math.round(rm.z)}) from levels/${lv.slug}/script.c or its macro objects`);
  if (skipped.blocks) notes.push(`${skipped.blocks} block(s) are custom geometry: not exported (they need collision and display lists)`);
  if (skipped.custom) notes.push(`${skipped.custom} object(s) use Studio 64's own behaviors or models (Sunshine characters, cars, custom objects): not exported`);
  if (skipped.scaled) notes.push(`${skipped.scaled} object(s) are scaled: OBJECT has no scale, set it in the behavior (cur_obj_scale) if it matters`);
  if (a.terrain) notes.push('the terrain heightmap is not exported');
  if ((a.sculpt || []).length) notes.push(`${a.sculpt.length} sculpt stroke(s) change the original geometry: not exported`);
  if (a.settings && Object.keys(a.settings).length) notes.push(`level settings changed (${Object.keys(a.settings).join(', ')}): set them in the level script by hand`);
  if (!lines.length && !notes.length) return null;
  const text = [
    `// ${lv.name}, area ${areaIndex}: made by Studio 64 from "${p.name}".`,
    `// In levels/${lv.slug}/script.c: #include "levels/${lv.slug}/${name}.inc.c" after the other includes,`,
    `// and JUMP_LINK(${name}), inside AREA(${areaIndex}, ...) next to the other JUMP_LINKs.`,
    ...notes.map((n) => `// NOTE: ${n}`),
    '',
    `static const LevelScript ${name}[] = {`,
    ...lines,
    '    RETURN(),',
    '};',
    '',
  ].join('\n');
  return { path: `levels/${lv.slug}/${name}.inc.c`, text, level: lv.name, area: areaIndex, objects: lines.length - warps.length, warps: warps.length, notes };
}

export function decompExport(p) {
  const files = [];
  for (const [key, a] of Object.entries(p.areas || {})) {
    if (!/^\d+:\d+$/.test(key)) continue;
    const f = areaFile(key, a, p);
    if (f) files.push(f);
  }
  const custom = (p.levels || []).length;
  const readme = [
    `${p.name}: export for the SM64 decompilation`,
    '',
    'Studio 64 keeps a hack as edits on top of the game. This export turns the edits of the',
    'original levels into level script commands for the decomp (https://github.com/n64decomp/sm64),',
    'so they can go into a real ROM build:',
    '',
    ...files.map((f) => `  ${f.path}: ${f.level}, area ${f.area}: ${f.objects} object(s), ${f.warps} warp(s)${f.notes.length ? `, ${f.notes.length} note(s)` : ''}`),
    '',
    'For each file: copy it to the same path in the decomp, #include it at the top of that',
    'level\'s script.c, and add JUMP_LINK(studio_area_<n>), inside the matching AREA(...) block.',
    'Read the NOTE lines at the top of each file: removed original objects must be deleted by',
    'hand, and custom geometry (blocks, terrain, sculpting) is not part of this export.',
    custom ? `\nThis hack also has ${custom} level(s) of its own; they are not exported (they need new geometry, textures and a level slot).` : '',
    '',
  ].join('\n');
  const entries = [{ name: 'README.txt', data: readme }, ...files.map((f) => ({ name: f.path, data: f.text }))];
  return { zip: zipWrite(entries), files };
}
