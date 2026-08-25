import { reduceSession, createEvent } from '#domains/school/sessions/sessionEvents.mjs';
import { resultDocument } from '#domains/school/documents/receipts.mjs';
import { courseDisplay, moduleDisplay } from '#domains/school/curriculum/display.mjs';

const nameOf = (id) => id ? `${id[0].toUpperCase()}${id.slice(1)}` : null;

/** Mint a non-printing, immutable receipt whenever an adult changes a result. */
export class IssueCorrectedResultReceipt {
  #sessions; #curriculum; #worksheets; #capture; #clock; #timezone;
  constructor({ sessions, curriculum, worksheetInstances = null, receiptCapture = null,
    clock = () => new Date(), timezone = 'UTC' } = {}) {
    if (!sessions || !curriculum || !receiptCapture) throw new Error('IssueCorrectedResultReceipt requires sessions, curriculum and receiptCapture');
    this.#sessions = sessions; this.#curriculum = curriculum; this.#worksheets = worksheetInstances;
    this.#capture = receiptCapture; this.#clock = clock; this.#timezone = timezone;
  }

  async execute({ sessionId, correctionId, reason, parentArtifactIds = [] } = {}) {
    const events = await this.#sessions.readEvents(sessionId);
    const state = reduceSession(events);
    if (!state.sessionId || !state.outcome) return null;
    const unit = await this.#curriculum.getUnit(state.unitId);
    const work = (await this.#curriculum.listWorks?.() ?? [])
      .find((candidate) => candidate?.work === unit?.courseId) ?? null;
    const courseLabel = courseDisplay({ work, fallback: unit?.courseTitle ?? unit?.courseId ?? 'Independent study' });
    const moduleLabel = moduleDisplay({
      work, moduleId: unit?.module, fallbackTitle: unit?.module ?? unit?.title ?? state.unitId,
    });
    const worksheet = await this.#worksheets?.findBySession?.(sessionId) ?? null;
    const at = this.#clock().toISOString();
    const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: this.#timezone }).format(new Date(at));
    const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: this.#timezone }).format(new Date(at)).toLowerCase();
    const artifactId = `receipt/${sessionId}/correction/${correctionId}`;
    const parents = parentArtifactIds.length ? parentArtifactIds
      : state.resultReceiptArtifacts.map((row) => row.artifactId).slice(-1);
    const document = resultDocument({
      sessionId: `${sessionId}-correction-${correctionId}`,
      unitTitle: unit?.title ?? state.unitId, result: state.outcome.result,
      percent: state.gradedPercent, correctCount: state.gradedCorrectCount, totalCount: state.gradedTotalCount,
      passingPercent: state.gradedPassingPercent ?? unit?.passing?.percent ?? null,
      questionStart: worksheet?.omr?.rowRange?.start ?? null, subjectIcon: unit?.subject ?? null,
      learnerName: nameOf(state.learnerId), date, time, studentNo: worksheet?.omr?.cardId ?? null,
      taxonomy: { subject: nameOf(unit?.subject) ?? 'School', course: courseLabel.title,
        unit: moduleLabel.taxonomyLabel, lesson: unit?.title ?? state.unitId },
      actions: [], hints: [], objectives: [], notes: [`Updated result: ${reason}`],
    });
    const captured = await this.#capture.execute({ artifactId, sessionId, learnerId: state.learnerId,
      unitId: state.unitId, kind: 'result-correction', document, issuedAt: at, parentArtifactIds: parents });
    if (captured.created) {
      const built = createEvent({ type: 'result_receipt_captured', at, sessionId, artifactId,
        kind: 'result-correction', printed: false, printReason: 'not-printed', parentArtifactIds: parents });
      if (!built.errors.length) await this.#sessions.appendEvent(sessionId, built.event);
    }
    return { artifactId, created: captured.created };
  }
}

export default IssueCorrectedResultReceipt;
