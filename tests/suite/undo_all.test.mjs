// Undo/redo for everything, not only objects: story edits, Mario's colours, game textures (their
// files come back from the trash), skies, the world flow, an area's environment, game rules
// (@game) and songs, all with Ctrl+Z / Ctrl+Shift+Z inside a level; deleting a sub-area undone
// from the Edits list; a version restore brings back story, assets, world, objects and rules.
// @tags editor
// @timeout 900
import { suite, api, URL_BASE } from '../lib/harness.mjs';

await suite('undo for everything', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  await s.build();
  const nChanges = () => s.eval(() => studio64.changes.length);
  const lastChange = () => s.eval(() => studio64.changes[studio64.changes.length - 1] || null);
  // Ctrl+Z / Ctrl+Shift+Z with nothing focused (like a user in build mode)
  const key = async (combo) => {
    await s.eval(() => document.activeElement?.blur?.());
    await page.keyboard.press(combo);
  };
  const undo = async (pred, arg) => { await key('Control+KeyZ'); return s.until(pred, arg, 15000); };
  const redo = async (pred, arg) => { await key('Control+Shift+KeyZ'); return s.until(pred, arg, 15000); };

  // ---- story ----
  await s.eval(() => studio64.storyUI.op({ op: 'upsert', coll: 'dialogs', item: { id: 'dlg_undo', name: 'Undo me', text: 'HELLO THERE' } }, { render: false }));
  t.must('story edit made', await s.until(() => studio64.story.dialogs.some((d) => d.id === 'dlg_undo')));
  t.check('the story edit is in the edit list', await s.until(() => studio64.changes.some((c) => c.key === '@project' && /dialog/.test(c.summary))));
  const where = await s.eval(() => [...document.querySelectorAll('#edits-list .emeta')].map((x) => x.textContent)[0]);
  t.check('edit list: project-wide edit says "Project"', /^Project/.test(where || ''), where);
  t.check('Ctrl+Z undoes the story edit', await undo(() => !studio64.story.dialogs.some((d) => d.id === 'dlg_undo')));
  t.check('the story runtime has it gone too', await s.eval(() => !studio64.storyRuntime.story.dialogs.some((d) => d.id === 'dlg_undo')));
  t.check('Ctrl+Shift+Z redoes it', await redo(() => studio64.story.dialogs.some((d) => d.id === 'dlg_undo')));
  // typing in one dialog: one undo step
  const n0 = await nChanges();
  for (const txt of ['A', 'AB', 'ABC']) { await s.eval((x) => studio64.storyUI.op({ op: 'upsert', coll: 'dialogs', item: { id: 'dlg_undo', name: 'Undo me', text: x } }, { render: false }), txt); await s.wait(200); }
  await s.until(() => studio64.story.dialogs.find((d) => d.id === 'dlg_undo')?.text === 'ABC');
  await s.wait(500);
  t.eq('quick edits of one dialog merge into one step', (await nChanges()) - n0, 1);
  t.check('undo goes back to the text before the typing', await undo(() => studio64.story.dialogs.find((d) => d.id === 'dlg_undo')?.text === 'HELLO THERE'));

  // ---- Mario's colours ----
  await s.eval(() => studio64.studio.handle('mario_colors', { preset: 'luigi' }));
  t.must('Luigi colours set', await s.until(() => studio64.assets.meta.mario?.preset === 'luigi'));
  await s.until(() => /Mario/.test(studio64.changes[studio64.changes.length - 1]?.summary || ''));
  t.check('Ctrl+Z puts Mario\'s colours back', await undo(() => !studio64.assets.meta.mario?.preset));
  t.check('redo makes him Luigi again', await redo(() => studio64.assets.meta.mario?.preset === 'luigi'));

  // ---- a game texture: recolour, reset (deletes the file), undo the reset ----
  const tex = await s.eval(async () => (await studio64.studio.handle('texture_edit', { here: true, query: '', limit: 1, recolor: { hue: 120 } })).changed);
  t.must('a texture was recoloured', tex.length === 1, tex);
  await s.until((p) => !!studio64.assets.meta.textures?.[p], tex[0]);
  const file = await s.eval((p) => studio64.assets.meta.textures[p].file, tex[0]);
  await s.eval((p) => studio64.studio.handle('texture_edit', { paths: [p], reset: true }), tex[0]);
  t.must('reset removes it', await s.until((p) => !studio64.assets.meta.textures?.[p], tex[0]));
  await s.wait(800);
  t.eq('the reset file is gone from the store', (await fetch(`${URL_BASE}/api/projects/${s.projectId}/assets/files/${file}`)).status, 404);
  t.check('undo brings the recoloured texture back', await undo((p) => !!studio64.assets.meta.textures?.[p], tex[0]));
  t.eq('...and its file', (await fetch(`${URL_BASE}/api/projects/${s.projectId}/assets/files/${file}`)).status, 200);
  t.check('the texture is applied in the game again', await s.until((p) => studio64.assets.appliedTex.get(p) === studio64.assets.meta.textures[p]?.file, tex[0]));

  // ---- a sky for this level ----
  await s.eval(() => studio64.studio.handle('sky_generate', { top: '#ff0000', horizon: '#ffff00' }));
  t.must('sky set', await s.until(() => !!studio64.assets.meta.skies?.['9:1']));
  t.check('undo removes the sky', await undo(() => !studio64.assets.meta.skies?.['9:1']));

  // ---- world flow and environment ----
  await s.eval(() => studio64.worldFlow.setFlow({ goal: { stars: 3, message: 'WELL DONE' } }));
  await s.until(() => studio64.changes.some((c) => /star goal/.test(c.summary)));
  t.check('undo the star goal', await undo(() => !studio64.engine.patch.world?.goal));
  await s.eval(() => studio64.worldFlow.setEnv({ fog: { on: true, color: '#ff0000', near: 500, far: 3000 } }));
  await s.until(() => studio64.engine.patch.areas['9:1']?.settings?.env?.fog?.on);
  await s.wait(600);
  t.check('undo the fog', await undo(() => !studio64.engine.patch.areas['9:1']?.settings?.env?.fog));

  // ---- game rules (@game) are reachable with Ctrl+Z inside a level ----
  await s.eval(() => studio64.objects.store.setGame('rules', { base: { gravity: 0.5 }, levels: {} }, 'Moon gravity'));
  await s.until(() => studio64.changes.some((c) => c.summary === 'Moon gravity'));
  t.check('undo the game rules', await undo(() => !studio64.objects.store.game('rules')?.base?.gravity));

  // ---- a song ----
  await s.eval(() => { const song = { id: 'sg1', name: 'Undo tune', bpm: 120, tracks: [] }; studio64.audio.songs.push(song); studio64.ws.send(JSON.stringify({ type: 'song_save', song })); });
  await s.until(() => studio64.changes.some((c) => /Undo tune/.test(c.summary)));
  t.must('song saved', await s.until(() => studio64.audio?.songs?.some((x) => x.id === 'sg1')));
  t.check('undo the song', await undo(() => !studio64.audio?.songs?.some((x) => x.id === 'sg1')));

  // ---- objects still undo as before (area edits) ----
  const uid = await s.eval(() => {
    const m = studio64.engine.state().mario;
    const rec = { uid: 1 + Math.floor(Math.random() * 0x7efffffe), entry: 'yellow_coin', x: Math.round(m.x + 300), y: Math.round(m.y + 100), z: Math.round(m.z), yaw: 0, pitch: 0, roll: 0, bparams: 0 };
    studio64.worldFlow.addRecord(rec, 'Placed a coin');
    return rec.uid;
  });
  await s.until((u) => studio64.changes.some((c) => c.summary === 'Placed a coin'), uid);
  t.check('undo a placed coin', await undo((u) => !studio64.engine.objects().some((o) => o.uid === u), uid));

  // ---- a sub-area deleted and undone from the Edits list ----
  await s.play();
  const lid = await s.newLevel('flat', 'Undo Level');
  const made = await s.eval(async (l) => studio64.worldFlow.createArea(l, { name: 'Attic', template: 'room' }), lid);
  await s.until((l) => studio64.levels.find((x) => x.id === l)?.areas?.length === 1, lid);
  const atticObjs = (await s.export()).areas[`c:${lid}:${made.index}`]?.objects?.length;
  await s.eval(([l, i]) => studio64.worldFlow.deleteArea(l, i), [lid, made.index]);
  await s.until((l) => !studio64.levels.find((x) => x.id === l)?.areas?.length, lid);
  t.check('deleting an area is in the edit list', await s.until(() => studio64.changes.some((c) => /Deleted area/.test(c.summary))));
  await s.eval(() => studio64.ws.send(JSON.stringify({ type: 'undo', changeId: studio64.changes.find((c) => /Deleted area/.test(c.summary)).id })));
  t.check('undo brings the area back', await s.until((l) => studio64.levels.find((x) => x.id === l)?.areas?.some((a) => a.name === 'Attic'), lid));
  t.eq('with its content', (await s.export()).areas[`c:${lid}:${made.index}`]?.objects?.length, atticObjs);

  // ---- versions: restore brings back story, assets, world, objects and rules ----
  await s.eval(() => studio64.worldFlow.setFlow({ goal: { stars: 7, message: 'V1' } }));
  await s.eval(() => studio64.objects.store.setGame('rules', { base: { gravity: 0.7 }, levels: {} }, 'Rules v1'));
  await s.wait(1200);
  const v = await api(`/api/projects/${s.projectId}/versions`, { label: 'v1' });
  t.must('version saved', !!(v?.id || v?.version?.id), v);
  const vid = v.id || v.version.id;
  // change everything
  await s.eval(() => studio64.storyUI.op({ op: 'delete', coll: 'dialogs', id: 'dlg_undo' }, { render: false }));
  await s.eval(() => studio64.studio.handle('mario_colors', { preset: 'wario' }));
  await s.eval(() => studio64.worldFlow.setFlow({ goal: { stars: 9, message: 'V2' } }));
  await s.eval(() => studio64.objects.store.setGame('rules', { base: { gravity: 2 }, levels: {} }, 'Rules v2'));
  const extra = await s.eval(() => {
    const m = studio64.engine.state().mario;
    const rec = { uid: 1 + Math.floor(Math.random() * 0x7efffffe), entry: 'yellow_coin', x: Math.round(m.x + 300), y: Math.round(m.y + 100), z: Math.round(m.z), yaw: 0, pitch: 0, roll: 0, bparams: 0 };
    studio64.worldFlow.addRecord(rec, 'Placed a coin after v1');
    return rec.uid;
  });
  await s.wait(1500);
  const r = await api(`/api/projects/${s.projectId}/versions/${vid}/restore`, {});
  t.check('restore answered', r && !r.error, r);
  await s.wait(3000);
  await s.page.waitForFunction(() => window.studio64?.engine?.ready && document.querySelector('#loading').hidden, null, { timeout: 120000 });
  await s.wait(1500);
  const st = await s.eval((u) => ({
    dialog: studio64.story.dialogs.some((d) => d.id === 'dlg_undo'),
    mario: studio64.assets.meta.mario?.preset || null,
    goal: studio64.engine.patch.world?.goal?.stars,
    gravity: studio64.objects.store.game('rules')?.base?.gravity,
    extra: Object.values(studio64.engine.patch.areas).some((a) => (a.objects || []).some((o) => o.uid === u)),
    attic: studio64.levels.some((l) => l.areas?.some((a) => a.name === 'Attic')),
  }), extra);
  t.check('restore: the story dialog is back', st.dialog, st);
  t.eq('restore: Mario\'s colours (Luigi)', st.mario, 'luigi');
  t.eq('restore: the world flow', st.goal, 7);
  t.eq('restore: the game rules', st.gravity, 0.7);
  t.check('restore: the coin placed after v1 is gone', !st.extra, st);
  t.check('restore: the level with its sub-area', st.attic, st);
  await s.shot('after_restore');
});
