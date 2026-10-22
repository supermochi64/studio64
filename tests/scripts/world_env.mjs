// Environment and zones: fog, light tint, snow and rain on screen; a water box Mario
// swims in, toxic gas that hurts, a lava pool that burns, an instant warp zone, a
// fading warp zone into another area, a side-scroller camera zone, a death height
// whose fall leads to another area; all of it still there after a reload.
// Screenshots: tests/out/we_*.png
import { open, reopen, newLevel, goArea, place, teleport, walkTo, state, waitKey, check, shot, play } from '../lib/world_lib.mjs';

const { browser, page, proj } = await open();
const weather = await newLevel(page, 'Weather Lab', 'meadow');
const env = (e) => page.evaluate((e) => studio64.worldFlow.setEnv(e), e);
const ground = (x, z) => page.evaluate(({ x, z }) => studio64.engine.floor(x, 20000, z), { x, z });
const actionHas = (a, bit) => (parseInt(a, 16) & bit) !== 0;
// stand Mario on the ground at (x, z)
const tp = async (x, z, up = 20) => teleport(page, x, (await ground(x, z)) + up, z, 0);

await shot(page, 'tests/out/we_plain.png');
await env({ fog: { on: true, color: '#c8d4e8', near: 600, far: 4200 } });
await page.waitForTimeout(1200);
await shot(page, 'tests/out/we_fog.png');
await env({ fog: null, light: { tint: '#ffa860', ambient: 0.3, pitch: 12, yaw: 250, color: '#ffc890' } });
await page.waitForTimeout(1200);
await shot(page, 'tests/out/we_dusk.png');
await env({ light: { tint: '#5a6ab0', ambient: 0.25 }, weather: 'rain', ambient: 'wind' });
await page.waitForTimeout(2000);
await shot(page, 'tests/out/we_rain_night.png');
await env({ light: null, weather: 'snow' });
await page.waitForTimeout(2500);
await shot(page, 'tests/out/we_snow.png');
await env({ weather: 'leaves' });
await page.waitForTimeout(2500);
await shot(page, 'tests/out/we_leaves.png');
check('environment saved', await page.evaluate(() => studio64.world.settings().env?.weather === 'leaves'));

// zones on flat ground (a level of their own, so the meadow's hills and pond don't get in the way)
const id = await newLevel(page, 'Zone Lab', 'flat');
const s0 = await state(page);
await env({ weather: 'leaves', ambient: 'wind' });

// a water box ahead: Mario swims in it
const wx = Math.round(s0.x + 2000), wz = Math.round(s0.z);
const gy = await ground(wx, wz);
await place(page, 'water', { x: wx, y: Math.round(gy - 200), z: wz, size: [1400, 700, 1400] });
await page.waitForTimeout(800);
await teleport(page, wx, gy + 300, wz, 0);
let swam = false;
for (let i = 0; i < 20 && !swam; i++) { await page.waitForTimeout(200); swam = actionHas((await state(page)).action, 0x2000); }
check('swimming in the water box', swam, (await state(page)).action);
await shot(page, 'tests/out/we_water.png');

// toxic gas hurts
const gx = Math.round(s0.x - 2000), gz = Math.round(s0.z);
const gg = await ground(gx, gz);
await place(page, 'gas', { x: gx, y: Math.round(gg - 20), z: gz, size: [1200, 600, 1200] });
await page.waitForTimeout(600);
await tp(gx, gz);
const h0 = (await page.evaluate(() => studio64.engine.state().mario.health));
await page.waitForTimeout(8000);
const h1 = (await page.evaluate(() => studio64.engine.state().mario.health));
check('toxic gas hurts', h1 < h0, `${h0} -> ${h1}`);
await page.evaluate(() => studio64.engine.heal());

// a lava pool burns
const lx = Math.round(s0.x), lz = Math.round(s0.z - 2000);
const lg = await ground(lx, lz);
await place(page, 'lava', { x: lx, y: Math.round(lg), z: lz, size: [800, 120, 800] });
await page.waitForTimeout(600);
await teleport(page, lx, lg + 400, lz, 0);
let burnt = false;
for (let i = 0; i < 25 && !burnt; i++) { await page.waitForTimeout(150); const a = (await state(page)).action; burnt = a === '0x010208B7' || a === '0x010208B4' || a === '0x010208B5'; }
check('the lava pool burns', burnt);
await page.evaluate(() => studio64.engine.heal());
await page.waitForTimeout(2500);

