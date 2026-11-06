/**
 * Candidate word boundaries from raw audio.
 *
 * Speech energy rises at a word onset and falls at its offset. This module
 * computes a short-time energy envelope (dB) and spectral-flux-like change
 * from mono float samples, then proposes boundary candidates near a hint:
 * onsets where energy climbs out of a dip, offsets where it falls into one.
 * The decision model picks among them; nothing here decides which is right.
 */

/**
 * Short-time energy envelope.
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @param {{ winMs?: number, hopMs?: number }} [opts]
 * @returns {{ hop: number, db: Float64Array }} hop in seconds, one value per hop
 */
export function energyEnvelope(samples, sampleRate, { winMs = 20, hopMs = 5 } = {}) {
  const win = Math.max(1, Math.round((winMs / 1000) * sampleRate));
  const hop = Math.max(1, Math.round((hopMs / 1000) * sampleRate));
  const n = Math.max(0, Math.floor((samples.length - win) / hop) + 1);
  const db = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const off = i * hop;
    for (let k = 0; k < win; k++) { const v = samples[off + k]; s += v * v; }
    db[i] = 10 * Math.log10(s / win + 1e-10);
  }
  return { hop: hop / sampleRate, win: win / sampleRate, db };
}

function smooth(arr, radius) {
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let s = 0; let c = 0;
    for (let k = -radius; k <= radius; k++) { const j = i + k; if (j >= 0 && j < arr.length) { s += arr[j]; c++; } }
    out[i] = s / c;
  }
  return out;
}

/**
 * Boundary candidates in an audio clip.
 *
 * Onsets are upward crossings of several levels between the clip's noise
 * floor and its speech peak; offsets are downward crossings. Several levels
 * give the model alternatives (a soft "h" starts lower than a hard "g").
 * A clip with under 12 dB of dynamic range yields no candidates.
 *
 * @param {{ samples: Float32Array, sampleRate: number, t0: number }} clip
 * @param {{ kind: 'onset'|'offset', near?: number, within?: number, max?: number, minGap?: number, levels?: number[] }} opts
 *   near/within restrict to |t - near| <= within (media seconds); max caps the count; minGap spaces them.
 * @returns {Array<{ t: number, strength: number }>} media times, sorted by time
 */
export function boundaryCandidates(clip, { kind, near = null, within = Infinity, max = 6, minGap = 0.04, levels = [0.12, 0.25, 0.45] } = {}) {
  const { hop, win, db } = energyEnvelope(clip.samples, clip.sampleRate);
  if (db.length < 5) return [];
  const sm = smooth(db, 1);
  const sorted = Array.from(sm).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const peak = sorted[Math.floor(sorted.length * 0.98)];
  const range = peak - floor;
  if (range < 12) return [];
  const center = (i) => clip.t0 + i * hop + win / 2;

  const cands = [];
  for (const frac of levels) {
    const level = floor + frac * range;
    for (let i = 1; i < sm.length; i++) {
      const up = sm[i - 1] < level && sm[i] >= level;
      const down = sm[i - 1] >= level && sm[i] < level;
      if ((kind === 'onset' && !up) || (kind === 'offset' && !down)) continue;
      // Ignore blips: the far side must stay across the level for >= 30 ms
      const hold = Math.round(0.03 / hop);
      let ok = true;
      for (let k = 0; k < hold && i + k < sm.length; k++) {
        if (kind === 'onset' ? sm[i + k] < level : sm[i + k] >= level) { ok = false; break; }
      }
      if (!ok) continue;
      const frac2 = (level - sm[i - 1]) / (sm[i] - sm[i - 1] || 1);
      const t = center(i - 1 + frac2);
      if (near != null && Math.abs(t - near) > within) continue;
      // Strength: how far the energy travels on the far side of the crossing
      const look = Math.min(sm.length - 1, i + Math.round(0.08 / hop));
      const back = Math.max(0, i - Math.round(0.08 / hop));
      const strength = Math.abs(sm[kind === 'onset' ? look : back] - sm[kind === 'onset' ? back : look]) / range;
      cands.push({ t, strength });
    }
  }
  cands.sort((a, b) => b.strength - a.strength);
  const kept = [];
  for (const c of cands) {
    if (kept.every((k) => Math.abs(k.t - c.t) >= minGap)) kept.push(c);
    if (kept.length >= max) break;
  }
  return kept.sort((a, b) => a.t - b.t).map((c) => ({ t: Math.round(c.t * 1000) / 1000, strength: Math.round(c.strength * 100) / 100 }));
}

/** Evenly spaced markers across [t0, t1] (fallback when energy gives no clear candidates). */
export function evenMarkers(t0, t1, count) {
  if (count < 2) return [{ t: (t0 + t1) / 2 }];
  return Array.from({ length: count }, (_, i) => ({ t: Math.round((t0 + ((t1 - t0) * i) / (count - 1)) * 1000) / 1000 }));
}
