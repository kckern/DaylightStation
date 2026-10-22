/**
 * The coin ceremony's sound: a dedicated <audio> element, the pattern of the
 * fitness ring celebration (`wellness/fitness/browser/player/overlays/
 * ringCelebrationAudio.js`). The file lives on the MEDIA MOUNT, never in the
 * repo: `sound` is a media-relative path (default `school/_ux/coin.mp3`, see
 * `coinCeremonyModel.js`), resolved through `DaylightMediaPath`.
 *
 * Rides the screen's software master volume (`getEffectiveMaster()`), as the
 * scan ceremony does (`selfService/scanCeremonySound.js`), so the cue follows
 * the Portal's volume curve and a muted panel stays silent. Never throws: the
 * pop-up must not depend on the sound.
 */
import { DaylightMediaPath } from "../../../../../frontend/src/lib/api.mjs";
import { getEffectiveMaster } from "../../../../../frontend/src/lib/volume/ScreenVolumeContext.js";
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";

let audio = null;
let unlocked = false;
let _logger = null;
const logger = () => (_logger ||= getLogger().child({ component: 'school-coin-cue' }));

function element() {
  if (!audio && typeof Audio !== 'undefined') audio = new Audio();
  return audio;
}

export function playCoinCue({ sound, volume = 0.8 } = {}) {
  if (!sound) return false;
  const master = getEffectiveMaster();
  if (!(master > 0)) {
    logger().debug('school.coin_cue.muted', { sound });
    return false;
  }
  const el = element();
  if (!el) return false;
  try {
    el.src = DaylightMediaPath(`/media/${sound}`);
    el.currentTime = 0;
    const base = Number.isFinite(Number(volume)) ? Number(volume) : 0.8;
    el.volume = Math.max(0, Math.min(1, base * master));
    el.muted = false;
    const result = el.play();
    if (result?.catch) {
      result.catch((err) => logger().warn('school.coin_cue.rejected', {
        sound, unlocked, name: err?.name ?? null, message: err?.message ?? null,
      }));
    }
    logger().info('school.coin_cue.play', { sound, volume: el.volume, unlocked });
    return true;
  } catch (err) {
    logger().warn('school.coin_cue.threw', { sound, message: err?.message ?? null });
    return false;
  }
}

/** Prime the element from a real gesture so a kiosk WebView lets it play later. */
export function installCoinCueUnlock(target = typeof window !== 'undefined' ? window : null) {
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
      if (result?.catch) {
        result.catch(() => {
          // A rejected prime re-arms, so a later tap gets another chance.
          unlocked = false;
          events.forEach((name) => target.addEventListener(name, onGesture, { passive: true }));
        });
      }
    } catch { /* retry on the next gesture */ }
  };
  events.forEach((name) => target.addEventListener(name, onGesture, { passive: true }));
  return () => events.forEach((name) => target.removeEventListener(name, onGesture));
}

export function __resetCoinCueForTest() { audio = null; unlocked = false; _logger = null; }
