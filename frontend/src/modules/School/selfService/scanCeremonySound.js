/**
 * scanCeremonySound — the audible half of the scan ceremony (Slice D2,
 * omr-grading-integrity design).
 *
 * Synthesized via WebAudio oscillator + gain envelope — the same pattern
 * `journeySfx.js` (Gaming) already uses in this frontend — rather than
 * loading an audio asset, so there is nothing to fail to fetch.
 *
 * Probed on the Portal panel's own FKB REST API (2026-08-22):
 * `autoplayAudio: true`, so a programmatic `AudioContext` cue should sound
 * without a prior gesture on this device — but a WebView flag permitting
 * autoplay and audio actually reaching the speaker are two different claims,
 * so this must never be the ONLY acknowledgement (see ScanCeremony.jsx's
 * visible banner, which renders regardless of whether this played).
 *
 * Routed through the screen-framework's software volume master
 * (`getEffectiveMaster()` — the same module-scope mirror
 * `useSpaceInvadersGame.js` already reads for its own buzzer) so the cue
 * rides the Portal's `volume.defaultMaster` curve (`portal.yml`) instead of
 * playing at raw full volume — otherwise the ceremony would be the loudest
 * thing in the room. Deliberately NOT the FKB alarm path
 * (`playAlarmSoundOnMovement`/`alarmSoundFileUrl`) — that is a different
 * subsystem with its own volume, and the Portal's Control Center already had
 * to be disabled once over it (see `portal.yml`).
 */
import { getEffectiveMaster } from '../../../lib/volume/ScreenVolumeContext.js';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'scan-ceremony-sound' });
  return _logger;
}

// Three deliberately distinct patterns, so the SOUND alone — a child glancing
// away from the screen mid-scan — says which family landed before the words
// are even read:
//   success — a short RISING pair (good news climbs)
//   warn    — a single held mid tone (pause — go get someone; not alarming)
//   error   — a low DOUBLE-BUZZ (the "that didn't work" buzzer, twice)
// Each note is [frequency, delaySeconds, durationSeconds].
const PATTERNS = Object.freeze({
  success: { wave: 'triangle', peak: 0.22, notes: [[660, 0, 0.11], [880, 0.1, 0.16]] },
  warn: { wave: 'sine', peak: 0.2, notes: [[494, 0, 0.26]] },
  error: { wave: 'square', peak: 0.18, notes: [[190, 0, 0.13], [190, 0.19, 0.13]] },
});

let _ctx = null;
function audioContext() {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) return null;
  _ctx ||= new AudioContextClass();
  if (_ctx.state === 'suspended') _ctx.resume().catch(() => {});
  return _ctx;
}

/**
 * Play the tone for a ceremony tone family. Never throws — every failure
 * (no AudioContext in this environment, a blocked/suspended context, a muted
 * software master, an oscillator error) is swallowed and logged at most at
 * `warn`. Callers must never let the visible ceremony depend on this
 * succeeding.
 *
 * @param {'success'|'warn'|'error'} tone
 * @returns {boolean} true if playback was attempted (never a guarantee it was heard)
 */
export function playScanCeremonyTone(tone) {
  const pattern = PATTERNS[tone];
  if (!pattern) return false;
  try {
    const ctx = audioContext();
    if (!ctx) return false;
    const master = getEffectiveMaster();
    if (!(master > 0)) return false; // muted master: nothing to route the cue through
    for (const [frequency, delay, duration] of pattern.notes) {
      const start = ctx.currentTime + delay;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = pattern.wave;
      oscillator.frequency.setValueAtTime(frequency, start);
      const peak = Math.max(pattern.peak * master, 0.0001);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    }
    return true;
  } catch (err) {
    logger().warn('play-failed', { tone, error: err?.message });
    return false;
  }
}

// Test-only: drop the cached AudioContext so a test's own mock takes effect
// on the next call. Not part of the public API.
export function _resetForTests() {
  _ctx = null;
}

export default playScanCeremonyTone;
