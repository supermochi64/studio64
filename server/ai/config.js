// AI settings: which providers are set up (base URL, API key, chosen models)
// and the presets for the popular ones. Stored server-side in a private file
// (~/.config/studio64/ai.json, mode 0600, or STUDIO_AI_CONFIG); API keys never
// leave the server: browsers only see a masked hint.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CONFIG_FILE = process.env.STUDIO_AI_CONFIG || path.join(os.homedir(), '.config', 'studio64', 'ai.json');
// STUDIO_AI_LOCKED=1: settings can only be changed in the file (e.g. on a shared server)
export const LOCKED = /^(1|true|yes)$/i.test(process.env.STUDIO_AI_LOCKED || '');

// The Claude models of the Agent SDK path (Claude Code login or ANTHROPIC_API_KEY).
export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', hint: 'Smartest' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', hint: 'Fast' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', hint: 'Fastest' },
];

// kind: anthropic (Messages API), openai (Chat Completions), ollama (native /api/chat).
// suggest: model ids tried in order when the provider is first connected.
export const PRESETS = [
  { id: 'anthropic', label: 'Anthropic API', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', env: ['ANTHROPIC_API_KEY'],
    keyUrl: 'https://console.anthropic.com/settings/keys', keyPrefix: 'sk-ant-', blurb: 'Claude with your own API key, billed per use.',
    suggest: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'], vision: true, tools: true },
  { id: 'openai', label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', env: ['OPENAI_API_KEY'],
    keyUrl: 'https://platform.openai.com/api-keys', keyPrefix: 'sk-', blurb: 'GPT models.',
    suggest: ['gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini'], vision: true, tools: true, usage: true },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', env: ['OPENROUTER_API_KEY'],
    keyUrl: 'https://openrouter.ai/keys', keyPrefix: 'sk-or-', blurb: 'Hundreds of models (Gemini, GPT, Claude, Qwen, DeepSeek, Llama...) with one key.',
    suggest: ['~google/gemini-flash-latest', 'google/gemini-2.5-flash', 'qwen/qwen3.7-flash', 'openai/gpt-5-mini'], usage: true,
    headers: { 'HTTP-Referer': 'https://github.com/studio64', 'X-Title': 'Studio 64' } },
  { id: 'gemini', label: 'Google Gemini', kind: 'openai', flavor: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    env: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], keyUrl: 'https://aistudio.google.com/apikey', keyPrefix: 'AI', blurb: 'Gemini through Google AI Studio (has a free tier).',
    suggest: ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'], vision: true, tools: true },
  { id: 'groq', label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', env: ['GROQ_API_KEY'],
    keyUrl: 'https://console.groq.com/keys', keyPrefix: 'gsk_', blurb: 'Very fast open models.',
    suggest: ['openai/gpt-oss-120b', 'moonshotai/kimi-k2-instruct', 'llama-3.3-70b-versatile'], tools: true },
  { id: 'together', label: 'Together AI', kind: 'openai', baseUrl: 'https://api.together.xyz/v1', env: ['TOGETHER_API_KEY'],
    keyUrl: 'https://api.together.ai/settings/api-keys', blurb: 'Open models in the cloud.',
    suggest: ['Qwen/Qwen3-235B-A22B-Instruct-2507-tput', 'meta-llama/Llama-3.3-70B-Instruct-Turbo'], tools: true },
  { id: 'deepseek', label: 'DeepSeek', kind: 'openai', flavor: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', env: ['DEEPSEEK_API_KEY'],
    keyUrl: 'https://platform.deepseek.com/api_keys', keyPrefix: 'sk-', blurb: 'DeepSeek chat and reasoning models.',
    suggest: ['deepseek-chat'], vision: false, tools: true },
  { id: 'mistral', label: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1', env: ['MISTRAL_API_KEY'],
    keyUrl: 'https://console.mistral.ai/api-keys', blurb: 'Mistral Large, Medium, Small.',
    suggest: ['mistral-medium-latest', 'mistral-small-latest', 'mistral-large-latest'], tools: true },
  { id: 'xai', label: 'xAI Grok', kind: 'openai', baseUrl: 'https://api.x.ai/v1', env: ['XAI_API_KEY'],
    keyUrl: 'https://console.x.ai', keyPrefix: 'xai-', blurb: 'Grok models.',
    suggest: ['grok-4-fast', 'grok-3-mini'], tools: true },
  { id: 'ollama', label: 'Ollama', kind: 'ollama', baseUrl: 'http://localhost:11434', env: [], hostEnv: 'OLLAMA_HOST', local: true,
    keyUrl: 'https://ollama.com/search?c=tools', blurb: 'Models on this computer. Pick one with tool support (qwen3, llama3.1, mistral-small...).',
    suggest: ['qwen3', 'qwen2.5', 'llama3.1', 'mistral-small'] },
  { id: 'lmstudio', label: 'LM Studio', kind: 'openai', baseUrl: 'http://localhost:1234/v1', env: [], local: true,
    keyUrl: 'https://lmstudio.ai', blurb: 'Local models through LM Studio\'s server (Developer tab, Start server).' },
  { id: 'llamacpp', label: 'llama.cpp', kind: 'openai', baseUrl: 'http://localhost:8080/v1', env: [], local: true,
    keyUrl: 'https://github.com/ggml-org/llama.cpp/tree/master/tools/server', blurb: 'llama-server with --jinja (needed for tool calls).' },
  { id: 'vllm', label: 'vLLM', kind: 'openai', baseUrl: 'http://localhost:8000/v1', env: ['VLLM_API_KEY'], local: true,
    keyUrl: 'https://docs.vllm.ai', blurb: 'vllm serve with --enable-auto-tool-choice and a --tool-call-parser.' },
];
export const CUSTOM_PRESET = { id: 'custom', label: 'Custom endpoint', kind: 'openai', baseUrl: '', env: [], custom: true,
  blurb: 'Any server that speaks the OpenAI Chat Completions API.' };

