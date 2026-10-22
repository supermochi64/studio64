// The Shoggoth content ships without Nintendo's data: no vanilla triangle or recoloured vanilla texture is
// left in the shipped files (tools/shoggoth/check_shipped.mjs), the recipes rebuild for this ROM
// (tools/shoggoth/rom_parts.py), and every package's files and data are there. No browser.
// @tags shoggoth
// @timeout 300
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { suite, ROOT } from '../lib/harness.mjs';

await suite('shoggoth content', async (t) => {
  const pk = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'shoggoth', 'packages.json'), 'utf8'));
  for (const p of pk) {
    for (const f of [p.recipes, ...p.files]) t.check(`${p.name}: ${f} ships`, fs.existsSync(path.join(ROOT, f)));
    const r = JSON.parse(fs.readFileSync(path.join(ROOT, p.recipes), 'utf8'));
    t.check(`${p.name}: its recipes name the game's pieces (lists and textures)`, Object.keys(r.dls).length + Object.keys(r.textures).length > 0);
  }
  for (const f of ['web/data/shoggoth/tokyo.json', 'web/data/katana.json', 'engine/sound/sound_banks/26_studio_tokyo.json', 'engine/src/studio/katana/katana_poses.h',
    'engine/src/studio/katana/catalog.json', 'engine/src/studio/shotgun/catalog.json', 'engine/src/studio/vehicles/catalog.json', 'engine/src/studio/shoggoth/gen/catalog.json']) {
    t.check(`${f} ships`, fs.existsSync(path.join(ROOT, f)));
  }
  const rp = spawnSync('python3', [path.join(ROOT, 'tools', 'shoggoth', 'rom_parts.py')], { cwd: ROOT, encoding: 'utf8' });
  t.check('the recipes build from this ROM (rom_parts.py)', rp.status === 0, (rp.stdout + rp.stderr).slice(-400));
  const n = fs.existsSync(path.join(ROOT, 'engine/src/studio/romgen')) ? fs.readdirSync(path.join(ROOT, 'engine/src/studio/romgen'), { recursive: true }).filter((f) => String(f).endsWith('.inc.c')).length : 0;
  t.check('the romgen pieces are there', n > 50, n);
  const ck = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'shoggoth', 'check_shipped.mjs')], { cwd: ROOT, encoding: 'utf8' });
  t.log((ck.stdout || '').trim());
  t.check('no game data in the shipped Shoggoth files', ck.status === 0, (ck.stdout + ck.stderr).slice(-800));
});
