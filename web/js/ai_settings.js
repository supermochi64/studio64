import { askConfirm } from './dialogs.js';

// The AI settings dialog: pick which AI builds with you. Claude through the
// subscription is built in; any other provider (Anthropic API, OpenAI,
// OpenRouter, Gemini, Groq, ..., Ollama and other local servers, custom
// OpenAI-compatible endpoints) is two clicks: choose it, paste the key.
// Keys go to the server (stored in a private file there) and never come back.
// The switch on top turns the whole AI assistant off (this browser, or everyone on the server):
// see ai_mode.js for the `no-ai` convention.
import { applyAiMode, browserWantsAi, setBrowserWantsAi } from './ai_mode.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SVG = (d, cls = 'i sm') => `<svg class="${cls}" viewBox="0 0 24 24">${d}</svg>`;
const IC = {
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14.5 8.5l2.5 2.5"/>',
  star: '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
};

// monogram + colour per provider
const BRAND = {
  claude: ['C', '#d97757'], anthropic: ['A', '#d97757'], openai: ['O', '#10a37f'], openrouter: ['OR', '#6467f2'],
  gemini: ['G', 'linear-gradient(135deg,#4285f4,#9b72cb 60%,#d96570)'], groq: ['gq', '#f55036'], together: ['T', '#0f6fff'],
  deepseek: ['DS', '#4d6bfe'], mistral: ['M', 'linear-gradient(135deg,#ffd800,#ff8205 50%,#e10500)'], xai: ['x', '#2a2a30'],
  ollama: ['🦙', '#f2f2f2'], lmstudio: ['LM', '#6c5ce7'], llamacpp: ['ll', '#c8730e'], vllm: ['v', '#2b5797'], custom: ['{}', '#4b4b55'],
};
const brandOf = (id) => BRAND[id] || BRAND[id.replace(/\d+$/, '')] || BRAND.custom;
const badge = (id) => { const [t, c] = brandOf(id); return `<span class="ai-mono" style="background:${c}${id === 'ollama' ? ';color:#111' : ''}">${esc(t)}</span>`; };

let S = null; // open dialog state

