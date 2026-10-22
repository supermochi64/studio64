// Phase A: the studio interface, the prompt typed into the chat (frame-exact typing rhythm) and
// whatever the real Claude does with it, captured as full-page frames at 2x (3840x2160).
//   node promo/scripts/capture_ui.mjs [outDir]
// The game is frozen and stepped one frame per captured frame while typing; during Claude's turn
// a frame is captured as fast as the page allows (real time is logged per frame for the edit),
// the game is stepped once Bowser is in the level (so his arrival plays in the stage).
import { openStudio, sleep } from './lib.mjs';
import fs from 'node:fs';
const OUT = process.argv[2] || new URL('../work/cap/ui', import.meta.url).pathname;
const PROMPT = process.env.PROMPT || 'spawn bowser here and let me fight him here';
const LEVEL = Number(process.env.LEVEL || 16);
const PRE = Number(process.env.PRE || 45);
const AFTER = Number(process.env.AFTER || 75);
fs.mkdirSync(OUT, { recursive: true });
const { browser, page, id } = await openStudio({ level: LEVEL, name: process.env.NAME || 'Castle Showdown', dpr: 2 });
console.log('project', id);
fs.writeFileSync(`${OUT}/project.txt`, id);
await page.addStyleTag({ content: '#focus-hint, #coords { display: none !important; }' });
// another corner of the level: Mario put down there (SPAWN = [x, z, yaw])
if (process.env.SPAWN) {
  const [sx, sz, syaw] = JSON.parse(process.env.SPAWN);
  await page.evaluate(([x, z, yaw]) => { const e = studio64.engine; e.teleport(x, e.floor(x, 8000, z) + 5, z, yaw); }, [sx, sz, syaw]);
  await sleep(2500);
}
// wait until Mario stands idle (a course starts with his entry jump)
for (let t0 = Date.now(); Date.now() - t0 < 30000;) {
  const act = await page.evaluate(() => P.mario().action >>> 0);
  if (act === 0x0C400201) break;
  await sleep(500);
}
await sleep(1500);
await page.evaluate(() => {
  P.freeze();
  window.__spawns = 0;
  const e = studio64.engine, orig = e._spawnRecord.bind(e);
  e._spawnRecord = (o) => { window.__spawns++; return orig(o); };
});
await page.evaluate(() => P.step(2));
const frames = [];
let n = 0;
const t0 = Date.now();
const CHAT = { x: 1280, y: 0, width: 640, height: 1080 }; // the chat column (+ the stage's right edge)
async function shot(step, note, clip = null) {
  if (step) await page.evaluate(() => P.step(1));
  const file = `${OUT}/${String(n).padStart(5, '0')}${clip ? 'c' : ''}.jpg`;
  await page.screenshot({ path: file, type: 'jpeg', quality: 93, ...(clip ? { clip } : {}) });
  const st = await page.evaluate(() => ({ busy: !!studio64.busy, done: studio64.chatDone || 0, spawns: window.__spawns, g: P.frames(),
    tools: [...document.querySelectorAll('#messages .tool')].map((r) => r.className.replace('tool ', '') + ':' + r.innerText.replace(/\n/g, ' ')),
    text: (document.querySelector('#messages .msg:last-child')?.innerText || '').slice(0, 400) }));
  frames.push({ n, ms: Date.now() - t0, step: !!step, note, clip: !!clip, ...st });
  n++;
  return st;
}
// 1. establishing: Mario outside the castle, the studio around him
for (let i = 0; i < PRE; i++) await shot(true, 'pre');
// 2. focus the chat (as "/" does) and type with a human rhythm
await page.focus('#input');
for (let i = 0; i < 6; i++) await shot(false, 'focus', CHAT);
const times = [];
let t = 0;
for (let i = 0; i < PROMPT.length; i++) {
  const ch = PROMPT[i], prev = PROMPT[i - 1];
  t += prev === ' ' ? 2.6 : ch === ' ' ? 2.2 : 1.6 + ((i * 7) % 5) * 0.25; // frames between keys
  times.push(Math.round(t));
}
let ci = 0;
for (let f = 0; f <= times[times.length - 1]; f++) {
  const typed = [];
  while (ci < PROMPT.length && times[ci] <= f) { await page.keyboard.type(PROMPT[ci]); typed.push(PROMPT[ci]); ci++; }
  const st = await shot(false, typed.length ? 'key:' + typed.join('') : 'type', CHAT);
}
for (let i = 0; i < 10; i++) await shot(false, 'typed', CHAT);
for (let i = 0; i < 3; i++) await shot(true, 'typed-full');
// 3. send, and Claude's turn
await page.keyboard.press('Enter');
await shot(false, 'enter', CHAT);
let spawnedAt = -1, quietSince = Date.now(), lastSig = '';
const tSend = Date.now();
while (Date.now() - tSend < 300000) {
  const pending = await page.evaluate(() => (studio64.engine.shotWaiters?.length || 0) + (studio64.engine.frameWaiters?.length || 0));
  const st0 = await page.evaluate(() => window.__spawns);
  if (st0 > 0 && spawnedAt < 0) spawnedAt = n;
  const step = spawnedAt >= 0 || pending > 0 || Date.now() - quietSince > 4000;
  const st = await shot(step, spawnedAt === n ? 'spawned' : 'wait', spawnedAt >= 0 ? null : CHAT);
  const sig = JSON.stringify([st.tools, st.text.length, st.busy]);
  if (sig !== lastSig) { lastSig = sig; quietSince = Date.now(); }
  if (st.done > 0 && !st.busy) break;
}
// 4. after the turn: Bowser in the stage, a bit more
for (let i = 0; i < AFTER; i++) await shot(true, 'after');
fs.writeFileSync(`${OUT}/frames.json`, JSON.stringify({ project: id, prompt: PROMPT, keyTimes: times, frames }, null, 1));
const objs = await page.evaluate(() => studio64.editor.records().map((r) => [r.entry, r.uid, Math.round(r.x), Math.round(r.y), Math.round(r.z)]));
console.log(JSON.stringify(objs));
console.log(await page.evaluate(() => document.querySelector('#messages').innerText));
console.log('frames', n, 'spawned at', spawnedAt, 'secs', (Date.now() - t0) / 1000);
await browser.close();
