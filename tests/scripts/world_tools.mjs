// Claude's world tools (server/tools/world.js) against the real game: the plug-in runs
// in this process with its rpc going to the page (like the server's websocket rpc).
// add_area (with doors), add_warp (pipe to an original level, star door into the new
// area), add_hazard_zone, set_environment, set_hub, lock_door, world_overview; then
// Mario uses the pipe.
import { z } from 'zod';
import plugin from '../../server/tools/world.js';
import { levelByKey } from '../../server/catalog.js';
import { open, newLevel, state, check, waitKey, teleport, shot } from '../lib/world_lib.mjs';

const { browser, page } = await open();
const id = await newLevel(page, 'Tool Land', 'flat');

const project = { levels: [] };
const syncLevels = async () => { project.levels = await page.evaluate(() => JSON.parse(JSON.stringify(studio64.levels))); };
const findCustom = (q) => {
  const s = String(q).toLowerCase().trim();
  return project.levels.find((l) => l.id === q || l.name.toLowerCase() === s) || project.levels.find((l) => l.name.toLowerCase().includes(s));
};
const ctx = {
  z, opts: {}, project, findCustom, levelByKey,
  tool: (name, desc, schema, handler) => ({ name, desc, schema, handler }),
  card: (name, label, fn) => fn,
  text: (x) => x,
  where: z.object({ mode: z.string().optional(), distance: z.number().optional(), x: z.number().optional(), z: z.number().optional() }).passthrough(),
  rpc: (method, params) => page.evaluate(({ method, params }) => studio64.studio.handle(method, params), { method, params }),
};
const tools = Object.fromEntries(plugin(ctx).map((t) => [t.name, t]));
const call = async (name, args) => { await syncLevels(); const r = await tools[name].handler(args); return r.result; };
check('tool names are unique and present', ['world_overview', 'add_area', 'go_to_area', 'add_warp', 'link_warp', 'modify_warp', 'add_hazard_zone', 'set_environment', 'set_hub', 'lock_door'].every((n) => tools[n]));

const area = await call('add_area', { name: 'Crypt', template: 'cave', door: true });
check('add_area made the area and went there', area.index === 2 && (await state(page)).key === `c:${id}:2`, JSON.stringify(area));
await page.waitForTimeout(1500);

await call('go_to_area', { area: 1 });
await page.waitForTimeout(1500);
check('go_to_area', (await state(page)).key === `c:${id}`);

const pipe = await call('add_warp', { kind: 'pipe', where: { mode: 'in_front', distance: 500 }, to: { level: 'Bob-omb Battlefield' } });
check('pipe to Bob-omb Battlefield', pipe.linked?.changes === 1, JSON.stringify(pipe));
const door = await call('add_warp', { kind: 'door', where: { mode: 'in_front', distance: 400 }, yaw_deg: 0, stars: 3, to: { area: 'Crypt' } });
check('star door into the crypt', !!door.uid && door.linked?.changes >= 1, JSON.stringify(door));
const zone = await call('add_hazard_zone', { kind: 'water', where: { mode: 'in_front', distance: 1500 }, size: [800, 300, 800] });
check('water zone', !!zone.uid);
await call('set_environment', { fog: { on: true, color: '#d0c8f0', near: 1000, far: 7000 }, weather: 'snow', camera: { mode: 'open' }, ambient: 'wind' });
const envNow = await page.evaluate(() => studio64.world.settings().env);
check('set_environment', envNow.fog?.on && envNow.weather === 'snow' && envNow.camera?.mode === 'open', JSON.stringify(envNow));
await call('set_hub', { start: 'here', hub: 'here', star_goal: 10, goal_message: 'You did it!' });
const flow = await page.evaluate(() => studio64.worldFlow.flow());
check('set_hub', flow.hub?.custom === id && flow.start?.custom === id && flow.goal?.stars === 10, JSON.stringify(flow));
const locked = await call('lock_door', { uid: door.uid, locked: true });
check('lock_door', locked.ok === true);
const ov = await call('world_overview', {});
check("world_overview lists levels, areas and warps", ov.levels.some((l) => l.areas.length === 2) && ov.warps.length >= 4, JSON.stringify(ov.warps.map((w) => [w.key, w.kind, w.name, w.to_name])));
await shot(page, 'tests/out/wt_tools.png');

// Mario uses the pipe: standing on it takes him to Bob-omb Battlefield
const p = await page.evaluate((uid) => studio64.worldFlow.findRecord(uid).rec, pipe.uid);
await teleport(page, p.x, p.y + 300, p.z, 0);
const bob = await waitKey(page, (k) => k.startsWith('9:'), 45000);
check('the pipe leads to Bob-omb Battlefield', !!bob, JSON.stringify(bob));
await browser.close();
