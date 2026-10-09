import { MAX_RUNG, MIN_RUNG } from './dimensions.js';

/**
 * Whether a player has outgrown their reading level.
 *
 * This is deliberately NOT "did you win". Conflating the two is exactly what
 * makes a single ladder unable to serve both a strong reader who is a weak
 * player and a strong player who cannot read — the two children this whole
 * separation exists for. A child can lose every game while addressing every
 * square first time, and that child should be moving up the reading ladder while
 * staying on a gentle opponent.
 *
 * So the signal is about the ADDRESS, not the game:
 *
 *   `addressed`  — a press that named a square
 *   `rejected`   — a press that named nothing, or the wrong kind of thing
 *   `msToFirst`  — how long from the turn starting to the first correct address
 *   `railReads`  — how often the rim had to be consulted (a held note that lit
 *                  an axis card without committing)
 *
 * Promotion wants accuracy AND fluency, because either alone is a false read: a
 * player who never mis-addresses but takes fifteen seconds a move is still
 * spelling it out letter by letter, and a fast player who is wrong half the time
 * is guessing.
 */

export const DEFAULT_PROMOTION = Object.freeze({
  window: 20,           // look at the last N addresses
  accuracy: 0.85,       // ...and promote at this hit rate
  medianMs: 6000,       // ...if the median time to a correct address is under this
  minSamples: 12,       // never judge on a handful
});

/** A fresh, empty record. Kept flat so it serialises straight into the ladder. */
export function createAddressingProgress(rung = MIN_RUNG) {
  return { rung, samples: [] };
}

/**
 * Record one attempt.
 *
 * `ok` is whether the press named a square. `ms` is from the turn starting, so a
 * player who reads the rim, thinks, and then plays correctly is recorded as slow
 * and correct rather than as two separate events.
 */
export function recordAddress(progress, { ok, ms = null, railRead = false }, promotion = DEFAULT_PROMOTION) {
  const window = Math.max(1, Math.floor(promotion.window ?? DEFAULT_PROMOTION.window));
  const samples = [...(progress?.samples ?? []), { ok: !!ok, ms: Number.isFinite(ms) ? ms : null, railRead: !!railRead }];
  return { ...progress, samples: samples.slice(-window) };
}

/** Accuracy, median time, and how often the rim was needed, over the window. */
export function addressingStats(progress) {
  const samples = progress?.samples ?? [];
  if (!samples.length) return { samples: 0, accuracy: null, medianMs: null, railReadRate: null };
  const hits = samples.filter((sample) => sample.ok);
  const times = hits.map((sample) => sample.ms).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    samples: samples.length,
    accuracy: hits.length / samples.length,
    // Median, not mean: one interruption — a sibling walking up, a dropped
    // Bluetooth link — should not move the number that decides a promotion.
    medianMs: times.length ? times[Math.floor(times.length / 2)] : null,
    railReadRate: samples.filter((sample) => sample.railRead).length / samples.length,
  };
}

/**
 * Should this player move up, down, or stay?
 *
 * Demotion exists and promotion does not undo it: a rung that turns out to be
 * too hard should hand the player back something they can play rather than
 * leaving them stuck in front of a board they cannot address. The threshold for
 * going down is well below the threshold for coming up, so a bad five minutes
 * does not bounce a child between rungs.
 */
export function evaluateAddressing(progress, promotion = DEFAULT_PROMOTION) {
  const rules = { ...DEFAULT_PROMOTION, ...(promotion || {}) };
  const stats = addressingStats(progress);
  const rung = Number.isFinite(progress?.rung) ? progress.rung : MIN_RUNG;
  if (stats.samples < rules.minSamples) {
    return { verdict: 'hold', rung, reason: 'not enough addresses yet', stats };
  }
  const fluent = stats.medianMs === null || stats.medianMs <= rules.medianMs;
  if (stats.accuracy >= rules.accuracy && fluent && rung < MAX_RUNG) {
    return { verdict: 'promote', rung: rung + 1, reason: 'accurate and fluent', stats };
  }
  // Half the promotion bar. A player addressing worse than one in two is not
  // being taught by this rung, they are being blocked by it.
  if (stats.accuracy < rules.accuracy / 2 && rung > MIN_RUNG) {
    return { verdict: 'demote', rung: rung - 1, reason: 'addressing is not landing', stats };
  }
  return { verdict: 'hold', rung, reason: fluent ? 'accuracy not there yet' : 'accurate but still slow', stats };
}

export default evaluateAddressing;
