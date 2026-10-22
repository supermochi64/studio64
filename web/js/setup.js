// The first-run setup page (setup.html): drop the ROM (and optionally the Sunshine disc), then
// watch the server build everything (server/setup/pipeline.js). /setup.html?add=sunshine adds the
// Sunshine characters to a studio that is already set up.
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ADD_SUNSHINE = params.get('add') === 'sunshine';

let password = (() => { try { return localStorage.getItem('studio64.password') || ''; } catch { return ''; } })();
let status = null;
let firstBoot = null;
let romOk = false;
let discOk = false;
let uploading = 0;
let shown = '';
let sawRunning = false;
let editing = false; // "Change the ROM or disc" after an error: stay on the inputs
let doneAt = 0;

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'x-studio-key': password, ...(opts.headers || {}) } });
  if (res.status === 401) {
    password = window.prompt('This Studio 64 server has a password:') || '';
    try { localStorage.setItem('studio64.password', password); } catch { /* private window */ }
    return api(path, opts);
  }
  return res;
}

// ---- formatting ------------------------------------------------------------------------------
const minutes = (s) => {
  if (s == null) return '';
  if (s < 50) return 'less than a minute';
  const m = Math.round(s / 60);
  return m <= 1 ? 'about a minute' : `about ${m} minutes`;
};
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const mb = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.round(b / 1e6)} MB`);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ICON = {
  ok: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
  bad: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
  up: '<svg class="i" viewBox="0 0 24 24"><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg>',
  done: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  skipped: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
  warning: '<svg viewBox="0 0 24 24"><path d="M12 7v6M12 17h.01"/></svg>',
  failed: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17"/></svg>',
};

function show(view) {
  if (shown === view) return;
  shown = view;
  for (const v of ['inputs', 'progress', 'done']) $(`view-${v}`).hidden = v !== view;
  $('top-note').textContent = view === 'done' ? 'Ready' : ADD_SUNSHINE ? 'Add the Sunshine characters' : 'First-time setup';
}

// ---- the drop zones ----------------------------------------------------------------------------
function result(el, kind, title, message, action) {
  el.hidden = false;
  el.className = `su-result ${kind}`;
  el.innerHTML = `${ICON[kind] || ''}<div class="su-result-text"><div class="su-result-title">${esc(title)}</div>${message ? `<div class="su-result-msg">${esc(message)}</div>` : ''}</div>`;
  if (action) {
    const b = document.createElement('button');
    b.className = 'btn sm';
    b.textContent = action.label;
    b.onclick = action.run;
    el.appendChild(b);
  }
}

function progressRow(el, title, frac) {
  el.hidden = false;
  el.className = 'su-result';
  el.innerHTML = `${ICON.up}<div class="su-up"><div class="su-result-title">${esc(title)}</div><div class="su-bar"><span style="width:${Math.round(frac * 100)}%"></span></div></div>`;
}

/** POSTs a file with upload progress. Resolves with the JSON answer. */
function upload(url, file, onProgress) {
  return new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open('POST', `${url}?name=${encodeURIComponent(file.name)}`);
    x.setRequestHeader('content-type', 'application/octet-stream');
    x.setRequestHeader('x-studio-key', password);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total, e.loaded, e.total);
    x.onload = () => { try { resolve(JSON.parse(x.responseText)); } catch { resolve({ ok: false, title: 'The server did not answer', message: x.responseText.slice(0, 200) }); } };
    x.onerror = () => resolve({ ok: false, title: 'The upload failed', message: 'Is the Studio 64 server still running? Start Studio 64 again (its window must stay open) and drop the file again.' });
    x.send(file);
  });
}

function wireDrop(zone, input, onFile) {
  const pick = (files) => { if (files && files[0]) onFile(files[0]); };
  input.addEventListener('change', () => { pick(input.files); input.value = ''; });
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  for (const ev of ['dragenter', 'dragover']) zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag'); });
  for (const ev of ['dragleave', 'dragend']) zone.addEventListener(ev, () => zone.classList.remove('drag'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('drag'); pick(e.dataTransfer.files); });
}

// a drop anywhere on the page goes to the right zone (a disc is big, a ROM is small)
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  if (shown !== 'inputs') return;
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  if (f.size > 200e6 || /\.(iso|gcm|nkit|rvz|gcz|ciso|wia)$/i.test(f.name)) { $('sms-on').checked = true; syncSunshine(); onDisc(f); } else onRom(f);
});

async function onRom(file) {
  const card = $('rom-card'), out = $('rom-result');
  card.classList.remove('is-ok');
  romOk = false;
  uploading++;
  $('rom-drop').classList.add('busy');
  progressRow(out, `Checking ${file.name}…`, 0.1);
  const r = await upload('/api/setup/rom', file, (f) => progressRow(out, `Checking ${file.name}…`, Math.max(0.1, f)));
  uploading--;
  $('rom-drop').classList.remove('busy');
  if (r.ok) {
    romOk = true;
    card.classList.add('is-ok');
    result(out, 'ok', r.note || 'Super Mario 64 (US)', `${file.name} is ready.`, { label: 'Use another ROM', run: () => { card.classList.remove('is-ok'); out.hidden = true; romOk = false; syncGo(); } });
  } else {
    result(out, 'bad', r.title, r.message);
  }
  syncGo();
}

/** The first bytes of a disc image say what it is, before 1.4 GB are copied. */
async function precheckDisc(file) {
  const head = new Uint8Array(await file.slice(0, 0x440).arrayBuffer());
  const dv = new DataView(head.buffer);
  const magic = String.fromCharCode(...head.slice(0, 4));
  const convert = 'In Dolphin, right-click the game → Convert File… → Format: ISO, then drop the .iso here.';
  if (magic === 'RVZ\x01' || magic === 'WIA\x01') return { ok: false, title: `This is a compressed ${magic.slice(0, 3)} image`, message: convert };
  if (head.length >= 4 && dv.getUint32(0, true) === 0xB10BC001) return { ok: false, title: 'This is a compressed GCZ image', message: convert };
  if (magic === 'CISO') return { ok: false, title: 'This is a compressed CISO image', message: convert };
  if (magic.startsWith('PK') || magic.startsWith('7z') || magic === 'Rar!') return { ok: false, title: 'Unpack the archive first', message: 'Unpack it and drop the .iso (or .nkit.iso) that is inside.' };
  if (head.length < 0x20 || dv.getUint32(0x1c) !== 0xC2339F3D) return { ok: false, title: 'This is not a GameCube disc image', message: 'Drop your Super Mario Sunshine disc as .iso, .gcm or .nkit.iso.' };
  const id = String.fromCharCode(...head.slice(0, 6));
  if (!id.startsWith('GMS')) return { ok: false, title: 'This is another GameCube game', message: `The disc says it is ${id}. Super Mario Sunshine is GMSE01 (USA).` };
  return { ok: true };
}

async function onDisc(file) {
  const card = $('sms-card'), out = $('sms-result');
  card.classList.remove('is-ok');
  discOk = false;
  const pre = await precheckDisc(file).catch(() => ({ ok: true }));
  if (!pre.ok) { result(out, 'bad', pre.title, pre.message); syncGo(); return; }
  uploading++;
  $('sms-drop').classList.add('busy');
  syncGo();
  const t0 = performance.now();
  const r = await upload('/api/setup/disc', file, (f, done, total) => {
    const s = (performance.now() - t0) / 1000;
    const left = f > 0.03 ? s / f - s : null;
    progressRow(out, `Copying the disc: ${mb(done)} of ${mb(total)}${left != null ? ` · ${Math.ceil(left)} s left` : ''}`, f);
  });
  uploading--;
  $('sms-drop').classList.remove('busy');
  if (r.ok) {
    discOk = true;
    card.classList.add('is-ok');
    result(out, 'ok', r.note || 'Super Mario Sunshine', `${file.name} is ready.`, { label: 'Use another disc', run: forgetDisc });
  } else {
    result(out, 'bad', r.title, r.message);
  }
  syncGo();
}

async function forgetDisc() {
  discOk = false;
  $('sms-card').classList.remove('is-ok');
  $('sms-result').hidden = true;
  await api('/api/setup/disc', { method: 'DELETE' }).catch(() => {});
  syncGo();
}

function syncSunshine() {
  $('sms-body').hidden = !$('sms-on').checked;
  syncGo();
}

function syncGo() {
  const sms = $('sms-on').checked;
  let hint = '';
  if (!romOk) hint = 'Drop your ROM first';
  else if (uploading) hint = 'Copying…';
  else if (sms && !discOk) hint = 'Drop the Sunshine disc, or switch it off';
  else if (ADD_SUNSHINE && !sms) hint = 'Switch the Sunshine characters on';
  $('go').disabled = !!hint;
  const est = status?.estimates || {};
  // until the studio opens (the pictures and samples follow in the background)
  const total = ['check', 'compiler', 'engine', 'data'].reduce((a, k) => a + (est[k] || 0), 0) + (sms ? (est.sunshine || 60) : 0);
  $('est-total').textContent = minutes(total);
  $('go-hint').textContent = hint || `The studio opens in ${minutes(total)}; the pictures follow in the background.`;
}

wireDrop($('rom-drop'), $('rom-file'), onRom);
wireDrop($('sms-drop'), $('sms-file'), onDisc);
$('sms-on').addEventListener('change', syncSunshine);

$('go').addEventListener('click', async () => {
  $('go').disabled = true;
  editing = false;
  const r = await api('/api/setup/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sunshine: $('sms-on').checked && discOk }) }).then((x) => x.json()).catch(() => ({ ok: false }));
  if (!r.ok) { $('go').disabled = false; return; }
  show('progress');
  poll();
});
const again = async () => {
  await api('/api/setup/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sunshine: !!status?.options?.sunshine && (status.disc || status.sunshine) }) });
  poll();
};
$('retry').addEventListener('click', again);
$('resume').addEventListener('click', again);
$('back-inputs').addEventListener('click', () => { editing = true; show('inputs'); fillInputs(status); });
$('copy-log').addEventListener('click', async () => {
  const text = await api('/api/setup/log').then((r) => r.text()).catch(() => $('log').textContent);
  try { await navigator.clipboard.writeText(text); $('copy-log').lastChild.textContent = 'Copied'; } catch {
    const sel = window.getSelection(); const range = document.createRange(); range.selectNodeContents($('log')); sel.removeAllRanges(); sel.addRange(range);
  }
  setTimeout(() => { $('copy-log').lastChild.textContent = 'Copy the whole log'; }, 1800);
});

// an older Studio 64 folder beside this one (an update unpacked next to the old version): its ROM,
// projects and pictures come over with one click
let olderAsked = false;
async function offerOlder(s) {
  if (olderAsked || ADD_SUNSHINE) return;
  olderAsked = true;
  const r = await api('/api/setup/older').then((x) => x.json()).catch(() => null);
  const f = r?.folders?.[0];
  if (!f) return;
  const what = [f.rom && !s.rom ? 'your ROM' : '', f.projects ? `${f.projects === 1 ? 'your project' : `your ${f.projects} projects`}` : ''].filter(Boolean).join(' and ');
  if (!what) return;
  $('older-text').textContent = `There is an older Studio 64 in the folder “${f.name}” next to this one. Studio 64 can copy ${what} from it (and its pictures), so you don't have to drop the ROM again. The old folder stays as it is.`;
  $('older-card').hidden = false;
  $('older-go').onclick = async () => {
    $('older-go').disabled = true;
    $('older-hint').textContent = 'Copying…';
    const res = await api('/api/setup/older', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: f.path }) }).then((x) => x.json()).catch(() => ({ ok: false }));
    if (!res.ok) { $('older-go').disabled = false; $('older-hint').textContent = res.title || 'That did not work. Drop your ROM below instead.'; return; }
    $('older-card').classList.add('is-ok');
    $('older-hint').textContent = `Done: ${[res.rom ? 'the ROM' : '', res.projects ? `${res.projects} project files` : '', res.pictures ? `${res.pictures} pictures` : ''].filter(Boolean).join(', ') || 'nothing new to copy'}.`;
    if (res.rom) { status = { ...(status || {}), rom: true }; fillInputs({ ...status, rom: true }); }
  };
}

