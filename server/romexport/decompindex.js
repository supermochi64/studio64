// What the decomp tree knows about models: which actor bank each geo layout lives in, which
// global script loads that bank's models, and which level owns level-only models.
import fs from 'node:fs';
import path from 'node:path';

export function indexDecomp(root) {
  const geoBank = new Map();   // geo symbol -> 'common0' | 'common1' | 'group0' | 'groupN' | 'level:<folder>'
  const actors = path.join(root, 'actors');
  for (const f of fs.readdirSync(actors)) {
    const m = /^(common0|common1|group\d+)\.h$/.exec(f);
    if (!m) continue;
    const text = fs.readFileSync(path.join(actors, f), 'utf8');
    for (const g of text.matchAll(/extern const GeoLayout (\w+)\[\]/g)) geoBank.set(g[1], m[1]);
  }
  const levels = path.join(root, 'levels');
  for (const d of fs.readdirSync(levels)) {
    const h = path.join(levels, d, 'header.h');
    if (!fs.existsSync(h)) continue;
    for (const g of fs.readFileSync(h, 'utf8').matchAll(/extern const GeoLayout (\w+)\[\]/g)) if (!geoBank.has(g[1])) geoBank.set(g[1], `level:${d}`);
  }

  // script_func_global_N -> the bank whose models it loads; model -> geo loaded globally
  const scripts = fs.readFileSync(path.join(levels, 'scripts.c'), 'utf8');
  const funcOfBank = new Map();
  const globalModels = new Map(); // MODEL -> geo, from script_func_global_1 (every level runs it)
  for (const m of scripts.matchAll(/const LevelScript script_func_global_(\d+)\[\] = \{([\s\S]*?)\};/g)) {
    const n = Number(m[1]);
    for (const l of m[2].matchAll(/LOAD_MODEL_FROM_GEO\(\s*(\w+),\s*(\w+)\)/g)) {
      const bank = geoBank.get(l[2]);
      if (n === 1) globalModels.set(l[1], l[2]);
      else if (bank && /^group\d+$/.test(bank) && !funcOfBank.has(bank)) funcOfBank.set(bank, n);
    }
  }
  return { geoBank, funcOfBank, globalModels };
}

// Banks 1-11 load into segment 5, 12-17 into segment 6: a level can have one of each.
export function bankSlot(bank) {
  const n = Number(/^group(\d+)$/.exec(bank)?.[1]);
  if (!n) return null;
  return n <= 11 ? 'a' : 'b';
}
