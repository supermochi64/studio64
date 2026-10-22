// First-run setup API (web/setup.html): the ROM and the optional Sunshine disc come in as
// uploads, then the server builds everything (server/setup/pipeline.js) and reports progress.
//   GET  /api/setup/status            steps, progress, time left, log tail
//   POST /api/setup/rom?name=…        the ROM (any byte order, or zipped): checked, stored as engine/baserom.us.z64
//   POST /api/setup/disc?name=…       a Super Mario Sunshine disc image (.iso/.gcm/.nkit.iso)
//   DELETE /api/setup/disc            forget the uploaded disc
//   POST /api/setup/start {sunshine}  start or continue (also "Try again")
//   GET  /api/setup/log               the whole log as text
//   GET  /api/setup/older             older Studio 64 folders next to this one (an update unpacked beside the old one)
//   POST /api/setup/older {path}      bring over their ROM, projects and pictures
import fs from 'node:fs';
import path from 'node:path';
import { setup, BOOT_ID, restartServer } from '../setup/index.js';
import { checkRom } from '../setup/rom.js';
import { PATHS, LOCAL, ROOT } from '../setup/env.js';
import crypto from 'node:crypto';
import { US_SHA1 } from '../setup/rom.js';

/** Studio 64 folders beside this one (and one level up): what an update leaves behind. */
function olderFolders() {
  const out = [];
  const seen = new Set([path.resolve(ROOT)]);
  for (const base of [path.dirname(ROOT), path.dirname(path.dirname(ROOT))]) {
    let names = [];
    try { names = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { continue; }
    for (const n of names) {
      const dir = path.resolve(base, n);
      if (seen.has(dir)) continue;
      seen.add(dir);
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        if (pkg.name !== 'studio64') continue;
        const rom = fs.existsSync(path.join(dir, 'engine', 'baserom.us.z64'));
        let projects = 0;
        try { projects = fs.readdirSync(path.join(dir, 'server', 'projects')).filter((f) => f.endsWith('.json')).length; } catch { /* none */ }
        if (rom || projects) out.push({ path: dir, name: path.basename(dir), parent: path.basename(base), version: pkg.version || '', rom, projects, mtime: fs.statSync(dir).mtimeMs });
      } catch { /* not a Studio 64 */ }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/** Copies a folder tree, keeping files that are already here. */
function copyTree(from, to) {
  let n = 0;
  if (!fs.existsSync(from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) n += copyTree(a, b);
    else if (e.isFile() && !fs.existsSync(b)) { fs.copyFileSync(a, b); n++; }
  }
  return n;
}

const MB = 1024 * 1024;

/** Streams a request body to a file (at most limit bytes). */
function receive(req, file, limit) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const out = fs.createWriteStream(file);
    let size = 0, failed = false;
    const fail = (err) => { if (failed) return; failed = true; out.destroy(); fs.rm(file, { force: true }, () => reject(err)); };
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { fail(new Error('too large')); req.destroy(); return; }
      if (!out.write(c)) { req.pause(); out.once('drain', () => req.resume()); }
    });
    req.on('end', () => { if (!failed) out.end(() => resolve(size)); });
    req.on('aborted', () => fail(new Error('upload aborted')));
    req.on('error', fail);
    out.on('error', fail);
  });
}

/** What kind of disc image the first bytes say it is. */
export function checkDisc(head) {
  const magic4 = head.subarray(0, 4).toString('latin1');
  const convert = 'In Dolphin, right-click the game → Convert File… → Format: ISO, then drop the .iso here.';
  if (magic4 === 'RVZ\x01' || magic4 === 'WIA\x01') return { ok: false, title: `This is a compressed ${magic4.slice(0, 3)} image`, message: convert };
  if (head.readUInt32LE(0) === 0xB10BC001) return { ok: false, title: 'This is a compressed GCZ image', message: convert };
  if (magic4 === 'CISO') return { ok: false, title: 'This is a compressed CISO image', message: convert };
  if (magic4 === 'WBFS') return { ok: false, title: 'This is a Wii disc image', message: 'Studio 64 needs Super Mario Sunshine for the GameCube.' };
  if (head.readUInt32LE(0) === 0x04034b50 || magic4.startsWith('7z') || magic4 === 'Rar!') return { ok: false, title: 'Unpack the archive first', message: 'Unpack it and drop the .iso (or .nkit.iso) that is inside.' };
  const gc = head.length >= 0x20 && head.readUInt32BE(0x1c) === 0xC2339F3D;
  const id = head.subarray(0, 6).toString('latin1');
  if (!gc) return { ok: false, title: 'This is not a GameCube disc image', message: 'Drop your Super Mario Sunshine disc as .iso, .gcm or .nkit.iso.' };
  if (!id.startsWith('GMS')) return { ok: false, title: 'This is another GameCube game', message: `The disc says it is ${id}. Super Mario Sunshine is GMSE01 (USA).` };
  return { ok: true, id, note: id === 'GMSE01' ? 'Super Mario Sunshine (USA)' : `Super Mario Sunshine (${id}): made for the USA disc, other regions may work` };
}

