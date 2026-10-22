// The launch screen in the standalone player (web/js/player.js): when the hack has one, it
// replaces the player's title card. Splash screens play while the game loads; the title waits
// for the game; the file select offers Continue (when this browser has a save) and New game.
import { normalizeTitle } from './schema.js';
import { TitleScreen, TitleStage } from './title_screen.js';

// Returns true when the hack has a launch screen (and it took over the start).
export function playerLaunch(state, { stage, legal, onPlay }) {
  const title = normalizeTitle(state.hack?.title);
  if (!title.on) return false;
  state.launch = true;
  const card = document.querySelector('#title');
  if (card) card.hidden = true;
  const scr = new TitleScreen({ host: stage, legal });
  scr.setTitle(title);
  state.titleScreen = scr;
  const hasSave = () => {
    try { if (state.storyRuntime?.progress?.started) return true; } catch { /* none */ }
    try { if (state.world?.collectedTotal?.() > 0) return true; } catch { /* none */ }
    try { const m = state.engine?.state?.().mario; if (m && m.stars > 0) return true; } catch { /* loading */ }
    return false;
  };
  const stars = () => { try { return state.engine.state().mario?.stars ?? state.world.collectedTotal(); } catch { return 0; } };
  (async () => {
    // (the screen is up at once; its pictures arrive while the splash screens play)
    scr.load(title, { levelPicture: null }).catch((err) => console.warn('launch pictures', err));
    // the engine background needs the game; until then the splashes (and a black title) cover the loading
    const boot = state.hack.boot || {};
    let tstage = null;
    const make = () => {
      if (tstage || !state.engine) return tstage;
      tstage = new TitleStage({ engine: state.engine, flow: () => state.worldFlow, songs: () => state.hack.audio?.songs || [], home: { level: boot.level || 16, custom: boot.custom && (state.hack.levels || []).some((l) => l.id === boot.custom) ? boot.custom : null } });
      return tstage;
    };
    // a stage that appears once the engine is there
    const lazy = {
      get engine() { return state.engine; },
      get visible() { return make()?.visible ?? false; },
      start: (t, i) => make().start(t, i),
      stop: () => (tstage ? tstage.stop() : Promise.resolve()),
    };
    const res = await scr.run({ stage: lazy, ready: () => !!state.engine?.ready, canContinue: hasSave(), stars: stars(), name: state.hack.name || '', newLabel: 'START' });
    onPlay(res.choice === 'continue' ? 'continue' : (hasSave() ? 'new' : 'first'));
    // the black screen goes once Mario is in the first level
    const e = state.engine;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const poll = () => {
        let m = null;
        try { m = e.state().mario; } catch { /* loading */ }
        if ((m && !e.inIntro && performance.now() - t0 > 400) || performance.now() - t0 > 30000) resolve(); else setTimeout(poll, 100);
      };
      poll();
    });
    scr.close();
  })().catch((err) => { console.error('launch screen', err); scr.close(); onPlay('continue'); });
  return true;
}
