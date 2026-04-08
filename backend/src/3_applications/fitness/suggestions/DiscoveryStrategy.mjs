
/**
 * DiscoveryStrategy — weighted random selection to fill remaining grid slots.
 * Prefers lapsed shows (done before but not recently), falls back to true random.
 */
export class DiscoveryStrategy {
  async suggest(context, remainingSlots) {
    if (remainingSlots <= 0) return [];
    const { fitnessConfig, fitnessPlayableService, sessionDatastore, householdId } = context;
    const cfg = fitnessConfig?.suggestions || {};
    const lapsedDays = cfg.discovery_lapsed_days ?? 30;
    const lapsedWeight = cfg.discovery_lapsed_weight ?? 0.7;

    // Get all shows in the fitness library
    let allShows;
    try {
      const catalog = await fitnessPlayableService.listFitnessShows();
      allShows = catalog.shows || [];
    } catch {
      return [];
    }
    if (allShows.length === 0) return [];

    // Get broader session history to determine lapsed vs fresh
    const endDate = new Date().toISOString().split('T')[0];
    const startD = new Date();
    startD.setDate(startD.getDate() - 365);
    const startDate = startD.toISOString().split('T')[0];

    let historicalSessions = [];
    try {
      historicalSessions = await sessionDatastore.findInRange(startDate, endDate, householdId);
    } catch { /* proceed without history */ }

    // Build map: showId → most recent session date
    const lastDoneMap = new Map();
    for (const s of historicalSessions) {
      const gid = s.media?.primary?.grandparentId;
      if (!gid) continue;
      const existing = lastDoneMap.get(gid);
      if (!existing || s.date > existing) lastDoneMap.set(gid, s.date);
    }

    const today = new Date();
    const lapsedThreshold = new Date();
    lapsedThreshold.setDate(lapsedThreshold.getDate() - lapsedDays);
    const lapsedThresholdStr = lapsedThreshold.toISOString().split('T')[0];

    // Classify shows
    const lapsed = [];
    const fresh = [];
    for (const show of allShows) {
      const compoundId = `plex:${show.id}`;
      const lastDone = lastDoneMap.get(compoundId);
      if (lastDone && lastDone < lapsedThresholdStr) {
        lapsed.push({ ...show, lastDone });
      } else if (!lastDone) {
        fresh.push({ ...show, lastDone: null });
      }
      // Shows done recently are excluded from discovery
    }

    // Weighted random selection
    const selected = [];
    const usedIds = new Set();

    for (let i = 0; i < remainingSlots; i++) {
      const useLapsed = lapsed.length > 0 && (fresh.length === 0 || Math.random() < lapsedWeight);
      const pool = useLapsed ? lapsed : (fresh.length > 0 ? fresh : lapsed);
      if (pool.length === 0) break;

      // Pick random from pool, avoiding duplicates
      const available = pool.filter(s => !usedIds.has(s.id));
      if (available.length === 0) {
        // Fall back to the other pool
        const otherPool = (pool === lapsed ? fresh : lapsed).filter(s => !usedIds.has(s.id));
        if (otherPool.length === 0) break;
        const pick = otherPool[Math.floor(Math.random() * otherPool.length)];
        selected.push(pick);
        usedIds.add(pick.id);
      } else {
        const pick = available[Math.floor(Math.random() * available.length)];
        selected.push(pick);
        usedIds.add(pick.id);
      }
    }

    // Resolve one episode per selected show
    const results = [];
    for (const show of selected) {
      let episodeData;
      try {
        episodeData = await fitnessPlayableService.getPlayableEpisodes(show.id);
      } catch {
        continue;
      }

      const episodes = episodeData.items || [];
      const nextUnwatched = episodes.find(ep => !ep.isWatched);
      const ep = nextUnwatched || episodes[Math.floor(Math.random() * episodes.length)];
      if (!ep) continue;

      const daysSince = show.lastDone
        ? Math.round((today - new Date(show.lastDone + 'T12:00:00')) / 86400000)
        : null;

      results.push({
        type: 'discovery',
        action: 'play',
        contentId: ep.id,
        showId: `plex:${show.id}`,
        title: ep.title,
        showTitle: show.title,
        thumbnail: ep.thumbnail || `/api/v1/display/plex/${ep.localId}`,
        poster: `/api/v1/content/plex/image/${show.id}`,
        durationMinutes: ep.duration ? Math.round(ep.duration / 60) : null,
        orientation: 'landscape',
        reason: daysSince != null ? `Last done ${daysSince} days ago` : 'New to you',
      });
    }

    return results;
  }
}
