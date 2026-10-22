// Tool schemas for the non-SDK providers: the studio tools are defined with zod
// shapes (the Claude Agent SDK contract); here they become JSON Schema for
// OpenAI-style function calling, the Anthropic Messages API, Gemini and Ollama,
// and incoming arguments are validated (and gently repaired) with the same zod.
import { z } from 'zod';

// A tool's zod schema: plug-ins pass a raw shape ({ a: z.string() }); accept a z.object too.
export function zodOf(def) {
  const s = def.inputSchema;
  if (s && typeof s.safeParse === 'function') return s;
  return z.object(s || {});
}

// JSON Schema in the dialect every provider accepts: no $schema, no
// propertyNames, no `const` (Gemini), no additionalProperties:false noise.
export function jsonSchemaOf(def, { flavor = 'openai' } = {}) {
  let js;
  try {
    js = z.toJSONSchema(zodOf(def), { unrepresentable: 'any', io: 'input' });
  } catch {
    js = { type: 'object', properties: {} };
  }
  return clean(js, flavor, true);
}

function clean(node, flavor, root = false) {
  if (Array.isArray(node)) return node.map((x) => clean(x, flavor));
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === '$schema' || k === 'propertyNames' || k === '$id') continue;
    if (k === 'additionalProperties') {
      // `{}` (any value) and `false` (closed object) are both noise to a model
      if (v && typeof v === 'object' && Object.keys(v).length) out[k] = clean(v, flavor);
      continue;
    }
    if (k === 'const') { out.enum = [v]; continue; }
    if (k === 'properties') { out[k] = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, clean(pv, flavor)])); continue; }
    out[k] = clean(v, flavor);
  }
  if (flavor === 'gemini') {
    // Gemini's OpenAPI subset: no `{}` schemas (any) and every node needs a type or anyOf
    if (!out.type && !out.anyOf && !out.enum) out.type = 'string';
    // Gemini rejects OBJECT schemas without properties: free-form objects travel as JSON text
    // (repairArgs parses them back before validation)
    if (out.type === 'object' && !out.properties && !root) {
      delete out.additionalProperties;
      out.type = 'string';
      out.description = `${out.description ? `${out.description} ` : ''}(a JSON object)`;
    }
    delete out.default;
  }
  if (out.type === 'object' && !out.properties && root) out.properties = {};
  return out;
}

// Small models send numbers as strings, arrays as JSON text, nulls for
// optional fields... Repair what is obviously meant before validating.
export function repairArgs(value, schema) {
  if (!schema || typeof schema !== 'object') return value;
  if (value === null) return undefined;
  if (schema.anyOf) {
    for (const alt of schema.anyOf) {
      const r = repairArgs(value, alt);
      if (matches(r, alt)) return r;
    }
    return value;
  }
  const t = schema.type;
  if (typeof value === 'string') {
    const s = value.trim();
    if ((t === 'number' || t === 'integer') && s !== '' && Number.isFinite(Number(s))) return Number(s);
    if (t === 'boolean' && /^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
    if ((t === 'object' && s.startsWith('{')) || (t === 'array' && s.startsWith('['))) {
      try { return repairArgs(JSON.parse(s), schema); } catch { return value; }
    }
    if (schema.enum && !schema.enum.includes(value)) {
      const hit = schema.enum.find((e) => String(e).toLowerCase() === s.toLowerCase());
      if (hit !== undefined) return hit;
    }
    return value;
  }
  if (t === 'array') {
    if (!Array.isArray(value)) return value && typeof value === 'object' ? [repairArgs(value, schema.items)] : value;
    return value.map((x) => repairArgs(x, schema.items));
  }
  if (t === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties?.[k] || (typeof schema.additionalProperties === 'object' ? schema.additionalProperties : null);
      const r = sub ? repairArgs(v, sub) : (v === null ? undefined : v);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  return value;
}

function matches(v, s) {
  if (!s?.type) return true;
  if (s.type === 'number' || s.type === 'integer') return typeof v === 'number';
  if (s.type === 'string') return typeof v === 'string' && (!s.enum || s.enum.includes(v));
  if (s.type === 'boolean') return typeof v === 'boolean';
  if (s.type === 'array') return Array.isArray(v);
  if (s.type === 'object') return v && typeof v === 'object' && !Array.isArray(v);
  return true;
}

// Validate a tool call: { ok, args } or { ok: false, error } in words a model can act on.
export function validateArgs(def, raw, schema) {
  let args = raw;
  if (typeof args === 'string') {
    const s = args.trim();
    if (!s) args = {};
    else {
      try { args = JSON.parse(s); } catch {
        // a truncated or chatty argument string: take the outermost {...}
        const m = s.match(/\{[\s\S]*\}/);
        try { args = m ? JSON.parse(m[0]) : null; } catch { args = null; }
        if (!args) return { ok: false, error: `the arguments are not valid JSON: ${s.slice(0, 200)}` };
      }
    }
  }
  if (args == null || typeof args !== 'object' || Array.isArray(args)) args = {};
  const zs = zodOf(def);
  let r = zs.safeParse(args);
  if (!r.success && schema) r = zs.safeParse(repairArgs(args, schema));
  if (r.success) return { ok: true, args: r.data };
  const issues = r.error.issues.slice(0, 6).map((i) => `${i.path.join('.') || '(arguments)'}: ${i.message}`).join('; ');
  return { ok: false, error: `invalid arguments for ${def.name}: ${issues}` };
}
