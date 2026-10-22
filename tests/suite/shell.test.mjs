// The studio shell: the workspace rail (every workspace button, one current at a time, switching
// closes the open one), the command palette (Ctrl+P, search, run, hand the words to Claude), the
// shortcut sheet (?), the chat toggle (Ctrl+J), dialogs instead of confirm(), keyboard focus,
// tooltips, the tour (Help) and no sideways overflow from phone to wide screens.
// @tags ui
import { suite } from '../lib/harness.mjs';

await suite('shell', async (t) => {
  const s = await t.open({ level: 9, query: '&tips=1' });
  const { page } = s;
  const vis = (sel) => page.isVisible(sel);
  const current = () => s.eval(() => [...document.querySelectorAll('#rail .ws-current')].map((b) => b.id));

  // the rail has every workspace, labelled, in order
  const rail = await s.eval(() => [...document.querySelectorAll('#rail button')].map((b) => ({ id: b.id, label: b.querySelector('.rail-label')?.textContent.trim(), name: b.getAttribute('aria-label') })));
  const ids = rail.map((b) => b.id);
  for (const id of ['mode-play', 'mode-build', 'story-btn', 'assets-btn', 'sound-btn', 'game-btn', 'test-btn', 'help-btn']) t.check(`rail has ${id}`, ids.includes(id), ids);
  t.check('rail buttons have labels and names', rail.every((b) => b.label && b.name), rail);
  t.check('play before build before story', ids.indexOf('mode-play') < ids.indexOf('mode-build') && ids.indexOf('mode-build') < ids.indexOf('story-btn'), ids);
  t.check('nothing but the essentials left in the top bar', await s.eval(() => [...document.querySelectorAll('.topbar button')].every((b) => ['level-chip', 'share-btn', 'menu-btn', 'cmdk-btn', 'chat-toggle'].includes(b.id))));
  t.eq('Play is current', await current(), ['mode-play']);

  // switching workspaces
  await page.click('#mode-build');
  await s.wait(900);
  t.eq('Build is current', await current(), ['mode-build']);
  t.check('library tabs have icons', await s.eval(() => [...document.querySelectorAll('.lib-tab')].every((b) => b.querySelector('.lt-ico svg'))));
  await page.click('#story-btn');
  await s.wait(700);
  t.check('story docks into the stage', await s.eval(() => { const r = document.querySelector('#story-studio').getBoundingClientRect(); const rail = document.querySelector('#rail').getBoundingClientRect(); const side = document.querySelector('#side').getBoundingClientRect(); return r.left >= rail.right - 1 && r.right <= side.left + 1 && r.top >= 50; }));
  t.eq('Story is current', await current(), ['story-btn']);
  t.check('the chat stays usable beside Story', await vis('#input'));
  await page.click('#sound-btn');
  await s.wait(700);
  t.check('opening Sound closes Story', !(await vis('#story-studio')) && await vis('#sound-studio'));
  t.eq('Sound is current', await current(), ['sound-btn']);
  await page.click('#mode-play');
  await s.wait(900);
  t.check('Play closes the workspace and leaves build mode', !(await vis('#sound-studio')) && !(await s.eval(() => studio64.editor.active)));

  // the command palette
  await page.keyboard.press('Control+p');
  await s.wait(300);
  t.check('Ctrl+P opens the palette', await vis('.cmdk'));
  const groups = await s.eval(() => [...document.querySelectorAll('.cmdk-group')].map((g) => g.textContent));
  t.check('palette lists workspaces, build tools and project actions', ['Workspaces', 'Build tools', 'Project'].every((g) => groups.includes(g)), groups);
  await page.keyboard.type('sound');
  await s.wait(200);
  t.check('search finds the sound studio', /sound/i.test(await page.textContent('.cmdk-item.active')));
  await page.keyboard.press('Enter');
  await s.wait(800);
  t.check('Enter runs it', await vis('#sound-studio') && !(await vis('.cmdk')));
  await page.keyboard.press('Control+p');
  await s.wait(300);
  t.check('the palette also opens over a workspace', await vis('.cmdk'));
  await page.keyboard.press('Escape');
  await s.wait(300);
  t.check('Esc closes only the palette', !(await vis('.cmdk')) && await vis('#sound-studio'));
  await page.keyboard.press('Escape');
  await s.wait(400);
  await page.keyboard.press('Control+p');
  await page.keyboard.type('whomp');
  await s.wait(200);
  t.check('levels are in the palette', /whomp/i.test(await page.textContent('.cmdk-item.active')));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+p');
  await page.keyboard.type('zzqx make it rain coins');
  await s.wait(200);
  t.check('no match offers Claude', /Claude/.test(await page.textContent('.cmdk-list')));
  await page.keyboard.press('Enter');
  await s.wait(300);
  t.eq('the words go to the chat box (not sent)', await page.inputValue('#input'), 'zzqx make it rain coins');
  await page.fill('#input', '');
  await s.eval(() => document.activeElement.blur());

  // shortcut sheet and help
  await page.keyboard.press('Shift+Slash');
  await s.wait(300);
  t.check('? opens the shortcut sheet', await vis('.shell-sheet'));
  t.check('the sheet lists the palette and build keys', /Command palette/.test(await page.textContent('.shell-sheet')) && /Duplicate/.test(await page.textContent('.shell-sheet')));
  await page.keyboard.press('Escape');
  await s.wait(200);
  t.check('Esc closes the sheet', !(await vis('.shell-sheet')));
  await page.click('#help-btn');
  await s.wait(200);
  t.check('Help menu opens', await vis('#shell-menu'));
  await page.click('#shell-menu .menu-item >> text=Take the tour');
  await s.wait(500);
  t.check('the tour runs from Help', await vis('.tour-card'));
  for (let i = 0; i < 8 && await vis('.tour-card'); i++) { await page.click('.tour-card [data-a=next]'); await s.wait(350); }
  t.check('the tour ends', !(await vis('.tour')));

  // chat toggle
  await page.keyboard.press('Control+j');
  await s.wait(400);
  t.check('Ctrl+J hides the chat', !(await vis('#side')));
  t.check('the game grows', await s.eval(() => document.querySelector('#game-frame').getBoundingClientRect().width > window.innerWidth * 0.7));
  await page.keyboard.press('Control+j');
  await s.wait(400);
  t.check('Ctrl+J brings it back', await vis('#side'));

  // dialogs replace confirm()
  const answer = s.eval(() => import('/js/dialogs.js').then((d) => d.askConfirm({ title: 'Delete it?', ok: 'Delete', danger: true })));
  await s.wait(300);
  t.check('a styled dialog shows', await vis('.dlg') && /Delete it\?/.test(await page.textContent('.dlg')));
  await page.keyboard.press('Enter');
  t.eq('Enter confirms', await answer, true);
  const text = s.eval(() => import('/js/dialogs.js').then((d) => d.askText({ title: 'Name', value: 'Goomba' })));
  await s.wait(300);
  await page.keyboard.type('Bob');
  await page.keyboard.press('Escape');
  t.eq('Esc cancels a text dialog', await text, null);

  // tooltips show the shortcut
  await page.hover('#story-btn');
  await s.wait(700);
  t.check('rail tooltip with its key', await vis('.tip') && /Y/.test(await page.textContent('.tip-keys').catch(() => '')));
  await page.mouse.move(700, 500);

  // Tab still switches Play/Build; keyboard users can walk the interface with Shift+Tab
  await page.focus('#canvas');
  await page.keyboard.press('Tab');
  await s.wait(700);
  t.check('Tab enters build mode', await s.eval(() => studio64.editor.active));
  await page.keyboard.press('Tab');
  await s.wait(700);
  t.check('Tab goes back to playing', !(await s.eval(() => studio64.editor.active)));
  await page.focus('#canvas');
  await page.keyboard.press('Shift+Tab');
  t.check('Shift+Tab moves the focus into the interface', await s.eval(() => document.activeElement && document.activeElement.id !== 'canvas' && document.activeElement !== document.body));
  await page.keyboard.press('Tab');
  t.check('… and Tab moves on instead of switching modes', !(await s.eval(() => studio64.editor.active)));

  // without AI: no chat column, nothing mentions Claude, the history/stars panel on Ctrl+J
  await s.eval(() => document.body.classList.add('no-ai'));
  await s.wait(500);
  t.check('no-AI: the chat column is gone', !(await vis('#side')));
  t.check('no-AI: the game takes the width', await s.eval(() => document.querySelector('#game-frame').getBoundingClientRect().width > window.innerWidth * 0.75));
  await page.keyboard.press('Control+p');
  await s.wait(300);
  const pal = await page.textContent('.cmdk-list');
  t.check('no-AI: the palette has no AI actions', !/Claude|AI settings|conversation/i.test(pal), pal.slice(0, 300));
  await page.keyboard.type('qqqzz');
  await s.wait(200);
  t.check('no-AI: no "ask Claude" fallback', !/Claude/.test(await page.textContent('.cmdk-list')));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+Slash');
  await s.wait(300);
  t.check('no-AI: the shortcut sheet does not mention Claude', !/Claude|chat/i.test(await page.textContent('.shell-sheet')));
  await page.keyboard.press('Escape');
  await s.eval(() => studio64.shell.startTour(true));
  let tourText = '';
  for (let i = 0; i < 10 && await vis('.tour-card'); i++) { tourText += await page.textContent('.tour-card'); await page.click('.tour-card [data-a=next]'); await s.wait(300); }
  t.check('no-AI: the tour does not mention Claude or chat', tourText.length > 100 && !/Claude|chat|asking/i.test(tourText), tourText.slice(0, 200));
  await page.keyboard.press('Control+j');
  await s.wait(400);
  t.check('no-AI: Ctrl+J opens the history and stars', await vis('#side') && await vis('.tab[data-tab=edits]') && !(await vis('.tab[data-tab=chat]')));
  await page.keyboard.press('Control+j');
  await s.eval(() => document.body.classList.remove('no-ai'));
  await s.wait(500);
  t.check('AI back: the chat column returns', await vis('#side') && await vis('.tab[data-tab=chat]'));

  // no sideways scrolling from phone to wide
  for (const [w, h] of [[1920, 1080], [1280, 800], [1024, 700], [768, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await s.wait(500);
    t.check(`no sideways scrolling at ${w}px`, await s.eval(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await s.shot('shell');
});
