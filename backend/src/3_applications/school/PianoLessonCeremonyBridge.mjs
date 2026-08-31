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
 * CEREMONY DEDUPE IS learnerId + studyDate and deliberately in-memory: a
 * restart can repeat a chime, but it cannot duplicate educational progress.
 * School's course/unit/lesson projection is append-only evidence keyed by
 * learner + Plex lesson, and boot reconciliation rebuilds it from Piano's
 * authoritative completion ledger.
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

export class PianoLessonCeremonyBridge {
  #realtime; #assignments; #launcher; #evidence; #hook; #resolveStudent;
  #timezone; #clock; #logger; #unsubscribe; #announced; #knownEvidence; #evidenceLoads;

  /**
   * @param {object} config
   * @param {import('./ports/ISchoolRealtimeGateway.mjs').ISchoolRealtimeGateway} config.realtime
   * @param {{get: Function, list?: Function}} config.assignments - the learner assignment store
   * @param {{id: string, status: Function}} config.launcher - PianoCourseProgramLauncher
   * @param {{appendEvidence: Function}|null} [config.evidenceRepository] - School's
   *   append-only learning evidence repository; duplicate evidenceIds must be idempotent.
   * @param {{fire: Function}|null} [config.hook] - SchoolGradingHookAdapter bound to
   *   `piano_lesson_hook`; null in a household with no Home Assistant.
   * @param {Function|null} [config.resolveStudent] - learnerId -> display name
   * @param {string|null} [config.timezone]
   * @param {() => Date} [config.clock]
   * @param {object} [config.logger]
   */
  constructor({
    realtime, assignments, launcher, evidenceRepository = null, hook = null, resolveStudent = null,
    timezone = null, clock = () => new Date(), logger = console,
  } = {}) {
    if (!realtime?.onPianoLessonCompleted || !realtime?.onPianoChallengeCompleted || !realtime?.schoolCeremony) {
      throw new Error('PianoLessonCeremonyBridge requires realtime School events');
    }
    if (!assignments || !launcher) {
      throw new Error('PianoLessonCeremonyBridge requires assignments and launcher');
    }
    this.#realtime = realtime;
    this.#assignments = assignments;
    this.#launcher = launcher;
    this.#evidence = evidenceRepository;
    this.#hook = hook;
    this.#resolveStudent = resolveStudent;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#logger = logger;
    this.#unsubscribe = null;
    this.#announced = new Map();
    this.#knownEvidence = new Set();
    this.#evidenceLoads = new Map();
  }

