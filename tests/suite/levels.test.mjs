// Levels: the launcher (Ctrl+K, search, jump), a new level from every template, rename,
// duplicate and delete from the card menu, reopening the last level after a reload.
// @tags levels
// @timeout 600
import { suite } from '../lib/harness.mjs';

await suite('levels', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;

  // launcher
  await page.focus('#canvas');
  await page.keyboard.press('Control+k');
  t.check('Ctrl+K opens the launcher', await page.isVisible('#launcher'));
  const cards = await page.locator('#launcher-body .lvl-card').count();
  t.check('launcher lists the original levels', cards >= 25, cards);
  await page.fill('#launcher-search', 'whomp');
  const shown = await page.locator('#launcher-body .lvl-card:visible').allTextContents();
  t.check('search filters the cards', shown.length >= 1 && shown.every((x) => /whomp/i.test(x)), shown);
  // broken pictures
  const broken = await s.eval(async () => {
    const urls = [...document.querySelectorAll('#launcher-body .lvl-pic')].map((p) => (p.style.backgroundImage.match(/url\("?(.*?)"?\)/) || [])[1]).filter(Boolean);
    const bad = [];
    for (const u of urls) { if (u.startsWith('data:')) continue; const r = await fetch(u); if (!r.ok) bad.push(u); }
    return bad;
  });
  t.eq('every level picture loads', broken, []);
  await page.keyboard.press('Escape');
  await s.wait(300);
  // jump by clicking a card
  if (await page.isHidden('#launcher')) await page.keyboard.press('Control+k');
  await page.fill('#launcher-search', 'whomp');
  await s.markArea();
  await page.locator('#launcher-body .lvl-card:visible').first().click();
  t.check('the launcher closes on a jump', await page.isHidden('#launcher'));
  await s.skipIntro();
  await s.arriveNew(24);
  t.check('card click jumps to Whomp\'s Fortress', /whomp/i.test(await page.textContent('#level-name')), await page.textContent('#level-name'));

  // a new level from every template
  const templates = await s.eval(async () => (await import('/js/templates.js')).TEMPLATES).then((x) => Object.keys(x));
  t.check('templates available', templates.length >= 9, templates);
  const made = [];
  for (const tp of templates) {
    await page.keyboard.press('Escape');
    await page.focus('#canvas');
    await page.keyboard.press('Control+k');
    await page.click('#launcher-body .lvl-card.new');
    await page.fill('#nl-name', `T ${tp}`);
    const before = await s.eval(() => studio64.levels.length);
    await s.markArea();
    await page.locator('#launcher-body .lvl-card', { hasText: (await s.eval(async (k) => (await import('/js/templates.js')).TEMPLATES[k].label, tp)) }).first().click();
    await page.waitForFunction((n) => studio64.levels.length > n, before, { timeout: 10000 });
    await s.skipIntro();
    await s.arriveNew(37, 60000);
    const info = await s.eval(() => {
      const e = studio64.engine, m = e.state().mario;
      return { key: e.areaKey(), name: document.querySelector('#level-name').textContent, m, floor: e.floor(m.x, m.y + 200, m.z) };
    });
    made.push(info.key.slice(2));
    t.eq(`${tp}: level chip shows the name`, info.name, `T ${tp}`);
    t.check(`${tp}: mario stands on ground`, info.floor > -10000 && Math.abs(info.m.y - info.floor) < 400, info);
    t.check(`${tp}: no crash`, !(await s.crashed()) && (await s.framesAdvance()));
    // build mode comes back after creating a level
    t.check(`${tp}: build mode after creating`, await s.eval(() => studio64.editor.active).catch(() => false));
    await s.shot(`tpl_${tp}`);
  }
  const ex = await s.export();
  t.eq('server knows every level', (await s.eval(() => studio64.levels.length)), templates.length);
  // (sky islands are all blocks, no terrain)
  t.check('every level has its area saved', made.every((id) => ex.areas[`c:${id}`]?.terrain || ex.areas[`c:${id}`]?.objects?.length), made.filter((id) => !ex.areas[`c:${id}`]));

  // a level from a heightmap picture
  await page.keyboard.press('Escape');
  await page.focus('#canvas');
  await page.keyboard.press('Control+k');
  await page.click('#launcher-body .lvl-card.new');
  await page.fill('#nl-name', 'From a picture');
  await page.setInputFiles('.img-drop input[type=file]', new URL('../fixtures/heightmap.png', import.meta.url).pathname);
  await s.markArea();
  await page.click('#img-height');
  await s.skipIntro();
  await s.arriveNew(37, 60000);
  t.eq('heightmap level opens', await page.textContent('#level-name'), 'From a picture');
  const hm = await s.eval(() => { const T = studio64.world.terrain; return T && { lo: Math.min(...T.h), hi: Math.max(...T.h) }; });
  t.check('heightmap level has hills from the picture', hm && hm.hi - hm.lo > 500, hm);
  const mm = await s.mario();
  t.check('Mario stands on the heightmap ground', mm.floorY > -10000 && mm.y - mm.floorY < 300, mm);

  // card menu: rename
  await s.play();
  const openMenu = async (title) => {
    if (await page.isHidden('#launcher')) { await page.focus('#canvas'); await page.keyboard.press('Control+k'); }
    await s.wait(200);
    await page.locator('.lvl-card', { hasText: title }).first().locator('.lvl-menu').click();
  };
  await openMenu('T meadow');
  await page.click('#level-card-menu .menu-item:has-text("Rename")');
  await page.fill('#ask-in', 'Green hills');
  await page.press('#ask-in', 'Enter');
  await page.waitForFunction(() => studio64.levels.some((l) => l.name === 'Green hills'), null, { timeout: 5000 }).catch(() => {});
  t.check('rename', await s.eval(() => studio64.levels.some((l) => l.name === 'Green hills')));
  t.check('launcher shows the new name', await page.locator('.lvl-card', { hasText: 'Green hills' }).count() > 0);
  // duplicate: goes to the copy
  await openMenu('Green hills');
  await s.markArea();
  await page.click('#level-card-menu .menu-item:has-text("Duplicate")');
  await page.waitForFunction(() => studio64.levels.some((l) => l.name === 'Green hills copy'), null, { timeout: 5000 }).catch(() => {});
  t.check('duplicate', await s.eval(() => studio64.levels.some((l) => l.name === 'Green hills copy')));
  await s.skipIntro();
  await s.arriveNew(37);
  t.eq('duplicate opens the copy', await page.textContent('#level-name'), 'Green hills copy');
  // delete the level we are in: we go somewhere else
  await openMenu('Green hills copy');
  await page.click('#level-card-menu .menu-item:has-text("Delete")');
  await s.markArea();
  await page.click('#ask-ok');
  await s.skipIntro();
  await s.arriveNew(null);
  await s.wait(500);
  t.check('deleted level gone', !(await s.eval(() => studio64.levels.some((l) => l.name === 'Green hills copy'))));
  t.check('not left in the deleted level', (await page.textContent('#level-name')) !== 'Green hills copy', await page.textContent('#level-name'));
  await page.focus('#canvas');
  await page.keyboard.press('Control+k');
  t.check('deleted level gone from the launcher', await page.locator('#launcher-body .lvl-card', { hasText: 'Green hills copy' }).count() === 0);
  t.check('the original is still there', await page.locator('#launcher-body .lvl-card', { hasText: 'Green hills' }).count() === 1);
  await page.keyboard.press('Escape');

  // reload: back in the last level
  await s.goCustom(made[0]);
  const before = await page.textContent('#level-name');
  await page.reload({ timeout: 120000, waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 120000 });
  await page.waitForFunction(() => studio64.engine?.ready, null, { timeout: 60000 });
  await s.skipIntro();
  await s.arrive(37, 60000).catch(() => {});
  t.eq('reload reopens the last level', await page.textContent('#level-name'), before);
});