async function api(path, body) {
  const pw = window.studio64?.password || '';
  const r = await fetch(path, body === undefined
    ? { headers: { 'x-studio-key': pw } }
    : { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-key': pw }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// The chat's model menu (the server's /api/config hides providers until the password is known).
export async function fetchMenu() {
  try { return await api('/api/ai/menu'); } catch { return null; }
}

export function isAiSettingsOpen() { return !!S; }

export async function openAiSettings({ currentModel, onModels, onPick, focus } = {}) {
  if (S) return;
  const root = document.createElement('div');
  root.className = 'ai-back';
  root.innerHTML = `<div class="ai-dialog" role="dialog" aria-label="AI settings">
      <header class="ai-head">
        <div class="ai-title">${SVG(IC.bolt, 'i')}<div><h2>AI assistant</h2><p>Optional: an AI that builds with you in the chat. Every model gets the same studio tools.</p></div></div>
        <button class="btn icon ghost" data-act="close" title="Close (Esc)">${SVG(IC.x, 'i')}</button>
      </header>
      <div class="ai-switch-row"></div>
      <div class="ai-offnote">${SVG(IC.check, 'i')}<div><b>Studio 64 works fully without AI.</b><span>Play, build with blocks and objects, sculpt terrain, make levels and stars, write the story, compose music, test and share: every tool is there. The chat and every AI button are gone.</span></div></div>
      <div class="ai-body"><nav class="ai-nav"></nav><section class="ai-pane"><div class="ai-loading">Loading…</div></section></div>
      <footer class="ai-foot"></footer>
    </div>`;
  document.body.appendChild(root);
  // typing here must never reach the game
  for (const t of ['keydown', 'keyup', 'keypress']) root.addEventListener(t, (e) => { if (e.key === 'Escape' && t === 'keydown') close(); e.stopPropagation(); });
  root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
  // Esc also works when the focus fell back to the page (buttons re-render)
  const onKey = (e) => {
    if (S?.root !== root) return;
    if (e.key === 'Escape' && e.type === 'keydown') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (!root.contains(e.target)) e.stopPropagation(); // nothing behind the dialog reacts to keys
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  window.studio64?.engine?.releaseKeys?.();
  S = { root, onKey, currentModel, onModels, onPick, sel: focus || null, lists: {}, drafts: {}, status: {}, probes: {}, filter: '', toolsOnly: true, showAdv: {} };
  root.querySelector('[data-act=close]').onclick = close;
  try {
    S.data = await api('/api/ai/settings');
  } catch (err) {
    root.querySelector('.ai-pane').innerHTML = `<div class="ai-error">${esc(err.message)}</div>`;
    return;
  }
  S.sel ||= isLoop(currentModel) ? providerOf(currentModel) : 'claude';
  render();
}

function close() {
  if (!S) return;
  window.removeEventListener('keydown', S.onKey, true);
  window.removeEventListener('keyup', S.onKey, true);
  S.root.remove();
  S = null;
  window.studio64?.engine?.releaseKeys?.();
}

const isLoop = (id) => /^@[\w-]+\//.test(id || '');
const providerOf = (id) => (/^@([\w-]+)\//.exec(id || '') || [])[1] || 'claude';
const modelOf = (id) => String(id || '').replace(/^@[\w-]+\//, '');
const ref = (pid, mid) => `@${pid}/${mid}`;
const prov = (id) => S.data.providers.find((p) => p.id === id);

function applyData(d) {
  S.data = d;
  if (d.ai) applyAiMode(d.ai);
  S.onModels?.(d.models, d.defaultModel);
}

// The on/off switch: this browser, and (optionally) everyone on the server.
function renderSwitch() {
  const row = S.root.querySelector('.ai-switch-row');
  const ai = S.data.ai || {};
  const mine = browserWantsAi();
  const on = mine && ai.enabled !== false;
  const forced = !!ai.forcedOff;
  S.root.querySelector('.ai-dialog').classList.toggle('off', !on);
  let note;
  if (forced) note = 'Turned off on this server (STUDIO_AI=off).';
  else if (!on) note = ai.enabled === false ? 'Off for everyone on this server.' : 'Off in this browser. The chat and every AI button are hidden.';
  else if (!ai.available) note = 'On, but no AI is connected yet: log in to Claude Code on the server or set up a provider below.';
  else note = `On: ${ai.claude ? 'Claude' : ''}${ai.claude && ai.providers ? ' and ' : ''}${ai.providers ? `${ai.providers} other model${ai.providers > 1 ? 's' : ''}` : ''} ready in the chat.`;
  row.innerHTML = `<button class="ai-switch${on ? ' on' : ''}" role="switch" aria-checked="${on}" data-act="toggle"${forced ? ' disabled' : ''}><span class="ai-knob"></span></button>
    <div class="ai-switch-l"><b>AI assistant: ${on ? 'On' : 'Off'}</b><small>${esc(note)}</small></div>
    ${forced || S.data.locked ? '' : `<label class="ai-check ai-everyone"><input type="checkbox" data-act="everyone"${ai.enabled === false ? ' checked' : ''}> Off for everyone on this server</label>`}`;
  row.querySelector('[data-act=toggle]').onclick = async () => {
    if (on) {
      setBrowserWantsAi(false);
      applyAiMode();
    } else {
      setBrowserWantsAi(true);
      if (ai.enabled === false) { try { applyData(await api('/api/ai/enabled', { enabled: true })); } catch (err) { toastHere(err.message, true); } }
      applyAiMode(S.data.ai);
    }
    render();
  };
  row.querySelector('[data-act=everyone]')?.addEventListener('change', async (e) => {
    try { applyData(await api('/api/ai/enabled', { enabled: !e.target.checked })); } catch (err) { toastHere(err.message, true); }
    render();
  });
}

function statusOf(p) {
  if (p.models.length && (p.hasKey || p.local || p.custom)) return 'on';
  if (p.hasKey || p.configured) return 'half';
  return 'off';
}

function render() {
  if (!S) return;
  renderSwitch();
  const nav = S.root.querySelector('.ai-nav');
  const groups = [
    ['Cloud', S.data.providers.filter((p) => !p.local && !p.custom)],
    ['On this computer', S.data.providers.filter((p) => p.local)],
    ['Custom', S.data.providers.filter((p) => p.custom)],
  ];
  const claudeOn = !!S.data.claude.login;
  nav.innerHTML = `<button class="ai-item${S.sel === 'claude' ? ' sel' : ''}" data-id="claude">${badge('claude')}<span class="ai-item-l"><b>Claude</b><small>Subscription · built in</small></span><i class="ai-dot ${claudeOn ? 'on' : 'half'}"></i></button>`
    + groups.map(([label, list]) => `<div class="ai-group">${label}</div>${list.map((p) => `<button class="ai-item${S.sel === p.id ? ' sel' : ''}" data-id="${esc(p.id)}">${badge(p.id)}<span class="ai-item-l"><b>${esc(p.label)}</b><small>${p.models.length ? `${p.models.length} model${p.models.length > 1 ? 's' : ''}` : p.hasKey ? 'key added' : p.local ? 'local server' : p.custom ? 'endpoint' : 'not set up'}</small></span><i class="ai-dot ${statusOf(p)}"></i></button>`).join('')}`).join('')
    + `<button class="ai-item ai-add" data-act="add-custom">${SVG(IC.plus)}<span class="ai-item-l"><b>Add endpoint</b><small>OpenAI-compatible URL</small></span></button>`;
  nav.querySelectorAll('.ai-item[data-id]').forEach((b) => { b.onclick = () => { S.sel = b.dataset.id; render(); }; });
  nav.querySelector('[data-act=add-custom]').onclick = addCustom;
  const sel = nav.querySelector('.ai-item.sel');
  sel?.scrollIntoView?.({ block: 'nearest' });

  const pane = S.root.querySelector('.ai-pane');
  if (S.sel === 'claude') renderClaude(pane); else renderProvider(pane, prov(S.sel));
  renderFoot();
}

function renderFoot() {
  const foot = S.root.querySelector('.ai-foot');
  const opts = S.data.models.map((m) => `<option value="${esc(m.id)}"${m.id === S.data.defaultModel ? ' selected' : ''}>${esc(m.group)} · ${esc(m.label)}</option>`).join('');
  foot.innerHTML = `<label class="ai-default">Default for new projects <select data-act="default"${S.data.locked ? ' disabled' : ''}>${opts}</select></label>
    <span class="ai-foot-note">${SVG(IC.key)} Keys stay on this server (${esc(S.data.file.replace(/^\/home\/[^/]+/, '~'))}, readable only by you) and are never sent back to the browser.${S.data.locked ? ' Settings are locked on this server.' : ''}</span>`;
  foot.querySelector('[data-act=default]').onchange = async (e) => {
    try { applyData(await api('/api/ai/default', { model: e.target.value })); toastHere('Default model saved'); } catch (err) { toastHere(err.message, true); }
  };
}

function useButton(id) {
  const cur = S.currentModel === id;
  return `<button class="btn sm ${cur ? '' : 'primary'} ai-use" data-use="${esc(id)}"${cur ? ' disabled' : ''}>${cur ? `${SVG(IC.check)} In use` : 'Use in this project'}</button>`;
}

function wireUse(pane) {
  pane.querySelectorAll('[data-use]').forEach((b) => {
    b.onclick = () => {
      S.currentModel = b.dataset.use;
      S.onPick?.(b.dataset.use);
      toastHere('This project now uses that model');
      render();
    };
  });
}

function renderClaude(pane) {
  const login = S.data.claude.login;
  pane.innerHTML = `<div class="ai-hero">${badge('claude')}<div><h3>Claude <span class="ai-tag">Recommended</span></h3>
      <p>Runs through the Claude Agent SDK on this server with the Claude Code login (Pro or Max subscription) or <code>ANTHROPIC_API_KEY</code>. The best results for building levels.</p></div></div>
    <div class="ai-status ${login ? 'ok' : 'warn'}">${login ? `${SVG(IC.check)} Signed in (${esc(login)})` : 'Not signed in: run <code>claude</code> once in a terminal on the server and log in, or set <code>ANTHROPIC_API_KEY</code>.'}</div>
    <h4>Models</h4>
    <div class="ai-models">${S.data.claude.models.map((m) => `<div class="ai-model"><div class="ai-model-l"><b>${esc(m.label)}</b><small>${esc(m.hint)} · ${esc(m.id)}</small></div><div class="ai-caps"><span class="ai-cap on" title="Uses the studio tools">${SVG(IC.tool)} tools</span><span class="ai-cap on" title="Sees screenshots and pictures">${SVG(IC.eye)} vision</span></div>${useButton(m.id)}</div>`).join('')}</div>
    <p class="ai-hint">Want Claude billed per use instead of the subscription? Set up <a href="#" data-go="anthropic">Anthropic API</a>.</p>`;
  wireUse(pane);
  pane.querySelector('[data-go]').onclick = (e) => { e.preventDefault(); S.sel = 'anthropic'; render(); };
}

function fmtPrice(p) {
  if (!p) return '';
  const [a, b] = p;
  if (!a && !b) return 'free';
  const f = (x) => (x < 0.1 ? x.toFixed(3) : x < 10 ? x.toFixed(2) : x.toFixed(0)).replace(/\.?0+$/, '');
  return `$${f(a)}/$${f(b)} per M`;
}
const fmtCtx = (n) => (!n ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : `${Math.round(n / 1000)}k`);

function caps(m) {
  const c = [];
  if (m.tools === true) c.push(`<span class="ai-cap on" title="Can use the studio tools">${SVG(IC.tool)} tools</span>`);
  else if (m.tools === false) c.push(`<span class="ai-cap off" title="Can't use tools: it can only chat">no tools</span>`);
  if (m.vision === true) c.push(`<span class="ai-cap on" title="Sees screenshots and pictures">${SVG(IC.eye)} vision</span>`);
  if (m.context) c.push(`<span class="ai-cap">${fmtCtx(m.context)}</span>`);
  if (m.price) c.push(`<span class="ai-cap">${fmtPrice(m.price)}</span>`);
  return c.join('');
}

function renderProvider(pane, p) {
  if (!p) { S.sel = 'claude'; render(); return; }
  const d = (S.drafts[p.id] ||= { key: '', baseUrl: p.baseUrl, name: p.label });
  const st = S.status[p.id];
  const list = S.lists[p.id];
  const chosen = new Set(p.models.map((m) => m.id));
  const locked = S.data.locked;
  const keyPh = p.hasKey ? `Saved: ${p.keyHint}${p.keySource?.startsWith('env') ? ` (${p.keySource})` : ''}` : (p.keyPrefix ? `${p.keyPrefix}…` : 'API key');
  const showUrl = p.local || p.custom || S.showAdv[p.id];
  pane.innerHTML = `<div class="ai-hero">${badge(p.id)}<div><h3>${esc(p.label)}${p.local ? ' <span class="ai-tag">Local</span>' : ''}</h3><p>${esc(p.blurb || '')}${p.keyUrl ? ` <a href="${esc(p.keyUrl)}" target="_blank" rel="noopener">${p.needsKey ? 'Get a key' : 'Website'} ${SVG(IC.ext)}</a>` : ''}</p></div></div>
    <div class="ai-connect">
      ${p.custom ? `<label class="ai-field"><span>Name</span><input type="text" data-f="name" value="${esc(d.name)}" placeholder="My server"${locked ? ' disabled' : ''}></label>` : ''}
      ${showUrl ? `<label class="ai-field"><span>Base URL</span><input type="text" data-f="baseUrl" value="${esc(d.baseUrl)}" placeholder="${esc(p.defaultBaseUrl || 'http://localhost:8080/v1')}" spellcheck="false"${locked ? ' disabled' : ''}></label>` : ''}
      ${p.local && !p.custom && p.id !== 'vllm' ? '' : `<label class="ai-field"><span>API key${p.needsKey ? '' : ' (optional)'}</span><input type="password" data-f="key" value="${esc(d.key)}" placeholder="${esc(keyPh)}" autocomplete="off" spellcheck="false"${locked ? ' disabled' : ''}></label>`}
      <div class="ai-connect-row">
        <button class="btn primary" data-act="connect"${locked && !p.configured ? ' disabled' : ''}>${st?.busy ? '<span class="mini-spin"></span> Connecting…' : p.configured ? `${SVG(IC.bolt)} Test &amp; refresh` : `${SVG(IC.bolt)} Connect`}</button>
        ${!showUrl ? `<button class="btn ghost sm" data-act="adv">Base URL…</button>` : ''}
        ${p.envNames?.length && !p.hasKey ? `<span class="ai-hint">or set <code>${esc(p.envNames[0])}</code> on the server</span>` : ''}
      </div>
      ${st && !st.busy ? `<div class="ai-status ${st.ok ? 'ok' : 'err'}">${st.ok ? SVG(IC.check) : '⚠'} ${esc(st.text)}</div>` : ''}
    </div>
    <div class="ai-chosen"><h4>In the model menu</h4>
      ${p.models.length ? `<div class="ai-models">${p.models.map((m) => modelRow(p, m)).join('')}</div>` : `<div class="ai-empty">${p.configured || p.local ? 'Add a model from the list below.' : 'Connect first, then pick models.'}</div>`}
    </div>
    <div class="ai-browse">
      <div class="ai-browse-head"><h4>Available models${list?.models ? ` <small>${list.models.length}</small>` : ''}</h4>
        <div class="ai-search">${SVG(IC.search)}<input type="text" data-f="filter" placeholder="Search models" value="${esc(S.filter)}" spellcheck="false"></div>
        ${list?.models?.some((m) => m.tools !== undefined) ? `<label class="ai-check"><input type="checkbox" data-f="toolsOnly"${S.toolsOnly ? ' checked' : ''}> with tools</label>` : ''}
      </div>
      <div class="ai-list">${browseList(p, list, chosen)}</div>
      <div class="ai-manual"><input type="text" data-f="manual" placeholder="Or type a model id, e.g. ${esc(p.suggest?.[0] || 'model-name')}" spellcheck="false"><button class="btn sm" data-act="manual">${SVG(IC.plus)} Add</button></div>
    </div>
    ${p.configured ? `<details class="ai-adv"${S.showAdv[`${p.id}:adv`] ? ' open' : ''}><summary>${SVG(IC.wrench)} Advanced</summary>
      <label class="ai-check"><input type="checkbox" data-f="lite"${p.lite ? ' checked' : ''}> Lite mode for small models: the core tools only and a shorter list to choose from</label>
      <div class="ai-adv-row"><label class="ai-field sm"><span>Context (tokens)</span><input type="number" data-f="contextTokens" value="${p.contextTokens}" min="4096" step="1024"></label>
      <label class="ai-field sm"><span>Max steps per message</span><input type="number" data-f="maxTurns" value="${p.maxTurns}" min="4" max="100"></label>
      <button class="btn sm" data-act="save-adv">Save</button></div>
      <button class="btn sm danger" data-act="remove">${SVG(IC.trash)} Remove ${esc(p.label)}</button>
    </details>` : ''}`;

  const val = (f) => pane.querySelector(`[data-f=${f}]`);
  for (const f of ['key', 'baseUrl', 'name']) val(f)?.addEventListener('input', (e) => { d[f] = e.target.value; });
  val('key')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(p); });
  val('filter').addEventListener('input', (e) => { S.filter = e.target.value; pane.querySelector('.ai-list').innerHTML = browseList(p, S.lists[p.id], chosen); wireList(pane, p); });
  val('toolsOnly')?.addEventListener('change', (e) => { S.toolsOnly = e.target.checked; render(); });
  pane.querySelector('[data-act=connect]').onclick = () => connect(p);
  pane.querySelector('[data-act=adv]')?.addEventListener('click', () => { S.showAdv[p.id] = true; render(); });
  pane.querySelector('[data-act=manual]').onclick = () => { const v = val('manual').value.trim(); if (v) addModel(p, { id: v }); };
  val('manual').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const v = e.target.value.trim(); if (v) addModel(p, { id: v }); } });
  const adv = pane.querySelector('.ai-adv');
  adv?.addEventListener('toggle', () => { S.showAdv[`${p.id}:adv`] = adv.open; });
  val('lite')?.addEventListener('change', (e) => save(p, { lite: e.target.checked }, e.target.checked ? 'Lite mode on' : 'Lite mode off'));
  pane.querySelector('[data-act=save-adv]')?.addEventListener('click', () => save(p, { contextTokens: Number(val('contextTokens').value), maxTurns: Number(val('maxTurns').value) }, 'Saved'));
  pane.querySelector('[data-act=remove]')?.addEventListener('click', async () => {
    if (!(await askConfirm({ title: `Remove ${p.label}?`, text: 'Its key is deleted from this server.', ok: 'Remove', danger: true }))) return;
    await save(p, { remove: true }, `${p.label} removed`);
    delete S.lists[p.id]; delete S.status[p.id]; delete S.drafts[p.id];
    render();
  });
  pane.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => save(p, { models: p.models.filter((m) => m.id !== b.dataset.rm) }); });
  pane.querySelectorAll('[data-probe]').forEach((b) => { b.onclick = () => probe(p, b.dataset.probe); });
  wireUse(pane);
  wireList(pane, p);
  // a configured provider lists its models by itself
  if (!list && (p.configured || (p.local && !p.custom)) && !st?.busy) loadList(p, !p.configured);
}

