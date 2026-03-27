/**
 * buildStravaDescription
 *
 * Pure function that builds a Strava activity name and description
 * from a DaylightStation fitness session.
 *
 * Title:       primary episode (warmup-aware) → "Show — Episode"
 * Description: voice memos, then all episodes chronologically
 *              (warmups annotated), then music tracks one-per-line
 *
 * @module adapters/fitness/buildStravaDescription
 */

import { selectPrimaryMedia, buildWarmupChecker } from './selectPrimaryMedia.mjs';

const STRAVA_DESC_LIMIT = 700;

/**
 * Build Strava activity enrichment payload from a session.
 *
 * @param {Object} session - Parsed session YAML data
 * @param {Object} [currentActivity] - Current Strava activity (for skip logic)
 * @param {Object} [warmupConfig] - { warmup_labels, warmup_description_tags, warmup_title_patterns }
 * @returns {{ name: string|null, description: string|null }|null}
 *   null if nothing to enrich
 */
export function buildStravaDescription(session, currentActivity = {}, warmupConfig = null) {
  const events = session?.timeline?.events || [];

  // Extract media events — separate episodes from music tracks
  const mediaEvents = events.filter(e => e?.type === 'media');
  const musicTracks = mediaEvents.filter(e => e?.data?.artist || e?.data?.contentType === 'track');
  const episodeEvents = mediaEvents.filter(e => !e?.data?.artist && e?.data?.contentType !== 'track');

  // Primary episode — warmup-aware selection
  const primaryEvent = selectPrimaryMedia(episodeEvents, warmupConfig);
  const primaryData = primaryEvent?.data || null;

  // Extract voice memos
  const voiceMemos = events
    .filter(e => e?.type === 'voice_memo' && e?.data?.transcript)
    .map(e => e.data);

  // Nothing to enrich
  if (!primaryData && voiceMemos.length === 0 && musicTracks.length === 0) {
    return null;
  }

  // Build title from primary episode
  let name = null;
  if (primaryData) {
    const show = primaryData.grandparentTitle || primaryData.showTitle || null;
    const episode = primaryData.title || null;

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

  // All episodes chronologically (earliest first)
  const sortedEpisodes = [...episodeEvents].sort((a, b) => {
    const aStart = a.data?.start ?? a.timestamp ?? 0;
    const bStart = b.data?.start ?? b.timestamp ?? 0;
    return aStart - bStart;
  });

  // Reuse the same warmup checker from selectPrimaryMedia for annotation
  const isWarmupEpisode = buildWarmupChecker(warmupConfig);

  const episodeParts = [];
  for (const ep of sortedEpisodes) {
    const label = _formatMediaLabel(ep.data);
    if (!label) continue;
    const warmupTag = isWarmupEpisode(ep) ? ' (warmup)' : '';
    const desc = ep.data?.description ? _flattenText(ep.data.description) : null;
    episodeParts.push(desc
      ? `\uD83D\uDDA5\uFE0F ${label}${warmupTag}\n${desc}`
      : `\uD83D\uDDA5\uFE0F ${label}${warmupTag}`
    );
  }
  if (episodeParts.length) parts.push(episodeParts.join('\n\n'));

  // Music tracks one per line
  const trackLines = musicTracks
    .map(e => {
      const { title, artist } = e.data;
      if (!title && !artist) return null;
      const line = artist ? `${artist} \u2014 ${title}` : title;
      return `\uD83C\uDFB5 ${line}`;
    })
    .filter(Boolean);
  if (trackLines.length > 0) {
    parts.push(trackLines.join('\n'));
  }

  let description = parts.length > 0 ? parts.join('\n\n') : null;

  // Truncate for Strava limit
  if (description && description.length > STRAVA_DESC_LIMIT) {
    description = _truncateDescription(parts, episodeParts, trackLines, STRAVA_DESC_LIMIT);
  }

  if (!name && !description) {
    return null;
  }

  return { name, description };
}

/**
 * Truncate description to fit Strava limit.
 * Priority: keep voice memos + episode titles, drop music tracks first, then episode descriptions.
 */
function _truncateDescription(parts, episodeParts, trackLines, limit) {
  // Try without music tracks
  const withoutMusic = parts.filter(p => !trackLines.some(t => p.includes(t)));
  let desc = withoutMusic.length > 0 ? withoutMusic.join('\n\n') : '';
  if (trackLines.length > 0 && desc.length < limit) {
    // Add back as many tracks as fit
    const remaining = limit - desc.length - 2; // -2 for \n\n separator
    if (remaining > 0) {
      let musicBlock = '';
      for (const line of trackLines) {
        const next = musicBlock ? musicBlock + '\n' + line : line;
        if (next.length > remaining) break;
        musicBlock = next;
      }
      if (musicBlock) desc = desc + '\n\n' + musicBlock;
    }
  }
  if (desc.length <= limit) return desc;

  // Still over — trim episode descriptions to titles only
  const trimmedEpisodes = episodeParts.map(ep => ep.split('\n')[0]); // first line only
  const nonEpisodeParts = parts.filter(p => !episodeParts.some(ep => p.includes(ep)) && !trackLines.some(t => p.includes(t)));
  desc = [...nonEpisodeParts, trimmedEpisodes.join('\n\n')].filter(Boolean).join('\n\n');
  return desc.slice(0, limit);
}

/**
 * Collapse whitespace in a description to single spaces.
 */
function _flattenText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Format: "Show — Episode" or just show/episode.
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
