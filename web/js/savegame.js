// The hack's save: everything a player's progress is made of, kept together per project.
//
//  - the game's own save (EEPROM: stars of the original courses, keys, caps, opened doors),
//    one per project (Module.studioSaveKey; before, every project shared one save),
//  - the stars, coin scores, keys and unlocked doors of the hack's own levels (world.js),
//  - the story's progress per save file (flags, counters, finished events, shown objects).
//
// All of it lives in the browser's localStorage (the standalone player is a static site:
// that is the only place it has). In the studio the whole save is mirrored to the server
// (GET/PUT /api/projects/:id/playsave), so clearing the browser's storage or opening the
// project in another browser keeps the progress; a save on the server that is newer than
// the browser's copy wins when the page loads.
//
// reset() is what "Play from start" and the F3 panel's "Reset save file" do: one fresh save.

const STORY_FILES = [1, 2, 3, 4];

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } };

const bodyOf = (s) => JSON.stringify({ ...s, t: 0 });

export class HackSave {
  // pid: the project (studio) or `play-<hack id>` (player); server: mirror to the studio server
  constructor({ pid, server = null, password = () => '' } = {}) {
    this.pid = pid;
    this.server = server; // base url of the project's api, e.g. /api/projects/<id>
    this.password = password;
    this.engine = null;
    this.lastSentBody = null;
    this.timer = null;
    this.listeners = [];
  }

  keys() {
    const p = this.pid;
    return {
      eeprom: `studio64.eeprom.${p}`,
      stars: `studio64.stars.${p}`,
      story: Object.fromEntries(STORY_FILES.map((f) => [f, `studio64.story.${p}.f${f}`])),
      time: `studio64.savetime.${p}`,
    };
  }

  // Everything as one object (what the server keeps).
  snapshot() {
    const k = this.keys();
    const story = {};
    for (const f of STORY_FILES) { const v = lsGet(k.story[f]); if (v) story[f] = v; }
    return { v: 1, t: Number(lsGet(k.time)) || 0, eeprom: lsGet(k.eeprom) || this.engine?.M?.studioSaveMem || null, stars: lsGet(k.stars), story };
  }

  isEmpty(s = this.snapshot()) { return !s.eeprom && !s.stars && !Object.keys(s.story || {}).length; }

  // Put a save into the browser's storage (all parts: what it lacks is cleared).
  write(s) {
    const k = this.keys();
    lsSet(k.eeprom, s.eeprom || null);
    lsSet(k.stars, s.stars || null);
    for (const f of STORY_FILES) lsSet(k.story[f], s.story?.[f] || null);
    lsSet(k.time, String(s.t || Date.now()));
    if (this.engine?.M) this.engine.M.studioSaveMem = s.eeprom || null;
  }

  // Before the engine boots: the save on the server wins when it is newer (or the
  // browser has none, e.g. its storage was cleared).
  async pull(ms = 2500) {
    if (!this.server) return false;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), ms);
      const r = await fetch(`${this.server}/playsave`, { headers: { 'x-studio-key': this.password() }, signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) return false;
      const remote = await r.json();
      if (!remote || remote.v !== 1) return false;
      const local = this.snapshot();
      if (this.isEmpty(remote)) return false;
      if (this.isEmpty(local) || (remote.t || 0) > (local.t || 0)) {
        this.write(remote);
        this.lastSnap = this.snapshot();
        this.lastSentBody = bodyOf(this.lastSnap);
        return true;
      }
    } catch { /* offline: the browser's copy */ }
    return false;
  }

  // The engine reads its save from here (call before engine.boot()).
  attach(engine) {
    this.engine = engine;
    // engine.boot() hands these to the game (Module.studioSaveKey / studioSaveWritten)
    engine.saveKey = this.keys().eeprom;
    engine.onSaveWritten = () => this.touch();
    if (this.server) {
      clearInterval(this.timer);
      // the story and the stars write localStorage themselves: look for changes now and then
      this.timer = setInterval(() => this.sync(), 3000);
      window.addEventListener('pagehide', () => this.sync(true));
    }
  }

  on(fn) { this.listeners.push(fn); }

  // Something in the save changed now (its time decides which copy is newer).
  touch() {
    lsSet(this.keys().time, String(Date.now()));
    clearTimeout(this.soon);
    this.soon = setTimeout(() => this.sync(), 600);
  }

  sync(beacon = false) {
    if (!this.server) return;
    const s = this.snapshot();
    // a part that was there and is gone, without a reset (resets write empty progress, never
    // nothing): the browser's storage was cleared under the running page. Put it back
    // instead of sending the loss to the server.
    const last = this.lastSnap;
    if (last) {
      const k = this.keys();
      if (last.eeprom && !lsGet(k.eeprom)) { s.eeprom = s.eeprom || last.eeprom; lsSet(k.eeprom, s.eeprom); }
      if (last.stars && !s.stars) { s.stars = last.stars; lsSet(k.stars, last.stars); }
      for (const f of STORY_FILES) if (last.story?.[f] && !s.story[f]) { s.story[f] = last.story[f]; lsSet(k.story[f], last.story[f]); }
    }
    this.lastSnap = s;
    const body = bodyOf(s);
    if (body === this.lastSentBody) return;
    // a change the writers didn't time-stamp (story, stars): it is new now
    if (this.lastSentBody) { s.t = Date.now(); lsSet(this.keys().time, String(s.t)); }
    this.lastSentBody = body;
    const data = JSON.stringify(s);
    const url = `${this.server}/playsave`;
    fetch(url, { method: 'PUT', keepalive: beacon && data.length < 60000, headers: { 'content-type': 'application/json', 'x-studio-key': this.password() }, body: data }).catch(() => { this.lastSentBody = null; });
  }

  // A fresh save: the game's save file, the hack's stars, keys and doors, and the story.
  // (file: the game's save file number the story progress belongs to; all of them when null)
  reset({ engine = this.engine, world = null, story = null, flow = null } = {}) {
    const M = engine?.M;
    if (M?._studio_save_reset) M._studio_save_reset();
    world?.resetProgress?.();
    if (story) story.resetProgress(); else for (const f of STORY_FILES) lsSet(this.keys().story[f], null);
    flow?.lockOverrides?.clear?.();
    if (engine?.ready) {
      try { engine.setBonusStars(world?.collectedTotal?.() || 0); } catch { /* old engine */ }
      try { flow?.pushKeys?.(); flow?.registerLocks?.(); } catch { /* not in a level */ }
    }
    world?.emit?.();
    this.touch();
    for (const fn of this.listeners) { try { fn('reset'); } catch (e) { console.error(e); } }
  }
}
