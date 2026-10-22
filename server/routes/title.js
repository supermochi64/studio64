// The launch screen of a hack (project.title: splash screens, logo, title background, Press
// Start, music, file select; web/js/title/). Pictures (uploaded logos, the logo maker's
// renders, backgrounds, splash pictures, the cover still) are files in
// projects.assetDir(id)/title/, named by their content, so exports, duplicates and the
// standalone player take them along.
//
//   GET  /api/projects/:id/title                  the title (normalized)
//   PUT  /api/projects/:id/title                  { title, summary } -> one undoable edit, sent to every tab
//   POST /api/projects/:id/title/file?ext=png     raw image -> { file }
//   GET  /api/projects/:id/assets/title/:file     a picture (also what the player loads)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeTitle } from '../../web/js/title/schema.js';

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0, over = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (over) return;
      // (the rest is read and dropped: the browser gets the 413 instead of a broken connection)
      if (size > limit) { over = true; chunks.length = 0; reject(Object.assign(new Error(`picture too large (limit ${Math.round(limit / 1048576)} MB)`), { code: 413 })); } else chunks.push(c);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

export const titleDir = (projects, id) => path.join(projects.assetDir(id), 'title');

export function titleOf(p) {
  return normalizeTitle(p.title);
}

// Store a title: one undoable project-wide change, broadcast to every tab.
export function setTitle(ctx, p, title, { summary = 'Changed the title screen', by = null } = {}) {
  const before = p.title ? JSON.parse(JSON.stringify(p.title)) : null;
  const next = normalizeTitle(title);
  if (JSON.stringify(normalizeTitle(before)) === JSON.stringify(next)) return next;
  ctx.projects.recordProjectChange(p, ['title'], before, summary, { by });
  p.title = next;
  ctx.projects.save(p);
  ctx.hub.broadcast(p.id, { type: 'title', title: next });
  ctx.hub.broadcast(p.id, { type: 'changes', changes: ctx.projects.changeList(p) });
  return next;
}

export function saveTitleFile(ctx, id, data, ext) {
  ext = MIME[ext] ? (ext === 'jpeg' ? 'jpg' : ext) : 'png';
  const name = `${crypto.createHash('sha1').update(data).digest('hex').slice(0, 20)}.${ext}`;
  const dir = titleDir(ctx.projects, id);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name);
  if (!fs.existsSync(f)) fs.writeFileSync(f, data);
  return name;
}

export default (ctx) => ({
  http: async (req, res, url) => {
    let m = /^\/api\/projects\/([\w-]{4,40})\/title(?:\/(file))?$/.exec(url.pathname);
    const serve = /^\/api\/projects\/([\w-]{4,40})\/assets\/title\/([\w-]{4,80}\.(png|jpg|jpeg|webp))$/.exec(url.pathname);
    if (!m && !serve) return false;
    const id = (m || serve)[1];
    const p = ctx.projects.getProject(id);
    if (!p) { ctx.json(res, 404, { error: 'no such project' }); return true; }
    try {
      if (serve) {
        const f = path.join(titleDir(ctx.projects, id), serve[2]);
        if (!fs.existsSync(f)) { ctx.json(res, 404, { error: 'no such picture' }); return true; }
        const data = fs.readFileSync(f);
        // named by content: never changes
        res.writeHead(200, { 'content-type': MIME[serve[3]], 'content-length': data.length, 'cache-control': 'private, max-age=31536000, immutable' });
        res.end(data);
        return true;
      }
      if (m[2] === 'file') {
        if (req.method !== 'POST') { ctx.json(res, 405, { error: 'POST a picture' }); return true; }
        const data = await readRaw(req, 12 * 1024 * 1024);
        if (data.length < 8) { ctx.json(res, 400, { error: 'empty picture' }); return true; }
        const ext = String(url.searchParams.get('ext') || 'png').toLowerCase();
        ctx.json(res, 200, { file: saveTitleFile(ctx, id, data, ext) });
        return true;
      }
      if (req.method === 'GET') { ctx.json(res, 200, titleOf(p)); return true; }
      if (req.method === 'PUT' || req.method === 'POST') {
        const body = JSON.parse((await readRaw(req, 2e6)).toString('utf8') || '{}');
        const t = setTitle(ctx, p, body.title, { summary: typeof body.summary === 'string' && body.summary.trim() ? body.summary.slice(0, 120) : 'Changed the title screen', by: req.headers['x-studio-client'] || null });
        ctx.json(res, 200, t);
        return true;
      }
      ctx.json(res, 405, { error: 'method not allowed' });
    } catch (err) {
      ctx.json(res, err.code === 413 ? 413 : err instanceof SyntaxError ? 400 : 500, { error: err.message });
    }
    return true;
  },
});
