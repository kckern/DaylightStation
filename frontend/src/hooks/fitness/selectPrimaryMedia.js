/**
 * Select the primary media item from a session's media array.
 *
 * Filters out audio and warmup videos, then picks longest duration.
 * Falls back to longest video overall if all are filtered out.
 *
 * @param {Array} mediaItems - Media summary objects from buildSessionSummary
 * @param {Object} [warmupConfig] - { warmup_labels, warmup_description_tags, warmup_title_patterns }
 * @returns {Object|null} The selected primary media item
 */

const BUILTIN_TITLE_PATTERNS = [
  /warm[\s-]?up/i,
  /cool[\s-]?down/i,
  /stretch/i,
];

export function selectPrimaryMedia(mediaItems, warmupConfig) {
  if (!Array.isArray(mediaItems) || mediaItems.length === 0) return null;

  // Step 1: Filter out audio
  const videos = mediaItems.filter(m => m.mediaType !== 'audio');
  if (videos.length === 0) return null;

  // Step 2: Build warmup matchers
  const titlePatterns = [...BUILTIN_TITLE_PATTERNS];
  if (warmupConfig?.warmup_title_patterns?.length) {
    for (const p of warmupConfig.warmup_title_patterns) {
      try { titlePatterns.push(new RegExp(p, 'i')); } catch { /* skip invalid regex */ }
    }
  }
  const descTags = warmupConfig?.warmup_description_tags || [];
  const warmupLabels = warmupConfig?.warmup_labels || [];

  function isWarmup(item) {
    // Check labels
    if (warmupLabels.length && Array.isArray(item.labels)) {
      for (const label of warmupLabels) {
        if (item.labels.includes(label)) return true;
      }
    }
    // Check description tags
    if (descTags.length && item.description) {
      for (const tag of descTags) {
        if (item.description.includes(tag)) return true;
      }
    }
    // Check title patterns
    if (item.title) {
      for (const re of titlePatterns) {
        if (re.test(item.title)) return true;
      }
    }
    return false;
  }

  // Step 3: Filter warmups, pick longest
  const candidates = videos.filter(v => !isWarmup(v));

  const pool = candidates.length > 0 ? candidates : videos; // fallback
  return pool.reduce((best, item) =>
    (item.durationMs || 0) > (best.durationMs || 0) ? item : best
  );
}

export default selectPrimaryMedia;
