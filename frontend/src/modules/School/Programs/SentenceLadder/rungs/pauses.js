/**
 * Where the model sentence breathes, and where a learner's cut belongs.
 *
 * A child presses → a beat AFTER the word they meant — reaction time is a
 * quarter second or so — so a raw cut starts the next piece mid-syllable. The
 * model audio has real phrase breaks (sentence 900: one clean 0.22s gap at
 * 3.6s of 5.7s), and a cut that lands just past one belongs on it.
 *
 * Pure: samples in, milliseconds out. Decoding lives in `useModelPauses`.
 */

/** RMS below this is silence in the model recordings (studio-clean). */
export const PAUSE_FLOOR = 0.02;
/** Shorter than this is a stop consonant, not a phrase break. */
export const MIN_PAUSE_MS = 120;
/** How far back a cut may snap. Past this, the learner meant where they pressed. */
export const SNAP_WINDOW_MS = 500;
const FRAME_MS = 10;

/**
 * Midpoints (ms) of the silences INSIDE the sentence. Leading and trailing
 * silence are excluded: a cut there would make an empty piece.
 */
export function findPauses(samples, sampleRate, { floor = PAUSE_FLOOR, minPauseMs = MIN_PAUSE_MS } = {}) {
  const frame = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
  const pauses = [];
  let quietSince = null;
  let spoken = false;
  for (let i = 0; i < samples.length; i += frame) {
    const end = Math.min(samples.length, i + frame);
    let sum = 0;
    for (let j = i; j < end; j += 1) sum += samples[j] * samples[j];
    const rms = Math.sqrt(sum / (end - i));
    const ms = (i / sampleRate) * 1000;
    if (rms < floor) {
      if (quietSince == null) quietSince = ms;
    } else {
      if (quietSince != null && spoken && ms - quietSince >= minPauseMs) {
        pauses.push(Math.round((quietSince + ms) / 2));
      }
      quietSince = null;
      spoken = true;
    }
  }
  return pauses;
}

/** The latest pause at or before `rawMs` and within the window; else `rawMs`. */
export function snapCut(rawMs, pauses, { windowMs = SNAP_WINDOW_MS } = {}) {
  let best = null;
  for (const p of pauses) if (p <= rawMs && rawMs - p <= windowMs) best = p;
  return best ?? rawMs;
}
