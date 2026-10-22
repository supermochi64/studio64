// Provider adapters for the studio's own agent loop (everything except the
// Claude Agent SDK path): the Anthropic Messages API, any OpenAI-compatible
// Chat Completions server (OpenAI, OpenRouter, Gemini, Groq, Together,
// DeepSeek, Mistral, xAI, LM Studio, llama.cpp, vLLM, custom) and Ollama's
// native API. Each adapter streams one model response and returns it in the
// loop's neutral message format:
//   user:      [{type:'text',text} | {type:'image',mime,data} | {type:'tool_result',id,name,content:[text|image],isError}]
//   assistant: [{type:'text',text} | {type:'tool_use',id,name,input,extra?}]  (+ reasoning, reasoningDetails)

export class AiError extends Error {
  constructor(message, { code = 'error', status = 0, retryAfter = 0, detail = '' } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
    this.detail = detail;
  }
}

const NO_TOOLS = /(does not|doesn't|do not|not) support (tools|tool use|function|tool calling)|no endpoints found that support tool|tool(s)? (is|are) not supported|tool_choice.*not supported|function calling is not (enabled|supported)|"tools" is not|unrecognized.*tools|tools.*not available|enable-auto-tool-choice|--jinja/i;
const NO_IMAGES = /(does not|doesn't|not) support (image|vision|multimodal)|image input|no endpoints found that support image|image_url.*(not|unsupported)|vision is not|cannot read .*image|images are not supported|unknown variant `image_url`|invalid content type.*image|expected.*string.*content/i;
const CONTEXT = /context (length|window)|maximum context|too many tokens|prompt is too long|reduce the length|exceeds the (maximum|context)|input is too long|num_ctx/i;

// An HTTP error in words a user (and the retry logic) can use.
export function classify(status, body, cfg, model) {
  let msg = '';
  try {
    const j = JSON.parse(body);
    msg = j.error?.message || j.error?.metadata?.raw || (typeof j.error === 'string' ? j.error : '') || j.message || j.detail || '';
    if (j.error?.metadata?.raw && j.error.message && !msg.includes(j.error.metadata.raw)) msg = `${j.error.message}: ${j.error.metadata.raw}`;
  } catch { msg = String(body || '').slice(0, 300); }
  msg = String(msg).replace(/\s+/g, ' ').trim().slice(0, 400);
  const who = cfg.label;
  if (NO_TOOLS.test(msg)) return new AiError(`${model} can't use tools on ${who}.`, { code: 'notools', status, detail: msg });
  if (NO_IMAGES.test(msg)) return new AiError(`${model} can't look at images.`, { code: 'noimages', status, detail: msg });
  if (CONTEXT.test(msg)) return new AiError(`The conversation is too long for ${model}. Start a new chat or pick a model with a bigger context.`, { code: 'context', status, detail: msg });
  if (status === 401 || status === 403) {
    return new AiError(`${who} rejected the API key (${status}). Check it in AI settings.${msg ? ` (${msg})` : ''}`, { code: 'auth', status, detail: msg });
  }
  if (status === 402 || /insufficient (credit|balance|quota|funds)|credit balance|billing|exceeded your current quota|payment required/i.test(msg)) {
    return new AiError(`${who} says the account is out of credits or quota.${msg ? ` (${msg})` : ''}`, { code: 'credits', status, detail: msg });
  }
  if (status === 404 || /model.*(not found|does not exist|not exist|unknown)|no such model|invalid model|not a valid model/i.test(msg)) {
    return new AiError(`${who} doesn't know the model “${model}”. Pick another one in AI settings.${msg ? ` (${msg})` : ''}`, { code: 'notfound', status, detail: msg });
  }
  if (status === 429 || /rate.?limit|too many requests|overloaded/i.test(msg)) {
    return new AiError(`${who} is rate limiting or overloaded right now. Wait a moment and try again.${msg ? ` (${msg})` : ''}`, { code: 'ratelimit', status, detail: msg });
  }
  if (status >= 500) return new AiError(`${who} had a server error (${status}).${msg ? ` ${msg}` : ''}`, { code: 'server', status, detail: msg });
  return new AiError(`${who}: ${msg || `HTTP ${status}`}`, { code: 'bad', status, detail: msg });
}

function networkError(err, cfg) {
  if (err?.name === 'AbortError') return err;
  if (err instanceof AiError) return err;
  const c = err?.cause?.code || err?.code || '';
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|ETIMEDOUT|UND_ERR/.test(c) || /fetch failed/.test(err?.message)) {
    const hint = cfg.local ? ' Is it running?' : '';
    return new AiError(`Can't reach ${cfg.label} at ${cfg.baseUrl} (${c || err.message}).${hint}`, { code: 'network' });
  }
  return new AiError(`${cfg.label}: ${err?.message || err}`, { code: 'network' });
}

async function post(cfg, url, headers, body, signal) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (err) { throw networkError(err, cfg); }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const e = classify(res.status, text, cfg, body.model);
    e.retryAfter = Number(res.headers.get('retry-after')) || 0;
    throw e;
  }
  return res;
}

