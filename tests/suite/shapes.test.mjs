// Block shapes (issue #8): ramp and stairs corners (inner/outer) that continue ramps and stairs
// without a step, the pillar with its texture at the blocks' scale, the sphere, and the terrain
// patch (placed anywhere, sculpted and painted with the ground's brushes, undo, reload). Mario
// walks onto each, the library shows them, copy/paste, save/reload, and the area dump the ROM
// export reads holds them (plus a whole ROM export of the level).
// @tags editor blocks export
// @timeout 1500
import fs from 'node:fs';
import path from 'node:path';
import { suite, OUT, URL_BASE } from '../lib/harness.mjs';
import { parseDump } from '../../server/romexport/dump.js';

const SH = { box: 0, ramp: 1, stairs: 2, pillar: 3, ramp_inner: 4, ramp_outer: 5, stairs_inner: 6, stairs_outer: 7, sphere: 8, terrain: 9 };

await suite('shapes', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  const dir = path.join(OUT, t.slug);
  fs.mkdirSync(dir, { recursive: true });
  // a picture of the game only (the canvas)
  const shot = async (name) => {
    const box = await s.box('#overlay');
    await s.wait(350);
    await page.screenshot({ path: path.join(dir, `${name}.png`), clip: box });
  };
  // build-mode camera looking at `p` from `dist`, turned `yawDeg` around it, `pitch` down
  const look = (p, dist, yawDeg, pitch) => s.eval(([p, dist, yawDeg, pitch]) => {
    const ed = studio64.editor;
    ed.anim = null;
    ed.cam.yaw = (yawDeg * Math.PI) / 180;
    ed.cam.pitch = pitch;
    const d = ed.camDir();
    ed.cam.x = p[0] - d[0] * dist; ed.cam.y = p[1] - d[1] * dist; ed.cam.z = p[2] - d[2] * dist;
    ed.focusDist = dist;
    ed.pushCamera();
  }, [p, dist, yawDeg, pitch]);
  // a block placed like the library does (one edit each)
  const place = (recs) => s.eval((recs) => {
    const ed = studio64.editor;
    const out = recs.map((r) => {
      const rec = { uid: ed.newUid(), x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, ...r, block: { top: 10, side: 10, surface: 0, flags: 0, color: 0xffffff, steps: 8, ...r.block } };
      rec.name = r.name || 'Test block';
      studio64.engine.spawn(rec);
      ed.records().push(rec);
      ed.commit({ type: 'add', summary: `Placed ${rec.name}`, records: [rec] });
      return rec;
    });
    return out;
  }, recs);
  const floor = (x, y, z) => s.eval(([x, y, z]) => studio64.engine.floor(x, y, z), [x, y, z]);
  // Mario walks toward yaw (SM64 units) for `frames` from (x, z); returns the highest he got and where he ended
  const walk = async (x, z, yaw, frames = 70, y = null) => {
    const y0 = y ?? (await floor(x, 3000, z));
    await s.eval(([x, y, z, yaw]) => studio64.engine.teleport(x, y + 10, z, yaw), [x, y0, z, yaw]);
    await s.wait(900);
    await s.eval(([yaw, frames]) => studio64.engine.M._studio_walk(((yaw << 16) >> 16), frames), [yaw, frames]);
    let top = -1e9, m = null;
    const t0 = Date.now();
    let still = 0, last = null;
    while (Date.now() - t0 < 12000) {
      await s.wait(150);
      m = await s.mario();
      top = Math.max(top, m.y);
      // done once he stands still (the autopilot's frames are over)
      still = last && Math.hypot(m.x - last.x, m.z - last.z) < 1 && Date.now() - t0 > 1500 ? still + 1 : 0;
      last = m;
      if (still >= 4) break;
    }
    await s.wait(600);
    m = await s.mario();
    return { top, end: { x: Math.round(m.x), y: Math.round(m.y), z: Math.round(m.z) }, action: m.action };
  };

  await s.newLevel('flat', 'Shapes');
  const G = await floor(0, 3000, 0);
  t.log('ground', G);
  await s.build();

  // ---- the library: every new shape with its picture -------------------------------------------
  await page.click('.lib-tab[data-lib=blocks]');
  // (the pictures are made by the setup, tools/make_thumbs.mjs --blocks: without them, icons)
  const pics = (await fetch(`${URL_BASE}/api/pictures`).then((r) => r.json()).catch(() => ({}))).blocks || [];
  await s.until(() => document.querySelectorAll('#lib-blocks img.preset-thumb').length > 0, null, pics.length ? 8000 : 10);
  await s.wait(500);
  const presets = await s.eval(() => [...document.querySelectorAll('#lib-blocks .preset')].map((b) => ({ id: b.dataset.preset, label: b.textContent.trim(), pic: !!b.querySelector('img.preset-thumb') && b.querySelector('img.preset-thumb').naturalWidth > 0, icon: !!b.querySelector('svg') })));
  for (const id of ['ramp_inner', 'ramp_outer', 'stairs_inner', 'stairs_outer', 'sphere', 'terrain']) {
    const p = presets.find((x) => x.id === id);
    t.check(`library has ${id} with ${pics.includes(id) ? 'its picture' : 'an icon'}`, p && (pics.includes(id) ? p.pic : p.icon), p);
  }
  t.check('every block preset shows its picture or icon', presets.every((p) => (pics.includes(p.id) ? p.pic : p.icon)), presets);
  t.log('block pictures', pics.length);
  await page.screenshot({ path: path.join(dir, 'library.png'), clip: await s.box('#library') });

  // place a sphere with the mouse from the library
  await s.viewMario(1800, -0.7);
  await page.click('#lib-blocks .preset[data-preset=sphere]');
  const gp = await s.groundPoint();
  t.must('a ground point to place on', !!gp);
  const n0 = (await s.records()).length;
  await s.clickAt(gp.x, gp.y);
  await s.wait(500);
  await s.key('Escape');
  const placed = (await s.records()).slice(n0);
  t.check('the sphere is placed from the library', placed.length === 1 && placed[0].block.shape === SH.sphere, placed);
  if (placed[0]) await s.eval((uid) => { const ed = studio64.editor; ed.select(ed.engine.objects().find((o) => o.uid === uid).slot); ed.deleteSelected(); }, placed[0].uid);
  await s.wait(300);

  // ---- corners next to ramps and stairs ----------------------------------------------------------
  // outer: corner at C, a ramp at its +x side (same yaw) and one at its +z side turned 90 degrees
  // inner: corner at C, ramps at its -x side and its -z side (turned)
  const RAMP = { sx: 700, sy: 300, sz: 700 }, STAIR = { sx: 640, sy: 320, sz: 640, steps: 8 };
  const sets = [
    { name: 'ramp outer', shape: SH.ramp_outer, piece: SH.ramp, dim: RAMP, c: [-2400, 2200], inner: false },
    { name: 'ramp inner', shape: SH.ramp_inner, piece: SH.ramp, dim: RAMP, c: [600, 2200], inner: true },
    { name: 'stairs outer', shape: SH.stairs_outer, piece: SH.stairs, dim: STAIR, c: [-2400, -1600], inner: false },
    { name: 'stairs inner', shape: SH.stairs_inner, piece: SH.stairs, dim: STAIR, c: [600, -1600], inner: true },
  ];
  const W = 400; // the ramps' and stairs' own width
  for (const st of sets) {
    const [cx, cz] = st.c, h = st.dim.sx / 2, sgn = st.inner ? -1 : 1;
    st.recs = await place([
      { name: `${st.name} corner`, x: cx, y: G, z: cz, block: { shape: st.shape, ...st.dim } },
      { name: `${st.name} piece x`, x: cx + sgn * (h + W / 2), y: G, z: cz, block: { shape: st.piece, ...st.dim, sx: W } },
      { name: `${st.name} piece z`, x: cx, y: G, z: cz + sgn * (h + W / 2), yaw: 0x4000, block: { shape: st.piece, ...st.dim, sx: W } },
      // the plateau they lead up to
      { name: `${st.name} top`, x: st.inner ? cx + h + 300 : cx + h + W / 2, y: G, z: st.inner ? cz + h + 300 : cz + h + W / 2, block: { shape: SH.box, sx: st.inner ? 600 : W, sy: st.dim.sy, sz: st.inner ? 600 : W } },
    ]);
  }
  // singles: pillar, sphere, a terrain patch floating in the air
  const PILLAR = [-4200, 0], SPHERE = [-4200, -1600], PATCH = [3400, 200, 600];
  const singles = await place([
    { name: 'Test pillar', x: PILLAR[0], y: G, z: PILLAR[1], block: { shape: SH.pillar, sx: 260, sy: 600, sz: 260, top: 9, side: 9 } },
    { name: 'Wide pillar', x: PILLAR[0] - 900, y: G, z: PILLAR[1], block: { shape: SH.pillar, sx: 700, sy: 400, sz: 700, top: 6, side: 6 } },
    { name: 'Test sphere', x: SPHERE[0], y: G, z: SPHERE[1], block: { shape: SH.sphere, sx: 500, sy: 500, sz: 500, top: 0, side: 0 } },
    { name: 'Test patch', x: PATCH[0], y: G + PATCH[1], z: PATCH[2], block: { shape: SH.terrain, sx: 1600, sy: 100, sz: 1600, steps: 16, top: 0, side: 0 } },
  ]);
  const patchUid = singles[3].uid;
  await s.settle(800);
  t.check('no crash after placing every shape', !(await s.crashed()));

  // ---- collision: heights where the shapes say ---------------------------------------------------
  // corners: the lower (outer) / higher (inner) of the two ramps; seams without a step
  for (const st of sets) {
    const [cx, cz] = st.c, h = st.dim.sx / 2, sy = st.dim.sy;
    const at = async (u, w) => (await floor(cx - h + u * 2 * h, G + 2000, cz - h + w * 2 * h)) - G;
    if (st.piece === SH.ramp) {
      const want = (u, w) => sy * (st.inner ? Math.max(u, w) : Math.min(u, w));
      const pts = [[0.25, 0.75], [0.75, 0.25], [0.5, 0.5], [0.9, 0.6], [0.3, 0.1]];
      const got = [];
      for (const [u, w] of pts) got.push([u, w, Math.round(await at(u, w)), Math.round(want(u, w))]);
      t.check(`${st.name}: collision follows the corner`, got.every((g) => Math.abs(g[2] - g[3]) <= 4), got);
    } else {
      const top = await at(0.97, 0.97);
      t.near(`${st.name}: the top is the stairs' height`, top, sy, 4);
      const low = await at(st.inner ? 0.05 : 0.05, st.inner ? 0.05 : 0.5);
      t.check(`${st.name}: the low corner is near the ground`, low < sy * 0.25, { low });
    }
    // the seams: the corner and the piece next to it at the same height
    const seam = [];
    for (const f of [0.15, 0.5, 0.85]) {
      const sx = st.inner ? cx - h : cx + h, z = cz - h + f * 2 * h;
      const a = await floor(sx - 6, G + 2000, z), b = await floor(sx + 6, G + 2000, z);
      const sz = st.inner ? cz - h : cz + h, x = cx - h + f * 2 * h;
      const c = await floor(x, G + 2000, sz - 6), d = await floor(x, G + 2000, sz + 6);
      seam.push(Math.round(Math.abs(a - b)), Math.round(Math.abs(c - d)));
    }
    t.check(`${st.name}: no step where it meets the ${st.piece === SH.ramp ? 'ramps' : 'stairs'}`, seam.every((d) => d <= (st.piece === SH.ramp ? 6 : 12)), seam);
  }
  t.near('pillar top', (await floor(PILLAR[0] + 60, G + 2000, PILLAR[1] + 40)) - G, 600, 3);
  t.near('sphere top', (await floor(SPHERE[0], G + 2000, SPHERE[1])) - G, 500, 6);
  t.near('flat patch top', (await floor(PATCH[0] + 100, G + 3000, PATCH[2] - 100)) - G, PATCH[1] + 100, 3);

  // ---- the terrain patch: sculpted with the real brushes -----------------------------------------
  const patchTop = [PATCH[0], G + PATCH[1] + 100, PATCH[2]];
  await look(patchTop, 2600, 180, -1.0);
  await page.click('.lib-tab[data-lib=terrain]');
  const ov = await s.box();
  const P = { x: ov.width * 0.5, y: ov.height * 0.5 };
  const onPatch = await s.eval(([P, uid]) => { const h = studio64.editor.pick(P.x, P.y, { objects: false }); const o = h && studio64.engine.objects().find((x) => x.slot === h.slot); return { uid: o?.uid, hit: h && [h.x, h.y, h.z] }; }, [P, patchUid]);
  t.must('the brush point is on the patch', onPatch.uid === patchUid, onPatch);
  const hit = onPatch.hit;
  const n1 = (await s.changes()).length;
  await s.eval(() => {
    const w = studio64.world, end = w.endStroke.bind(w);
    window.__strokes = [];
    w.endStroke = (st) => { window.__strokes.push({ mode: st.mode, target: st.target, dabs: st.dabs.length }); return end(st); };
  });
  const stroke = async (mode, ms = 900, mods = []) => {
    await page.click(`.brush-tool[data-mode=${mode}]`);
    await page.mouse.move(ov.x + P.x, ov.y + P.y);
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.down();
    await page.mouse.move(ov.x + P.x + 8, ov.y + P.y + 3, { steps: 4 });
    await s.wait(ms);
    await page.mouse.up();
    for (const m of mods) await page.keyboard.up(m);
    await s.wait(700);
  };
  const patchY = () => floor(hit[0], hit[1] + 12000, hit[2]);
  const y0 = await patchY();
  await s.eval(() => { studio64.editor.brush.radius = 500; studio64.editor.brush.strength = 12; });
  await stroke('raise', 900);
  const y1 = await patchY();
  t.check('raising the patch lifts its collision', y1 > y0 + 60, { y0, y1 });
  t.eq('one stroke is one edit', (await s.changes()).length, n1 + 1);
  const rec1 = await s.eval((uid) => studio64.editor.records().find((r) => r.uid === uid), patchUid);
  t.check('the heights are in the record', !!rec1?.block?.hm && rec1.block.steps === 16, rec1?.block);
  t.near('the patch did not move', rec1.y, G + PATCH[1], 0.5);
  t.check('the level itself was not sculpted', !(await s.eval(() => (studio64.world.area().sculpt || []).length)));
  await shot('patch_raised');
  await stroke('lower', 500);
  const y2 = await patchY();
  t.check('lower digs into the patch', y2 < y1 - 15, { y1, y2, strokes: await s.eval(() => window.__strokes) });
  await stroke('smooth', 500);
  await stroke('flatten', 500);
  t.check('smooth and flatten run', !(await s.crashed()));
  await page.click('.brush-tool[data-mode=paint]');
  await page.locator('.brush-paint .mat').nth(17).click();
  await stroke('paint', 600);
  const rec2 = await s.eval((uid) => studio64.editor.records().find((r) => r.uid === uid), patchUid);
  t.check('paint marks the patch\'s cells', !!rec2?.block?.pm, rec2?.block);
  // big hill for the walking test, then undo / redo of a stroke
  await s.eval(() => { studio64.editor.brush.radius = 600; studio64.editor.brush.strength = 14; });
  await stroke('raise', 1000);
  const yHill = await patchY();
  const nUndo = (await s.changes()).length;
  await s.key('Escape');
  await s.key('Control+z');
  await s.wait(900);
  const yUndo = await patchY();
  t.check('Ctrl+Z puts the patch back', yUndo < yHill - 40, { yHill, yUndo, nUndo });
  await s.key('Control+Shift+z');
  await s.wait(900);
  t.near('redo raises it again', await patchY(), yHill, 3);
  await look(patchTop, 2600, 150, -0.6);
  await shot('patch_build');

  // ---- a terrain patch in an original level, above its ground ------------------------------------
  // (later, after the custom level's checks; see the end)

  // ---- copy & paste, duplicate, multi-select keep the shapes -------------------------------------
  await s.key('Escape');
  await s.eval((uid) => { const ed = studio64.editor; ed.select(ed.engine.objects().find((o) => o.uid === uid).slot); }, patchUid);
  await s.key('Control+d');
  await s.wait(700);
  const dup = await s.eval((uid) => { const r = studio64.editor.records(); const src = r.find((x) => x.uid === uid); return r.filter((x) => x.block?.shape === 9 && x.uid !== uid).map((x) => ({ same: x.block.hm === src.block.hm && x.block.pm === src.block.pm, x: x.x, z: x.z })); }, patchUid);
  t.check('duplicating a patch keeps its shape', dup.length === 1 && dup[0].same, dup);
  // delete the copy again (undo)
  await s.key('Control+z');
  await s.wait(700);
  // a group (the outer ramp corner with its ramps) copied and pasted elsewhere
  const copied = await s.eval((uids) => {
    const sc = studio64.objects.scene;
    sc.setMulti(studio64.engine.objects().filter((o) => uids.includes(o.uid)));
    sc.copy();
    return (sc.clip || []).map((i) => i.block?.shape);
  }, sets[0].recs.map((r) => r.uid));
  t.check('a multi-selection with corners copies', copied.length === 4 && copied.includes(SH.ramp_outer), copied);
  await look([-2000, G, 4800], 2000, 180, -0.8);
  const nPaste = (await s.records()).length;
  await s.eval(() => studio64.objects.scene.paste());
  await s.wait(300);
  const pp = await s.groundPoint();
  if (pp) { await page.mouse.move((await s.box()).x + pp.x, (await s.box()).y + pp.y); await s.wait(300); await s.clickAt(pp.x, pp.y); }
  await s.wait(800);
  const pasted = (await s.records()).slice(nPaste);
  t.check('pasting places the corner group', pasted.length === 4 && pasted.some((r) => r.block?.shape === SH.ramp_outer), pasted.map((r) => r.block?.shape));
  await shot('pasted_group');
  await s.key('Escape');
  if (pasted.length) { await s.key('Control+z'); await s.wait(700); }
  t.eq('undo takes the paste back', (await s.records()).length, nPaste);

  // ---- the inspector: the shape buttons, a patch's "Sculpt it" ---------------------------------------
  const selectUid = (uid) => s.eval((uid) => { const ed = studio64.editor; ed.select(ed.engine.objects().find((o) => o.uid === uid).slot); }, uid);
  await selectUid(sets[1].recs[0].uid);
  await s.wait(500);
  const btns = await s.eval(() => [...document.querySelectorAll('#inspector [data-shape]')].map((b) => [b.dataset.shape, b.title, b.classList.contains('active')]));
  t.check('the inspector has the ten shapes, the inner ramp lit', btns.length === 10 && btns.find((b) => b[2])?.[0] === '4', btns);
  await page.screenshot({ path: path.join(dir, 'inspector_corner.png'), clip: await s.box('#inspector') });
  await selectUid(sets[3].recs[0].uid);
  await s.wait(400);
  t.check('stairs corners have steps in the inspector', await s.eval(() => !!document.querySelector('#inspector input[data-b=steps]')));
  await selectUid(patchUid);
  await s.wait(400);
  await page.screenshot({ path: path.join(dir, 'inspector_patch.png'), clip: await s.box('#inspector') });
  await page.click('#inspector [data-act=sculpt]');
  await s.wait(300);
  t.eq('"Sculpt it" picks up the terrain brushes', await s.eval(() => [studio64.editor.tool, !!document.querySelector('#lib-terrain:not([hidden])')]), ['sculpt', true]);
  await s.key('Escape');
  await s.wait(200);

  // ---- Claude's tools: a corner with the build tool, a patch shaped by the terrain tool -------------
  const ai = await s.eval(async ([x, z, G]) => {
    const st = studio64.studio;
    const r = await st.handle('build', { kind: 'block', block: { shape: 'stairs_outer', material: 'red brick' }, where: { mode: 'at', x, y: G, z }, yaw_deg: 0 });
    return r.records.map((q) => ({ shape: q.block.shape, sx: q.block.sx, sy: q.block.sy, steps: q.block.steps, name: q.name }));
  }, [1800, -3200, G]);
  t.check('the build tool makes a stairs corner in its library size', ai[0]?.shape === 7 && ai[0].sx === 640 && ai[0].steps === 8, ai);
  const [aiPatch] = await place([{ name: 'Claude patch', x: 3600, y: G, z: -3200, block: { shape: SH.terrain, sx: 1200, sy: 60, sz: 1200, steps: 12 } }]);
  await s.settle(400);
  const shaped = await s.eval(([uid, x, z]) => studio64.studio.handle('shape', { patch: uid, ops: [{ op: 'hill', x, z, radius: 500, height: 300 }, { op: 'paint', material: 'snow', x, z, radius: 200 }] }), [aiPatch.uid, 3600, -3200]);
  await s.settle(600);
  t.check('the terrain tool shapes a patch (hill)', shaped.highest_above_top >= 250 && (await floor(3600, G + 4000, -3200)) > G + 60 + 250, { shaped, top: await floor(3600, G + 4000, -3200) });

  // ---- every shape from several angles, in build mode ---------------------------------------------
  const views = [
    ['corners_ramp_outer', [sets[0].c[0], G + 150, sets[0].c[1]], 2200],
    ['corners_ramp_inner', [sets[1].c[0], G + 150, sets[1].c[1]], 2200],
    ['corners_stairs_outer', [sets[2].c[0], G + 150, sets[2].c[1]], 2200],
    ['corners_stairs_inner', [sets[3].c[0], G + 150, sets[3].c[1]], 2200],
    ['pillar', [PILLAR[0] - 450, G + 300, PILLAR[1]], 1900],
    ['sphere', [SPHERE[0], G + 250, SPHERE[1]], 1300],
    ['patch', patchTop, 2600],
  ];
  for (const [name, p, d] of views) {
    // corners from their low side (the ramps and stairs lead up toward +x and +z)
    const angles = name.startsWith('corners') ? [['a', 45, -0.45], ['b', 15, -0.25], ['c', 70, -0.8], ['d', 225, -0.5]] : [['a', 210, -0.45], ['b', 120, -0.3], ['c', 30, -0.75]];
    for (const [k, yaw, pitch] of angles) {
      await look(p, d, yaw, pitch);
      await shot(`${name}_${k}`);
    }
  }

  // ---- play: Mario walks on them -------------------------------------------------------------------
  await s.play();
  await s.wait(800);
  // corners: up the diagonal from the low front corner to the top
  for (const st of sets) {
    const [cx, cz] = st.c, h = st.dim.sx / 2, sy = st.dim.sy;
    const r = await walk(cx - h - 120, cz - h - 120, 0x2000, 75, G);
    t.check(`Mario walks up the ${st.name} corner`, r.top >= G + sy - 40, { ...r, want: G + sy });
    await shot(`play_walked_${st.name.replace(' ', '_')}`);
  }
  // across a seam: along the ramp next to the outer corner, sideways into the corner
  {
    const [cx, cz] = sets[0].c, h = 350;
    const y = await floor(cx + h + 200, G + 2000, cz);
    const r = await walk(cx + h + 200, cz, 0xC000, 30, y);
    t.check('Mario walks from a ramp across the seam into its corner', r.end.x < cx + h - 60, { r, seam: cx + h });
  }
  // stairs: straight up the side of the outer corner, step by step
  {
    const [cx, cz] = sets[2].c, h = 320;
    const r = await walk(cx + h - 60, cz - h - 150, 0, 70, G);
    t.check('Mario climbs the outer stairs corner along its side', r.top >= G + 300, r);
    const r2 = await walk(sets[3].c[0] - h + 60, sets[3].c[1] - h - 150, 0, 70, G);
    t.check('Mario climbs the inner stairs corner along its side', r2.top >= G + 300, r2);
  }
  // the pillar, the sphere and the patch's hill: he stands on them
  const standOn = async (x, z, name, top) => {
    // (play mode: a block's collision is there while Mario is near it)
    await s.eval(([x, y, z]) => studio64.engine.teleport(x, y + 150, z, 0), [x, top, z]);
    await s.wait(1800);
    const m = await s.mario();
    t.check(`Mario stands on the ${name}`, Math.abs(m.y - top) < 12, { mario: m.y, top, action: m.action?.toString(16) });
    await shot(`play_on_${name.replace(/ /g, '_')}`);
    return m;
  };
  await standOn(PILLAR[0], PILLAR[1], 'pillar', G + 600);
  await standOn(SPHERE[0], SPHERE[1], 'sphere', G + 500);
  {
    const r = await walk(SPHERE[0], SPHERE[1], 0x4000, 12, G + 500);
    t.check('Mario runs around on the sphere top', r.top > G + 450, r);
  }
  {
    // the hill's summit (the patch's highest grid point; yaw 0)
    const rec = await s.eval((uid) => studio64.editor.records().find((r) => r.uid === uid), patchUid);
    const n = rec.block.steps, h = new Int16Array(new Uint8Array(Buffer.from(rec.block.hm, 'base64')).buffer);
    let best = 0;
    for (let k = 1; k < h.length; k++) if (h[k] > h[best]) best = k;
    const i = best % (n + 1), j = Math.floor(best / (n + 1));
    const sx = rec.x - rec.block.sx / 2 + (i * rec.block.sx) / n, sz = rec.z - rec.block.sz / 2 + (j * rec.block.sz) / n;
    await standOn(sx, sz, 'patch hill', rec.y + rec.block.sy + h[best]);
  }
  {
    // along the patch's flat rim, past the foot of its hill
    const r = await walk(hit[0] + 650, hit[2] - 600, 0, 24, G + PATCH[1] + 100);
    t.check('Mario walks along the patch', r.end.z > hit[2] - 600 + 300 && Math.abs(r.end.y - (G + PATCH[1] + 100)) < 60, r);
  }
  // in-game pictures: Mario walks toward each shape (the camera follows behind him)
  const playShot = async (name, from, to, frames = 26) => {
    const yaw = Math.round((Math.atan2(to[0] - from[0], to[1] - from[1]) / Math.PI) * 32768) & 0xffff;
    await s.eval(([x, y, z, yaw]) => studio64.engine.teleport(x, y + 10, z, yaw), [from[0], from[2] ?? G, from[1], yaw]);
    await s.wait(900);
    await s.eval(([yaw, f]) => studio64.engine.M._studio_walk(((yaw << 16) >> 16), f), [yaw, frames]);
    await s.wait(3200);
    await shot(name);
  };
  await playShot('play_patch', [PATCH[0] - 1400, PATCH[2] - 1400], [PATCH[0], PATCH[2]], 20);

  // ---- what the ROM export reads: the area dump has every shape's collision -----------------------
  const dumpB64 = await s.eval(() => {
    const M = studio64.engine.M;
    const ptr = M._studio_romdump(0, 0, 0, 0);
    const bytes = M.HEAPU8.slice(ptr, ptr + M._studio_romdump_size());
    let str = '';
    for (let i = 0; i < bytes.length; i += 0x8000) str += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(str);
  });
  const dump = parseDump(Buffer.from(dumpB64, 'base64'));
  const byUid = new Map();
  for (const c of dump.collision) byUid.set(c.uid >>> 0, (byUid.get(c.uid >>> 0) || 0) + 1);
  const expect = [...sets.map((st) => st.recs[0]), ...singles];
  const counts = expect.map((r) => ({ name: r.name, shape: r.block.shape, tris: byUid.get(r.uid >>> 0) || 0 }));
  t.check('the dump has the collision of every new shape', counts.every((c) => c.tris >= 4), counts);
  t.check('the sphere and the patch keep their full collision', counts.find((c) => c.shape === 8).tris >= 400 && counts.find((c) => c.shape === 9).tris >= 600, counts);
  t.check('the dump draws them (triangles)', dump.tris.length > 2000, dump.tris.length);

  // ---- save and reload --------------------------------------------------------------------------
  // (in build mode: every block's collision is there, wherever Mario is)
  await s.build();
  const shapeNow = async () => ({ patch: await patchY(), sphere: await floor(SPHERE[0], G + 4000, SPHERE[1]), corner: await floor(sets[1].c[0] + 200, G + 2000, sets[1].c[1] + 100) });
  const before = await shapeNow();
  await s.reload();
  await page.click('#start').catch(() => {});
  await s.arrive(37, 120000);
  await s.wait(1500);
  const recs = await s.records();
  t.check('the new shapes are saved', [4, 5, 6, 7, 8, 9].every((k) => recs.some((r) => r.block?.shape === k)), recs.map((r) => r.block?.shape));
  await s.build();
  await s.wait(500);
  const after = await shapeNow();
  t.check('after a reload they are the same shape', Math.abs(after.patch - before.patch) < 2 && Math.abs(after.sphere - before.sphere) < 2 && Math.abs(after.corner - before.corner) < 2, { before, after });
  const proj = await s.export();
  const saved = Object.values(proj.patch?.areas || proj.areas || {}).flatMap((a) => a.objects || []).find((r) => r.uid === patchUid);
  t.check('the project file has the patch heights and paint', !!saved?.block?.hm && !!saved?.block?.pm, saved?.block && Object.keys(saved.block));

  // ---- the whole ROM export ---------------------------------------------------------------------
  const kit = await fetch(`${URL_BASE}/api/rom/kit`).then((r) => r.json()).catch(() => ({}));
  if (!kit.haveRom) {
    t.log('no ROM on this server: ROM export skipped');
  } else {
    await s.build();
    await s.eval(() => studio64.hub.romModal());
    await page.waitForSelector('#rx-go');
    await page.fill('#rx-title', 'Shapes');
    await page.click('#rx-go');
    await page.waitForSelector('.rx-done:not([hidden])', { timeout: 1200000 });
    await page.screenshot({ path: path.join(dir, 'rom_result.png') });
    const issues = await page.$$eval('.rx-issue, .rx-issues li', (els) => els.map((e) => e.textContent.trim()));
    t.check('the ROM export reports nothing about the shapes', !issues.some((i) => /block|shape|terrain|collision/i.test(i)), issues);
    const rom = Buffer.from(await (await fetch(`${URL_BASE}/api/projects/${s.projectId}/rom/file/Shapes.z64`)).arrayBuffer());
    t.check('a ROM came out', rom.length > 8 << 20 && rom.toString('latin1', 0x01000000, 0x01000004) === 'S64H', rom.length);
    fs.writeFileSync(path.join(OUT, 'shapes.z64'), rom);
    const levelsTxt = await page.$$eval('.rx-level', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    t.log('rom levels', JSON.stringify(levelsTxt));
    await s.eval(() => studio64.hub.close());
    await page.waitForSelector('#modal-back', { state: 'hidden', timeout: 10000 }).catch(() => {});
  }

  // ---- a terrain patch in an original level ------------------------------------------------------
  await s.goLevel(9);
  await s.build();
  const m = await s.mario();
  const by = Math.round(await floor(m.x + 900, m.y + 3000, m.z - 1300)) + 300;
  const [bob] = await place([{ name: 'BoB patch', x: Math.round(m.x + 900), y: by, z: Math.round(m.z - 1300), block: { shape: SH.terrain, sx: 1200, sy: 80, sz: 1200, steps: 12 } }]);
  await s.settle(600);
  const r = await s.eval(([uid, x, y, z]) => {
    const w = studio64.world, ed = studio64.editor;
    const o = studio64.engine.objects().find((q) => q.uid === uid);
    const st = w.beginStroke('raise', { x, y, z, slot: o.slot }, { ...ed.brush, mode: 'raise', radius: 400, strength: 80 });
    for (let i = 0; i < 4; i++) w.dab(st, x, z);
    w.endStroke(st);
    return { target: st.target, sculpt: (w.area().sculpt || []).length };
  }, [bob.uid, bob.x, by + 80, bob.z]);
  await s.settle(600);
  t.check('in an original level the brush shapes the patch, not the level', r.target === 'patch' && r.sculpt === 0, r);
  t.check('the patch in BoB rose', (await floor(bob.x, by + 3000, bob.z)) > by + 80 + 100, { top: await floor(bob.x, by + 3000, bob.z), base: by + 80 });
  await look([bob.x, by + 200, bob.z], 1800, 200, -0.5);
  await shot('patch_bob');
  t.check('no crash at the end', !(await s.crashed()));
});