  /** Subscribe to Piano's video and PianoChallenge completion signals. Safe to call more than once. */
  start() {
    if (this.#unsubscribe) return;
    const unsubscribeLesson = this.#realtime.onPianoLessonCompleted((payload) => (
      this.#handle(payload).catch((err) => {
        this.#logger.warn?.('school.piano-ceremony.handler-threw', {
          error: err?.message ?? String(err),
        });
      })
    ));
    const unsubscribeChallenge = this.#realtime.onPianoChallengeCompleted((payload) => (
      this.#handleChallenge(payload).catch((err) => {
        this.#logger.warn?.('school.piano-challenge-ceremony.handler-threw', {
          error: err?.message ?? String(err),
        });
      })
    ));
    this.#unsubscribe = () => {
      unsubscribeLesson?.();
      unsubscribeChallenge?.();
    };
    // Backfill School's projection from Piano's authoritative completion
    // ledger. Detached from boot: a slow Plex read must not hold up the house.
    this.reconcile().catch((err) => this.#logger.warn?.('school.piano-progress.reconcile-failed', {
      error: err?.message ?? String(err),
    }));
  }

  /** Rebuildable/idempotent School projection for every current enrollment. */
  async reconcile() {
    if (!this.#evidence?.appendEvidence || typeof this.#assignments.list !== 'function') return;
    const assignments = await this.#assignments.list();
    const summary = { learners: 0, completions: 0, recorded: 0, existing: 0, failed: 0 };
    for (const assignment of assignments ?? []) {
      const learnerId = assignment?.learnerId;
      if (!learnerId) continue;
      summary.learners += 1;
      // Load the first-write ids once. Reconciliation is a projection repair,
      // not an attempt to rewrite historical evidence after catalog metadata
      // is normalized; an existing id is already settled truth.
      // eslint-disable-next-line no-await-in-loop
      await this.#loadKnownEvidence(learnerId);
      for (const enrollment of (assignment.programs ?? []).filter((row) => row?.programId === this.#launcher.id)) {
        const courseId = enrollment.courseId ?? enrollment.corpusId ?? null;
        if (!courseId) continue;
        // eslint-disable-next-line no-await-in-loop
        const status = await this.#launcher.status({ userId: learnerId, programInstance: courseId });
        for (const completion of status?.completedLessons ?? []) {
          summary.completions += 1;
          // eslint-disable-next-line no-await-in-loop
          const outcome = await this.#recordEvidence({ learnerId, enrollment, completion });
          if (outcome?.status === 'recorded') summary.recorded += 1;
          else if (outcome?.status === 'duplicate') summary.existing += 1;
          else summary.failed += 1;
        }
      }
    }
    this.#logger.info?.('school.piano-progress.reconciled', summary);
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
    const enrollments = (assignment?.programs ?? [])
      .filter((row) => row?.programId === this.#launcher.id);
    // Not enrolled: this player has no school piano requirement. Silence is
    // the correct response, not a warning — most piano use is not schoolwork.
    if (!enrollments.length) return;

    let enrollment = null;
    let courseId = null;
    let status = null;
    let completion = null;
    for (const candidate of enrollments) {
      const candidateCourseId = candidate.courseId ?? candidate.corpusId ?? null;
      if (!candidateCourseId) continue;
      // eslint-disable-next-line no-await-in-loop
      const candidateStatus = await this.#launcher.status({ userId: learnerId, programInstance: candidateCourseId });
      const candidateCompletion = (candidateStatus?.completedLessonsToday ?? [])
        .find((row) => row?.lesson?.id === payload?.plexId);
      if (!candidateCompletion) continue;
      enrollment = candidate;
      courseId = candidateCourseId;
      status = candidateStatus;
      completion = candidateCompletion;
      break;
    }
    // The completed episode was not part of an enrolled Hoffman course.
    if (!enrollment || !completion) return;
    // `status.error` (course unreadable) and a not-yet-done day both mean
    // "no requirement was discharged by this event".
    if (status?.error === true || status?.doneToday !== true) return;
    // Locked out rather than finished — the agenda stops asking, but there is
    // nothing to announce (see the class doc).
    if (status?.excused === true) return;

    // Durable School progress is written before the one-per-day ceremony
    // dedupe. A child may complete two assigned lessons; only one chimes, but
    // both belong in the educational record.
    await this.#recordEvidence({ learnerId, enrollment, completion });

    const nowMs = this.#nowMs();
    const studyDate = studyDayForInstant(nowMs, {
      timezone: this.#timezone, boundaryHour: BOUNDARY_HOUR,
    });
    if (this.#announced.get(learnerId) === studyDate) return;
    this.#announced.set(learnerId, studyDate);

    const student = await this.#studentName(learnerId);
    const lesson = completion.lesson?.title ?? payload?.title ?? null;
    this.#logger.info?.('school.piano-ceremony.satisfied', {
      learnerId, courseId, studyDate, lesson,
    });

    this.#broadcast({ learnerId, student, courseId, lesson, status, studyDate });
    await this.#fireHook({ learnerId, student, courseId, lesson, status });
  }

  /**
   * A passed PianoChallenge is alternate evidence for one configured course
   * lesson.  As with a video event, the bus payload is never trusted as the
   * completion decision: status() must report the active descriptor settled.
   */
  async #handleChallenge(payload) {
    const learnerId = payload?.userId;
    const descriptorId = payload?.descriptorId;
    if (typeof learnerId !== 'string' || !learnerId.trim() || typeof descriptorId !== 'string' || !descriptorId.trim()) return;
    const assignment = await this.#assignments.get(learnerId);
    const enrollments = (assignment?.programs ?? []).filter((row) => row?.programId === this.#launcher.id);
    for (const enrollment of enrollments) {
      const courseId = enrollment.courseId ?? enrollment.corpusId ?? null;
      if (!courseId) continue;
      // eslint-disable-next-line no-await-in-loop -- first authoritative settled course wins.
      const status = await this.#launcher.status({ userId: learnerId, programInstance: courseId });
      if (status?.error || status?.challengeCompleted !== true || status?.excused === true) continue;
      const nowMs = this.#nowMs();
      const studyDate = studyDayForInstant(nowMs, { timezone: this.#timezone, boundaryHour: BOUNDARY_HOUR });
      await this.#recordChallengeEvidence({ learnerId, enrollment, courseId, descriptorId, completedAt: payload?.completedAt, studyDate, status });
      if (this.#announced.get(learnerId) === studyDate) return;
      this.#announced.set(learnerId, studyDate);
      const student = await this.#studentName(learnerId);
      const lesson = status?.servedWork?.[0]?.title ?? 'PianoChallenge';
      this.#logger.info?.('school.piano-challenge-ceremony.satisfied', { learnerId, courseId, descriptorId, studyDate, lesson });
      this.#broadcast({ learnerId, student, courseId, lesson, status, studyDate });
      await this.#fireHook({ learnerId, student, courseId, lesson, status });
      return;
    }
  }

  async #recordEvidence({ learnerId, enrollment, completion }) {
    if (!this.#evidence?.appendEvidence || !completion?.lesson?.id || !completion?.completedAt) return null;
    const evidenceId = `piano-lesson:${learnerId}:${completion.lesson.id}`;
    await this.#loadKnownEvidence(learnerId);
    if (this.#knownEvidence.has(evidenceId)) return { status: 'duplicate' };
    const occurredAt = new Date(Date.parse(completion.completedAt)).toISOString();
    const evidence = {
      schema: 'school.learning-evidence/v1',
      evidenceId,
      learnerId,
      occurredAt,
      verification: 'verified',
      activity: {
        id: completion.lesson.id,
        kind: 'piano_lesson',
        itemId: completion.lesson.id,
        graded: false,
        action: 'complete',
      },
      learning: {
        subjectId: enrollment.subject ?? 'arts',
        courseId: completion.course?.id ?? enrollment.courseId ?? enrollment.corpusId,
        ...(completion.unit?.id ? { unitId: completion.unit.id } : {}),
        lessonId: completion.lesson.id,
      },
      measures: { engagements: 1, completions: 1 },
      source: { surface: 'piano-kiosk', transport: 'playback' },
    };
    try {
      const outcome = await this.#evidence.appendEvidence(evidence);
      if (outcome?.status === 'recorded' || outcome?.status === 'duplicate') {
        this.#knownEvidence.add(evidenceId);
      }
      return outcome;
    } catch (error) {
      if (error?.code === 'LEARNING_EVIDENCE_CONFLICT') {
        // A first-write record from an older projection can legitimately carry
        // older normalized metadata (for example `plex:plex:`). Keep it and do
        // not emit the same warning for every completion on every boot.
        this.#knownEvidence.add(evidenceId);
        this.#logger.debug?.('school.piano-progress.existing-evidence', { learnerId, evidenceId });
        return { status: 'duplicate' };
      }
      this.#logger.warn?.('school.piano-progress.record-failed', {
        learnerId, lessonId: completion.lesson.id, error: error?.message ?? String(error),
      });
      return { status: 'failed' };
    }
  }

  async #recordChallengeEvidence({ learnerId, enrollment, courseId, descriptorId, completedAt, studyDate, status }) {
    if (!this.#evidence?.appendEvidence) return null;
    const completedMs = Date.parse(completedAt);
    if (Number.isNaN(completedMs)) return null;
    const occurredAt = new Date(completedMs).toISOString();
    const work = status?.servedWork?.[0] ?? {};
    const evidenceId = `piano-challenge:${learnerId}:${studyDate}:${descriptorId}`;
    await this.#loadKnownEvidence(learnerId);
    if (this.#knownEvidence.has(evidenceId)) return { status: 'duplicate' };
    const evidence = {
      schema: 'school.learning-evidence/v1',
      evidenceId,
      learnerId, occurredAt, verification: 'verified',
      activity: { id: descriptorId, kind: 'piano_challenge', itemId: descriptorId, graded: true, action: 'complete' },
      learning: {
        subjectId: enrollment.subject ?? 'arts', courseId,
        ...(work.unitId ? { unitId: work.unitId } : {}),
      },
      measures: { engagements: 1, completions: 1 },
      source: { surface: 'piano-kiosk', transport: 'piano-challenge' },
    };
    try {
      const outcome = await this.#evidence.appendEvidence(evidence);
      if (outcome?.status === 'recorded' || outcome?.status === 'duplicate') this.#knownEvidence.add(evidenceId);
      return outcome;
    } catch (error) {
      if (error?.code === 'LEARNING_EVIDENCE_CONFLICT') {
        this.#knownEvidence.add(evidenceId);
        this.#logger.debug?.('school.piano-progress.existing-evidence', { learnerId, evidenceId });
        return { status: 'duplicate' };
      }
      this.#logger.warn?.('school.piano-challenge-progress.record-failed', { learnerId, descriptorId, error: error?.message ?? String(error) });
      return { status: 'failed' };
    }
  }

  async #loadKnownEvidence(learnerId) {
    if (typeof this.#evidence?.listEvidence !== 'function') return;
    if (!this.#evidenceLoads.has(learnerId)) {
      this.#evidenceLoads.set(learnerId, Promise.resolve()
        .then(() => this.#evidence.listEvidence({ learnerIds: [learnerId] }))
        .then((rows) => {
          for (const row of rows ?? []) {
            if (typeof row?.evidenceId === 'string') this.#knownEvidence.add(row.evidenceId);
          }
        })
        .catch((error) => {
          this.#logger.warn?.('school.piano-progress.existing-read-failed', {
            learnerId, error: error?.message ?? String(error),
          });
        }));
    }
    await this.#evidenceLoads.get(learnerId);
  }

  /**
   * The Portal's on-screen half. A missing or failed realtime limb degrades to
   * the household hook rather than invalidating the completion.
   */
  #broadcast({ learnerId, student, courseId, lesson, status, studyDate }) {
    try {
      this.#realtime.schoolCeremony({
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
