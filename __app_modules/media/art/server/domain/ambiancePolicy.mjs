// Offline-reviewed metadata drives playback; no model calls or infrastructure here.
const labels = (values) => new Set(Array.isArray(values)
  ? values.filter((value) => typeof value === 'string').map((value) => value.trim().toLowerCase())
  : []);
const level = (value) => Number.isInteger(value) && value >= 0 && value <= 3;

/** Eligibility is a hard gate, including for pinned pairings and fallbacks. */
export function isEligible(record, profileKey, policy, mediaType = null) {
  const review = record?.review;
  if (!policy || !review || review.status !== 'approved' || !review.profiles?.includes(profileKey)) return false;
  if (!review.reviewer || !review.reviewedAt || !review.reason || !Array.isArray(review.evidence) ||
      !review.evidence.some((item) => item?.kind && (item.path || item.url || item.details))) return false;
  if (!Array.isArray(record.seasons) || !level(record.energy) || !level(record.intensity)) return false;
  if (!level(policy.maxEnergy) || !level(policy.maxIntensity)) return false;
  if (record.energy > policy.maxEnergy || record.intensity > policy.maxIntensity) return false;
  if (mediaType === 'artwork' && policy.allowedMedia && !labels(policy.allowedMedia).has(record.mediumKind)) return false;
  const excluded = labels(policy.excludedSeasons);
  return ![...labels(record.seasons)].some((season) => excluded.has(season));
}

export function areAmbianceCompatible(track, art, policy) {
  if (Math.abs(track.intensity - art.intensity) > 1) return false;
  const trackMoods = labels(track.moods);
  const artMoods = labels(art.moods);
  const opposites = policy.incompatibleMoods || [['celebratory', 'grieving'], ['joyful', 'somber']];
  return !opposites.some(([a, b]) =>
    (trackMoods.has(a) && artMoods.has(b)) || (trackMoods.has(b) && artMoods.has(a)));
}

function relevance(track, art) {
  const weights = { narratives: 12, themes: 6, subjects: 5, symbols: 3, moods: 1 };
  let score = 0;
  const reasons = [];
  for (const [field, weight] of Object.entries(weights)) {
    const a = labels(track[field]);
    for (const value of labels(art[field])) {
      if (!a.has(value)) continue;
      score += weight;
      reasons.push(`${field}:${value}`);
    }
  }
  return { score, reasons };
}

function rested(pool, recentIds) {
  const last = new Map(recentIds.map((id, index) => [id, index]));
  const fresh = pool.filter((item) => !last.has(item.artId));
  if (fresh.length || !pool.length) return fresh;
  // A small thematic pool can run out. Reuse its oldest work, never redraw
  // uniformly from the entire exhausted pool and accidentally repeat the last.
  const oldest = Math.min(...pool.map((item) => last.get(item.artId)));
  return pool.filter((item) => last.get(item.artId) === oldest);
}

function choose(pool, recentIds, random) {
  const choices = rested(pool, recentIds);
  if (!choices.length) return null;
  const draw = Number(random());
  const index = Math.max(0, Math.min(choices.length - 1, Math.floor((Number.isFinite(draw) ? draw : 0) * choices.length)));
  return choices[index];
}

/** Select a reviewed image; portrait companions use the same hard gates. */
export function selectAmbianceArtwork({ track, artworks = {}, profileKey, policy, recentIds = [], overrides = {}, random }) {
  if (!isEligible(track, profileKey, policy)) return null;
  const eligible = Object.entries(artworks).filter(([, art]) => isEligible(art, profileKey, policy, 'artwork'));
  const pinned = new Set(Array.isArray(overrides[track.id]) ? overrides[track.id] : []);
  const explicit = eligible.filter(([id]) => pinned.has(id)).map(([artId]) => ({ artId, kind: 'override', reasons: ['curated-pairing'] }));
  if (explicit.length) return choose(explicit, recentIds, random);

  const scored = eligible.filter(([, art]) => areAmbianceCompatible(track, art, policy)).map(([artId, art]) => ({
    artId, kind: 'matched', ...relevance(track, art),
  })).filter((item) => item.score >= (policy.minScore ?? 3));
  if (scored.length) {
    // Apply recency across ALL suitable matches before narrowing by relevance.
    // Otherwise a lone top-scoring work bypasses history on every request.
    const pool = rested(scored, recentIds);
    const best = Math.max(...pool.map((item) => item.score));
    return choose(pool.filter((item) => item.score >= best * 0.75), [], random);
  }

  const fallbackIds = new Set(policy.fallbackArtIds || []);
  const fallback = eligible.filter(([id, art]) => fallbackIds.has(id) && areAmbianceCompatible(track, art, policy))
    .map(([artId]) => ({ artId, kind: 'fallback', reasons: ['reviewed-fallback'] }));
  return choose(fallback, recentIds, random);
}
