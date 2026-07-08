/**
 * GetCourseProgress — per-course roster progress for the piano poster wall.
 *
 * Verbatim extraction of the algorithm the piano router used to inline at
 * GET /piano/courses/progress. For each requested course id it returns
 * `{ isSequential, total, users:[{id,name,completed,total,lastPlayedAt}] }`.
 * Users are filtered to those with recent, sufficient progress (per
 * videos.progress_overlay) and only populated for sequential courses.
 *
 * Dependencies are constructor-injected at the composition root: the shared
 * Plex-backed `fitnessPlayableService`, the `userVideoProgressStore`, and a
 * `configService` (used for the piano app config + roster profiles — passed in,
 * never imported). The recency/exclusion/ranking rules come from the pure
 * `courseProgress` helpers.
 */
import { excludeReferenceUnits, isRecent, rankAndCapUsers } from '#apps/piano/courseProgress.mjs';

export class GetCourseProgress {
  #fitnessPlayableService;
  #userVideoProgressStore;
  #configService;
  #logger;

  constructor({ fitnessPlayableService, userVideoProgressStore = null, configService, logger = console } = {}) {
    this.#fitnessPlayableService = fitnessPlayableService;
    this.#userVideoProgressStore = userVideoProgressStore;
    this.#configService = configService;
    this.#logger = logger;
  }

  /**
   * @param {{ ids: string[] }} params
   * @returns {Promise<{ courses: Record<string, { isSequential:boolean, total:number, users:object[] }> }>}
   */
  async execute({ ids = [] } = {}) {
    const courses = {};
    if (ids.length === 0) return { courses };

    const pianoConfig = this.#configService.getHouseholdAppConfig(null, 'piano') || {};
    const videos = pianoConfig.videos || {};
    const sequentialLabels = new Set((videos.sequential_labels || []).map((l) => String(l).toLowerCase()));
    const overlay = videos.progress_overlay || {};
    const recencyDays = overlay.recency_days ?? 7;
    const minCompleted = overlay.min_completed ?? 1;
    const maxAvatars = overlay.max_avatars ?? 4;
    const referenceUnits = videos.reference_units || [];

    const primary = Array.isArray(pianoConfig.users?.primary) ? pianoConfig.users.primary : [];
    const roster = primary
      .map((id) => { const p = this.#configService.getUserProfile(id); return p ? { id, name: p.name } : null; })
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
