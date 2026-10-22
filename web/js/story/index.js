// Studio glue for the story feature: the runtime (needs to exist before the engine boots), the
// Story panel and the build-mode Logic tool (after the editor exists), the server's story
// messages, and the browser side of Claude's story tools.
import { StoryRuntime } from './runtime.js';
import { StoryUI } from './story_ui.js';
import { LogicUI } from './logic_ui.js';
import { ensureStory } from './ops.js';
import './rpc.js';

// Before engine.boot(): hooks into area loads and frames.
export function attachStoryRuntime(state, { frame, toast, autoStart = true }) {
  if (state.storyRuntime) return state.storyRuntime;
  state.story = ensureStory(state.story);
  state.storyRuntime = new StoryRuntime({
    engine: state.engine, getStory: () => (state.story = ensureStory(state.story)), projectId: () => state.projectId,
    frame, toast, isEditing: () => !!state.editor?.active, world: state.world, getLevels: () => state.levels || [], autoStart,
    flow: () => state.studio?.worldFlow || state.worldFlow || null,
    // "Play from start": one fresh save (savegame.js) — the game's save file, stars, keys, story
    resetSave: () => {
      const rt = state.storyRuntime;
      if (state.save) state.save.reset({ engine: state.engine, world: state.world, story: rt, flow: state.studio?.worldFlow || state.worldFlow });
      else rt.resetProgress();
      state.levelsUI?.syncStarTotal?.();
    },
  });
  state.studio.storyRuntime = state.storyRuntime;
  return state.storyRuntime;
}

// After the editor and its UI exist.
export function attachStoryUI(state, { send, toast }) {
  if (state.storyUI) return state.storyUI;
  const common = { engine: state.engine, studio: state.studio, editor: state.editor, runtime: state.storyRuntime, send, toast, getStory: () => (state.story = ensureStory(state.story)), catalog: state.catalog };
  state.logicUI = new LogicUI({ ...common, editorUI: state.editorUI });
  state.storyUI = new StoryUI({ ...common, world: state.world, logic: state.logicUI, getLevels: () => state.levels || [], getAudio: () => state.audio });
  state.logicUI.ui = state.storyUI;
  state.studio.storyUI = state.storyUI;
  const btn = document.querySelector('#story-btn');
  if (btn) btn.onclick = () => (state.storyUI.isOpen() ? state.storyUI.close() : state.storyUI.open());
  window.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    if (typing || e.ctrlKey || e.metaKey || e.altKey || e.code !== 'KeyY') return;
    if (state.editor?.active || !document.querySelector('.game-frame.playing')) {
      e.preventDefault();
      if (state.storyUI.isOpen()) state.storyUI.close(); else state.storyUI.open();
    }
  });
  return state.storyUI;
}

// A story arrived from the server (welcome, someone else's edit, Claude).
export function storyMessage(state, story) {
  state.story = ensureStory(story);
  const rt = state.storyRuntime;
  if (rt) { rt.applyTexts(); rt.registerWatches(); }
  state.storyUI?.remoteChanged();
  state.logicUI?.refresh();
}
