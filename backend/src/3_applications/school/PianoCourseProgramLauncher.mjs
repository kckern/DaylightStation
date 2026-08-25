/**
 * PianoCourseProgramLauncher — School's adapter around a sequential piano
 * VIDEO course (Hoffman Academy today), so "one lesson a day at the piano"
 * is an obligation the agenda can carry and settle.
 *
 * WHY THIS IS NOT A `SurfaceProgramLauncher`. The generic config-driven
 * launcher settles a day on the DISPATCH — honour-system, correct for PE in
 * the garage where nothing downstream reports back. The piano reports back:
 * `YamlUserVideoProgressStore` already stamps `completedAt` the moment a
 * lesson crosses the household's `completion_threshold_percent` AND the
 * child actually played along (`engaged`). Settling on dispatch here would
 * throw away evidence we already hold, and would credit a kiosk opened and
 * walked away from. So `doneToday` reads the evidence.
 *
 * LAUNCHING RE-RESOLVES THE NEXT LESSON. Agenda QR/panel tokens name the
 * learner and subject, not a frozen episode. At action time this launcher
 * asks the same `GetPlayableUnits` projection the kiosk renders, then sends a
 * structured course/unit/lesson command to the Piano kiosk.
 *
 * THE CO-PROGRESS LOCK IS AN EXCUSE, NOT A DEBT. `piano.yml` pairs the two
 * learners with a `buffer`, and the AHEAD child is blocked from their next
 * lesson until the partner catches up. An obligation nobody can discharge
 * would sit unfinished on that child's agenda every day until someone else
 * acted — so a locked day settles as done, carrying `excused` and wording
 * that names the partner rather than claiming a lesson happened. A child
 * who ALREADY completed a lesson today is done on the evidence, and the
 * lock never enters into it.
 *
 * @module applications/school/PianoCourseProgramLauncher
 */
import { isSameStudyDay } from '#domains/school/studyDay.mjs';

/** The household's study day rolls at 4am, same as the rest of the agenda. */
const BOUNDARY_HOUR = 4;

const plexId = (value) => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const id = String(value);
  return id.startsWith('plex:') ? id : `plex:${id}`;
};

const lessonId = (item) => plexId(item?.plex ?? item?.id ?? item?.contentId);

const numericOrder = (value) => Number.isFinite(Number(value)) ? Number(value) : Number.MAX_SAFE_INTEGER;

const orderedCreditItems = (result) => (result?.items ?? [])
  .filter((item) => item && !item.isReference)
  .sort((left, right) => numericOrder(left.parentIndex) - numericOrder(right.parentIndex)
    || numericOrder(left.itemIndex) - numericOrder(right.itemIndex));

export class PianoCourseProgramLauncher {
  #getPlayableUnits; #donow; #timezone; #clock; #logger;

  /**
   * @param {object} config
   * @param {{execute: Function}} config.getPlayableUnits - Piano's `GetPlayableUnits`
   *   use case, INJECTED (Decision D1: a use case never imports a concrete adapter).
   * @param {string|null} [config.timezone] - household timezone, for the study-day boundary
   * @param {() => Date} [config.clock]
   * @param {object} [config.logger]
   */
  constructor({ getPlayableUnits, donow = null, timezone = null, clock = () => new Date(), logger = console } = {}) {
    if (!getPlayableUnits || typeof getPlayableUnits.execute !== 'function') {
      throw new Error('PianoCourseProgramLauncher requires a getPlayableUnits use case');
    }
    this.#getPlayableUnits = getPlayableUnits;
    this.#donow = donow;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#logger = logger;
  }

  /** Stable id — matches the plan's `programId` and the agenda entry's `program`. */
  get id() { return 'piano-course'; }

  /** The surface a child physically goes to. */
  get surface() { return 'piano-kiosk'; }

  /** The FULL wording a child reads on their slip (mirrors a `launch:` unit's labelHint). */
  get locationHint() { return 'at the piano'; }

  /** QR and panel-code launches are supported through the Piano kiosk surface. */
  get mountable() { return true; }