function modelRow(p, m) {
  const id = ref(p.id, m.id);
  const pr = S.probes[id];
  const probeTxt = pr?.busy ? '<span class="mini-spin"></span>' : pr ? (pr.ok ? `<span class="ai-probe ${pr.tools ? 'ok' : 'warn'}">${pr.tools ? '✓ tools work' : 'answers, but no tool calls'} · ${(pr.ms / 1000).toFixed(1)} s</span>` : `<span class="ai-probe err" title="${esc(pr.error)}">✗ ${esc(pr.error.slice(0, 80))}</span>`) : '';
  return `<div class="ai-model"><div class="ai-model-l"><b>${esc(m.label || m.id.split('/').pop())}</b><small>${esc(m.id)}${S.data.defaultModel === id ? ' · default' : ''}</small></div>
    <div class="ai-caps">${caps(m)}${probeTxt}</div>
    <button class="btn sm ghost" data-probe="${esc(m.id)}" title="Send a tiny test request (costs a fraction of a cent)">${SVG(IC.play)} Test</button>
    ${useButton(id)}
    <button class="btn icon sm ghost" data-rm="${esc(m.id)}" title="Remove from the menu">${SVG(IC.x)}</button></div>`;
}

function browseList(p, list, chosen) {
  if (!list) return `<div class="ai-empty">${p.configured || p.local ? '<span class="mini-spin"></span> Loading models…' : 'Connect to see the models.'}</div>`;
  if (list.busy) return '<div class="ai-empty"><span class="mini-spin"></span> Loading models…</div>';
  if (list.error) return `<div class="ai-empty err">${esc(list.error)}</div>`;
  const q = S.filter.toLowerCase().trim();
  let ms = list.models.filter((m) => !chosen.has(m.id));
  if (S.toolsOnly && ms.some((m) => m.tools !== undefined)) ms = ms.filter((m) => m.tools !== false);
  if (q) ms = ms.filter((m) => `${m.id} ${m.label || ''}`.toLowerCase().includes(q));
  // suggested ones first, then newest
  const sug = p.suggest || [];
  const rank = (m) => { const i = sug.findIndex((s) => m.id === s || m.id.startsWith(`${s}:`) || m.id.startsWith(`${s}-`)); return i < 0 ? 99 : i; };
  ms.sort((a, b) => rank(a) - rank(b) || (b.created || 0) - (a.created || 0) || a.id.localeCompare(b.id));
  if (!ms.length) return `<div class="ai-empty">${q ? 'No model matches.' : 'No more models.'}</div>`;
  return ms.slice(0, 150).map((m) => `<button class="ai-pick" data-add="${esc(m.id)}"><span class="ai-model-l"><b>${esc(m.label || m.id)}</b>${m.label ? `<small>${esc(m.id)}</small>` : ''}</span><span class="ai-caps">${rank(m) < 99 ? '<span class="ai-cap sug">suggested</span>' : ''}${caps(m)}</span><span class="ai-pick-add">${SVG(IC.plus)}</span></button>`).join('')
    + (ms.length > 150 ? `<div class="ai-empty">${ms.length - 150} more: search to narrow down.</div>` : '');
}

