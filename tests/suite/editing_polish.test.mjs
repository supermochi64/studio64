// Editing tools as a demanding user uses them: odd inspector values, group undo, focus after
// build-bar controls, stuck keys. One check per bug found.
// @tags editor
// @timeout 600
import fs from 'node:fs';
import path from 'node:path';
import { suite, ROOT } from '../lib/harness.mjs';

await suite('editing polish', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  await s.build();
  await s.viewMario(3000, -1.45);
  const m = await s.mario();
  // three boxes in a row (through the editor, the placement UI has its own tests)
  const uids = await s.eval((m) => {
    const ed = studio64.editor, out = [];
    for (let i = 0; i < 3; i++) {
      const rec = ed.makeRecord({ block: 'box' }, { p: [Math.round(m.x) + 300 + i * 400, Math.round(m.y), Math.round(m.z)], yaw: 0 }, ed.newUid());
      ed.engine.spawn(rec); ed.records().push(rec);
      ed.commit({ type: 'add', summary: 'test box', records: [rec] });
      out.push(rec.uid);
    }
    return out;
  }, m);
  await s.settle(800);
  const rec = (u) => s.eval((u) => studio64.editor.records().find((r) => r.uid === u), u);
  const selectUid = (u) => s.eval((u) => { const o = studio64.engine.objects().find((x) => x.uid === u); studio64.editor.select(o.slot); }, u);
  const field = (sel) => `#inspector input[${sel}]`;
  const setField = async (sel, v) => { await page.fill(field(sel), v); await page.press(field(sel), 'Enter'); await s.settle(400); };

  // ---- 1-4: inspector values ----
  await selectUid(uids[0]);
  await s.wait(300);
  const r0 = await rec(uids[0]);
  await page.fill(field('data-f=x'), '');
  await s.wait(200);
  t.eq('empty X does not move the box live', (await rec(uids[0])).x, r0.x);
  await page.press(field('data-f=x'), 'Enter');
  await s.settle(400);
  t.eq('empty X keeps the position', (await rec(uids[0])).x, r0.x);
  t.eq('empty X field shows the value again', Number(await page.inputValue(field('data-f=x'))), r0.x);
  await page.fill(field('data-f=x'), String(r0.x + 50));
  await page.fill(field('data-f=x'), '');
  await page.press(field('data-f=x'), 'Enter');
  await s.settle(400);
  t.eq('a live preview is undone when the field ends empty', await s.eval((u) => studio64.engine.objects().find((o) => o.uid === u)?.x, uids[0]), r0.x);
  await setField('data-b=sx', '');
  t.eq('empty W keeps the size', (await rec(uids[0])).block.sx, r0.block.sx);
  await setField('data-f=y', '999999999');
  t.check('huge Y is clamped', (await rec(uids[0])).y <= 20000, (await rec(uids[0])).y);
  await setField('data-f=y', String(r0.y));
  await page.click('#inspector [data-shape="2"]');
  await s.settle(400);
  await setField('data-b=steps', '3.7');
  t.check('steps are whole', Number.isInteger((await rec(uids[0])).block.steps), (await rec(uids[0])).block.steps);
  await page.click('#inspector [data-shape="0"]');
  await s.settle(400);

  // an object: size and params
  const g = await s.eval((m) => {
    const ed = studio64.editor;
    const r = ed.makeRecord({ entry: 'goomba' }, { p: [Math.round(m.x) - 400, Math.round(m.y), Math.round(m.z)], yaw: 0 }, ed.newUid());
    ed.engine.spawn(r); ed.records().push(r); ed.commit({ type: 'add', summary: 'test goomba', records: [r] });
    return r.uid;
  }, m);
  await s.settle(600);
  await selectUid(g);
  await s.wait(300);
  await setField('data-f=scale', '1e9');
  t.check('size has an upper bound', (await rec(g)).scale <= 20, (await rec(g)).scale);
  await setField('data-f=scale', '1');
  // ---- 24: typing in the inspector while the object changes elsewhere (another tab, Claude,
  // the echo of the last edit): the field and the typed text stay ----
  await page.click(field('data-f=y'));
  await page.keyboard.press('Control+a');
  await page.keyboard.type('12');
  await page.evaluate((uid) => studio64.ws.send(JSON.stringify({ type: 'edit', op: { type: 'update', key: studio64.engine.areaKey(), uid, fields: { name: 'Goomba renamed elsewhere' }, summary: 'Renamed elsewhere' } })), g);
  await s.settle(1500);
  const after24 = await page.evaluate(() => { const a = document.activeElement; return { key: a?.dataset?.f || null, value: a?.value, title: document.querySelector('#inspector .insp-title')?.textContent }; });
  t.check('typing in the inspector survives a change from elsewhere', after24.key === 'y' && after24.value === '12' && /elsewhere/.test(after24.title || ''), after24);
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.activeElement?.blur());
  await s.settle(400);
  await setField('data-f=bparams', 'zz');
  t.check('invalid bparams text is replaced', /^0x[0-9A-F]{8}$/.test(await page.inputValue(field('data-f=bparams'))), await page.inputValue(field('data-f=bparams')));

  // ---- 5: a group turn is one undo step ----
  await s.eval(() => studio64.editor.select(null));
  await s.viewMario(3000, -1.45);
  for (let i = 0; i < 3; i++) {
    const sp = await s.eval((u) => { const r = studio64.editor.records().find((x) => x.uid === u); return studio64.editor.project([r.x, r.y + r.block.sy / 2, r.z]); }, uids[i]);
    if (i) await page.keyboard.down('Shift');
    await s.clickAt(sp.x, sp.y);
    if (i) await page.keyboard.up('Shift');
  }
  t.eq('three boxes selected', await s.eval(() => studio64.objects.scene.multi.size), 3);
  const before = await Promise.all(uids.map(rec));
  const n0 = (await s.changes()).length;
  await page.keyboard.press('KeyR');
  await s.settle(800);
  t.eq('group turn is one undo step', (await s.changes()).length, n0 + 1);
  t.check('every box turned', (await Promise.all(uids.map(rec))).every((r) => r.yaw === 8192));
  await page.keyboard.press('Control+z');
  await s.settle(1000);
  const after = await Promise.all(uids.map(rec));
  t.check('one Ctrl+Z turns the whole group back', after.every((r, i) => r.yaw === before[i].yaw && r.x === before[i].x && r.z === before[i].z), after.map((r) => [r.x, r.z, r.yaw]));

  // ---- 6: focus after the grid select ----
  await s.eval(() => studio64.editor.select(null));
  await page.focus('#snap-select');
  await page.selectOption('#snap-select', '100');
  const n1 = (await s.changes()).length;
  await page.keyboard.press('Control+z');
  await s.settle(800);
  t.check('Ctrl+Z after the grid select', (await s.changes()).length !== n1);
  await page.keyboard.press('Control+Shift+z');
  await s.settle(800);
  t.eq('the grid size was set', await s.eval(() => studio64.editor.snap), 100);

  // ---- 7: a fly key released in a text field ----
  await selectUid(uids[1]);
  await s.wait(300);
  await page.keyboard.down('KeyW');
  await page.focus(field('data-f=z'));
  await page.keyboard.up('KeyW');
  await page.evaluate(() => document.activeElement.blur());
  t.check('released fly key is not stuck', !(await s.eval(() => studio64.editor.keys.has('KeyW'))));

  // ---- 8-10: model import with odd files ----
  await page.waitForFunction(() => window.studio64?.assets?.loaded, null, { timeout: 60000 });
  const glb = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'crate.glb'));
  const importResult = async (name, bytes) => {
    const files = await page.evaluateHandle(([n, b64]) => [new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], n)], [name, Buffer.from(bytes).toString('base64')]);
    await page.evaluate((f) => { studio64.assetsUI.openImport(f); }, files);
    return page.waitForFunction(() => {
      const b = document.querySelector('.as-import');
      if (b?.querySelector('.as-error')) return { error: b.querySelector('.as-error').textContent };
      if (b?.querySelector('[data-a=save]:not([disabled])')) return { ok: true, scale: Number(b.querySelector('[data-o=scale]')?.value) };
      return false;
    }, null, { timeout: 90000, polling: 200 }).then((h) => h.jsonValue());
  };
  const cut = await importResult('cut.glb', glb.subarray(0, 20 + glb.readUInt32LE(12) + 48));
  t.check('cut-off glb says it is damaged', /damaged/.test(cut.error || '') && !/DataView|JSON/.test(cut.error || ''), cut);
  // the selected box stays selected: Delete in the dialog must not reach the editor
  const selBefore = await s.eval(() => studio64.editor.sel?.uid);
  await page.keyboard.press('Delete');
  t.eq('Delete in the dialog keeps the selection', await s.eval(() => studio64.editor.sel?.uid), selBefore);
  await page.keyboard.press('Escape');
  await s.wait(300);
  t.check('Esc closes the import dialog', !(await page.$('.as-import')));
  const huge = await importResult('huge.obj', 'v 0 0 0\nv 1e30 0 0\nv 0 1e30 0\nf 1 2 3\n');
  t.check('huge model keeps a scale', huge.ok && huge.scale > 0, huge);
  await page.keyboard.press('Escape');
  await s.wait(300);
  const dot = await importResult('dot.obj', 'v 5 5 5\nv 5 5 5\nv 5 5 5\nf 1 2 3\n');
  t.check('a point-sized model is refused', /no size/.test(dot.error || ''), dot);
  await page.keyboard.press('Escape');

  // ---- 12: a duplicated star is a new star ----
  await s.eval(() => studio64.editor.select(null));
  await s.viewMario(1500, -0.9);
  await s.eval(() => studio64.editor.startPlacing({ entry: 'star', star: { name: 'Twin star' } }));
  const sgp = await s.groundPoint();
  await s.clickAt(sgp.x, sgp.y);
  await s.settle(800);
  const star = (await s.records()).find((r) => r.star?.name === 'Twin star');
  t.must('a star was placed', !!star);
  await selectUid(star.uid);
  await page.keyboard.press('Control+d');
  await s.settle(800);
  const stars = await s.eval(() => studio64.world.stars().filter((x) => x.kind === 'star'));
  t.check('a duplicated star is a new star', stars.length === 2 && stars[0].index !== stars[1].index && stars[0].name !== stars[1].name, stars);

  // ---- 13: an empty death height is not 0 ----
  await s.eval(() => { studio64.editor.select(null); studio64.worldFlow.setEnv({ deathY: -2500 }, 'test death height'); });
  await s.settle(600);
  await page.click('.lib-tab[data-lib=world]');
  await s.wait(500);
  await page.evaluate(() => { const i = document.querySelector('input[data-k=deathY]'); i.value = ''; i.dispatchEvent(new Event('change')); });
  await s.settle(600);
  t.eq('empty death height is not 0', await s.eval(() => studio64.world.settings().env?.deathY), -2500);

  // ---- 21: an empty game rule field keeps the rule ----
  const ruleBefore = await page.evaluate(async () => {
    studio64.objects.rules.open();
    await new Promise((r) => setTimeout(r, 300));
    const num = document.querySelector('.gr-row input[type=number]');
    const before = JSON.stringify(studio64.objects.rules.rules());
    num.value = '';
    num.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 300));
    const after = JSON.stringify(studio64.objects.rules.rules());
    studio64.objects.rules.close();
    return { before, after };
  });
  t.eq('an empty game rule field keeps the rule', ruleBefore.after, ruleBefore.before);

  // ---- 16: pixel editor redo ----
  const px = await page.evaluate(async () => {
    const { openPixelEditor } = await import('/js/pixel_editor.js');
    const rgba = new Uint8ClampedArray(8 * 8 * 4); rgba.fill(255); rgba[0] = 0; // one dark corner pixel
    window.__px = openPixelEditor({ rgba, w: 8, h: 8, sizes: false });
    await new Promise((r) => setTimeout(r, 300));
    document.querySelector('.px-back [data-a=rot]').click();
    return true;
  });
  await page.focus('.px-back .px-color');
  await page.keyboard.press('Control+z');
  const nAfter = (await s.changes()).length;
  await page.keyboard.press('Control+Shift+z');
  const res = await page.evaluate(async () => { document.querySelector('.px-back [data-a=done]').click(); const r = await window.__px; return r && Array.from(r.rgba.slice(0, 4)); });
  t.check('pixel editor redo with Ctrl+Shift+Z', px && res && res[0] === 255, res);
  t.eq('Ctrl+Z in the pixel editor does not undo the project', (await s.changes()).length, nAfter);

  // ---- 15: a deleted sound stays deleted ----
  await s.eval(() => studio64.soundUI.open());
  await page.click('.ss-tab[data-tab=sounds]');
  await page.click('.ss-new');
  await s.wait(400);
  const sid = await s.eval(() => studio64.soundUI.soundId);
  await page.fill('.cmp-name', 'Gone soon');
  await page.click('button[title="Delete sound"]');
  await s.settle(1500);
  t.check('a deleted sound stays deleted', !((await s.export()).audio?.sounds || []).some((x) => x.id === sid), sid);
  await page.keyboard.press('Escape');
  await s.wait(300);
  await s.eval(() => studio64.soundUI.isOpen() && studio64.soundUI.close());

  // ---- 11: Mario stands on a hill raised under him ----
  if (await s.eval(() => studio64.editor.active)) await s.play();
  await s.newLevel('flat', 'Hill test');
  // ---- 18: a double-sided imported wall stops Mario from both sides ----
  const gltf = (() => {
    // one vertical quad, 10 x 6 (x100 on import: 1000 x 600 units), facing +z, double-sided
    const pos = new Float32Array([-5, 0, 0, 5, 0, 0, 5, 6, 0, -5, 6, 0]);
    const idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
    const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]);
    return JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'fence' }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
      materials: [{ name: 'fence', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.8, 0.6, 0.3, 1] } }],
      buffers: [{ byteLength: bin.length, uri: `data:application/octet-stream;base64,${bin.toString('base64')}` }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 48 }, { buffer: 0, byteOffset: 48, byteLength: 12 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-5, 0, 0], max: [5, 6, 0] }, { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' }] });
  })();
  const fenceId = await page.evaluate(async (text) => {
    studio64.assetsUI.openImport([new File([text], 'fence.gltf')]);
    await new Promise((ok) => { const w = () => (document.querySelector('.as-import [data-a=save]:not([disabled])') ? ok() : setTimeout(w, 100)); w(); });
    document.querySelector('.as-import [data-a=save]').click();
    await new Promise((ok) => { const w = () => (studio64.assets.meta.models.some((m) => m.name === 'fence') ? ok() : setTimeout(w, 100)); w(); });
    return studio64.assets.meta.models.find((m) => m.name === 'fence').id;
  }, gltf);
  const wall = await page.evaluate(async (id) => {
    const m = studio64.engine.state().mario;
    const x = Math.round(m.x) + 2500, z = Math.round(m.z) + 500, y = Math.round(studio64.engine.floor(m.x, m.y + 200, m.z + 500));
    await studio64.studio.handle('asset_place', { model: id, where: { mode: 'at', x, y, z, snap: false }, mode: 'level', yaw_deg: 0 });
    return { x, y, z };
  }, fenceId);
  await s.wait(500);
  if (await s.eval(() => studio64.editor.active)) await s.play();
  // ---- 17: build mode's drawings are gone while playing ----
  t.eq('the build overlay is hidden in play mode', await s.eval(() => getComputedStyle(document.querySelector('#overlay')).visibility), 'hidden');
  // ---- 19: no screen fade is left running after arriving in a level ----
  t.check('no screen transition stuck after a level jump', await s.until(() => !(studio64.engine.M._studio_story_debug() & 2), null, 8000));
  const walkAt = async (z0, yaw) => {
    await s.eval(([w, z0]) => studio64.engine.teleport(w.x, w.y + 20, z0, 0), [wall, z0]);
    await s.wait(700);
    await s.eval((yaw) => studio64.engine.M._studio_walk(yaw, 60), yaw);
    await s.wait(4500); // 60 frames of walking (a few seconds on a busy machine)
    return (await s.mario()).z;
  };
  const zFront = await walkAt(wall.z - 400, 0);        // walking +z into its front... (the side Mario starts on)
  const zBack = await walkAt(wall.z + 400, 0x8000);    // ...and -z into its back
  t.check('a double-sided wall stops Mario from the front', zFront < wall.z && zFront > wall.z - 200, { zFront, wall: wall.z });
  t.check('a double-sided wall stops Mario from the back', zBack > wall.z && zBack < wall.z + 200, { zBack, wall: wall.z });

  await s.build();
  await s.eval(() => {
    const w = studio64.world, ed = studio64.editor, m = studio64.engine.state().mario;
    for (let i = 0; i < 5; i++) {
      const st = w.beginStroke('raise', { x: m.x, y: m.y, z: m.z }, { ...ed.brush, mode: 'raise', radius: 1500, strength: 100 });
      w.dab(st, m.x, m.z); w.endStroke(st);
    }
  });
  await s.settle(800);
  await s.play();
  await s.wait(1500);
  const top = await s.eval(() => { const m = studio64.engine.state().mario; return { y: m.y, ground: studio64.world.terrain.heightAt(m.x, m.z) }; });
  t.check('Mario stands on a hill raised under him', top.y >= top.ground - 30, top);
  await s.shot('end');
});
