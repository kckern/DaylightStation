/**
 * FavoriteStrategy — resolves a specific episode from each configured favorite show.
 * Picks the next unwatched episode, or a random one if all are watched.
 */
export class FavoriteStrategy {
  async suggest(context, remainingSlots) {
    if (remainingSlots <= 0) return [];
    const { fitnessConfig, fitnessPlayableService, contentAdapter } = context;
    const favoriteIds = fitnessConfig?.suggestions?.favorites || [];
    if (favoriteIds.length === 0) return [];

    const results = [];
    for (const rawId of favoriteIds) {
      if (results.length >= remainingSlots) break;

      const showId = String(rawId).includes(':') ? String(rawId) : `plex:${rawId}`;
      const localId = showId.replace(/^plex:/, '');

      // Resolve show metadata for the title
      let showTitle = null;
      if (contentAdapter) {
        try {
          const item = await contentAdapter.getItem(showId);
          showTitle = item?.title || null;
        } catch { /* proceed without title */ }
      }

      // Resolve episodes
      let episodeData;
      try {
        episodeData = await fitnessPlayableService.getPlayableEpisodes(localId);
      } catch {
        continue;
      }

      const episodes = episodeData.items || [];
      if (episodes.length === 0) continue;

      // Pick next unwatched, or random if all watched
      const nextUnwatched = episodes.find(ep => !ep.isWatched);
      const ep = nextUnwatched || episodes[Math.floor(Math.random() * episodes.length)];

      const showLabels = episodeData.info?.labels || [];
      results.push({
        type: 'favorite',
        action: 'play',
        contentId: ep.id,
        showId,
        title: ep.title,
        showTitle: showTitle || ep.metadata?.grandparentTitle || 'Favorite',
        description: ep.metadata?.summary || null,
        thumbnail: ep.thumbnail || `/api/v1/display/plex/${ep.localId}`,
        poster: `/api/v1/content/plex/image/${localId}`,
        durationMinutes: ep.duration ? Math.round(ep.duration / 60) : null,
        orientation: 'landscape',
        labels: showLabels,
      });
    }

    return results;
  }
}
