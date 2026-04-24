/**
 * Select the primary media event from a session's timeline events.
 *
 * Same algorithm as frontend selectPrimaryMedia, adapted for backend
 * timeline event objects where data lives under event.data.
 *
 * Filters out audio, then warmup AND deprioritized events (e.g. kids
 * content). Picks longest of the survivors by data.durationSeconds.
 * Falls back to longest video overall if every video is filtered out.
 *
 * @param {Array} mediaEvents - Timeline event objects with { data: { title, durationSeconds, ... } }
 * @param {Object} [config] - {
 *   warmup_labels, warmup_description_tags, warmup_title_patterns,
 *   deprioritized_labels
 * }
 * @returns {Object|null} The selected event object (not just .data)
 */

const BUILTIN_TITLE_PATTERNS = [
  /warm[\s-]?up/i,
  /cool[\s-]?down/i,
  /stretch/i,
];

/**
 * Build the selection config object that selectPrimaryMedia and
 * buildWarmupChecker accept, from a fitness `plex` config block.
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

/**
 * Build a warmup checker function from config.
 * Exported so buildStravaDescription can reuse it for warmup annotation.
 *
 * IMPORTANT: This checker is warmup-only. Deprioritized labels are NOT
 * matched here, because buildStravaDescription uses this to add a "(warmup)"
 * annotation in the Strava description — kids videos must not get that tag.
 *
 * @param {Object} [config]
 * @returns {Function} (event) => boolean
 */
export function buildWarmupChecker(config) {
  const titlePatterns = [...BUILTIN_TITLE_PATTERNS];
  if (config?.warmup_title_patterns?.length) {
    for (const p of config.warmup_title_patterns) {
      try { titlePatterns.push(new RegExp(p, 'i')); } catch { /* skip */ }
    }
  }
  const descTags = config?.warmup_description_tags || [];
  const warmupLabels = config?.warmup_labels || [];

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

/**
 * Build a deprioritized checker function from config. Internal helper.
 * Matches by labels only, case-insensitively (session timeline events
 * persist labels lowercased while config uses CamelCase).
 */
function buildDeprioritizedChecker(config) {
  const labels = (config?.deprioritized_labels || []).map(l => String(l).toLowerCase());
  return (event) => {
    if (!labels.length) return false;
    const d = event.data || {};
    if (!Array.isArray(d.labels)) return false;
    const itemLowered = d.labels.map(l => String(l).toLowerCase());
    for (const label of labels) {
      if (itemLowered.includes(label)) return true;
    }
    return false;
  };
}

export function selectPrimaryMedia(mediaEvents, config) {
  if (!Array.isArray(mediaEvents) || mediaEvents.length === 0) return null;

  // Step 1: Filter out audio (tracks / items with artist)
  const episodes = mediaEvents.filter(e => {
    const d = e?.data;
    return d && d.contentType !== 'track' && !d.artist;
  });
  if (episodes.length === 0) return null;

  // Step 2: Drop warmups + deprioritized; fall back to all episodes if empty
  const isWarmup = buildWarmupChecker(config);
  const isDeprioritized = buildDeprioritizedChecker(config);
  const candidates = episodes.filter(e => !isWarmup(e) && !isDeprioritized(e));
  const pool = candidates.length > 0 ? candidates : episodes;

  return pool.reduce((best, event) => {
    const bestSec = best.data?.durationSeconds || 0;
    const evSec = event.data?.durationSeconds || 0;
    return evSec > bestSec ? event : best;
  });
}

export default selectPrimaryMedia;
