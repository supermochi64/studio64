// A hack without the castle: a custom hub (also the start) with a painting into a
// course, a star door, a key door and an event-locked door. Mario jumps into the
// painting, gets the course's star and lands back in front of the painting; dying and
// Exit Course also return to the hub; the star door shows its message; the key door
// opens once the key is collected; lock_door locks and unlocks by uid.
import { open, reopen, newLevel, goArea, place, walkTo, teleport, state, waitKey, check, shot } from '../lib/world_lib.mjs';

const { browser, page, proj } = await open();
const press = async (key, ms = 120) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
const focusGame = () => page.evaluate(() => document.querySelector('#canvas').focus());
// the act selector / course complete screens wait for A
async function pressUntil(pred, ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await state(page).catch(() => null);
    if (s && await pred(s)) return s;
    await focusGame();
    await press('Space');
    await page.waitForTimeout(500);
  }
  return null;
}
const inIntro = () => page.evaluate(() => studio64.engine.inIntro);

// the course: a star on the ground in front of the start
const course = await newLevel(page, 'Star Course', 'flat');
const c0 = await state(page);
await page.evaluate(({ x, z }) => {
  const ed = studio64.editor;
  const rec = ed.makeRecord({ entry: 'star', star: { name: 'Test Star' } }, { p: [x, 0, z], yaw: 0 }, 1 + Math.floor(Math.random() * 1e9));
  studio64.worldFlow.addRecord(rec, 'Added a star');
}, { x: Math.round(c0.x + 500), z: Math.round(c0.z) });

// the hub: start and hub of the hack
const hub = await newLevel(page, 'Hub Town', 'flat');
await page.evaluate((hub) => studio64.worldFlow.setFlow({ start: { custom: hub, area: 1 }, hub: { custom: hub, area: 1 } }), hub);
const h0 = await state(page);
const paintZ = Math.round(h0.z + 900);
const painting = await place(page, 'painting', { x: Math.round(h0.x), y: 0, z: paintZ, yaw: 0x8000, picture: 'wf' });
await page.evaluate(({ uid, course }) => studio64.worldFlow.link(studio64.engine.areaKey(), uid, { custom: course, area: 1 }), { uid: painting.uid, course });
await page.waitForTimeout(800);

// jump into the painting (falling into it from just in front)
await teleport(page, h0.x, 250, paintZ - 40, 0);
const entered = await waitKey(page, (k) => k === `c:${course}`, 20000);
check('jumped into the painting -> the course', !!entered, JSON.stringify(entered));
await page.waitForTimeout(1500);
if (await inIntro()) await pressUntil(async () => !(await inIntro()));
await page.waitForTimeout(1000);

// collect the star: the course complete screen, then back to the hub in front of the painting
const s1 = await state(page);
await teleport(page, c0.x + 500, 120, c0.z, 0);
await page.waitForTimeout(3000);
const back = await pressUntil(async (s) => s.key === `c:${hub}` && s.x !== undefined, 40000);
check('star -> back in the hub', !!back, JSON.stringify(back));
if (back) {
  await page.waitForTimeout(2500);
  const s = await state(page);
  check('came out in front of the painting', Math.hypot(s.x - h0.x, s.z - paintZ) < 900, `${Math.round(s.x)},${Math.round(s.z)} painting at ${Math.round(h0.x)},${paintZ}`);
  await shot(page, 'tests/out/wf_back.png');
  // the course complete screen comes up in the hub, like in the castle: A closes it
  // and its save menu (A = Save & continue), then Mario stands in the hub
  await page.waitForTimeout(1500);
  await pressUntil(async (s) => !['0x0000192D', '0x00001327'].includes(s.action) && s.action !== undefined, 30000);
  await page.waitForTimeout(1500);
}
check('the hub pauses like the castle (hub flag)', await page.evaluate(() => studio64.engine.M._studio_set_hub !== undefined));

// star door: needs 5 stars, Mario has 1
const h1 = await state(page);
const starDoor = await place(page, 'door', { x: Math.round(h1.x + 700), y: 0, z: Math.round(h1.z), yaw: 0x4000 * 3, style: 'star', stars: 5 });
await page.waitForTimeout(500);
await teleport(page, h1.x + 400, 20, h1.z, 90);
await page.waitForTimeout(800);
await walkTo(page, h1.x + 700, h1.z, 60);
let reading = false;
for (let i = 0; i < 30 && !reading; i++) { await page.waitForTimeout(150); reading = (await state(page)).action === '0x20001305'; }
check('star door: Mario reads "you need N stars"', reading);
await page.waitForTimeout(900);
await shot(page, 'tests/out/wf_stardoor.png');
await pressUntil(async (s) => s.action !== '0x20001305', 8000);
check('star door did not warp', (await state(page)).key === `c:${hub}`);
await page.waitForTimeout(800);

