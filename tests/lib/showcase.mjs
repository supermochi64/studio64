// The "Showcase" hack: one project that uses every feature together, built with the studio's
// own functions in a running page (the same ones the UI buttons call). Used by
// tests/suite/showcase.test.mjs (built, exported, re-imported and played in the player) and by
// tools/make_showcase_sample.mjs (the sample hack on the project home).
//
//   Showcase Valley (main area)   Toad with a two-line conversation, sign, an elevator to the
//                                 Sky Ledge star, a patrolling custom enemy guarding a hidden
//                                 star (defeat it), imported crates, a sunset sky, a one-star door
//   Star Hall (sub-area)          entered through the star door: a cutscene, its own song,
//                                 blinking steps to a star, a painting with its own picture
//   Painted Peaks (second level)  through the painting: moon-ish level rules, a summit star
//   the whole game                start + hub in the valley, an opening cutscene, Mario in
//                                 Builder colours, a recoloured texture, 1-up every 50 coins,
//                                 the ending and credits when all 4 stars are found
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, URL_BASE } from './harness.mjs';

export const SHOWCASE = {
  name: 'Showcase',
  author: 'Studio 64',
  description: 'Every feature in one small hack: a story with a Toad, a star door into a hall with a cutscene and its own song, a painting to a second level with low gravity, a patrolling enemy guarding a hidden star, an elevator, imported crates, a sunset sky and Mario in builder colours. Four stars open the ending.',
};

const FIX = path.join(ROOT, 'tests', 'fixtures');

// The test fixture's crate without its floating blue roof plate (the import tests need that one).
function crateOnly(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  for (const m of json.meshes || []) m.primitives = m.primitives.slice(0, 1);
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const rest = buf.subarray(20 + jsonLen);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + text.length + rest.length, 8);
  head.writeUInt32LE(text.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([head, Buffer.from(text), rest]);
}

