/**
 * Fit the source clock to the file clock: local = source * scale + offset.
 *
 * Pairs come from unambiguous matches (one tagged word, one transcript hit
 * nearby). A robust fit: median offset first, inliers within `tol` of it,
 * then least squares on the inliers. Scale matters: a 24 vs 23.976 fps
 * source drifts ~7 s over two hours.
 */

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/**
 * @param {Array<{ x: number, y: number }>} pairs - x source seconds, y local seconds
 * @returns {{ scale: number, offset: number, used: number, total: number, medResid: number }|null}
 */
export function fitSync(pairs, { tol = 3, minPairs = 6, maxScaleDev = 0.01 } = {}) {
  if (pairs.length < minPairs) return null;
  // Iterate: offset-only inliers -> 2-param fit -> re-select inliers on the fit
  let scale = 1; let offset = median(pairs.map((p) => p.y - p.x));
  let inl = pairs;
  for (let iter = 0; iter < 3; iter++) {
    inl = pairs.filter((p) => Math.abs(p.y - (p.x * scale + offset)) <= tol);
    if (inl.length < minPairs) return null;
    const n = inl.length;
    const mx = inl.reduce((s, p) => s + p.x, 0) / n; const my = inl.reduce((s, p) => s + p.y, 0) / n;
    const sxx = inl.reduce((s, p) => s + (p.x - mx) ** 2, 0); const sxy = inl.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
    if (sxx > 0) { scale = sxy / sxx; offset = my - scale * mx; }
    if (Math.abs(scale - 1) > maxScaleDev) { scale = 1; offset = median(inl.map((p) => p.y - p.x)); }
  }
  const medResid = median(inl.map((p) => Math.abs(p.y - (p.x * scale + offset))));
  return { scale: Number(scale.toFixed(6)), offset: Number(offset.toFixed(3)), used: inl.length, total: pairs.length, medResid: Number(medResid.toFixed(3)) };
}

/**
 * Pairs for fitSync from tagged words and a transcript, with no prior sync.
 * Every (tag, matching word within ±maxShift) difference votes into 1 s bins;
 * the winning bin gives a coarse offset; then each tag keeps its match only
 * when exactly one word lies within ±near of the coarse guess.
 * @param {Array<{ t: number, match: (w: string) => boolean, id?: string }>} tags - source time + word matcher
 * @param {Array<{ w: string, s: number }>} words - transcript words (local time)
 */
export function wordPairs(tags, words, { maxShift = 90, near = 6 } = {}) {
  const votes = new Map();
  for (const tag of tags) {
    for (const w of words) {
      const d = w.s - tag.t;
      if (Math.abs(d) <= maxShift && tag.match(w.w)) {
        const bin = Math.round(d);
        votes.set(bin, (votes.get(bin) || 0) + 1);
      }
    }
  }
  if (!votes.size) return { coarse: null, pairs: [] };
  // Smooth over neighbouring bins (VidAngel jitters by a second or two)
  let best = null;
  for (const bin of votes.keys()) {
    const score = (votes.get(bin - 1) || 0) + votes.get(bin) + (votes.get(bin + 1) || 0);
    if (!best || score > best.score) best = { bin, score };
  }
  const coarse = best.bin;
  const pairs = [];
  for (const tag of tags) {
    const hits = words.filter((w) => Math.abs(w.s - (tag.t + coarse)) <= near && tag.match(w.w));
    if (hits.length === 1) pairs.push({ x: tag.t, y: hits[0].s, wi: words.indexOf(hits[0]), ...(tag.id != null ? { id: tag.id } : {}) });
  }
  return { coarse, pairs };
}