function fillInputs(s) {
  offerOlder(s);
  if (s.rom && !romOk && !uploading) {
    romOk = true;
    $('rom-card').classList.add('is-ok');
    result($('rom-result'), 'ok', 'Your ROM is in place', 'engine/baserom.us.z64', { label: 'Use another ROM', run: () => { $('rom-card').classList.remove('is-ok'); $('rom-result').hidden = true; romOk = false; syncGo(); } });
  }
  if (s.disc && !discOk && !uploading) {
    discOk = true;
    $('sms-on').checked = true;
    $('sms-card').classList.add('is-ok');
    result($('sms-result'), 'ok', 'Your Sunshine disc is in place', 'It is converted when you start.', { label: 'Remove', run: forgetDisc });
  }
  if (ADD_SUNSHINE) {
    $('inputs-title').textContent = s.sunshine ? 'The Sunshine characters are in' : 'Add the Sunshine characters';
    $('inputs-lead').innerHTML = s.sunshine
      ? 'Your studio already has the Super Mario Sunshine characters. Drop a disc again only to convert them once more.'
      : 'Drop your Super Mario Sunshine disc: the setup converts the characters and builds the game again. It takes <b id="est-total">a few minutes</b>.';
    $('sms-on').checked = true;
    $('go-label').textContent = 'Add the Sunshine characters';
  }
  syncSunshine();
}

