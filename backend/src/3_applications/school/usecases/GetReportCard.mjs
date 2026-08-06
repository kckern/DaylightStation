/**
 * GetReportCard — a period-scoped snapshot of one learner's schooling: course
 * grades (Task 5's `courseGradeFromSessions` best-of-unit-mean projection),
 * materials-framework progress, the cross-surface evidence aggregate, an
 * honest instructional-time proxy, remediation arcs, and the review queue's
 * backlog for this learner. Read-only — `CloseAcademicPeriod` is the only
 * thing that freezes this output into a durable record.
 *
 * PERIOD-SCOPED COURSE SELECTION (adequacy MUST 3). "What is this learner
 * currently assigned" is the WRONG question for a report card covering a past
 * period: a course a parent assigned in week 2 and un-assigned in week 6
 * still happened, and a child who worked ahead on a course nobody currently
 * has them in still did that work. So the course list is the union of:
 *
 *   (a) every course id that appears in the learner's assignment HISTORY
 *       (Task 3) at any point during the period, PLUS whatever was the
 *       current assignment at the moment the period started (the latest
 *       history record at or before `startsAt`) — even if it was changed
 *       again before `endsAt`;
 *   (b) the course of any unit with at least one graded session inside the
 *       period window, regardless of assignment — work that happened is
 *       never hidden because nobody currently assigns it.
 *
 * A course dropped mid-period by (a) or never formally assigned but worked
 * anyway by (b) both still appear. This is deliberately NOT plain
 * `assignments.get` (current assignment) — EXCEPT as a fallback when a
 * learner has no history at all (predates Task 3's history feature), in
 * which case the current assignment is the only signal available and is
 * used in place of (a) rather than silently reporting zero courses.
 */
import { EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { courseGradeFromSessions } from '#domains/school/progress/courseGrade.mjs';
import { conceptMastery } from '#domains/school/progress/conceptMastery.mjs';
import { learningEvidenceFromAttempt } from '#domains/school/progress/attemptEvidence.mjs';

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/** A history record's `courses` list may hold bare ids or `{courseId,...}`. */
function courseIdsFromAssignment(courses) {
  if (!Array.isArray(courses)) return [];
  return courses
    .map((entry) => {
      if (isNonEmptyString(entry)) return entry.trim();
      if (entry && typeof entry === 'object' && isNonEmptyString(entry.courseId)) return entry.courseId.trim();
      return null;
    })
    .filter(Boolean);
}

/**
 * Canonical ISO-8601 timestamps sort lexicographically the same as
 * chronologically, so a plain string compare is exact and avoids re-parsing
 * every timestamp this use case touches.
 */
function withinPeriod(iso, period) {
  return isNonEmptyString(iso) && iso >= period.startsAt && iso <= period.endsAt;
}

export class GetReportCard {
  #curriculum; #assignments; #sessions; #datastore; #academicPeriods;
  #getMaterialProgressSummary; #getLearningProgress; #reviewQueue; #conceptRegistry; #clock; #logger;

  /**
   * @param {object} deps
   * @param {import('../CurriculumAccess.mjs').CurriculumAccess} deps.curriculum
   * @param {import('../ports/IAssignmentStore.mjs').IAssignmentStore} deps.assignments
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {object} deps.datastore - `YamlSchoolDatastore`-shaped: `readAttemptsInRange`
   * @param {import('../ports/IAcademicPeriodSource.mjs').IAcademicPeriodSource} deps.academicPeriods
   * @param {{execute: Function}|null} [deps.getMaterialProgressSummary]
   * @param {{execute: Function}|null} [deps.getLearningProgress]
   * @param {import('../ports/IReviewQueue.mjs').IReviewQueue|null} [deps.reviewQueue]
   * @param {{get: (id: string) => {id: string, label: string}|null}|null} [deps.conceptRegistry] -
   *   `YamlConceptRegistry`-shaped (Task 10); absent entirely OR absent a given
   *   id both degrade to the raw conceptId as its own label, never a crash.
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({
    curriculum, assignments, sessions, datastore, academicPeriods,
    getMaterialProgressSummary = null, getLearningProgress = null, reviewQueue = null,
    conceptRegistry = null, clock = () => new Date(), logger = console,
  } = {}) {
    if (!curriculum) throw new Error('GetReportCard requires curriculum');
    if (!assignments) throw new Error('GetReportCard requires assignments');
    if (!sessions) throw new Error('GetReportCard requires sessions');
    if (!datastore) throw new Error('GetReportCard requires datastore');
    if (!academicPeriods) throw new Error('GetReportCard requires academicPeriods');
    this.#curriculum = curriculum;
    this.#assignments = assignments;
    this.#sessions = sessions;
    this.#datastore = datastore;
    this.#academicPeriods = academicPeriods;
    this.#getMaterialProgressSummary = getMaterialProgressSummary;
    this.#getLearningProgress = getLearningProgress;
    this.#reviewQueue = reviewQueue;
    this.#conceptRegistry = conceptRegistry;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {{learnerId: string, periodId: string}} args
   * @returns {Promise<object>} `{schema: 'school.report-card/v1', learnerId, period,
   *   generatedAt, courses, materials, evidence, activeDays, concepts, pendingReview,
   *   remediationArcs}`
   */
  async execute({ learnerId, periodId } = {}) {
    if (!isNonEmptyString(learnerId)) throw new Error('GetReportCard requires learnerId');
    const period = this.#academicPeriods.getPeriod(periodId);
    if (!period) throw new EntityNotFoundError('Academic period', periodId);

    const [history, currentAssignment, rawSessions, units] = await Promise.all([
      this.#assignments.history(learnerId),
      this.#assignments.get(learnerId),
      this.#sessions.listForLearner(learnerId),
      this.#curriculum.listUnits(),
    ]);
    // Flatten session rows at the application boundary (Task 5 ruling): the
    // datastore's `outcome: {result}` shape becomes courseGradeFromSessions's
    // flat `result`.
    const flatSessions = rawSessions.map((row) => ({ ...row, result: row.outcome?.result ?? null }));
    const unitCourse = new Map(units.map((u) => [u.unitId, u.courseId ?? null]));
    const periodSessions = flatSessions.filter((s) => withinPeriod(s.updatedAt, period));

    const courseIds = this.#selectPeriodCourses({
      history, currentAssignment, period, periodSessions, unitCourse,
    });
    const courses = courseIds.map((courseId) => this.#courseSection({
      courseId, units, flatSessions, periodSessions, period,
    }));

    const materials = await this.#materialsSection(learnerId);
    const evidence = await this.#evidenceSection(learnerId, period);
    const activeDays = this.#activeDaysSection(learnerId, period);
    const concepts = this.#conceptsSection(learnerId, period);
    const remediationArcs = await this.#resolveRemediationArcs(periodSessions);
    const pendingReview = await this.#pendingReviewCount(learnerId);

    return {
      schema: 'school.report-card/v1',
      learnerId,
      period,
      generatedAt: this.#clock().toISOString(),
      courses,
      materials,
      evidence,
      activeDays,
      concepts,
      pendingReview,
      remediationArcs,
    };
  }

  #selectPeriodCourses({
    history, currentAssignment, period, periodSessions, unitCourse,
  }) {
    const courseIds = new Set();

    if (history.length === 0) {
      // Legacy learners predate the assignment-history feature (Task 3): with
      // no history AT ALL, the current assignment (`assignments.get`) is the
      // best available stand-in for "what was assigned at period start".
      // Silently returning zero courses would be wrong for an artifact a
      // parent signs — better to fall back than to under-report.
      courseIdsFromAssignment(currentAssignment?.courses).forEach((id) => courseIds.add(id));
    } else {
      // (a) assignment history: the record in effect at period start...
      const atStart = [...history]
        .filter((rec) => isNonEmptyString(rec.recordedAt) && rec.recordedAt <= period.startsAt)
        .sort((x, y) => x.recordedAt.localeCompare(y.recordedAt))
        .at(-1);
      if (atStart) courseIdsFromAssignment(atStart.courses).forEach((id) => courseIds.add(id));
      // ...plus every record that landed DURING the period, so a course
      // assigned and then dropped again inside the same period still counts.
      history
        .filter((rec) => withinPeriod(rec.recordedAt, period))
        .forEach((rec) => courseIdsFromAssignment(rec.courses).forEach((id) => courseIds.add(id)));
    }

    // (b) any unit graded in the window, regardless of assignment.
    periodSessions
      .filter((s) => s.unitId && s.gradedPercent !== null && s.gradedPercent !== undefined)
      .forEach((s) => {
        const courseId = unitCourse.get(s.unitId);
        if (courseId) courseIds.add(courseId);
      });

    return [...courseIds].sort();
  }

  #courseSection({
    courseId, units, flatSessions, period,
  }) {
    // Dedup unit ids (Task 5 ruling): duplicates would skew the course mean.
    const unitIds = [...new Set(units.filter((u) => u.courseId === courseId).map((u) => u.unitId))];
    const grade = courseGradeFromSessions({
      sessions: flatSessions,
      courseId,
      unitIds,
      window: { startsAt: period.startsAt, endsAt: period.endsAt },
    });
    const unitOutcomes = unitIds.map((unitId) => {
      const graded = flatSessions.filter((s) => (
        s.unitId === unitId && withinPeriod(s.updatedAt, period)
        && s.gradedPercent !== null && s.gradedPercent !== undefined
      ));
      const best = graded.length
        ? graded.reduce((a, b) => (b.gradedPercent > a.gradedPercent ? b : a))
        : null;
      return {
        unitId,
        result: best?.result ?? null,
        gradedPercent: best?.gradedPercent ?? null,
        sessionId: best?.sessionId ?? null,
      };
    });
    return { ...grade, unitOutcomes };
  }

  async #materialsSection(learnerId) {
    if (!this.#getMaterialProgressSummary) return [];
    try {
      const summary = await this.#getMaterialProgressSummary.execute({ userId: learnerId });
      // GetMaterialProgressSummary carries no material title (that lives in
      // the separate materials catalog, not injected here) — the materialId
      // itself is the honest label rather than a fabricated one.
      return summary.map((m) => ({
        materialId: m.materialId, label: m.materialId, unitsDone: m.unitsDone, unitTotal: m.unitTotal,
      }));
    } catch (err) {
      this.#logger.warn?.('school.report-card.materials-failed', { learnerId, error: err.message });
      return [];
    }
  }

  async #evidenceSection(learnerId, period) {
    if (!this.#getLearningProgress) return null;
    return this.#getLearningProgress.execute({
      scopeType: 'learner', scopeId: learnerId, from: period.startsAt, to: period.endsAt,
    });
  }

  /**
   * An honest instructional-time PROXY, never "attendance": distinct attempt
   * DAY FILES in the period, per subject and overall (adequacy SHOULD 6).
   */
  #activeDaysSection(learnerId, period) {
    const fromDay = period.startsAt.slice(0, 10);
    const toDay = period.endsAt.slice(0, 10);
    const attempts = this.#datastore.readAttemptsInRange(learnerId, fromDay, toDay) ?? [];
    const bySubject = new Map();
    const allDays = new Set();
    for (const attempt of attempts) {
      const day = String(attempt.at ?? '').slice(0, 10);
      if (!DAY_TEXT_RE.test(day)) continue;
      allDays.add(day);
      const subjectId = attempt.learning?.subjectId ?? null;
      if (!subjectId) continue;
      if (!bySubject.has(subjectId)) bySubject.set(subjectId, new Set());
      bySubject.get(subjectId).add(day);
    }
    return {
      bySubject: [...bySubject.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([subjectId, days]) => ({ subjectId, days: days.size })),
      total: allDays.size,
    };
  }

  /**
   * Concept mastery (Task 10, R8): the SAME period-scoped attempt read
   * `#activeDaysSection` already does (`readAttemptsInRange`), translated
   * through `attemptEvidence.mjs`'s `learningEvidenceFromAttempt` into
   * `conceptMastery`'s pure domain aggregation — one evidence read, two
   * facets. `windowDays` is sized to the report PERIOD itself (not the
   * domain function's own rolling-90-day default) so "mastery this period"
   * actually means this period, not an independent trailing window that
   * could disagree with it; every attempt this method feeds in already
   * falls inside `[period.startsAt, period.endsAt]`; `now: period.endsAt`
   * anchors that window at the period's own close.
   * `conceptRegistry` only supplies a LABEL — an unregistered (or entirely
   * unwired) registry falls back to the raw conceptId, never drops the row.
   * A row too incomplete to become evidence (pre-dates a required field,
   * hand-built test/fixture data, etc.) is skipped rather than failing the
   * whole report card — the same tolerance `#materialsSection`/`#evidenceSection`
   * already give an unreliable dependency.
   */
  #conceptsSection(learnerId, period) {
    const fromDay = period.startsAt.slice(0, 10);
    const toDay = period.endsAt.slice(0, 10);
    const attempts = this.#datastore.readAttemptsInRange(learnerId, fromDay, toDay) ?? [];
    const entries = attempts.flatMap((attempt) => {
      try {
        return [learningEvidenceFromAttempt(attempt)];
      } catch (err) {
        this.#logger.warn?.('school.report-card.concept-evidence-skipped', { learnerId, error: err.message });
        return [];
      }
    });
    const periodDays = Math.max(
      1,
      Math.ceil((Date.parse(period.endsAt) - Date.parse(period.startsAt)) / DAY_MS) + 1,
    );
    const mastery = conceptMastery(entries, { now: period.endsAt, windowDays: periodDays });
    const label = (conceptId) => this.#conceptRegistry?.get(conceptId)?.label ?? conceptId;
    const project = (row) => ({
      conceptId: row.conceptId, label: label(row.conceptId), ratio: row.ratio, responses: row.responses,
    });
    return {
      mastered: mastery.filter((row) => row.mastered).map(project),
      developing: mastery.filter((row) => !row.mastered).map(project),
    };
  }

  /**
   * A remediation arc links an original session (`result: 'needs_remediation'`)
   * to the later session `OpenRemediation` opened for the same unit —
   * `remediationOf` lives on the NEW session's `created` event, not on the day
   * index, so resolving it costs one `readEvents` per candidate. Bounded to
   * this period's own sessions, per the brief.
   */
  async #resolveRemediationArcs(periodSessions) {
    const originals = periodSessions.filter((s) => s.result === 'needs_remediation');
    const arcs = [];
    for (const original of originals) {
      const candidates = periodSessions.filter((s) => (
        s.unitId === original.unitId && s.sessionId !== original.sessionId
        && isNonEmptyString(s.updatedAt) && isNonEmptyString(original.updatedAt)
        && s.updatedAt > original.updatedAt
      ));
      // eslint-disable-next-line no-await-in-loop
      for (const candidate of candidates) {
        // eslint-disable-next-line no-await-in-loop
        const events = await this.#sessions.readEvents(candidate.sessionId);
        const created = events.find((e) => e.type === 'created');
        if (created?.remediationOf === original.sessionId) {
          arcs.push({
            unitId: original.unitId,
            originalSessionId: original.sessionId,
            remediationSessionId: candidate.sessionId,
            result: candidate.result ?? null,
          });
        }
      }
    }
    return arcs;
  }

  async #pendingReviewCount(learnerId) {
    if (!this.#reviewQueue) return 0;
    const pending = await this.#reviewQueue.listPending();
    return pending.filter((item) => item.learnerId === learnerId).length;
  }
}

const DAY_TEXT_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export default GetReportCard;
