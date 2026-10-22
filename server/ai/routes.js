// HTTP API of the AI settings dialog (behind the studio password like every /api/ route).
// Keys go in, never out: responses only carry masked hints.
import {
  publicSettings, updateProvider, setDefaultModel, setAiEnabled, aiStatus, resolveProvider, modelMenu, defaultModel, newCustomId, LOCKED, PRESETS,
} from './config.js';
import { checkConnection, listModels, probeModel } from './providers.js';

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 100000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// The saved provider, optionally with values typed in the dialog but not saved yet.
// A different base URL never gets the saved (or env) key: it has to come with its own.
function draftProvider(body) {
  const cfg = resolveProvider(String(body.id || ''));
  if (!cfg) throw Object.assign(new Error('unknown provider'), { status: 400 });
  if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) {
    const url = body.baseUrl.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/\S+$/.test(url)) throw Object.assign(new Error('the base URL must start with http:// or https://'), { status: 400 });
    if (url !== cfg.baseUrl) {
      if (LOCKED) throw Object.assign(new Error('AI settings are locked on this server'), { status: 403 });
      cfg.baseUrl = url;
      cfg.apiKey = '';
    }
  }
  if (typeof body.apiKey === 'string' && body.apiKey.trim()) cfg.apiKey = body.apiKey.trim();
  return cfg;
}

const menu = () => ({ models: modelMenu(), defaultModel: defaultModel(), ai: aiStatus() });

export async function aiRoutes(req, res, p) {
  try {
    if (p === '/api/ai/settings' && req.method === 'GET') return json(res, 200, { ...publicSettings(), ...menu() });
    if (p === '/api/ai/menu' && req.method === 'GET') return json(res, 200, menu());
    if (req.method !== 'POST') return json(res, 404, { error: 'not found' });
    const body = await readBody(req);
    if (p === '/api/ai/provider') {
      updateProvider(String(body.id || ''), body);
      return json(res, 200, { ...publicSettings(), ...menu() });
    }
    if (p === '/api/ai/custom') {
      const id = newCustomId();
      updateProvider(id, { name: body.name || 'Custom endpoint', baseUrl: body.baseUrl || '', apiKey: body.apiKey, models: [] });
      return json(res, 200, { id, ...publicSettings(), ...menu() });
    }
    if (p === '/api/ai/enabled') { // the AI assistant on/off for the whole server
      setAiEnabled(!!body.enabled);
      return json(res, 200, { ...publicSettings(), ...menu() });
    }
    if (p === '/api/ai/default') {
      setDefaultModel(String(body.model || ''));
      return json(res, 200, { ...publicSettings(), ...menu() });
    }
    if (p === '/api/ai/test') {
      const cfg = draftProvider(body);
      try {
        const r = await checkConnection(cfg);
        return json(res, 200, { ok: true, ms: r.ms, account: r.account, models: r.models });
      } catch (err) {
        return json(res, 200, { ok: false, error: err.message, code: err.code || 'error' });
      }
    }
    if (p === '/api/ai/models') {
      const cfg = draftProvider(body);
      try { return json(res, 200, { ok: true, models: await listModels(cfg) }); } catch (err) { return json(res, 200, { ok: false, error: err.message, code: err.code }); }
    }
    if (p === '/api/ai/probe') {
      const cfg = draftProvider(body);
      const model = String(body.model || '').trim();
      if (!model) return json(res, 400, { error: 'pick a model' });
      try { return json(res, 200, { ok: true, ...(await probeModel(cfg, model)) }); } catch (err) { return json(res, 200, { ok: false, error: err.message, code: err.code }); }
    }
    if (p === '/api/ai/presets') return json(res, 200, PRESETS.map((x) => ({ id: x.id, label: x.label })));
    return json(res, 404, { error: 'not found' });
  } catch (err) {
    return json(res, err.status || 400, { error: err.message });
  }
}
