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
 * IT CANNOT LAUNCH, AND SAYS SO. `PianoKioskSurface.validateAction` accepts
 * only a sheet-music `source:localId` content id — a Plex video course is
 * not a shape that surface can open, and it REJECTS rather than dispatching
 * a payload the tablet would ignore. Reporting `dispatched: true` for a
 * lesson that never opened is exactly the honesty failure that validator
 * exists to prevent, so `launch()` refuses uniformly and the child walks to
 * the piano and picks the lesson up themselves. `mountable = false` is what
 * keeps the agenda from minting a QR and a panel code for a thing no code
 * can open (see `BuildAgenda`).
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

export class PianoCourseProgramLauncher {
  #getPlayableUnits; #timezone; #clock; #logger;

  /**
   * @param {object} config
   * @param {{execute: Function}} config.getPlayableUnits - Piano's `GetPlayableUnits`
   *   use case, INJECTED (Decision D1: a use case never imports a concrete adapter).
   * @param {string|null} [config.timezone] - household timezone, for the study-day boundary
   * @param {() => Date} [config.clock]
   * @param {object} [config.logger]
   */
  constructor({ getPlayableUnits, timezone = null, clock = () => new Date(), logger = console } = {}) {
    if (!getPlayableUnits || typeof getPlayableUnits.execute !== 'function') {
      throw new Error('PianoCourseProgramLauncher requires a getPlayableUnits use case');
    }
    this.#getPlayableUnits = getPlayableUnits;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#logger = logger;
  }

  /** Stable id — matches the plan's `programId` and the agenda entry's `program`. */
  get id() { return 'piano-course'; }

  /** The surface a child physically goes to. Not a surface we can dispatch to. */
  get surface() { return 'piano-kiosk'; }

  /** The FULL wording a child reads on their slip (mirrors a `launch:` unit's labelHint). */
  get locationHint() { return 'at the piano'; }

  /**
   * False — this program cannot be opened from the Portal, so the agenda must
   * not mint a scan token, a QR, or a panel code for it. The subject icon
   * fills that space instead.
   */
  get mountable() { return false; }

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
      result = answer.result;
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
    const credit = (result.items ?? []).filter((item) => item && !item.isReference);
    const completedToday = credit.filter((item) => item.userCompletedAt
      && isSameStudyDay(Date.parse(item.userCompletedAt), nowMs, {
        timezone: this.#timezone, boundaryHour: BOUNDARY_HOUR,
      }));

    const total = credit.length;
    const completed = credit.filter((item) => item.userWatched).length;
    const score = total ? Math.round((completed / total) * 100) : null;

    if (completedToday.length) {
      const title = completedToday[completedToday.length - 1]?.title ?? 'a lesson';
      return {
        doneToday: true,
        progressLabel: `Done today — ${title} · ${completed}/${total}`,
        score,
      };
    }

    // Locked out by the partner's pace: nothing this child can do today.
    const lock = result.coProgressLock;
    if (lock?.locked) {
      return {
        doneToday: true,
        excused: true,
        progressLabel: `Waiting for ${lock.waitingForId} to catch up · ${completed}/${total}`,
        score,
      };
    }

    const next = credit.find((item) => !item.userWatched);
    return {
      doneToday: false,
      progressLabel: next
        ? `${completed}/${total} · next: ${next.title}`
        : `${completed}/${total} — course complete`,
      score,
    };
  }

  /**
   * The launch target a Portal caller would need. There isn't one: no surface
   * can open a Plex video course, so this refuses rather than handing back a
   * shape that would dispatch into a no-op.
   */
  issueLaunchTarget() {
    throw new Error('piano-course cannot be opened remotely — the lesson is picked up at the piano kiosk');
  }

  /**
   * @returns {Promise<{decision: 'failed', message: string}>} always — see the
   *   class doc. The message is child-readable because it reaches a slip.
   */
  async launch() {
    return { decision: 'failed', message: 'Go to the piano and open your next lesson there.' };
  }

  #nowMs() {
    const now = this.#clock();
    return now instanceof Date ? now.getTime() : Number(now);
  }
}

export default PianoCourseProgramLauncher;
