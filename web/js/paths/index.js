// Roads & nature (docs/roads-and-nature.md): roads, walks, fences and painted plants.
//   installPathsRuntime: the game side (studio and player), before the first area loads.
//   installPathsEditor:  build mode's Roads and Nature tools, palette commands and the AI's rpc methods.
import { PathsRuntime } from './runtime.js';
import { PathsUI } from './ui.js';
import { registerPathsRpc } from './rpc.js';

export function installPathsRuntime({ engine, world, assets, toast }) {
  const rt = new PathsRuntime({ engine, world, assets, toast });
  window.studio64Paths = rt;
  return rt;
}

export function installPathsEditor(rt, { editor, editorUI, studio, toast }) {
  if (!rt) return null;
  const ui = new PathsUI({ rt, editor, editorUI, studio, toast });
  rt.ui = ui;
  registerPathsRpc(rt, ui);
  return ui;
}
