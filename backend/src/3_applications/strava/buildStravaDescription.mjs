/**
 * buildStravaDescription
 *
 * Pure function that builds a Strava activity name and description
 * from a DaylightStation fitness session.
 *
 * Title: primary media → "Show — Episode"
 * Description: voice memos first, then episode description
 *
 * @module applications/strava/buildStravaDescription
 */

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

  // Extract media events
  const mediaEvents = events.filter(e => e?.type === 'media');
  const primaryMedia = mediaEvents[0]?.data || summary?.media?.[0] || null;

  // Extract voice memos
  const voiceMemos = events
    .filter(e => e?.type === 'voice_memo' && e?.data?.transcript)
    .map(e => e.data);

  // Nothing to enrich
  if (!primaryMedia && voiceMemos.length === 0) {
    return null;
  }

  // Build title (only if primary media exists)
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

  // Skip title if already enriched
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

  // Episode description
  if (primaryMedia?.description) {
    const mediaLabel = _formatMediaLabel(primaryMedia);
    const descBlock = mediaLabel
      ? `\uD83D\uDCFA ${mediaLabel}\n${primaryMedia.description.trim()}`
      : primaryMedia.description.trim();
    parts.push(descBlock);
  }

  const description = parts.length > 0 ? parts.join('\n\n---\n') : null;

  // If we have neither name nor description, nothing to do
  if (!name && !description) {
    return null;
  }

  return { name, description };
}

/**
 * Format a media label for the description.
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
