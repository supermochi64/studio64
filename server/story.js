// The project's story (dialogs, game texts, characters, variables, events, cutscenes, start):
// stored in project.story, edited with the operations in web/js/story/ops.js (shared with the
// browser), and sent to everyone on the project after each change.
import { applyStoryOp, ensureStory } from '../web/js/story/ops.js';
import * as projects from './projects.js';

export function storyOf(p) {
  p.story = ensureStory(p.story);
  return p.story;
}

// Apply operations, save, and tell every client. Returns the summaries.
// Each call is one undo step (quick edits of the same thing in a row merge: typing a dialog).
export function storyEdit(hub, p, ops, except = null, { by = null, record = true } = {}) {
  const before = JSON.stringify(storyOf(p));
  const story = storyOf(p);
  const out = [];
  try {
    for (const op of [].concat(ops || [])) {
      const s = applyStoryOp(story, op);
      if (s) out.push(s);
    }
  } finally {
    // (also when an operation failed half way: what was applied is one undo step)
    if (record && JSON.stringify(story) !== before) {
      const summary = typeof out[0] === 'string' ? out[0] + (out.length > 1 ? ` (+${out.length - 1})` : '') : 'Changed the story';
      projects.recordProjectChange(p, ['story'], JSON.parse(before), summary, { by });
      hub.broadcast(p.id, { type: 'changes', changes: projects.changeList(p) });
    }
  }
  projects.save(p);
  hub.broadcast(p.id, { type: 'story', story }, except);
  return out;
}
