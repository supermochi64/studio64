// Studio 64 without AI (and with it). Start the server one way, then run this:
//   STUDIO_AI=off PORT=8072 node server/index.js                     -> EXPECT=off
//   STUDIO_CLAUDE=off STUDIO_AI_CONFIG=/tmp/empty.json PORT=8072 ...  -> EXPECT=off (nothing connected)
//   PORT=8072 node server/index.js                                    -> EXPECT=on
//   EXPECT=off STUDIO_URL=http://127.0.0.1:8072 node tests/scripts/no_ai.mjs
// Checks: no chat, no visible [data-ai] element anywhere we open, the game fills the width,
// normal features work, no console errors. Screenshots tests/out/noai_<expect>_<width>.png
import { chromium } from 'playwright';

const BASE = process.env.STUDIO_URL || 'http://127.0.0.1:8072';
const EXPECT = process.env.EXPECT || 'off';
const off = EXPECT === 'off';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
let failed = 0;
const check = (cond, name) => { console.log(`${cond ? '  ok ' : ' FAIL'} ${name}`); if (!cond) failed++; };
const errors = [];

const cfg = await (await fetch(`${BASE}/api/config`)).json();
check(cfg.ai && cfg.ai.available === !off, `/api/config ai.available = ${cfg.ai?.available} (${cfg.ai?.reason || 'ready'})`);
if (off) check(cfg.models.length === 0, 'no models offered');

// every [data-ai] element and the chat must be invisible
async function noAiVisible(page, where) {
  const shown = await page.evaluate(() => [...document.querySelectorAll('[data-ai], #chat-pane, #composer, #model-btn, .ask-claude, #img-claude, .tab[data-tab=chat]')]
    .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
    .map((e) => e.id || e.className || e.tagName));
  check(off ? !shown.length : true, `${where}: no AI element visible${shown.length ? ` (${shown.join(', ')})` : ''}`);
}

for (const [w, h] of [[1920, 1080], [1280, 800], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => errors.push(`${w}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`${w}: ${m.text().slice(0, 200)}`); });
  const { id } = await (await fetch(`${BASE}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"level":9}' })).json();
  await page.goto(`${BASE}/?p=${id}`);
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 180000 });
  await page.waitForTimeout(2500);
  check(await page.evaluate(() => document.body.classList.contains('no-ai')) === off, `${w}px: body.no-ai is ${off}`);
  const frame = await page.evaluate(() => { const r = document.querySelector('#game-frame').getBoundingClientRect(); return { w: r.width, side: document.querySelector('#side')?.getBoundingClientRect().width || 0 }; });
  if (w > 800) {
    // without AI the game gets the room of the chat column
    if (off) check(frame.w > w * 0.8, `${w}px: game frame ${Math.round(frame.w)}px wide (fills the window)`);
    else check(frame.side > 200, `${w}px: chat column ${Math.round(frame.side)}px`);
  }
  await page.screenshot({ path: `tests/out/noai_${EXPECT}_${w}.png` });
  await noAiVisible(page, `${w}px play`);
  if (w === 1280) {
    // normal features: build mode, the level launcher + new level dialog + image row, edit history, ... menu
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1200);
    check(await page.evaluate(() => !!studio64.editor?.active), 'Tab opens build mode');
    await page.screenshot({ path: `tests/out/noai_${EXPECT}_build.png` });
    await noAiVisible(page, 'build mode');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(800);
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(600);
    const newBtn = await page.$('#launcher .lvl-card.new');
    if (newBtn) {
      await newBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `tests/out/noai_${EXPECT}_newlevel.png` });
      await noAiVisible(page, 'new level dialog');
      const txt = await page.evaluate(() => [...document.querySelectorAll('.img-drop > div > span')].map((e) => e.innerText).join(' '));
      check(off ? !/Claude/.test(txt) : /Claude/.test(txt), `image row says: ${txt.slice(0, 90)}`);
    } else check(false, 'found the New level button');
    await page.evaluate(() => document.querySelector('#launcher-close')?.click());
    await page.waitForTimeout(400);
    await page.click('#menu-btn');
    await page.waitForTimeout(500);
    const items = await page.$$eval('.menu:not([hidden]) .menu-item', (xs) => xs.map((x) => x.textContent));
    check(items.some((t) => /AI assistant/.test(t)), '... menu has "AI assistant…"');
    check(off ? !items.some((t) => /New conversation/.test(t)) : true, '... menu has no "New conversation" without AI');
    await page.click('.menu:not([hidden]) .menu-item:has-text("AI assistant")');
    await page.waitForSelector('.ai-switch');
    await page.screenshot({ path: `tests/out/noai_${EXPECT}_switch.png` });
    const sw = await page.getAttribute('.ai-switch', 'aria-checked');
    const note = await page.textContent('.ai-switch-l');
    check(cfg.ai.forcedOff ? sw === 'false' : off ? /no AI is connected|Off/.test(note) : sw === 'true', `switch: ${note.trim()}`);
    await page.keyboard.press('Escape');
    // the server refuses chat without AI (and starts no session)
    if (off) {
      await page.evaluate(() => studio64.ws.send(JSON.stringify({ type: 'chat', text: 'add a goomba' })));
      await page.waitForTimeout(800);
      const toast = await page.evaluate(() => document.querySelector('#toasts')?.innerText || '');
      check(/AI|off|connected/i.test(toast), `chat refused: ${toast.trim().slice(0, 80)}`);
    }
  }
  await page.close();
}
check(!errors.length, `no console errors${errors.length ? `: ${errors.slice(0, 4).join(' | ')}` : ''}`);
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
