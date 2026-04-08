
/**
 * FavoriteStrategy — resolves content from configured favorite IDs.
 * Shows get action=browse (portrait), episodes get action=play (landscape).
 */
export class FavoriteStrategy {
  async suggest(context, remainingSlots) {
    if (remainingSlots <= 0) return [];
    const { fitnessConfig, contentAdapter } = context;
    const favoriteIds = fitnessConfig?.suggestions?.favorites || [];
    if (favoriteIds.length === 0 || !contentAdapter) return [];

    const results = [];
    for (const rawId of favoriteIds) {
      if (results.length >= remainingSlots) break;

      const compoundId = String(rawId).includes(':') ? String(rawId) : `plex:${rawId}`;
      let item;
      try {
        item = await contentAdapter.getItem(compoundId);
      } catch {
        continue;
      }
      if (!item) continue;

      const isShow = item.metadata?.type === 'show';
      const localId = item.localId || compoundId.replace(/^plex:/, '');
      const showId = isShow ? compoundId : (item.metadata?.grandparentId || compoundId);
      const showTitle = isShow ? item.title : (item.metadata?.grandparentTitle || item.title);

      results.push({
        type: 'favorite',
        action: isShow ? 'browse' : 'play',
        contentId: compoundId,
        showId,
        title: item.title,
        showTitle,
        thumbnail: item.thumbnail || `/api/v1/content/plex/image/${localId}`,
        poster: `/api/v1/content/plex/image/${isShow ? localId : showId.replace(/^plex:/, '')}`,
        durationMinutes: item.duration ? Math.round(item.duration / 60) : null,
        orientation: isShow ? 'portrait' : 'landscape',
      });
    }

    return results;
  }
}
