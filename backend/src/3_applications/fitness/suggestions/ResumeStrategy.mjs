// backend/src/3_applications/fitness/suggestions/ResumeStrategy.mjs

/**
 * ResumeStrategy — finds episodes with partial playhead on Resumable-labeled
 * shows that appear in recent sessions.
 */
export class ResumeStrategy {
  async suggest(context, remainingSlots) {
    if (remainingSlots <= 0) return [];
    const { recentSessions, fitnessConfig, fitnessPlayableService } = context;

    const resumableLabels = fitnessConfig?.plex?.resumable_labels || ['Resumable'];

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

      const localId = show.showId.replace(/^plex:/, '');
      let episodeData;
      try {
        episodeData = await fitnessPlayableService.getPlayableEpisodes(localId);
      } catch {
        continue;
      }

      // Check show-level labels (from getContainerInfo), not episode-level
      const showLabels = episodeData.info?.labels || [];
      const isResumable = showLabels.some(l =>
        resumableLabels.some(rl => rl.toLowerCase() === l.toLowerCase())
      );
      if (!isResumable) continue;

      for (const ep of episodeData.items || []) {
        if (results.length >= remainingSlots) break;

        const percent = ep.watchProgress ?? 0;
        // For Resumable shows we replay intentionally, so we can't trust
        // ep.isWatched (which stays true forever once Plex viewCount or a
        // local completedAt stamp is set). Use the current playhead percent
        // instead: surface if it's in the "middle" of a replay, skip if the
        // user has already almost finished this session's play.
        if (percent <= 0 || percent >= 95) continue;

        const remainingSec = ep.duration - (ep.watchSeconds || 0);
        const remainingMin = Math.floor(remainingSec / 60);
        const remainingSecs = Math.floor(remainingSec % 60);

        const isShowLevel = ep.metadata?.type === 'show';
        results.push({
          type: 'resume',
          action: 'play',
          contentId: ep.id,
          showId: show.showId,
          title: ep.title,
          showTitle: show.showTitle,
          description: ep.metadata?.summary || null,
          thumbnail: ep.thumbnail || `/api/v1/display/plex/${ep.localId}`,
          poster: `/api/v1/content/plex/image/${localId}`,
          durationMinutes: ep.duration ? Math.round(ep.duration / 60) : null,
          orientation: isShowLevel ? 'portrait' : 'landscape',
          labels: showLabels,
          lastSessionDate: show.lastSessionDate,
          progress: {
            percent,
            remaining: `${remainingMin}:${String(remainingSecs).padStart(2, '0')}`,
            playhead: ep.watchSeconds || 0,
          },
        });
      }
    }

    return results;
  }
}
