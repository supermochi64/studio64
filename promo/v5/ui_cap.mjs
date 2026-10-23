// The chat beats, staged in the studio's own chat (the page's message handler is fed the turn; nothing is
// sent to an AI): the prompt typed, Claude thinking, its tool cards, a short reply. Full-page frames at 2x.
//   node ui_cap.mjs OUTDIR NAME
import { openStudio, sleep } from '../scripts/lib.mjs';
import fs from 'node:fs';
const [OUT, NAME] = process.argv.slice(2);
const BEATS = {
  city: { level: 11, prompt: 'bring this place back to life', cards: [
    ['set_environment', 'Changing the water', 'Drained the sunken city'],
    ['edit_textures', 'Painting new textures', 'Repainted the town: stucco, terracotta, ivy'],
    ['set_skybox', 'Making a sky', 'A sunny sky over the town'],
    ['paint_nature', 'Planting', 'Planted trees, flower beds and bushes'],
    ['add_fence', 'Building street lamps', 'Street lamps and bunting along the streets'],
    ['spawn', 'Adding people', 'Added 10 × Toad, 6 × Butterfly']],
    reply: 'The city is alive again! The water is gone, every house is freshly painted and the Toads are back on the plaza.' },
  shotgun: { level: 11, prompt: 'give me a shotgun', cards: [
    ['shotgun', 'Giving Mario the shotgun', 'Mario has the shotgun (B fires)'],
    ['spawn', 'Adding Goombas', 'Added 5 × Goomba']],
    reply: 'Locked and loaded. Five Goombas are coming over the rooftops.' },
  sub: { level: 23, prompt: 'let me drive the submarine', cards: [
    ['list_scene', 'Looking at the docks', null],
    ['attach_motion', 'Making Bowser’s sub drivable', 'Bowser’s sub drives with the stick, A dives'],
    ['create_pipe', 'Adding a way in', 'A pipe on the deck to climb in']],
    reply: 'Hop into the pipe on the deck and the sub is yours. A dives, B surfaces.' },
  katana: { level: 9, prompt: 'let me fight goombas with a katana in tokyo', cards: [
    ['create_level', 'Building Tokyo', 'Created the level “Tokyo”'],
    ['katana', 'Giving Mario the katana', 'Mario has the katana (B slashes)'],
    ['spawn', 'Adding Goombas', 'Added 6 × Goomba on the crossing']],
    reply: 'Welcome to Tokyo. Six Goombas are waiting at the crossing.' },
  race: { level: 9, prompt: 'let me race koopa the quick with a sportscar', cards: [
    ['get_object_path', 'Reading Koopa the Quick’s route', null],
    ['draw_road', 'Laying the road', 'An asphalt road all the way to the summit'],
    ['place_car', 'Placing the car', 'Placed a sportscar at the start line'],
    ['setup_race', 'Setting up the race', 'Koopa the Quick races you to the top']],
    reply: 'Get in with B and floor it. First one to the summit wins!' },
};
const B = BEATS[NAME];
fs.rmSync(`${OUT}/ui_${NAME}`, { recursive: true, force: true });
fs.mkdirSync(`${OUT}/ui_${NAME}`, { recursive: true });
const { browser, page } = await openStudio({ level: B.level, name: `UI ${NAME}`, dpr: 2 });
await page.addStyleTag({ content: '#focus-hint, #coords { display: none !important; }' });
const ev = (fn, a) => page.evaluate(fn, a);
// never send the chat; feed the turn ourselves
await ev(() => {
  const ws = studio64.ws, real = ws.send.bind(ws);
  ws.send = (data) => { try { if (JSON.parse(data).type === 'chat') return; } catch { /* */ } real(data); };
  window.__feed = async (msg) => {
    await ws.onmessage({ data: JSON.stringify(msg) });
    // every card stays in view (the chat folds runs of lookups away)
    document.querySelectorAll('#messages .tools-toggle').forEach((t) => t.remove());
    document.querySelectorAll('#messages .tool').forEach((r) => { r.hidden = false; });
  };
});
await sleep(1500);
let n = 0;
const frames = [];
const shot = async (note, step = true) => {
  if (step) await ev(() => P.step(1));
  await page.screenshot({ path: `${OUT}/ui_${NAME}/${String(n).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 92 });
  frames.push({ n, note }); n++;
};
await ev(() => P.freeze());
for (let i = 0; i < 20; i++) await shot('pre');
await page.focus('#input');
for (let i = 0; i < 6; i++) await shot('focus');
// typing at a human rhythm (frames between keys)
let ci = 0, t = 0;
const times = [];
for (let i = 0; i < B.prompt.length; i++) { const ch = B.prompt[i], prev = B.prompt[i - 1]; t += prev === ' ' ? 2.6 : ch === ' ' ? 2.2 : 1.6 + ((i * 7) % 5) * 0.25; times.push(Math.round(t)); }
for (let f = 0; f <= times[times.length - 1]; f++) {
  const typed = [];
  while (ci < B.prompt.length && times[ci] <= f) { await page.keyboard.type(B.prompt[ci]); typed.push(B.prompt[ci]); ci++; }
  await shot(typed.length ? 'key' : 'type');
}
for (let i = 0; i < 10; i++) await shot('typed');
await page.keyboard.press('Enter');
await shot('enter');
const turn = 't' + Date.now();
await ev((t) => __feed({ type: 'assistant_start', turnId: t }), turn);
for (let i = 0; i < 14; i++) await shot('thinking');
for (const [k, [name, label, summary]] of B.cards.entries()) {
  await ev(([t, k, name, label]) => __feed({ type: 'tool_start', turnId: t, toolId: 'x' + k, name, label }), [turn, k, name, label]);
  for (let i = 0; i < 7; i++) await shot('card' + k + ':run');
  await ev(([k, s, l]) => __feed({ type: 'tool_end', toolId: 'x' + k, ok: true, summary: s || l }), [k, summary, label]);
  for (let i = 0; i < 5; i++) await shot('card' + k + ':done');
}
// the reply, streamed a few words at a time
const words = B.reply.split(' ');
for (let i = 0; i < words.length; i += 2) {
  await ev(([t, s]) => __feed({ type: 'text_delta', turnId: t, text: s }), [turn, (i ? ' ' : '') + words.slice(i, i + 2).join(' ')]);
  await shot('reply');
}
await ev((t) => { __feed({ type: 'assistant_done', turnId: t }); __feed({ type: 'idle' }); }, turn);
for (let i = 0; i < 24; i++) await shot('done');
fs.writeFileSync(`${OUT}/ui_${NAME}/frames.json`, JSON.stringify({ prompt: B.prompt, frames }));
console.log(NAME, 'frames', n);
await browser.close();