async function get(cfg, url, headers, signal) {
  let res;
  try { res = await fetch(url, { headers, signal: signal || AbortSignal.timeout(15000) }); } catch (err) { throw networkError(err, cfg); }
  if (!res.ok) throw classify(res.status, await res.text().catch(() => ''), cfg, '');
  return res.json();
}

// Server-sent events: yields each `data:` payload (parsed JSON), plus its event name.
async function* sse(res) {
  const decoder = new TextDecoder();
  let buf = '';
  let event = null;
  let data = [];
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line === '') {
        if (data.length) {
          const payload = data.join('\n');
          data = [];
          if (payload === '[DONE]') return;
          let obj;
          try { obj = JSON.parse(payload); } catch { obj = null; }
          if (obj) yield { event, data: obj };
        }
        event = null;
      } else if (line.startsWith(':')) {
        // comment / keep-alive (OpenRouter sends ": OPENROUTER PROCESSING")
      } else if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''));
      }
    }
  }
  if (data.length && data.join('\n') !== '[DONE]') {
    try { yield { event, data: JSON.parse(data.join('\n')) }; } catch { /* partial */ }
  }
}

async function* ndjson(res) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) { try { yield JSON.parse(line); } catch { /* skip */ } }
    }
  }
  if (buf.trim()) { try { yield JSON.parse(buf); } catch { /* skip */ } }
}

// ---- shared history helpers -------------------------------------------------

const IMG_GONE = '[image omitted: this model cannot see images]';

function toolResultText(block) {
  const t = (block.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const imgs = (block.content || []).filter((c) => c.type === 'image').length;
  return (t || (imgs ? '' : 'ok')) + (imgs ? `${t ? '\n' : ''}[${imgs} image${imgs > 1 ? 's' : ''} attached below]` : '');
}

// Without tools the history's tool calls/results become plain text.
function flattenTools(messages) {
  return messages.map((m) => {
    if (!m.content.some((b) => b.type === 'tool_use' || b.type === 'tool_result')) return m;
    return {
      ...m,
      content: m.content.map((b) => {
        if (b.type === 'tool_use') return { type: 'text', text: `[used the tool ${b.name} ${JSON.stringify(b.input).slice(0, 300)}]` };
        if (b.type === 'tool_result') return { type: 'text', text: `[${b.name || 'tool'} result: ${toolResultText(b).slice(0, 600)}]` };
        return b;
      }),
    };
  });
}

function dropImages(messages) {
  return messages.map((m) => ({
    ...m,
    content: m.content.map((b) => {
      if (b.type === 'image') return { type: 'text', text: IMG_GONE };
      if (b.type === 'tool_result' && b.content?.some((c) => c.type === 'image')) {
        return { ...b, content: [...b.content.filter((c) => c.type !== 'image'), { type: 'text', text: '[screenshot omitted: this model cannot see images]' }] };
      }
      return b;
    }),
  }));
}

export function prepare(messages, { tools, images }) {
  let out = messages;
  if (!tools) out = flattenTools(out);
  if (!images) out = dropImages(out);
  return out;
}

// Some models (or servers without a tool-call parser) write tool calls as text.
const TEXT_CALL = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>|```(?:json)?\s*(\{\s*"name"\s*:[\s\S]*?\})\s*```/g;
export function toolCallsInText(text, toolNames) {
  const calls = [];
  for (const m of String(text || '').matchAll(TEXT_CALL)) {
    try {
      const j = JSON.parse(m[1] || m[2]);
      const name = j.name || j.function?.name;
      if (!toolNames.has(name)) continue;
      let args = j.arguments ?? j.parameters ?? j.function?.arguments ?? {};
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
      calls.push({ type: 'tool_use', id: `text_${Math.random().toString(36).slice(2, 10)}`, name, input: args });
    } catch { /* not a call */ }
  }
  return calls;
}

// ---- Anthropic Messages API ---------------------------------------------------

function anthropicMessages(messages) {
  const out = messages.map((m) => ({
    role: m.role,
    content: m.content.map((b) => {
      if (b.type === 'text') return { type: 'text', text: b.text || ' ' };
      if (b.type === 'image') return { type: 'image', source: { type: 'base64', media_type: b.mime, data: b.data } };
      if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input || {} };
      if (b.type === 'tool_result') {
        return { type: 'tool_result', tool_use_id: b.id, is_error: b.isError || undefined,
          content: (b.content || []).map((c) => (c.type === 'image'
            ? { type: 'image', source: { type: 'base64', media_type: c.mime, data: c.data } }
            : { type: 'text', text: c.text || ' ' })) };
      }
      return { type: 'text', text: String(b.text || '') };
    }),
  }));
  // a rolling prompt-cache breakpoint on the newest block keeps tool loops cheap
  const last = out[out.length - 1]?.content.at(-1);
  if (last) last.cache_control = { type: 'ephemeral' };
  return out;
}

