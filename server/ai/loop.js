// The studio's own agent loop, used for every model that is not run through the
// Claude Agent SDK: send the conversation + tools, stream the text to the chat,
// run the tool calls (read-only ones in parallel), feed the results back, and
// repeat until the model answers. The same tool objects as the SDK path are used
// (built-ins and server/tools/*.js plug-ins), so tools behave identically.
import { resolveProvider, parseModel, modelInfo, learnModel } from './config.js';
import { streamModel, prepare, toolCallsInText, AiError } from './providers.js';
import { jsonSchemaOf, validateArgs } from './schema.js';
import { SYSTEM_PROMPT } from '../prompt.js';

// The core set for small models ("lite" mode): fewer, simpler choices.
const ESSENTIAL = new Set(['get_state', 'look', 'list_objects', 'search_catalog', 'spawn', 'remove', 'move', 'modify', 'build', 'create_pipe',
  'get_terrain', 'probe_floor', 'teleport_mario', 'warp_to_level', 'create_level', 'terrain', 'level_settings', 'add_star', 'undo', 'heal_mario']);
const READ_ONLY = /^(get_|list_|search_|probe_|find_|describe_|inspect_|look$|music_library$)/;
const MAX_RESULT = 20000;

const LOOP_NOTES = `

Using tools
- You change the game only by calling the provided function tools, with JSON arguments that match each tool's schema. Never write a tool call as text, never pretend a tool ran, never make up results.
- Several independent lookups can be called at once. Edits (spawn, build, terrain, ...) one after another.
- If a tool returns an error, read it, fix the arguments and try again (or try another way).
- When you are done, reply in one or two short sentences.`;

const LITE_NOTES = `
- Only the most important tools are available in this mode. Keep requests simple: search_catalog, then spawn; build for blocks and structures; look to check.`;

export function systemPromptFor(cfg) {
  return SYSTEM_PROMPT + LOOP_NOTES + (cfg.lite ? LITE_NOTES : '');
}

export function toolsFor(defs, cfg) {
  return cfg.lite ? defs.filter((d) => ESSENTIAL.has(d.name)) : defs;
}

// User content from index.js (a string, or Anthropic-style blocks with images) -> neutral blocks.
function userBlocks(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return content.map((b) => (b.type === 'image'
    ? { type: 'image', mime: b.source?.media_type || 'image/jpeg', data: b.source?.data || '' }
    : { type: 'text', text: String(b.text ?? '') }));
}

function mcpToBlocks(result) {
  const out = [];
  for (const c of result?.content || []) {
    if (c.type === 'text') out.push({ type: 'text', text: c.text.length > MAX_RESULT ? `${c.text.slice(0, MAX_RESULT)}… (cut, ${c.text.length} characters)` : c.text });
    else if (c.type === 'image' && c.data) out.push({ type: 'image', mime: c.mimeType || 'image/jpeg', data: c.data });
    else out.push({ type: 'text', text: JSON.stringify(c).slice(0, 2000) });
  }
  if (!out.length) out.push({ type: 'text', text: 'ok' });
  return out;
}

const isTurnStart = (m) => m.role === 'user' && m.content.some((b) => b.type !== 'tool_result');
// the current turn starts at the newest user message that is not just tool results
function currentStart(history) {
  for (let i = history.length - 1; i >= 0; i--) if (isTurnStart(history[i])) return i;
  return 0;
}
const GAME_BLOCK = /<game>[\s\S]*?<\/game>\s*/g;

function estimate(history, overhead) {
  let chars = overhead;
  let images = 0;
  for (const m of history) {
    for (const b of m.content) {
      if (b.type === 'image') images++;
      else if (b.type === 'tool_result') for (const c of b.content || []) { if (c.type === 'image') images++; else chars += (c.text || '').length + 20; }
      else if (b.type === 'tool_use') chars += JSON.stringify(b.input || {}).length + 40;
      else chars += (b.text || '').length;
    }
  }
  return Math.round(chars / 3.6) + images * 1600;
}

function digestOf(msgs) {
  const lines = [];
  let tools = [];
  const flush = () => { if (tools.length) { lines.push(`  (used: ${[...new Set(tools)].join(', ')})`); tools = []; } };
  for (const m of msgs) {
    if (isTurnStart(m)) {
      flush();
      const t = m.content.filter((b) => b.type === 'text').map((b) => b.text.replace(GAME_BLOCK, '')).join(' ').replace(/\s+/g, ' ').trim();
      if (t) lines.push(`User: ${t.slice(0, 300)}`);
    } else if (m.role === 'assistant') {
      for (const b of m.content) {
        if (b.type === 'tool_use') tools.push(b.name);
        else if (b.type === 'text' && b.text.trim()) lines.push(`You: ${b.text.replace(/\s+/g, ' ').trim().slice(0, 300)}`);
      }
    }
  }
  flush();
  let s = lines.join('\n');
  if (s.length > 6000) s = `…\n${s.slice(-6000)}`;
  return s;
}