function wireList(pane, p) {
  pane.querySelectorAll('[data-add]').forEach((b) => {
    b.onclick = () => {
      const m = S.lists[p.id]?.models?.find((x) => x.id === b.dataset.add) || { id: b.dataset.add };
      addModel(p, m);
    };
  });
}

const entry = (m) => ({ id: m.id, label: m.label, tools: m.tools, vision: m.vision, context: m.context, price: m.price });

async function save(p, patch, msg) {
  try {
    applyData(await api('/api/ai/provider', { id: p.id, ...patch }));
    if (msg) toastHere(msg);
  } catch (err) { toastHere(err.message, true); }
  render();
}

async function addModel(p, m) {
  if (p.models.some((x) => x.id === m.id)) return;
  await save(p, { models: [...p.models.map(entry), entry(m)] }, `Added ${m.label || m.id}`);
}

function draftBody(p) {
  const d = S.drafts[p.id] || {};
  const body = { id: p.id };
  if (d.key?.trim()) body.apiKey = d.key.trim();
  if (d.baseUrl?.trim() && d.baseUrl.trim().replace(/\/+$/, '') !== p.baseUrl) body.baseUrl = d.baseUrl.trim();
  return body;
}

async function loadList(p, quiet) {
  S.lists[p.id] = { busy: true };
  try {
    const r = await api('/api/ai/models', draftBody(p));
    if (!S) return;
    S.lists[p.id] = r.ok ? { models: r.models } : (quiet ? { models: [], error: r.error } : { error: r.error });
  } catch (err) { if (S) S.lists[p.id] = { error: err.message }; }
  if (S && S.sel === p.id) render();
}

