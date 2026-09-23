// "Did the person just Tab here?" — for UI that should react to keyboard
// navigation but not to programmatic focus (a sheet returning focus to its
// opener) or to a tap. Stricter than :focus-visible, which browsers also grant
// to script-driven focus after any keyboard use (e.g. Escape closing a sheet).
//
// One capture-phase listener pair per document, installed on first use.
const TAB_WINDOW_MS = 1000;
let lastTabAt = -Infinity;
let installed = false;

function install() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('keydown', (event) => { lastTabAt = event.key === 'Tab' ? Date.now() : -Infinity; }, true);
  document.addEventListener('pointerdown', () => { lastTabAt = -Infinity; }, true);
}

/** Call once early (e.g. module scope of a consumer) so the first Tab is seen. */
export function trackKeyboardModality() { install(); }

/** True when the most recent key was Tab, within the last second, with no pointer since. */
export function focusCameFromTab() {
  install();
  return Date.now() - lastTabAt < TAB_WINDOW_MS;
}
