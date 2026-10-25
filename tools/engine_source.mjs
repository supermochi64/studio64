#!/usr/bin/env node
// The engine's source: sm64ex at the commit in engine-upstream/source.json plus Studio 64's changes
// (tools/lib/engine_source.mjs). The setup and npm run build:engine do `fetch` by themselves.
//   node tools/engine_source.mjs fetch [--force]     sm64ex's files into engine/, with Studio 64's changes
//   node tools/engine_source.mjs diff                after changing an sm64ex file in engine/: writes
//                                                    engine-upstream/changes.json (commit that file)
//   node tools/engine_source.mjs source <commit> <tarball.tar.gz>   move to another sm64ex commit
import { ensureEngineSource, writeChanges, writeSource } from './lib/engine_source.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const say = (s) => console.log(s);
try {
  if (cmd === 'fetch') {
    const changed = await ensureEngineSource({ onStatus: say, force: rest.includes('--force') });
    say(changed ? 'engine/: sm64ex with Studio 64\'s changes' : 'engine/ is up to date');
  } else if (cmd === 'diff') {
    const r = await writeChanges();
    say(`engine-upstream/changes.json: ${r.files} changed sm64ex file(s), ${r.deleted} removed`);
  } else if (cmd === 'source' && rest.length === 2) {
    say(`engine-upstream/source.json: ${await writeSource(rest[0], rest[1])} files; now run fetch --force, then diff`);
  } else {
    console.error('usage: node tools/engine_source.mjs fetch [--force] | diff | source <commit> <tarball>');
    process.exit(2);
  }
} catch (err) {
  console.error(err.title ? `${err.title}: ${err.detail}\n${err.fix || ''}` : err.stack);
  process.exit(1);
}
