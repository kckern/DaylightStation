/**
 * Select the primary media item from a session's media array.
 *
 * Filters out audio, then warmup videos AND deprioritized videos (e.g. kids
 * content). When ≥2 surviving videos are each ≥10 minutes long, picks the
 * LAST one (chronologically latest — typically the main workout). Otherwise
 * picks the longest survivor by durationMs. Falls back to longest video
 * overall if every video is filtered out.
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

  // Step 3: Drop warmup + deprioritized; fall back to all videos if filter empties the pool.
  const candidates = videos.filter(v => !isWarmup(v) && !isDeprioritized(v));
  const pool = candidates.length > 0 ? candidates : videos;

  // Step 4: Positional bias — when ≥2 survivors are each ≥10 minutes long, prefer
  // the LAST one. Events are chronological, and a true main-session video is
  // almost always played AFTER any warmup that survived the filter.
  const TEN_MIN_MS = 10 * 60 * 1000;
  const longSurvivors = pool.filter(v => (v.durationMs || 0) >= TEN_MIN_MS);
  if (longSurvivors.length >= 2) {
    return longSurvivors[longSurvivors.length - 1];
  }

  // Step 5: Fallback — longest survivor wins.
  return pool.reduce((best, item) =>
    (item.durationMs || 0) > (best.durationMs || 0) ? item : best
  );
}

export default selectPrimaryMedia;