async function streamAnthropic(cfg, req) {
  const body = {
    model: req.model,
    max_tokens: req.maxTokens || 8192,
    system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
    messages: anthropicMessages(req.messages),
    stream: true,
  };
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    body.tools.at(-1).cache_control = { type: 'ephemeral' };
  }
  const res = await post(cfg, `${cfg.baseUrl}/v1/messages`, {
    'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', ...cfg.headers,
  }, body, req.signal);
  const blocks = [];
  let stop = null;
  const usage = { input: 0, output: 0 };
  for await (const { data: ev } of sse(res)) {
    if (ev.type === 'message_start') {
      usage.input = (ev.message?.usage?.input_tokens || 0) + (ev.message?.usage?.cache_read_input_tokens || 0) + (ev.message?.usage?.cache_creation_input_tokens || 0);
    } else if (ev.type === 'content_block_start') {
      const cb = ev.content_block;
      if (cb.type === 'text') blocks[ev.index] = { type: 'text', text: '' };
      else if (cb.type === 'tool_use') blocks[ev.index] = { type: 'tool_use', id: cb.id, name: cb.name, json: '' };
      else blocks[ev.index] = { type: 'skip' };
      if (cb.type === 'thinking' || cb.type === 'redacted_thinking') req.onThinking?.();
    } else if (ev.type === 'content_block_delta') {
      const b = blocks[ev.index];
      if (ev.delta.type === 'text_delta' && b) { b.text += ev.delta.text; req.onText?.(ev.delta.text); } else if (ev.delta.type === 'input_json_delta' && b) b.json += ev.delta.partial_json;
      else if (ev.delta.type === 'thinking_delta') req.onThinking?.();
    } else if (ev.type === 'content_block_stop') {
      const b = blocks[ev.index];
      if (b?.type === 'text') req.onTextEnd?.();
    } else if (ev.type === 'message_delta') {
      stop = ev.delta?.stop_reason || stop;
      usage.output = ev.usage?.output_tokens || usage.output;
    } else if (ev.type === 'error') {
      throw classify(ev.error?.type === 'overloaded_error' ? 529 : 500, JSON.stringify(ev), cfg, req.model);
    }
  }
  const content = [];
  for (const b of blocks) {
    if (!b || b.type === 'skip') continue;
    if (b.type === 'text') { if (b.text) content.push({ type: 'text', text: b.text }); continue; }
    let input = {};
    try { input = b.json ? JSON.parse(b.json) : {}; } catch { input = b.json; }
    content.push({ type: 'tool_use', id: b.id, name: b.name, input });
  }
  return { content, stop: stop === 'max_tokens' ? 'length' : stop, usage };
}

// ---- OpenAI-compatible Chat Completions -------------------------------------------

