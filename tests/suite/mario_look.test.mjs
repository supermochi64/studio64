// Mario's lighting (issue #8 "beta lighting"): the Mario tab's three shading sliders, the light's
// direction and the Beta preset change the light groups of his model and what is drawn (pixels of
// a fixed close-up), the game's values are exactly the game's own, the setting is saved in the
// project and comes back after a reload, and the ROM export writes it into the info block.
// @tags assets
// @timeout 600
import { suite, URL_BASE } from '../lib/harness.mjs';
import { marioLook } from '../../server/romexport/rom.js';
import { MARIO_LIGHT_PRESETS, lightTable } from '../../web/js/mario_look.js';

const PARTS = ['overalls', 'shirt', 'gloves', 'shoes', 'skin', 'hair', 'cap'];

await suite('Mario lighting', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  await page.waitForFunction(() => window.studio64?.assets?.loaded && studio64.engine.state().mario, null, { timeout: 60000 });
  const M = (fn, ...a) => s.eval(([f, args]) => studio64.engine.M[f](...args), [fn, a]);
  // a part's light group as the model uses it now, and the game's own
  const group = (part) => s.eval((p) => Array.from({ length: 24 }, (_, k) => studio64.engine.M._studio_mario_light_byte(p, k)), part);
  const orig = (part) => s.eval((p) => Array.from({ length: 24 }, (_, k) => studio64.engine.M._studio_mario_light_byte(p, 24 + k)), part);
  // what the server has (the project as the player gets it)
  const saved = () => fetch(`${URL_BASE}/api/projects/${s.projectId}/play.json`).then((r) => r.json());
  const allGame = async () => {
    for (let p = 0; p < 7; p++) if (JSON.stringify(await group(p)) !== JSON.stringify(await orig(p))) return PARTS[p];
    return true;
  };

  // ---- the game's look, untouched -------------------------------------------------------------
  for (let p = 0; p < 7; p++) t.check(`the model has a light group for the ${PARTS[p]}`, (await M('_studio_mario_default_color', p)) >= 0);
  t.eq('by default every light group is the game\'s own', await allGame(), true);
  const skin0 = await orig(4);
  t.eq('the game\'s skin light: ambient half the colour, light from 40,40,40', [skin0.slice(0, 3), skin0.slice(8, 11), skin0.slice(16, 19)], [[0x7f, 0x60, 0x3c], [0xfe, 0xc1, 0x79], [0x28, 0x28, 0x28]]);

  // a close-up of Mario from a fixed camera (in front of him, a little to the side)
  const m = await s.mario();
  const yaw = (m.yaw || 0) * Math.PI / 180;
  const cam = [m.x + Math.sin(yaw + 0.5) * 260, m.y + 120, m.z + Math.cos(yaw + 0.5) * 260];
  await s.eval(([c, mm]) => studio64.engine.setCamera(true, c, [mm.x, mm.y + 70, mm.z], 45), [cam, m]);
  await s.wait(800);
  // the game stands still (frame advance) so the pictures differ only by the light
  await M('_studio_debug_speed', 1, 1);
  // how dark Mario is: the share of dark pixels and the mean brightness in the middle of the picture
  const measure = () => s.eval(async () => {
    const shot = studio64.engine.captureFrame(0);
    studio64.engine.M._studio_debug_step(1);
    const c = await shot;
    const g = c.getContext('2d');
    const w = c.width, h = c.height, x0 = Math.round(w * 0.38), y0 = Math.round(h * 0.2), cw = Math.round(w * 0.24), ch = Math.round(h * 0.65);
    const d = g.getImageData(x0, y0, cw, ch).data;
    let dark = 0, sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      sum += l; n++;
      if (Math.max(d[i], d[i + 1], d[i + 2]) < 70) dark++;
    }
    return { dark: dark / n, mean: sum / n };
  });
  const before = await measure();
  await s.shot('1_game_lighting');

  // ---- the Mario tab: the Beta preset ----------------------------------------------------------
  await s.eval(() => studio64.assetsUI.open('mario'));
  await page.waitForSelector('.as-light [data-lk=skin]');
  await page.click('[data-light=beta]');
  await s.wait(900);
  const beta = lightTable(MARIO_LIGHT_PRESETS.beta.light);
  const skin = await group(4);
  t.eq('Beta: the skin\'s shadow side is darker (ambient = colour * amb / 256)', skin.slice(0, 3), [0xfe, 0xc1, 0x79].map((c) => (c * beta.parts[4].amb) >> 8));
  t.eq('Beta: the light\'s direction', skin.slice(16, 19).map((v) => (v << 24) >> 24), beta.dir || [0x28, 0x28, 0x28]);
  t.check('Beta: every part is lit harder', (await Promise.all([0, 1, 2, 3, 5, 6].map(async (p) => (await group(p))[0] <= (await orig(p))[0]))).every(Boolean));
  const after = await measure();
  await s.shot('2_mario_tab_beta');
  t.log(`dark pixels on Mario: game ${(before.dark * 100).toFixed(1)}%, beta ${(after.dark * 100).toFixed(1)}%`);
  await s.eval(() => studio64.assetsUI.close());
  await s.wait(400);
  await s.shot('2_beta_lighting');
  t.check('Beta: Mario is drawn with darker shadows (more dark pixels on him)', after.dark > before.dark + 0.01, { before, after });
  t.check('the Beta button is shown as the current lighting', await s.eval(() => { studio64.assetsUI.open('mario'); return !!document.querySelector('[data-light=beta].active'); }));
  t.eq('the lighting is saved in the project', (await saved()).assets?.mario?.light, MARIO_LIGHT_PRESETS.beta.light);

  // ---- the sliders ---------------------------------------------------------------------------
  const slide = async (k, v) => {
    await page.$eval(`.as-light [data-lk=${k}]`, (r, val) => { r.value = String(val); r.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    await s.wait(150);
  };
  await slide('skin', 100);
  t.eq('Face & hair at 100: black shadow side (skin and hair)', [(await group(4)).slice(0, 3), (await group(5)).slice(0, 3)], [[0, 0, 0], [0, 0, 0]]);
  await slide('clothes', 0);
  const cap = await group(6);
  t.check('Clothes at 0: flat (ambient = the full colour)', cap[0] === 0xff && cap[4] === 0xff, cap.slice(0, 12));
  await slide('hands', 50);
  t.eq('Hands & feet at 50: the game\'s shading', (await group(2)).slice(0, 3), (await orig(2)).slice(0, 3));
  await slide('dir', -90);
  const dir = (await group(0)).slice(16, 19).map((v) => (v << 24) >> 24);
  t.check('Light from -90°: the light comes from the left', dir[0] < 0 && dir[1] > 0, dir);
  await s.wait(500);
  t.eq('the sliders are saved', (await saved()).assets?.mario?.light, { skin: 100, clothes: 0, hands: 50, dir: -90 });

  // ---- back to the game's -------------------------------------------------------------------
  await page.click('[data-light=game]');
  await s.wait(700);
  t.eq('Game: every light group is exactly the game\'s again', await allGame(), true);
  await s.eval(() => studio64.assetsUI.close());
  await s.wait(400);
  // game, beta, game again, one frame apart (his idle animation moves a little: game again is much nearer the first
  // picture than the beta one)
  const g1 = await measure();
  await s.eval(() => studio64.studio.handle('mario_lighting', { preset: 'beta' }));
  const b1 = await measure();
  await s.eval(() => studio64.studio.handle('mario_lighting', { preset: 'game' }));
  const g2 = await measure();
  t.check('Game: Mario is drawn as before (game -> beta -> game, a frame apart)', b1.dark > g1.dark + 0.01 && Math.abs(g2.dark - g1.dark) < (b1.dark - g1.dark) / 2, { g1, b1, g2 });

  // colours and lighting together: a colour keeps the lighting and the other way round
  await s.eval(() => studio64.studio.handle('mario_colors', { colors: { cap: '#00ff00' } }));
  await s.eval(() => studio64.studio.handle('mario_lighting', { preset: 'beta' }));
  await s.wait(500);
  const capG = await group(6);
  t.eq('a green cap with beta lighting: diffuse green, ambient dark green', [capG.slice(8, 11), capG.slice(0, 3)], [[0, 0xff, 0], [0, (0xff * beta.parts[6].amb) >> 8, 0]]);
  const ex = await saved();
  t.check('the colours stay when the lighting changes (and the other way round)', ex.assets.mario.colors?.cap === '#00ff00' && ex.assets.mario.light?.dir === MARIO_LIGHT_PRESETS.beta.light.dir, ex.assets.mario);

  // ---- after a reload ------------------------------------------------------------------------
  await M('_studio_debug_speed', 0, 1);
  await s.reload();
  await page.waitForFunction(() => window.studio64?.assets?.loaded && studio64.engine.state().mario, null, { timeout: 60000 });
  await s.wait(1500);
  t.eq('after a reload: the skin is lit as Beta again', (await group(4)).slice(0, 3), [0xfe, 0xc1, 0x79].map((c) => (c * beta.parts[4].amb) >> 8));
  t.eq('after a reload: the green cap', (await group(6)).slice(8, 11), [0, 0xff, 0]);
  const m2 = await s.mario();
  await s.eval(([mm]) => studio64.engine.setCamera(true, [mm.x + Math.sin((mm.yaw || 0) * Math.PI / 180 + 0.5) * 260, mm.y + 120, mm.z + Math.cos((mm.yaw || 0) * Math.PI / 180 + 0.5) * 260], [mm.x, mm.y + 70, mm.z], 45), [m2]);
  await s.wait(800);
  await s.shot('3_beta_green_cap_after_reload');

  // ---- the ROM's info block ------------------------------------------------------------------
  const info = marioLook(ex.assets.mario);
  t.eq('ROM: every part has its own look (and the direction when it is not the game\'s)', info.readUInt32BE(0) >>> 0, (0x7f | (beta.dir ? 0x80000000 : 0)) >>> 0);
  t.eq('ROM: the light\'s direction', [info.readInt8(4), info.readInt8(5), info.readInt8(6)], beta.dir || [0, 0, 0]);
  t.eq('ROM: the skin\'s amb and dif', [info.readInt16BE(8 + 4 * 8 + 4), info.readInt16BE(8 + 4 * 8 + 6)], [beta.parts[4].amb, beta.parts[4].dif]);
  t.eq('ROM: the cap\'s colour', [info.readUIntBE(8 + 6 * 8, 3), info.readUInt8(8 + 6 * 8 + 3)], [0x00ff00, 1]);
  t.check('ROM: the game\'s look writes nothing (the model stays the game\'s)', marioLook({ colors: {}, light: MARIO_LIGHT_PRESETS.game.light }).equals(Buffer.alloc(0x40)) && marioLook(undefined).equals(Buffer.alloc(0x40)));
});
