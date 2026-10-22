// AI on or off. Studio 64 is a complete editor without any AI: when no AI is connected on the
// server, when the server turned it off (STUDIO_AI=off or the switch in AI settings), or when
// this browser said "no AI" (a per-browser preference), <body> gets the class `no-ai`.
// Convention for every module:
//   [data-ai]     is hidden in no-AI mode (chat, "Ask Claude…", AI hints, model menu, ...)
//   [data-no-ai]  is shown only in no-AI mode (the wording that replaces an AI hint)
//   aiOn()        for code paths (commands, tips, key shortcuts)
//   window event `studio-ai-mode` ({ detail: { on, ai } }) when it changes at runtime
const KEY = 'studio64.ai';

export function browserWantsAi() {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setBrowserWantsAi(on) {
  try { if (on) localStorage.removeItem(KEY); else localStorage.setItem(KEY, 'off'); } catch { /* private mode */ }
}

export function aiOn() { return !document.body.classList.contains('no-ai'); }

let last = null;
// ai = the server's status from /api/config ({ available, enabled, reason, ... })
export function applyAiMode(ai) {
  if (ai) last = ai;
  const on = !!last?.available && browserWantsAi();
  document.body.classList.toggle('no-ai', !on);
  document.body.dataset.aiMode = on ? 'on' : 'off';
  window.dispatchEvent(new CustomEvent('studio-ai-mode', { detail: { on, ai: last } }));
  return on;
}

export function serverAi() { return last; }
