/**
 * Select the primary media event from a session's timeline events.
 *
 * Same algorithm as frontend selectPrimaryMedia, adapted for backend
 * timeline event objects where data lives under event.data.
 *
 * @param {Array} mediaEvents - Timeline event objects with { data: { title, durationSeconds, ... } }
 * @param {Object} [warmupConfig] - { warmup_labels, warmup_description_tags, warmup_title_patterns }
 * @returns {Object|null} The selected event object (not just .data)
 */

const BUILTIN_TITLE_PATTERNS = [
  /warm[\s-]?up/i,
  /cool[\s-]?down/i,
  /stretch/i,
];

/**
 * Build a warmup checker function from config.
 * Exported so buildStravaDescription can reuse it for warmup annotation.
 *
 * @param {Object} [warmupConfig]
 * @returns {Function} (event) => boolean
 */
export function buildWarmupChecker(warmupConfig) {
  const titlePatterns = [...BUILTIN_TITLE_PATTERNS];
  if (warmupConfig?.warmup_title_patterns?.length) {
    for (const p of warmupConfig.warmup_title_patterns) {
      try { titlePatterns.push(new RegExp(p, 'i')); } catch { /* skip */ }
    }
  }
  const descTags = warmupConfig?.warmup_description_tags || [];
  const warmupLabels = warmupConfig?.warmup_labels || [];

  return (event) => {
    const d = event.data || {};
    if (warmupLabels.length && Array.isArray(d.labels)) {
      for (const label of warmupLabels) {
        if (d.labels.includes(label)) return true;
      }
    }
    if (descTags.length && d.description) {
      for (const tag of descTags) {
        if (d.description.includes(tag)) return true;
      }
    }
    if (d.title) {
      for (const re of titlePatterns) {
        if (re.test(d.title)) return true;
      }
    }
    return false;
  };
}

export function selectPrimaryMedia(mediaEvents, warmupConfig) {
  if (!Array.isArray(mediaEvents) || mediaEvents.length === 0) return null;

  // Step 1: Filter out audio (tracks / items with artist)
  const episodes = mediaEvents.filter(e => {
    const d = e?.data;
    return d && d.contentType !== 'track' && !d.artist;
  });
  if (episodes.length === 0) return null;

  // Step 2: Filter warmups, pick longest by durationSeconds
  const isWarmup = buildWarmupChecker(warmupConfig);
  const candidates = episodes.filter(e => !isWarmup(e));
  const pool = candidates.length > 0 ? candidates : episodes;

  return pool.reduce((best, event) => {
    const bestSec = best.data?.durationSeconds || 0;
    const evSec = event.data?.durationSeconds || 0;
    return evSec > bestSec ? event : best;
  });
}

export default selectPrimaryMedia;
