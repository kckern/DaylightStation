/**
 * PianoLessonCeremonyBridge — turns "a piano lesson crossed completion" into
 * "this learner's school piano requirement is SATISFIED", and announces that
 * once.
 *
 * THE EVENT IS NOT THE REQUIREMENT. `play.mjs` publishes on every lesson that
 * crosses the completion threshold, for every player, on every course. Only
 * some of those are a school obligation being discharged:
 *   - the player must be ENROLLED in a `piano-course` program, and
 *   - the completed lesson must belong to THAT course, and
 *   - it must be the FIRST completion of the learner's study day.
 * A second lesson the same afternoon is a child doing extra, not a second
 * requirement being met, and announcing it again would teach them the chime
 * is meaningless. Anyone not enrolled (a parent, a sibling browsing) has no
 * requirement to satisfy and is ignored entirely.
 *
 * SATISFACTION IS RE-DERIVED, NEVER INFERRED FROM THE EVENT. The bridge asks
 * the launcher's own `status()` rather than trusting the payload, for the
 * same reason `SchoolCompletionBridge` re-runs `GetLearnerDayCompletion`:
 * completion truth has exactly one owner, and a second copy of the rule here
 * would drift from the agenda's. If `status()` says the day is not done, the
 * event was a lesson outside the assigned course and nothing is announced.
 *
 * THE EXCUSED DAY NEVER CHIMES. A co-progress lockout settles the agenda as
 * done (`excused: true`) so an unfinishable obligation stops nagging — but
 * nothing was accomplished, so there is nothing to celebrate. Only a real
 * completion rings.
 *
 * IDEMPOTENT BY learnerId + studyDate, and deliberately in-memory: a restart
 * loses the ledger, and the worst case is one repeated chime after a deploy.
 * Persisting it would buy very little and add a write to a path whose whole
 * job is to be fire-and-forget.
 *
 * NEITHER LIMB CAN BREAK THE OTHER, OR PLAYBACK. The Portal broadcast and the
 * Home Assistant script are dispatched independently, each with its own
 * catch, and the whole handler is detached from the publisher — a downed HA
 * must never stop the on-screen acknowledgement, and neither must ever reach
 * back into the piano's own progress write.
 *
 * @module applications/school/PianoLessonCeremonyBridge
 */
import { studyDayForInstant } from '#domains/school/studyDay.mjs';

const BOUNDARY_HOUR = 4;

/** The topic the Portal's School app listens on for its ceremony banner. */
export const CEREMONY_TOPIC = 'school';

export class PianoLessonCeremonyBridge {
  #eventBus; #assignments; #launcher; #hook; #resolveStudent;
  #timezone; #clock; #logger; #unsubscribe; #announced;

  /**
   * @param {object} config
   * @param {{subscribe: Function, broadcast?: Function, publish?: Function}} config.eventBus
   * @param {{get: Function}} config.assignments - the learner assignment store
   * @param {{id: string, status: Function}} config.launcher - PianoCourseProgramLauncher
   * @param {{fire: Function}|null} [config.hook] - SchoolGradingHookAdapter bound to
   *   `piano_lesson_hook`; null in a household with no Home Assistant.
   * @param {Function|null} [config.resolveStudent] - learnerId -> display name
   * @param {string|null} [config.timezone]
   * @param {() => Date} [config.clock]
   * @param {object} [config.logger]
   */
  constructor({
    eventBus, assignments, launcher, hook = null, resolveStudent = null,
    timezone = null, clock = () => new Date(), logger = console,
  } = {}) {
    if (!eventBus || typeof eventBus.subscribe !== 'function') {
      throw new Error('PianoLessonCeremonyBridge requires an eventBus with subscribe()');
    }
    if (!assignments || !launcher) {
      throw new Error('PianoLessonCeremonyBridge requires assignments and launcher');
    }
    this.#eventBus = eventBus;
    this.#assignments = assignments;
    this.#launcher = launcher;
    this.#hook = hook;
    this.#resolveStudent = resolveStudent;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#logger = logger;
    this.#unsubscribe = null;
    this.#announced = new Map();
  }

