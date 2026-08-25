import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';
import { reduceSession } from '#domains/school/sessions/sessionEvents.mjs';

/** Read models for the teacher history and session inspector surfaces. */
export class GetTeacherSession {
  #sessions; #curriculum; #artifacts; #reviews; #allocations; #worksheets; #exceptions; #printDocuments;
  constructor({
    sessions, curriculum = null, issuedArtifacts = null, reviewQueue = null,
    allocationStore = null, worksheetInstances = null, curriculumExceptions = null,
    printDocuments = null,
  } = {}) {
    if (!sessions) throw new Error('GetTeacherSession requires sessions');
    this.#sessions = sessions;
    this.#curriculum = curriculum;
    this.#artifacts = issuedArtifacts;
    this.#reviews = reviewQueue;
    this.#allocations = allocationStore;
    this.#worksheets = worksheetInstances;
    this.#exceptions = curriculumExceptions;
    this.#printDocuments = printDocuments;
  }

  async execute({ sessionId } = {}) {
    if (typeof sessionId !== 'string' || !sessionId.trim()) throw new ValidationError('sessionId is required');
    const events = await this.#sessions.readEvents(sessionId);
    if (!events.length) throw new EntityNotFoundError('session', sessionId);
    const state = reduceSession(events);
    const [unit, works, worksheet, reviewEvidence, issuedArtifactRows, learnerSessions, exceptions] = await Promise.all([
      this.#curriculum?.getUnit?.(state.unitId) ?? null,
      this.#curriculum?.listWorks?.() ?? [],
      this.#worksheets?.findBySession?.(sessionId) ?? null,
      this.#reviews?.listForSession?.(sessionId) ?? [],
      Promise.all(state.issuedArtifacts.map(async (artifactId) => {
        const artifact = await this.#artifacts?.get?.(artifactId);
        return artifact ? { ...artifact.manifest, availability: 'exact', exactBytesRetained: true,
          originalPdfUrl: `/api/v1/school/teacher/artifacts/${encodeURIComponent(artifactId)}/original.pdf` }
          : { artifactId, availability: 'unavailable', exactBytesRetained: false };
      })),
      this.#sessions.listForLearner(state.learnerId),
      this.#exceptions?.active?.() ?? [],
    ]);
    // A worksheet has always been an immutable work-session artifact, even
    // before the byte-retention store existed. Resolve its published document
    // revision here rather than making old history look as though it never
    // produced paper. This is read-through only: opening teacher history must
    // never mint or alter an artifact.
    const publishedWorksheet = worksheet?.documentId && worksheet?.documentRevision
      ? await this.#printDocuments?.getPublished?.(worksheet.documentId, worksheet.documentRevision)
      : null;
    const legacyArtifact = publishedWorksheet ? {
      schema: 'school.session-artifact/v2',
      artifactId: worksheet.id ?? `${sessionId}:worksheet`,
      kind: 'assignment', origin: 'published-document',
      documentId: worksheet.documentId, documentRevision: worksheet.documentRevision,
      title: publishedWorksheet.title ?? unit?.title ?? null,
      createdAt: worksheet.issuedAt ?? state.createdAt ?? null,
      originalPdfUrl: `/api/v1/school/teacher/sessions/${encodeURIComponent(sessionId)}/worksheet.pdf`,
      exactBytesRetained: false,
      availability: 'deterministic-replay',
      rendererRevision: worksheet.rendererRevision ?? null,
    } : null;
    let artifactRows = [...issuedArtifactRows];
    if (legacyArtifact) {
      const legacyIndex = artifactRows.findIndex((artifact) => artifact.artifactId === legacyArtifact.artifactId
        || (artifact.documentId === legacyArtifact.documentId && artifact.documentRevision === legacyArtifact.documentRevision));
      // `issuedArtifacts` deliberately leaves a lightweight `{artifactId}`
      // placeholder when an old byte archive is absent. Enrich that placeholder
      // with the published-document artifact instead of allowing it to hide
      // the worksheet's real historical representation.
      if (legacyIndex >= 0 && !artifactRows[legacyIndex].originalPdfUrl) {
        artifactRows[legacyIndex] = { ...artifactRows[legacyIndex], ...legacyArtifact };
      } else if (legacyIndex < 0) artifactRows = [...artifactRows, legacyArtifact];
    }
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
      schema: 'school.teacher-session/v4',
      sessionId,
      revision: events.reduce((max, event) => Math.max(max, Number(event?.seq) || 0), 0),
      state,
      events,
      artifactIds: artifactRows.map((artifact) => artifact.artifactId),
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
      assignment: publishedWorksheet ? {
        documentId: worksheet.documentId, documentRevision: worksheet.documentRevision,
        title: publishedWorksheet.title ?? unit?.title ?? null,
        createdAt: worksheet.issuedAt ?? state.createdAt ?? null,
        questions: (worksheet.questions ?? []).map((question, index) => ({
          itemId: question.itemId ?? question.id ?? null,
          number: question.questionNumber ?? question.number ?? index + 1,
          prompt: question.prompt ?? question.question ?? question.text ?? null,
          choices: question.options ?? question.choices ?? [],
          expected: (question.options ?? question.choices ?? []).filter((choice) => choice?.correct === true)
            .map((choice) => choice.letter ?? choice.label ?? choice.text ?? choice),
        })),
      } : null,
      assessment: {
        machine: state.machineGrade ?? null,
        effective: state.gradedPercent == null ? null : {
          percent: state.gradedPercent, correctCount: state.gradedCorrectCount,
          totalCount: state.gradedTotalCount, missedItemIds: state.missedItemIds,
        },
        items: reviewEvidence.map((item, index) => ({
          itemId: item.itemId ?? null, questionNumber: item.questionNumber ?? index + 1,
          prompt: item.prompt ?? item.question ?? null, given: item.given ?? null,
          expected: (worksheet?.questions ?? []).find((question) => question.itemId === item.itemId)?.options
            ?.filter((choice) => choice?.correct === true)
            .map((choice) => choice.letter ?? choice.label ?? choice.text ?? choice) ?? [],
          verdict: item.verdict ?? null,
        })),
      },
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
