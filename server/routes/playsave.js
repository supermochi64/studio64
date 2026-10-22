// The play-test save of a project (the game's save, the hack's stars and keys, the story's
// progress; web/js/savegame.js), mirrored from the browser so it survives cleared browser
// storage and other browsers. Kept apart from the project (not in versions or exports):
// projects/playsaves/<id>.json.
//
//   GET /api/projects/:id/playsave    -> the save, or {} when there is none
//   PUT /api/projects/:id/playsave    { v: 1, t, eeprom, stars, story: { 1..4 } }
import fs from 'node:fs';
import path from 'node:path';

export default (ctx) => {
  const dir = path.join(ctx.projects.PROJECTS_DIR, 'playsaves');
  const file = (id) => path.join(dir, `${id}.json`);
  return {
    http: async (req, res, url) => {
      const m = /^\/api\/projects\/([\w-]{4,40})\/playsave$/.exec(url.pathname);
      if (!m) return false;
      const id = m[1];
      if (!ctx.projects.getProject(id)) { ctx.json(res, 404, { error: 'no such project' }); return true; }
      if (req.method === 'GET') {
        let s = {};
        try { s = JSON.parse(fs.readFileSync(file(id), 'utf8')); } catch { /* none yet */ }
        ctx.json(res, 200, s);
        return true;
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        const b = await ctx.readBody(req, 1e6);
        const str = (v, n) => (typeof v === 'string' && v.length <= n ? v : null);
        const story = {};
        for (const f of ['1', '2', '3', '4']) { const v = str(b?.story?.[f], 300000); if (v) story[f] = v; }
        const save = { v: 1, t: Number(b?.t) || Date.now(), eeprom: str(b?.eeprom, 4096), stars: str(b?.stars, 300000), story };
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(`${file(id)}.tmp`, JSON.stringify(save));
        fs.renameSync(`${file(id)}.tmp`, file(id));
        ctx.json(res, 200, { ok: true, t: save.t });
        return true;
      }
      return false;
    },
  };
};
