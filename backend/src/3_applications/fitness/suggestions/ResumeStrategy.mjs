// backend/src/3_applications/fitness/suggestions/ResumeStrategy.mjs

/**
 * ResumeStrategy — finds episodes with partial playhead on Resumable-labeled
 * shows that appear in recent sessions.
 */
export class ResumeStrategy {
  async suggest(context, remainingSlots) {
    if (remainingSlots <= 0) return [];
    const { recentSessions, suggestionPolicy, fitnessPlayableService, contentCatalog } = context;

    const resumableLabels = suggestionPolicy.resumableLabels || ['Resumable'];

    // Collect distinct shows from recent sessions
    const showMap = new Map();
    for (const session of recentSessions) {
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
      if (results.length >= remainingSlots) break;

      const showRef = contentCatalog.canonicalize(show.showId);
      let episodeData;
      try {
        episodeData = await fitnessPlayableService.getPlayableEpisodes(showRef.contentId);
      } catch {
        continue;
      }

      // Check show-level labels (from getContainerInfo), not episode-level
      const showLabels = episodeData.info?.labels || [];
      const isResumable = showLabels.some(l =>
        resumableLabels.some(rl => rl.toLowerCase() === l.toLowerCase())
      );
      if (!isResumable) continue;

      // For Resumable shows we replay intentionally, so we can't trust
      // ep.isWatched (which stays true forever once a completed provider play or a
      // local completedAt stamp is set). Use the current playhead percent
      // instead: surface if it's in the "middle" of a replay, skip if the
      // user has already almost finished this session's play.
      const isPartial = (ep) => {
        const percent = ep.watchProgress ?? 0;
        return percent > 0 && percent < 95;
      };

      // Resume only what the household was last doing on this show. A show
      // accumulates stale partials (an old episode opened for a second weeks
      // ago), and walking in episode order picked the earliest of them over the
      // episode actually in progress. If the most recently played episode is
      // finished, the older partials are abandoned — NextUp owns the show.
      // Without any watchedDate, fall back to the first partial in order.
      const items = episodeData.items || [];
      const lastPlayed = items.reduce(
        (best, ep) => (ep.watchedDate && (!best || ep.watchedDate > best.watchedDate) ? ep : best),
        null,
      );
      const ep = lastPlayed ?? items.find(isPartial);
      if (!ep || !isPartial(ep)) continue;

      const percent = ep.watchProgress ?? 0;

      const remainingSec = ep.duration - (ep.watchSeconds || 0);
      const remainingMin = Math.floor(remainingSec / 60);
      const remainingSecs = Math.floor(remainingSec % 60);

      const isShowLevel = ep.metadata?.type === 'show';
      const episodeRef = contentCatalog.canonicalize(ep.id ?? ep.localId);
      results.push({
        type: 'resume',
        action: 'play',
        contentId: ep.id,
        showId: show.showId,
        title: ep.title,
        showTitle: show.showTitle,
        description: ep.metadata?.summary || null,
        thumbnail: ep.thumbnail || displayImageRef(episodeRef.source, episodeRef.localId),
        poster: contentImageRef(showRef.source, showRef.localId),
        durationMinutes: ep.duration ? Math.round(ep.duration / 60) : null,
        orientation: isShowLevel ? 'portrait' : 'landscape',
        labels: showLabels,
        lastSessionDate: show.lastSessionDate,
        ...episodeLaunchFields(ep, episodeData),
        progress: {
          percent,
          remaining: `${remainingMin}:${String(remainingSecs).padStart(2, '0')}`,
          playhead: ep.watchSeconds || 0,
        },
      });
    }

    return results;
  }
}
import { contentImageRef, displayImageRef } from '#apps/common/resources/publicResourceRefs.mjs';
import { episodeLaunchFields } from './episodeLaunchFields.mjs';
