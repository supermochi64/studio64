// Playing a project's own sound directly (not as a game-sound replacement): a custom object's
// trigger sounds (the "Sounds" section of the object builder) and the World tab's Ambient sound
// picker. Both go through the same engine hook (SOUND_BANK_CUSTOM, studio_sfx_hook ->
// Module.studioCustomSound -> engine.onCustomSound), exercised here exactly as the real UI does:
// ActorBuilder.play() for a trigger preview, WorldFlow.setEnv({ ambient }) for the picker.
// @tags smoke assets
import { suite } from '../lib/harness.mjs';

await suite('custom sound effects (object triggers, ambient)', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;

  // spies on the real hook without disabling actual playback (sound_ui.js's handler still runs)
  await s.eval(() => {
    window.__customSoundCalls = [];
    const orig = studio64.engine.onCustomSound;
    studio64.engine.onCustomSound = (slot, dist) => { window.__customSoundCalls.push({ slot, dist }); orig?.(slot, dist); };
  });

  // a sound's slot is assigned by the server (saveSound), so the save round trip must finish
  // before using it; opening the panel first matches how a real session creates sounds
  await page.click('#sound-btn');
  await page.waitForFunction(() => studio64.soundUI.banks?.length, null, { timeout: 15000 });
  const soundId = await s.eval(() => studio64.soundUI.newSound('coin').id);
  // the slot is assigned server-side (server/projects.js saveSound) on the save round trip
  const slotOk = await s.until((id) => studio64.soundUI.audio.sounds.find((x) => x.id === id)?.slot !== undefined, soundId, 8000);
  t.must('the new sound got a slot from the server', slotOk);
  const slot = await s.eval((id) => studio64.soundUI.audio.sounds.find((x) => x.id === id).slot, soundId);
  t.check('slot is a small integer', Number.isInteger(slot) && slot >= 0 && slot < 256, slot);

  const bits = await s.eval((n) => import('/js/sfx.js').then((m) => m.customSoundBits(n)), slot);
  t.check('bits round-trip back to the same slot', await s.eval(([b, n]) => import('/js/sfx.js').then((m) => m.customSoundSlot(b) === n), [bits, slot]));

  // the object builder's trigger-sound preview button calls exactly this
  await s.eval((b) => { window.__customSoundCalls.length = 0; studio64.objects.builder.play(b); }, bits);
  const triggerCall = await s.until(() => window.__customSoundCalls.length > 0, null, 4000);
  t.must('the object builder\'s preview reaches the custom-sound hook', triggerCall);
  t.check('with the right slot', (await s.eval(() => window.__customSoundCalls[0])).slot === slot);

  // ambient sound only plays during actual gameplay frames (build mode holds everything still,
  // the sound studio included, per studio_flow_frame's gStudioPaused guard): back to play mode
  await page.keyboard.press('Escape');
  t.check('back to play mode', !(await s.eval(() => studio64.editor.active)));

  // the Ambient sound picker's onchange calls exactly this
  await s.eval((n) => { window.__customSoundCalls.length = 0; studio64.worldFlow.setEnv({ ambient: `custom:${n}` }); }, slot);
  const ambientCall = await s.until(() => window.__customSoundCalls.length > 0, null, 4000);
  t.must('the ambient sound reaches the custom-sound hook', ambientCall);
  t.check('with the right slot', (await s.eval(() => window.__customSoundCalls[0])).slot === slot);
  await s.eval(() => studio64.worldFlow.setEnv({ ambient: null })); // leave the level as found

  // bank 0-9 (a real game sound) must not trip the new branch
  await s.eval(() => { window.__customSoundCalls.length = 0; });
  const gameBits = await s.eval(() => fetch('data/sounds.json').then((r) => r.json()).then((l) => l[0].bits));
  await s.eval((b) => studio64.engine.playGameSound(b), gameBits);
  await s.wait(300);
  t.check('a real game sound does not trigger the custom-sound hook', (await s.eval(() => window.__customSoundCalls.length)) === 0);
});
