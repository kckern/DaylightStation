
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

    // Dedup by episode contentId — only first occurrence
    const seen = new Set();
    const results = [];
    for (const session of ranked) {
      if (results.length >= max) break;
      const cid = session.media.primary.contentId;
      if (seen.has(cid)) continue;
      seen.add(cid);

      const showId = session.media.primary.grandparentId;
      const localShowId = showId?.replace(/^plex:/, '');

      results.push({
        type: 'memorable',
        action: 'play',
        contentId: cid,
        showId: showId || cid,
        title: session.media.primary.title,
        showTitle: session.media.primary.showTitle,
        thumbnail: `/api/v1/display/plex/${cid.replace(/^plex:/, '')}`,
        poster: localShowId ? `/api/v1/content/plex/image/${localShowId}` : null,
        durationMinutes: session.durationMs ? Math.round(session.durationMs / 60000) : null,
        orientation: 'landscape',
        metric: this.#ranker.getMetric(session),
        reason: this.#ranker.getReason(session),
      });
    }

    return results;
  }
}
