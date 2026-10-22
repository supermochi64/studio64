// Roads & nature: the browser side of the AI's tools (server/tools/paths.js). Each method makes
// the same records and undo steps as the build-mode tools.

import { registerRpc } from '../studio.js';
import { ROAD_STYLES, ROAD_IDS, styleOf } from './roads.js';
import { LINE_STYLES, LINE_IDS } from './lines.js';
import { KIND, PRESETS } from './nature.js';
import { lengthOf, describeItems } from './ops.js';
import { closestOnCurve } from './geom.js';

export function registerPathsRpc(rt, ui) {
  const ops = ui.ops;

  // [{x, z, y?}] or [[x, z]] -> [[x, y, z]] on the ground; none: a straight line ahead of Mario
  const points = (list, { length = 2000, from = null } = {}) => {
    let pts = (list || []).map((p) => (Array.isArray(p) ? { x: p[0], z: p[p.length === 2 ? 1 : 2], y: p.length === 3 ? p[1] : undefined } : p));
    if (pts.length < 2) {
      const m = rt.engine.state().mario;
      if (!m) throw new Error('Mario is not in a level right now; give points');
      const a = (m.yaw / 32768) * Math.PI, fx = Math.sin(a), fz = Math.cos(a);
      const s = from || { x: m.x + fx * 200, z: m.z + fz * 200 };
      pts = [s, { x: s.x + fx * length * 0.5, z: s.z + fz * length * 0.5 }, { x: s.x + fx * length, z: s.z + fz * length }];
    }
    return pts.map((p) => {
      const y = p.y ?? rt.groundAt(p.x, p.z, 20000) ?? 0;
      return [Math.round(p.x), Math.round(y), Math.round(p.z), ...(p.width ? [Math.round(p.width)] : [])];
    });
  };
  const roadOf = (uid) => {
    const rec = ops.find(Number(uid));
    if (!rec?.road) throw new Error(`no road ${uid} in this area (list_paths lists them)`);
    return rec;
  };

  registerRpc('paths_list', function () {
    const recs = ops.records();
    const roads = recs.filter((r) => r.road).map((r) => {
      const R = rt.net.find((x) => x.rec.uid === r.uid);
      return { uid: r.uid, name: r.name, style: r.road.style, width: r.road.width, length: lengthOf(r), points: r.road.pts.map((p) => [p[0], p[1], p[2]]), closed: !!r.road.closed, left: r.road.left, right: r.road.right, steps: R?.flights || 0, joins: R ? [R.ends.start, R.ends.end].filter(Boolean).map((j) => j.B.rec.uid) : [] };
    });
    const lines = recs.filter((r) => r.line).map((r) => ({ uid: r.uid, name: r.name, style: r.line.style, length: lengthOf(r), points: r.line.pts, gaps: r.line.gaps || [], gates: r.line.gates || [] }));
    const plants = recs.filter((r) => r.nature).flatMap((r) => r.nature.items || []);
    return {
      roads, lines, plants: { count: plants.length, kinds: describeItems(plants) || 'none', triangles: rt.stats.tris },
      styles: { roads: ROAD_IDS, lines: LINE_IDS, nature: Object.keys(KIND), presets: Object.keys(PRESETS) },
    };
  });

  registerRpc('paths_draw_road', function (a = {}) {
    const style = a.style === 'custom' || ROAD_STYLES[a.style] ? a.style : 'asphalt';
    const pts = points(a.points, { length: a.length || 2000 });
    const rec = ops.roadRecord({ style, pts, width: a.width, closed: a.closed, smooth: a.smooth, material: a.material, name: a.name });
    for (const k of ['lanes', 'marking', 'left', 'right', 'stairs', 'caps']) if (a[k] !== undefined) rec.road[k] = a[k];
    if (a.follow_ground === false) rec.road.follow = 'points';
    if (rec.road.left && !LINE_STYLES[rec.road.left]) delete rec.road.left;
    if (rec.road.right && !LINE_STYLES[rec.road.right]) delete rec.road.right;
    ops.addRoad(rec, a.summary || `Drew ${rec.name.toLowerCase()}`);
    const R = rt.net.find((x) => x.rec.uid === rec.uid);
    return { uid: rec.uid, name: rec.name, style: styleOf(rec.road).label, width: rec.road.width, length: lengthOf(rec), points: rec.road.pts, steps: R?.flights || 0, joins: R ? [R.ends.start, R.ends.end].filter(Boolean).map((j) => j.B.rec.uid) : [] };
  });

  registerRpc('paths_edit_road', function (a = {}) {
    const rec = roadOf(a.uid);
    const ch = {};
    if (a.points) ch.pts = points(a.points);
    for (const k of ['width', 'closed', 'smooth', 'lanes', 'marking', 'left', 'right', 'stairs', 'caps']) if (a[k] !== undefined) ch[k] = a[k] === '' || a[k] === 'none' ? undefined : a[k];
    if (a.style && (ROAD_STYLES[a.style] || a.style === 'custom')) { ch.style = a.style; rec.name = a.style === 'custom' ? 'Custom path' : ROAD_STYLES[a.style].label; }
    if (a.follow_ground !== undefined) ch.follow = a.follow_ground ? undefined : 'points';
    ops.update(rec, ch, a.summary || `Changed the ${rec.name.toLowerCase()}`);
    return { uid: rec.uid, length: lengthOf(rec), road: rec.road };
  });

  registerRpc('paths_remove', function (a = {}) {
    const rec = ops.find(Number(a.uid));
    if (!rec || !(rec.road || rec.line || rec.nature)) throw new Error(`nothing with uid ${a.uid} here`);
    ops.remove(rec);
    return { removed: rec.uid, name: rec.name };
  });

  registerRpc('paths_add_line', function (a = {}) {
    const style = LINE_STYLES[a.style] ? a.style : 'picket';
    if (a.along_road) {
      // on a road's side(s): part of the road, follows it and opens at its junctions
      const rec = roadOf(a.along_road);
      const ch = {};
      const side = a.side || 'both';
      if (side === 'left' || side === 'both') ch.left = style;
      if (side === 'right' || side === 'both') ch.right = style;
      ops.update(rec, ch, `${LINE_STYLES[style].label} along the ${rec.name.toLowerCase()}`, { refit: false });
      return { road: rec.uid, side, style: LINE_STYLES[style].label };
    }
    const pts = points(a.points, { length: a.length || 1200 });
    const rec = ops.lineRecord({ style, pts, closed: a.closed, smooth: a.smooth, scale: a.height_percent ? a.height_percent / 100 : undefined, gaps: a.gaps, gates: a.gates, name: a.name });
    ops.addLine(rec, a.summary || `Built ${LINE_STYLES[style].label.toLowerCase()}`);
    return { uid: rec.uid, name: rec.name, length: lengthOf(rec), points: rec.line.pts };
  });

  registerRpc('paths_paint_nature', function (a = {}) {
    let kinds = {};
    if (a.preset && PRESETS[a.preset]) kinds = { ...PRESETS[a.preset].kinds };
    if (Array.isArray(a.kinds)) for (const k of a.kinds) { if (KIND[k]) kinds[k] = (kinds[k] && !a.preset ? kinds[k] + 1 : 1); }
    else if (a.kinds && typeof a.kinds === 'object') for (const [k, w] of Object.entries(a.kinds)) if (KIND[k]) kinds[k] = Number(w) || 1;
    const density = a.density ?? (a.preset ? PRESETS[a.preset]?.density : 50) ?? 50;
    // where: a circle (center + radius), along a road (both sides), or around Mario
    const spots = [];
    if (a.along_road) {
      const rec = roadOf(a.along_road);
      const R = rt.net.find((x) => x.rec.uid === rec.uid);
      if (!R) throw new Error('that road is not built yet');
      const band = a.radius || 300;
      for (let i = 0; i < R.n; i += Math.max(1, Math.round(band / 40))) {
        const s = R.S[i], off = s.w / 2 + band * 0.7 + 40;
        for (const sg of [-1, 1]) spots.push({ x: s.x - s.tz * sg * off, z: s.z + s.tx * sg * off, r: band * 0.7 });
      }
    } else {
      let c = a.center;
      if (!c) { const m = rt.engine.state().mario; if (!m) throw new Error('Mario is not in a level right now; give a center'); c = { x: m.x, z: m.z }; }
      spots.push({ x: c.x, z: c.z, r: a.radius || 800 });
    }
    if (a.erase) {
      const only = Object.keys(kinds).length ? kinds : null;
      const n = ops.erasePlants((it) => spots.some((s) => Math.hypot(it[1] - s.x, it[3] - s.z) <= s.r) && (!only || only[it[0]]));
      return { removed: n };
    }
    if (!Object.keys(kinds).length) throw new Error(`say what to plant: a preset (${Object.keys(PRESETS).join(', ')}) or kinds (${Object.keys(KIND).join(', ')})`);
    const index = ops.plantIndex();
    const items = [];
    let seed = Math.floor(Math.random() * 1e9);
    for (const s of spots) {
      // big circles are filled in pieces so each piece gets its full density
      const pieces = s.r > 900 ? Math.ceil((s.r * s.r) / (700 * 700)) : 1;
      for (let p = 0; p < pieces; p++) {
        const ang = p * 2.39996, rad = pieces > 1 ? Math.sqrt((p + 0.5) / pieces) * s.r : 0;
        const r = pieces > 1 ? Math.min(s.r, 760) : s.r;
        items.push(...ops.scatter({ kinds, cx: s.x + Math.cos(ang) * rad, cz: s.z + Math.sin(ang) * rad, r, density, avoidPaths: a.avoid_paths !== false, avoidWater: a.avoid_water !== false, existing: index, seed: seed++ }));
        if (items.length > 4000) break;
      }
    }
    if (!items.length) return { planted: 0, note: 'nothing fit there (water, roads, steep ground or already full)' };
    ops.addPlants(items, a.summary);
    return { planted: items.length, what: describeItems(items), triangles_in_area: rt.stats.tris };
  });

  void closestOnCurve;
}
