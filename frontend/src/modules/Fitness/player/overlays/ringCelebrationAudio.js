import { DaylightMediaPath } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

let audio = null;
let unlocked = false;
let loggerInstance = null;
const logger = () => (loggerInstance ||= getLogger().child({ component: 'ring-celebration-audio' }));

function element() {
  if (!audio && typeof Audio !== 'undefined') audio = new Audio();
  return audio;
}

/**
 * Dedicated ring sound. It intentionally does not use the governance cue
 * element: a reward should never cut off, duck, or be cut off by a lock cue.
 */
export function playRingCelebrationCue({ sound, volume = 0.8 } = {}) {
  if (!sound) return false;
  const el = element();
  if (!el) return false;
  try {
    el.src = DaylightMediaPath(`/media/${sound}`);
    el.currentTime = 0;
    el.volume = Math.max(0, Math.min(1, Number.isFinite(Number(volume)) ? Number(volume) : 0.8));
    el.muted = false;
    const result = el.play();
    if (result?.catch) result.catch((err) => logger().warn('fitness.ring_cue.rejected', {
      sound, unlocked, name: err?.name ?? null, message: err?.message ?? null,
    }));
    logger().info('fitness.ring_cue.play', { sound, volume: el.volume, unlocked });
    return true;
  } catch (err) {
    logger().warn('fitness.ring_cue.threw', { sound, message: err?.message ?? null });
    return false;
  }
}

/** Prime the dedicated element from an actual gesture for Firefox kiosk autoplay. */
export function installRingCelebrationAudioUnlock(target = typeof window !== 'undefined' ? window : null) {
  if (!target || unlocked) return () => {};
  const events = ['pointerdown', 'touchstart', 'keydown', 'click'];
  const onGesture = () => {
    const el = element();
    if (!el) return;
    try {
      el.muted = true;
      const result = el.play();
      el.pause();
      el.currentTime = 0;
      el.muted = false;
      unlocked = true;
      events.forEach((name) => target.removeEventListener(name, onGesture));
      if (result?.catch) result.catch(() => {
        // The optimistic gesture prime can still be rejected asynchronously.
        // Re-arm so a later genuine tap gets another chance instead of leaving
        // this kiosk silent for the rest of the session.
        unlocked = false;
        events.forEach((name) => target.addEventListener(name, onGesture, { passive: true }));
      });
    } catch (_) { /* retry on the next gesture */ }
  };
  events.forEach((name) => target.addEventListener(name, onGesture, { passive: true }));
  return () => events.forEach((name) => target.removeEventListener(name, onGesture));
}

export function __resetRingCelebrationAudioForTest() { audio = null; unlocked = false; loggerInstance = null; }