function openaiMessages(cfg, system, messages, turnStart) {
  const out = [{ role: 'system', content: system }];
  messages.forEach((m, idx) => {
    if (m.role === 'assistant') {
      const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const calls = m.content.filter((b) => b.type === 'tool_use');
      const msg = { role: 'assistant', content: text || (calls.length ? '' : ' ') };
      if (calls.length) {
        msg.tool_calls = calls.map((c) => ({
          id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
          ...(c.extra ? { extra_content: c.extra } : {}),
        }));
      }
      if (m.reasoningDetails?.length && cfg.id === 'openrouter') msg.reasoning_details = m.reasoningDetails;
      // DeepSeek's thinking mode wants its reasoning back while a tool loop is running
      if (cfg.flavor === 'deepseek' && m.reasoning && idx >= turnStart) msg.reasoning_content = m.reasoning;
      out.push(msg);
      return;
    }
    const results = m.content.filter((b) => b.type === 'tool_result');
    const rest = m.content.filter((b) => b.type !== 'tool_result');
    const looseImages = [];
    for (const r of results) {
      out.push({ role: 'tool', tool_call_id: r.id, content: toolResultText(r) });
      for (const c of r.content || []) if (c.type === 'image') looseImages.push(c);
    }
    const parts = [];
    if (looseImages.length) parts.push({ type: 'text', text: 'Images returned by the tools above:' });
    for (const im of looseImages) parts.push({ type: 'image_url', image_url: { url: `data:${im.mime};base64,${im.data}` } });
    for (const b of rest) {
      if (b.type === 'text') parts.push({ type: 'text', text: b.text });
      else if (b.type === 'image') parts.push({ type: 'image_url', image_url: { url: `data:${b.mime};base64,${b.data}` } });
    }
    if (!parts.length) return;
    // text-only messages as a plain string: some local servers only take strings
    const textOnly = parts.every((p) => p.type === 'text');
    out.push({ role: 'user', content: textOnly ? parts.map((p) => p.text).join('\n\n') : parts });
  });
  return out;
}

function mergeReasoningDetails(acc, list) {
  for (const d of list || []) {
    const i = d.index ?? acc.length;
    const cur = acc.find((x) => x.index === i && x.type === d.type);
    if (!cur) { acc.push({ ...d, index: i }); continue; }
    for (const k of ['text', 'summary', 'data']) if (typeof d[k] === 'string') cur[k] = (cur[k] || '') + d[k];
    if (d.signature) cur.signature = d.signature;
    if (d.id) cur.id = d.id;
    if (d.format) cur.format = d.format;
  }
}

async function streamOpenAI(cfg, req) {
  const body = { model: req.model, messages: openaiMessages(cfg, req.system, req.messages, req.turnStart ?? 0), stream: true };
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => {
      // Gemini wants no-argument functions without a parameters object
      const empty = cfg.flavor === 'gemini' && !Object.keys(t.parameters?.properties || {}).length;
      return { type: 'function', function: { name: t.name, description: t.description, ...(empty ? {} : { parameters: t.parameters }) } };
    });
    body.tool_choice = 'auto';
  }
  if (cfg.usage) body.stream_options = { include_usage: true };
  if (cfg.id === 'openrouter') body.usage = { include: true };
  if (cfg.local) body.max_tokens = 4096; // some local servers default to a tiny limit
  const headers = { ...cfg.headers };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  const res = await post(cfg, `${cfg.baseUrl}/chat/completions`, headers, body, req.signal);

  let text = '';
  let reasoning = '';
  const reasoningDetails = [];
  const calls = [];
  let stop = null;
  const usage = { input: 0, output: 0 };
  let inText = false;
  const handle = (choice) => {
    const d = choice.delta || choice.message || {};
    if (typeof d.content === 'string' && d.content) {
      text += d.content;
      inText = true;
      req.onText?.(d.content);
    }
    const r = d.reasoning_content ?? d.reasoning;
    if (typeof r === 'string' && r) { reasoning += r; req.onThinking?.(); }
    if (d.reasoning_details) mergeReasoningDetails(reasoningDetails, d.reasoning_details);
    for (const tc of d.tool_calls || []) {
      if (inText) { req.onTextEnd?.(); inText = false; }
      const i = tc.index ?? calls.length;
      calls[i] ||= { id: '', name: '', args: '', extra: null };
      const c = calls[i];
      if (tc.id) c.id = tc.id;
      if (tc.function?.name) c.name += tc.function.name;
      if (tc.function?.arguments !== undefined) c.args += typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments);
      if (tc.extra_content) c.extra = tc.extra_content;
    }
    if (choice.finish_reason) stop = choice.finish_reason;
  };
  if (/application\/json/.test(res.headers.get('content-type') || '')) {
    const j = await res.json(); // a server that ignored stream:true
    if (j.error) throw classify(500, JSON.stringify(j), cfg, req.model);
    for (const ch of j.choices || []) handle(ch);
    if (j.usage) { usage.input = j.usage.prompt_tokens || 0; usage.output = j.usage.completion_tokens || 0; usage.cost = j.usage.cost; }
  } else {
    for await (const { data: ch } of sse(res)) {
      if (ch.error) throw classify(Number(ch.error.code) || 500, JSON.stringify(ch), cfg, req.model);
      for (const choice of ch.choices || []) handle(choice);
      if (ch.usage) {
        usage.input = ch.usage.prompt_tokens || usage.input;
        usage.output = ch.usage.completion_tokens || usage.output;
        if (typeof ch.usage.cost === 'number') usage.cost = ch.usage.cost;
      }
    }
  }
  if (inText) req.onTextEnd?.();
  const content = [];
  if (text) content.push({ type: 'text', text });
  calls.filter(Boolean).forEach((c, i) => {
    if (!c.name) return;
    let input = {};
    if (c.args.trim()) { try { input = JSON.parse(c.args); } catch { input = c.args; } }
    content.push({ type: 'tool_use', id: c.id || `call_${Date.now().toString(36)}_${i}`, name: c.name, input, extra: c.extra || undefined });
  });
  return { content, stop: stop === 'tool_calls' ? 'tool_use' : stop, usage, reasoning: reasoning || undefined, reasoningDetails: reasoningDetails.length ? reasoningDetails : undefined };
}

