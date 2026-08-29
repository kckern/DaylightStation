
/**
 * DiscoveryStrategy — weighted random selection to fill remaining grid slots.
 * Prefers lapsed shows (done before but not recently), falls back to true random.
 */
export class DiscoveryStrategy {
  async suggest(context, remainingSlots) {
    if (remainingSlots <= 0) return [];
    const { suggestionPolicy, fitnessPlayableService, sessionDatastore, householdId, excludedShowIds, contentCatalog } = context;
    const lapsedDays = suggestionPolicy.discoveryLapsedDays;
    const lapsedWeight = suggestionPolicy.discoveryLapsedWeight;

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

    // Exclude specific show IDs from discovery. Unions:
    //   - suggestions.discovery_exclude_shows (legacy, per-show list)
    //   - excludedShowIds from FitnessSuggestionService, resolved from
    //     suggestions.exclude_collections (Plex collection/playlist membership)
    const excludeShowIds = new Set([
      ...((suggestionPolicy.discoveryExcludedShowIds || []).map(String)),
      ...((excludedShowIds instanceof Set ? [...excludedShowIds] : []).map(String)),
    ]);

    // Classify shows
    const lapsed = [];
    const fresh = [];
    for (const show of allShows) {
      if (excludeShowIds.has(show.id)) continue;
      const contentId = contentCatalog.canonicalize(show.id).contentId;
      const lastDone = lastDoneMap.get(contentId);
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

    // Labels to exclude (governed labels like KidsFun + explicit exclusions)
    const excludeLabels = new Set([
      ...(suggestionPolicy.governedLabels || []),
      ...(suggestionPolicy.discoveryExcludedLabels || []),
    ]);

    // Resolve one episode per selected show, filtering by labels
    const results = [];
    for (const show of selected) {
      let episodeData;
      try {
        episodeData = await fitnessPlayableService.getPlayableEpisodes(show.id);
      } catch {
        continue;
      }

      const episodes = episodeData.items || [];
      if (episodes.length === 0) continue;

      // Check if show has excluded labels (check first episode's labels as proxy)
      const showLabels = episodes[0]?.metadata?.labels || [];
      if (showLabels.some(l => excludeLabels.has(l))) continue;

      // Filter out supplementary episodes (warmups, cooldowns, intros, filler)
      const warmupPatterns = (suggestionPolicy.warmupTitlePatterns || [])
        .map(p => new RegExp(p, 'i'));
      const descTags = new Set(
        (suggestionPolicy.warmupDescriptionTags || []).map(t => t.toLowerCase())
      );
      const minDuration = suggestionPolicy.minimumDurationSeconds;

      const substantive = episodes.filter(ep => {
        const title = (ep.title || '').toLowerCase();
        const idx = ep.metadata?.itemIndex;
        const seasonIdx = ep.metadata?.parentIndex;
        const dur = ep.duration || 0;

        // Season 0 or episode 0 = supplementary
        if (seasonIdx === 0 || idx === 0) return false;
        // Too short
        if (dur > 0 && dur < minDuration) return false;
        // Title matches warmup/cooldown/stretch/intro patterns
        if (warmupPatterns.some(re => re.test(title))) return false;
        if (/\bintro\b/i.test(title)) return false;
        // Description tags
        const summary = (ep.metadata?.summary || '').toLowerCase();
        if ([...descTags].some(tag => summary.includes(tag))) return false;
        // Warmup/Cooldown labels on the episode itself
        const epLabels = (ep.metadata?.labels || []).map(l => l.toLowerCase());
        if (epLabels.some(l => l === 'warmup' || l === 'cooldown')) return false;

        return true;
      });

      const pool = substantive.length > 0 ? substantive : episodes;
      const nextUnwatched = pool.find(ep => !ep.isWatched);
      const ep = nextUnwatched || pool[Math.floor(Math.random() * pool.length)];
      if (!ep) continue;

      const daysSince = show.lastDone
        ? Math.round((today - new Date(show.lastDone + 'T12:00:00')) / 86400000)
        : null;

      const infoLabels = episodeData.info?.labels || showLabels;
      const showRef = contentCatalog.canonicalize(show.id);
      const episodeRef = contentCatalog.canonicalize(ep.id ?? ep.localId);
      results.push({
        type: 'discovery',
        action: 'play',
        contentId: ep.id,
        showId: showRef.contentId,
        title: ep.title,
        showTitle: show.title,
        description: ep.metadata?.summary || null,
        thumbnail: ep.thumbnail || displayImageRef(episodeRef.source, episodeRef.localId),
        poster: contentImageRef(showRef.source, showRef.localId),
        durationMinutes: ep.duration ? Math.round(ep.duration / 60) : null,
        orientation: 'landscape',
        labels: infoLabels,
        reason: daysSince != null ? `Last done ${daysSince} days ago` : 'New to you',
      });
    }

    return results;
  }
}
import { contentImageRef, displayImageRef } from '#apps/common/resources/publicResourceRefs.mjs';
