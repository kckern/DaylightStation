/**
 * Select the primary media item from a session's media array.
 *
 * Filters out audio, then applies a four-tier cascade so every session that
 * has any video item ends up with a primary:
 *
 *   T1: Real workouts (non-warmup, non-deprioritized) ≥ MIN_PRIMARY_MS (5 min).
 *       When ≥2 are also ≥10 min, picks the LAST one (chronologically latest);
 *       otherwise picks the longest. This is the main success path.
 *   T2: Any real candidate (non-warmup, non-deprioritized) of any duration.
 *       Longest. (E.g. a 48-second strength demo when the only other content
 *       was a kidsfun-labeled track — the demo is still the user's intended
 *       workout, just brief.)
 *   T3: Non-deprioritized of any kind, allowing warmups but blocking
 *       browsing. Longest. (E.g. stretch-only sessions, or stretch + cartoon
 *       where stretch wins — never primary on browsing if a non-browsing
 *       alternative exists.)
 *   T4: Anything that survived audio filtering, including deprioritized.
 *       Longest. (E.g. Game Cycling sessions where every video is kidsfun;
 *       returns F-Zero rather than nothing.)
 *
 * Returns null only when there are no non-audio items at all.
 *
 * @param {Array} mediaItems - Media summary objects from buildSessionSummary
 * @param {Object} [config] - {
 *   warmup_labels, warmup_description_tags, warmup_title_patterns,
 *   deprioritized_labels
 * }
 * @returns {Object|null} The selected primary media item
 */

const BUILTIN_TITLE_PATTERNS = [
  /warm[\s-]?up/i,
  /cool[\s-]?down/i,
  /stretch/i,
  /cold[\s-]?start/i,  // 2026-05-01: catches Beachbody-style intro episodes
];

/**
 * Build the selection config object that selectPrimaryMedia accepts,
 * from a fitness `plex` config block.
 *
 * Single source of truth for the shape — every call site that needs a
 * selection config should go through this helper.
 */
export function buildSelectionConfig(plex) {
  const p = plex || {};
  return {
    warmup_labels: p.warmup_labels || [],
    warmup_description_tags: p.warmup_description_tags || [],
    warmup_title_patterns: p.warmup_title_patterns || [],
    deprioritized_labels: p.deprioritized_labels || [],
  };
}

export function selectPrimaryMedia(mediaItems, config) {
  if (!Array.isArray(mediaItems) || mediaItems.length === 0) return null;

  // Step 1: Filter out audio
  const videos = mediaItems.filter(m => m.mediaType !== 'audio');
  if (videos.length === 0) return null;

  // Step 2: Build skip-predicate combining warmup + deprioritized rules
  const titlePatterns = [...BUILTIN_TITLE_PATTERNS];
  if (config?.warmup_title_patterns?.length) {
    for (const p of config.warmup_title_patterns) {
      try { titlePatterns.push(new RegExp(p, 'i')); } catch { /* skip invalid regex */ }
    }
  }
  const descTags = config?.warmup_description_tags || [];
  const warmupLabels = config?.warmup_labels || [];
  const deprioritizedLabels = config?.deprioritized_labels || [];

  function isWarmup(item) {
    if (warmupLabels.length && Array.isArray(item.labels)) {
      for (const label of warmupLabels) {
        if (item.labels.includes(label)) return true;
      }
    }
    if (descTags.length && item.description) {
      for (const tag of descTags) {
        if (item.description.includes(tag)) return true;
      }
    }
    if (item.title) {
      for (const re of titlePatterns) {
        if (re.test(item.title)) return true;
      }
    }
    return false;
  }

  // Pre-lowercase config labels once for case-insensitive matching (session
  // events persist labels lowercased; config uses CamelCase).
  const deprioritizedLowered = deprioritizedLabels.map(l => String(l).toLowerCase());

  function isDeprioritized(item) {
    if (!deprioritizedLowered.length || !Array.isArray(item.labels)) return false;
    const itemLowered = item.labels.map(l => String(l).toLowerCase());
    for (const label of deprioritizedLowered) {
      if (itemLowered.includes(label)) return true;
    }
    return false;
  }

  // Step 3: Constants for the cascade.
  const MIN_PRIMARY_MS = 5 * 60 * 1000;
  const TEN_MIN_MS = 10 * 60 * 1000;

  // Step 4: Tier 1 — Eligible real workouts (≥ MIN_PRIMARY_MS, non-warmup, non-deprio).
  // Positional bias when ≥2 are also ≥10 min — events are chronological so the LAST
  // one is almost always the actual main workout, not a warmup that survived filtering.
  const realCandidates = videos.filter(v => !isWarmup(v) && !isDeprioritized(v));
  const eligible = realCandidates.filter(v => (v.durationMs || 0) >= MIN_PRIMARY_MS);
  if (eligible.length > 0) {
    const longSurvivors = eligible.filter(v => (v.durationMs || 0) >= TEN_MIN_MS);
    if (longSurvivors.length >= 2) {
      return longSurvivors[longSurvivors.length - 1];
    }
    return eligible.reduce((best, item) =>
      (item.durationMs || 0) > (best.durationMs || 0) ? item : best
    );
  }

  // Step 5: Tier 2 — any real candidate (drops the floor, still non-warmup non-deprio).
  if (realCandidates.length > 0) {
    return realCandidates.reduce((best, item) =>
      (item.durationMs || 0) > (best.durationMs || 0) ? item : best
    );
  }

  // Step 6: Tier 3 — non-deprioritized of any kind (allows warmups but blocks browsing).
  // E.g. stretch-only sessions, or [stretch + cartoon] where stretch wins.
  const nonDeprio = videos.filter(v => !isDeprioritized(v));
  if (nonDeprio.length > 0) {
    return nonDeprio.reduce((best, item) =>
      (item.durationMs || 0) > (best.durationMs || 0) ? item : best
    );
  }

  // Step 7: Tier 4 — anything that survived audio filtering. Last-resort browsing.
  // E.g. Game Cycling sessions where every video is kidsfun-labeled.
  return videos.reduce((best, item) =>
    (item.durationMs || 0) > (best.durationMs || 0) ? item : best
  );
}

export default selectPrimaryMedia;