// ---- Ollama (native /api/chat: lets us set the context size) ------------------------

function ollamaMessages(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'assistant') {
      const calls = m.content.filter((b) => b.type === 'tool_use');
      out.push({
        role: 'assistant', content: m.content.filter((b) => b.type === 'text').map((b) => b.text).join(''),
        ...(calls.length ? { tool_calls: calls.map((c) => ({ function: { name: c.name, arguments: typeof c.input === 'object' ? c.input : {} } })) } : {}),
      });
      continue;
    }
    const images = [];
    for (const r of m.content.filter((b) => b.type === 'tool_result')) {
      out.push({ role: 'tool', tool_name: r.name, content: toolResultText(r) });
      for (const c of r.content || []) if (c.type === 'image') images.push(c.data);
    }
    const texts = m.content.filter((b) => b.type === 'text').map((b) => b.text);
    for (const b of m.content) if (b.type === 'image') images.push(b.data);
    if (texts.length || images.length) {
      out.push({ role: 'user', content: texts.join('\n\n') || 'Images returned by the tools above:', ...(images.length ? { images } : {}) });
    }
  }
  return out;
}

async function streamOllama(cfg, req) {
  const body = {
    model: req.model, messages: ollamaMessages(req.system, req.messages), stream: true,
    options: { num_ctx: cfg.contextTokens || 32768 },
  };
  if (req.tools?.length) body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const res = await post(cfg, `${cfg.baseUrl}/api/chat`, cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}, body, req.signal);
  let text = '';
  const calls = [];
  let stop = null;
  const usage = { input: 0, output: 0 };
  let inText = false;
  for await (const ch of ndjson(res)) {
    if (ch.error) throw classify(500, JSON.stringify(ch), cfg, req.model);
    const m = ch.message || {};
    if (m.thinking) req.onThinking?.();
    if (m.content) { text += m.content; inText = true; req.onText?.(m.content); }
    for (const tc of m.tool_calls || []) {
      if (inText) { req.onTextEnd?.(); inText = false; }
      calls.push({ type: 'tool_use', id: `ollama_${calls.length}_${Date.now().toString(36)}`, name: tc.function?.name, input: tc.function?.arguments || {} });
    }
    if (ch.done) {
      stop = ch.done_reason || 'stop';
      usage.input = ch.prompt_eval_count || 0;
      usage.output = ch.eval_count || 0;
    }
  }
  if (inText) req.onTextEnd?.();
  const content = [];
  if (text) content.push({ type: 'text', text });
  content.push(...calls.filter((c) => c.name));
  return { content, stop: calls.length ? 'tool_use' : stop, usage };
}

export function streamModel(cfg, req) {
  if (cfg.kind === 'anthropic') return streamAnthropic(cfg, req);
  if (cfg.kind === 'ollama') return streamOllama(cfg, req);
  return streamOpenAI(cfg, req);
}

// ---- model lists ------------------------------------------------------------------------

const NOT_CHAT = /embed|tts|whisper|dall-e|davinci|babbage|moderation|transcribe|realtime|audio|image-|imagen|veo|sora|aqa|guard|rerank|computer-use|-search-|omni-moderation|lyria|^text-|learnlm/i;

