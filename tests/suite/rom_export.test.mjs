// ROM export of the Showcase sample through its dialog: the base ROM is built once from the
// player's ROM, every area is read, and the result is a ROM with the hub in the castle grounds and
// the second level behind the first painting, plus a BPS patch that rebuilds it from the original.
// Needs engine/baserom.us.z64 (the setup keeps it there) and, the first time, a few minutes.
// @tags export
// @timeout 1500
import fs from 'node:fs';
import path from 'node:path';
import { suite, URL_BASE, ROOT } from '../lib/harness.mjs';
import { applyBps } from '../../server/romexport/bps.js';

await suite('ROM export', async (t) => {
  const kit = await fetch(`${URL_BASE}/api/rom/kit`).then((r) => r.json());
  if (!kit.haveRom) { t.log('no ROM on this server: skipped'); return; }
  const created = await fetch(`${URL_BASE}/api/hub/create`, { method: 'POST', body: JSON.stringify({ sample: 'showcase.s64hack', name: 'ROM export test' }) }).then((r) => r.json());
  if (!created.id) { t.log(`no Showcase sample (${created.error}): skipped`); return; }

  const s = await t.open({ project: created.id });
  // (the page shows the hack's own start area first: where the export brings it back to)
  await s.page.waitForFunction(() => studio64.engine.areaKey?.().startsWith('c:'), null, { timeout: 120000 }).catch(() => {});
  // one of its songs plays everywhere instead of the slide music, and once for the star fanfare
  const swapped = await s.eval(() => {
    const ui = studio64.soundUI, song = studio64.audio.songs[0];
    if (!song) return null;
    ui.setReplacement(0x09, song.id);
    ui.setReplacement(0x01, song.id);
    return song.id;
  });
  t.must('the sample has a song to replace game songs with', !!swapped);
  // Mario's beta lighting with a green cap, and his beta voice (issue #8): written into the info block
  await s.eval(async () => {
    await studio64.studio.handle('mario_colors', { colors: { cap: '#00c040' } });
    await studio64.studio.handle('mario_lighting', { preset: 'beta' });
    studio64.soundUI.setBeta(true);
  });
  await s.wait(800);
  await s.eval(() => studio64.hub.romModal());
  await s.page.waitForSelector('#rx-go');
  t.eq('the ROM name starts as the project name', await s.page.inputValue('#rx-title'), 'ROM export test');
  await s.page.fill('#rx-title', 'Showcase ROM');
  await s.page.click('#rx-go');
  await s.page.waitForSelector('.rx-done:not([hidden])', { timeout: 1400000 });
  await s.shot('result');

  const levels = await s.page.$$eval('.rx-level', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  t.check('the hub is in the castle grounds', levels.some((l) => /Showcase Valley.*castle grounds/.test(l)), levels);
  t.check('the second level is course 1', levels.some((l) => /Painted Peaks.*Course 1/.test(l)), levels);
  const where = await s.eval(() => studio64.engine.areaKey());
  t.check('back in the hack after reading it', where.startsWith('c:'), where);

  const get = async (ext) => Buffer.from(await (await fetch(`${URL_BASE}/api/projects/${created.id}/rom/file/Showcase_ROM.${ext}`)).arrayBuffer());
  const rom = await get('z64'), bps = await get('bps');
  const original = fs.readFileSync(path.join(ROOT, 'engine', 'baserom.us.z64'));
  t.check('the patch rebuilds the ROM from the original', applyBps(original, bps).equals(rom));
  t.eq('the ROM is named in its header', rom.toString('latin1', 0x20, 0x34).trim(), 'SHOWCASE ROM');
  t.eq('the info block is there', rom.toString('latin1', 0x01000000, 0x01000004), 'S64H');
  t.check('the boot code is the original (emulators check its checksum)', rom.subarray(0x40, 0x1000).equals(original.subarray(0x40, 0x1000)));
  t.eq('the ROM fills whole megabytes', rom.length % (1 << 20), 0);
  // the replaced game songs: a table of (slot, song) the ROM reads at boot (s64_songs.c)
  const at = rom.readUInt32BE(0x01000DF8), n = rom.readUInt32BE(0x01000DFC);
  const table = at ? [...Array(n)].map((_, i) => rom.readUInt32BE(at + i * 8)) : [];
  t.eq('the ROM lists the replaced game songs', table.sort(), [0x01, 0x09]);
  const songs = rom.readUInt32BE(0x01000DE8), song = (i) => rom.readUInt32BE(at + i * 8 + 4);
  t.check('the fanfare gets its own play-once copy of the song', n === 2 && song(0) !== song(1) && song(0) < rom.readUInt32BE(0x01000DEC) && songs > 0, { n, a: song(0), b: song(1) });
  // Mario's look and the beta voice (s64_hack.h: flags bit 1, marioLook at 0xE00)
  const { MARIO_LIGHT_PRESETS, lightTable } = await import('../../web/js/mario_look.js');
  const beta = lightTable(MARIO_LIGHT_PRESETS.beta.light);
  t.eq('the ROM has the beta voice on', rom.readUInt16BE(0x0100000A) & 2, 2);
  t.eq('the ROM has Mario\'s look for every part and the light\'s direction', rom.readUInt32BE(0x01000E00) >>> 0, (0x7f | (beta.dir ? 0x80000000 : 0)) >>> 0);
  t.eq('the ROM has the beta skin light (amb, dif)', [rom.readInt16BE(0x01000E08 + 4 * 8 + 4), rom.readInt16BE(0x01000E08 + 4 * 8 + 6)], [beta.parts[4].amb, beta.parts[4].dif]);
  t.eq('the ROM has the green cap', [rom.readUIntBE(0x01000E08 + 6 * 8, 3), rom[0x01000E08 + 6 * 8 + 3]], [0x00c040, 1]);
  fs.writeFileSync(path.join(ROOT, 'tests', 'out', 'rom_export.z64'), rom); // (for emulator checks)
  t.check('the patch is a fraction of the ROM', bps.length < rom.length / 2, bps.length);
});
