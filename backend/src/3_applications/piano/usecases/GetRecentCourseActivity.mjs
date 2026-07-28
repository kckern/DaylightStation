/**
 * GetRecentCourseActivity — per-player recent lesson-course progress for the
 * kiosk menu activity strip (spec 2026-07-28-piano-menu-activity-strip): each
 * player's most recent courses (up to MAX_COURSES_PER_PLAYER), newest first.
 *
 * Scope: the FIRST group in piano.yml videos.collections (the Music Lessons
 * tab); legacy flat plexCollection when no groups exist. Results cached
 * in-memory keyed on the roster's progress-file mtimes (+ 6h hard TTL for
 * Plex metadata drift) so menu loads never re-walk Plex when nothing changed.
 */
const HARD_TTL_MS = 6 * 60 * 60 * 1000;
// Thumbnails per player card on the menu strip — recent courses beyond this
// are dropped (most-recent-first).
const MAX_COURSES_PER_PLAYER = 4;

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
      const touched = [];
      for (const show of shows) {
        const items = perShowItems.get(show.id);
        if (!items?.length) continue;
        const s = this.#userVideoProgressStore.summarize(items, userId);
        if (!s.lastPlayedAt) continue;
        touched.push({ show, ...s });
      }
      if (!touched.length) continue;
      touched.sort((a, b) => String(b.lastPlayedAt).localeCompare(String(a.lastPlayedAt)));
      const courses = touched.slice(0, MAX_COURSES_PER_PLAYER).map((e) => ({
        courseId: `plex:${e.show.id}`,
        courseTitle: e.show.title,
        thumbnail: e.show.thumb,
        completed: e.completed,
        total: e.total,
        percent: e.total > 0 && e.completed > 0
          ? Math.max(1, Math.round((e.completed / e.total) * 100)) : 0,
        lastPlayedAt: e.lastPlayedAt,
      }));
      const p = this.#configService.getUserProfile(userId);
      players.push({
        userId,
        name: p?.display_name || p?.username || userId,
        lastPlayedAt: courses[0].lastPlayedAt, // newest — drives ordering + staleness
        courses,
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