export async function listModels(cfg) {
  if (cfg.kind === 'anthropic') {
    const j = await get(cfg, `${cfg.baseUrl}/v1/models?limit=100`, { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' });
    return (j.data || []).map((m) => ({ id: m.id, label: m.display_name, tools: true, vision: true }));
  }
  if (cfg.kind === 'ollama') {
    const j = await get(cfg, `${cfg.baseUrl}/api/tags`, {});
    const list = (j.models || []).map((m) => ({ id: m.name || m.model, size: m.size, label: m.name }));
    await Promise.all(list.slice(0, 40).map(async (m) => {
      try {
        const r = await fetch(`${cfg.baseUrl}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: m.id }), signal: AbortSignal.timeout(5000) });
        const s = await r.json();
        if (Array.isArray(s.capabilities)) { m.tools = s.capabilities.includes('tools'); m.vision = s.capabilities.includes('vision'); }
        const ctx = Object.entries(s.model_info || {}).find(([k]) => k.endsWith('.context_length'));
        if (ctx) m.context = ctx[1];
      } catch { /* old ollama */ }
    }));
    return list;
  }
  const headers = { ...cfg.headers };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  const j = await get(cfg, `${cfg.baseUrl}/models`, headers);
  const raw = Array.isArray(j) ? j : (j.data || j.models || []);
  // text-out chat models only (OpenRouter also lists image/audio generators)
  return raw.filter((m) => !(m.architecture?.output_modalities && !m.architecture.output_modalities.includes('text'))).map((m) => {
    const id = String(m.id || m.name || '').replace(/^models\//, '');
    const out = { id, label: m.name && m.name !== id && cfg.id === 'openrouter' ? m.name.replace(/^[^:]+:\s*/, '') : undefined };
    if (m.supported_parameters) out.tools = m.supported_parameters.includes('tools');
    if (m.architecture?.input_modalities) out.vision = m.architecture.input_modalities.includes('image');
    if (m.capabilities && typeof m.capabilities === 'object') {
      if ('function_calling' in m.capabilities) out.tools = !!m.capabilities.function_calling;
      if ('vision' in m.capabilities) out.vision = !!m.capabilities.vision;
    }
    if (m.context_length || m.max_context_length) out.context = m.context_length || m.max_context_length;
    if (m.pricing?.prompt !== undefined) out.price = [Number(m.pricing.prompt) * 1e6, Number(m.pricing.completion) * 1e6];
    if (m.created) out.created = m.created;
    return out;
  }).filter((m) => m.id && !NOT_CHAT.test(m.id) && !m.id.endsWith(':batch'));
}

// Is the key good / the server up? (OpenRouter's /models is public, so ask /key.)
export async function checkConnection(cfg) {
  const t0 = Date.now();
  if (!cfg.baseUrl) throw new AiError('Set the base URL first.', { code: 'bad' });
  if (!cfg.local && !cfg.apiKey && !cfg.preset?.custom) throw new AiError(`Add your ${cfg.label} API key first.`, { code: 'auth' });
  let account = null;
  if (cfg.id === 'openrouter') {
    const j = await get(cfg, `${cfg.baseUrl}/key`, { authorization: `Bearer ${cfg.apiKey}` });
    const d = j.data || {};
    const left = d.limit_remaining ?? (d.limit != null ? d.limit - (d.usage || 0) : null);
    account = left != null ? `$${Number(left).toFixed(2)} credit left` : `$${(d.usage || 0).toFixed(2)} used`;
  }
  const models = await listModels(cfg);
  return { ok: true, ms: Date.now() - t0, models, account };
}

// Send one tiny request with one tool: does the model answer, and does it call tools?
export async function probeModel(cfg, model) {
  const t0 = Date.now();
  const tools = [{ name: 'ping', description: 'Answers pong. Call it when asked to ping.', parameters: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] } }];
  const req = { model, system: 'You are a test. Use the ping tool when asked.', messages: [{ role: 'user', content: [{ type: 'text', text: 'Call the ping tool with word "hello". Do not write anything else.' }] }], tools, maxTokens: 200, signal: AbortSignal.timeout(60000) };
  try {
    const r = await streamModel(cfg, req);
    const call = r.content.find((b) => b.type === 'tool_use');
    const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    return { ok: true, tools: !!call || toolCallsInText(text, new Set(['ping'])).length > 0, text: text.slice(0, 200), ms: Date.now() - t0, usage: r.usage };
  } catch (err) {
    if (err.code === 'notools') {
      const r = await streamModel(cfg, { ...req, tools: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'Say hi in three words.' }] }] });
      return { ok: true, tools: false, definitive: true, text: r.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim().slice(0, 200), ms: Date.now() - t0 };
    }
    throw err;
  }
}