export default function setupRoutes(ctx) {
  const { json, readBody, projects } = ctx;
  setup.onDone = () => restartServer(() => projects.flushAll?.());

  return {
    async http(req, res, url) {
      const p = url.pathname;
      if (!p.startsWith('/api/setup/')) return false;
      const m = req.method;
      if (p === '/api/setup/status' && m === 'GET') return json(res, 200, { ...setup.status(), boot: BOOT_ID }), true;
      if (p === '/api/setup/log' && m === 'GET') {
        let text = '';
        try { text = fs.readFileSync(PATHS.log, 'utf8'); } catch { text = setup.log.join('\n'); }
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
        res.end(text.slice(-400000));
        return true;
      }
      if (p === '/api/setup/rom' && m === 'POST') {
        if (setup.running && !setup.background) return json(res, 409, { ok: false, title: 'The setup is running', message: 'Wait until it has finished.' }), true;
        const tmp = path.join(LOCAL, 'rom.upload');
        try { await receive(req, tmp, 80 * MB); } catch (err) {
          return json(res, 400, { ok: false, title: err.message === 'too large' ? 'This file is too big for a ROM' : 'The upload did not finish', message: err.message === 'too large' ? 'A Super Mario 64 ROM is 8 MB.' : 'Please drop it again.' }), true;
        }
        const r = checkRom(fs.readFileSync(tmp), String(url.searchParams.get('name') || ''));
        fs.rmSync(tmp, { force: true });
        if (!r.ok) return json(res, 200, r), true;
        fs.writeFileSync(PATHS.rom + '.tmp', r.data);
        fs.renameSync(PATHS.rom + '.tmp', PATHS.rom);
        setup.addLog(`ROM: ${r.note}`);
        return json(res, 200, { ok: true, note: r.note }), true;
      }
      if (p === '/api/setup/disc' && m === 'POST') {
        if (setup.running && !setup.background) return json(res, 409, { ok: false, title: 'The setup is running', message: 'Wait until it has finished.' }), true;
        const tmp = PATHS.disc + '.upload';
        try { await receive(req, tmp, 3 * 1024 * MB); } catch (err) {
          return json(res, 400, { ok: false, title: err.message === 'too large' ? 'This file is too big for a GameCube disc' : 'The upload did not finish', message: 'Please drop it again.' }), true;
        }
        const fd = fs.openSync(tmp, 'r');
        const head = Buffer.alloc(0x440);
        fs.readSync(fd, head, 0, head.length, 0);
        fs.closeSync(fd);
        const r = checkDisc(head);
        if (!r.ok) { fs.rmSync(tmp, { force: true }); return json(res, 200, r), true; }
        fs.renameSync(tmp, PATHS.disc);
        setup.addLog(`Sunshine disc: ${r.note}`);
        return json(res, 200, { ok: true, note: r.note }), true;
      }
      if (p === '/api/setup/disc' && m === 'DELETE') {
        if (!setup.running || setup.background) fs.rmSync(PATHS.disc, { force: true });
        return json(res, 200, { ok: true }), true;
      }
      if (p === '/api/setup/older' && m === 'GET') return json(res, 200, { folders: olderFolders().slice(0, 3).map(({ mtime, ...f }) => f) }), true;
      if (p === '/api/setup/older' && m === 'POST') {
        if (setup.running && !setup.background) return json(res, 409, { ok: false, title: 'The setup is running' }), true;
        const body = await readBody(req).catch(() => ({}));
        const from = olderFolders().find((f) => f.path === body.path);
        if (!from) return json(res, 400, { ok: false, title: 'That folder is not an older Studio 64' }), true;
        const done = { rom: false, projects: 0, pictures: 0 };
        const rom = path.join(from.path, 'engine', 'baserom.us.z64');
        if (fs.existsSync(rom) && !fs.existsSync(PATHS.rom)) {
          const data = fs.readFileSync(rom);
          if (crypto.createHash('sha1').update(data).digest('hex') === US_SHA1) {
            fs.writeFileSync(PATHS.rom + '.tmp', data);
            fs.renameSync(PATHS.rom + '.tmp', PATHS.rom);
            done.rom = true;
          }
        }
        // the projects (with their versions, assets and play saves) and the pictures (the setup makes only missing ones)
        done.projects = copyTree(path.join(from.path, 'server', 'projects'), projects.PROJECTS_DIR);
        done.pictures = copyTree(path.join(from.path, 'web', 'thumbs'), path.join(ROOT, 'web', 'thumbs'));
        setup.addLog(`Brought over from ${from.path}: ${done.rom ? 'the ROM, ' : ''}${done.projects} project files, ${done.pictures} pictures`);
        return json(res, 200, { ok: true, ...done, rom: done.rom || fs.existsSync(PATHS.rom) }), true;
      }
      if (p === '/api/setup/start' && m === 'POST') {
        const body = await readBody(req).catch(() => ({}));
        if (!fs.existsSync(PATHS.rom)) return json(res, 400, { ok: false, title: 'Drop your ROM first' }), true;
        setup.start({ sunshine: !!body.sunshine });
        return json(res, 200, { ok: true }), true;
      }
      return json(res, 404, { error: 'not found' }), true;
    },
  };
}