// Connect = test the key/URL, save them, list the models, add a good first model.
async function connect(p) {
  const body = draftBody(p);
  if (p.needsKey && !p.hasKey && !body.apiKey) { S.status[p.id] = { ok: false, text: `Paste your ${p.label} API key first.` }; render(); return; }
  S.status[p.id] = { busy: true };
  render();
  try {
    const r = await api('/api/ai/test', body);
    if (!S) return;
    if (!r.ok) { S.status[p.id] = { ok: false, text: r.error }; render(); return; }
    const patch = {};
    if (body.apiKey) patch.apiKey = body.apiKey;
    if (body.baseUrl) patch.baseUrl = body.baseUrl;
    if (p.custom && S.drafts[p.id]?.name && S.drafts[p.id].name !== p.label) patch.name = S.drafts[p.id].name;
    let added = null;
    if (!p.models.length && r.models.length) {
      const sug = p.suggest || [];
      const usable = r.models.filter((m) => m.tools !== false);
      added = sug.map((s) => usable.find((m) => m.id === s) || usable.find((m) => m.id.startsWith(`${s}:`) || m.id.startsWith(`${s}-`))).find(Boolean)
        || usable.find((m) => m.tools === true) || usable[0] || null;
      if (added) patch.models = [entry(added)];
    }
    if (!p.configured || Object.keys(patch).length) applyData(await api('/api/ai/provider', { id: p.id, ...patch }));
    S.drafts[p.id] = { key: '', baseUrl: prov(p.id).baseUrl, name: prov(p.id).label };
    S.lists[p.id] = { models: r.models };
    const bits = [`Connected in ${(r.ms / 1000).toFixed(1)} s`, `${r.models.length} model${r.models.length === 1 ? '' : 's'}`];
    if (r.account) bits.push(r.account);
    if (added) bits.push(`added ${added.label || added.id} to the menu`);
    S.status[p.id] = { ok: true, text: bits.join(' · ') };
  } catch (err) {
    if (S) S.status[p.id] = { ok: false, text: err.message };
  }
  render();
}

