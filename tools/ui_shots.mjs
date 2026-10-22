#!/usr/bin/env node
// The README screenshots (docs/img/*.png): a fresh showcase project, driven like a user would.
//
//   STUDIO_URL=http://127.0.0.1:8064 node tools/ui_shots.mjs          # all shots
//   NO_AI=1 node tools/ui_shots.mjs                                    # skip the two chat requests
//   ONLY=story,sound node tools/ui_shots.mjs                           # some of them
//   SEED=1 ...    also adds the four sample hacks (for the home screen); best on a scratch server:
//                 PORT=8099 STUDIO_PROJECTS=/tmp/s64shots node server/index.js
//
// Needs a running server and Chrome (tools/lib/browser.mjs finds it).
import { launchBrowser } from './lib/browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'img');
const URL_BASE = (process.env.STUDIO_URL || 'http://127.0.0.1:8064').replace(/\/$/, '');
const W = Number(process.env.W) || 1600, H = Number(process.env.H) || 1000;
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const want = (n) => !ONLY || ONLY.has(n);
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('page error:', e.message));
const wait = (ms) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = async (name) => { await wait(400); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('  docs/img/' + name + '.png'); };
const escape = async () => { await page.keyboard.press('Escape'); await wait(300); };

const seeded = {};
if (process.env.SEED) {
  for (const sample of ['two-worlds.s64hack', 'star-isles.s64hack', 'frost-peak.s64hack', 'castle-remix.s64hack']) {
    const r = await fetch(`${URL_BASE}/api/hub/create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sample }) }).then((x) => x.json()).catch(() => null);
    seeded[sample] = r?.id || r?.project?.id;
  }
}
const project = await fetch(`${URL_BASE}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 9, name: 'Bob-omb Remix' }) }).then((r) => r.json());
await page.addInitScript(() => { try { localStorage.setItem('studio64.tourDone', '1'); for (const k of ['build', 'docked']) localStorage.setItem(`studio64.hint.${k}`, '1'); } catch { /* */ } });
for (let i = 0; ; i++) {
  try {
    await page.goto(`${URL_BASE}/?p=${project.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#loading', { state: 'hidden', timeout: 90000 });
    break;
  } catch (e) { if (i >= 4) throw e; console.log('  the game did not load, trying again'); await wait(15000); }
}
await wait(2500);
await page.click('#start').catch(() => {});
await wait(1500);

const idle = async (timeout = 240000) => {
  const t0 = Date.now();
  await wait(1500);
  while (Date.now() - t0 < timeout) { if (!(await ev(() => studio64.busy))) return; await wait(1000); }
};
const say = async (text) => {
  await page.click('#input');
  await page.fill('#input', text);
  await page.keyboard.press('Enter');
  await idle();
};

// play + chat
if (want('play')) {
  if (!process.env.NO_AI) {
    await say('Add 2 Bob-ombs in front of me');
    await say('Put a ring of coins around me');
  }
  await page.click('#canvas', { position: { x: 200, y: 200 } }).catch(() => {});
  await wait(2500);
  await shot('play');
}

// the command palette
if (want('palette')) {
  await page.keyboard.press('Control+p');
  await wait(300);
  await page.keyboard.type('ter');
  await shot('palette');
  await escape();
}

// build mode with the object library
if (want('build')) {
  await page.click('#mode-build');
  await wait(1500);
  await page.click('.lib-tab[data-lib=objects]');
  await wait(1200);
  await shot('build');
  await page.click('#mode-play');
  await wait(800);
}

// a new level from a template, sculpted in build mode
if (want('terrain') || want('world')) {
  await ev(() => studio64.levelsUI.createLevel('island', null, 'Pirate Island'));
  await wait(9000);
  await page.keyboard.press('Enter').catch(() => {}); // the star screen
  await wait(4000);
  if (!(await ev(() => studio64.editor.active))) await page.click('#mode-build');
  await wait(1500);
  await page.click('.lib-tab[data-lib=terrain]');
  await wait(600);
  await page.click('#overlay', { position: { x: 300, y: 300 } }).catch(() => {});
  await page.keyboard.press('Shift+Home');
  await wait(2500);
  if (want('terrain')) await shot('terrain');
  if (want('world')) {
    // doors, pipes, paintings, warp zones and areas: the World tool
    await page.click('.lib-tab[data-lib=world]');
    await wait(1200);
    await shot('world');
  }
  await page.click('#mode-play');
  await wait(800);
}

// story with a dialog
if (want('story')) {
  await ev(() => {
    const ui = studio64.storyUI;
    ui.open('dialogs');
    const d = ui.newDialog({ name: 'Toad at the bridge', text: 'Mario! The bridge to the summit\nfell into the water.\nFind the 8 red coins and the\nKoopa engineers will rebuild it!' });
    ui.sel.dialogs = d.id;
    ui.render();
  });
  await wait(1500);
  await shot('story');
  await escape();
}

// sound studio with a starter song
if (want('sound')) {
  await page.click('#sound-btn');
  await wait(1000);
  await page.click('.starter >> nth=0').catch(() => {});
  await wait(2000);
  await shot('sound');
  await escape();
}

// assets: the game's textures
if (want('assets')) {
  await page.click('#assets-btn');
  await wait(800);
  await page.click('.as-tab[data-tab=textures]').catch(() => {});
  await wait(2500);
  await shot('assets');
  await escape();
}

// without AI: no chat column, the whole width for the level (body.no-ai, the AI switch)
if (want('no-ai')) {
  await ev(() => document.body.classList.add('no-ai'));
  await page.click('#mode-build');
  await wait(1500);
  await page.click('.lib-tab[data-lib=blocks]');
  await wait(600);
  await shot('no-ai');
  await page.click('#mode-play');
  await ev(() => document.body.classList.remove('no-ai'));
  await wait(800);
}

// the projects home screen
if (want('home')) {
  await ev(() => studio64.hub.openHome());
  await wait(2500);
  await shot('home');
}

await browser.close();
console.log(`project ${project.id}`);
