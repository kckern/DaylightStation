/**
 * GetRecentCourseActivity — per-player most-recent lesson-course progress for
 * the kiosk menu activity strip (spec 2026-07-28-piano-menu-activity-strip).
 *
 * Scope: the FIRST group in piano.yml videos.collections (the Music Lessons
 * tab); legacy flat plexCollection when no groups exist. Results cached
 * in-memory keyed on the roster's progress-file mtimes (+ 6h hard TTL for
 * Plex metadata drift) so menu loads never re-walk Plex when nothing changed.
 */
const HARD_TTL_MS = 6 * 60 * 60 * 1000;

export class GetRecentCourseActivity {
  #fitnessPlayableService; #userVideoProgressStore; #configService; #plexClient; #logger;
  #cache = null; // { key, at, result }

  constructor({ fitnessPlayableService, userVideoProgressStore, configService, plexClient, logger = console } = {}) {
    this.#fitnessPlayableService = fitnessPlayableService;
    this.#userVideoProgressStore = userVideoProgressStore;
    this.#configService = configService;
    this.#plexClient = plexClient;
    this.#logger = logger;
  }

  #lessonCollectionIds() {
    const videos = (this.#configService.getHouseholdAppConfig(null, 'piano') || {}).videos || {};
    if (Array.isArray(videos.collections) && videos.collections.length) {
      const group = videos.collections[0];
      const list = Array.isArray(group?.plex) ? group.plex : [group?.plex];
      return list.filter(Boolean).map((id) => String(id).replace(/^plex:/, ''));
    }
    const flat = Array.isArray(videos.plexCollection) ? videos.plexCollection : [videos.plexCollection];
    return flat.filter(Boolean).map((id) => String(id).replace(/^plex:/, ''));
  }

  async execute() {
    const roster = (this.#configService.getHouseholdUsers?.() || []).map(String);
    const key = roster.map((id) => `${id}:${this.#userVideoProgressStore.progressFileMtime(id)}`).join('|');
    if (this.#cache && this.#cache.key === key && Date.now() - this.#cache.at < HARD_TTL_MS) {
      return this.#cache.result;
    }

    let fetchFailed = false;
    const shows = [];
    for (const collectionId of this.#lessonCollectionIds()) {
      try {
        const children = await this.#plexClient.children(collectionId);
        for (const c of children || []) shows.push({ id: String(c.ratingKey), title: c.title || '', thumb: c.thumb || null });
      } catch (err) {
        fetchFailed = true;
        this.#logger.warn?.('piano.activity.children_failed', { collectionId, error: err.message });
      }
    }

    const perShowItems = new Map();
    for (const show of shows) {
      try {
        const playable = await this.#fitnessPlayableService.getPlayableEpisodes(show.id);
        perShowItems.set(show.id, playable?.items || []);
      } catch (err) {
        fetchFailed = true;
        this.#logger.warn?.('piano.activity.playable_failed', { showId: show.id, error: err.message });
      }
    }

    const players = [];
    for (const userId of roster) {
      let best = null;
      for (const show of shows) {
        const items = perShowItems.get(show.id);
        if (!items?.length) continue;
        const s = this.#userVideoProgressStore.summarize(items, userId);
        if (!s.lastPlayedAt) continue;
        if (!best || String(s.lastPlayedAt) > String(best.lastPlayedAt)) {
          best = { show, ...s };
        }
      }
      if (!best) continue;
      const p = this.#configService.getUserProfile(userId);
      const percent = best.total > 0 && best.completed > 0
        ? Math.max(1, Math.round((best.completed / best.total) * 100)) : 0;
      players.push({
        userId,
        name: p?.display_name || p?.username || userId,
        courseId: `plex:${best.show.id}`,
        courseTitle: best.show.title,
        thumbnail: best.show.thumb,
        completed: best.completed,
        total: best.total,
        percent,
        lastPlayedAt: best.lastPlayedAt,
      });
    }
    players.sort((a, b) => String(b.lastPlayedAt).localeCompare(String(a.lastPlayedAt)));

    const result = { players };
    if (fetchFailed) {
      // A transient Plex outage produced a degraded result — skip the cache
      // write so the next request recomputes instead of pinning the blanked
      // strip behind the mtime key for up to HARD_TTL_MS.
      this.#logger.warn?.('piano.activity.cache_skipped', { players: players.length, shows: shows.length });
    } else {
      this.#cache = { key, at: Date.now(), result };
    }
    this.#logger.info?.('piano.activity.computed', { players: players.length, shows: shows.length });
    return result;
  }
}

export default GetRecentCourseActivity;
