// ROM export (web/js/romexport.js): the project as an N64 ROM and a BPS patch for the original
// game. The browser loads each area and sends what the engine shows (studio_romdump); the server
// turns that into level data in a base ROM it builds once from the player's ROM (romexport/).
//   GET  /api/rom/kit                         the base ROM: { ready, building, step, progress, error }
//   POST /api/rom/kit                         build it (once, a few minutes)
//   POST /api/projects/:id/rom/plan           which areas to send, what to bake, what stays out
//   PUT  /api/projects/:id/rom/area?key=…     one area's dump (binary)
//   PUT  /api/projects/:id/rom/sound?index=…  a replaced game sound (16-bit mono PCM, 16 kHz)
//   POST /api/projects/:id/rom/build {title}  -> { report, files: { rom, bps } }
//   GET  /api/projects/:id/rom/file/<name>    the built .z64 or .bps
import fs from 'node:fs';
import path from 'node:path';
import { ensureKit, kitStatus, loadKit, KIT_DIR } from '../romexport/romkit.js';
import { planHack, buildRom } from '../romexport/rom.js';
import { createBps, applyBps } from '../romexport/bps.js';
import { captureSpec } from '../romexport/calls.js';
import { PATHS } from '../setup/env.js';

const MB = 1024 * 1024;
const kit = { building: false, step: '', progress: 0, error: null, log: [] };

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('the area is too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const fileName = (s) => String(s || 'hack').normalize('NFKD').replace(/[^\w -]/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'hack';
const workDir = (id) => path.join(KIT_DIR, 'work', id);
const keyFile = (dir, key) => path.join(dir, 'areas', `${key.replace(/[^\w-]/g, '_')}.bin`);

function kitState() {
  const s = kitStatus();
  return { ready: s.ready, building: kit.building, step: kit.step, progress: kit.progress, error: kit.error, haveRom: fs.existsSync(PATHS.rom), log: kit.log.slice(-30) };
}

function startKit() {
  if (kit.building || kitStatus().ready) return;
  if (!fs.existsSync(PATHS.rom)) { kit.error = { title: 'Your Super Mario 64 ROM is missing', message: 'The setup keeps it as engine/baserom.us.z64.', fix: 'Run the setup again and drop your ROM.' }; return; }
  Object.assign(kit, { building: true, step: 'Starting', progress: 0, error: null, log: [] });
  ensureKit({
    rom: fs.readFileSync(PATHS.rom),
    onStatus: (s) => { kit.step = s; kit.log.push(s); },
    onProgress: (p) => { kit.progress = Math.max(kit.progress, p); },
    onLine: (l) => { kit.log.push(l); if (kit.log.length > 300) kit.log.splice(0, 100); },
  }).then(() => { kit.progress = 1; kit.step = 'Ready'; })
    .catch((err) => { kit.error = { title: err.title || 'The ROM builder could not be set up', message: err.detail || err.message, fix: err.fix || '' }; console.error('[romexport]', err); })
    .finally(() => { kit.building = false; });
}

export default (ctx) => ({
  async http(req, res, url) {
    const p = url.pathname;
    if (p === '/api/rom/kit') {
      if (req.method === 'POST') startKit();
      ctx.json(res, 200, kitState());
      return true;
    }
    const m = /^\/api\/projects\/([\w-]{4,40})\/rom\/(plan|area|object|sound|calls|build|file\/[\w.-]+)$/.exec(p);
    if (!m) return false;
    const id = m[1], what = m[2];
    const project = ctx.projects.getProject(id);
    if (!project) { ctx.json(res, 404, { error: 'no such project' }); return true; }
    const dir = workDir(id);

    if (what.startsWith('file/')) {
      const name = what.slice(5);
      const f = path.join(dir, 'out', name);
      if (!/\.(z64|bps)$/.test(name) || !fs.existsSync(f)) { ctx.json(res, 404, { error: 'build the ROM first' }); return true; }
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': fs.statSync(f).size, 'content-disposition': `attachment; filename="${name}"` });
      fs.createReadStream(f).pipe(res);
      return true;
    }

    const k = loadKit();
    if (!k) { ctx.json(res, 409, { error: 'the ROM builder is not ready', kit: kitState() }); return true; }

    if (what === 'plan' && req.method === 'POST') {
      fs.rmSync(path.join(dir, 'areas'), { recursive: true, force: true });
      fs.rmSync(path.join(dir, 'objects'), { recursive: true, force: true });
      fs.rmSync(path.join(dir, 'sounds'), { recursive: true, force: true });
      const plan = planHack(project, k.index);
      ctx.json(res, 200, {
        levels: plan.levels.map((l) => ({ id: l.id, name: l.name, slot: l.folder, course: l.course, vanilla: l.vanilla, level: l.levelNum, areas: l.areas })),
        bake: plan.bake, skip: plan.skip, issues: plan.issues, hub: plan.hub, calls: captureSpec(),
      });
      return true;
    }

    if (what === 'area' && req.method === 'PUT') {
      const key = String(url.searchParams.get('key') || '');
      if (!/^(c:[\w-]+(:\d+)?|\d+:\d+)$/.test(key)) { ctx.json(res, 400, { error: 'bad area' }); return true; }
      const buf = await readRaw(req, 96 * MB);
      if (buf.toString('latin1', 0, 4) !== 'S64D') { ctx.json(res, 400, { error: 'not an area dump' }); return true; }
      fs.mkdirSync(path.join(dir, 'areas'), { recursive: true });
      fs.writeFileSync(keyFile(dir, key), buf);
      ctx.json(res, 200, { ok: true, bytes: buf.length });
      return true;
    }

    if (what === 'object' && req.method === 'PUT') {
      const uid = Number(url.searchParams.get('uid')) >>> 0;
      if (!uid) { ctx.json(res, 400, { error: 'bad object' }); return true; }
      const buf = await readRaw(req, 16 * MB);
      if (buf.toString('latin1', 0, 4) !== 'S64D') { ctx.json(res, 400, { error: 'not an object dump' }); return true; }
      fs.mkdirSync(path.join(dir, 'objects'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'objects', `${uid}.bin`), buf);
      ctx.json(res, 200, { ok: true });
      return true;
    }

    // a replaced game sound as the browser rendered it: 16-bit mono at 16 kHz
    if (what === 'sound' && req.method === 'PUT') {
      const index = Number(url.searchParams.get('index'));
      if (!Number.isInteger(index) || index < 0 || index > 255) { ctx.json(res, 400, { error: 'bad sound' }); return true; }
      const buf = await readRaw(req, 4 * MB);
      fs.mkdirSync(path.join(dir, 'sounds'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'sounds', `${index}.pcm`), buf);
      ctx.json(res, 200, { ok: true });
      return true;
    }

    if (what === 'calls' && req.method === 'PUT') {
      const key = String(url.searchParams.get('key') || '');
      if (!/^(c:[\w-]+(:\d+)?|\d+:\d+)$/.test(key)) { ctx.json(res, 400, { error: 'bad area' }); return true; }
      const body = await ctx.readBody(req, 32e6);
      fs.mkdirSync(path.join(dir, 'areas'), { recursive: true });
      fs.writeFileSync(keyFile(dir, key).replace(/\.bin$/, '.calls.json'), JSON.stringify(Array.isArray(body.calls) ? body.calls : []));
      ctx.json(res, 200, { ok: true });
      return true;
    }

    if (what === 'build' && req.method === 'POST') {
      const body = await ctx.readBody(req).catch(() => ({}));
      const plan = planHack(project, k.index);
      const dumps = new Map(), calls = new Map();
      for (const l of plan.levels) for (const a of l.areas) {
        const f = keyFile(dir, a.key);
        if (fs.existsSync(f)) dumps.set(a.key, fs.readFileSync(f));
        const c = f.replace(/\.bin$/, '.calls.json');
        if (fs.existsSync(c)) calls.set(a.key, JSON.parse(fs.readFileSync(c, 'utf8')));
      }
      const objects = new Map();
      try { for (const f of fs.readdirSync(path.join(dir, 'objects'))) objects.set(Number(f.replace('.bin', '')) >>> 0, fs.readFileSync(path.join(dir, 'objects', f))); } catch { /* none */ }
      const sounds = new Map();
      try { for (const f of fs.readdirSync(path.join(dir, 'sounds'))) sounds.set(Number(f.replace('.pcm', '')), fs.readFileSync(path.join(dir, 'sounds', f))); } catch { /* none */ }
      try {
        const title = String(body.title || project.name || 'Studio 64 hack');
        const { rom, report } = buildRom(k, project, dumps, { title, calls, objects, sounds });
        const original = fs.readFileSync(PATHS.rom);
        const bps = createBps(original, rom);
        if (!applyBps(original, bps).equals(rom)) throw new Error('the patch does not reproduce the ROM');
        const out = path.join(dir, 'out');
        fs.rmSync(out, { recursive: true, force: true });
        fs.mkdirSync(out, { recursive: true });
        const base = fileName(title);
        fs.writeFileSync(path.join(out, `${base}.z64`), rom);
        fs.writeFileSync(path.join(out, `${base}.bps`), bps);
        ctx.json(res, 200, {
          report,
          files: {
            rom: { name: `${base}.z64`, size: rom.length, url: `/api/projects/${id}/rom/file/${base}.z64` },
            bps: { name: `${base}.bps`, size: bps.length, url: `/api/projects/${id}/rom/file/${base}.bps` },
          },
        });
      } catch (err) {
        console.error('[romexport]', err);
        ctx.json(res, 500, { error: err.message });
      }
      return true;
    }
    return false;
  },
});