  /**
   * @param {{userId: string, programInstance?: string|null}} args
   * @returns {Promise<{doneToday: boolean, excused?: boolean, progressLabel: string|null, score: number|null}>}
   */
  async status({ userId, programInstance = null }) {
    if (!programInstance) {
      return { doneToday: false, progressLabel: 'No piano course assigned', score: null };
    }

    let result;
    try {
      const answer = await this.#getPlayableUnits.execute({ courseId: programInstance, userId });
      // A rejected user is a wiring/roster problem, not "no lesson today" —
      // surface it as an error so the agenda degrades to `program_unavailable`
      // rather than silently telling a child their piano is done.
      if (!answer?.ok) {
        this.#logger.warn?.('school.piano-course.status-rejected', {
          userId, courseId: programInstance, reason: answer?.reason ?? 'unknown',
        });
        return { error: true };
      }
      result = { ...answer.result, compoundId: answer.result?.compoundId ?? programInstance };
    } catch (err) {
      this.#logger.warn?.('school.piano-course.status-failed', {
        userId, courseId: programInstance, error: err?.message ?? String(err),
      });
      return { error: true };
    }

    const nowMs = this.#nowMs();
    // Reference/practice units give no credit in the kiosk's own progression
    // (piano.yml `reference_units`), so they cannot discharge the obligation
    // either — the two must agree or a child "finishes" school by replaying a
    // warm-up they are never locked out of.
    const credit = orderedCreditItems(result);
    const completedToday = credit.filter((item) => item.userCompletedAt
      && isSameStudyDay(Date.parse(item.userCompletedAt), nowMs, {
        timezone: this.#timezone, boundaryHour: BOUNDARY_HOUR,
      }));

    const total = credit.length;
    const completed = credit.filter((item) => item.userWatched).length;
    const score = total ? Math.round((completed / total) * 100) : null;
    const next = credit.find((item) => !item.userWatched) ?? null;
    const focus = completedToday[completedToday.length - 1] ?? next ?? credit[credit.length - 1] ?? null;
    const projection = this.#context({ result, item: focus, credit, completed, total });
    const completedLessons = credit.filter((item) => item.userCompletedAt).map((item) => (
      this.#lessonContext({ result, item })
    ));
    const common = {
      score,
      context: projection,
      progress: this.#progress({ focus, credit, completed, total }),
      completedLessons,
      completedLessonsToday: completedLessons.filter((row) => row.completedAt
        && isSameStudyDay(Date.parse(row.completedAt), nowMs, {
          timezone: this.#timezone, boundaryHour: BOUNDARY_HOUR,
        })),
    };

    if (completedToday.length) {
      const title = completedToday[completedToday.length - 1]?.title ?? 'a lesson';
      return {
        ...common,
        doneToday: true,
        progressLabel: `Done today — ${title} · ${completed}/${total}`,
      };
    }

    // Locked out by the partner's pace: nothing this child can do today.
    const lock = result.coProgressLock;
    if (lock?.locked) {
      return {
        ...common,
        doneToday: true,
        excused: true,
        progressLabel: `Waiting for ${lock.waitingForId} to catch up · ${completed}/${total}`,
      };
    }

    return {
      ...common,
      doneToday: false,
      progressLabel: next
        ? `${completed}/${total} · next: ${next.title}`
        : `${completed}/${total} — course complete`,
    };
  }

  /**
   * Resolve the exact next lesson at action time. The agenda token remains a
   * learner+subject alias; it never freezes a Plex episode for a week.
   */
  async issueLaunchTarget({ userId, programInstance = null, corpusId = null } = {}) {
    const courseId = programInstance ?? corpusId;
    if (!userId || !courseId) throw new Error('piano-course launch requires learner and course');
    const answer = await this.#getPlayableUnits.execute({ courseId, userId });
    if (!answer?.ok) throw new Error(`piano-course is unavailable: ${answer?.reason ?? 'unknown'}`);
    if (answer.result?.coProgressLock?.locked) throw new Error('piano-course is waiting for the paired learner');
    const result = { ...answer.result, compoundId: answer.result?.compoundId ?? courseId };
    const next = orderedCreditItems(result).find((item) => !item.userWatched);
    if (!next) throw new Error('piano-course has no unfinished lesson');
    const context = this.#lessonContext({ result, item: next });
    if (!context.lesson?.id) throw new Error('piano-course next lesson has no reachable Plex id');
    return {
      kind: 'course-lesson',
      courseId: context.course.id,
      courseTitle: context.course.title,
      unitId: context.unit?.id ?? null,
      unitTitle: context.unit?.title ?? null,
      lessonId: context.lesson.id,
      lessonTitle: context.lesson.title,
      learnerId: userId,
    };
  }

  /**
   * Dispatch the dynamically resolved lesson to the Piano kiosk.
   */
  async launch({ userId, corpusId = null, programInstance = null, unitId = null } = {}) {
    if (!this.#donow?.dispatch) {
      return { decision: 'failed', message: 'The Piano Kiosk is not connected. Ask a grown-up.' };
    }
    let target;
    try {
      target = await this.issueLaunchTarget({ userId, corpusId, programInstance });
    } catch (error) {
      return { decision: 'failed', message: error?.message ?? 'The piano lesson is unavailable.' };
    }
    return this.#donow.dispatch({
      surface: this.surface,
      action: target,
      learnerId: userId,
      requestedBy: 'school-program',
      ref: unitId ?? `${userId}:${target.courseId}:${target.lessonId}`,
      programId: this.id,
      // A School agenda launch is an explicit handoff: the kiosk abandons its
      // current in-app activity and becomes this learner's lesson surface.
      force: 'interrupt',
    });
  }

  #lessonContext({ result, item }) {
    if (!item) return { course: null, unit: null, lesson: null, completedAt: null };
    const parent = result?.parents?.[item.parentId] ?? null;
    return {
      course: {
        id: result?.compoundId ?? null,
        title: result?.info?.title ?? result?.title ?? result?.compoundId ?? 'Piano course',
      },
      unit: item.parentId ? {
        id: String(item.parentId),
        title: item.parentTitle ?? parent?.title ?? `Unit ${item.parentIndex ?? ''}`.trim(),
        ...(Number.isFinite(Number(item.parentIndex)) ? { position: Number(item.parentIndex) } : {}),
      } : null,
      lesson: {
        id: lessonId(item),
        title: item.title ?? lessonId(item) ?? 'Piano lesson',
        ...(Number.isFinite(Number(item.itemIndex)) ? { position: Number(item.itemIndex) } : {}),
      },
      completedAt: item.userCompletedAt ?? null,
    };
  }

  #context({ result, item }) {
    const { course, unit, lesson } = this.#lessonContext({ result, item });
    return { course, unit, lesson };
  }

  #progress({ focus, credit, completed, total }) {
    const rows = [{ scope: 'course', label: 'Course', completed, total }];
    if (focus?.parentId != null) {
      const inUnit = credit.filter((item) => String(item.parentId) === String(focus.parentId));
      rows.push({
        scope: 'module',
        label: focus.parentTitle ?? `Unit ${focus.parentIndex ?? ''}`.trim(),
        completed: inUnit.filter((item) => item.userWatched).length,
        total: inUnit.length,
      });
    }
    return rows.filter((row) => row.total > 0);
  }

  #nowMs() {
    const now = this.#clock();
    return now instanceof Date ? now.getTime() : Number(now);
  }
}

export default PianoCourseProgramLauncher;
