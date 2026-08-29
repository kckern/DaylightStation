/**
 * GetCourseProgress — per-course roster progress for the piano poster wall.
 *
 * Verbatim extraction of the algorithm the piano router used to inline at
 * GET /piano/courses/progress. For each requested course id it returns
 * `{ isSequential, total, users:[{id,name,completed,total,lastPlayedAt}] }`.
 * Users are filtered to those with recent, sufficient progress (per
 * the projected overlay settings) and only populated for sequential courses.
 *
 * Dependencies are constructor-injected at the composition root: the shared
 * Plex-backed `fitnessPlayableService`, the `userVideoProgressStore`, and a
 * semantic `configProjection`. The recency/exclusion/ranking rules come from the pure
 * `courseProgress` helpers.
 */
import { excludeReferenceUnits, isRecent, rankAndCapUsers } from '#apps/piano/courseProgress.mjs';
import { courseProgressSettings } from '#apps/piano/PianoVideoPolicy.mjs';

export class GetCourseProgress {
  #fitnessPlayableService;
  #userVideoProgressStore;
  #configProjection;
  #logger;

  constructor({ fitnessPlayableService, userVideoProgressStore = null, configProjection, logger = console } = {}) {
    this.#fitnessPlayableService = fitnessPlayableService;
    this.#userVideoProgressStore = userVideoProgressStore;
    this.#configProjection = configProjection;
    this.#logger = logger;
  }

  /**
   * @param {{ ids: string[] }} params
   * @returns {Promise<{ courses: Record<string, { isSequential:boolean, total:number, users:object[] }> }>}
   */
  async execute({ ids = [] } = {}) {
    const courses = {};
    if (ids.length === 0) return { courses };

    const settings = courseProgressSettings(this.#configProjection.raw());
    const sequentialLabels = new Set(settings.sequentialLabels.map((l) => String(l).toLowerCase()));
    const { recencyDays, minCompleted, maxAvatars, referenceUnits } = settings;

    // Household order, from household.yml — not a restatement in piano.yml.
    const roster = this.#configProjection.roster()
      .map((id) => {
        const p = this.#configProjection.profile(String(id));
        // Profiles carry display_name/username, not `name` — same resolution
        // as the roster endpoint (a bare `p.name` shipped "undefined" labels).
        return p ? { id: String(id), name: p.display_name || p.username || String(id) } : null;
      })
      .filter(Boolean);
    const now = new Date();

    for (const courseId of ids) {
      let playable;
      try {
        // The playable service keys off the bare Plex rating key (the grid sends
        // `plex:`-prefixed ids); strip for the call, keep the original as the map key.
        playable = await this.#fitnessPlayableService.getPlayableEpisodes(String(courseId).replace(/^plex:/, ''));
      } catch (err) {
        this.#logger.warn?.('piano.courses.progress.fetch_error', { courseId, error: err.message });
        continue;
      }
      const labels = playable?.info?.labels;
      const isSequential = Array.isArray(labels) && labels.some((l) => sequentialLabels.has(String(l).toLowerCase()));
      const items = excludeReferenceUnits(playable?.items || [], courseId, referenceUnits);
      const total = items.length;

      let users = [];
      if (isSequential && this.#userVideoProgressStore) {
        for (const u of roster) {
          const s = this.#userVideoProgressStore.summarize(items, u.id);
          if (s.completed >= minCompleted && isRecent(s.lastPlayedAt, recencyDays, now)) {
            users.push({ id: u.id, name: u.name, completed: s.completed, total, lastPlayedAt: s.lastPlayedAt });
          }
        }
        users = rankAndCapUsers(users, maxAvatars);
      }
      courses[courseId] = { isSequential, total, users };
    }

    this.#logger.info?.('piano.courses.progress', { ids: ids.length, courses: Object.keys(courses).length });
    return { courses };
  }
}

export default GetCourseProgress;
