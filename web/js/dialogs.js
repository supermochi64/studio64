// Studio 64 dialogs: the replacement for the browser's alert(), confirm() and prompt().
//
//   import { askConfirm, askText, notify } from './dialogs.js';
//   if (await askConfirm({ title: 'Delete “Goomba”?', text: 'Copies in your levels stay.', ok: 'Delete', danger: true })) …
//   const name = await askText({ title: 'Rename model', value: m.name, placeholder: 'Model name' }); // null when cancelled
//   const kind = await askChoice({ title: 'New variable', choices: [{ id: 'flag', label: 'Yes/no flag' }, { id: 'counter', label: 'Counter' }] });
//
// Every dialog is keyboard friendly (Enter confirms, Esc cancels, focus stays inside) and
// releases the game's keys while it is open. Styles: css/shell.css (.dlg-*).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let open = null; // the dialog on screen

function releaseGameKeys() {
  try { window.studio64?.engine?.releaseKeys?.(); } catch { /* not booted */ }
}

// Builds and shows one dialog; resolves with whatever `finish` is called with.
function show({ title, text, html, body, actions, initialFocus, onKey, wide, bind }) {
  if (open) open.cancel();
  releaseGameKeys();
  const back = document.createElement('div');
  back.className = 'dlg-back';
  back.innerHTML = `<div class="dlg${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <h2 class="dlg-title" id="dlg-title">${esc(title)}</h2>
      ${text ? `<p class="dlg-text">${esc(text)}</p>` : ''}${html || ''}
      <div class="dlg-body"></div>
      <div class="dlg-actions"></div>
    </div>`;
  const box = back.querySelector('.dlg');
  if (body) back.querySelector('.dlg-body').appendChild(body); else back.querySelector('.dlg-body').remove();
  const prev = document.activeElement;
  const traps = window.studioKeyTraps;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      open = null;
      if (traps) { const i = traps.lastIndexOf(key); if (i >= 0) traps.splice(i, 1); } else document.removeEventListener('keydown', key, true);
      back.classList.add('out');
      setTimeout(() => back.remove(), 140);
      try { if (prev && prev !== document.body && prev.isConnected) prev.focus({ preventScroll: true }); } catch { /* ignore */ }
      resolve(value);
    };
    bind?.(finish);
    const row = back.querySelector('.dlg-actions');
    let primary = null;
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn${a.primary ? ' primary' : ''}${a.danger ? ' danger primary' : ''}`;
      b.textContent = a.label;
      b.onclick = () => finish(typeof a.value === 'function' ? a.value() : a.value);
      if (a.primary || a.danger) primary = b;
      row.appendChild(b);
    }
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(actions.find((a) => a.cancel)?.value ?? null); return; }
      if (onKey?.(e, finish)) return;
      if (e.key === 'Enter' && !e.shiftKey && primary && document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); primary.click(); return; }
      if (e.key === 'Tab') { // keep the focus inside the dialog
        const f = [...box.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled);
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
      if ((e.key === 'Enter' || e.key === ' ') && document.activeElement?.tagName === 'BUTTON') return 'pass'; // the focused button clicks
      e.stopPropagation(); // the game and the editor do not see keys typed into a dialog
    };
    // the shell hands the topmost overlay every key first (shell.js); without it, a capture listener
    if (traps) traps.push(key); else document.addEventListener('keydown', key, true);
    back.addEventListener('mousedown', (e) => { if (e.target === back) finish(actions.find((a) => a.cancel)?.value ?? null); });
    document.body.appendChild(back);
    open = {
      cancel: () => finish(actions.find((a) => a.cancel)?.value ?? null),
      accept: () => (primary ? primary.click() : finish(true)),
      answer: (v) => finish(v),
      title,
    };
    requestAnimationFrame(() => (initialFocus?.(box) || primary || row.lastChild)?.focus?.());
  });
}

// Yes/no question. Resolves true or false.
export function askConfirm({ title = 'Are you sure?', text = '', ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  return show({
    title, text,
    actions: [{ label: cancel, value: false, cancel: true }, { label: ok, value: true, primary: !danger, danger }],
  });
}

// One line (or more with multiline) of text. Resolves the text, or null when cancelled.
export function askText({ title = 'Name', text = '', value = '', placeholder = '', ok = 'OK', cancel = 'Cancel', multiline = false, type = 'text' } = {}) {
  const input = document.createElement(multiline ? 'textarea' : 'input');
  input.className = 'dlg-input';
  if (!multiline) input.type = type;
  input.value = value ?? '';
  input.placeholder = placeholder;
  input.spellcheck = false;
  return show({
    title, text, body: input,
    initialFocus: () => { setTimeout(() => input.select?.(), 0); return input; },
    actions: [{ label: cancel, value: null, cancel: true }, { label: ok, value: () => input.value, primary: true }],
    onKey: (e) => { if (multiline && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); input.closest('.dlg').querySelector('.btn.primary')?.click(); return true; } return false; },
  });
}

// Pick one of a few options. Resolves the chosen id, or null when cancelled.
export function askChoice({ title = 'Choose', text = '', choices = [], cancel = 'Cancel' } = {}) {
  const list = document.createElement('div');
  list.className = 'dlg-choices';
  const buttons = choices.map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dlg-choice';
    b.innerHTML = `<b>${esc(c.label)}</b>${c.sub ? `<span>${esc(c.sub)}</span>` : ''}`;
    list.appendChild(b);
    return b;
  });
  return show({
    title, text, body: list,
    bind: (finish) => buttons.forEach((b, i) => { b.onclick = () => finish(choices[i].id); }),
    initialFocus: () => list.firstChild,
    actions: [{ label: cancel, value: null, cancel: true }],
  });
}

// An information message with one button (the replacement for alert()).
export function notify({ title = 'Note', text = '', ok = 'OK' } = {}) {
  return show({ title, text, actions: [{ label: ok, value: true, primary: true, cancel: true }] });
}

export function dialogOpen() { return !!open; }

// For tests and the console: studioDialog.accept(), .cancel(), .answer('flag'), .title
window.studioDialog = {
  get open() { return !!open; },
  get title() { return open?.title || null; },
  accept() { open?.accept(); },
  cancel() { open?.cancel(); },
  answer(v) { open?.answer(v); },
};
