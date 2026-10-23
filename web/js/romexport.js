// ROM export (server/routes/romexport.js): sets up the ROM builder once, then visits every area of
// the hack's levels and sends what the engine shows there (studio_romdump), then has the server
// build the ROM and its BPS patch. The player ends up back where they were.
import { STUDIO_LEVEL } from './worldflow.js';
import { renderSynth } from './sfx.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  let body = {};
  try { body = await r.json(); } catch { /* empty */ }
  if (!r.ok) throw Object.assign(new Error(body.error || `HTTP ${r.status}`), { body });
  return body;
}

// The castle painting each course slot sits behind.
export const SLOT_NAMES = {
  castle_grounds: 'the castle grounds (where the game starts)',
  bob: 'Course 1 · Bob-omb Battlefield', wf: 'Course 2 · Whomp\'s Fortress', jrb: 'Course 3 · Jolly Roger Bay',
  ccm: 'Course 4 · Cool, Cool Mountain', bbh: 'Course 5 · Big Boo\'s Haunt', hmc: 'Course 6 · Hazy Maze Cave',
  lll: 'Course 7 · Lethal Lava Land', ssl: 'Course 8 · Shifting Sand Land', ddd: 'Course 9 · Dire, Dire Docks',
  sl: 'Course 10 · Snowman\'s Land', wdw: 'Course 11 · Wet-Dry World', ttm: 'Course 12 · Tall, Tall Mountain',
  thi: 'Course 13 · Tiny-Huge Island', ttc: 'Course 14 · Tick Tock Clock', rr: 'Course 15 · Rainbow Ride',
};

export class RomExport {
  constructor(state) {
    this.state = state;
    this.cancelled = false;
  }

  get engine() { return this.state.engine; }

  // The base ROM: built once on this computer. onProgress({ step, progress })
  async ensureKit(onProgress) {
    let k = await api('/api/rom/kit');
    if (k.ready) return;
    k = await api('/api/rom/kit', { method: 'POST' });
    while (!k.ready) {
      if (k.error) throw Object.assign(new Error(k.error.title), { fix: k.error.fix, detail: k.error.message });
      if (this.cancelled) throw new Error('Cancelled');
      onProgress?.({ step: k.step, progress: k.progress });
      await sleep(700);
      k = await api('/api/rom/kit');
      if (!k.ready && !k.building && !k.error) k = await api('/api/rom/kit', { method: 'POST' });
    }
  }

  // The game sounds the project replaced, as the ROM plays them: 16-bit mono at 16 kHz
  async sendSounds(onStep) {
    const audio = this.state.audio || {};
    const overrides = audio.overrides || [];
    if (!overrides.length) return;
    onStep({ text: 'Reading your sound effects', progress: 0.9 });
    for (const [i, o] of overrides.entries()) {
      const sound = (audio.sounds || []).find((x) => x.id === o.sound);
      if (!sound) continue;
      let pcm = null;
      try { pcm = await soundPcm(sound); } catch (err) { console.warn('ROM export: a sound could not be read', err); }
      if (pcm) await api(`/api/projects/${this.state.projectId}/rom/sound?index=${i}`, { method: 'PUT', body: pcm, headers: { 'content-type': 'application/octet-stream' } });
    }
  }

  plan() { return api(`/api/projects/${this.state.projectId}/rom/plan`, { method: 'POST' }); }

  // Loads an area (of a custom level, or an original one) and waits until Mario is in it. It
  // always loads again: what the page sets up on the way is recorded (record()).
  async visit(level, area) {
    const e = this.engine;
    const to = level.vanilla ? { level: level.level, area } : { custom: level.id, area };
    const key = level.vanilla ? `${level.level}:${area}` : `c:${level.id}${area > 1 ? `:${area}` : ''}`;
    this.state.worldFlow.goArea(to);
    const t0 = performance.now();
    let asked = t0;
    while (performance.now() - t0 < 90000) { // (a busy computer can take a while)
      await sleep(150);
      let m = null;
      try { m = e.state().mario; } catch { /* loading */ }
      if (m && !e.inIntro && e.areaKey() === key) {
        await sleep(1200); // the area's objects spawn and settle
        return true;
      }
      // the game refuses a warp while one of its own is under way: ask again
      if (performance.now() - asked > 6000 && e.areaKey() !== key) {
        asked = performance.now();
        this.state.worldFlow.goArea(to);
      }
    }
    return false;
  }

  // Records the set-up calls the page makes (spec: name -> parameter kinds, from the server), until
  // the returned function is called: [[name, ...args]] with arrays and strings read out of the
  // engine's memory and objects named by uid.
  record(spec) {
    const M = this.engine.M;
    const calls = [];
    const orig = {};
    for (const [name, kinds] of Object.entries(spec)) {
      const fn = M[`_${name}`];
      if (typeof fn !== 'function') continue;
      orig[name] = fn;
      M[`_${name}`] = (...args) => {
        const rec = [name];
        kinds.forEach((k, i) => {
          const v = args[i];
          if (k === 'slot') rec.push(M._studio_slot_uid ? M._studio_slot_uid(v) >>> 0 : 0);
          else if (k === 'floats') rec.push(Array.from(new Float32Array(M.HEAPU8.buffer, v, args[i + 1] | 0)));
          else if (k === 'bytes') rec.push(Array.from(M.HEAPU8.subarray(v, v + (args[i + 1] | 0))));
          else if (k === 'str') rec.push(M.UTF8ToString(v));
          else rec.push(v);
        });
        calls.push(rec);
        return fn(...args);
      };
    }
    return () => {
      for (const [name, fn] of Object.entries(orig)) M[`_${name}`] = fn;
      return calls;
    };
  }