  /** Subscribe to `piano.lesson.completed`. Safe to call more than once. */
  start() {
    if (this.#unsubscribe) return;
    this.#unsubscribe = this.#eventBus.subscribe('piano.lesson.completed', (payload) => (
      this.#handle(payload).catch((err) => {
        this.#logger.warn?.('school.piano-ceremony.handler-threw', {
          error: err?.message ?? String(err),
        });
      })
    ));
  }

  /** Unsubscribe. Safe before `start()` and safe to call twice. */
  stop() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  async #handle(payload) {
    const learnerId = payload?.userId;
    if (typeof learnerId !== 'string' || !learnerId.trim()) return;

    const assignment = await this.#assignments.get(learnerId);
    const enrollment = (assignment?.programs ?? [])
      .find((row) => row?.programId === this.#launcher.id);
    // Not enrolled: this player has no school piano requirement. Silence is
    // the correct response, not a warning — most piano use is not schoolwork.
    if (!enrollment) return;

    const courseId = enrollment.courseId ?? enrollment.corpusId ?? null;
    if (!courseId) {
      this.#logger.warn?.('school.piano-ceremony.enrollment-has-no-course', { learnerId });
      return;
    }

    const status = await this.#launcher.status({ userId: learnerId, programInstance: courseId });
    // `status.error` (course unreadable) and a not-yet-done day both mean
    // "no requirement was discharged by this event".
    if (status?.error === true || status?.doneToday !== true) return;
    // Locked out rather than finished — the agenda stops asking, but there is
    // nothing to announce (see the class doc).
    if (status?.excused === true) return;

    const nowMs = this.#nowMs();
    const studyDate = studyDayForInstant(nowMs, {
      timezone: this.#timezone, boundaryHour: BOUNDARY_HOUR,
    });
    if (this.#announced.get(learnerId) === studyDate) return;
    this.#announced.set(learnerId, studyDate);

    const student = await this.#studentName(learnerId);
    const lesson = payload?.title ?? null;
    this.#logger.info?.('school.piano-ceremony.satisfied', {
      learnerId, courseId, studyDate, lesson,
    });

    this.#broadcast({ learnerId, student, courseId, lesson, status, studyDate });
    await this.#fireHook({ learnerId, student, courseId, lesson, status });
  }

  /**
   * The Portal's on-screen half. `broadcast` is the same transport
   * `useWebSocketSubscription` reads; a bus without one degrades to the HA
   * limb alone rather than throwing.
   */
  #broadcast({ learnerId, student, courseId, lesson, status, studyDate }) {
    const send = this.#eventBus.broadcast ?? this.#eventBus.publish;
    if (typeof send !== 'function') return;
    try {
      send.call(this.#eventBus, CEREMONY_TOPIC, {
        event: 'piano-lesson-complete',
        learnerId,
        student,
        courseId,
        lesson,
        progressLabel: status?.progressLabel ?? null,
        score: status?.score ?? null,
        studyDate,
        timestamp: this.#nowMs(),
      });
    } catch (err) {
      this.#logger.warn?.('school.piano-ceremony.broadcast-failed', {
        learnerId, error: err?.message ?? String(err),
      });
    }
  }

  /**
   * The Home Assistant half. The adapter never throws and owns its own
   * circuit breaker, so this only has to keep a rejection from escaping.
   */
  async #fireHook({ learnerId, student, courseId, lesson, status }) {
    if (!this.#hook?.fire) return;
    try {
      await this.#hook.fire({
        result: 'satisfied',
        learnerId,
        student,
        subject: 'arts',
        course: courseId,
        lesson,
        percent: status?.score ?? null,
      });
    } catch (err) {
      this.#logger.warn?.('school.piano-ceremony.hook-failed', {
        learnerId, error: err?.message ?? String(err),
      });
    }
  }

  async #studentName(learnerId) {
    if (!this.#resolveStudent) return learnerId;
    try { return (await this.#resolveStudent(learnerId)) ?? learnerId; } catch { return learnerId; }
  }

  #nowMs() {
    const now = this.#clock();
    return now instanceof Date ? now.getTime() : Number(now);
  }
}

export default PianoLessonCeremonyBridge;
