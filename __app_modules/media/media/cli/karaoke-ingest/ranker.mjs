function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokens(s) {
  return normalize(s).split(' ').filter(Boolean);
}
function titleContainsAll(title, phrase) {
  const t = normalize(title);
  return tokens(phrase).every((tok) => t.includes(tok));
}
function hasAny(title, terms) {
  const t = normalize(title);
  return terms.some((term) => t.includes(normalize(term)));
}
function channelBonus(channel, weights) {
  const c = normalize(channel);
  for (const [name, w] of Object.entries(weights || {})) {
    if (c.includes(normalize(name))) return w;
  }
  return 0;
}

export function scoreCandidate(cand, { song, artist }, cfg) {
  const title = cand.title || '';
  if (!hasAny(title, cfg.karaokeTerms)) return null;
  if (hasAny(title, cfg.rejectTerms)) return null;
  const dur = cand.duration || 0;
  if (dur < cfg.minDurationS || dur > cfg.maxDurationS) return null;
  if (!titleContainsAll(title, song)) return null;
  let score = Math.log10((cand.viewCount || 0) + 10);
  score += channelBonus(cand.channel, cfg.channelWeights);
  if (titleContainsAll(title, artist)) score += 0.5;
  return score;
}

export function pickBest(cands, meta, cfg) {
  let best = null;
  let bestScore = -Infinity;
  for (const c of cands || []) {
    const s = scoreCandidate(c, meta, cfg);
    if (s === null) continue;
    if (s > bestScore) { bestScore = s; best = c; }
  }
  if (!best || bestScore < cfg.scoreFloor) return null;
  return best;
}
