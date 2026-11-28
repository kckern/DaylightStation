import { useEffect } from 'react';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-no-soft-keyboard' });
  return _logger;
}

// ── No on-screen keyboard on the kiosk ─────────────────────────────────────
// The piano tablet has a piano, not a keyboard. Tapping a text field (the
// Composer's song title, a library search) raised Android's keyboard over the
// bottom half of the screen and squeezed the app into the top half
// (2026-11-27: a child tapped the title over and over, typed nothing, and
// spent minutes looking at a half-size Composer). On the kiosk every text
// field gets `inputmode="none"` before it can take focus, so the WebView never
// asks for the keyboard. Fields still work with a physical keyboard.
//
// A field that genuinely needs typing on the tablet (the Bluetooth pairing
// PIN, a grown-up's one-off) opts back in with `data-soft-keyboard="allow"`.

const NON_TEXT = new Set(['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file', 'image', 'hidden']);

export function isTextField(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  return !NON_TEXT.has((el.getAttribute('type') || 'text').toLowerCase());
}

export function suppressSoftKeyboard(el) {
  if (!isTextField(el)) return false;
  if (el.closest?.('[data-soft-keyboard="allow"]')) return false;
  if (el.getAttribute('inputmode') === 'none') return false;
  el.setAttribute('inputmode', 'none');
  logger().debug('suppressed', { tag: el.tagName, type: el.getAttribute('type') || null, label: el.getAttribute('aria-label') || null });
  return true;
}

/**
 * Keep Android's on-screen keyboard from opening anywhere in the kiosk.
 * Marks the field on pointerdown (before the tap focuses it) and again on
 * focusin (programmatic focus, autofocus), both in the capture phase.
 *
 * @param {boolean} enabled - true on the kiosk device only
 */
export function useNoSoftKeyboard(enabled) {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined;
    const onEvent = (event) => { suppressSoftKeyboard(event.target); };
    // Fields already on the page (an autofocused one) are marked up front.
    document.querySelectorAll('input, textarea, [contenteditable]').forEach(suppressSoftKeyboard);
    document.addEventListener('pointerdown', onEvent, true);
    document.addEventListener('focusin', onEvent, true);
    logger().info('enabled');
    return () => {
      document.removeEventListener('pointerdown', onEvent, true);
      document.removeEventListener('focusin', onEvent, true);
    };
  }, [enabled]);
}