async function probe(p, mid) {
  const id = ref(p.id, mid);
  S.probes[id] = { busy: true };
  render();
  try {
    const r = await api('/api/ai/probe', { id: p.id, model: mid });
    if (!S) return;
    S.probes[id] = r.ok ? { ok: true, tools: r.tools, ms: r.ms } : { ok: false, error: r.error };
    const m = p.models.find((x) => x.id === mid);
    // one test without a tool call is not proof; a "does not support tools" error is
    if (r.ok && m && m.tools !== r.tools && (r.tools || r.definitive)) await save(p, { models: prov(p.id).models.map((x) => (x.id === mid ? { ...entry(x), tools: r.tools } : entry(x))) });
  } catch (err) { if (S) S.probes[id] = { ok: false, error: err.message }; }
  render();
}

async function addCustom() {
  try {
    const r = await api('/api/ai/custom', { name: 'Custom endpoint', baseUrl: '' });
    applyData(r);
    S.sel = r.id;
    S.showAdv[r.id] = true;
  } catch (err) { toastHere(err.message, true); }
  render();
}

function toastHere(text, bad) {
  if (!S) return;
  let t = S.root.querySelector('.ai-toast');
  if (!t) { t = document.createElement('div'); t.className = 'ai-toast'; S.root.querySelector('.ai-dialog').appendChild(t); }
  t.textContent = text;
  t.classList.toggle('bad', !!bad);
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2200);
}
