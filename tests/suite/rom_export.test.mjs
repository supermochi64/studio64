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
  t.check('the patch is a fraction of the ROM', bps.length < rom.length / 2, bps.length);
});
