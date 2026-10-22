// The World tab by hand: new area with a door into it (dialog), placing a pipe by
// clicking, linking it by clicking its destination in another area, environment
// controls, and the world map. Screenshots: tests/out/wu_*.png
import { open, newLevel, state, check, shot, waitKey, play } from '../lib/world_lib.mjs';

const { browser, page, errors } = await open({ width: 1440, height: 900 });
const id = await newLevel(page, 'Hand Made', 'meadow');
await page.click('#mode-build');
await page.waitForTimeout(600);
await page.click('.lib-tab[data-lib=world]');
await page.waitForTimeout(400);
await shot(page, 'tests/out/wu_tab.png');
check('world tab shows', await page.isVisible('#lib-world .wd-head'));

// new area through the dialog, with a door into it
await page.click('#lib-world .wd-area.add');
await page.waitForTimeout(300);
await page.fill('#wd-area-name', 'Cellar');
await page.click('.wd-tpl[data-t=cave]');
await shot(page, 'tests/out/wu_newarea.png');
await page.click('#wd-area-ok');
await page.waitForTimeout(2500);
const areas = await page.evaluate((id) => studio64.worldFlow.areasOf(id), id);
check('area made from the dialog', areas.some((a) => a.name === 'Cellar'), JSON.stringify(areas));
const doors = await page.evaluate(() => studio64.worldFlow.allWarps().filter((w) => w.kind === 'door').map((w) => [w.key, w.to && w.to.area]));
check('a door pair connects the areas', doors.length === 2, JSON.stringify(doors));

// place a pipe by clicking in the view
const ov = await page.locator('#overlay').boundingBox();
await page.click('#lib-world .wd-item[data-kind=pipe]');
await page.mouse.move(ov.x + ov.width * 0.42, ov.y + ov.height * 0.7);
await page.waitForTimeout(200);
await page.mouse.move(ov.x + ov.width * 0.45, ov.y + ov.height * 0.72);
await page.waitForTimeout(200);
await page.mouse.click(ov.x + ov.width * 0.45, ov.y + ov.height * 0.72);
await page.waitForTimeout(600);
const pipe = await page.evaluate(() => studio64.worldFlow.records().find((r) => r.warp?.kind === 'pipe'));
check('pipe placed by clicking', !!pipe);
await shot(page, 'tests/out/wu_pipe.png');

// link it: pick the Cellar in the destination list, then click a spot there
if (pipe) {
  await page.evaluate((uid) => studio64.worldUI.selectUid(uid), pipe.uid);
  await page.waitForTimeout(400);
  await page.click('#inspector [data-w=link]');
  await page.waitForTimeout(400);
  await shot(page, 'tests/out/wu_dest.png');
  await page.locator('.wd-dest', { hasText: 'Cellar' }).first().click();
  const there = await waitKey(page, (k) => k === `c:${id}:2`, 20000);
  check('went to the destination to pick a spot', !!there);
  await page.waitForTimeout(1500);
  await page.waitForSelector('.wd-pick', { timeout: 5000 }).catch(() => {});
  await shot(page, 'tests/out/wu_pick.png');
  const ov2 = await page.locator('#overlay').boundingBox();
  await page.mouse.move(ov2.x + ov2.width * 0.5, ov2.y + ov2.height * 0.75);
  await page.waitForTimeout(200);
  await page.mouse.click(ov2.x + ov2.width * 0.5, ov2.y + ov2.height * 0.75);
  const back = await waitKey(page, (k) => k === `c:${id}`, 20000);
  check('came back after picking', !!back);
  await page.waitForTimeout(1500);
  const linked = await page.evaluate((uid) => studio64.worldFlow.findRecord(uid)?.rec.warp.to, pipe.uid);
  check('pipe linked to an arrival point in the cellar', linked?.area === 2 && !!linked?.uid, JSON.stringify(linked));
  await shot(page, 'tests/out/wu_linked.png');
}

// environment: fog + rain through the panel
await page.click('.lib-tab[data-lib=world]').catch(() => {});
await page.evaluate(() => studio64.editor.select(null));
await page.waitForTimeout(300);
await page.check('#lib-world [data-k="fog.on"]');
await page.waitForTimeout(400);
await page.selectOption('#lib-world [data-k=weather]', 'rain');
await page.waitForTimeout(600);
const env = await page.evaluate(() => studio64.world.settings().env);
check('fog and rain saved', env?.fog?.on === true && env?.weather === 'rain', JSON.stringify(env));
await play(page);
await page.waitForTimeout(1500);
await shot(page, 'tests/out/wu_env.png');

// the world map
await page.evaluate(() => studio64.worldUI.map.open());
await page.waitForTimeout(800);
const nodes = await page.$$eval('.wd-node', (n) => n.length);
check('map shows the areas', nodes >= 2, `${nodes} nodes`);
await shot(page, 'tests/out/wu_map.png');
await page.click('.wd-node[data-key$=":2"]');
const viaMap = await waitKey(page, (k) => k === `c:${id}:2`, 20000);
check('clicking the map goes there', !!viaMap);
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
