// The chat panel and the app chrome without talking to Claude: send button, focus between game
// and chat, attachments, model menu, tabs, project menu, share dialog, new chat.
// @tags smoke ui chat
import { suite } from '../lib/harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

await suite('chat ui', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  // never send anything to Claude from this test
  await s.eval(() => {
    const orig = WebSocket.prototype.send;
    window.__chatSent = 0;
    WebSocket.prototype.send = function (d) { if (String(d).includes('"type":"chat"')) { window.__chatSent++; return; } return orig.call(this, d); };
  });

  t.check('send disabled when empty', await page.isDisabled('#send'));
  // "/" from the game focuses the chat
  await page.focus('#canvas');
  await page.keyboard.press('Slash');
  t.eq('/ focuses the chat box', await s.eval(() => document.activeElement?.id), 'input');
  // typing does not move Mario
  const m0 = await s.mario();
  await page.keyboard.type('wasd wasd jump', { delay: 30 });
  await s.wait(300);
  const m1 = await s.mario();
  t.check('typing in the chat does not move Mario', Math.hypot(m1.x - m0.x, m1.z - m0.z) < 5, { m0, m1 });
  t.check('send enabled with text', await page.isEnabled('#send'));
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('second line');
  t.check('Shift+Enter adds a line', (await page.inputValue('#input')).includes('\n'));
  t.eq('nothing sent yet', await s.eval(() => window.__chatSent), 0);
  await page.keyboard.press('Escape');
  t.eq('Esc goes back to the game', await s.eval(() => document.activeElement?.id), 'canvas');
  await page.fill('#input', '');
  await s.eval(() => document.querySelector('#input').dispatchEvent(new Event('input')));
  t.check('send disabled again when emptied', await page.isDisabled('#send'));

  // attachments
  const png = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'out', 'chat_ui_attach.png');
  fs.mkdirSync(path.dirname(png), { recursive: true });
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC', 'base64'));
  await page.setInputFiles('#attach-file', png);
  await page.waitForSelector('#attachments .attachment', { timeout: 5000 });
  t.check('attachment shown', await page.isVisible('#attachments .attachment'));
  t.check('send enabled with only a picture', await page.isEnabled('#send'));
  await page.click('#attachments .attachment button');
  t.check('attachment removed', await page.isHidden('#attachments'));
  t.check('send disabled after removing it', await page.isDisabled('#send'));

  // model menu
  const before = await page.textContent('#model-name');
  await page.click('#model-btn');
  t.check('model menu opens', await page.isVisible('#model-menu'));
  const items = await page.locator('#model-menu .menu-item').count();
  t.check('several models', items >= 2, items);
  await page.locator('#model-menu .menu-item:not(.active)').first().click();
  t.check('model menu closes after picking', await page.isHidden('#model-menu'));
  const after = await page.textContent('#model-name');
  t.check('model label changes', after !== before, { before, after });
  await page.click('body', { position: { x: 5, y: 5 } }).catch(() => {});

  // tabs
  await page.click('.tab[data-tab=edits]');
  t.check('edits tab', await page.isVisible('#edits-pane') && await page.isHidden('#chat-pane'));
  t.check('edits empty note', /No edits yet/.test(await page.textContent('#edits-list')));
  await page.click('.tab[data-tab=stars]');
  t.check('stars tab', await page.isVisible('#stars-pane'));
  await page.click('.tab[data-tab=chat]');
  t.check('chat tab back', await page.isVisible('#chat-pane'));

  // project menu and share dialog (their contents belong to the projects feature: only basics here)
  await page.click('#menu-btn');
  await page.waitForSelector('#project-menu:not([hidden])', { timeout: 5000 }).catch(() => {});
  t.check('project menu opens', await page.isVisible('#project-menu'));
  t.check('project menu has items', (await page.locator('#project-menu .menu-item').count()) >= 3);
  await page.click('#game-frame', { position: { x: 30, y: 30 } }).catch(() => {});
  await s.wait(200);
  t.check('clicking elsewhere closes the menu', await page.isHidden('#project-menu'));
  await page.click('#share-btn');
  await s.wait(600);
  const shareText = await s.eval(() => [...document.querySelectorAll('input, textarea')].map((i) => i.value).join(' ') + document.body.innerText);
  t.check('share shows the project link', shareText.includes(s.projectId));
  await page.keyboard.press('Escape');
  await s.wait(300);
  if (await page.isVisible('#modal-back')) await page.click('#modal-back', { position: { x: 5, y: 5 } });
  t.check('share dialog closes', await page.isHidden('#modal-back'));
  // the level chip opens the launcher
  await page.click('#level-chip');
  t.check('level chip opens the launcher', await page.isVisible('#launcher'));
  await page.keyboard.press('Escape');
  t.check('Esc closes the launcher', await page.isHidden('#launcher'));
  // project rename
  await page.fill('#project-name', 'Renamed hack');
  await page.press('#project-name', 'Enter');
  await s.wait(700);
  t.eq('project renamed on the server', (await s.export()).name, 'Renamed hack');
  t.check('page title follows', /Renamed hack/.test(await page.title()));
  t.eq('still nothing sent to Claude', await s.eval(() => window.__chatSent), 0);
  await s.shot('chat_ui');
});
