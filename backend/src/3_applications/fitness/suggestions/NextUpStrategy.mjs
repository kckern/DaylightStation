/**
 * NextUpStrategy — resolves the next unwatched episode for each
 * distinct show found in recent sessions.
 *
 * Priority: most recently done show first.
 * Max: configurable via suggestions.next_up_max (default 4).
 */
export class NextUpStrategy {
  async suggest(context, remainingSlots) {
    const { recentSessions, fitnessConfig, fitnessPlayableService } = context;
    const max = Math.min(fitnessConfig?.suggestions?.next_up_max ?? 4, remainingSlots);
    if (max <= 0) return [];

    // Extract distinct shows, most-recent-session first
    // Sort by startTime descending to ensure most recent session wins per show
    const sortedSessions = [...recentSessions].sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
    const showMap = new Map();
    for (const session of sortedSessions) {
      const gid = session.media?.primary?.grandparentId;
      if (!gid || showMap.has(gid)) continue;
      showMap.set(gid, {
        showId: gid,
        showTitle: session.media.primary.showTitle,
        lastSessionDate: session.date,
      });
    }

    const results = [];
    for (const show of showMap.values()) {
      if (results.length >= max) break;

      const localId = show.showId.replace(/^plex:/, '');
      let episodeData;
      try {
        episodeData = await fitnessPlayableService.getPlayableEpisodes(localId);
      } catch {
        continue;
      }

      const nextEp = (episodeData.items || []).find(ep => !ep.isWatched);
      if (!nextEp) continue;

      const isShow = nextEp.metadata?.type === 'show';
      results.push({
        type: 'next_up',
        action: 'play',
        contentId: nextEp.id,
        showId: show.showId,
        title: nextEp.title,
        showTitle: show.showTitle,
        thumbnail: nextEp.thumbnail || `/api/v1/display/plex/${nextEp.localId}`,
        poster: `/api/v1/content/plex/image/${localId}`,
        durationMinutes: nextEp.duration ? Math.round(nextEp.duration / 60) : null,
        orientation: isShow ? 'portrait' : 'landscape',
        lastSessionDate: show.lastSessionDate,
      });
    }

    return results;
  }
}