// key door into a new area of the hub
const made = await page.evaluate((hub) => studio64.worldFlow.createArea(hub, { name: 'Vault', template: 'room' }), hub);
await page.waitForTimeout(800);
const h2 = await state(page);
const keyDoor = await place(page, 'door', { x: Math.round(h2.x - 700), y: 0, z: Math.round(h2.z), yaw: 0x4000, style: 'key', key: 0 });
await page.evaluate(({ uid, hub, idx }) => studio64.worldFlow.link(studio64.engine.areaKey(), uid, { custom: hub, area: idx }), { uid: keyDoor.uid, hub, idx: made.index });
await page.waitForTimeout(600);
const tryDoor = async (dx, label) => {
  await teleport(page, h2.x - 400, 20, h2.z, 270);
  await page.waitForTimeout(800);
  await walkTo(page, h2.x - 700, h2.z, 80);
  const t0 = Date.now();
  while (Date.now() - t0 < 7000) {
    const s = await state(page);
    if (s.action === '0x20001305') return 'message';
    if (s.key !== `c:${hub}`) return 'warped';
    await page.waitForTimeout(150);
  }
  return 'nothing';
};
check('key door without the key: message', (await tryDoor()) === 'message');
await pressUntil(async (s) => s.action !== '0x20001305', 8000);
// the key: Mario walks over it
const key = await place(page, 'key', { x: Math.round(h2.x), y: 0, z: Math.round(h2.z + 400), key: 0 });
await page.waitForTimeout(500);
await teleport(page, h2.x, 40, h2.z + 400, 0);
await page.waitForTimeout(1500);
check('key collected', await page.evaluate(() => (studio64.worldFlow.keysMask() & 1) === 1));
const r = await tryDoor();
check('key door with the key: opens into the vault', r === 'warped' || (await waitKey(page, (k) => k === `c:${hub}:${made.index}`, 8000)) !== null, r);
await waitKey(page, (k) => k === `c:${hub}:${made.index}`, 12000);
await shot(page, 'tests/out/wf_vault.png');

// events lock and unlock doors by uid (the story's events use this)
await goArea(page, { custom: hub, area: 1 });
await page.evaluate((uid) => studio64.studio.handle('door_lock', { uid, locked: true }), keyDoor.uid);
check('locked by an event: message instead of warp', (await tryDoor()) === 'message');
await pressUntil(async (s) => s.action !== '0x20001305', 8000);
await page.evaluate((uid) => studio64.studio.handle('door_lock', { uid, locked: false }), keyDoor.uid);
const r2 = await tryDoor();
check('unlocked again: it opens', r2 === 'warped' || (await waitKey(page, (k) => k !== `c:${hub}`, 6000)) !== null, r2);
await waitKey(page, (k) => k === `c:${hub}:${made.index}`, 12000);

// dying in the course returns to the hub
await goArea(page, { custom: course, area: 1 });
const lives0 = (await state(page)).lives;
await teleport(page, c0.x + 12000, -5800, c0.z + 12000, 0);
const died = await pressUntil(async (s) => s.key === `c:${hub}`, 30000);
check('falling off the course -> back in the hub', !!died, JSON.stringify(died));

// Exit Course from the pause menu returns to the hub too
await goArea(page, { custom: course, area: 1 });
await page.waitForTimeout(1000);
await focusGame();
await press('Enter');
await page.waitForTimeout(1200);
await press('KeyS', 150);
await page.waitForTimeout(400);
await shot(page, 'tests/out/wf_pause.png');
await press('Space');
const exited = await waitKey(page, (k) => k === `c:${hub}`, 20000);
check('Exit Course -> the hub', !!exited, JSON.stringify(exited));

// everything is still there after a reload
await page.waitForTimeout(1500);
await page.close();
const p2 = await reopen(browser, proj.id);
await p2.waitForTimeout(3000);
const f = await p2.evaluate(() => ({ flow: studio64.worldFlow.flow(), warps: studio64.worldFlow.allWarps().map((w) => [w.kind, w.stars, w.key_needed]) }));
check('flow persists', f.flow.hub?.custom === hub && f.flow.start?.custom === hub, JSON.stringify(f.flow));
check('warps persist', f.warps.length >= 3, JSON.stringify(f.warps));
await browser.close();
