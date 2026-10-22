// Makes every sample hack of the project home (server/samples/*.s64hack):
//   npm run samples
// The template samples (Star Isles, Frost Peak, Two Worlds) are generated directly; Castle Remix
// and Showcase are built in the running game, so this starts its own server (a throw-away
// projects folder) and needs the engine built first (npm run build:engine) and Chrome.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (file, env = {}) => new Promise((resolve) => {
  console.log(`\n== ${path.relative(ROOT, file)}`);
  const c = spawn(process.execPath, [file], { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'inherit' });
  c.on('exit', (code) => resolve(code));
});
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

if (!fs.existsSync(path.join(ROOT, 'web', 'engine', 'sm64.us.f3dex2e.wasm'))) {
  console.error('Build the engine first: npm run build:engine');
  process.exit(1);
}
let failed = 0;
failed += (await run(path.join(ROOT, 'tools', 'make_samples.mjs'))) ? 1 : 0;

const port = await freePort();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's64samples-'));
const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', STUDIO_PROJECTS: dir, STUDIO_PASSWORD: '', STUDIO_AI: 'off', STUDIO_SETUP: 'off' }, stdio: 'ignore', // (no setup page: it may run during the setup)
});
const url = `http://127.0.0.1:${port}`;
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`${url}/api/config`)).ok) break; } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 200));
}
try {
  // (make_tokyo_sample.mjs: Tokyo from Shoggoth World, which ships with Studio 64)
  for (const tool of ['make_castle_sample.mjs', 'make_showcase_sample.mjs', 'make_tokyo_sample.mjs']) {
    failed += (await run(path.join(ROOT, 'tools', tool), { STUDIO_URL: url })) ? 1 : 0;
  }
} finally {
  server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} sample(s) failed` : '\nAll samples written to server/samples/');
process.exit(failed ? 1 : 0);
