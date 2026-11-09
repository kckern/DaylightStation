/**
 * QueryEpisodeHistory — who did these episodes, and when.
 *
 * The show screen's "watched" badge comes from the media server, which keeps
 * one household-wide watched state and so cannot say WHO did an episode. The
 * session log can: every session records its primary episode and its riders.
 * This use case answers, for a set of episode content ids, the sessions that
 * played each one — newest first, with each rider's minutes, rings and guest
 * flag — read from the existing per-month session index (no new storage).
 * Every video a session played counts, not just its primary, and a rider's
 * minutes are capped at how long that video played.
 *
 * It does not decide who "counts" as having done an episode: the credit rule
 * (rode at least half the episode) needs the episode's duration, which the
 * caller has and the index does not.
 */

// The session index is per-month shards; a range read before any session
// existed only walks empty months, so a generous floor costs little.
const DEFAULT_HISTORY_START = '2010-01-01';
const MAX_EPISODES = 500;

/** "605624" and "plex:605624" name the same episode. */
export function normalizeEpisodeId(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return /^\d+$/.test(s) ? `plex:${s}` : s;
}

/** Minutes a rider was measured in a session (sum of zone minutes), or null when unrecorded. */
export function riderMinutes(participant = {}) {
  const zones = participant.zoneMinutes;
  if (!zones || typeof zones !== 'object') return null;
  const total = Object.values(zones).reduce((sum, v) => sum + (Number.isFinite(Number(v)) ? Number(v) : 0), 0);
  return total > 0 ? Math.round(total * 10) / 10 : null;
}

/**
 * Every episode a session played, with how long it played. Index entries from
 * v9 list each video in `media.items`; older ones only name the primary.
 */
export function playedEpisodes(session) {
  const items = Array.isArray(session?.media?.items) ? session.media.items : null;
  const list = items && items.length
    ? items.map((m) => ({ contentId: normalizeEpisodeId(m?.contentId), playedMs: Number.isFinite(m?.playedMs) ? m.playedMs : null }))
    : [{ contentId: normalizeEpisodeId(session?.media?.primary?.contentId), playedMs: null }];
  const seen = new Set();
  return list.filter((e) => e.contentId && !seen.has(e.contentId) && seen.add(e.contentId));
}

export class QueryEpisodeHistory {
  #sessionService;
  #logger;
  #historyStart;
  #now;

  constructor({ sessionService, logger = console, historyStart = DEFAULT_HISTORY_START, now = () => new Date() } = {}) {
    if (!sessionService) throw new Error('QueryEpisodeHistory: sessionService required');
    this.#sessionService = sessionService;
    this.#logger = logger;
    this.#historyStart = historyStart;
    this.#now = now;
  }

  /**
   * @param {Object} params
   * @param {string[]} params.episodeIds - episode content ids (bare plex numbers accepted)
   * @param {string} [params.household]
   * @returns {Promise<{episodes: Object<string, Array>}>} keyed by normalized content id;
   *   episodes with no sessions are omitted
   */
  async execute({ episodeIds = [], household } = {}) {
    const wanted = new Set(
      (Array.isArray(episodeIds) ? episodeIds : []).map(normalizeEpisodeId).filter(Boolean).slice(0, MAX_EPISODES)
    );
    if (wanted.size === 0) return { episodes: {} };

    const t0 = Date.now();
    const endDate = this.#now().toISOString().split('T')[0];
    const sessions = await this.#sessionService.listSessionsInRange(this.#historyStart, endDate, household);

    const episodes = {};
    for (const session of sessions || []) {
      if (Object.keys(session?.participants || {}).length === 0) continue;
      for (const { contentId, playedMs } of playedEpisodes(session)) {
        if (!wanted.has(contentId)) continue;
        // Zone minutes cover the whole session; nobody rode an episode longer than it played.
        const cap = playedMs != null ? Math.round((playedMs / 60000) * 10) / 10 : null;
        const riders = Object.entries(session.participants).map(([id, p]) => {
          const minutes = riderMinutes(p);
          return {
            id,
            displayName: p?.displayName || id,
            minutes: minutes != null && cap != null ? Math.min(minutes, cap) : minutes,
            rings: Number.isFinite(p?.rings) ? p.rings : null,
            isGuest: p?.isGuest === true,
            hrAvg: Number.isFinite(p?.hrAvg) ? p.hrAvg : null,
          };
        });
        (episodes[contentId] ||= []).push({
          sessionId: String(session.sessionId),
          date: session.date || null,
          startTime: Number.isFinite(session.startTime) ? session.startTime : null,
          playedMs,
          riders,
        });
      }
    }
    for (const list of Object.values(episodes)) {
      list.sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
    }

    this.#logger.info?.('fitness.episode_history.query', {
      requested: wanted.size,
      matched: Object.keys(episodes).length,
      scanned: (sessions || []).length,
      totalMs: Date.now() - t0,
    });
    return { episodes };
  }
}

export default QueryEpisodeHistory;
