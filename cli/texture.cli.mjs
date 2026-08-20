#!/usr/bin/env node

/**
 * Texture CLI — find movement boundaries where there is no silence to find.
 *
 * MEASURED, AND THE REASON THIS EXISTS. On the Sydney recording only 20 of 53
 * boundaries produce a detectable gap, and loosening silence detection to
 * -45 dB / 0.25 s yields 165 candidates against 142 — 16% more where two or three
 * times as many are needed. Those movements run *attacca*: the music does not
 * stop, the SCORING changes. A recitative over continuo giving way to a
 * full-orchestra air is a different distribution of energy across the spectrum
 * even when nothing goes quiet and nothing gets louder.
 *
 * So the feature is the SHAPE of the spectrum, normalised so loudness cannot
 * register as texture, and a boundary is where that shape changes most sharply.
 *
 * WHERE TO LOOK IS GIVEN, NOT SEARCHED. Sweeping 134 minutes for spectral change
 * would produce hundreds of candidates and put us back where the silence pass
 * left off. The tempo-ratio model predicts each number's start to a median 9 s
 * (measured against the 20 boundaries that ARE detectable), so this searches a
 * small window around a prediction — verification, not selection.
 *
 * Usage:
 *   node cli/texture.cli.mjs <bandFile...> --predictions <file.json>
 *
 * @module cli/texture
 */

/** A level at or below this is silence; it carries no texture. */
const DB_FLOOR = -120;

/**
 * Each band's share of the total energy.
 *
 * dB is logarithmic, so the levels are converted to linear power before being
 * normalised — averaging decibels directly would weight quiet bands as heavily
 * as loud ones and blur exactly the contrast this is measuring.
 *
 * LOUDNESS MUST NOT REGISTER AS TEXTURE: the same music 10 dB louder is the same
 * movement, and a profile that moved with volume would fire at every crescendo
 * while missing every attacca join. Normalising to shares removes it.
 */
export function bandProfile(dbs) {
  const power = dbs.map((db) => (Number.isFinite(db) && db > DB_FLOOR ? 10 ** (db / 10) : 0));
  const total = power.reduce((a, b) => a + b, 0);
  // Silence has no shape. A flat profile is the honest answer and keeps every
  // downstream distance finite.
  if (!(total > 0)) return dbs.map(() => 1 / dbs.length);
  return power.map((p) => p / total);
}

/** Mean profile over a run of frames. */
function meanProfile(frames) {
  const n = frames[0].bands.length;
  const acc = new Array(n).fill(0);
  for (const f of frames) {
    const p = bandProfile(f.bands);
    for (let i = 0; i < n; i += 1) acc[i] += p[i];
  }
  return acc.map((v) => v / frames.length);
}

/**
 * How different the texture is either side of second `t`, 0..1.
 *
 * The distance is total-variation — half the sum of absolute differences between
 * two distributions — which is bounded, symmetric, and reads directly as "this
 * fraction of the spectrum's energy moved bands".
 *
 * Returns `null` rather than a number where there is not a full window on both
 * sides: a half-window comparison is a different measurement, and quietly
 * mixing the two would make the curve's ends incomparable with its middle.
 */
export function textureNovelty(frames, t, { halfWindowS = 10 } = {}) {
  const byT = frames.byT ?? new Map(frames.map((f) => [f.t, f]));
  const before = [];
  const after = [];
  for (let k = 1; k <= halfWindowS; k += 1) {
    const b = byT.get(t - k);
    const a = byT.get(t + k - 1);
    if (!b || !a) return null;
    before.push(b);
    after.push(a);
  }
  const p = meanProfile(before);
  const q = meanProfile(after);
  return p.reduce((s, v, i) => s + Math.abs(v - q[i]), 0) / 2;
}

/** Novelty at every second that has a full window either side. */
export function noveltyCurve(frames, { halfWindowS = 10 } = {}) {
  const byT = new Map(frames.map((f) => [f.t, f]));
  const decorated = frames.slice();
  decorated.byT = byT;
  const out = [];
  for (const f of frames) {
    const novelty = textureNovelty(decorated, f.t, { halfWindowS });
    if (novelty !== null) out.push({ t: f.t, novelty });
  }
  return out;
}

/**
 * The sharpest texture change within `radiusS` of a predicted time.
 *
 * `minNovelty` IS THE POINT OF THE FUNCTION. The unconfirmed predictions include
 * numbers this performance may have cut, where there is no boundary to find —
 * and returning the window's least-flat second regardless would invent one.
 * Every previous attempt at this problem failed in some version of that way, so
 * a window whose best score does not clear the floor returns `null`.
 */
export function bestBoundaryIn(frames, {
  centreS, radiusS = 30, halfWindowS = 10, minNovelty = 0,
} = {}) {
  const byT = new Map(frames.map((f) => [f.t, f]));
  const decorated = frames.slice();
  decorated.byT = byT;
  let best = null;
  for (let t = Math.round(centreS - radiusS); t <= Math.round(centreS + radiusS); t += 1) {
    const novelty = textureNovelty(decorated, t, { halfWindowS });
    if (novelty === null) continue;
    if (!best || novelty > best.novelty) best = { t, novelty, offsetS: t - centreS };
  }
  if (!best || best.novelty < minNovelty) return null;
  return best;
}
