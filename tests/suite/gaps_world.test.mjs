// World gaps: a door flat against a wall (Mario stops in the doorway instead of walking into
// the wall, and comes out of a door on its open side), a cannon Mario climbs into and is shot
// out of, and a painting with an uploaded picture (shown, kept after a reload, jumped into).
// @tags world
// @timeout 900
import { suite } from '../lib/harness.mjs';

await suite('gaps: doors at walls, cannon, painting picture', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  const levelId = await s.newLevel('flat', 'Door wall test');
  await s.play();
  await s.eval(() => { window.__fc = 0; studio64.engine.on('frame', () => { window.__fc++; }); });
  const frames = async (n) => {
    const f0 = await s.eval(() => window.__fc);
    await page.waitForFunction(([a, b]) => window.__fc >= a + b, [f0, n], { timeout: 180000, polling: 50 });
  };
  const s0 = await s.mario();
  const g = await s.eval(({ x, z }) => studio64.engine.floor(x, 3000, z), s0);
  const X = Math.round(s0.x), Z = Math.round(s0.z);
  const block = (r) => s.eval(async (r) => {
    const gen = await import('/js/generators.js');
    const rec = { uid: 1 + Math.floor(Math.random() * 0x7efffffe), yaw: 0, pitch: 0, roll: 0, ...r, block: gen.blockDefaults(r.block), name: r.name };
    studio64.worldFlow.addRecord(rec, `Built ${rec.name}`);
    return rec.uid;
  }, r);
  const place = (kind, opts) => s.eval(({ kind, opts }) => {
    const f = studio64.worldFlow;
    const rec = f.makeWarpRecord(kind, opts);
    f.addRecord(rec);
    return rec;
  }, { kind, opts });

  // ---- 1. doors flat against walls ---------------------------------------------------------
  // wall A (front face at Z+950) with door A on it facing the player; wall B with door B facing
  // INTO its wall (put on the wrong way round), A leads to B
  await block({ name: 'wall A', x: X, y: g, z: Z + 1000, block: { shape: 0, sx: 1400, sy: 700, sz: 100, top: 'grey brick' } });
  await block({ name: 'wall B', x: X + 2500, y: g, z: Z + 1000, block: { shape: 0, sx: 1400, sy: 700, sz: 100, top: 'grey brick' } });
  const doorA = await place('door', { x: X, y: g, z: Z + 935, yaw: 0x8000, style: 'wood' });
  const doorB = await place('door', { x: X + 2500, y: g, z: Z + 935, yaw: 0, style: 'wood' });
  await s.eval(({ a, b, key, id }) => studio64.worldFlow.link(key, a, { custom: id, area: 1, uid: b }), { a: doorA.uid, b: doorB.uid, key: `c:${levelId}`, id: levelId });
  await frames(10);
  await s.eval(([x, y, z]) => studio64.engine.teleport(x, y, z, 0), [X, g + 20, Z + 500]);
  await frames(12);
  // watch Mario every frame until he is out at door B
  await s.eval(() => {
    window.__door = { maxZ: -1e9, arrived: null };
    window.__doorFn = () => {
      const m = studio64.engine.state().mario;
      if (!m) return;
      // while he goes through the door (pulling / pushing it)
      if (Math.abs(m.x - window.__doorX) < 400 && (m.action === '0x00001320' || m.action === '0x00001321')) window.__door.maxZ = Math.max(window.__door.maxZ, m.z);
      else if (Math.abs(m.x - window.__doorX - 2500) < 700 && !window.__door.arrived) window.__door.arrived = { x: m.x, y: m.y, z: m.z, action: m.action };
    };
    studio64.engine.on('frame', window.__doorFn);
  });
  await s.eval((x) => { window.__doorX = x; }, X);
  await s.eval(() => studio64.engine.M._studio_walk(0, 120));
  const through = await s.until(() => window.__door.arrived, null, 60000);
  await frames(30);
  const door = await s.eval(() => { studio64.engine.off('frame', window.__doorFn); return { ...window.__door, now: studio64.engine.state().mario }; });
  t.log('door', JSON.stringify(door));
  t.check('Mario went through door A to door B', through, door);
  t.check('walking through, Mario stays out of the wall behind the door', door.maxZ < Z + 950 - 10, `max z ${Math.round(door.maxZ - Z)} (wall face at 950)`);
  t.check('he comes out of door B on its open side', door.now.z < Z + 935 - 100 && door.now.z > Z + 400, `z ${Math.round(door.now.z - Z)}`);
  t.check('and stands on the ground there', Math.abs(door.now.y - g) < 30, door.now);
  await s.shot('door_out');

  // ---- 2. a cannon ------------------------------------------------------------------------
  const cannon = await place('cannon', { x: X - 1500, y: g, z: Z, yaw: 0 });
  await frames(10);
  const cobj = await s.eval((u) => studio64.engine.objects().find((o) => o.uid === u), cannon.uid);
  t.check('the cannon is in the level', !!cobj, cobj);
  await s.eval(([x, y, z]) => studio64.engine.teleport(x, y, z, 0), [X - 1500, g + 350, Z]);
  const inCannon = await s.until(() => studio64.engine.state().mario?.action === '0x00001371', null, 30000);
  t.check('Mario drops into the cannon', inCannon, await s.mario());
  await frames(40);
  await s.shot('cannon_in');
  // A shoots (it takes a moment until the cannon is ready)
  let shot = false;
  for (let i = 0; i < 12 && !shot; i++) {
    await page.keyboard.down('Space'); await frames(3); await page.keyboard.up('Space');
    await frames(10);
    // shot: the flying action, or (it can be over within the 10 frames) far from the cannon
    shot = await s.eval(([gy, cx, cz]) => { const m = studio64.engine.state().mario; return m.action === '0x00880898' || m.y > gy + 500 || Math.hypot(m.x - cx, m.z - cz) > 400; }, [g, X - 1500, Z]);
  }
  t.check('A shoots Mario out of the cannon', shot, await s.mario());
  await frames(20);
  const flew = await s.mario();
  t.check('he flies away from the cannon', Math.hypot(flew.x - (X - 1500), flew.z - Z) > 400 || flew.y > g + 600, flew);
  // (he may fly off the level: back to it for the next part)
  await frames(60);
  await s.goCustom(levelId);
  await s.play();

  // ---- 3. a painting with an uploaded picture -------------------------------------------------
  const painting = await place('painting', { x: X, y: g, z: Z - 1400, yaw: 0, picture: 'bob' });
  await frames(8);
  // a red picture with a blue square, uploaded through the inspector's "Use your own picture"
  const png = Buffer.from(await s.eval(() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'); x.fillStyle = '#e02020'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#2040e0'; x.fillRect(16, 16, 32, 32);
    return c.toDataURL('image/png').split(',')[1];
  }), 'base64');
  const chooser = page.waitForEvent('filechooser', { timeout: 15000 });
  await s.eval((u) => studio64.worldUI.uploadPicture(studio64.worldFlow.findRecord(u).rec), painting.uid);
  await (await chooser).setFiles({ name: 'my picture.png', mimeType: 'image/png', buffer: png });
  const picOk = await s.until((u) => /^pic_/.test(studio64.worldFlow.findRecord(u)?.rec.painting?.picture || ''), painting.uid, 20000);
  t.check('the painting uses the uploaded picture', picOk);
  await frames(8);
  const pinfo = async () => s.eval((u) => {
    const f = studio64.worldFlow, rec = f.findRecord(u).rec, id = rec.painting.picture;
    const o = studio64.engine.objects().find((x) => x.uid === u);
    const idx = o ? o.bparams >>> 24 : -1;
    let px = null;
    if (idx >= 0x40) {
      const ptr = studio64.engine.M._studio_painting_image(idx - 0x40);
      const v = new Uint16Array(studio64.engine.M.HEAPU8.buffer, ptr, 128 * 128);
      const rgb = (w) => { const s = ((w & 0xff) << 8) | (w >> 8); return [(s >> 11) & 31, (s >> 6) & 31, (s >> 1) & 31]; };
      px = { corner: rgb(v[2 * 128 + 2]), center: rgb(v[64 * 128 + 64]) };
    }
    return { id, stored: !!f.flow().pictures?.[id]?.data, idx, px };
  }, painting.uid);
  const p1 = await pinfo();
  t.log('painting', JSON.stringify(p1));
  t.check('the picture is stored in the project', p1.stored, p1);
  t.check('the engine draws a custom picture', p1.idx >= 0x40, p1);
  t.check('with the uploaded pixels (red corner, blue middle)', p1.px && p1.px.corner[0] > 20 && p1.px.corner[2] < 10 && p1.px.center[2] > 20 && p1.px.center[0] < 10, p1.px);
  const redness = async () => {
    await s.eval(([x, y, z]) => studio64.engine.setCamera(true, [x, y + 300, z + 900], [x, y + 300, z], 40), [X, g, Z - 1400]);
    await frames(8);
    return s.eval(async () => {
      const c = await studio64.engine.captureFrame(2);
      // the red border of the picture (the blue square is in the middle)
      const d = c.getContext('2d').getImageData(Math.round(c.width * 0.16), Math.round(c.height * 0.2), Math.round(c.width * 0.06), Math.round(c.height * 0.06)).data;
      let r = 0, gg = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
      return { r, g: gg, b };
    });
  };
  const seen = await redness();
  await s.shot('painting_picture');
  t.check('the picture shows in the game', seen.r > seen.g * 1.5 && seen.r > seen.b * 1.3, seen);
  await s.eval(() => studio64.engine.setCamera(false));

  // after a reload the picture is still there
  await frames(20);
  await s.reload();
  await page.click('#start').catch(() => {});
  await s.arrive(37);
  await s.eval(() => { window.__fc = 0; studio64.engine.on('frame', () => { window.__fc++; }); });
  await s.until((u) => (studio64.engine.objects().find((x) => x.uid === u)?.bparams >>> 24) >= 0x40, painting.uid, 30000);
  const p2 = await pinfo();
  t.check('after a reload: the custom picture again', p2.idx >= 0x40 && p2.px && p2.px.corner[0] > 20, p2);
  const seen2 = await redness();
  t.check('after a reload: it shows in the game', seen2.r > seen2.g * 1.5, seen2);
  await s.eval(() => studio64.engine.setCamera(false));

  // jumping into it warps (to this level's start)
  await s.eval(({ u, id }) => studio64.worldFlow.link(`c:${id}`, u, { custom: id, area: 1 }, { twoWay: false }), { u: painting.uid, id: levelId });
  await frames(10);
  await s.eval(([x, y, z]) => studio64.engine.teleport(x, y, z, 0x8000), [X, g + 250, Z - 1400 + 40]);
  // (the level's start is in the same area: Mario is put back there, no area load)
  const warped = await s.until(([x, z]) => { const m = studio64.engine.state().mario; return m && Math.hypot(m.x - x, m.z - z) > 900; }, [X, Z - 1400], 30000);
  t.check('jumping into the painting warps', warped, await s.mario());
});
