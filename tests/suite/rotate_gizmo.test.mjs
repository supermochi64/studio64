// The rotate handles (key 2, issue #8): rings around X, Y and Z (and the view). Dragging the X
// ring tilts a block (pitch), the Z ring rolls it, the Y ring turns it as before; the angles are
// saved, drawn by the game (its collision turns too), survive a reload, undo in one step each,
// and a selected group turns together in 3D. The inspector's Tilt/Roll fields work on objects too.
// @tags editor
import { suite } from '../lib/harness.mjs';

await suite('rotate gizmo', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  await s.build();
  await s.viewMario(1600, -0.45);

  // a box, placed with the mouse
  await page.click('.lib-tab[data-lib=blocks]');
  await page.click('.preset:has-text("Box")');
  const gp = await s.groundPoint({ rows: [0.75, 0.45], from: [0.35, 0.65] });
  t.must('found ground on screen', !!gp);
  await s.clickAt(gp.x, gp.y);
  await page.keyboard.press('Escape');
  await s.settle();
  const box = (await s.records()).filter((r) => r.block).pop();
  t.must('box placed', !!box);
  const rec = (uid) => s.eval((u) => { const r = studio64.editor.records().find((x) => x.uid === u); return r && { x: r.x, y: r.y, z: r.z, yaw: r.yaw, pitch: r.pitch | 0, roll: r.roll | 0 }; }, uid);
  const select = (uid) => s.eval((u) => { const o = studio64.engine.objects().find((x) => x.uid === u); studio64.editor.select(o.slot); }, uid);
  await select(box.uid);
  await page.keyboard.press('Digit2');
  await s.wait(300);
  const rings = await s.eval(() => studio64.editor.handles().filter((h) => h.type === 'ring').map((h) => h.ring));
  t.eq('key 2 shows rings around X, Y, Z and the view', rings, ['x', 'y', 'z', 'view']);
  await s.shot('gizmo');

  // drags a ring along itself by a quarter turn, starting at the front point farthest from the
  // other rings
  const dragRing = async (id, quarter = 16) => {
    const path = await s.eval(([id, q]) => {
      const hs = studio64.editor.handles().filter((h) => h.type === 'ring');
      const h = hs.find((x) => x.ring === id), others = hs.filter((x) => x !== h).flatMap((x) => x.pts.filter(Boolean));
      let best = -1, bi = 0;
      h.pts.forEach((p, i) => {
        if (!p || !p.front || i >= 64) return;
        const d = Math.min(...others.map((o) => Math.hypot(o.x - p.x, o.y - p.y)));
        if (d > best) { best = d; bi = i; }
      });
      const out = [];
      for (let k = 0; k <= q; k++) out.push(h.pts[(bi + k) % 64]);
      return out;
    }, [id, quarter]);
    const ov = await s.box();
    await page.mouse.move(ov.x + path[0].x, ov.y + path[0].y);
    await s.wait(80);
    await page.mouse.down();
    for (const p of path.slice(1)) { if (p) await page.mouse.move(ov.x + p.x, ov.y + p.y); await s.wait(15); }
    await s.wait(100);
    if (id === 'x') await s.shot('gizmo_drag');
    await page.mouse.up();
    await s.settle(700);
  };
  const deg = (v) => Math.round((((v << 16) >> 16) / 65536) * 360);

  // X ring: tilts it around X by a quarter turn
  const n0 = (await s.changes()).length;
  await dragRing('x');
  let r = await rec(box.uid);
  t.check('the X ring tilts it a quarter turn (pitch)', Math.abs(Math.abs(deg(r.pitch)) - 90) <= 15 && r.roll === 0 && r.yaw === 0, { pitch: deg(r.pitch), yaw: deg(r.yaw), roll: deg(r.roll) });
  const ch = (await s.changes()).slice(n0);
  t.check('one change: Rotated', ch.length === 1 && /^Rotated /.test(ch[0]), ch);
  const tilted = r;
  // a block turns around its middle (its position is its bottom middle)
  const mid = (r) => s.eval(async ([r, h]) => {
    const { rotRows } = await import('/js/rotation.js');
    const R = rotRows(r.pitch, r.yaw, r.roll);
    return [r.x + R[1][0] * h, r.y + R[1][1] * h, r.z + R[1][2] * h];
  }, [r, box.block.sy / 2]);
  const m0 = await mid({ ...box, pitch: 0, roll: 0, yaw: box.yaw }), m1 = await mid(tilted);
  t.check('...around its middle', Math.hypot(m1[0] - m0[0], m1[1] - m0[1], m1[2] - m0[2]) < 3, { m0, m1 });

  // Z ring: rolls it
  await dragRing('z', 8);
  r = await rec(box.uid);
  t.check('the Z ring turns it around Z too', r.pitch !== tilted.pitch || r.roll !== tilted.roll || r.yaw !== tilted.yaw, { r, tilted });
  const rolled = r;
  // the game turned its collision the same way: straight down onto the box, the face hit is one
  // of the box's sides turned by the saved angles (and not flat any more)
  const faceCheck = (r) => s.eval(async ([b, r]) => {
    const { rotRows } = await import('/js/rotation.js');
    const R = rotRows(r.pitch, r.yaw, r.roll);
    const c = [b.x + R[1][0] * 150, b.y + R[1][1] * 150, b.z + R[1][2] * 150];
    const h = studio64.engine.raycast([c[0], c[1] + 2000, c[2]], [0, -1, 0], -1, true, 4000);
    if (!h) return { hit: null };
    const n = [h.nx, h.ny, h.nz];
    const match = R.some((row) => Math.abs(Math.abs(row[0] * n[0] + row[1] * n[1] + row[2] * n[2]) - 1) < 0.03);
    return { match, ny: h.ny };
  }, [r, r]);
  const f1 = await faceCheck(rolled);
  t.check('the game collides it turned (the face hit is one of its turned sides)', f1.match && f1.ny < 0.97, f1);
  await s.shot('turned');
  // the inspector shows the angles
  t.eq('inspector Tilt field', Number(await page.inputValue('#inspector input[data-f=pitch]')), Math.round(((rolled.pitch & 0xffff) / 65536) * 3600) / 10);

  // undo: one step back to the tilt only; redo
  await page.keyboard.press('Control+z');
  await s.settle(900);
  t.eq('undo brings back the angles before', await rec(box.uid), tilted);
  await page.keyboard.press('Control+Shift+z');
  await s.settle(900);
  t.eq('redo turns it again', await rec(box.uid), rolled);

  // saved on the server: after a reload it is still turned, in the engine too
  const find = (o, uid) => { if (!o || typeof o !== 'object') return null; if (o.uid === uid && 'x' in o) return o; for (const v of Object.values(o)) { const f = find(v, uid); if (f) return f; } return null; };
  const saved = find(await s.export(), box.uid);
  t.check('the server has the angles', saved && (saved.pitch | 0) === rolled.pitch && (saved.roll | 0) === rolled.roll, saved);
  await s.reload();
  await s.build();
  t.eq('after a reload', await rec(box.uid), rolled);
  const f2 = await faceCheck(rolled);
  t.check('...and the game still has it turned', f2.match && f2.ny < 0.97, f2);

  // a group: a second box beside it, both selected; tilting the first turns the second around it
  await s.viewMario(1600, -0.45);
  await s.eval((b) => {
    const r2 = { uid: 0x1234567, block: { ...b.block }, x: b.x + 400, y: b.y, z: b.z, yaw: 0, pitch: 0, roll: 0, name: 'Box' };
    studio64.editor.records().push(r2);
    studio64.engine.spawn(r2);
    studio64.editor.commit({ type: 'add', summary: 'Added Box', records: [r2] });
  }, box);
  await s.settle();
  await s.eval((u) => { const ed = studio64.editor; const o = studio64.engine.objects().find((x) => x.uid === u); ed.select(o.slot); }, box.uid);
  const ov = await s.box();
  const sp2 = await s.eval(() => { const r2 = studio64.editor.records().find((x) => x.uid === 0x1234567); return studio64.editor.project([r2.x, r2.y + r2.block.sy / 2, r2.z]); });
  await page.keyboard.down('Shift');
  await page.mouse.click(ov.x + sp2.x, ov.y + sp2.y);
  await page.keyboard.up('Shift');
  await s.wait(300);
  t.eq('two selected', await s.eval(() => studio64.objects.scene.multi.size), 2);
  await page.keyboard.press('Digit2');
  await s.wait(200);
  // the one with the handles turns, the other follows
  const lead = await s.eval(() => studio64.editor.sel.uid), other = lead === box.uid ? 0x1234567 : box.uid;
  const before = await rec(other);
  const p0 = await rec(lead);
  const n1 = (await s.changes()).length;
  await dragRing('z', 8);
  const after = await rec(other);
  const p1 = await rec(lead);
  t.check('the group turned together (the other one moved and turned)', p1.roll !== p0.roll || p1.pitch !== p0.pitch ? (after.pitch !== before.pitch || after.roll !== before.roll) && Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z) > 20 : false, { before, after, p0, p1 });
  t.check('...in one change', (await s.changes()).length === n1 + 1, (await s.changes()).slice(n1));
  // distance to the selected one stays the same (a turn, not a stretch)
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  t.near('...keeping its distance', dist(after, p1), dist(before, p0), 3);
  await s.shot('group');
  await page.keyboard.press('Control+z');
  await s.settle(900);
  t.eq('undo turns the group back', [await rec(lead), await rec(other)], [p0, before]);

  // the inspector's Tilt on an object (not only blocks): a Goomba-free test object, a coin
  await page.keyboard.press('Escape');
  await s.eval(() => studio64.editor.select(null));
  const objRec = await s.eval((b) => {
    const entry = studio64.catalog.entries.find((e) => e.id === 'yellow_coin') || studio64.catalog.entries.find((e) => /coin/.test(e.id));
    const r2 = { uid: 0x2345678, entry: entry.id, x: b.x - 400, y: b.y + 100, z: b.z, yaw: 0, pitch: 0, roll: 0, bparams: 0, scale: 1, name: 'Thing' };
    studio64.editor.records().push(r2);
    studio64.engine.spawn(r2);
    studio64.editor.commit({ type: 'add', summary: 'Added thing', records: [r2] });
    return r2;
  }, box);
  await s.settle();
  await select(objRec.uid);
  await s.wait(300);
  t.check('objects have Tilt and Roll fields', await page.isVisible('#inspector input[data-f=pitch]') && await page.isVisible('#inspector input[data-f=roll]'));
  await page.fill('#inspector input[data-f=pitch]', '30');
  await page.press('#inspector input[data-f=pitch]', 'Enter');
  await s.settle();
  t.eq('Tilt on an object is saved', (await rec(objRec.uid)).pitch, Math.round((30 / 360) * 65536));
});