// ---- progress ----------------------------------------------------------------------------------
function renderProgress(s) {
  const est = s.estimates || {};
  let sum = 0, doneW = 0;
  const list = $('steps');
  list.innerHTML = '';
  for (const st of s.steps) {
    // weight: what a finished step really took, else its estimate
    // (the extras run after the studio opens: they don't count towards "the studio opens")
    // (the estimates, also for finished steps: one slow step must not make the bar jump to 90%)
    const w = st.soft || st.state === 'skipped' ? 0 : Math.max(2, est[st.id] || 10);
    sum += w;
    const frac = ['done', 'skipped', 'warning'].includes(st.state) ? 1 : st.state === 'running' ? (st.progress ?? 0.15) : 0;
    doneW += w * frac;
    const li = document.createElement('li');
    li.className = `su-step ${st.state}`;
    const time = st.state === 'running' && st.seconds != null ? clock(st.seconds) : (['done', 'warning'].includes(st.state) && st.seconds > 1 ? clock(st.seconds) : '');
    const detail = st.state === 'failed' || st.state === 'warning' ? (st.error?.title || st.detail) : st.detail;
    li.innerHTML = `<span class="su-step-icon">${ICON[st.state] || ''}</span><span class="su-step-label">${esc(st.label)}${st.soft && st.state === 'pending' ? ' <span class="su-tag soft">extra</span>' : ''}</span>`
      + `<span class="su-step-time">${time}</span><span class="su-step-detail">${esc(detail)}</span>`
      + (st.state === 'running' ? `<div class="su-bar${st.progress == null ? ' indeterminate' : ''}"><span style="width:${Math.round((st.progress || 0) * 100)}%"></span></div>` : '');
    list.appendChild(li);
  }
  const pct = s.status === 'done' ? 100 : Math.min(99, Math.round((doneW / Math.max(1, sum)) * 100));
  document.querySelector('.su-overall').hidden = !s.running; // (stopped or failed: the step list says where)
  $('overall-bar').style.width = `${pct}%`;
  $('overall-pct').textContent = `${pct}%`;
  const elapsed = s.startedAt ? ((s.running ? Date.now() : (s.finishedAt || Date.now())) - s.startedAt) / 1000 : 0;
  $('overall-left').textContent = s.running ? `${clock(elapsed)} so far · the studio opens in ${minutes(s.secondsLeft)}` : '';

  const failed = s.status === 'failed' && !s.running;
  $('error-card').hidden = !failed;
  if (failed) {
    $('error-title').textContent = s.error?.title || 'The setup stopped';
    $('error-message').textContent = s.error?.message || '';
    $('error-message').hidden = !s.error?.message;
    $('error-fix').textContent = s.error?.fix || 'Press Try again. If it fails the same way, look at the details below.';
  }
  $('paused-card').hidden = !(s.status === 'interrupted' && !s.running);
  $('progress-title').textContent = failed ? 'The setup needs your help' : s.status === 'interrupted' && !s.running ? 'Continue the setup' : ADD_SUNSHINE ? 'Adding the Sunshine characters' : 'Building your studio';
  $('progress-lead').hidden = !s.running;

  const pre = $('log');
  const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 30;
  pre.textContent = s.log.join('\n');
  if (atEnd) pre.scrollTop = pre.scrollHeight;
  // the last line that says something (not a compiler warning about the tools' C code)
  $('log-last').textContent = [...s.log].reverse().find((l) => !/warning:|note:|^\s|^In file included|warnings? generated|^\d+ \|/.test(l)) || '';
  if (failed && !$('log-box').dataset.opened) { $('log-box').open = true; $('log-box').dataset.opened = '1'; pre.scrollTop = pre.scrollHeight; }
}

