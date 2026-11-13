// create_model: the AI designs a mesh itself (vertex positions, triangles, colours) and it
// becomes a real, placeable model -- the same storage and pipeline as a dropped .glb
// (Assets.addModel), so place_model works on it afterwards exactly like anything from
// list_assets. Exercises the asset_generate rpc directly (what server/tools/assets.js's
// create_model calls), skipping the AI and the websocket hop.
// @tags smoke assets
import { suite } from '../lib/harness.mjs';

await suite('create_model (AI-authored mesh -> real model)', async (t) => {
  const s = await t.open({ level: 9 });

  // a simple pyramid: 5 vertices, 6 triangles (4 sides + a 2-triangle base), CCW from outside
  const positions = [0, 0.2, 0, -0.1, 0, -0.1, 0.1, 0, -0.1, 0.1, 0, 0.1, -0.1, 0, 0.1];
  const indices = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1, 1, 3, 2, 1, 4, 3];

  const created = await s.eval(([pos, idx]) => studio64.studio.handle('asset_generate', {
    name: 'Test Pyramid', parts: [{ positions: pos, indices: idx, color: '#ff8800' }],
  }), [positions, indices]);
  t.must('model created with an id', !!created?.id, created);
  t.check('triangle count matches the mesh', created.tris === 6, created);

  const list = await s.eval(() => studio64.studio.handle('asset_list', {}));
  t.check('shows up in list_assets', list.models.some((m) => m.id === created.id), list.models.map((m) => m.id));

  const placed = await s.eval((id) => studio64.studio.handle('asset_place', { model: id, where: { mode: 'in_front' } }), created.id);
  t.must('placed without error', placed.records?.length === 1, placed);

  // bad input: out-of-range index should reject cleanly (no crash, no half-made model)
  const before = (await s.eval(() => studio64.studio.handle('asset_list', {}))).models.length;
  let rejected = null;
  try {
    await s.eval(([pos]) => studio64.studio.handle('asset_generate', { name: 'Bad', parts: [{ positions: pos, indices: [0, 1, 99] }] }), [positions]);
  } catch (e) { rejected = e; }
  t.check('bad mesh is rejected', !!rejected);
  const after = (await s.eval(() => studio64.studio.handle('asset_list', {}))).models.length;
  t.check('no model added on rejection', after === before, { before, after });
});