// Keep the conversation inside the model's context: shorten old tool results,
// then fold the oldest turns into a short written summary.
export function compact(history, budget, overhead, turnStart) {
  if (estimate(history, overhead) <= budget) return history;
  for (let i = 0; i < Math.min(turnStart, history.length); i++) {
    for (const b of history[i].content) {
      if (b.type === 'text' && i < turnStart) b.text = b.text.replace(GAME_BLOCK, '');
      if (b.type === 'tool_result') {
        b.content = (b.content || []).map((c) => (c.type === 'image' ? { type: 'text', text: '[screenshot]' }
          : c.text?.length > 500 ? { type: 'text', text: `${c.text.slice(0, 500)}… (cut)` } : c));
      }
    }
  }
  if (estimate(history, overhead) <= budget) return history;
  const starts = history.map((m, i) => (isTurnStart(m) ? i : -1)).filter((i) => i >= 0);
  let cut = 0;
  for (const s of starts) {
    if (s >= turnStart) break;
    cut = s;
    if (estimate(history.slice(s), overhead + 2000) <= budget) break;
  }
  const lastStart = starts.filter((s) => s <= turnStart).pop() ?? 0;
  if (estimate(history.slice(cut), overhead) > budget) cut = lastStart;
  if (cut > 0) {
    const digest = digestOf(history.slice(0, cut));
    const kept = history.slice(cut);
    kept[0] = { ...kept[0], content: [{ type: 'text', text: `Summary of the earlier conversation (older messages were folded to save space):\n${digest}` }, ...kept[0].content] };
    history.splice(0, history.length, ...kept);
  }
  // still too big: a long tool loop inside this turn; shrink its older results
  if (estimate(history, overhead) > budget) {
    let seenImage = false;
    for (let i = history.length - 1; i >= 0; i--) {
      for (const b of history[i].content) {
        if (b.type !== 'tool_result') continue;
        b.content = (b.content || []).map((c) => {
          if (c.type === 'image') { if (seenImage) return { type: 'text', text: '[older screenshot]' }; seenImage = true; return c; }
          return c.text?.length > 1500 && i < history.length - 2 ? { type: 'text', text: `${c.text.slice(0, 1500)}… (cut)` } : c;
        });
      }
    }
  }
  return history;
}

// Images are not kept between turns (the project file would grow fast).
function stripImages(history) {
  for (const m of history) {
    m.content = m.content.map((b) => {
      if (b.type === 'image') return { type: 'text', text: '[the user attached a picture here]' };
      if (b.type === 'tool_result' && b.content?.some((c) => c.type === 'image')) {
        return { ...b, content: b.content.map((c) => (c.type === 'image' ? { type: 'text', text: '[screenshot]' } : c)) };
      }
      return b;
    });
  }
}

// Every tool_use needs a tool_result before the next request.
function closeOpenCalls(history, reason) {
  const last = history[history.length - 1];
  if (last?.role !== 'assistant') return;
  const calls = last.content.filter((b) => b.type === 'tool_use');
  if (calls.length) history.push({ role: 'user', content: calls.map((c) => ({ type: 'tool_result', id: c.id, name: c.name, content: [{ type: 'text', text: reason }], isError: true })) });
}

// Make the stored history valid for any provider (alternating roles, no
// dangling calls), e.g. after a crash or a server restart mid-turn.
function repairHistory(history) {
  const out = [];
  for (const m of history) {
    if (!m?.content?.length) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === 'assistant' && prev.content.some((b) => b.type === 'tool_use') && !(m.role === 'user' && m.content.some((b) => b.type === 'tool_result'))) {
      closeOpenCalls(out, 'not run (interrupted)');
    }
    const p2 = out[out.length - 1];
    if (p2 && p2.role === m.role) { p2.content = [...p2.content, ...m.content]; continue; }
    out.push(m);
  }
  closeOpenCalls(out, 'not run (interrupted)');
  if (out[0]?.role === 'assistant') out.unshift({ role: 'user', content: [{ type: 'text', text: '(conversation start)' }] });
  return out;
}