  // What the engine shows in the current area, as the server reads it (romexport/dump.js).
  // bake: uids of props drawn as part of the level; skip: uids left out of it (objects of their own)
  dump(bake = [], skip = []) {
    const M = this.engine.M;
    const list = (uids) => {
      const p = uids.length ? M._malloc(uids.length * 4) : 0;
      if (p) new Int32Array(M.HEAPU8.buffer, p, uids.length).set(uids);
      return p;
    };
    const pb = list(bake), ps = list(skip);
    try {
      const ptr = M._studio_romdump(ps, skip.length, pb, bake.length);
      const len = M._studio_romdump_size();
      return M.HEAPU8.slice(ptr, ptr + len);
    } finally {
      if (pb) M._free(pb);
      if (ps) M._free(ps);
    }
  }

  // The whole export. onStep({ text, progress }) -> { plan, report, files }
  async run({ title, onStep = () => {} } = {}) {
    const e = this.engine;
    const back = { level: e.level, area: e.area, custom: e.customLevel, key: e.areaKey() };
    onStep({ text: 'Setting up the ROM builder', progress: 0 });
    await this.ensureKit(({ step, progress }) => onStep({ text: `Setting up the ROM builder (once): ${step}`, progress: 0.4 * progress, setup: true }));

    const plan = await this.plan();
    // (an original level's geometry is read only where the hack adds blocks or models to it)
    const areas = plan.levels.flatMap((l) => l.areas.map((a) => ({ ...a, level: l })));
    let done = 0;
    try {
      for (const a of areas) {
        if (this.cancelled) throw new Error('Cancelled');
        onStep({ text: `Reading ${a.level.name}${a.level.areas.length > 1 ? `, area ${a.index}` : ''}`, progress: 0.4 + 0.5 * (done / areas.length) });
        const stop = this.record(plan.calls || {});
        let loaded;
        try { loaded = await this.visit(a.level, a.index); } finally { a.calls = stop(); }
        if (!loaded) throw new Error(`${a.level.name} (area ${a.index}) did not load`);
        if (a.dump) {
          const bytes = this.dump(plan.bake[a.key] || [], plan.skip?.[a.key] || []);
          const r = await fetch(`/api/projects/${this.state.projectId}/rom/area?key=${encodeURIComponent(a.key)}`, { method: 'PUT', body: bytes, headers: { 'content-type': 'application/octet-stream' } });
          if (!r.ok) throw new Error(`Could not send ${a.level.name}: ${(await r.json().catch(() => ({}))).error || r.status}`);
          // moving blocks and models, each on its own
          for (const uid of plan.skip?.[a.key] || []) {
            const M = this.engine.M;
            const ptr = M._studio_romdump_object(uid);
            const one = M.HEAPU8.slice(ptr, ptr + M._studio_romdump_size());
            const ro = await fetch(`/api/projects/${this.state.projectId}/rom/object?key=${encodeURIComponent(a.key)}&uid=${uid >>> 0}`, { method: 'PUT', body: one, headers: { 'content-type': 'application/octet-stream' } });
            if (!ro.ok) throw new Error(`Could not send a moving block of ${a.level.name}`);
          }
        }
        await api(`/api/projects/${this.state.projectId}/rom/calls?key=${encodeURIComponent(a.key)}`, { method: 'PUT', body: JSON.stringify({ calls: a.calls }) });
        done++;
      }
    } finally {
      // back where the player was (and there before the ROM is reported done)
      if (back.level === STUDIO_LEVEL && back.custom) await this.visit({ vanilla: false, id: back.custom }, back.area || 1);
      else if (back.level) await this.visit({ vanilla: true, level: back.level }, back.area || 1);
    }

    await this.sendSounds(onStep);
    onStep({ text: 'Building the ROM and the patch', progress: 0.92 });
    const result = await api(`/api/projects/${this.state.projectId}/rom/build`, { method: 'POST', body: JSON.stringify({ title }) });
    onStep({ text: 'Done', progress: 1 });
    return { plan, ...result };
  }
}

// A project sound (synthesized, or a recorded or chosen file) as 16-bit mono samples at 16 kHz, at
// its volume, at most 3 seconds
const ROM_RATE = 16000;
async function soundPcm(sound) {
  let source;
  if (sound.kind === 'file') {
    const bin = Uint8Array.from(atob(sound.data.split(',')[1]), (c) => c.charCodeAt(0));
    source = await new OfflineAudioContext(1, 1, ROM_RATE).decodeAudioData(bin.buffer);
  } else {
    const s = renderSynth(sound.synth);
    source = new AudioBuffer({ length: s.length, numberOfChannels: 1, sampleRate: 44100 });
    source.copyToChannel(s, 0);
  }
  const length = Math.min(3 * ROM_RATE, Math.ceil(source.duration * ROM_RATE));
  const ctx = new OfflineAudioContext(1, Math.max(1, length), ROM_RATE);
  const src = ctx.createBufferSource();
  src.buffer = source;
  src.connect(ctx.destination);
  src.start();
  const out = (await ctx.startRendering()).getChannelData(0);
  const vol = sound.volume ?? 1;
  const pcm = new Int16Array(out.length);
  for (let i = 0; i < out.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(out[i] * vol * 32767)));
  return new Uint8Array(pcm.buffer);
}
