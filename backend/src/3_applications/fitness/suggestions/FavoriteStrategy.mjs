/**
 * FavoriteStrategy — resolves a specific episode from each configured favorite show.
 * Picks the next unwatched episode, or a random one if all are watched.
 */
export class FavoriteStrategy {
  async suggest(context, remainingSlots) {
    if (remainingSlots <= 0) return [];
    const { suggestionPolicy, fitnessPlayableService, contentCatalog } = context;
    const favoriteIds = suggestionPolicy.favorites || [];
    if (favoriteIds.length === 0) return [];

    const results = [];
    for (const rawId of favoriteIds) {
      if (results.length >= remainingSlots) break;

      const showRef = contentCatalog.canonicalize(rawId);
      const showId = showRef.contentId;

      // Resolve show metadata for the title
      let showTitle = null;
      if (contentCatalog) {
        try {
          const item = await contentCatalog.describeItem(showId);
          showTitle = item?.title || null;
        } catch { /* proceed without title */ }
      }

      // Resolve episodes
      let episodeData;
      try {
        episodeData = await fitnessPlayableService.getPlayableEpisodes(showId);
      } catch {
        continue;
      }

      const episodes = episodeData.items || [];
      if (episodes.length === 0) continue;

      // Pick next unwatched, or random if all watched
      const nextUnwatched = episodes.find(ep => !ep.isWatched);
      const ep = nextUnwatched || episodes[Math.floor(Math.random() * episodes.length)];

      const showLabels = episodeData.info?.labels || [];
      const episodeRef = contentCatalog.canonicalize(ep.id ?? ep.localId);
      results.push({
        type: 'favorite',
        action: 'play',
        contentId: ep.id,
        showId,
        title: ep.title,
        showTitle: showTitle || ep.metadata?.grandparentTitle || 'Favorite',
        description: ep.metadata?.summary || null,
        thumbnail: ep.thumbnail || displayImageRef(episodeRef.source, episodeRef.localId),
        poster: contentImageRef(showRef.source, showRef.localId),
        durationMinutes: ep.duration ? Math.round(ep.duration / 60) : null,
        orientation: 'landscape',
        labels: showLabels,
      });
    }

    return results;
  }
}
import { contentImageRef, displayImageRef } from '#apps/common/resources/publicResourceRefs.mjs';
