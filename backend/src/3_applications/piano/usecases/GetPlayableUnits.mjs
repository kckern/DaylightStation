import { isSameStudyDay } from '#domains/school/studyDay.mjs';
import { playableUnitSettings } from '#apps/piano/PianoVideoPolicy.mjs';

/** School's program id for a sequential piano VIDEO course. */
const PIANO_COURSE_PROGRAM = 'piano-course';

/** The household's study day rolls at 4am, same as the rest of the agenda. */
const STUDY_DAY_BOUNDARY_HOUR = 4;

/** Assignments store `plex:12345`; a bare course id means the same course. */
const normalizeCourseId = (value) => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const id = String(value);
  return id.startsWith('plex:') ? id : `plex:${id}`;
};

const numericOrder = (value) => (Number.isFinite(Number(value)) ? Number(value) : Number.MAX_SAFE_INTEGER);

/**
 * GetPlayableUnits — a course's playable units for one kiosk user.
 *
 * Verbatim extraction of the algorithm the piano router used to inline at
 * GET /piano/courses/:courseId/playable: fetch the course's playable episodes,
 * lift the unit/season link to item top-level, per-user progress enrichment,
 * reference-unit matching (config-flagged, never-gated units), and the
 * co-progress lock (block the ahead user in a paired sequential course until the
 * gap falls below `rule.buffer`).
 *
 * PACING NEVER OUTRANKS AN ASSIGNMENT. The co-progress lock paces DISCRETIONARY
 * practice: it keeps paired learners moving together and stops one racing ahead.
 * It must not decide whether a child can finish the schoolwork the household gave
 * them — a lesson nobody but a sibling can unblock is an obligation that cannot be
 * discharged. So when School has enrolled this learner in a `piano-course` program
 * for THIS course and they have not yet completed a lesson today, the ONE lesson
 * that discharges today's obligation is named in `coProgressLock.exemptLessonIds`
 * and the surfaces let it through.
 *
 * The exemption is PER-LESSON, not per-course, and it costs nothing to the pacing
 * rule: the existing linear gate already locks every lesson past the first unwatched
 * one, so exempting that first one buys exactly one lesson. The moment it is
 * completed the exemption is withdrawn (the day's obligation is discharged) and
 * pacing governs the rest of the day. `exemptLessonIds` is absent, not empty, when
 * no override applies — the lock's shape is unchanged for every ordinary lockout.
 *
 * Returns a discriminated result so the router keeps HTTP mapping thin:
 *   { ok: false, reason: 'invalid_user' }         → router 400
 *   { ok: true, result: { ...playable, isSequential, coProgressLock, referenceUnitIds } }
 *
 * Dependencies (fitnessPlayableService, userVideoProgressStore, configProjection)
 * are constructor-injected at the composition root.
 */
export class GetPlayableUnits {
  #fitnessPlayableService;
  #userVideoProgressStore;
  #configProjection;
  #logger;
  #learningService;
  #curriculumIndex;
  #schoolAssignments;
  #clock;

  /**
   * `curriculumIndex` is INJECTED (Decision D1: a use case never imports a
   * concrete adapter — no exceptions). It supplies `getCurriculumIndex` and
   * `mergeSeason`, which read Plex's curriculum layout; bootstrap owns which
   * implementation that is.
   *
   * `schoolAssignments` is School's learner assignment store (`get(learnerId)`
   * → `{ programs: [...] }`), injected for the same reason and read ONLY to
   * decide whether a locked-out lesson is today's assigned schoolwork. Null in
   * a composition without School: the co-progress lock then behaves exactly as
   * it always has. The raw store is deliberate — asking School's
   * `PianoCourseProgramLauncher` instead would recurse, since the launcher's
   * own status() is built on this use case.
   */
  constructor({
    fitnessPlayableService, userVideoProgressStore = null, configProjection,
    learningService = null, curriculumIndex = null, schoolAssignments = null,
    clock = () => new Date(), logger = console,
  } = {}) {
    this.#curriculumIndex = curriculumIndex;
    this.#fitnessPlayableService = fitnessPlayableService;
    this.#userVideoProgressStore = userVideoProgressStore;
    this.#configProjection = configProjection;
    this.#learningService = learningService;
    this.#schoolAssignments = schoolAssignments;
    this.#clock = clock;
    this.#logger = logger;
  }

