// What the world tools look like in build mode: zones as coloured boxes with labels,
// a door's inspector (destination, stars, key, lock), a painting's picture picker,
// and the same spot while playing (zones hidden). Screenshots: tests/out/wl_*.png
import { open, newLevel, place, state, check, shot, view, play } from '../lib/world_lib.mjs';

const { browser, page, errors } = await open({ width: 1440, height: 900 });
const id = await newLevel(page, 'Look Around', 'flat');
const s0 = await state(page);
const x = Math.round(s0.x), z = Math.round(s0.z);
await place(page, 'water', { x: x - 900, y: -200, z: z + 900, size: [800, 300, 800] });
await place(page, 'death', { x: x + 900, y: -100, z: z + 900, size: [800, 200, 800] });
await place(page, 'camera', { x, y: 0, z: z + 1800, size: [900, 500, 900], mode: 'side' });
await place(page, 'zone', { x: x - 900, y: 0, z: z + 1800, size: [300, 300, 300] });
const door = await place(page, 'door', { x, y: 0, z: z + 700, yaw: 0x8000, style: 'star', stars: 3 });
const painting = await place(page, 'painting', { x: x + 700, y: 0, z: z + 1400, yaw: 0x8000, picture: 'lll' });
await view(page, [x, 1300, z - 900], [x, 0, z + 1300]);
await page.evaluate(() => document.querySelector('.lib-tab[data-lib=world]')?.click());
await page.waitForTimeout(800);
await shot(page, 'tests/out/wl_zones.png');
await page.evaluate((uid) => studio64.worldUI.selectUid(uid), door.uid);
await page.waitForTimeout(800);
check('door inspector shows the warp section', await page.isVisible('#inspector .wd-insp'));
await shot(page, 'tests/out/wl_door.png');
await page.evaluate((uid) => studio64.worldUI.selectUid(uid), painting.uid);
await page.waitForTimeout(800);
check('painting picker', (await page.$$('#inspector .wd-pic')).length >= 11);
await page.click('#inspector .wd-pic[data-pic=ttc]');
await page.waitForTimeout(800);
check('picture changed', await page.evaluate((uid) => studio64.worldFlow.findRecord(uid).rec.painting.picture === 'ttc', painting.uid));
await view(page, [x + 700, 300, z + 700], [x + 700, 300, z + 1400]);
await shot(page, 'tests/out/wl_painting.png');
await view(page, [x, 1300, z - 900], [x, 0, z + 1300]);
await play(page);
await page.waitForTimeout(1200);
await shot(page, 'tests/out/wl_play.png');
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
