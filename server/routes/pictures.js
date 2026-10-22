// Which of the game's pictures exist (web/thumbs/): on a fresh install the first-run setup makes
// them in the background while the studio already runs, so the app asks first and shows its
// letter placeholders for the rest instead of requesting pictures that are not there (404s).
//
//   GET /api/pictures   -> { objects: [ids], levels: [nums], templates: [ids], hub: [names], making }
//                          making: the setup is still taking pictures (ask again when it is done)
import fs from 'node:fs';
import path from 'node:path';
import { setup } from '../setup/index.js';

export default (ctx) => {
  const dir = path.join(ctx.WEB, 'thumbs');
  const list = (sub, ext) => {
    try { return fs.readdirSync(path.join(dir, sub)).filter((f) => f.endsWith(ext) && !f.startsWith('.')).map((f) => f.slice(0, -ext.length)); } catch { return []; }
  };
  return {
    http: async (req, res, url) => {
      if (url.pathname !== '/api/pictures' || req.method !== 'GET') return false;
      const step = setup.state.steps?.pictures;
      ctx.json(res, 200, {
        // object pictures are named after the catalog id with ':' as '__' (tools/make_thumbs.mjs)
        objects: list('', '.webp').map((f) => f.replace(/__/g, ':')),
        levels: list('levels', '.jpg').map(Number).filter((n) => n > 0),
        templates: list('templates', '.jpg'),
        hub: list('hub', '.jpg'),
        // (finishing: the extras start a few seconds after the studio opened)
        making: !!(step && !['done', 'warning'].includes(step.state) && (setup.running || setup.state.status === 'finishing')),
      });
      return true;
    },
  };
};
