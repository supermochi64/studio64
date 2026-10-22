// Shotgun Mario (ported from the Shoggoth World hack): the browser side.
//
//   - a level starts: the gun starts over (studio_shotgun_level_start), armed when the game rule
//     "Mario starts with the shotgun" is on for this level (game_rules.js passes live rule changes)
//   - walking into a Shotgun pickup: a short how-to card over the game (once per session)
//   - RPCs for the AI tools (server/tools/shotgun.js): state, give / take
//
// Engine side: engine/src/studio/shotgun.c, shotgun_objects.c (docs/shotgun.md).

import { levelKeyOf } from './objects/common.js';
import { registerRpc } from './studio.js';

export const SHOTGUN_ENTRY = 'sg:shotgun';
export const GANGSTER_ENTRY = 'sg:gangster';

let cssLoaded = false;
function loadCss() {
  if (cssLoaded || typeof document === 'undefined') return;
  cssLoaded = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../css/shotgun.css', import.meta.url).href;
  document.head.appendChild(l);
}

// The how-to card: the keys of the gun (B is J, L is Q, R is R, the C buttons are the arrow keys).
function showHowTo(frame) {
  loadCss();
  const host = frame || document.querySelector('#game-frame') || document.querySelector('#stage') || document.body;
  host.querySelector?.('.sg-howto')?.remove();
  const card = document.createElement('div');
  card.className = 'sg-howto';
  card.setAttribute('role', 'status');
  card.innerHTML = `<b>You got the shotgun!</b>
    <div class="sg-keys">
      <span><kbd>J</kbd> or <kbd>Q</kbd> fire &middot; hold for rapid fire</span>
      <span>Fire in the air: <em>shotgun jump</em></span>
      <span><kbd>R</kbd> aim &middot; <kbd>&larr;</kbd><kbd>&uarr;</kbd><kbd>&darr;</kbd><kbd>&rarr;</kbd> move the sight</span>
    </div>`;
  host.appendChild(card);
  setTimeout(() => card.classList.add('out'), 6500);
  setTimeout(() => card.remove(), 7200);
}

export function shotgunState(engine) {
  try { return engine.json('studio_shotgun_state_json'); } catch { return null; }
}

// Installed by installObjectsEngine (studio and standalone player).
export function installShotgun({ engine, rules }) {
  let lastLevel = null;
  let shownHowTo = false;
  const ruleOn = () => {
    try { return !!rules?.current?.shotgun; } catch { return false; }
  };
  // (after the objects' level hook: the rules of the new level are applied by then)
  engine.levelHooks.push(() => {
    const M = engine.M;
    if (!M?._studio_shotgun_level_start) return;
    const key = levelKeyOf(engine);
    if (key !== lastLevel) {
      lastLevel = key;
      M._studio_shotgun_level_start(ruleOn() ? 1 : 0);
    }
    M.studioShotgunEvent ||= (kind) => {
      if (kind === 'pickup') {
        window.dispatchEvent(new CustomEvent('studio:shotgun', { detail: { event: 'pickup' } }));
        if (!shownHowTo) { shownHowTo = true; showHowTo(); }
      }
    };
  });

  const api = {
    state: () => shotgunState(engine),
    give: (on = true) => { engine.M?._studio_shotgun_give?.(on ? 1 : 0); return shotgunState(engine); },
    setAim: (on) => engine.M?._studio_shotgun_set_aim?.(on ? 1 : 0),
    showHowTo,
  };
  window.studio64Shotgun = api;
  return api;
}

registerRpc('shotgun_state', function () {
  const s = shotgunState(this.engine);
  if (!s) throw new Error('the game is not running');
  return s;
});

registerRpc('shotgun_give', function ({ on = true } = {}) {
  const M = this.engine.M;
  if (!M?._studio_shotgun_give) throw new Error('this engine has no shotgun (rebuild it)');
  if (!this.engine.state().mario) throw new Error('Mario is not in a level');
  M._studio_shotgun_give(on ? 1 : 0);
  return shotgunState(this.engine);
});
