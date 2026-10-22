// Level validator: finds problems a player would hit, with a place to jump to.
//
// Live checks look at the loaded level through the engine's collision (stars under the
// floor or out of reach, objects inside walls, pools nearly full, spawn over the void);
// project checks read the saved data of every level (pipes that lead nowhere, warps to
// deleted levels, levels without stars, edit limits).
//
// A problem: { severity: 'error'|'warn'|'info', key, title, detail, pos?: [x,y,z], uid?, fix? }

const STAR_ENTRIES = new Set(['star', 'hidden_red_coin_star']);
const isStar = (r) => r.star || STAR_ENTRIES.has(r.entry);
const recName = (r) => r.star?.name ? `Star “${r.star.name}”` : r.name || (r.block ? 'Block' : String(r.entry || r.bhv || 'Object').replace(/_/g, ' '));
// limits of the engine (studio.c)
const MAX_REMOVALS = 512;
const MAX_RECORDS = 900;
// how high Mario gets from the ground: a triple jump is ~ 900, a wall kick chain more
const REACH = 1100;

export class Validator {
  constructor({ engine, studio, world, catalog, getLevels }) {
    this.engine = engine;
    this.studio = studio;
    this.world = world;
    this.catalog = catalog;
    this.getLevels = getLevels;
  }

  levelName(key) {
    if (key.startsWith('c:')) {
      // sub-areas are c:<id>:<n>
      const [, id, n] = key.split(':');
      const l = this.getLevels().find((x) => x.id === id);
      if (!l) return 'Custom level';
      const ai = Number(n) || 1;
      return ai > 1 ? `${l.name} · ${(l.areas || []).find((a) => a.index === ai)?.name || `Area ${ai}`}` : l.name;
    }
    const [n, a] = key.split(':').map(Number);
    const info = Object.values(this.catalog.levels).find((l) => l.num === n);
    return `${info?.name || `Level ${n}`}${a > 1 ? ` (area ${a})` : ''}`;
  }

  // ---- the level that is loaded --------------------------------------------------------

  // The ground under a point: the level's floors (death planes are no ground) and the tops
  // of the saved blocks (their collision only loads near Mario, so it is computed here).
  floorBelow(x, y, z) {
    let f = this.engine.floor(x, y, z);
    if (f < -20000) f = null;
    else if (this.engine.M._studio_debug_floor_type?.(x, y, z) === 0x0a) f = null;
    const b = this.blockTop(x, y, z);
    return b !== null && (f === null || b > f) ? b : f;
  }
  topFloor(x, z) { return this.floorBelow(x, 30000, z); }

  blockTop(x, y, z) {
    const recs = this.engine.patch.areas?.[this.engine.areaKey()]?.objects || [];
    let best = null;
    for (const r of recs) {
      const b = r.block;
      if (!b || (b.flags & 2)) continue; // flag 2: no collision
      const a = -((r.yaw || 0) / 32768) * Math.PI;
      const dx = x - r.x, dz = z - r.z;
      const lx = dx * Math.cos(a) + dz * Math.sin(a), lz = -dx * Math.sin(a) + dz * Math.cos(a);
      if (Math.abs(lx) > b.sx / 2 || Math.abs(lz) > b.sz / 2) continue;
      const top = r.y + b.sy;
      if (top <= y + 1 && (best === null || top > best)) best = top;
    }
    return best;
  }