// s: a harness session (eval, page, until, newLevel, play, wait). Returns the ids of what it made.
export async function buildShowcase(s, { log = () => {} } = {}) {
  const frames = async (n) => {
    await s.eval(() => { if (!window.__scFc) { window.__scFc = { n: 0 }; studio64.engine.on('frame', () => { window.__scFc.n++; }); } });
    const f0 = await s.eval(() => window.__scFc.n);
    await s.page.waitForFunction(([a, b]) => window.__scFc.n >= a + b, [f0, n], { timeout: 240000, polling: 50 });
  };
  const arrived = (key) => s.until((k) => { const e = studio64.engine; try { return e.areaKey() === k && !e.inIntro && !!e.state().mario; } catch { return false; } }, key, 90000);
  const goArea = async (to, key) => {
    await s.eval((t) => studio64.worldFlow.goArea(t), to);
    await arrived(key);
    await frames(15);
    if (await s.eval(() => studio64.editor?.active)) await s.play();
  };

  await fetch(`${URL_BASE}/api/projects/${s.projectId}/meta`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: SHOWCASE.name, author: SHOWCASE.author, description: SHOWCASE.description }) });

  // ---- the second level first (the painting leads there) ----
  const peaks = await s.newLevel('mountain', 'Painted Peaks');
  await s.play();
  await frames(10);
  log('Painted Peaks', peaks);
  const peakInfo = await s.eval(() => {
    const e = studio64.engine, m = e.state().mario;
    // the highest ground in reach: the summit star
    let best = null;
    for (let r = 600; r <= 5200; r += 400) for (let a = 0; a < 24; a++) {
      const x = m.x + Math.sin((a / 24) * Math.PI * 2) * r, z = m.z + Math.cos((a / 24) * Math.PI * 2) * r;
      const y = e.floor(x, 20000, z);
      if (y > -10000 && (!best || y > best.y)) best = { x: Math.round(x), y: Math.round(y), z: Math.round(z) };
    }
    const star = { uid: 0x5c000401, entry: 'star', x: best.x, y: best.y + 160, z: best.z, yaw: 0, pitch: 0, roll: 0, bparams: (0 << 24) >>> 0, scale: 1, name: 'Peak of the Painting', star: { name: 'Peak of the Painting' } };
    studio64.logicUI.commitRecord(star, 'Placed the summit star');
    const sign = studio64.logicUI.characterRecord({ id: 'sign', label: 'Sign post', entry: 'message_panel', sign: true }, { x: m.x + 250, y: m.y, z: m.z + 250, face: 0 });
    return { star: star.uid, sign: sign?.uid, summit: best };
  });

  // ---- the valley ----
  const valley = await s.newLevel('meadow', 'Showcase Valley');
  await s.play();
  await frames(10);
  log('Showcase Valley', valley);
  const v = await s.eval(({ peaks, peakInfo }) => {
    const e = studio64.engine, ui = studio64.storyUI, logic = studio64.logicUI, m = e.state().mario;
    const at = (dx, dz, up = 0) => { const x = Math.round(m.x + dx), z = Math.round(m.z + dz); const y = e.floor(x, m.y + 3000, z); return { x, y: Math.round((y > -10000 ? y : m.y) + up), z }; };
    const yawTo = (from, to) => Math.round((Math.atan2(to.x - from.x, to.z - from.z) / Math.PI) * 32768) & 0xffff;
    const out = { spawn: { x: Math.round(m.x), y: Math.round(m.y), z: Math.round(m.z) } };
    // Toad: the welcome, then what to do (lines change with the story)
    const toadAt = at(0, 450);
    const toad = logic.characterRecord({ id: 'toad', label: 'Toad', model: 'toad_message', anim: [1, 6] }, { ...toadAt, face: Math.PI });
    const met = ui.newVar('flag', 'met Toad');
    const stars = ui.newVar('counter', 'stars found');
    const dHello = ui.newDialog({ name: 'Toad: welcome', text: 'Welcome to the Showcase, Mario! Everything here was made in Studio 64, without a line of code.\n\nFour stars are hidden in this hack. Ride the lift, beat the guard, and find the hall behind the star door!' });
    const dAgain = ui.newDialog({ name: 'Toad: hint', text: 'The star door opens with one star. The hall has a painting... jump in!' });
    ui.op({ op: 'npc', uid: toad.uid, value: { name: 'Showcase Toad', kind: 'toad', lines: [{ dialog: dAgain.id, if: [{ type: 'flag', var: met.id, value: true }] }, { dialog: dHello.id, if: [] }] } }, { render: false });
    ui.newEvent({ name: 'Toad gives coins', repeat: 'once', trigger: { type: 'talk', uid: toad.uid }, actions: [{ type: 'set_flag', var: met.id, value: 'true' }, { type: 'coins', amount: 10 }, { type: 'caption', text: '+10 coins from Toad', seconds: 2 }] });
    // the sign by the lift
    const sign = logic.characterRecord({ id: 'sign', label: 'Sign post', entry: 'message_panel', sign: true }, { ...at(700, 200), face: 0 });
    const dSign = ui.newDialog({ name: 'Sign: the lift', text: 'SKY LEDGE LIFT\nStand on the platform and it takes you up. Step off and it comes back down.' });
    ui.op({ op: 'npc', uid: sign.uid, value: { name: 'Lift sign', kind: 'sign', lines: [{ dialog: dSign.id, if: [] }] } }, { render: false });
    // the elevator (a motion: up while Mario stands on it) to a ledge with a star
    const base = at(1100, 0);
    const lift = { uid: 0x5c000101, block: { shape: 0, sx: 360, sy: 60, sz: 360, steps: 0, top: 3, side: 3, surface: 0, flags: 0, color: 0xffd060 }, x: base.x, y: base.y, z: base.z, yaw: 0, pitch: 0, roll: 0, name: 'Sky lift',
      motion: { path: { points: [[0, 0, 0], [0, 900, 0]], speed: 10, mode: 'pingpong', wait: 0, smooth: false, trigger: 'while_standing', radius: 800, phase: 0, face: false } } };
    logic.commitRecord(lift, 'Placed the sky lift');
    // (reaching 600 below the lift's floor: the ground under it slopes down to the river)
    const ledge = { uid: 0x5c000102, block: { shape: 0, sx: 700, sy: 1560, sz: 700, steps: 0, top: 0, side: 9, surface: 0, flags: 0, color: 0xffffff }, x: base.x + 530, y: base.y - 600, z: base.z, yaw: 0, pitch: 0, roll: 0, name: 'Sky ledge' };
    logic.commitRecord(ledge, 'Placed the sky ledge');
    const ledgeStar = { uid: 0x5c000103, entry: 'star', x: base.x + 600, y: base.y + 960 + 160, z: base.z, yaw: 0, pitch: 0, roll: 0, bparams: (0 << 24) >>> 0, scale: 1, name: 'Top of the Sky Lift', star: { name: 'Top of the Sky Lift' } };
    logic.commitRecord(ledgeStar, 'Placed a star');
    // the guard: a custom enemy patrolling a path; beating it gives the hidden star
    const ctx = studio64.objects;
    const def = { id: 'scguard', name: 'Valley guard', model: 'goomba', move: 'patrol', speed: 6, chaseSpeed: 12, sight: 900, health: 2, damage: 1, defeat: 'squish', coins: 3, scale: 1.6, sounds: {} };
    ctx.store.setGame('objdefs', [...ctx.defs().filter((d) => d.id !== def.id), def], 'Made the custom object “Valley guard”');
    const g = at(-900, 700);
    const guard = { uid: 0x5c000201, bhv: 'bhvStudioActor', model: 'goomba', def: def.id, actor: { ...def }, x: g.x, y: g.y, z: g.z, yaw: 0, pitch: 0, roll: 0, bparams: 0, scale: 1.6, name: 'Valley guard',
      motion: { path: { points: [[0, 0, 0], [0, 0, 900], [-700, 0, 900]], speed: 6, mode: 'loop', wait: 0.5, smooth: true, trigger: 'always', radius: 800, phase: 0, face: true } } };
    logic.commitRecord(guard, 'Placed the valley guard');
    const hs = at(-1200, 300, 160);
    const hidden = { uid: 0x5c000202, entry: 'star', x: hs.x, y: hs.y, z: hs.z, yaw: 0, pitch: 0, roll: 0, bparams: (1 << 24) >>> 0, scale: 1, name: "The Guard's Treasure", star: { name: "The Guard's Treasure" } };
    logic.commitRecord(hidden, 'Placed a star');
    ui.op({ op: 'hidden', uid: hidden.uid, on: true }, { render: false });
    ui.newEvent({ name: 'Guard beaten', repeat: 'once', trigger: { type: 'object_event', uid: guard.uid, event: 'defeated' }, actions: [{ type: 'give_star', uid: hidden.uid, at: 'spot' }, { type: 'caption', text: 'The guard dropped its treasure!', seconds: 3 }] });
    ui.newEvent({ name: 'Guard spots Mario', repeat: 'visit', trigger: { type: 'object_event', uid: guard.uid, event: 'spotted' }, actions: [{ type: 'caption', text: 'Watch out: the guard!', seconds: 2 }] });
    // counting stars (a counter the ending checks too)
    ui.newEvent({ name: 'Count stars', repeat: 'always', trigger: { type: 'star' }, actions: [{ type: 'set_var', var: stars.id, op: 'add', value: 1 }] });
    out.ids = { toad: toad.uid, sign: sign.uid, lift: lift.uid, ledge: ledge.uid, ledgeStar: ledgeStar.uid, guard: guard.uid, hidden: hidden.uid, met: met.id, stars: stars.id, def: def.id, toadAt, liftAt: base };
    return out;
  }, { peaks, peakInfo });
  log('valley built', JSON.stringify(v.ids));

  // imported crates (the GLB fixture), placed as props with collision
  const glb = crateOnly(fs.readFileSync(path.join(FIX, 'crate.glb'))).toString('base64');
  const files = await s.page.evaluateHandle((b64) => [new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'crate.glb')], glb);
  await s.page.evaluate((f) => studio64.assetsUI.openImport(f), files);
  await s.page.waitForSelector('.as-import [data-a=save]:not([disabled])', { timeout: 120000 });
  await s.page.click('.as-import [data-a=save]');
  await s.page.waitForFunction(() => studio64.assets.meta.models.length >= 1, null, { timeout: 90000 });
  const crates = await s.eval(async (spawn) => {
    const m = studio64.assets.meta.models[0];
    const r = await studio64.studio.handle('asset_place', { model: m.id, count: 3, where: { mode: 'around', x: spawn.x - 650, z: spawn.z - 150, radius: 170 } });
    for (const rec of r.records) studio64.ws.send(JSON.stringify({ type: 'edit', op: { type: 'add', key: studio64.engine.areaKey(), summary: 'Placed crates', records: [rec] } }));
    return { model: m.id, uids: r.records.map((x) => x.uid) };
  }, v.spawn);

  // sky, Mario's colours, a recoloured texture, game rules
  await s.eval(async () => {
    await studio64.studio.handle('sky_generate', { top: '#2b2a6e', horizon: '#ff9a5a', bottom: '#5a3a5a', clouds: 0.55, cloud_color: '#ffd0b0', sun: true, sun_color: '#ffe0a0', mountains: 0.5, mountain_color: '#3a2a4a', name: 'Showcase sunset' });
    await studio64.studio.handle('mario_colors', { preset: 'builder' }).catch(() => studio64.studio.handle('mario_colors', { preset: 'luigi' }));
  });
  const tex = await s.eval(async () => {
    let r = await studio64.studio.handle('texture_edit', { query: 'wooden door', limit: 2, recolor: { hue: 165, saturation: 1.2 } }).catch(() => null);
    if (!r?.changed?.length) r = await studio64.studio.handle('texture_edit', { here: true, query: '', limit: 1, recolor: { hue: 165 } }).catch(() => null);
    return r?.changed || [];
  });
  await s.eval((peaks) => studio64.objects.store.setGame('rules', { base: { coinLife: 50, coinHeal: true }, levels: { [`c:${peaks}`]: { gravity: 0.6, airControl: 1.4, fallDamage: 0 } } }, 'Showcase rules'), peaks);

  // ---- the Star Hall: a sub-area behind a one-star door ----
  const hall = await s.eval(async (valley) => {
    const e = studio64.engine, m = e.state().mario;
    // the door 600 in front of Toad's left
    e.teleport(m.x - 300, m.y + 20, m.z - 400, 0x8000);
    return true;
  }, valley);
  await frames(8);
  const made = await s.eval((valley) => studio64.worldUI.createArea(valley, 'Star Hall', 'castle_room', true).then((x) => ({ index: x.index })), valley);
  await frames(10);
  const doors = await s.eval(({ valley, index }) => {
    const f = studio64.worldFlow, p = studio64.engine.patch.areas;
    const din = (p[`c:${valley}`].objects || []).find((r) => r.warp?.kind === 'door' && r.warp.to?.area === index);
    const st = { id: 'star1', model: 'door:castle_door_1_star' };
    f.updateRecord(`c:${valley}`, din.uid, { model: st.model, name: 'Star door', warp: { ...din.warp, style: st.id, stars: 1 } }, 'The hall door needs a star');
    const dout = (p[`c:${valley}:${index}`].objects || []).find((r) => r.warp?.kind === 'door');
    return { din: din.uid, dout: dout?.uid, dinAt: { x: din.x, y: din.y, z: din.z, yaw: din.yaw } };
  }, { valley, index: made.index });
  log('star door', JSON.stringify(doors));

  // the hall's song: a starter from the sound studio
  const song = await s.eval(async () => {
    const mu = await import('/js/music.js');
    const banks = await mu.loadInstruments();
    const st = mu.STARTERS.find((x) => x.id === 'night') || mu.STARTERS[0];
    const song = { ...mu.starterSong(st, banks), id: 'schall', name: 'Star Hall Waltz' };
    studio64.audio ||= { songs: [], sounds: [], overrides: [] };
    studio64.audio.songs = [...(studio64.audio.songs || []).filter((x) => x.id !== song.id), song];
    studio64.ws.send(JSON.stringify({ type: 'song_save', song }));
    return song.id;
  });

  await goArea({ custom: valley, area: made.index }, `c:${valley}:${made.index}`);
  const h = await s.eval(async ({ peaks, song, valley, index }) => {
    const e = studio64.engine, f = studio64.worldFlow, w = studio64.world, ui = studio64.storyUI, logic = studio64.logicUI;
    w.setSettings({ song }, 'The hall plays its own song');
    // blinking steps up to a star on a balcony
    const steps = [];
    for (let i = 0; i < 3; i++) {
      const st = { uid: 0x5c000301 + i, block: { shape: 0, sx: 240, sy: 40, sz: 240, steps: 0, top: 21, side: 21, surface: 0, flags: 0, color: 0xa0c8ff }, x: -800 + i * 330, y: 160 + i * 170, z: -300, yaw: 0, pitch: 0, roll: 0, name: `Blinking step ${i + 1}`,
        motion: { blink: { on: 3, off: 1.2, phase: i * 0.8 } } };
      logic.commitRecord(st, 'Placed a blinking step');
      steps.push(st.uid);
    }
    const balcony = { uid: 0x5c000310, block: { shape: 0, sx: 500, sy: 60, sz: 500, steps: 0, top: 8, side: 8, surface: 0, flags: 0, color: 0xffffff }, x: 450, y: 620, z: -300, yaw: 0, pitch: 0, roll: 0, name: 'Balcony' };
    logic.commitRecord(balcony, 'Placed the balcony');
    const star = { uid: 0x5c000311, entry: 'star', x: 450, y: 840, z: -300, yaw: 0, pitch: 0, roll: 0, bparams: (2 << 24) >>> 0, scale: 1, name: 'Blinking Balcony', star: { name: 'Blinking Balcony' } };
    logic.commitRecord(star, 'Placed a star');
    // a painting of the peaks (its own picture) on the far wall: into Painted Peaks
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 128); sky.addColorStop(0, '#3a7bd5'); sky.addColorStop(1, '#bfe3ff');
    g.fillStyle = sky; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#4a5a7a'; g.beginPath(); g.moveTo(0, 110); g.lineTo(40, 40); g.lineTo(70, 80); g.lineTo(95, 30); g.lineTo(128, 100); g.lineTo(128, 128); g.lineTo(0, 128); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(32, 54); g.lineTo(40, 40); g.lineTo(48, 54); g.fill(); g.beginPath(); g.moveTo(86, 46); g.lineTo(95, 30); g.lineTo(104, 46); g.fill();
    g.fillStyle = '#ffe14d'; g.font = 'bold 18px sans-serif'; g.fillText('★', 56, 24);
    const data = c.toDataURL('image/png');
    const { imageToRgba16 } = await import('/js/worldflow.js');
    const pid = 'pic_peaks1';
    f.setFlow({ pictures: { ...(f.flow().pictures || {}), [pid]: { name: 'Painted Peaks', data } } });
    f.pictureCache.set(pid, await imageToRgba16(data, 128, 128));
    f.uploadPictures();
    const painting = f.makeWarpRecord('painting', { x: 0, y: 220, z: -1165, yaw: 0, picture: pid, to: { custom: peaks, area: 1 }, name: 'Painting of the peaks' });
    f.addRecord(painting, 'Hung the painting of the peaks');
    // entering the hall: a cutscene looking at the painting, with a caption and a dialog
    const dHall = ui.newDialog({ name: 'Hall: welcome', text: 'The Star Hall! Its music was composed in the sound studio.\n\nCatch the star on the balcony, then jump into the painting.' });
    const cs = ui.newCutscene({ name: 'Star Hall reveal', skippable: true, hud: false, steps: [
      { type: 'shot', pos: [0, 420, 900], focus: [0, 300, -1100], seconds: 0, ease: 'cut' },
      { type: 'shot', pos: [0, 330, -300], focus: [0, 260, -1165], seconds: 3, ease: 'smooth' },
      { type: 'caption', text: 'A painting... of a place far away', seconds: 2.5 },
      { type: 'shot', pos: [-200, 700, 300], focus: [450, 700, -300], seconds: 2, ease: 'smooth' },
      { type: 'dialog', dialog: dHall.id },
      { type: 'follow_mario' } ] });
    ui.newEvent({ name: 'Into the Star Hall', repeat: 'once', trigger: { type: 'level_enter', level: `c:${valley}:${index}` }, actions: [{ type: 'cutscene', cutscene: cs.id }] });
    return { steps, balcony: balcony.uid, star: star.uid, painting: painting.uid, cutscene: cs.id };
  }, { peaks, song, valley, index: made.index });
  log('hall built', JSON.stringify(h));

  // ---- the whole game: start, hub, goal, opening, ending ----
  await goArea({ custom: valley, area: 1 }, `c:${valley}`);
  const game = await s.eval(({ valley, v, doors }) => {
    const f = studio64.worldFlow, ui = studio64.storyUI;
    f.setFlow({ start: { custom: valley, area: 1 }, hub: { custom: valley, area: 1 }, goal: { stars: 4, message: 'You found all four\nShowcase stars!' } });
    const sp = v.spawn, t = v.ids.toadAt, lf = v.ids.liftAt;
    const opening = ui.newCutscene({ name: 'Opening flyover', skippable: true, hud: false, steps: [
      { type: 'shot', pos: [sp.x - 1800, sp.y + 1400, sp.z - 1800], focus: [sp.x, sp.y + 200, sp.z], seconds: 0, ease: 'cut' },
      { type: 'caption', text: 'Studio 64 presents: the Showcase', seconds: 2.5 },
      { type: 'shot', pos: [lf.x - 600, lf.y + 1300, lf.z - 900], focus: [lf.x + 500, lf.y + 900, lf.z], seconds: 3, ease: 'smooth' },
      { type: 'caption', text: 'Four stars to find (press Start to skip)', seconds: 2.5 },
      { type: 'shot', pos: [t.x + 500, t.y + 300, t.z - 700], focus: [t.x, t.y + 100, t.z], seconds: 2.5, ease: 'smooth' },
      { type: 'follow_mario' } ] });
    ui.op({ op: 'start', value: { custom: valley, cutscene: opening.id } }, { render: false });
    const dEnd = ui.newDialog({ name: 'The end', text: 'You found all four stars of the Showcase!\nNow make a hack of your own.' });
    ui.newEvent({ name: 'All stars: the ending', repeat: 'once', trigger: { type: 'star' }, conditions: [{ type: 'var', var: v.ids.stars, op: '>=', value: 4 }], actions: [{ type: 'wait', seconds: 1 }, { type: 'dialog', dialog: dEnd.id }, { type: 'ending' }] });
    ui.op({ op: 'text', kind: 'ending', key: '0', value: 'Mario! You found every star of the Showcase!' }, { render: false });
    ui.op({ op: 'text', kind: 'credits', key: '0', value: { title: ['STUDIO 64', 'SHOWCASE'], names: ['MADE WITHOUT CODE'] } }, { render: false });
    ui.flush();
    return { opening: opening.id };
  }, { valley, v, doors });
  await frames(20);
  return { valley, peaks, hallIndex: made.index, v: v.ids, spawn: v.spawn, peak: peakInfo, doors, hall: h, crates, tex, song, game };
}