function renderDone(s) {
  const secs = s.finishedAt && s.startedAt ? (s.finishedAt - s.startedAt) / 1000 : 0;
  $('done-time').textContent = secs >= 60 ? `${Math.round(secs / 60)} minutes` : `${Math.round(secs)} seconds`;
  const w = s.warnings || [];
  $('done-warn').hidden = !w.length;
  $('done-extras').hidden = s.status !== 'finishing';
  $('done-warn-list').innerHTML = w.map((x) => `<li><b>${esc(x.title)}.</b> ${esc(x.message)} ${esc(x.fix)}</li>`).join('');
}

// ---- polling -----------------------------------------------------------------------------------
let timer = null;
async function poll() {
  clearTimeout(timer);
  try { await pollOnce(); } catch (err) { console.error(err); }
  timer = setTimeout(poll, status?.running && status.status === 'running' ? 700 : shown === 'done' ? 600 : 2000);
}

async function pollOnce() {
  let s = null;
  try { s = await api('/api/setup/status').then((r) => r.json()); } catch { /* restarting */ }
  if (s) {
    status = s;
    if (firstBoot == null) firstBoot = s.boot;
    if (s.running && s.status === 'running') sawRunning = true;
    const finished = s.status === 'done' || s.status === 'finishing'; // (finishing: pictures and samples go on in the background)
    if (finished && !sawRunning && s.ready && !ADD_SUNSHINE) { location.replace('/'); return; }
    if (finished && sawRunning) {
      if (!doneAt) doneAt = performance.now();
      show('done');
      renderDone(s);
      // the server starts again with the new game (a new boot id); then open the studio
      if (s.ready && (s.boot !== firstBoot || performance.now() - doneAt > 20000)) { location.replace('/'); return; }
    } else if (s.status === 'running' || ((s.status === 'failed' || s.status === 'interrupted') && !editing)) {
      show('progress');
      renderProgress(s);
    } else if (s.ready && !ADD_SUNSHINE) {
      location.replace('/');
      return;
    } else {
      if (shown !== 'inputs') { show('inputs'); }
      fillInputs(s);
    }
  } else if (shown === 'done') {
    $('done-state').textContent = 'Starting the studio…';
  }
}
poll();
