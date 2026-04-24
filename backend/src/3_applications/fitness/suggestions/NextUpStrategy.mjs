/**
 * NextUpStrategy — resolves the next unwatched episode for each
 * distinct show found in recent sessions.
 *
 * Priority: most recently done show first.
 * Max: configurable via suggestions.next_up_max (default 4).
 *
 * Label-based filtering:
 *   - Shows whose show-level labels match plex.deprioritized_labels
 *     (e.g. KidsFun) are hidden from the Next Up list, UNLESS the show
 *     also carries a plex.resumable_labels label (e.g. Resumable) — the
 *     canonical signal that "there's actual watch-progress the user
 *     cares about here" (mirrors ResumeStrategy).
 *   - Label comparison is case-insensitive because session-persisted
 *     labels are lowercase while the config uses CamelCase (mirrors
 *     selectPrimaryMedia's buildDeprioritizedChecker).
 */
export class NextUpStrategy {
  async suggest(context, remainingSlots) {
    const { recentSessions, fitnessConfig, fitnessPlayableService, excludedShowIds } = context;
    const max = remainingSlots;
    if (max <= 0) return [];

    // Build warmup/filler detection from config
    const warmupPatterns = (fitnessConfig?.plex?.warmup_title_patterns || [])
      .map(p => new RegExp(p, 'i'));
    const minDuration = fitnessConfig?.suggestions?.discovery_min_duration_seconds ?? 600;

    // Normalize deprioritized + resumable label sets once (lowercased)
    const deprioritizedLowered = (fitnessConfig?.plex?.deprioritized_labels || [])
      .map(l => String(l).toLowerCase());
    const resumableLowered = (fitnessConfig?.plex?.resumable_labels || ['Resumable'])
      .map(l => String(l).toLowerCase());

    // Shows excluded via suggestions.exclude_collections (collection/playlist
    // membership — e.g. the "Stretch" playlist+collection should never surface
    // as Next Up even if a recent session used one of those episodes).
    const excluded = excludedShowIds instanceof Set ? excludedShowIds : new Set();

    // Extract distinct shows, most-recent-session first
    // Skip sessions where the episode was supplementary (warmup, cooldown, intro, short filler)
    const sortedSessions = [...recentSessions].sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
    const showMap = new Map();
    for (const session of sortedSessions) {
      const gid = session.media?.primary?.grandparentId;
      if (!gid || showMap.has(gid)) continue;

      // Skip shows that are members of excluded collections/playlists
      const bareGid = String(gid).replace(/^plex:/, '');
      if (excluded.has(bareGid)) continue;

      // Check if the played episode was supplementary
      const epTitle = (session.media.primary.title || '').toLowerCase();
      const sessionDurSec = (session.durationMs || 0) / 1000;
      const isFiller =
        (sessionDurSec > 0 && sessionDurSec < minDuration) ||
        warmupPatterns.some(re => re.test(epTitle)) ||
        /\bintro\b/i.test(epTitle);
      if (isFiller) continue;

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

      const showLabels = episodeData.info?.labels || [];

      // Apply the deprioritized filter with the Resumable override.
      if (deprioritizedLowered.length) {
        const labelsLowered = showLabels.map(l => String(l).toLowerCase());
        const isDeprioritized = deprioritizedLowered.some(l => labelsLowered.includes(l));
        const isResumable = resumableLowered.some(l => labelsLowered.includes(l));
        if (isDeprioritized && !isResumable) continue;
      }

      const isShow = nextEp.metadata?.type === 'show';
      results.push({
        type: 'next_up',
        action: 'play',
        contentId: nextEp.id,
        showId: show.showId,
        title: nextEp.title,
        showTitle: show.showTitle,
        description: nextEp.metadata?.summary || null,
        thumbnail: nextEp.thumbnail || `/api/v1/display/plex/${nextEp.localId}`,
        poster: `/api/v1/content/plex/image/${localId}`,
        durationMinutes: nextEp.duration ? Math.round(nextEp.duration / 60) : null,
        orientation: isShow ? 'portrait' : 'landscape',
        labels: showLabels,
        lastSessionDate: show.lastSessionDate,
      });
    }

    return results;
  }
}