// an instant warp zone to an arrival point in the same area: Mario keeps going
const ax = Math.round(s0.x + 1200), az = Math.round(s0.z + 2400);
const ag = await ground(ax, az);
const arrival = await place(page, 'arrival', { x: ax, y: Math.round(ag), z: az });
const zx = Math.round(s0.x - 900), zz = Math.round(s0.z + 1200);
const zg = await ground(zx, zz);
const zone = await place(page, 'zone', { x: zx, y: Math.round(zg), z: zz, size: [400, 400, 400], transition: 'instant' });
await page.evaluate(({ uid, to }) => studio64.worldFlow.link(studio64.engine.areaKey(), uid, to), { uid: zone.uid, to: { custom: id, area: 1, uid: arrival.uid } });
await page.waitForTimeout(800);
await tp(zx, zz - 500);
await page.waitForTimeout(700);
await tp(zx, zz); // steps into the box
let jumped = null;
for (let i = 0; i < 300 && !jumped; i++) { await page.waitForTimeout(100); const s = await state(page); if (Math.hypot(s.x - ax, s.z - az) < 700) jumped = s; }
check('instant warp zone moved Mario across the level', !!jumped && jumped.key === `c:${id}`, JSON.stringify(jumped));

// a fading warp zone into a new area
const made = await page.evaluate((id) => studio64.worldFlow.createArea(id, { name: 'Basement', template: 'room' }), id);
const fx = Math.round(s0.x + 900), fz = Math.round(s0.z + 1200);
const fg = await ground(fx, fz);
const fade = await place(page, 'zone', { x: fx, y: Math.round(fg), z: fz, size: [400, 400, 400] });
await page.evaluate(({ uid, to }) => studio64.worldFlow.link(studio64.engine.areaKey(), uid, to), { uid: fade.uid, to: { custom: id, area: made.index } });
await page.waitForTimeout(800);
await tp(fx, fz - 500);
await page.waitForTimeout(700);
await tp(fx, fz);
const below = await waitKey(page, (k) => k === `c:${id}:${made.index}`, 45000);
check('fading warp zone -> the basement area', !!below);
await page.waitForTimeout(1500);
await shot(page, 'tests/out/we_basement.png');

// a side-scroller camera zone in the basement
const b0 = await state(page);
await place(page, 'camera', { x: Math.round(b0.x), y: Math.round(b0.y - 50), z: Math.round(b0.z), size: [1600, 600, 1600], mode: 'side' });
await page.evaluate((uid) => { const r = studio64.worldFlow.records().find((x) => x.zone?.kind === 'camera'); studio64.worldFlow.updateRecord(studio64.engine.areaKey(), r.uid, { zone: { ...r.zone, mode: 'side', axis: 90, dist: 1200 } }, 'side camera'); });
await page.waitForTimeout(800);
await teleport(page, b0.x + 100, b0.y + 50, b0.z, 0);
await page.waitForTimeout(1500);
const camYaw = await page.evaluate(() => studio64.engine.state().camera.yaw & 0xffff);
check('side-scroller camera inside the zone', Math.abs(camYaw - ((0x4000 + 0x8000) & 0xffff)) < 600, `camera yaw ${camYaw}`);
await shot(page, 'tests/out/we_side.png');

// back outside: falling below the death height leads to the basement
await page.evaluate((id) => studio64.worldFlow.goArea({ custom: id, area: 1 }), id);
await waitKey(page, (k) => k === `c:${id}`, 20000);
await page.waitForTimeout(1500);
await env({ deathY: 100, fallTo: { custom: id, area: made.index } }); // a pit: here, anything below the grass
await page.waitForTimeout(500);
await teleport(page, s0.x, 700, s0.z, 0); // falls past the death height
const fell = await waitKey(page, (k) => k === `c:${id}:${made.index}`, 45000);
check('falling below the death height -> the basement', !!fell);

// reload: environment and zones are still there
await page.waitForTimeout(1500);
await page.close();
const p2 = await reopen(browser, proj.id);
await p2.waitForTimeout(3000);
// what the project re-applies when the area loads
const after = await p2.evaluate((id) => {
  const a = studio64.engine.patch.areas[`c:${id}`] || {};
  return { env: a.settings?.env, zones: (a.objects || []).filter((r) => r.zone).map((r) => r.zone.kind) };
}, id);
check('environment persists', after.env?.weather === 'leaves' && after.env?.deathY === 100, JSON.stringify(after.env));
check('zones persist', ['water', 'gas', 'lava', 'zone', 'arrival'].every((k) => after.zones.includes(k === 'zone' ? 'warp' : k)), JSON.stringify(after.zones));
await p2.screenshot({ path: 'tests/out/we_reload.png' });
await browser.close();
