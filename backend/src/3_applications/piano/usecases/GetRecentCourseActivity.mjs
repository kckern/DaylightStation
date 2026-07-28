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
import { excludeReferenceUnits } from '../courseProgress.mjs';

const HARD_TTL_MS = 6 * 60 * 60 * 1000;
// Thumbnails per player card on the menu strip.
const MAX_COURSES_PER_PLAYER = 2;

// The playable SERVICE nests parentId under item.metadata (the HTTP router
// flattens it — a known gotcha); accept both so either shape groups units.
const unitOf = (it) => it?.parentId ?? it?.metadata?.parentId ?? null;

/**
 * Card-content selectors — what fills a player's thumbnails, config-driven via
 * piano.yml `menu_activity.slots` (applied in order until the card is full,
 * deduped by course). Each builder gets the player's touched courses
 * (newest-first) and returns an ordered candidate list.
 *
 * Default `top-incomplete-courses`: highest percent first, 100% courses
 * excluded — surface the course they're closest to finishing.
 *
 * `recent-sheet-music` and `top-polish` are recognized placeholders for
 * non-course sources (sheet-music history, polish scores); they contribute
 * nothing until implemented, but configs may already list them.
 */
const SLOT_BUILDERS = {
  // Incompleteness is judged at the COURSE level (courseCompleted), but the
  // displayed/ranked percent is the player's progress through their CURRENT
  // MODULE — a 344-lecture program at 9% overall is discouraging; "unit 6,
  // 60% done" is motivating.
  'top-incomplete-courses': (courses) => courses
    .filter((c) => !c.courseCompleted)
    .sort((a, b) => (b.percent - a.percent)
      || String(b.lastPlayedAt).localeCompare(String(a.lastPlayedAt))),
  'recent-courses': (courses) => courses, // already newest-first
  'recent-sheet-music': () => [],         // placeholder — not yet implemented
  'top-polish': () => [],                 // placeholder — not yet implemented
};
const DEFAULT_SLOTS = ['top-incomplete-courses'];

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

  /**
   * Lesson scope = every tab group whose label contains "lesson" (so Piano
   * Lessons AND Voice Lessons count; Music Appreciation doesn't), falling back
   * to the first group when no label matches. Groups contribute their plex
   * collections plus any directly-listed `shows` (which may live in no
   * collection at all).
   */
  #lessonScope() {
    const videos = (this.#configService.getHouseholdAppConfig(null, 'piano') || {}).videos || {};
    const strip = (id) => String(id).replace(/^plex:/, '');
    const toList = (v) => (Array.isArray(v) ? v : [v]).filter(Boolean);
    if (Array.isArray(videos.collections) && videos.collections.length) {
      const lessonGroups = videos.collections.filter((g, i) => (g?.label ? /lesson/i.test(String(g.label)) : i === 0));
      const scoped = lessonGroups.length ? lessonGroups : [videos.collections[0]];
      return {
        collectionIds: [...new Set(scoped.flatMap((g) => toList(g?.plex ?? g?.collections)).map(strip))],
        showIds: [...new Set(scoped.flatMap((g) => toList(g?.shows)).map(strip))],
      };
    }
    const flat = toList(videos.plexCollection);
    return { collectionIds: flat.map(strip), showIds: [] };
  }

  async execute() {
    const roster = (this.#configService.getHouseholdUsers?.() || []).map(String);
    const key = roster.map((id) => `${id}:${this.#userVideoProgressStore.progressFileMtime(id)}`).join('|');
    if (this.#cache && this.#cache.key === key && Date.now() - this.#cache.at < HARD_TTL_MS) {
      return this.#cache.result;
    }

    let fetchFailed = false;
    const shows = [];
    // Dedupe by ratingKey: the RAW /children container can list a collection
    // item more than once (observed live 2026-07-28 — every show doubled),
    // and a show may also legitimately sit in two configured collections.
    const seenShowIds = new Set();
    const scope = this.#lessonScope();
    for (const collectionId of scope.collectionIds) {
      try {
        const children = await this.#plexClient.children(collectionId);
        for (const c of children || []) {
          const id = String(c.ratingKey);
          if (seenShowIds.has(id)) continue;
          seenShowIds.add(id);
          shows.push({ id, title: c.title || '', thumb: c.thumb || null });
        }
      } catch (err) {
        fetchFailed = true;
        this.#logger.warn?.('piano.activity.children_failed', { collectionId, error: err.message });
      }
    }
    // Directly-listed lesson shows (config `shows:`) that no collection walk
    // covered — fetch their own metadata for the tile fields.
    for (const showId of scope.showIds) {
      if (seenShowIds.has(String(showId))) continue;
      try {
        const meta = await this.#plexClient.metadata?.(showId);
        if (!meta) continue;
        seenShowIds.add(String(showId));
        shows.push({ id: String(showId), title: meta.title || '', thumb: meta.thumb || null });
      } catch (err) {
        fetchFailed = true;
        this.#logger.warn?.('piano.activity.metadata_failed', { showId, error: err.message });
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

    const pianoCfg = this.#configService.getHouseholdAppConfig(null, 'piano') || {};
    const menuCfg = pianoCfg.menu_activity || {};
    const slots = Array.isArray(menuCfg.slots) && menuCfg.slots.length ? menuCfg.slots.map(String) : DEFAULT_SLOTS;
    const referenceUnits = pianoCfg.videos?.reference_units || [];

    const players = [];
    for (const userId of roster) {
      const touched = [];
      for (const show of shows) {
        const rawItems = perShowItems.get(show.id);
        if (!rawItems?.length) continue;
        // Same lesson-counting rules as the poster wall: reference/practice
        // banks never count toward progress.
        const items = excludeReferenceUnits(rawItems, show.id, referenceUnits);
        if (!items.length) continue;
        const enriched = this.#userVideoProgressStore.enrich(items, userId);
        // Course-level aggregation + the player's most recent lecture (its
        // unit is their "current module").
        let courseCompleted = 0;
        let lastPlayedAt = null;
        let currentUnitId = null;
        for (const it of enriched) {
          if (it.userWatched) courseCompleted += 1;
          const lp = it.userLastPlayedAt;
          if (lp && (!lastPlayedAt || String(lp) > String(lastPlayedAt))) {
            lastPlayedAt = lp;
            currentUnitId = unitOf(it);
          }
        }
        if (!lastPlayedAt) continue;
        // Module-scoped progress: percent through the CURRENT unit, not the
        // whole program (motivating on multi-hundred-lecture courses). Flat
        // single-unit courses degrade to whole-course numbers naturally.
        const unitItems = enriched.filter((it) => unitOf(it) === currentUnitId);
        const unitCompleted = unitItems.filter((it) => it.userWatched).length;
        touched.push({
          show,
          lastPlayedAt,
          completed: unitCompleted,
          total: unitItems.length,
          courseCompleted: enriched.length > 0 && courseCompleted >= enriched.length,
        });
      }
      if (!touched.length) continue;
      touched.sort((a, b) => String(b.lastPlayedAt).localeCompare(String(a.lastPlayedAt)));
      const allCourses = touched.map((e) => ({
        courseId: `plex:${e.show.id}`,
        courseTitle: e.show.title,
        thumbnail: e.show.thumb,
        completed: e.completed,
        total: e.total,
        percent: e.total > 0 && e.completed > 0
          ? Math.max(1, Math.round((e.completed / e.total) * 100)) : 0,
        courseCompleted: e.courseCompleted,
        lastPlayedAt: e.lastPlayedAt,
      }));

      // Fill the card from the configured slots in order, dedupe by course.
      const courses = [];
      const seenCourseIds = new Set();
      for (const slot of slots) {
        const builder = SLOT_BUILDERS[slot];
        if (!builder) {
          this.#logger.warn?.('piano.activity.unknown_slot', { slot });
          continue;
        }
        for (const c of builder(allCourses)) {
          if (courses.length >= MAX_COURSES_PER_PLAYER) break;
          if (seenCourseIds.has(c.courseId)) continue;
          seenCourseIds.add(c.courseId);
          courses.push(c);
        }
      }
      // A player whose slots yield nothing (e.g. every course at 100%) still
      // deserves a card — fall back to their recent courses (their trophy).
      if (!courses.length) {
        courses.push(...allCourses.slice(0, MAX_COURSES_PER_PLAYER));
      }

      const newest = allCourses[0].lastPlayedAt;
      const p = this.#configService.getUserProfile(userId);
      players.push({
        userId,
        name: p?.display_name || p?.username || userId,
        lastPlayedAt: newest, // newest overall — drives ordering + staleness
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