  // Router's knownUser() fallback (used only when no progress store is wired).
  #isKnownUser(userId) {
    return typeof userId === 'string' && userId.length > 0
      && !userId.includes('/') && !userId.includes('\\') && !userId.includes('..')
      && this.#configProjection.isKnownUser(userId);
  }

  /**
   * @param {{ courseId: string, userId?: string }} params
   */
  async execute({ courseId, userId } = {}) {
    // `guest` is the who's-playing dismiss-outcome identity (it never has tracked
    // progress). Treat it like an anonymous request: serve the course + isSequential
    // with NO per-user enrichment, rather than rejecting it — otherwise an idle
    // kiosk that fell back to Guest would 400 here and the course would render blank.
    const isGuest = userId === 'guest';

    // Validate a real userId. Prefer the store's guard if wired, else the router's
    // knownUser() — both reject unknown users with 400 (guest is exempted above).
    if (userId && !isGuest) {
      const ok = this.#userVideoProgressStore ? this.#userVideoProgressStore.isKnownUser(userId) : this.#isKnownUser(userId);
      if (!ok) return { ok: false, reason: 'invalid_user' };
    }

    const playable = await this.#fitnessPlayableService.getPlayableEpisodes(courseId);

    // Surface the unit/season link at the item top-level. The shared playable
    // service nests it under `metadata.parentId/parentIndex/parentTitle`, but the
    // frontend's unit grouping (CourseDetail.episodesOf) keys off a top-level
    // `parentId` that matches the `parents` map. Without this lift, multi-unit
    // courses (e.g. Hoffman Academy's 18 units) render zero episodes per unit.
    if (Array.isArray(playable.items)) {
      playable.items = playable.items.map((it) => {
        const md = it?.metadata || {};
        return {
          ...it,
          parentId: it.parentId ?? md.parentId ?? null,
          parentIndex: it.parentIndex ?? md.parentIndex ?? null,
          parentTitle: it.parentTitle ?? md.parentTitle ?? null,
          // The episode number (E12 badge) and intra-unit sort key live under
          // metadata too; lift so the grid can label + order lectures correctly.
          itemIndex: it.itemIndex ?? md.itemIndex ?? null,
          // Curriculum metadata (course grouping, styles, skill, instructor, and
          // the season category block) is merged onto metadata.piano by the Plex
          // adapter; lift it top-level so the curriculum UX reads item.piano.*
          // consistently with the /list contract.
          piano: it.piano ?? md.piano ?? null,
        };
      });
    }

    // Flow each season's curriculum category block into the parents map so the
    // three-lane UX can route Lessons / Reference / Repertoire.
    const curIdx = this.#curriculumIndex?.getCurriculumIndex?.(courseId);
    if (curIdx && playable.parents && typeof playable.parents === 'object') {
      for (const p of Object.values(playable.parents)) {
        const merged = this.#curriculumIndex?.mergeSeason?.(curIdx, p?.index);
        if (merged?.piano) p.piano = merged.piano;
      }
    }

    // Per-user progress enrichment (userPercent/userWatched/etc.) via the shared
    // store — known users only; guest/anonymous get the course with no progress.
    if (userId && !isGuest && this.#userVideoProgressStore) {
      playable.items = this.#userVideoProgressStore.enrich(playable.items, userId);
    }

    // Lesson checkpoints use the same requirement/evidence projection as the
    // Exercises dashboard. The media adapter only carries the declaration;
    // this use case adds the per-learner answer.
    if (Array.isArray(playable.items)) {
      const checkpoints = playable.items.map((item) => item?.piano?.checkpoint).filter(Boolean);
      const statuses = this.#learningService?.requirementStatuses?.(userId ?? 'guest', checkpoints) ?? [];
      let checkpointIndex = 0;
      playable.items = playable.items.map((item) => {
        const checkpoint = item?.piano?.checkpoint;
        if (!checkpoint) return item;
        const status = statuses[checkpointIndex++]
          ?? this.#learningService?.requirementStatus?.(userId ?? 'guest', checkpoint)
          ?? { passed: false, passes: 0, required_passes: 1 };
        return { ...item, checkpointStatus: status };
      });
    }

    const settings = playableUnitSettings(this.#configProjection.raw());
    const compoundId = playable.compoundId || `plex:${courseId}`;
    const sequentialLabels = new Set(
      settings.sequentialLabels.map((l) => l.toLowerCase())
    );
    const isSequential = Array.isArray(playable.info?.labels) &&
      playable.info.labels.some((l) => sequentialLabels.has(String(l).toLowerCase()));

    // Reference units: config-flagged units (by title pattern or explicit id) that
    // are never gated, give no progression credit, and render in the always-open
    // Practice & Reference zone. Matched per course against unit (season) titles.
    const referenceUnitIds = new Set();
    const refRule = settings.referenceUnits.find((r) => r.courseId === compoundId);
    if (refRule) {
      const patterns = (refRule.titlePatterns || []).map((p) => String(p).toLowerCase()).filter(Boolean);
      const explicit = new Set((refRule.unitIds || []).map(String));
      for (const [pid, parent] of Object.entries(playable.parents || {})) {
        const title = String(parent?.title || '').toLowerCase();
        if (explicit.has(String(pid)) || patterns.some((pat) => title.includes(pat))) {
          referenceUnitIds.add(String(pid));
        }
      }
    }
    if (Array.isArray(playable.items)) {
      playable.items = playable.items.map((it) => ({
        ...it,
        isReference: referenceUnitIds.has(String(it.parentId)),
      }));
    }

    // Co-progress lock: in sequential courses with a configured user pair, block the
    // ahead user from the next episode until the gap falls below the buffer. Reference
    // episodes give no credit, so they're excluded from both users' counts.
    let coProgressLock = null;
    if (isSequential && userId && !isGuest && this.#userVideoProgressStore) {
      const rules = settings.coProgress;
      const rule = rules.find(
        (r) => r.courseId === compoundId &&
               Array.isArray(r.users) &&
               r.users.includes(userId),
      );
      if (rule) {
        const isCredit = (it) => it.userWatched && !referenceUnitIds.has(String(it.parentId));
        const myCount = (playable.items || []).filter(isCredit).length;
        const partnerIds = rule.users.filter((u) => u !== userId);
        const partnerCounts = partnerIds.map((pid) => {
          if (!this.#userVideoProgressStore.isKnownUser(pid)) return 0;
          const enriched = this.#userVideoProgressStore.enrich(playable.items || [], pid);
          return enriched.filter(isCredit).length;
        });
        if (partnerCounts.length) {
          const minPartnerCount = Math.min(...partnerCounts);
          const aheadBy = myCount - minPartnerCount;
          if (aheadBy >= rule.buffer) {
            const slowestIndex = partnerCounts.indexOf(minPartnerCount);
            coProgressLock = {
              locked: true,
              aheadBy,
              waitingForId: partnerIds[slowestIndex],
              buffer: rule.buffer,
            };
            // ...unless School assigned this learner a lesson today. Only then
            // do we pay for the assignment lookup — free-play in an unlocked
            // course never touches School at all.
            const exempt = await this.#assignedLessonId({
              userId, compoundId, items: playable.items || [], referenceUnitIds,
            });
            if (exempt) {
              coProgressLock.exemptLessonIds = [exempt];
              // A parent WILL ask why the pacing rule let this one through.
              this.#logger.info?.('piano.co-progress.assigned-override', {
                userId, courseId: compoundId, lessonId: exempt,
                waitingForId: coProgressLock.waitingForId, aheadBy, buffer: rule.buffer,
              });
            }
          }
        }
      }
    }

    this.#logger.info?.('piano.courses.playable', { courseId, userId: userId || null, isSequential });
    return { ok: true, result: { ...playable, isSequential, coProgressLock, referenceUnitIds: [...referenceUnitIds] } };
  }

  /**
   * The one lesson a co-progress lockout must not block: today's assigned
   * schoolwork. Returns the episode key (the same `plex || id` the kiosk grids
   * on), or null when nothing is assigned, the day's lesson is already done, or
   * School is not wired.
   */
  async #assignedLessonId({ userId, compoundId, items, referenceUnitIds }) {
    if (!this.#schoolAssignments?.get) return null;

    let programs;
    try {
      programs = (await this.#schoolAssignments.get(userId))?.programs ?? [];
    } catch (error) {
      // A missing or corrupt assignment file must fail CLOSED: an unreadable
      // agenda is not evidence that a lesson was assigned.
      this.#logger.warn?.('piano.co-progress.assignment-lookup-failed', {
        userId, courseId: compoundId, error: error?.message ?? String(error),
      });
      return null;
    }

    const enrolled = programs.some((row) => row?.programId === PIANO_COURSE_PROGRAM
      && normalizeCourseId(row.courseId ?? row.corpusId) === compoundId);
    if (!enrolled) return null;

    // Reference/practice units carry no credit in the kiosk's progression, so
    // they cannot be the assigned lesson and cannot discharge the obligation.
    const credit = items
      .filter((item) => item && !referenceUnitIds.has(String(item.parentId)))
      .sort((left, right) => numericOrder(left.parentIndex) - numericOrder(right.parentIndex)
        || numericOrder(left.itemIndex) - numericOrder(right.itemIndex));

    // Already did today's lesson: the obligation is discharged and everything
    // after it is discretionary practice again, which pacing rightly governs.
    const nowMs = this.#nowMs();
    const timezone = this.#configProjection.timezone();
    const doneToday = credit.some((item) => item.userCompletedAt
      && isSameStudyDay(Date.parse(item.userCompletedAt), nowMs, { timezone, boundaryHour: STUDY_DAY_BOUNDARY_HOUR }));
    if (doneToday) return null;

    const next = credit.find((item) => !item.userWatched);
    const key = next?.plex ?? next?.id ?? null;
    return key == null ? null : String(key);
  }

  #nowMs() {
    const now = this.#clock();
    return now instanceof Date ? now.getTime() : Number(now);
  }
}

export default GetPlayableUnits;
