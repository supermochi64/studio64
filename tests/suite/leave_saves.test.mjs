// Edits made just before a reload are not lost: the title screen editor (0.9 s save delay), story
// text (typed edits wait) and sounds/songs (0.5 s) flush when the page goes away, through a
// keepalive request (POST /api/projects/:id/send, PUT .../title) that outlives the page.
// @tags projects
// @timeout 420
import { suite, api, URL_BASE } from '../lib/harness.mjs';

await suite('leave saves', async (t) => {
  const s = await t.open({ start: false });
  t.allowConsole(/ScriptProcessorNode/);
  const id = s.projectId;
  await s.page.waitForFunction(() => window.studio64?.storyUI && window.studio64?.clientId, null, { timeout: 60000 });

  // story text typed with a long delay, then a reload right away
  await s.eval(() => studio64.storyUI.upsert('dialogs', { id: 'leave1', name: 'Leave test', text: 'TYPED JUST BEFORE THE RELOAD' }, { delay: 5000, render: false }));
  // the title screen: an edit inside the save delay
  await s.eval(async () => {
    const m = await import('/js/title/index.js');
    const ui = await m.openEditor('logo');
    ui.edit((tt) => { tt.press.text = 'LEAVE TEST'; tt.on = true; }, 'Changed Press Start');
  });
  await s.page.reload({ waitUntil: 'domcontentloaded' });
  let story = null, title = null;
  for (let i = 0; i < 40; i++) {
    const doc = await api(`/api/projects/${id}/export`);
    story = doc.story;
    title = await api(`/api/projects/${id}/title`);
    if (story?.dialogs?.some((d) => d.id === 'leave1') && title?.press?.text === 'LEAVE TEST') break;
    await s.wait(250);
  }
  t.check('story text typed just before a reload is saved', story?.dialogs?.some((d) => d.id === 'leave1' && /TYPED JUST BEFORE/.test(d.text)), story?.dialogs?.map((d) => d.id));
  t.check('a title screen edit just before a reload is saved', title?.press?.text === 'LEAVE TEST', title?.press);
  const info = await api(`/api/projects/${id}/info`);
  t.check('each was saved once (no duplicate edits)', info.edits <= 3, info.edits);

  // the route takes only project changes, and only for a real project
  const bad = await fetch(`${URL_BASE}/api/projects/${id}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ type: 'reset_edits' }, { type: 'chat', text: 'hi' }, { type: 'new_chat' }] }) }).then((r) => r.json());
  t.eq('the leave route ignores anything but project changes', bad.handled, 0);
  const none = await fetch(`${URL_BASE}/api/projects/nope1234/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"messages":[]}' });
  t.eq('the leave route needs a real project', none.status, 404);
  await s.booted();
});
