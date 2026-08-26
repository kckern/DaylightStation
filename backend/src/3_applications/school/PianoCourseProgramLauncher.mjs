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
 * AN EXEMPTED LESSON IS NOT AN EXCUSE. Piano marks the one lesson that
 * discharges today's obligation in `coProgressLock.exemptLessonIds` whenever the
 * learner is enrolled here and still owes the day. Pacing governs discretionary
 * practice; it must never settle assigned work as excused, so a lock carrying
 * that exemption leaves the day OWED and launchable. Everything past that one
 * lesson stays paced.
 *
 * @module applications/school/PianoCourseProgramLauncher
 */
import { isSameStudyDay } from '#domains/school/studyDay.mjs';
// The present-tense rule (what counts as "the one you are inside") lives in the
// domain so the agenda card and the result receipt cannot disagree about it.
import { inProgressSegments, activeProgressPosition } from '#domains/school/progressRows.mjs';

/** The household's study day rolls at 4am, same as the rest of the agenda. */
const BOUNDARY_HOUR = 4;

const plexId = (value) => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const id = String(value);
  return id.startsWith('plex:') ? id : `plex:${id}`;
};

const lessonId = (item) => plexId(item?.plex ?? item?.id ?? item?.contentId);

const numericOrder = (value) => Number.isFinite(Number(value)) ? Number(value) : Number.MAX_SAFE_INTEGER;

/** Piano names exempt lessons by their raw episode key; we carry `plex:` ids. */
const bareId = (value) => String(value ?? '').replace(/^plex:/, '');

/**
 * A lesson's own blurb, cleaned of the shape Plex stores it in.
 *
 * Hoffman's summaries arrive with Windows line endings, and a handful of them
 * carry a raw `<a href>` to the store. A kiosk card renders TEXT — the markup
 * would either display as literal angle brackets or, worse, be trusted. Both
 * problems are artifacts of where the string came from, so both are answered
 * here at the boundary rather than re-discovered by every surface that shows a
 * lesson. Length is not this layer's business; the card decides that.
 */
const lessonSummary = (item) => {
  const raw = item?.metadata?.summary ?? item?.description;
  if (typeof raw !== 'string') return null;
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
};

/**
 * The episode still, as the house's Plex image proxy PATH the media adapter
 * already minted — same origin, no credentials, reachable from a kiosk. A
 * direct Plex URL is none of those things, so anything that is not a rooted
 * path is dropped rather than passed on: a card with no picture is fine, a card
 * with a broken one is not.
 */
const lessonThumbnail = (item) => {
  const src = typeof item?.thumbnail === 'string' ? item.thumbnail.trim() : '';
  return src.startsWith('/') ? src : null;
};

/**
 * Does the co-progress lock actually stand between this learner and THIS
 * lesson? A lock that exempts the lesson is a pacing note about the rest of the
 * course, not an obstacle to today's assigned work — see the class doc.
 */
const lockBlocks = (lock, item) => {
  if (!lock?.locked) return false;
  const exempt = lock.exemptLessonIds;
  if (!Array.isArray(exempt) || !exempt.length) return true;
  const key = bareId(lessonId(item));
  return !key || !exempt.some((id) => bareId(id) === key);
};

const orderedCreditItems = (result) => (result?.items ?? [])
  .filter((item) => item && !item.isReference)
  .sort((left, right) => numericOrder(left.parentIndex) - numericOrder(right.parentIndex)
    || numericOrder(left.itemIndex) - numericOrder(right.itemIndex));

/**
 * The course's units, AS THE COURSE IS ACTUALLY WALKED.
 *
 * Deliberately derived from the credit items rather than from `result.parents`:
 * that map also carries reference/practice units, which give no progression
 * credit and which a child therefore never advances THROUGH. Counting them
 * would put a denominator on the card the learner can never reach — "Unit 2 of
 * 19" when only 18 units are ever in play. A unit with no creditable lesson is
 * not a step in the sequence, so it is not a step on the card.
 *
 * `credit` arrives sorted by parentIndex then itemIndex, so first appearance is
 * curriculum order and no second sort is needed.
 */
