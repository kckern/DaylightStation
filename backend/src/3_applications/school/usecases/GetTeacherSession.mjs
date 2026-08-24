import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';
import { reduceSession } from '#domains/school/sessions/sessionEvents.mjs';

/** Read models for the teacher history and session inspector surfaces. */
export class GetTeacherSession {
  #sessions; #curriculum; #artifacts; #reviews; #allocations; #worksheets; #exceptions;
  constructor({
    sessions, curriculum = null, issuedArtifacts = null, reviewQueue = null,
    allocationStore = null, worksheetInstances = null, curriculumExceptions = null,
  } = {}) {
    if (!sessions) throw new Error('GetTeacherSession requires sessions');
    this.#sessions = sessions;
    this.#curriculum = curriculum;
    this.#artifacts = issuedArtifacts;
    this.#reviews = reviewQueue;
    this.#allocations = allocationStore;
    this.#worksheets = worksheetInstances;
    this.#exceptions = curriculumExceptions;
  }

  async execute({ sessionId } = {}) {
    if (typeof sessionId !== 'string' || !sessionId.trim()) throw new ValidationError('sessionId is required');
    const events = await this.#sessions.readEvents(sessionId);
    if (!events.length) throw new EntityNotFoundError('session', sessionId);
    const state = reduceSession(events);
    const [unit, works, worksheet, reviewEvidence, artifactRows, learnerSessions, exceptions] = await Promise.all([
      this.#curriculum?.getUnit?.(state.unitId) ?? null,
      this.#curriculum?.listWorks?.() ?? [],
      this.#worksheets?.findBySession?.(sessionId) ?? null,
      this.#reviews?.listForSession?.(sessionId) ?? [],
      Promise.all(state.issuedArtifacts.map(async (artifactId) => {
        const artifact = await this.#artifacts?.get?.(artifactId);
        return artifact ? { ...artifact.manifest,
          originalPdfUrl: `/api/v1/school/teacher/artifacts/${encodeURIComponent(artifactId)}/original.pdf` } : { artifactId };
      })),
      this.#sessions.listForLearner(state.learnerId),
      this.#exceptions?.active?.() ?? [],
    ]);
    const courseId = unit?.courseId ?? null;
    const course = works.find((candidate) => candidate.work === courseId
      || `${candidate.subject}/${candidate.work}` === courseId) ?? null;
    const courseUnits = this.#curriculum && courseId
      ? (await this.#curriculum.listUnits()).filter((candidate) => candidate.courseId === courseId)
      : [];
    const completedIds = new Set(learnerSessions.filter((row) => row.outcome?.result === 'passed').map((row) => row.unitId));
    const answerSheets = [];
    for (const artifact of artifactRows) {
      const cardId = artifact.allocation?.cardId;
      if (!cardId || answerSheets.some((card) => card.cardId === cardId)) continue;
      // eslint-disable-next-line no-await-in-loop
      const card = await this.#allocations?.describeCard?.(cardId, { expectedLearnerId: state.learnerId });
      if (card) answerSheets.push(card);
    }
    const progressUnits = courseUnits.map((candidate) => ({ unitId: candidate.unitId, title: candidate.title,
      module: candidate.module ?? null,
      status: progressStatus(candidate.unitId, state.learnerId, completedIds, exceptions) }));
    return {
      schema: 'school.teacher-session/v2',
      sessionId,
      revision: events.reduce((max, event) => Math.max(max, Number(event?.seq) || 0), 0),
      state,
      events,
      artifactIds: [...state.issuedArtifacts],
      taxonomy: {
        subject: unit?.subject ?? course?.subject ?? null,
        courseId, courseTitle: course?.title ?? courseId,
        moduleId: unit?.module ?? null, moduleTitle: unit?.module ?? null,
        lessonId: state.unitId, lessonTitle: unit?.title ?? state.unitId,
        posterUrl: courseId ? `/api/v1/school/teacher/curriculum/${encodeURIComponent(courseId)}/poster.jpg` : null,
      },
      scores: {
        machine: state.machineGrade,
        effective: state.gradedPercent == null ? null : {
          percent: state.gradedPercent, correctCount: state.gradedCorrectCount,
          totalCount: state.gradedTotalCount, missedItemIds: state.missedItemIds,
        },
      },
      worksheetSnapshot: worksheet,
      reviewEvidence,
      omrEvidence: reviewEvidence.filter((item) => item.reason === 'machine' || item.attemptId)
        .map((item) => ({ itemId: item.itemId, questionNumber: item.questionNumber ?? null,
          given: item.given ?? null, verdict: item.verdict ?? null, attemptId: item.attemptId ?? null })),
      artifacts: artifactRows,
      answerSheets,
      results: {
        machine: `/api/v1/school/teacher/sessions/${encodeURIComponent(sessionId)}/results/machine.png`,
        effective: `/api/v1/school/teacher/sessions/${encodeURIComponent(sessionId)}/results/effective.png?revision=${events.length}`,
        rendered: true,
      },
      progress: {
        courseId, completed: progressUnits.filter((candidate) => ['mastered', 'passed', 'excused', 'replaced'].includes(candidate.status)).length,
        total: courseUnits.length,
        units: progressUnits,
      },
      rewardReconciliation: events.filter((event) => event.type === 'rewarded'
        || event.type === 'reward_reconciled' || event.type === 'reward_reconciliation_failed'),
    };
  }
}

function progressStatus(unitId, learnerId, completedIds, exceptions) {
  const paused = exceptions.find((exception) => exception.kind === 'paused' && exception.resolvedLessonIds?.includes(unitId));
  if (paused) return 'paused';
  const learnerException = exceptions.find((exception) => exception.learnerId === learnerId
    && exception.resolvedLessonIds?.includes(unitId));
  if (learnerException) return learnerException.kind;
  return completedIds.has(unitId) ? 'passed' : 'remaining';
}

export class GetLearnerTimeline {
  #sessions;
  constructor({ sessions } = {}) {
    if (!sessions) throw new Error('GetLearnerTimeline requires sessions');
    this.#sessions = sessions;
  }

  async execute({ learnerId, limit = 50, before = null, unitId = null } = {}) {
    if (typeof learnerId !== 'string' || !learnerId.trim()) throw new ValidationError('learnerId is required');
    const safeLimit = Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 50));
    const rows = await this.#sessions.listForLearner(learnerId);
    const filtered = rows
      .filter((row) => !unitId || row.unitId === unitId)
      .filter((row) => !before || String(row.updatedAt ?? '') < before)
      .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
    const page = filtered.slice(0, safeLimit);
    return {
      schema: 'school.learner-timeline/v1', learnerId, items: page,
      nextCursor: filtered.length > page.length ? page.at(-1)?.updatedAt ?? null : null,
    };
  }
}

export default GetTeacherSession;
