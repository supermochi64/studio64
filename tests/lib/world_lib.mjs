// Shared helpers for the world tests (areas, warps, flow, environment).
import { chromium } from 'playwright';

export const URL = process.env.STUDIO_URL || 'http://127.0.0.1:8064';

export async function open({ width = 1280, height = 800 } = {}) {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const proj = await (await fetch(URL + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 9 }) })).json();
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('pageerror:', e.message); });
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 300)); if (/warp refused|abort/i.test(m.text())) console.log('[game]', m.text().slice(0, 200)); });
  await page.goto(URL + '/?p=' + proj.id, { timeout: 180000 });
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 300000 });
  await page.click('#start').catch(() => {});
  await page.waitForTimeout(1500);
  return { browser, page, proj, errors };
}

export async function reopen(browser, projId, { width = 1280, height = 800 } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(URL + '/?p=' + projId, { timeout: 180000 });
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 300000 });
  await page.click('#start').catch(() => {});
  await page.waitForTimeout(1500);
  return page;
}

export const state = (page) => page.evaluate(() => {
  const e = studio64.engine;
  const m = e.state().mario || {};
  return { key: e.areaKey(), level: e.level, area: e.area, x: m.x, y: m.y, z: m.z, yaw: m.yaw, action: m.action, stars: m.stars, lives: m.lives };
});

// Wait until Mario is somewhere new (area key changes) and standing in it.
export async function waitKey(page, pred, ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await state(page).catch(() => null);
    if (s && s.x !== undefined && pred(s.key, s)) { await page.waitForTimeout(800); return state(page); }
    await page.waitForTimeout(250);
  }
  return null;
}

// A custom level from a template, created like the launcher does, and Mario in it.
export async function newLevel(page, name = 'World Test', template = 'flat') {
  // custom levels share one slot: wait for the area to really load (the key changes at once)
  const id = await page.evaluate(async ({ name, template }) => {
    const e = studio64.engine;
    const arrived = e.waitArrival(e.studioLevel, 40000);
    const id = studio64.levelsUI.createLevel(template, null, name);
    await arrived;
    return id;
  }, { name, template });
  await waitKey(page, (k) => k === `c:${id}`);
  await page.waitForFunction(() => !studio64.engine.inIntro, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  if (await page.evaluate(() => studio64.editor?.active)) await page.evaluate(() => studio64.editor.exit());
  return id;
}

export async function goArea(page, to) {
  await page.evaluate(async (to) => {
    const e = studio64.engine;
    const arrived = e.waitArrival(to.custom ? e.studioLevel : to.level, 40000);
    studio64.worldFlow.goArea(to);
    await arrived;
  }, to);
  const key = to.custom ? (to.area > 1 ? `c:${to.custom}:${to.area}` : `c:${to.custom}`) : `${to.level}:${to.area || 1}`;
  const s = await waitKey(page, (k) => k === key);
  await page.waitForFunction(() => !studio64.engine.inIntro, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);
  if (await page.evaluate(() => studio64.editor?.active)) await page.evaluate(() => studio64.editor.exit());
  return s;
}

// Place a warp-kind record through the flow (like the World tab does) at a spot.
export const place = (page, kind, opts) => page.evaluate(({ kind, opts }) => {
  const f = studio64.worldFlow;
  const rec = f.makeWarpRecord(kind, opts);
  f.addRecord(rec);
  return rec;
}, { kind, opts });

// Mario walks toward (x, z) for a number of frames (the test autopilot).
export async function walkTo(page, x, z, frames = 90) {
  await page.evaluate(({ x, z, frames }) => {
    const m = studio64.engine.state().mario;
    const yaw = Math.round((Math.atan2(x - m.x, z - m.z) / Math.PI) * 32768) & 0xffff;
    studio64.engine.M._studio_walk(((yaw << 16) >> 16), frames);
  }, { x, z, frames });
}

export const teleport = (page, x, y, z, yawDeg = 0) => page.evaluate(({ x, y, z, yawDeg }) => studio64.engine.teleport(x, y, z, Math.round((yawDeg / 360) * 65536)), { x, y, z, yawDeg });

export const shot = (page, path) => page.screenshot({ path });

export function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
  return ok;
}

// Build mode with the editor camera at `pos` looking at `target` (for close-up shots).
export async function view(page, pos, target, fov = 50) {
  await page.evaluate(({ pos, target, fov }) => {
    const ed = studio64.editor;
    if (!ed.active) ed.enter();
    const d = [target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]];
    Object.assign(ed.cam, { x: pos[0], y: pos[1], z: pos[2], yaw: Math.atan2(d[0], d[2]), pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])), fov });
    ed.pushCamera();
  }, { pos, target, fov });
  await page.waitForTimeout(700);
}

export async function play(page) {
  await page.evaluate(() => { if (studio64.editor.active) studio64.editor.exit(); });
  await page.waitForTimeout(400);
}
