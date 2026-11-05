// Claude's tools for Mario's lighting and beta sounds (issue #8): the real tool handlers of a real
// Agent, set_mario_lighting answered by the game in the browser, beta_sounds stored in the project.
// @tags assets sound ai-free
// @timeout 300
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { suite } from '../lib/harness.mjs';
import { MARIO_LIGHT_PRESETS, lightTable } from '../../web/js/mario_look.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio64-mario-ai-'));
process.env.STUDIO_PROJECTS = path.join(tmp, 'projects');
process.env.STUDIO_AI_CONFIG = path.join(tmp, 'ai.json');
const { Agent } = await import('../../server/agent.js');
const projects = await import('../../server/projects.js');

await suite('Mario tools for Claude', async (t) => {
  const s = await t.open({ level: 9 });
  await s.page.waitForFunction(() => window.studio64?.assets?.loaded && studio64.engine.state().mario, null, { timeout: 60000 });
  const project = projects.createProject({ name: 'mario ai' });
  const sent = [];
  const hub = {
    broadcast(_id, msg) { sent.push(msg); }, idle() {}, changesChanged() {}, patchChanged() {},
    rpc: (_c, method, params) => s.eval(([m, p]) => studio64.studio.handle(m, p), [method, params]),
  };
  const agent = new Agent(hub, project);
  agent.turn = { id: 'test', parts: [], client: { id: 'test' } };
  const call = async (name, args) => {
    const tl = agent.toolDefs.find((x) => x.name === name);
    if (!tl) throw new Error(`no tool ${name}`);
    const r = await tl.handler(args);
    const txt = r.content?.find((c) => c.type === 'text')?.text || '';
    if (r.isError) throw new Error(`${name}: ${txt}`);
    try { return JSON.parse(txt); } catch { return txt; }
  };

  const lit = await call('set_mario_lighting', { preset: 'beta' });
  t.eq('set_mario_lighting beta', lit.lighting, MARIO_LIGHT_PRESETS.beta.light);
  t.eq('the game lights the skin as beta', await s.eval(() => studio64.engine.M._studio_mario_light_byte(4, 0)), (0xfe * lightTable(MARIO_LIGHT_PRESETS.beta.light).parts[4].amb) >> 8);
  const own = await call('set_mario_lighting', { skin: 100, direction: 90 });
  t.eq('single values on top of the current lighting', own.lighting, { ...MARIO_LIGHT_PRESETS.beta.light, skin: 100, dir: 90 });
  t.eq('the page keeps it for the project', await s.eval(() => studio64.assets.meta.mario?.light?.skin), 100);
  const back = await call('set_mario_lighting', { preset: 'game' });
  t.eq('back to the game\'s', back.lighting, MARIO_LIGHT_PRESETS.game.light);

  const on = await call('beta_sounds', { on: true });
  t.check('beta_sounds on: stored in the project and sent to the page', on.beta === true && project.audio.beta === true && sent.some((m) => m.type === 'audio' && m.audio.beta), on);
  await call('beta_sounds', { on: false });
  t.check('beta_sounds off', !project.audio.beta);
  t.check('both are undo steps', project.changes.filter((c) => /Beta sounds/.test(c.summary)).length === 2, project.changes.map((c) => c.summary));
  // sound_effect finds Mario's sounds by their names
  const fx = await call('sound_effect', { name: 'Boing', preset: 'jump', replace: ['Jump "Wah!"', 'Step: Grass'] });
  t.eq('sound_effect replaces Mario\'s sounds by name', fx.replaces, ['Mario: Jump "Wah!"', 'Mario: Step: Grass']);
});
