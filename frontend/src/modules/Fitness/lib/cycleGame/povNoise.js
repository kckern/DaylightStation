/**
 * Smooth, organic camera noise for the POV grid. A sum of low-frequency sines at
 * incommensurate periods → a continuous value in ~[-1, 1] that never repeats on a
 * short loop and, crucially, is C-infinity smooth in time (no per-frame jitter). The
 * seed offsets the phases so each race gets its own ebb/flow.
 *
 * Pure: feed it `performance.now() / 1000` from the caller (kept out so this stays
 * unit-testable and deterministic).
 */

// Periods chosen incommensurate (≈7.7s, 3.4s, 2.1s) so the sum drifts for a long
// while before re-aligning — reads as natural breathing, not a metronome.
const FREQS = [0.13, 0.29, 0.47]; // Hz
const AMPS = [0.6, 0.3, 0.1];     // sum = 1 → output in [-1, 1]

/**
 * Build a noise channel. `seed` shifts every octave's phase so two channels (or two
 * races) with different seeds are decorrelated.
 * @param {number} seed
 * @returns {(tSec: number) => number} value in ~[-1, 1]
 */
export function makeSmoothNoise(seed = 0) {
  const phase = FREQS.map((_, i) => ((seed + 1) * (i + 1) * 1.37) % (Math.PI * 2));
  return (tSec) => {
    const t = Number.isFinite(tSec) ? tSec : 0;
    let v = 0;
    for (let i = 0; i < FREQS.length; i++) {
      v += AMPS[i] * Math.sin(t * FREQS[i] * 2 * Math.PI + phase[i]);
    }
    return v;
  };
}

export default makeSmoothNoise;
