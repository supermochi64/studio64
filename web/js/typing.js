// Is a text field taking the keys? (editor.js re-exports it; small on purpose: the standalone
// player imports it without pulling in the editor.)

// Keys go to a field that takes them: text fields and lists. A checkbox, slider, colour or
// button that was just clicked keeps the focus too, but must not swallow Delete, Ctrl+Z, Tab...
const NOT_TEXT = /^(checkbox|radio|range|color|button|submit|reset|file|image)$/i;

export function isTyping(a = document.activeElement) {
  if (!a) return false;
  if (a.tagName === 'INPUT') return !NOT_TEXT.test(a.type);
  return a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || !!a.isContentEditable;
}
