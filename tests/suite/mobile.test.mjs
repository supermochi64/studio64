// Phone-size layout: no sideways scrolling, the game is on screen and drawn, the chat and the
// top bar fit, panels open and close; a small laptop window too.
// @tags ui
import { suite } from '../lib/harness.mjs';

async function layout(s) {
  return s.eval(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, vis: !!(b.width && b.height) && getComputedStyle(e).visibility !== 'hidden' }; };
    // elements that stick out of the window on the right
    const out = [...document.querySelectorAll('header *, .topbar *, .composer *, .tabs *')].filter((e) => {
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.right > vw + 1 && getComputedStyle(e).position !== 'fixed';
    }).map((e) => `${e.tagName.toLowerCase()}#${e.id}.${[...e.classList].join('.')}`).slice(0, 8);
    return { vw, vh, scrollW: document.scrollingElement.scrollWidth, game: r('#game-frame'), canvas: r('#canvas'), input: r('#input'), out };
  });
}

await suite('mobile', async (t) => {
  const s = await t.open({ level: 9, viewport: { width: 390, height: 844 }, mobile: true });
  let L = await layout(s);
  t.check('no sideways scrolling on a phone', L.scrollW <= L.vw + 1, L);
  t.check('game frame on screen', L.game?.vis && L.game.w >= L.vw * 0.8 && L.game.h > 150, L.game);
  t.check('canvas drawn', L.canvas?.vis && await s.framesAdvance());
  t.check('nothing in the top bar or composer sticks out', L.out.length === 0, L.out);
  await s.shot('phone');
  // the chat box can be reached and used
  await s.page.locator('#input').scrollIntoViewIfNeeded();
  t.check('chat box reachable', await s.page.isVisible('#input'));
  // landscape phone
  await s.page.setViewportSize({ width: 844, height: 390 });
  await s.wait(800);
  L = await layout(s);
  t.check('landscape: no sideways scrolling', L.scrollW <= L.vw + 1, L);
  t.check('landscape: game visible', L.game?.vis && L.game.h > 150, L.game);
  await s.shot('landscape');
  // small laptop
  await s.page.setViewportSize({ width: 1024, height: 640 });
  await s.wait(800);
  L = await layout(s);
  t.check('1024x640: no sideways scrolling', L.scrollW <= L.vw + 1, L);
  t.check('1024x640: nothing sticks out', L.out.length === 0, L.out);
  await s.build();
  await s.wait(500);
  const lib = await s.eval(() => { const b = document.querySelector('#library').getBoundingClientRect(); return { w: b.width, h: b.height }; });
  t.check('1024x640: build library visible', lib.w > 150 && lib.h > 200, lib);
  await s.shot('laptop_build');
});
