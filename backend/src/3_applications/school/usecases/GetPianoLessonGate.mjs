/**
 * GetPianoLessonGate — "does this learner owe a piano lesson right now, and
 * which one?", for the piano kiosk's menu.
 *
 * THE RULE HAS ONE OWNER. Every question this answers —
 * is the day discharged, what is the next playable lesson, does a co-progress
 * lock or a parent bypass settle it — is already answered by
 * `PianoCourseProgramLauncher.status()`, which the agenda and the completion
 * ceremony also read. This use case only chooses enrollments and shapes a
 * kiosk-facing payload; it must never re-derive a completion rule of its own,
 * or the menu and the agenda would eventually disagree about the same day.
 *
 * IT FAILS OPEN, DELIBERATELY. Any read that does not resolve — no assignment
 * file, an unreachable Plex, a launcher error — returns NOT gated. The gate
 * hides the entire kiosk menu, so a wrong `true` locks a child out of every
 * mode over a transient network fault, while a wrong `false` merely fails to
 * nag them about a lesson. Only the second is acceptable. (Contrast
 * `GetPlayableUnits.#assignedLessonId`, which fails CLOSED: that guard decides
 * whether to override sibling pacing, where the safe default is the opposite.)
 *
 * `reason` is diagnostic — for logs, tests and the teacher panel's status
 * line. The kiosk branches on `gated` alone.
 *
 * @module applications/school/usecases/GetPianoLessonGate
 */
const SCHEMA = 'school.piano-lesson-gate/v1';

export class GetPianoLessonGate {
  #assignments; #launcher; #logger;

  /**
   * @param {object} config
   * @param {{get: Function}} config.assignments - School's learner assignment store
   * @param {{id: string, status: Function}} config.launcher - PianoCourseProgramLauncher
   * @param {object} [config.logger]
   */
  constructor({ assignments, launcher, logger = console } = {}) {
    if (!assignments || !launcher) throw new Error('GetPianoLessonGate requires assignments and launcher');
    this.#assignments = assignments;
    this.#launcher = launcher;
    this.#logger = logger;
  }

  /**
   * @param {{learnerId: string}} params
   * @returns {Promise<{schema: string, learnerId: string, gated: boolean, reason: string,
   *   course?: object, unit?: object|null, lesson?: object}>}
   */
  async execute({ learnerId } = {}) {
    const base = { schema: SCHEMA, learnerId: learnerId ?? null };
    // Guest is the dismiss-outcome identity and has no roster-backed School
    // record to owe anything against.
    if (!learnerId || learnerId === 'guest') return { ...base, gated: false, reason: 'guest' };

    let programs;
    try {
      programs = (await this.#assignments.get(learnerId))?.programs ?? [];
    } catch (err) {
      this.#logger.warn?.('school.piano-gate.assignments-unavailable', {
        learnerId, error: err?.message ?? String(err),
      });
      return { ...base, gated: false, reason: 'unavailable' };
    }

    const enrollments = programs.filter((row) => row?.programId === this.#launcher.id);
    if (!enrollments.length) return { ...base, gated: false, reason: 'not-enrolled' };

    // More than one piano course is unusual but legal: gated while ANY is
    // owed, showing the first owed lesson found.
    let reason = 'done';
    for (const row of enrollments) {
      const courseId = row.courseId ?? row.corpusId ?? null;
      if (!courseId) continue;

      let status;
      try {
        // eslint-disable-next-line no-await-in-loop -- sequential by design: the
        // first owed enrollment wins and the rest need not be read at all.
        status = await this.#launcher.status({ userId: learnerId, programInstance: courseId });
      } catch (err) {
        this.#logger.warn?.('school.piano-gate.status-failed', {
          learnerId, courseId, error: err?.message ?? String(err),
        });
        return { ...base, gated: false, reason: 'unavailable' };
      }

      if (status?.error === true) {
        this.#logger.warn?.('school.piano-gate.status-unavailable', { learnerId, courseId });
        return { ...base, gated: false, reason: 'unavailable' };
      }

      if (status.doneToday === true) {
        reason = status.bypassed ? 'bypassed' : status.excused ? 'excused' : 'done';
        continue;
      }

      // Owed, and there is something to hand them.
      if (status.nextLesson) {
        return {
          ...base,
          gated: true,
          reason: 'owed',
          ...this.#target(status.nextLesson),
          // This is an already-authorized, narrow descriptor produced by the
          // School launcher.  The kiosk may render it, but it may not infer a
          // challenge from the course lesson or manufacture its own ask.
          ...(status.challenge ? { challenge: status.challenge } : {}),
        };
      }

      // Owed nothing: every lesson is watched, so the course is finished and
      // there is no card to show. Not a gate, and not an error either.
      reason = 'course-complete';
    }

    return { ...base, gated: false, reason };
  }

  /**
   * The kiosk-facing slice of a `nextLesson` context. Optional fields are
   * omitted rather than emptied so the card can branch on presence.
   */
  #target({ course, unit, lesson }) {
    return {
      course,
      unit: unit ?? null,
      lesson: {
        id: lesson.id,
        title: lesson.title,
        ...(lesson.position != null ? { position: lesson.position } : {}),
        ...(lesson.thumbnail ? { thumbnail: lesson.thumbnail } : {}),
        ...(lesson.description ? { description: lesson.description } : {}),
      },
    };
  }
}

export default GetPianoLessonGate;
