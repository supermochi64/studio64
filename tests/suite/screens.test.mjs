// Every main screen once (play, build library tabs, inspector, launcher, new level, sound
// studio tabs, stars/edits tabs): nothing sticks out of the window, no button or label text
// overflows its box, no broken images. Saves a picture of each for a look.
// @tags ui
// @timeout 600
import { suite } from '../lib/harness.mjs';

// Visible elements whose text does not fit (buttons, labels, tabs, menu items, titles).
const audit = (s, scope) => s.eval((scope) => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const root = document.querySelector(scope) || document.body;
  const vis = (e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[hidden]'); };
  const name = (e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : ''} "${(e.textContent || '').trim().slice(0, 30)}"`;
  const overflow = [], outside = [], broken = [];
  for (const e of root.querySelectorAll('button, .btn, .tab, .menu-item, label, .lib-tab, .seg-btn, .ss-tab, h1, h2, .lvl-title, .insp-title, .preset span, .gen span')) {
    if (!vis(e)) continue;
    const cs = getComputedStyle(e);
    // text cut off without an ellipsis, or spilling over its box
    if (e.scrollWidth > e.clientWidth + 2 && cs.textOverflow !== 'ellipsis' && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && e.clientWidth > 0) overflow.push(name(e) + ` ${e.scrollWidth}>${e.clientWidth}`);
  }
  for (const e of root.querySelectorAll('*')) {
    if (!vis(e)) continue;
    const b = e.getBoundingClientRect();
    if ((b.right > vw + 2 || b.bottom > vh + 2) && getComputedStyle(e).position !== 'fixed' && !e.closest('.lvl-grid, .ss-list, .obj-grid, .messages, .gs-list, .lib-pane, .launcher-body, .ss-main, .ss-side, .edits-list, .inspector, .cmp-roll, .cmp-tracks')) outside.push(name(e));
  }
  for (const im of root.querySelectorAll('img')) if (vis(im) && im.complete && im.naturalWidth === 0 && im.src) broken.push(im.src.slice(0, 80));
  return { overflow: overflow.slice(0, 10), outside: outside.slice(0, 10), broken: broken.slice(0, 10) };
}, scope);

await suite('screens', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  const check = async (label, scope = 'body') => {
    await s.wait(400);
    // entrance animations (panels sliding in) must be over before measuring
    await s.until(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming?.().iterations === Infinity), null, 5000);
    const a = await audit(s, scope);
    t.check(`${label}: no text overflows`, a.overflow.length === 0, a.overflow);
    t.check(`${label}: nothing outside the window`, a.outside.length === 0, a.outside);
    t.check(`${label}: no broken images`, a.broken.length === 0, a.broken);
    await s.shot(label.replace(/\W+/g, '_'));
  };
  await check('play');
  await s.build();
  for (const tab of ['blocks', 'objects', 'terrain', 'structures']) {
    await page.click(`.lib-tab[data-lib=${tab}]`);
    await page.waitForTimeout(300);
    await check(`build ${tab}`);
  }
  // object thumbnails load
  await page.click('.lib-tab[data-lib=objects]');
  const thumbs = await s.eval(async () => {
    const imgs = [...document.querySelectorAll('#obj-grid img')].slice(0, 40);
    await new Promise((r) => setTimeout(r, 1500));
    return { n: imgs.length, bad: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src) };
  });
  t.check('object thumbnails load', thumbs.n > 10 && thumbs.bad.length === 0, thumbs);
  // inspector on a placed block and on an original object
  await page.click('.lib-tab[data-lib=blocks]');
  await page.click('.preset:has-text("Stairs")');
  const gp = await s.groundPoint();
  await s.clickAt(gp.x, gp.y);
  await page.keyboard.press('Escape');
  await s.wait(500);
  await s.eval(() => { const r = studio64.editor.records().filter((x) => x.block).pop(); const o = studio64.engine.objects().find((x) => x.uid === r.uid); studio64.editor.select(o.slot); });
  await check('inspector block');
  await s.eval(() => { const o = studio64.engine.objects().find((x) => x.bhv === 'bhvBobomb'); if (o) studio64.editor.select(o.slot); });
  await check('inspector object');
  await page.keyboard.press('Escape');
  // launcher and new level
  await page.keyboard.press('Control+k');
  await check('launcher', '#launcher');
  await page.click('#launcher-body .lvl-card.new');
  await check('new level', '#launcher');
  await page.focus('#nl-name');
  await page.keyboard.press('Escape');
  t.check('Esc in the new-level page goes back to the list', await page.isVisible('#launcher') && !(await page.$('#nl-name')));
  await page.keyboard.press('Escape');
  t.check('second Esc closes the launcher', await page.isHidden('#launcher'));
  // sound studio
  await page.focus('#canvas');
  await page.click('#sound-btn');
  await page.waitForFunction(() => studio64.soundUI.banks?.length, null, { timeout: 15000 });
  await check('sound music', '#sound-studio');
  await page.locator('.starter').first().click();
  await check('sound composer', '#sound-studio');
  await page.click('.ss-tab[data-tab=sounds]');
  await check('sound effects', '#sound-studio');
  await page.keyboard.press('Escape');
  // side tabs
  await page.click('.tab[data-tab=edits]');
  await check('edits tab');
  await page.click('.tab[data-tab=stars]');
  await check('stars tab');
});
