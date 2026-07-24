/**
 * Select the primary media event from a session's timeline events.
 *
 * Same algorithm as frontend selectPrimaryMedia, adapted for backend
 * timeline event objects where data lives under event.data.
 *
 * Filters out audio, then applies a four-tier cascade so every session
 * that has any video event ends up with a primary:
 *
 *   T1: Real events (non-warmup, non-deprioritized) ≥ MIN_PRIMARY_SEC (5 min).
 *       When ≥2 are also ≥10 min, picks the LAST one (chronologically latest);
 *       otherwise picks the longest by data.durationSeconds. Main success path.
 *   T2: Real candidates ≥ MIN_T2_T3_SEC (3 min). Longest. Drops the T1 floor
 *       but keeps a sub-floor — filters out brief demos that aren't real
 *       workouts (e.g. a 48-second strength demo).
 *   T3: Non-deprioritized ≥ MIN_T2_T3_SEC (3 min), allowing warmups but
 *       blocking browsing. Longest. (E.g. stretch-only sessions where the
 *       stretch is at least 3 min.) Sub-floor non-deprio still falls through
 *       to T4.
 *   T4: Anything that survived audio filtering, including deprioritized.
 *       Longest. Last-resort fallback for sessions where every event is
 *       deprioritized (e.g. Game Cycling sessions with kidsfun-labeled tracks).
 *
 * Returns null only when there are no non-audio events at all.
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
  /cold[\s-]?start/i,  // 2026-05-01: catches Beachbody-style intro episodes
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
 * Exported so buildActivityDescription can reuse it for warmup annotation.
 *
 * IMPORTANT: This checker is warmup-only. Deprioritized labels are NOT
 * matched here, because buildActivityDescription uses this to add a "(warmup)"
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

  // Step 2: Constants for the cascade.
  const isWarmup = buildWarmupChecker(config);
  const isDeprioritized = buildDeprioritizedChecker(config);
  const MIN_PRIMARY_SEC = 5 * 60;
  const MIN_T2_T3_SEC = 3 * 60;  // 3-min floor for fallback tiers — keeps brief demos out of primary
  const TEN_MIN_SEC = 10 * 60;

  // Step 3: Tier 1 — Eligible real workouts.
  const realCandidates = episodes.filter(e => !isWarmup(e) && !isDeprioritized(e));
  const eligible = realCandidates.filter(e => (e.data?.durationSeconds || 0) >= MIN_PRIMARY_SEC);
  if (eligible.length > 0) {
    const longSurvivors = eligible.filter(e => (e.data?.durationSeconds || 0) >= TEN_MIN_SEC);
    if (longSurvivors.length >= 2) {
      return longSurvivors[longSurvivors.length - 1];
    }
    return eligible.reduce((best, event) => {
      const bestSec = best.data?.durationSeconds || 0;
      const evSec = event.data?.durationSeconds || 0;
      return evSec > bestSec ? event : best;
    });
  }

  // Step 4: Tier 2 — real candidates ≥ MIN_T2_T3_SEC (drops T1 floor, keeps demo filter).
  const t2Candidates = realCandidates.filter(e => (e.data?.durationSeconds || 0) >= MIN_T2_T3_SEC);
  if (t2Candidates.length > 0) {
    return t2Candidates.reduce((best, event) => {
      const bestSec = best.data?.durationSeconds || 0;
      const evSec = event.data?.durationSeconds || 0;
      return evSec > bestSec ? event : best;
    });
  }

  // Step 5: Tier 3 — non-deprioritized ≥ MIN_T2_T3_SEC (allows warmups, blocks browsing).
  const t3Candidates = episodes.filter(e =>
    !isDeprioritized(e) && (e.data?.durationSeconds || 0) >= MIN_T2_T3_SEC
  );
  if (t3Candidates.length > 0) {
    return t3Candidates.reduce((best, event) => {
      const bestSec = best.data?.durationSeconds || 0;
      const evSec = event.data?.durationSeconds || 0;
      return evSec > bestSec ? event : best;
    });
  }

  // Step 6: Tier 4 — anything that survived audio filtering. Last-resort browsing.
  return episodes.reduce((best, event) => {
    const bestSec = best.data?.durationSeconds || 0;
    const evSec = event.data?.durationSeconds || 0;
    return evSec > bestSec ? event : best;
  });
}

/**
 * Same cascade as selectPrimaryMedia, but for the FLAT `summary.media` item
 * shape (`{ contentId, title, mediaType, durationMs, labels, description }`)
 * rather than timeline events (`{ data: { durationSeconds, ... } }`).
 *
 * The read path and the backfill both carry summary items — not events — and
 * `summary.media[].durationMs` is the ACTUAL played time (`event.end - start`),
 * which is the right signal for "what was the workout". A stored `primary: true`
 * flag can be stale (written by pre-cascade code, e.g. an audio track or a brief
 * bleed-over episode marked primary), so consumers re-derive with this rather
 * than trusting the flag.
 *
 * @param {Array} mediaItems - summary.media objects
 * @param {Object} [config] - same shape as selectPrimaryMedia's config
 * @returns {Object|null} the chosen summary item (not a copy), or null
 */
export function selectPrimaryMediaSummary(mediaItems, config) {
  if (!Array.isArray(mediaItems) || mediaItems.length === 0) return null;
  const asEvents = mediaItems.map((m) => ({
    __item: m,
    data: {
      contentId: m.contentId,
      title: m.title,
      description: m.description,
      labels: m.labels,
      // audio filtering keys off contentType==='track' || artist
      contentType: m.mediaType === 'audio' ? 'track' : m.contentType,
      artist: m.mediaType === 'audio' ? (m.artist || 'audio') : m.artist,
      // cascade floors are in seconds; durationMs is the played span
      durationSeconds: (m.durationMs || 0) / 1000,
    },
  }));
  const picked = selectPrimaryMedia(asEvents, config);
  return picked?.__item ?? null;
}

export default selectPrimaryMedia;
