import getLogger from '@/lib/logging/Logger.js';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'audio-cue-player' }));

let _el = null;
let _unlocked = false;

/** The single shared HTMLAudioElement used for all cue SFX (created lazily). */
export function getCueAudioElement() {
  if (!_el && typeof Audio !== 'undefined') _el = new Audio();
  return _el;
}

export function isCueAudioUnlocked() { return _unlocked; }

/**
 * Grant the shared element user-activation by playing it muted then pausing —
 * the standard trick to defeat WebView/mobile autoplay gating. Idempotent;
 * must be called from within a real user-gesture handler to take effect.
 * @param {string} [trigger] - audit label for what initiated the prime.
 */
export function primeCueAudio(trigger = 'manual') {
  if (_unlocked) return true;
  const el = getCueAudioElement();
  if (!el) { logger().warn('audio_cue.unlock_no_element', { trigger }); return false; }
  try {
    el.muted = true;
    const p = el.play();
    // Optimistically mark unlocked and pause synchronously: the play() call
    // within a user gesture grants activation immediately. The returned promise
    // is only used to roll back if play() actually rejected (autoplay denied).
    try { el.pause(); } catch { /* noop */ }
    el.currentTime = 0; el.muted = false; _unlocked = true;
    logger().info('audio_cue.unlocked', { trigger });
    if (p && typeof p.catch === 'function') {
      p.catch((err) => { _unlocked = false; el.muted = false; logger().warn('audio_cue.unlock_failed', { trigger, name: err?.name ?? null, message: err?.message ?? null }); });
    }
  } catch (err) {
    logger().warn('audio_cue.unlock_threw', { trigger, message: err?.message ?? null });
  }
  return _unlocked;
}

/**
 * Attach one-time gesture listeners to `target` (defaults to window) that prime
 * the cue element on the first interaction, then self-remove once unlocked.
 * Returns a manual remover. Safe to call repeatedly.
 */
export function installCueAudioUnlock(target = (typeof window !== 'undefined' ? window : null)) {
  if (!target || _unlocked) return () => {};
  const events = ['pointerdown', 'touchstart', 'keydown', 'click'];
  const remove = () => events.forEach((e) => target.removeEventListener(e, handler));
  function handler(e) { primeCueAudio(e?.type ? `gesture:${e.type}` : 'gesture'); if (_unlocked) remove(); }
  events.forEach((e) => target.addEventListener(e, handler, { passive: true }));
  logger().debug('audio_cue.unlock_listeners_installed', { events });
  return remove;
}

/** Test-only: reset module singleton state. */
export function __resetCueAudioForTest() { _el = null; _unlocked = false; }