  // Highest ground within reach around a point (Mario jumps from there).
  groundNear(x, y, z, radius = 900) {
    let best = null;
    for (const r of [0, radius * 0.35, radius * 0.7, radius]) {
      const n = r ? 12 : 1;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
        const f = this.floorBelow(px, y + 50, pz);
        if (f !== null && (best === null || f > best)) best = f;
      }
    }
    return best;
  }

  // Signed distances of the point from nearby walls (negative: behind the wall, inside).
  walls(x, y, z, radius, offsetY) {
    const M = this.engine.M;
    if (!M._studio_debug_walls) return [];
    const ptr = M._studio_debug_walls(x, y, z, radius, offsetY);
    const f = new Float32Array(M.HEAPU8.buffer, ptr, 9);
    const out = [];
    for (let i = 0; i < f[0]; i++) out.push(f[1 + i * 2]);
    return out;
  }

  live() {
    const e = this.engine;
    const key = e.areaKey();
    const area = e.patch.areas?.[key] || {};
    const problems = [];
    const add = (p) => problems.push({ key, ...p });
    const records = area.objects || [];

    // stars
    for (const r of records.filter(isStar)) {
      const pos = [r.x, r.y, r.z];
      const below = this.floorBelow(r.x, r.y + 60, r.z);
      const top = this.topFloor(r.x, r.z);
      const name = recName(r);
      if (below === null && top !== null && top > r.y + 60) {
        add({ severity: 'error', title: `${name} is under the ground`, detail: `The ground above it is at y ${Math.round(top)}; the star is at y ${Math.round(r.y)}.`, pos, uid: r.uid, fix: { kind: 'lift', y: Math.round(top + 150) } });
        continue;
      }
      if (below === null && top === null) {
        const near = this.groundNear(r.x, r.y, r.z, 1200);
        add({ severity: near === null ? 'error' : 'warn', title: `${name} floats over the void`, detail: near === null ? 'There is no ground anywhere near it: Mario cannot get there.' : 'No ground right below it: reachable only by jumping across.', pos, uid: r.uid });
        continue;
      }
      const ground = this.groundNear(r.x, r.y, r.z);
      if (ground !== null && r.y - ground > REACH && r.entry !== 'hidden_red_coin_star') {
        add({ severity: 'warn', title: `${name} may be out of reach`, detail: `It is ${Math.round(r.y - ground)} units above the highest ground nearby; Mario jumps about ${REACH}.`, pos, uid: r.uid, fix: { kind: 'lower', y: Math.round(ground + 160) } });
      }
      const w = this.walls(r.x, r.y, r.z, 60, 0);
      if (w.some((d) => d < -20) && !w.some((d) => d > 0)) add({ severity: 'warn', title: `${name} is inside a wall`, detail: 'Its center is behind a wall surface.', pos, uid: r.uid });
    }

    // red coins of red coin stars
    const redStars = records.filter((r) => r.entry === 'hidden_red_coin_star').length;
    const reds = records.filter((r) => r.entry === 'red_coin');
    if (redStars && reds.length < 8) add({ severity: 'error', title: `Only ${reds.length} of 8 red coins`, detail: 'The red coin star appears after 8 red coins: add the missing ones.' });
    for (const r of reds) {
      if (this.floorBelow(r.x, r.y + 60, r.z) === null && this.topFloor(r.x, r.z) !== null && this.topFloor(r.x, r.z) > r.y + 60) {
        add({ severity: 'error', title: 'A red coin is under the ground', detail: 'Mario cannot collect it, so the red coin star never appears.', pos: [r.x, r.y, r.z], uid: r.uid, fix: { kind: 'lift', y: Math.round(this.topFloor(r.x, r.z) + 60) } });
      }
    }

    // objects inside walls or under the level (live objects, studio-made ones)
    let objs = [];
    try { objs = e.objects(); } catch { /* between levels */ }
    const own = new Map(records.map((r) => [r.uid, r]));
    for (const o of objs) {
      if (!o.uid || !own.has(o.uid)) continue;
      const r = own.get(o.uid);
      if (r.block || isStar(r)) continue; // blocks are walls themselves
      if (o.surface) continue; // platforms carry their own collision
      const rad = Math.max(30, Math.min(o.r || 50, 120));
      const w = this.walls(o.x, o.y, o.z, rad, Math.min(60, (o.h || 100) / 2));
      if (w.some((d) => d < -rad * 0.4) && !w.some((d) => d > rad * 0.2)) {
        add({ severity: 'warn', title: `${recName(r)} is stuck in a wall`, detail: 'It may fall through the level or never move.', pos: [o.x, o.y, o.z], uid: o.uid });
      } else if (this.floorBelow(o.x, o.y + 80, o.z) === null && this.topFloor(o.x, o.z) !== null && this.topFloor(o.x, o.z) > o.y + 100 && !/coin|star/i.test(r.entry || '')) {
        add({ severity: 'warn', title: `${recName(r)} is under the level`, detail: 'Below every floor here: nobody will see it.', pos: [o.x, o.y, o.z], uid: o.uid, fix: { kind: 'lift', y: Math.round(this.topFloor(o.x, o.z) + 10) } });
      }
    }

    // pools
    try {
      const pools = JSON.parse(e.M.UTF8ToString(e.M._studio_debug_pools_json()));
      const op = pools.objects / pools.object_pool, sp = pools.surfaces / pools.surface_pool;
      if (op > 0.85) add({ severity: op > 0.97 ? 'error' : 'warn', title: `${pools.objects} of ${pools.object_pool} object slots in use`, detail: 'Close to the limit: new objects (coins from enemies, effects) may fail to appear.' });
      if (sp > 0.85) add({ severity: sp > 0.97 ? 'error' : 'warn', title: `Collision pool ${Math.round(sp * 100)}% full`, detail: `${pools.surfaces} of ${pools.surface_pool} collision triangles: big blocks and terrain use many.` });
    } catch { /* old engine */ }

    // the spawn point (custom levels, or a moved start)
    const s = area.settings?.spawn;
    if (s) {
      const f = this.floorBelow(s.x, s.y + 100, s.z);
      if (f === null) add({ severity: 'error', title: 'Mario starts over the void', detail: 'There is no ground under the start point: he falls right away.', pos: [s.x, s.y, s.z], fix: { kind: 'spawn' } });
      else if (s.y - f > 1600) add({ severity: 'info', title: 'Mario starts high in the air', detail: `${Math.round(s.y - f)} units above the ground.`, pos: [s.x, s.y, s.z] });
    } else if (key.startsWith('c:')) {
      add({ severity: 'info', title: 'No start point set', detail: 'Mario starts in the middle of the level. Set one in the level settings.' });
    }
    return problems;
  }

  // ---- every level of the project, from the saved data --------------------------------------

  project() {
    const problems = [];
    const areas = this.engine.patch.areas || {};
    const levels = this.getLevels();
    const levelNums = new Set(Object.values(this.catalog.levels).map((l) => l.num));
    const customIds = new Set(levels.map((l) => l.id));
    for (const [key, a] of Object.entries(areas)) {
      const add = (p) => problems.push({ key, ...p });
      const cid = key.startsWith('c:') ? key.slice(2).split(':')[0] : null; // sub-areas: c:<id>:<n>
      const cArea = cid ? Number(key.split(':')[2]) || 1 : 0;
      if (cid && !customIds.has(cid) && cid !== 'default' && (a.objects || []).length) {
        add({ severity: 'info', title: 'Edits of a deleted level', detail: `${(a.objects || []).length} objects belong to a level that no longer exists.` });
      }
      const recs = a.objects || [];
      if (recs.length > MAX_RECORDS) add({ severity: 'error', title: `${recs.length} objects in one level`, detail: `More than ${MAX_RECORDS}: some will not appear.` });
      else if (recs.length > MAX_RECORDS * 0.8) add({ severity: 'warn', title: `${recs.length} objects in one level`, detail: `Close to the limit of ${MAX_RECORDS}.` });
      if ((a.removals || []).length > MAX_REMOVALS) add({ severity: 'error', title: `${a.removals.length} removed originals`, detail: `More than ${MAX_REMOVALS}: the rest come back.` });
      // pipes and warps
      const nodes = new Map((a.warps || []).map((w) => [w.node, w]));
      // (pipes with a warp field are the World tab's: their link is checked below)
      for (const r of recs.filter((x) => x.entry === 'warp_pipe' && !x.warp)) {
        const node = (r.bparams >>> 16) & 0xff;
        if (node >= 0x80 && !nodes.has(node)) add({ severity: 'error', title: 'A pipe leads nowhere', detail: `Its warp ${node} has no destination.`, pos: [r.x, r.y, r.z], uid: r.uid });
      }
      for (const w of a.warps || []) {
        if (w.destCustom && !customIds.has(w.destCustom)) { add({ severity: 'error', title: 'A warp goes to a deleted level', detail: `Warp ${w.node} leads to a custom level that no longer exists.` }); continue; }
        if (!w.destCustom && w.destLevel !== this.engine.studioLevel && !levelNums.has(w.destLevel)) { add({ severity: 'error', title: 'A warp goes to an unknown level', detail: `Warp ${w.node} leads to level ${w.destLevel}.` }); continue; }
        // a pipe pair in this area: the other end must exist
        const sameArea = cid ? (w.destLevel === this.engine.studioLevel && (w.destArea || 1) === cArea && (!w.destCustom || w.destCustom === cid)) : `${w.destLevel}:${w.destArea}` === key;
        if (sameArea && w.destNode >= 0x80 && !nodes.has(w.destNode)) add({ severity: 'error', title: 'A pipe\'s other end is missing', detail: `Warp ${w.node} leads to node ${w.destNode}, which is not in this level.` });
      }
      // stars under the terrain of custom levels (not loaded: checked on the heightmap)
      // warps (doors, pipes, paintings, zones) to a level or area that is gone
      for (const r of recs) {
        const to = r.warp?.to;
        if (!to?.custom) continue;
        const l = levels.find((x) => x.id === to.custom);
        const ai = to.area || 1;
        if (!l) add({ severity: 'error', title: `${r.name || 'A warp'} goes to a deleted level`, detail: 'Link it again (World tab).', pos: [r.x, r.y, r.z], uid: r.uid });
        else if (ai > 1 && !(l.areas || []).some((x) => x.index === ai)) add({ severity: 'error', title: `${r.name || 'A warp'} goes to a deleted area`, detail: `Area ${ai} of ${l.name} no longer exists.`, pos: [r.x, r.y, r.z], uid: r.uid });
      }
      // stars belong to the whole level (all its areas): checked once, for the main area
      if (cid && cArea === 1 && customIds.has(cid)) {
        const stars = Object.entries(areas).filter(([k]) => k === key || k.startsWith(`${key}:`)).flatMap(([, x]) => (x.objects || []).filter(isStar));
        if (!stars.length) add({ severity: 'info', title: 'No stars to collect', detail: 'Add a star so the level has a goal (Stars tab).' });
      }
    }
    // custom levels nobody can reach in the game (only the launcher)
    // (pipes from the chat, warp records from other levels, the hack's start and hub)
    const targets = new Set(Object.values(areas).flatMap((a) => (a.warps || []).map((w) => w.destCustom).filter(Boolean)));
    for (const [k, a] of Object.entries(areas)) {
      for (const r of a.objects || []) if (r.warp?.to?.custom && !(k.startsWith('c:') && k.split(':')[1] === r.warp.to.custom)) targets.add(r.warp.to.custom);
    }
    const flow = this.engine.patch.world || {};
    for (const f of [flow.start, flow.hub]) if (f?.custom) targets.add(f.custom);
    for (const l of levels) {
      if (!targets.has(l.id) && this.engine.patch.areas?.[`c:${l.id}`]) {
        problems.push({ key: `c:${l.id}`, severity: 'info', title: 'No way in', detail: 'No pipe or door leads to this level: players reach it only from the level list.' });
      }
    }
    return problems;
  }

  run() {
    let live = [];
    try { live = this.engine.state().mario ? this.live() : []; } catch (err) { console.error('validator', err); }
    const here = this.engine.areaKey();
    // the loaded level's project problems come with the live ones; skip duplicates
    const proj = this.project();
    const all = [...live, ...proj.filter((p) => !(p.key === here && live.some((l) => l.title === p.title)))];
    const rank = { error: 0, warn: 1, info: 2 };
    all.sort((a, b) => (a.key === here ? 0 : 1) - (b.key === here ? 0 : 1) || rank[a.severity] - rank[b.severity]);
    for (const p of all) p.level = this.levelName(p.key);
    return { here, problems: all, counts: { error: all.filter((p) => p.severity === 'error').length, warn: all.filter((p) => p.severity === 'warn').length, info: all.filter((p) => p.severity === 'info').length } };
  }
}