const orderedUnits = (credit, parents = {}) => {
  const byId = new Map();
  for (const item of credit) {
    if (item.parentId == null) continue;
    const id = String(item.parentId);
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        title: item.parentTitle ?? parents?.[id]?.title ?? `Unit ${item.parentIndex ?? ''}`.trim(),
        lessons: [],
      });
    }
    byId.get(id).lessons.push(item);
  }
  return [...byId.values()];
};

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

    // Course-wide lesson counts, kept DELIBERATELY for `progressLabel` even
    // though the card's progress rows no longer speak in them. The label is
    // printed on a paper slip and read by the adult reviewing the agenda, where
    // "34/366" is the useful figure — a stable measure of the whole course. The
    // card is a child's kiosk panel and wants a different question answered; the
    // two surfaces disagreeing here is the point, not an oversight.
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
      progress: this.#progress({ focus, credit, parents: result?.parents, completed, total }),
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

    // Locked out by the partner's pace: nothing this child can do today —
    // UNLESS the lock exempts the very lesson they were assigned, in which case
    // the day is still owed and perfectly finishable.
    const lock = result.coProgressLock;
    if (lockBlocks(lock, next)) {
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
    const result = { ...answer.result, compoundId: answer.result?.compoundId ?? courseId };
    const next = orderedCreditItems(result).find((item) => !item.userWatched);
    if (!next) throw new Error('piano-course has no unfinished lesson');
    // The lock is evaluated against the resolved lesson, not the course: an
    // assigned lesson is launchable however far ahead of their partner the
    // learner has run.
    if (lockBlocks(result.coProgressLock, next)) {
      throw new Error('piano-course is waiting for the paired learner');
    }
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
    const thumbnail = lessonThumbnail(item);
    const description = lessonSummary(item);
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
        // Both optional and both absent for most of School's work — a worksheet
        // or a quiz bank has neither. Omitted rather than emptied so a consumer
        // can branch on presence instead of on truthiness of an empty string.
        ...(thumbnail ? { thumbnail } : {}),
        ...(description ? { description } : {}),
      },
      completedAt: item.userCompletedAt ?? null,
    };
  }

  #context({ result, item }) {
    const { course, unit, lesson } = this.#lessonContext({ result, item });
    return { course, unit, lesson };
  }

  /**
  /**
   * WHERE THE LEARNER IS, NOT HOW BIG THE COURSE IS.
   *
   * This used to report "34 of 366" — every lesson in Hoffman Academy as the
   * denominator. True, and useless to a seven-year-old: 366 of anything is a
   * wall rather than a journey, and one lesson moves the bar by a quarter of a
   * pixel. The course row counts UNITS instead — the scale the course is
   * actually organised in, and the scale progress is felt at.
   *
   * PAST / PRESENT / FUTURE IS NOT DECIDED HERE. `progressRows.mjs` is the
   * house's single rule for what a hatched segment means, already shared with
   * the result receipt, the agenda and all three renderers. A launcher that
   * decided it privately would be a second surface answering a question that
   * already has one answer — the exact defect class this file has paid for
   * before. `inProgress` is that rule's output, not a local opinion.
   *
   * A unit is complete only when every crediting item in it is watched; a
   * partly-done unit is the hatched one, never a solid one.
   *
   * A course whose lessons carry NO unit keeps the lesson-count reading.
   * `orderedUnits` drops parentless items, so an unstructured course yields no
   * units at all — and a synthetic "1 of 1" that sits at zero until the entire
   * course is finished tells a child less than the honest lesson count does.
   */
  #progress({ focus, credit, parents, completed, total }) {
    // One row, built to the house's shared convention. `position` is
    // `activeProgressPosition`'s answer rather than a second derivation of it:
    // the screen words a location ("Unit 2 of 18") where paper draws a bar, and
    // both must mean the same thing. `measures` names the unit of account,
    // because "Unit 2 of 18" and "13 of 23" are not the same sentence and
    // `scope` alone cannot tell them apart on an un-unitised course.
    const row = ({ scope, label, measures, completed: done, total: all, currentComplete }) => {
      const inProgress = inProgressSegments({ completed: done, total: all, currentComplete });
      return {
        scope,
        label,
        measures,
        completed: done,
        total: all,
        inProgress,
        position: activeProgressPosition({ completed: done, total: all, inProgress }),
      };
    };
    const units = orderedUnits(credit, parents);
    const focusDone = focus?.userWatched === true;

    if (!units.length) {
      return [row({
        scope: 'course', label: 'Course', measures: 'lesson',
        completed, total, currentComplete: focusDone,
      })].filter((entry) => entry.total > 0);
    }

    const focusId = focus?.parentId == null ? null : String(focus.parentId);
    const unit = focusId ? (units.find((entry) => entry.id === focusId) ?? null) : null;
    const unitsDone = units.filter((entry) => entry.lessons.every((item) => item.userWatched)).length;
    const unitComplete = !!unit && unit.lessons.every((item) => item.userWatched);

    const rows = [row({
      scope: 'course', label: 'Course', measures: 'unit',
      completed: unitsDone, total: units.length, currentComplete: unitComplete,
    })];

    if (unit) {
      const lessonsDone = unit.lessons.filter((item) => item.userWatched).length;
      rows.push(row({
        scope: 'module', label: unit.title, measures: 'lesson',
        completed: lessonsDone, total: unit.lessons.length, currentComplete: focusDone,
      }));
    }

    // `completed`/`total` (whole-course lessons) stay in the signature: the
    // sentence labels above still build from them, and `progressLabel` is a
    // paper artifact whose whole-course measure is deliberately unchanged.
    void completed; void total;
    return rows.filter((entry) => entry.total > 0);
  }

  #nowMs() {
    const now = this.#clock();
    return now instanceof Date ? now.getTime() : Number(now);
  }
}

export default PianoCourseProgramLauncher;