const presetOf = (id) => PRESETS.find((p) => p.id === id) || (id?.startsWith('custom') ? CUSTOM_PRESET : null);

let cache = null;
let cacheMtime = 0;

export function loadSettings() {
  try {
    const st = fs.statSync(CONFIG_FILE);
    if (cache && st.mtimeMs === cacheMtime) return cache;
    const s = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    s.providers ||= {};
    cache = s;
    cacheMtime = st.mtimeMs;
    return s;
  } catch {
    cache = { version: 1, providers: {} };
    cacheMtime = 0;
    return cache;
  }
}

export function saveSettings(s) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true, mode: 0o700 });
  const tmp = `${CONFIG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, CONFIG_FILE);
  cache = s;
  cacheMtime = fs.statSync(CONFIG_FILE).mtimeMs;
}

function envKey(preset) {
  for (const k of preset?.env || []) if (process.env[k]) return { key: process.env[k], name: k };
  return null;
}

function normalizeHost(h) {
  if (!h) return '';
  let s = String(h).trim();
  if (!/^https?:\/\//.test(s)) s = `http://${s}`;
  s = s.replace('://0.0.0.0', '://127.0.0.1');
  if (!/:\d+(\/|$)/.test(s.replace(/^https?:\/\//, ''))) s = s.replace(/\/?$/, ':11434');
  return s.replace(/\/+$/, '');
}

// Everything the agent loop needs to call one provider (with the secret key).
export function resolveProvider(id) {
  const preset = presetOf(id);
  if (!preset) return null;
  const conf = loadSettings().providers[id] || {};
  const env = envKey(preset);
  let baseUrl = conf.baseUrl || (preset.hostEnv && process.env[preset.hostEnv] ? normalizeHost(process.env[preset.hostEnv]) : preset.baseUrl);
  baseUrl = String(baseUrl || '').replace(/\/+$/, '');
  return {
    id, preset, kind: conf.kind || preset.kind, flavor: preset.flavor || null,
    label: conf.name || preset.label, baseUrl,
    apiKey: conf.apiKey || env?.key || '', keySource: conf.apiKey ? 'settings' : env ? `env ${env.name}` : null,
    headers: preset.headers || {}, local: !!preset.local,
    lite: conf.lite ?? !!preset.local, // fewer tools + a shorter prompt for small local models
    contextTokens: Number(conf.contextTokens) || (preset.local ? 32768 : 200000),
    maxTurns: Math.max(4, Math.min(100, Number(conf.maxTurns) || 40)),
    models: conf.models || [],
    usage: !!preset.usage,
  };
}

// '@openrouter/google/gemini-2.5-flash' -> { provider: 'openrouter', model: 'google/gemini-2.5-flash' }.
// Plain ids are Claude models of the Agent SDK path.
export function parseModel(id) {
  const m = /^@([\w-]+)\/(.+)$/.exec(String(id || ''));
  return m ? { provider: m[1], model: m[2] } : null;
}
export const isLoopModel = (id) => !!parseModel(id);
export const modelRef = (provider, model) => `@${provider}/${model}`;

// The model's entry in the settings (its known capabilities), if the user picked it.
export function modelInfo(id) {
  const pm = parseModel(id);
  if (!pm) return CLAUDE_MODELS.find((m) => m.id === id) || null;
  const conf = loadSettings().providers[pm.provider];
  const entry = conf?.models?.find((m) => m.id === pm.model);
  return entry ? { ...entry, provider: pm.provider } : { id: pm.model, provider: pm.provider };
}

export function isKnownModel(id) {
  if (CLAUDE_MODELS.some((m) => m.id === id)) return true;
  const pm = parseModel(id);
  const preset = pm && presetOf(pm.provider);
  if (!preset) return false;
  // set up in the dialog, or usable straight from an env key / a local server (STUDIO_MODEL=@ollama/qwen3)
  return !!loadSettings().providers[pm.provider] || (!preset.custom && (!!envKey(preset) || !!preset.local));
}

const shortLabel = (id) => {
  const base = id.replace(/^models\//, '').split('/').pop().replace(/^~/, '');
  return base.length > 34 ? `${base.slice(0, 32)}…` : base;
};

// The chat's model picker: Claude (subscription) first, then each set-up provider's models.
export function modelMenu() {
  const s = loadSettings();
  if (!aiEnabled()) return [];
  const out = claudeLogin() ? CLAUDE_MODELS.map((m) => ({ ...m, group: 'Claude (subscription)', provider: 'claude' })) : [];
  const d = s.defaultModel || process.env.STUDIO_MODEL;
  const pd = parseModel(d);
  if (pd && !s.providers[pd.provider] && isKnownModel(d)) {
    const r = resolveProvider(pd.provider);
    out.push({ id: d, label: shortLabel(pd.model), hint: r.label, group: r.label, provider: pd.provider });
  }
  for (const [pid, conf] of Object.entries(s.providers)) {
    const r = resolveProvider(pid);
    if (!r || conf.disabled) continue;
    for (const m of conf.models || []) {
      out.push({ id: modelRef(pid, m.id), label: m.label || shortLabel(m.id), hint: r.label, group: r.label, provider: pid,
        tools: m.tools, vision: m.vision });
    }
  }
  return out;
}

export function defaultModel() {
  const d = loadSettings().defaultModel || process.env.STUDIO_MODEL;
  if (d && isKnownModel(d) && (isLoopModel(d) || claudeLogin())) return d;
  if (claudeLogin()) return 'claude-opus-5-5';
  return modelMenu()[0]?.id || 'claude-opus-5-5';
}

// ---- is there any AI at all? ------------------------------------------------------------------
// STUDIO_AI=off turns every AI feature off (the app hides the chat); the settings dialog
// has the same switch (saved in the settings file). STUDIO_CLAUDE=on/off overrides the
// detection of the Claude Code login (off: e.g. tests that pretend there is none).

export const AI_FORCED_OFF = /^(0|off|false|no|none)$/i.test(process.env.STUDIO_AI || '');

export function aiEnabled() {
  return !AI_FORCED_OFF && loadSettings().enabled !== false;
}

export function setAiEnabled(on) {
  if (AI_FORCED_OFF) throw new Error('AI is turned off on this server (STUDIO_AI=off)');
  if (LOCKED) throw new Error('AI settings are locked on this server (STUDIO_AI_LOCKED)');
  const s = structuredClone(loadSettings());
  if (on) delete s.enabled; else s.enabled = false;
  saveSettings(s);
}

// Can this model run right now (its provider set up, Claude logged in)?
export function canRun(model) {
  if (!aiEnabled()) return false;
  if (isLoopModel(model)) return isKnownModel(model);
  return !!claudeLogin() && CLAUDE_MODELS.some((m) => m.id === model);
}

export function aiStatus() {
  if (AI_FORCED_OFF) return { available: false, enabled: false, forcedOff: true, reason: 'AI is turned off on this server (STUDIO_AI=off).' };
  const enabled = aiEnabled();
  const claude = !!claudeLogin();
  let loopModels = 0;
  for (const [pid, conf] of Object.entries(loadSettings().providers)) if (!conf.disabled && resolveProvider(pid)) loopModels += (conf.models || []).length;
  if (!claude && !loopModels) {
    const d = process.env.STUDIO_MODEL;
    if (d && isLoopModel(d) && isKnownModel(d)) loopModels = 1;
  }
  const usable = claude || loopModels > 0;
  return {
    available: enabled && usable, enabled, claude, providers: loopModels,
    reason: !enabled ? 'The AI assistant is turned off.' : usable ? null : 'No AI is connected: log in to Claude Code on the server or add a provider in AI settings.',
  };
}

const mask = (k) => (!k ? null : k.length <= 10 ? '•••' : `${k.slice(0, Math.min(7, k.length - 6))}…${k.slice(-4)}`);

// What a browser may see: no keys, only whether one is there and a masked hint.
export function publicSettings() {
  const s = loadSettings();
  const providers = [...PRESETS, ...Object.keys(s.providers).filter((id) => id.startsWith('custom')).map((id) => ({ ...CUSTOM_PRESET, id }))]
    .map((preset) => {
      const conf = s.providers[preset.id];
      const r = resolveProvider(preset.id);
      return {
        id: preset.id, label: r.label, kind: r.kind, blurb: preset.blurb, keyUrl: preset.keyUrl, keyPrefix: preset.keyPrefix,
        local: !!preset.local, custom: !!preset.custom, defaultBaseUrl: preset.baseUrl, baseUrl: r.baseUrl,
        needsKey: !preset.local && !preset.custom, envNames: preset.env || [],
        hasKey: !!r.apiKey, keyHint: mask(r.apiKey), keySource: r.keySource,
        configured: !!conf, disabled: !!conf?.disabled, models: conf?.models || [],
        lite: r.lite, contextTokens: r.contextTokens, maxTurns: r.maxTurns, suggest: preset.suggest || [],
      };
    });
  return { file: CONFIG_FILE, locked: LOCKED, ai: aiStatus(), defaultModel: defaultModel(), claude: { models: CLAUDE_MODELS, login: claudeLogin() }, providers };
}

// How the Agent SDK would sign in: an API key / token in the environment, or the Claude Code
// login (~/.claude/.credentials.json; on macOS the token is in the keychain and ~/.claude.json
// names the account). Checked at most every 10 s.
let loginCache = { t: 0, v: null };
export function claudeLogin() {
  const force = (process.env.STUDIO_CLAUDE || '').toLowerCase();
  if (/^(0|off|false|no)$/.test(force)) return null;
  if (/^(1|on|true|yes)$/.test(force)) return 'STUDIO_CLAUDE=on';
  if (Date.now() - loginCache.t < 10000) return loginCache.v;
  let v = null;
  for (const k of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN']) if (process.env[k]) { v = k; break; }
  if (!v && (process.env.CLAUDE_CODE_USE_BEDROCK || process.env.CLAUDE_CODE_USE_VERTEX)) v = 'Bedrock / Vertex';
  if (!v) {
    const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    try {
      const c = JSON.parse(fs.readFileSync(path.join(dir, '.credentials.json'), 'utf8'));
      if (c && (c.claudeAiOauth?.accessToken || c.claudeAiOauth?.refreshToken || Object.keys(c).length)) v = 'Claude Code login';
    } catch { /* no file */ }
  }
  if (!v && process.platform === 'darwin') {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(process.env.CLAUDE_CONFIG_DIR || os.homedir(), '.claude.json'), 'utf8'));
      if (j.oauthAccount) v = 'Claude Code login';
    } catch { /* none */ }
  }
  loginCache = { t: Date.now(), v };
  return v;
}

// Apply a change from the settings dialog. A new base URL drops the stored key
// unless a key comes with it, so a key can't be redirected to another server.
export function updateProvider(id, patch) {
  if (LOCKED) throw new Error('AI settings are locked on this server (STUDIO_AI_LOCKED)');
  if (!/^[\w-]{2,40}$/.test(id) || !presetOf(id)) throw new Error('unknown provider');
  const s = structuredClone(loadSettings());
  if (patch.remove) {
    delete s.providers[id];
    if (parseModel(s.defaultModel)?.provider === id) delete s.defaultModel;
    saveSettings(s);
    return;
  }
  const conf = s.providers[id] || { models: [] };
  if (patch.baseUrl !== undefined) {
    const url = String(patch.baseUrl).trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\/[^\s]+$/.test(url)) throw new Error('the base URL must start with http:// or https://');
    const before = conf.baseUrl || presetOf(id).baseUrl;
    if (url !== before && conf.apiKey && patch.apiKey === undefined) delete conf.apiKey;
    if (!url || url === presetOf(id).baseUrl) delete conf.baseUrl; else conf.baseUrl = url;
  }
  if (patch.apiKey !== undefined) {
    const k = String(patch.apiKey).trim();
    if (/\s/.test(k) || k.length > 400) throw new Error('that does not look like an API key');
    if (k) conf.apiKey = k; else delete conf.apiKey;
  }
  if (patch.name !== undefined) conf.name = String(patch.name).trim().slice(0, 40) || undefined;
  if (patch.lite !== undefined) conf.lite = patch.lite === null ? undefined : !!patch.lite;
  if (patch.contextTokens !== undefined) conf.contextTokens = Number(patch.contextTokens) || undefined;
  if (patch.maxTurns !== undefined) conf.maxTurns = Number(patch.maxTurns) || undefined;
  if (patch.disabled !== undefined) conf.disabled = !!patch.disabled || undefined;
  if (Array.isArray(patch.models)) {
    conf.models = patch.models.slice(0, 60).map((m) => (typeof m === 'string' ? { id: m } : {
      id: String(m.id).slice(0, 200), label: m.label ? String(m.label).slice(0, 60) : undefined,
      tools: typeof m.tools === 'boolean' ? m.tools : undefined, vision: typeof m.vision === 'boolean' ? m.vision : undefined,
      context: Number(m.context) || undefined,
      price: Array.isArray(m.price) && m.price.length === 2 ? m.price.map(Number) : undefined,
    })).filter((m) => m.id);
  }
  s.providers[id] = conf;
  saveSettings(s);
}

export function setDefaultModel(model) {
  if (LOCKED) throw new Error('AI settings are locked on this server (STUDIO_AI_LOCKED)');
  if (!isKnownModel(model)) throw new Error('unknown model');
  const s = structuredClone(loadSettings());
  s.defaultModel = model;
  saveSettings(s);
}

// Remember what a model turned out to support (no tools / no images), so the
// next turn degrades right away instead of failing first.
export function learnModel(ref, facts) {
  const pm = parseModel(ref);
  if (!pm) return;
  const s = structuredClone(loadSettings());
  const conf = s.providers[pm.provider];
  if (!conf) return;
  conf.models ||= [];
  let m = conf.models.find((x) => x.id === pm.model);
  if (!m) { m = { id: pm.model }; conf.models.push(m); }
  let changed = false;
  for (const [k, v] of Object.entries(facts)) if (m[k] !== v) { m[k] = v; changed = true; }
  if (changed) { try { saveSettings(s); } catch { /* read-only config */ } }
}

export function newCustomId() {
  const s = loadSettings();
  let n = 1;
  while (s.providers[n === 1 ? 'custom' : `custom${n}`]) n++;
  return n === 1 ? 'custom' : `custom${n}`;
}
