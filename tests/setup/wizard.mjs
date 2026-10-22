#!/usr/bin/env node
// Drives the first-run setup in a browser like a person would: the setup page, dropping the ROM
// through its file input (and first a changed ROM and a text file with --wrong-rom), Build, the
// progress until the studio opens by itself. Used by tests/setup/sandbox.mjs (Linux distributions
// in bwrap) and by the GitHub workflow (.github/workflows/setup.yml: Windows, macOS, Linux):
//   node tests/setup/wizard.mjs --url http://127.0.0.1:8093 --rom path/to/rom.z64 [--order v64]
//        [--wrong-rom] [--shots dir] [--report file.json]
// Exits 0 when the studio opened. Then run tests/setup/studio_check.test.mjs against the same URL.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

/** A copy of a .z64 ROM in another byte order (v64: 16-bit swapped, n64: 32-bit little-endian). */
export function convertRom(rom, order, dir) {
  if (order === 'z64') return rom;
  const src = fs.readFileSync(rom);
  const b = Buffer.from(src);
  if (order === 'v64') for (let i = 0; i + 1 < b.length; i += 2) { b[i] = src[i + 1]; b[i + 1] = src[i]; }
  if (order === 'n64') for (let i = 0; i + 3 < b.length; i += 4) b.writeUInt32LE(src.readUInt32BE(i), i);
  const out = path.join(dir, `Super Mario 64 (USA).${order}`);
  fs.writeFileSync(out, b);
  return out;
}

/**
 * The wizard, from the setup page to the studio. report gets checks, steps and timings.
 * hooks.onStep(status, page) may return 'interrupt' handling of its own (sandbox.mjs).
 */
export async function driveWizard({ url, rom, order = 'z64', wrongRom = false, shots = null, scratch = os.tmpdir(), report = { checks: [], steps: {}, timings: {} }, onStatus = null, timeoutMin = 60 }) {
  const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, detail }); log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` -- ${JSON.stringify(detail).slice(0, 400)}` : ''}`); return ok; };
  const status = () => fetch(`${url}/api/setup/status`).then((r) => r.json()).catch(() => null);
  const { launchBrowser } = await import(path.join(ROOT, 'tools', 'lib', 'browser.mjs'));
  const browser = await launchBrowser({ headless: true });
  const shot = async (page, name) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `setup-${name}.png`) }); } };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    check('the browser shows the setup', await page.locator('#view-inputs').waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false));
    await page.waitForTimeout(800);
    await shot(page, 'start');
    const drop = async (file) => {
      await page.setInputFiles('#rom-file', file);
      await page.waitForFunction(() => { const r = document.querySelector('#rom-result'); return r && !r.hidden && /\b(ok|bad)\b/.test(r.className); }, null, { timeout: 60000 });
      return page.evaluate(() => ({ cls: document.querySelector('#rom-result').className, text: document.querySelector('#rom-result').innerText }));
    };
    if (wrongRom) {
      const changed = Buffer.from(fs.readFileSync(rom));
      changed[0x100000] ^= 0xff;
      const hack = path.join(scratch, 'Super Mario 64 (hack).z64');
      fs.writeFileSync(hack, changed);
      let r = await drop(hack);
      check('a changed ROM is refused, in plain words', /bad/.test(r.cls) && /changed/i.test(r.text), r);
      await shot(page, 'wrong-rom');
      const notes = path.join(scratch, 'notes.txt');
      fs.writeFileSync(notes, 'not a rom\n'.repeat(1000));
      r = await drop(notes);
      check('a text file is refused', /bad/.test(r.cls) && /not a ROM|not an N64 ROM/i.test(r.text), r);
      check('Build stays off without a good ROM', await page.locator('#go').isDisabled());
      fs.rmSync(hack, { force: true });
      fs.rmSync(notes, { force: true });
    }
    const romFile = convertRom(rom, order, scratch);
    const r = await drop(romFile);
    check(`the ROM (.${order}) is accepted`, /ok/.test(r.cls) && /US version/.test(r.text) && (order === 'z64' || r.text.includes(`.${order}`)), r);
    await shot(page, 'rom');
    const tGo = Date.now();
    await page.click('#go');
    await page.waitForSelector('#view-progress:not([hidden])', { timeout: 20000 });

    let progressShot = false, doneShot = false, last = '';
    const deadline = Date.now() + timeoutMin * 60 * 1000;
    let failed = null;
    while (Date.now() < deadline) {
      const st = await status();
      if (st) {
        for (const s of st.steps) report.steps[s.id] = { state: s.state, seconds: s.seconds, detail: s.detail };
        const run = st.steps.find((s) => s.state === 'running');
        const line = run ? `${run.id} ${Math.round((run.progress || 0) * 100)}% ${run.detail}` : st.status;
        if (line !== last) { log(`   ${line}`); last = line; }
        if (!progressShot && run?.id === 'engine' && run.progress > 0.25) { await shot(page, 'progress'); progressShot = true; }
        if (st.status === 'failed' && !st.running) { failed = { error: st.error, log: st.log.slice(-30) }; break; }
        if (onStatus && (await onStatus(st, page)) === 'continue') continue;
      }
      if (!doneShot && await page.locator('#view-done').isVisible().catch(() => false)) { await page.waitForTimeout(400); await shot(page, 'done'); doneShot = true; }
      if (await page.evaluate(() => !document.querySelector('.setup-page') && !!window.studio64).catch(() => false)) break;
      await sleep(2000);
    }
    if (failed) {
      await shot(page, 'failed');
      check('the setup finishes', false, failed);
    }
    report.timings.setupToStudio = Math.round((Date.now() - tGo) / 1000);
    const inStudio = await page.evaluate(() => !document.querySelector('.setup-page') && !!window.studio64).catch(() => false);
    check(`the studio opens by itself after the setup (${report.timings.setupToStudio} s)`, inStudio);
    check('the setup page had no errors', consoleErrors.filter((e) => !/fonts\.g|ERR_CONNECTION_REFUSED|net::ERR_/.test(e)).length === 0, consoleErrors);
    await ctx.close();
    return inStudio && !failed;
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---- as a command (the GitHub workflow) ------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const url = opt('--url', 'http://127.0.0.1:8093');
  const report = { checks: [], steps: {}, timings: {}, platform: `${process.platform}-${process.arch}` };
  // wait for the launcher's server (the launcher downloads Node and the npm packages first)
  const t0 = Date.now();
  while (!(await fetch(`${url}/api/config`).then((x) => x.ok, () => false))) {
    if (Date.now() - t0 > 20 * 60 * 1000) { console.error('the server did not come up'); process.exit(1); }
    await sleep(1000);
  }
  report.timings.serverUp = Math.round((Date.now() - t0) / 1000);
  const ok = await driveWizard({ url, rom: path.resolve(opt('--rom')), order: opt('--order', 'z64'), wrongRom: args.includes('--wrong-rom'), shots: opt('--shots', null), scratch: opt('--scratch', os.tmpdir()), report, timeoutMin: Number(opt('--timeout', 90)) });
  if (opt('--report')) fs.writeFileSync(opt('--report'), JSON.stringify(report, null, 1));
  process.exit(ok && report.checks.every((c) => c.ok) ? 0 : 1);
}
