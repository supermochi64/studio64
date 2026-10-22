// The Sunshine tab of the object library: every ported character is listed with its thumbnail,
// a Cataquack is placed with the mouse, its "Kind" control turns it red, and all of it is saved.
import { chromium } from 'playwright';
import fs from 'node:fs';
const URL = process.env.STUDIO_URL || 'http://127.0.0.1:8064';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const proj = await (await fetch(URL + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 9 }) })).json();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('pageerror:', e.message); });
await page.goto(URL + '/?p=' + proj.id);
await page.waitForSelector('#loading', { state: 'hidden', timeout: 120000 });
await page.click('#start', { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1200);
await page.evaluate(() => document.querySelector('#mode-build').click());
await page.waitForTimeout(800);
const box = await page.locator('#overlay').boundingBox();
const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
await page.evaluate(() => { for (const b of document.querySelectorAll('button')) if (b.textContent.trim() === 'Objects') b.click(); });
await page.waitForTimeout(300);
await page.click('#obj-cats .chip:has-text("Sunshine")');
await page.waitForTimeout(500);
const listed = await page.$$eval('#obj-grid .obj-name', (n) => n.map((x) => x.textContent));
console.log('listed:', listed.join(', '));
const want = ['Pianta', 'Pianta (woman)', 'Noki', 'Noki (woman)', 'Shine Sprite', "Strollin' Stu", "Swoopin' Stu", 'Electrokoopa', 'Pokey (Sunshine)', 'Cataquack', 'Blooper (Sunshine)'];
const missing = want.filter((w) => !listed.includes(w));
const thumbs = await page.$$eval('#obj-grid .obj img', (imgs) => imgs.filter((i) => /sms__/.test(i.src)).length);
await page.click('#obj-grid .obj:has-text("Cataquack")');
await page.mouse.move(...at(0.5, 0.7)); await page.waitForTimeout(300);
await page.mouse.move(...at(0.52, 0.72)); await page.waitForTimeout(300);
await page.mouse.click(...at(0.52, 0.72));
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.mouse.click(...at(0.52, 0.69));
await page.waitForTimeout(800);
// the inspector's friendly controls: Kind (red) and Does
const kinds = await page.$$eval('select[data-param]', (s) => s.map((x) => x.closest('.insp-sec')?.querySelector('.insp-label')?.textContent));
console.log('controls:', kinds.join(', '));
const kind = page.locator('select[data-param="2"]');
if (await kind.count()) { await kind.selectOption('1'); await page.waitForTimeout(800); }
await page.screenshot({ path: 'tests/out/sunshine_library.png' });
await page.waitForTimeout(1500);
// (through the API: the server's projects folder is not always server/projects, e.g. the test runner's own)
const saved = await (await fetch(`${URL}/api/projects/${proj.id}/export`)).json();
const recs = JSON.stringify(saved).match(/"entry":"sms:cataquack"[^}]*/g) || [];
const red = recs.some((r) => /"bparams":256\b/.test(r));
const ok = !missing.length && thumbs >= want.length && kinds.includes('Kind') && red && !errors.length;
console.log(`missing: [${missing}] thumbs ${thumbs} saved cataquacks ${recs.length} red ${red}`);
console.log(ok ? 'PASS sunshine library' : 'FAIL sunshine library');
await browser.close();
process.exit(ok ? 0 : 1);
