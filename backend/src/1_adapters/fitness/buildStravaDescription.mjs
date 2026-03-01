/**
 * buildStravaDescription
 *
 * Pure function that builds a Strava activity name and description
 * from a DaylightStation fitness session.
 *
 * Title:       longest episode by durationSeconds → "Show — Episode"
 * Description: voice memos, then all qualified episodes (>= 2 min watched)
 *              each with their Plex description, then music playlist
 *
 * @module adapters/fitness/buildStravaDescription
 */

const MIN_WATCH_MS = 2 * 60 * 1000; // 2 minutes — filter out brief browses

/**
 * Build Strava activity enrichment payload from a session.
 *
 * @param {Object} session - Parsed session YAML data
 * @param {Object} [currentActivity] - Current Strava activity (for skip logic)
 * @returns {{ name: string|null, description: string|null }|null}
 *   null if nothing to enrich
 */
export function buildStravaDescription(session, currentActivity = {}) {
  const events = session?.timeline?.events || [];
  const summary = session?.summary || {};
  const sessionDurationMs = (session?.session?.duration_seconds || 0) * 1000;

  // Extract media events — separate episodes from music tracks
  const mediaEvents = events.filter(e => e?.type === 'media');
  const musicTracks = mediaEvents.filter(e => e?.data?.artist || e?.data?.contentType === 'track');
  const episodeEvents = mediaEvents.filter(e => !e?.data?.artist && e?.data?.contentType !== 'track');

  // Filter episodes to those watched >= 2 min (suppress brief browses)
  const watchedEpisodes = episodeEvents.filter(
    ep => _getEpisodeWatchMs(ep, episodeEvents, sessionDurationMs) >= MIN_WATCH_MS
  );

  // Primary episode = longest full video (durationSeconds), fallback to first watched
  const primaryMedia = _selectPrimaryEpisode(watchedEpisodes)
    ?? _selectPrimaryEpisode(episodeEvents)
    ?? summary?.media?.find(m => m?.mediaType !== 'audio')
    ?? null;

  // Extract voice memos
  const voiceMemos = events
    .filter(e => e?.type === 'voice_memo' && e?.data?.transcript)
    .map(e => e.data);

  // Nothing to enrich
  if (!primaryMedia && voiceMemos.length === 0 && musicTracks.length === 0) {
    return null;
  }

  // Build title from primary episode (longest)
  let name = null;
  if (primaryMedia) {
    const show = primaryMedia.grandparentTitle || primaryMedia.showTitle || null;
    const episode = primaryMedia.title || null;

    if (show && episode) {
      name = `${show}\u2014${episode}`;
    } else if (show) {
      name = show;
    } else if (episode) {
      name = episode;
    }
  }

  // Skip title if already enriched with a DaylightStation-style name
  if (name && currentActivity.name && currentActivity.name.includes('\u2014')) {
    name = null;
  }

  // Skip description if already set
  if (currentActivity.description && currentActivity.description.trim()) {
    return name ? { name, description: null } : null;
  }

  // Build description
  const parts = [];

  // Voice memos first
  if (voiceMemos.length > 0) {
    const memoTexts = voiceMemos
      .map(m => `\uD83C\uDF99\uFE0F "${m.transcript.trim()}"`)
      .join('\n\n');
    parts.push(memoTexts);
  }

  // All watched episodes — each with its Plex description if available
  for (const ep of watchedEpisodes) {
    const label = _formatMediaLabel(ep.data);
    const desc = ep.data?.description ? _flattenText(ep.data.description) : null;
    if (!label && !desc) continue;
    const block = label && desc
      ? `\uD83D\uDDA5\uFE0F ${label}\n${desc}`
      : label
        ? `\uD83D\uDDA5\uFE0F ${label}`
        : desc;
    parts.push(block);
  }

  // Playlist (music tracks)
  if (musicTracks.length > 0) {
    const trackLines = musicTracks
      .map(e => {
        const { title, artist } = e.data;
        if (!title && !artist) return null;
        return artist ? `${artist} \u2014 ${title}` : title;
      })
      .filter(Boolean);
    if (trackLines.length > 0) {
      parts.push(`\uD83C\uDFB5 Playlist\n${trackLines.join('\n')}`);
    }
  }

  const description = parts.length > 0 ? parts.join('\n\n') : null;

  if (!name && !description) {
    return null;
  }

  return { name, description };
}

/**
 * Select the primary episode — longest full video (durationSeconds).
 * Falls back to first if all durations are equal or missing.
 *
 * @param {Array} episodeEvents
 * @returns {Object|null} episode data object
 */
function _selectPrimaryEpisode(episodeEvents) {
  if (!episodeEvents?.length) return null;
  return episodeEvents.reduce((best, ep) => {
    const bestSec = best.data?.durationSeconds || 0;
    const epSec = ep.data?.durationSeconds || 0;
    return epSec > bestSec ? ep : best;
  }).data ?? null;
}

/**
 * Estimate how long an episode was watched during the session.
 *
 * Two-pass approach:
 *  1. Direct: use event end-start if the window is >= 2 min (reliable in current sessions)
 *  2. Consecutive: gap between this episode's start and the next one's start
 *     (handles old media_memory_crossref sessions with brief detection windows)
 *
 * @param {Object} ep - Episode media event
 * @param {Array}  allEpisodes - All episode events in this session
 * @param {number} sessionDurationMs
 * @returns {number} Estimated watch time in ms
 */
function _getEpisodeWatchMs(ep, allEpisodes, sessionDurationMs) {
  const start = ep.data?.start ?? ep.timestamp;
  const end = ep.data?.end;
  const rawMs = (end != null && start != null) ? end - start : 0;

  // If the direct window is long enough, trust it
  if (rawMs >= MIN_WATCH_MS) return rawMs;

  // Otherwise infer from consecutive event positions
  const idx = allEpisodes.indexOf(ep);
  const nextEp = allEpisodes[idx + 1];

  if (nextEp) {
    const nextStart = nextEp.data?.start ?? nextEp.timestamp;
    return (nextStart ?? 0) - (start ?? 0);
  }

  // Last episode: remaining session time after this episode started
  if (sessionDurationMs && start) {
    const firstStart = allEpisodes[0]?.data?.start ?? allEpisodes[0]?.timestamp ?? start;
    return sessionDurationMs - (start - firstStart);
  }

  return rawMs;
}

/**
 * Collapse all internal whitespace/newlines in a description to single spaces.
 * @param {string} text
 * @returns {string}
 */
function _flattenText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Format a media label: "Show — Episode" or just show/episode if only one exists.
 * @param {Object} media
 * @returns {string|null}
 */
function _formatMediaLabel(media) {
  const show = media.grandparentTitle || media.showTitle || null;
  const episode = media.title || null;

  if (show && episode) return `${show} \u2014 ${episode}`;
  if (show) return show;
  if (episode) return episode;
  return null;
}

export default buildStravaDescription;
