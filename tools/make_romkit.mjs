#!/usr/bin/env node
// The base ROM that comes with Studio 64: builds it here (Linux), then writes it as a BPS patch
// for the original game plus its index into server/romexport/base/, where every computer finds it
// (server/romexport/romkit.js). Only the changes, as ROM hacks are shared -- and nothing of other
// Nintendo games: it refuses a base ROM with the Sunshine characters.
//   node tools/make_romkit.mjs     (needs engine/baserom.us.z64)
import fs from 'node:fs';
import path from 'node:path';
import { ensureKit, kitStatus, patchName, indexName, shippedDir } from '../server/romexport/romkit.js';
import { createBps } from '../server/romexport/bps.js';
import { ROOT } from './lib/toolchain.mjs';

const out = shippedDir();
const rom = fs.readFileSync(path.join(ROOT, 'engine', 'baserom.us.z64'));
await ensureKit({ rom, onStatus: (s) => console.log(s) });
const st = kitStatus();
const index = JSON.parse(fs.readFileSync(st.index, 'utf8'));
const nintendo = (index.modules?.list || []).filter((m) => m.name === 'sms').map((m) => m.name);
if (nintendo.length) { console.error(`the base ROM has Nintendo's models (${nintendo.join(', ')}): not written`); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) if (/^studio64-base-/.test(f)) fs.rmSync(path.join(out, f));
const patch = createBps(rom, fs.readFileSync(st.rom));
fs.writeFileSync(path.join(out, patchName()), patch);
fs.copyFileSync(st.index, path.join(out, indexName()));
console.log(`${path.join(out, patchName())} (${(patch.length / 1e6).toFixed(1)} MB)\n${path.join(out, indexName())}`);