const sleep = (ms, signal) => new Promise((ok, fail) => {
  const t = setTimeout(ok, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); fail(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
});

export class LoopSession {
  constructor(agent) {
    this.agent = agent;
    this.ctl = null;
    this.stopped = false;
  }

  abort() {
    this.stopped = true;
    try { this.ctl?.abort(); } catch { /* ignore */ }
  }

  // One model call, retried on rate limits / overload / network hiccups as long as
  // nothing was streamed to the chat yet.
  async call(cfg, req, streamed) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await streamModel(cfg, req);
      } catch (err) {
        if (err.name === 'AbortError' || this.stopped) throw err;
        const retryable = ['ratelimit', 'server', 'network'].includes(err.code) && !streamed();
        if (!retryable || attempt >= 2) throw err;
        await sleep(Math.min(20000, (err.retryAfter || 0) * 1000 || (attempt ? 4000 : 1500)), req.signal);
      }
    }
  }

  async run(content) {
    const agent = this.agent;
    const p = agent.project;
    const t0 = Date.now();
    this.stopped = false;
    this.ctl = new AbortController();
    const signal = this.ctl.signal;
    let cost = 0;
    let hasCost = false;
    let error = null;
    const notices = [];
    let history = null;
    try {
      const pm = parseModel(agent.model);
      const cfg = pm && resolveProvider(pm.provider);
      if (!cfg) throw new AiError(`The model ${agent.model} belongs to a provider that is not set up. Open AI settings from the model menu.`);
      if (!cfg.baseUrl) throw new AiError(`${cfg.label} has no base URL. Set it in AI settings.`);
      if (!cfg.local && !cfg.preset.custom && !cfg.apiKey) {
        throw new AiError(`Add your ${cfg.label} API key in AI settings${cfg.preset.env?.length ? ` (or set ${cfg.preset.env[0]})` : ''}.`);
      }
      const info = modelInfo(agent.model) || {};
      let useTools = info.tools !== false;
      let useImages = info.vision !== false && cfg.preset.vision !== false;
      const defs = toolsFor(agent.toolDefs || [], cfg);
      const flavor = cfg.flavor === 'gemini' ? 'gemini' : 'openai';
      const specs = defs.map((d) => ({ name: d.name, description: d.description, parameters: jsonSchemaOf(d, { flavor }) }));
      // arguments are repaired against the full schema (the Gemini one is simplified)
      const byName = new Map(defs.map((d, i) => [d.name, { def: d, schema: flavor === 'openai' ? specs[i].parameters : jsonSchemaOf(d) }]));
      const toolNames = new Set(byName.keys());
      const system = systemPromptFor(cfg);
      const overhead = system.length + JSON.stringify(specs).length;
      const ctxTokens = Math.min(cfg.contextTokens, info.context || Infinity);
      const budget = Math.max(6000, ctxTokens * 0.8 - 8192);

      history = repairHistory(p.aiHistory || []);
      p.aiHistory = history;
      const turnStart = history.length;
      history.push({ role: 'user', content: userBlocks(content) });
      if (!useImages && history[turnStart].content.some((b) => b.type === 'image')) notices.push('This model can\'t see pictures, so it only got your text.');

      let streamedThisCall = false;
      const onText = (t) => { streamedThisCall = true; agent.onStream({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } }); };
      const onTextEnd = () => agent.onStream({ type: 'content_block_stop' });
      const onThinking = () => agent.onStream({ type: 'content_block_delta', delta: { type: 'thinking_delta' } });

      for (let step = 0; ; step++) {
        if (this.stopped) break;
        if (step >= cfg.maxTurns) { error = `Stopped after ${cfg.maxTurns} steps (the limit in AI settings).`; break; }
        compact(history, budget, overhead, currentStart(history));
        const req = {
          model: pm.model, system, tools: useTools ? specs : [], signal, onText, onTextEnd, onThinking,
          messages: prepare(history, { tools: useTools, images: useImages }),
          turnStart: currentStart(history),
        };
        streamedThisCall = false;
        let r;
        try {
          r = await this.call(cfg, req, () => streamedThisCall);
        } catch (err) {
          if (err.name === 'AbortError' || this.stopped) break;
          if (err.code === 'notools' && useTools && !streamedThisCall) {
            useTools = false;
            learnModel(agent.model, { tools: false });
            notices.push(`${pm.model} can't use tools, so it can only talk here. Pick a model with tool support to edit the level.`);
            step--;
            continue;
          }
          if (err.code === 'noimages' && useImages && !streamedThisCall) {
            useImages = false;
            learnModel(agent.model, { vision: false });
            notices.push('This model can\'t see images (screenshots and pictures were left out).');
            step--;
            continue;
          }
          throw err;
        }
        if (typeof r.usage?.cost === 'number') { cost += r.usage.cost; hasCost = true; }
        let blocks = r.content;
        if (useTools && !blocks.some((b) => b.type === 'tool_use')) {
          const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
          const found = toolCallsInText(text, toolNames);
          if (found.length) blocks = [...blocks, ...found];
        }
        if (!blocks.length) {
          if (r.stop === 'length') { error = 'The model ran out of output tokens.'; break; }
          history.push({ role: 'assistant', content: [{ type: 'text', text: '(no reply)' }] });
          break;
        }
        history.push({ role: 'assistant', content: blocks, reasoning: r.reasoning, reasoningDetails: r.reasoningDetails });
        const calls = blocks.filter((b) => b.type === 'tool_use');
        if (!calls.length) {
          if (r.stop === 'length') error = 'The answer was cut off (the model hit its output limit).';
          break;
        }
        const results = await this.runTools(calls, byName);
        history.push({ role: 'user', content: results });
        if (this.stopped) break;
      }
      if (this.stopped) closeOpenCalls(history, 'stopped by the user');
    } catch (err) {
      if (err.name !== 'AbortError') {
        error = err instanceof AiError ? err.message : `Something went wrong: ${err?.message || err}`;
        if (!(err instanceof AiError)) console.error('[ai loop]', err);
      }
      if (history) closeOpenCalls(history, 'not run (error)');
    }
    if (history) {
      stripImages(history);
      compact(history, 60000, 0, history.length); // keep the project file small
      p.aiHistory = history;
    }
    if (notices.length) {
      agent.onStream({ type: 'content_block_stop' });
      agent.onStream({ type: 'content_block_delta', delta: { type: 'text_delta', text: `\n\n*${notices.join(' ')}*` } });
    }
    this.ctl = null;
    if (this.stopped && !error) error = 'Stopped.';
    agent.finishTurn({ subtype: error ? 'error' : 'success', errors: error ? [error] : undefined, total_cost_usd: hasCost ? cost : undefined, duration_ms: Date.now() - t0 });
  }

  async runTools(calls, byName) {
    const results = new Array(calls.length);
    const runOne = async (c, i) => {
      if (this.stopped) { results[i] = { type: 'tool_result', id: c.id, name: c.name, content: [{ type: 'text', text: 'stopped by the user' }], isError: true }; return; }
      const entry = byName.get(c.name);
      if (!entry) {
        results[i] = { type: 'tool_result', id: c.id, name: c.name, isError: true,
          content: [{ type: 'text', text: `Error: there is no tool "${c.name}". Available tools: ${[...byName.keys()].join(', ')}.` }] };
        return;
      }
      const v = validateArgs(entry.def, c.input, entry.schema);
      if (!v.ok) {
        results[i] = { type: 'tool_result', id: c.id, name: c.name, isError: true, content: [{ type: 'text', text: `Error: ${v.error}. Fix the arguments and call it again.` }] };
        return;
      }
      if (typeof c.input !== 'object' || c.input === null) c.input = v.args; // keep the history's arguments as JSON
      let out;
      try {
        out = await entry.def.handler(v.args, { signal: this.ctl?.signal });
      } catch (err) {
        out = { content: [{ type: 'text', text: `Error: ${err?.message || err}` }], isError: true };
      }
      results[i] = { type: 'tool_result', id: c.id, name: c.name, content: mcpToBlocks(out), isError: !!out?.isError || undefined };
    };
    // consecutive read-only calls run together, edits one after another in order
    let i = 0;
    while (i < calls.length) {
      const ro = (c) => READ_ONLY.test(c.name) || byName.get(c.name)?.def.annotations?.readOnlyHint;
      if (ro(calls[i])) {
        let j = i;
        while (j < calls.length && ro(calls[j])) j++;
        await Promise.all(calls.slice(i, j).map((c, k) => runOne(c, i + k)));
        i = j;
      } else {
        await runOne(calls[i], i);
        i++;
      }
    }
    return results;
  }
}

// When the chat switches between the SDK and the loop, each side gets a short
// transcript of what happened on the other side since it last ran.
export function handoffNote(project, key) {
  // called right after this turn's user message was added: that one is not "earlier"
  const end = project.chat.length - 1;
  const from = project[key] ?? (key === 'sdkSync' ? end : 0);
  const missed = project.chat.slice(Math.max(0, from), end);
  if (!missed.length) return '';
  const lines = [];
  for (const e of missed.slice(-16)) {
    if (e.role === 'user') lines.push(`User: ${String(e.text || '').slice(0, 300)}`);
    else {
      const text = (e.parts || []).filter((x) => x.type === 'text').map((x) => x.text).join(' ').replace(/\s+/g, ' ').trim();
      const tools = (e.parts || []).filter((x) => x.type === 'tool' && x.state === 'done').map((x) => x.summary || x.label);
      lines.push(`Assistant${e.model ? ` (${e.model})` : ''}: ${text.slice(0, 300)}${tools.length ? ` [did: ${tools.slice(0, 8).join('; ')}]` : ''}`);
    }
  }
  return `<earlier_chat>Earlier in this chat (handled by another AI model; the edits it made are in the game):\n${lines.join('\n')}</earlier_chat>\n\n`;
}
