// Shared helpers for the promo captures: open the studio, frame-exact stepping, bot, capture.
import { chromium } from 'playwright';
import fs from 'node:fs';
export const URL = process.env.STUDIO_URL || 'http://127.0.0.1:8094';
export const api = async (p, b) => (await fetch(URL + p, { method: b ? 'POST' : 'GET', headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined })).json();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openStudio({ level = 16, project, name = 'Castle fight', viewport = { width: 1920, height: 1080 }, dpr = 1, args = [] } = {}) {
  const id = project || (await api('/api/projects', { level, name })).id;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--mute-audio', ...args] });
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console.error', m.text().slice(0, 200)); });
  page.on('dialog', (d) => d.accept());
  await page.goto(`${URL}/?p=${id}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.studio64?.engine?.ready && window.studio64?.editor && document.querySelector('#loading').hidden, null, { timeout: 600000, polling: 500 });
  await page.click('#start').catch(() => {});
  await sleep(1500);
  // the star select screen of a course: press A (Space) until Mario stands in the level
  for (let t0 = Date.now(); Date.now() - t0 < 300000;) {
    const st = await page.evaluate((lv) => { const e = studio64.engine; try { return { intro: !!e.inIntro, ok: e.level === lv && !e.inIntro && !!e.state().mario }; } catch { return { intro: false, ok: false }; } }, level);
    if (st.ok) break;
    if (st.intro) { await page.keyboard.down('Space'); await sleep(150); await page.keyboard.up('Space'); }
    await sleep(700);
  }
  await sleep(1000);
  await installHelpers(page);
  return { browser, ctx, page, id };
}

export async function installHelpers(page) {
  await page.evaluate(() => {
    const e = studio64.engine, M = e.M;
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    window.P = {
      M,
      freeze() { M._studio_debug_speed(1, 1); if (studio64.testing) studio64.testing.frozen = true; }, // (frozen: the hang watchdog waits)
      run() { M._studio_debug_speed(0, 1); if (studio64.testing) studio64.testing.frozen = false; },
      frames() { return M._studio_debug_frames(); },
      async step(n = 1) {
        const f0 = M._studio_debug_frames();
        M._studio_debug_step(n);
        for (let i = 0; i < 100000 && M._studio_debug_frames() < f0 + n; i++) await raf();
      },
      obj(slot) { return JSON.parse(M.UTF8ToString(M._studio_debug_obj_json(slot))); },
      mario() { return JSON.parse(M.UTF8ToString(M._studio_debug_mario_json())); },
      objects() { return e.objects(); },
      bot(on, buttons = 0, yaw = 0, mag = 0) { M._studio_bot(on ? 1 : 0, buttons | 0, yaw | 0, mag); },
      tap(on, music = 0) { M._studio_audio_tap(on ? 1 : 0, music); },
      tapRead() {
        const n = M._studio_audio_tap_len();
        const ptr = M._studio_audio_tap_ptr();
        const a = new Int16Array(M.HEAPU8.buffer, ptr, n).slice();
        M._studio_audio_tap_clear();
        // base64 of the bytes
        const u8 = new Uint8Array(a.buffer);
        let s = '';
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return btoa(s);
      },
      cam(on, pos, focus, fov = 50) { e.setCamera(on, pos, focus, fov); },
      spawn(rec) { return e.spawn({ uid: 1 + Math.floor(Math.random() * 0x7efffffe), pitch: 0, roll: 0, bparams: 0, ...rec }); },
      floor(x, z, y = 5000) { return e.floor(x, y, z); },
      // runs n frames and returns the last one as an image (full canvas resolution)
      async stepShot(n = 1, type = 'image/png', q) {
        if (n > 1) await P.step(n - 1);
        const p = e.captureFrame(0);
        M._studio_debug_step(1);
        const c = await p;
        return c.toDataURL(type, q);
      },
    };
  });
}

export const B = { A: 0x8000, B: 0x4000, Z: 0x2000, START: 0x1000, R: 0x0010, L: 0x0020 };
export const ACT = { PICKING_UP_BOWSER: 0x390, HOLDING_BOWSER: 0x391, RELEASING_BOWSER: 0x392 };

export function saveDataUrl(file, url) {
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
}
