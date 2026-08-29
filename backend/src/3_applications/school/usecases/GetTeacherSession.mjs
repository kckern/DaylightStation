import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';
import { reduceSession } from '#domains/school/sessions/sessionEvents.mjs';
import { curriculumPosterRef, schoolArtifactRef } from '#apps/common/resources/publicResourceRefs.mjs';

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
    const [unit, works, worksheet, reviewEvidence, issuedArtifactRows, receiptArtifactRows, learnerSessions, exceptions] = await Promise.all([
      this.#curriculum?.getUnit?.(state.unitId) ?? null,
      this.#curriculum?.listWorks?.() ?? [],
      this.#worksheets?.findBySession?.(sessionId) ?? null,
      this.#reviews?.listForSession?.(sessionId) ?? [],
      Promise.all(state.issuedArtifacts.map(async (artifactId) => {
        const artifact = await this.#artifacts?.get?.(artifactId);
        return artifact ? { ...artifact.manifest, availability: 'exact', exactBytesRetained: true,
          originalPdfUrl: schoolArtifactRef(artifactId, 'original.pdf'),
          thumbnailUrl: (artifact.manifest.representation?.mediaType ?? 'application/pdf') === 'application/pdf'
            ? schoolArtifactRef(artifactId, 'thumbnail.png') : null }
          : { artifactId, availability: 'unavailable', exactBytesRetained: false };
      })),
      Promise.all((state.resultReceiptArtifacts ?? []).map(async (receipt) => {
        const artifact = await this.#artifacts?.get?.(receipt.artifactId);
        return artifact ? {
          ...artifact.manifest, role: 'result-receipt', availability: 'exact', exactBytesRetained: true,
          originalUrl: schoolArtifactRef(receipt.artifactId, 'original'),
          printed: receipt.printed, printReason: receipt.printReason, capturedAt: receipt.at,
        } : { ...receipt, role: 'result-receipt', availability: 'unavailable', exactBytesRetained: false };
      })),
      this.#sessions.listForLearner(state.learnerId),
      this.#exceptions?.active?.() ?? [],
    ]);
    // The published revision remains useful for question/evidence context,
    // but it is not a substitute for what was physically issued. History
    // may only call a worksheet an artifact when its immutable bytes were
    // captured. Re-rendering a current/published document here used to create
    // a convincing but false "original" for legacy sessions.
    const publishedWorksheet = worksheet?.documentId && worksheet?.documentRevision
      ? await this.#printDocuments?.getPublished?.(worksheet.documentId, worksheet.documentRevision)
      : null;
    const artifactRows = [...issuedArtifactRows, ...receiptArtifactRows];
    const courseId = unit?.courseId ?? null;
    const course = works.find((candidate) => candidate.work === courseId
      || `${candidate.subject}/${candidate.work}` === courseId) ?? null;
    const module = course?.modules?.find((entry) => entry.module === unit?.module) ?? null;
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
        subjectIcon: unit?.subject ?? course?.subject ?? 'school',
        courseId, courseTitle: course?.title ?? 'Course title unavailable',
        moduleId: unit?.module ?? null, moduleTitle: module?.title ?? 'Unit title unavailable',
        lessonId: state.unitId, lessonTitle: unit?.title ?? 'Lesson title unavailable',
        posterUrl: courseId ? curriculumPosterRef('teacher', courseId) : null,
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
  #sessions; #curriculum;
  constructor({ sessions, curriculum = null } = {}) {
    if (!sessions) throw new Error('GetLearnerTimeline requires sessions');
    this.#sessions = sessions;
    this.#curriculum = curriculum;
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
      schema: 'school.learner-timeline/v1', learnerId, items: await this.#enrich(page),
      nextCursor: filtered.length > page.length ? page.at(-1)?.updatedAt ?? null : null,
    };
  }

  // Session records store only ids; titles are a catalog concern resolved at
  // read time — the same join the detail and Today read models already do.
  async #enrich(page) {
    if (!this.#curriculum?.getUnit) return page;
    try {
      const works = await (this.#curriculum.listWorks?.() ?? []);
      const courseOf = (courseId) => works.find((candidate) => candidate.work === courseId
        || `${candidate.subject}/${candidate.work}` === courseId) ?? null;
      return await Promise.all(page.map(async (row) => {
        const unit = await this.#curriculum.getUnit(row.unitId);
        if (!unit) return row;
        const course = courseOf(unit.courseId ?? null);
        const module = course?.modules?.find((entry) => entry.module === unit.module) ?? null;
        return {
          ...row,
          lessonTitle: unit.title ?? null,
          courseId: unit.courseId ?? null,
          courseTitle: course?.title ?? null,
          subject: unit.subject ?? course?.subject ?? null,
          moduleTitle: module?.title ?? null,
          posterUrl: unit.courseId ? curriculumPosterRef('teacher', unit.courseId) : null,
        };
      }));
    } catch {
      return page;
    }
  }
}

export default GetTeacherSession;
