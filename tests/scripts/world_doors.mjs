// Areas and doors: a custom level gets a second area (a room); a door outside leads
// into it and the room's door leads back out. Mario walks through both ways, the
// layout survives a reload, and the warps show up on the world map.
import { open, reopen, newLevel, goArea, place, walkTo, teleport, state, waitKey, check, shot } from '../lib/world_lib.mjs';

const { browser, page, proj } = await open();
const id = await newLevel(page, 'Door Town', 'flat');
check('in the new level', (await state(page)).key === `c:${id}`);

// a room as area 2
const made = await page.evaluate((id) => studio64.worldFlow.createArea(id, { name: 'Shop', template: 'room' }), id);
check('area created', made.index === 2, JSON.stringify(made));

// the room's door, near its back wall, facing into the room
await goArea(page, { custom: id, area: 2 });
check('in the room', (await state(page)).key === `c:${id}:2`);
const inner = await place(page, 'door', { x: 0, y: 0, z: 1150, yaw: 0x8000, style: 'wood' });
await page.waitForTimeout(500);
await shot(page, 'tests/out/wd_room.png');

// outside: a door 600 in front of the spawn, linked two-way to the room's door
await goArea(page, { custom: id, area: 1 });
const s0 = await state(page);
const floorY = await page.evaluate(({ x, z }) => studio64.engine.floor(x, 3000, z), { x: s0.x, z: s0.z + 600 });
const outer = await place(page, 'door', { x: Math.round(s0.x), y: Math.round(floorY), z: Math.round(s0.z + 600), yaw: 0, style: 'castle' });
await page.evaluate(({ id, uidA, uidB }) => studio64.worldFlow.link(`c:${id}`, uidA, { custom: id, area: 2, uid: uidB }), { id, uidA: outer.uid, uidB: inner.uid });
await page.waitForTimeout(800);
const warps = await page.evaluate(() => studio64.engine.warps());
check('door warp node registered', warps.some((w) => w.id === outer.warp.node && w.destArea === 2), JSON.stringify(warps.filter((w) => w.id >= 0x80)));

// walk into the door from its front (doors open from either side)
await teleport(page, s0.x, floorY + 20, s0.z + 300, 0);
await page.waitForTimeout(900);
await walkTo(page, s0.x, s0.z + 600, 120);
const inRoom = await waitKey(page, (k) => k === `c:${id}:2`, 20000);
check('walked through the door into the room', !!inRoom, JSON.stringify(inRoom));
if (inRoom) check('came out at the room door', Math.hypot(inRoom.x - 0, inRoom.z - 1150) < 600, `${inRoom.x},${inRoom.z}`);
await page.waitForTimeout(1500);
await shot(page, 'tests/out/wd_inside.png');

// back out through the room's door
const r1 = await state(page);
await walkTo(page, 0, 1150, 150);
const outside = await waitKey(page, (k) => k === `c:${id}`, 20000);
check('walked back out', !!outside, JSON.stringify(outside));
if (outside) check('came out at the outside door', Math.hypot(outside.x - s0.x, outside.z - (s0.z + 600)) < 600, `${outside.x},${outside.z}`);

// the map knows both
const g = await page.evaluate(() => studio64.worldFlow.graph());
check('map has both areas and both directions', g.nodes.some((n) => n.key === `c:${id}:2`) && g.edges.filter((e) => e.kind === 'door').length === 2, JSON.stringify(g.edges));

// reload: still two areas, doors linked
await page.waitForTimeout(1200);
await page.close();
const p2 = await reopen(browser, proj.id);
await p2.waitForTimeout(3000);
const after = await p2.evaluate((id) => ({ areas: studio64.worldFlow.areasOf(id), warps: studio64.worldFlow.allWarps().map((w) => [w.key, w.kind, w.to && (w.to.area || 1)]) }), id);
check('areas persist', after.areas.length === 2 && after.areas[1].name === 'Shop', JSON.stringify(after.areas));
check('door links persist', after.warps.length === 2, JSON.stringify(after.warps));
await browser.close();
