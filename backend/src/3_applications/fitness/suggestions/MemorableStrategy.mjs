
/**
 * Ranker interface: { rank(sessions) → sorted sessions, getMetric(session) → {label, value}, getReason(session) → string }
 */

export class SufferScoreRanker {
  rank(sessions) {
    return sessions
      .filter(s => s.maxSufferScore != null && s.maxSufferScore > 0)
      .sort((a, b) => b.maxSufferScore - a.maxSufferScore);
  }

  getMetric(session) {
    return { label: 'Suffer Score', value: session.maxSufferScore };
  }

  getReason(session) {
    const d = new Date(session.date + 'T12:00:00');
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const days = Math.round((new Date() - d) / 86400000);
    const ago = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
    return `Suffer ${session.maxSufferScore} — ${dateStr} (${ago})`;
  }
}

/**
 * MemorableStrategy — surfaces high-impact past episodes ranked by a pluggable metric.
 */
export class MemorableStrategy {
  #ranker;

  constructor({ ranker } = {}) {
    this.#ranker = ranker || new SufferScoreRanker();
  }

  async suggest(context, remainingSlots) {
    if (remainingSlots <= 0) return [];
    const { fitnessConfig, sessionDatastore, householdId } = context;
    const cfg = fitnessConfig?.suggestions || {};
    const lookbackDays = cfg.memorable_lookback_days ?? 90;
    const max = Math.min(cfg.memorable_max ?? 2, remainingSlots);

    const endDate = new Date().toISOString().split('T')[0];
    const startD = new Date();
    startD.setDate(startD.getDate() - lookbackDays);
    const startDate = startD.toISOString().split('T')[0];

    let sessions;
    try {
      sessions = await sessionDatastore.findInRange(startDate, endDate, householdId);
    } catch {
      return [];
    }

    // Filter to sessions with media
    sessions = sessions.filter(s => s.media?.primary?.contentId);

    const ranked = this.#ranker.rank(sessions);

    // Take top N candidates, dedup by episode, then shuffle and pick
    const poolSize = cfg.memorable_pool_size ?? 10;
    const deduped = [];
    const seen = new Set();
    for (const session of ranked) {
      if (deduped.length >= poolSize) break;
      const cid = session.media.primary.contentId;
      if (seen.has(cid)) continue;
      seen.add(cid);
      deduped.push(session);
    }

    // Shuffle the pool so we don't always show the same top entries
    for (let i = deduped.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deduped[i], deduped[j]] = [deduped[j], deduped[i]];
    }

    const { contentAdapter } = context;
    const results = [];
    for (const session of deduped) {
      if (results.length >= max) break;
      const cid = session.media.primary.contentId;

      const showId = session.media.primary.grandparentId;
      const localShowId = showId?.replace(/^plex:/, '');

      // Fetch episode metadata for description + show-level labels for governance
      let description = null;
      let showLabels = [];
      if (contentAdapter) {
        try {
          const item = await contentAdapter.getItem(cid);
          description = item?.metadata?.summary || null;
        } catch { /* proceed without description */ }
        if (localShowId && contentAdapter.getContainerInfo) {
          try {
            const info = await contentAdapter.getContainerInfo(showId);
            showLabels = info?.labels || [];
          } catch { /* proceed without labels */ }
        }
      }

      results.push({
        type: 'memorable',
        action: 'play',
        contentId: cid,
        showId: showId || cid,
        title: session.media.primary.title,
        showTitle: session.media.primary.showTitle,
        description,
        thumbnail: `/api/v1/display/plex/${cid.replace(/^plex:/, '')}`,
        poster: localShowId ? `/api/v1/content/plex/image/${localShowId}` : null,
        durationMinutes: session.durationMs ? Math.round(session.durationMs / 60000) : null,
        orientation: 'landscape',
        labels: showLabels,
        metric: this.#ranker.getMetric(session),
        reason: this.#ranker.getReason(session),
      });
    }

    return results;
  }
}
