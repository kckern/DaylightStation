import { sha256Text } from '#system/utils/sha256.mjs';
import { shortId } from '#system/utils/id.mjs';
import { ValidationError, EntityNotFoundError, DomainInvariantError } from '#domains/core/errors/index.mjs';
import { createEvent, reduceSession } from '#domains/school/sessions/sessionEvents.mjs';

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const lastSeq = (events) => events.reduce((max, event) => Math.max(max, Number(event?.seq) || 0), 0);
const rowsFor = (record) => Array.from(
  { length: record.rowRange.end - record.rowRange.start + 1 },
  (_, index) => record.rowRange.start + index,
);
const sameRows = (left, right) => left.length === right.length && left.every((row, index) => row === right[index]);
const firstConfirmedIssueAt = (events) => events.find((event) => (
  (event.type === 'issued' || event.type === 'reprinted') && event.confirmed !== false
))?.at ?? null;

function stableId(prefix, parts) {
  return `${prefix}_${sha256Text(JSON.stringify(parts)).slice(0, 16)}`;
}

function normalizeRows(value, label) {
  if (!Array.isArray(value) || value.length === 0
      || !value.every((row) => Number.isInteger(row) && row >= 1 && row <= 50)
      || new Set(value).size !== value.length) {
    throw new ValidationError(`${label} must be unique answer-sheet rows from 1 to 50`);
  }
  return [...value].sort((a, b) => a - b);
}

function recordForSession(records, sessionId, label) {
  const matches = records.filter((record) => record.sessionId === sessionId);
  if (matches.length !== 1) {
    throw new ValidationError(`${label} must have exactly one allocation record for ${sessionId}`);
  }
  return matches[0];
}

/**
 * Repair one wrong-worksheet attribution without inventing answer values.
 *
 * The source scan is invalidated append-only; the intended worksheet is
 * credited through human verdicts plus an explicit lineage annotation; the
 * unworked retry is abandoned; the obsolete physical card is retired; and a
 * brand-new, non-remediation session is issued for the source unit.
 */
export class RecoverMisattributedWorksheet {
  #sessions; #allocationStore; #teacherGate; #invalidateSessionEvidence;
  #submitPaperWork; #gradeSubmission; #closeSessionOutcome; #markSessionAbandoned;
  #issueDocument; #clock; #newSessionId; #logger; #invalidationAuthority;

  constructor({
    sessions, allocationStore, teacherGate, invalidateSessionEvidence,
    submitPaperWork, gradeSubmission, closeSessionOutcome, markSessionAbandoned,
    issueDocument, invalidationAuthority = null,
    clock = () => new Date(), newSessionId = () => `ses_${shortId(8)}`,
    logger = console,
  } = {}) {
    if (!sessions || !allocationStore || !teacherGate || !invalidateSessionEvidence
        || !submitPaperWork || !gradeSubmission || !closeSessionOutcome
        || !markSessionAbandoned || !issueDocument) {
      throw new Error('RecoverMisattributedWorksheet requires all recovery collaborators');
    }
    this.#sessions = sessions;
    this.#allocationStore = allocationStore;
    this.#teacherGate = teacherGate;
    this.#invalidateSessionEvidence = invalidateSessionEvidence;
    this.#submitPaperWork = submitPaperWork;
    this.#gradeSubmission = gradeSubmission;
    this.#closeSessionOutcome = closeSessionOutcome;
    this.#markSessionAbandoned = markSessionAbandoned;
    this.#issueDocument = issueDocument;
    this.#invalidationAuthority = invalidationAuthority;
    this.#clock = clock;
    this.#newSessionId = newSessionId;
    this.#logger = logger;
  }

  async execute({
    sourceSessionId, creditedSessionId, remediationSessionId,
    sourceCardId, currentCardId, sourceRows, targetRows, marks,
    reason, recoveredBy = null, pin = null, idempotencyKey,
    expectedReplacementRows = null, apply = false,
  } = {}) {
    this.#teacherGate.assert({
      userId: recoveredBy, pin,
      action: apply ? 'sessions.attribution-recover' : 'sessions.attribution-recover.preview',
      context: { sourceSessionId, creditedSessionId, remediationSessionId },
    });
    const required = {
      sourceSessionId, creditedSessionId, remediationSessionId,
      sourceCardId, currentCardId, reason, recoveredBy, idempotencyKey,
    };
    for (const [name, value] of Object.entries(required)) {
      if (!text(value)) throw new ValidationError(`${name} is required`);
    }
    if (!/^\d{7}$/.test(sourceCardId) || !/^\d{7}$/.test(currentCardId)) {
      throw new ValidationError('sourceCardId and currentCardId must be seven-digit Student Nos.');
    }
    if (sourceCardId === currentCardId) {
      throw new ValidationError('sourceCardId and currentCardId must differ');
    }
    const fromRows = normalizeRows(sourceRows, 'sourceRows');
    const toRows = normalizeRows(targetRows, 'targetRows');
    const normalizedMarks = Array.isArray(marks) ? marks.map((mark) => String(mark).trim().toUpperCase()) : [];
    if (!normalizedMarks.length || normalizedMarks.some((mark) => !/^[A-E]$/.test(mark))) {
      throw new ValidationError('marks must be an array of A-E bubble letters');
    }
    if (fromRows.length !== toRows.length || fromRows.length !== normalizedMarks.length) {
      throw new ValidationError('sourceRows, targetRows, and marks must have equal lengths');
    }
    const replacementRows = expectedReplacementRows
      ? { start: expectedReplacementRows.start, end: expectedReplacementRows.end }
      : null;
    if (replacementRows && (!Number.isInteger(replacementRows.start)
        || !Number.isInteger(replacementRows.end) || replacementRows.start < 1
        || replacementRows.end > 50 || replacementRows.start > replacementRows.end)) {
      throw new ValidationError('expectedReplacementRows must be a valid {start,end} answer-sheet range');
    }

    const key = idempotencyKey.trim();
    const invalidationId = stableId('inv', [key, sourceSessionId]);
    const attributionId = stableId('attr', [key, creditedSessionId]);
    const snapshot = await this.#inspect({
      sourceSessionId, creditedSessionId, remediationSessionId,
      sourceCardId, currentCardId, fromRows, toRows, normalizedMarks,
      replacementRows, key, invalidationId, attributionId,
      reason: reason.trim(), recoveredBy: recoveredBy.trim(), pin,
    });

    if (!apply) return this.#receipt({ applied: false, snapshot });

    await this.#invalidateSessionEvidence.execute({
      sessionId: sourceSessionId,
      invalidationId,
      reason: reason.trim(),
      invalidatedBy: recoveredBy.trim(),
      pin,
      baseSeq: snapshot.sourceSeq,
      apply: true,
    }, { authority: this.#invalidationAuthority });

    const nowIso = this.#clock().toISOString();
    await this.#confirmDeliveries(snapshot, { recoveredBy: recoveredBy.trim(), at: nowIso });
    await this.#creditIntendedWorksheet(snapshot, {
      attributionId, reason: reason.trim(), recoveredBy: recoveredBy.trim(), pin, nowIso,
    });
    await this.#removeObsoleteRemediation(snapshot, {
      reason: reason.trim(), recoveredBy: recoveredBy.trim(), pin,
    });
    await this.#allocationStore.retireCard({
      cardId: sourceCardId,
      reason: `worksheet attribution incident: ${reason.trim()}`,
      retiredBy: recoveredBy.trim(),
      at: nowIso,
    });

    const replacementSessionId = await this.#ensureFullReplacement({
      snapshot, replacementKey: key, recoveredBy: recoveredBy.trim(), nowIso,
    });
    const replacementState = reduceSession(await this.#sessions.readEvents(replacementSessionId));
    let issuance = { status: 'already_issued', sessionId: replacementSessionId };
    if (replacementState.state === 'created') {
      issuance = await this.#issueDocument.execute({ sessionId: replacementSessionId });
    } else if (!['issued', 'reprinted'].includes(replacementState.state)) {
      throw new DomainInvariantError(
        `replacement session ${replacementSessionId} is ${replacementState.state}; it cannot be issued`,
        { code: 'ATTRIBUTION_RECOVERY_REPLACEMENT_NOT_ISSUABLE' },
      );
    }

    const finalSnapshot = await this.#inspect({
      sourceSessionId, creditedSessionId, remediationSessionId,
      sourceCardId, currentCardId, fromRows, toRows, normalizedMarks,
      replacementRows, key, invalidationId, attributionId,
      reason: reason.trim(), recoveredBy: recoveredBy.trim(), pin,
    });
    if (!finalSnapshot.replacementRecord) {
      throw new DomainInvariantError('replacement worksheet did not reserve an answer-sheet row window', {
        code: 'ATTRIBUTION_RECOVERY_REPLACEMENT_NOT_ALLOCATED',
      });
    }
    if (finalSnapshot.replacementRecord.cardId !== currentCardId
        || finalSnapshot.replacementRecord.rowItems?.length !== snapshot.fullQuestionCount
        || (replacementRows && (
          finalSnapshot.replacementRecord.rowRange.start !== replacementRows.start
          || finalSnapshot.replacementRecord.rowRange.end !== replacementRows.end
        ))) {
      throw new DomainInvariantError('replacement worksheet allocation does not match the previewed full-sheet target', {
        code: 'ATTRIBUTION_RECOVERY_REPLACEMENT_ALLOCATION_MISMATCH',
        details: { allocation: finalSnapshot.replacementRecord, expectedCardId: currentCardId, replacementRows },
      });
    }

    this.#logger.info?.('school.session.attribution-recovered', {
      sourceSessionId, creditedSessionId, remediationSessionId, replacementSessionId,
      learnerId: snapshot.learnerId, sourceCardId, currentCardId,
      replacementRows: finalSnapshot.replacementRecord.rowRange,
      recoveredBy: recoveredBy.trim(), idempotencyKey: key,
    });
    return this.#receipt({
      applied: true,
      snapshot: finalSnapshot,
      issuance,
      replacementSessionId,
    });
  }

  async #inspect({
    sourceSessionId, creditedSessionId, remediationSessionId,
    sourceCardId, currentCardId, fromRows, toRows, normalizedMarks,
    replacementRows, key, invalidationId, attributionId, reason, recoveredBy, pin,
  }) {
    const [sourceEvents, creditedEvents, remediationEvents, sourceRecords, currentRecords] = await Promise.all([
      this.#sessions.readEvents(sourceSessionId),
      this.#sessions.readEvents(creditedSessionId),
      this.#sessions.readEvents(remediationSessionId),
      this.#allocationStore.findByCard(sourceCardId),
      this.#allocationStore.findByCard(currentCardId),
    ]);
    if (!sourceEvents.length) throw new EntityNotFoundError('session', sourceSessionId);
    if (!creditedEvents.length) throw new EntityNotFoundError('session', creditedSessionId);
    if (!remediationEvents.length) throw new EntityNotFoundError('session', remediationSessionId);
    const source = reduceSession(sourceEvents);
    const credited = reduceSession(creditedEvents);
    const remediation = reduceSession(remediationEvents);
    if (new Set([source.learnerId, credited.learnerId, remediation.learnerId]).size !== 1) {
      throw new ValidationError('all three sessions must belong to the same learner');
    }
    if (remediation.remediationOf !== sourceSessionId) {
      throw new ValidationError(`${remediationSessionId} is not remediation for ${sourceSessionId}`);
    }
    if ((!source.machineGrade || source.machineGrade.totalCount < 1) && !source.evidenceInvalidated) {
      throw new ValidationError(`${sourceSessionId} has no machine grade to invalidate`);
    }
    if (!['created', 'issued', 'reprinted', 'abandoned'].includes(remediation.state)
        || remediation.attemptIds.length || remediation.machineGrade || remediation.outcome) {
      throw new ValidationError(`${remediationSessionId} contains learner evidence or is not an unworked retry`);
    }

    const sourceRecord = recordForSession(sourceRecords, sourceSessionId, 'source card');
    const remediationRecord = recordForSession(sourceRecords, remediationSessionId, 'source card');
    const creditedRecord = recordForSession(currentRecords, creditedSessionId, 'current card');
    if (!sameRows(fromRows, fromRows.filter((row) => rowsFor(sourceRecord).includes(row)))) {
      throw new ValidationError('sourceRows are not all inside the source worksheet allocation');
    }
    if (!sameRows(toRows, rowsFor(creditedRecord))) {
      throw new ValidationError('targetRows must name the entire intended worksheet allocation');
    }
    if (creditedRecord.predecessorCardId !== sourceCardId) {
      throw new ValidationError(`${currentCardId} is not recorded as the successor of ${sourceCardId}`);
    }
    const itemIds = toRows.map((row) => creditedRecord.rowItems?.find((item) => item.row === row)?.itemId ?? null);
    if (itemIds.some((itemId) => !itemId)) {
      throw new ValidationError('the intended worksheet allocation is missing row-to-item lineage');
    }
    const fullQuestionCount = rowsFor(sourceRecord).length;
    if (source.machineGrade && source.machineGrade.totalCount !== fullQuestionCount) {
      throw new ValidationError('the source machine grade does not cover the full source worksheet');
    }
    if (credited.gradedPercent !== null && (credited.gradedPercent !== 100
        || credited.gradedTotalCount !== itemIds.length)) {
      throw new ValidationError(`${creditedSessionId} already carries a different grade`);
    }
    const existingAttribution = credited.evidenceAttributions.find((row) => row.attributionId === attributionId) ?? null;
    if (credited.evidenceAttributions.length && !existingAttribution) {
      throw new ValidationError(`${creditedSessionId} already has a different evidence attribution`);
    }
    if (existingAttribution && (
      existingAttribution.sourceSessionId !== sourceSessionId
      || existingAttribution.sourceCardId !== sourceCardId
      || !sameRows(existingAttribution.sourceRows, fromRows)
      || existingAttribution.targetCardId !== currentCardId
      || !sameRows(existingAttribution.targetRows, toRows)
      || !sameRows(existingAttribution.itemIds, itemIds)
      || !sameRows(existingAttribution.marks, normalizedMarks)
    )) {
      throw new ValidationError('the prior attribution with this idempotency key does not match this request');
    }
    const deliveries = [
      { cardId: sourceCardId, record: sourceRecord, deliveredAt: firstConfirmedIssueAt(sourceEvents) },
      { cardId: sourceCardId, record: remediationRecord, deliveredAt: firstConfirmedIssueAt(remediationEvents) },
      { cardId: currentCardId, record: creditedRecord, deliveredAt: firstConfirmedIssueAt(creditedEvents) },
    ];
    if (deliveries.some((entry) => !entry.deliveredAt)) {
      throw new ValidationError('every recovered allocation must have a confirmed issued/reprinted event');
    }

    const invalidation = await this.#invalidateSessionEvidence.execute({
      sessionId: sourceSessionId, invalidationId, reason, invalidatedBy: recoveredBy,
      pin, baseSeq: lastSeq(sourceEvents), apply: false,
    }, { authority: this.#invalidationAuthority });
    if (invalidation.attemptIds.length !== fullQuestionCount) {
      throw new ValidationError(`source scan has ${invalidation.attemptIds.length} attempt rows; expected ${fullQuestionCount}`);
    }
    const replacementSessionId = await this.#findReplacement({
      learnerId: source.learnerId, sourceSessionId, replacementKey: key,
    });
    const replacementRecords = replacementSessionId
      ? currentRecords.filter((record) => record.sessionId === replacementSessionId)
      : [];
    const replacementRecord = replacementRecords.length === 1 ? replacementRecords[0] : null;
    if (replacementSessionId && replacementRecords.length > 1) {
      throw new ValidationError('replacement session has multiple answer-sheet allocations');
    }
    const occupiedThrough = currentRecords.reduce((max, record) => Math.max(max, record.rowRange.end), 0);
    const plannedRows = replacementRecord?.rowRange ?? {
      start: occupiedThrough + 1,
      end: occupiedThrough + fullQuestionCount,
    };
    if (plannedRows.end > 50) throw new ValidationError(`${currentCardId} has no room for the full replacement worksheet`);
    if (replacementRows && (plannedRows.start !== replacementRows.start || plannedRows.end !== replacementRows.end)) {
      throw new ValidationError(
        `full replacement would use rows ${plannedRows.start}-${plannedRows.end}, not ${replacementRows.start}-${replacementRows.end}`,
      );
    }
    return {
      learnerId: source.learnerId,
      sourceSessionId, creditedSessionId, remediationSessionId,
      sourceCardId, currentCardId,
      sourceEvents, creditedEvents, remediationEvents,
      source, credited, remediation,
      sourceSeq: lastSeq(sourceEvents), creditedSeq: lastSeq(creditedEvents),
      sourceRecord, remediationRecord, creditedRecord,
      sourceRows: fromRows, targetRows: toRows, itemIds, marks: normalizedMarks,
      fullQuestionCount, invalidation, invalidationId, attributionId,
      deliveries, plannedReplacementRows: plannedRows,
      replacementSessionId, replacementRecord,
      oldCardRetired: sourceRecords.some((record) => Boolean(record.cardRetiredAt)),
    };
  }

  async #confirmDeliveries(snapshot, { recoveredBy, at }) {
    for (const delivery of snapshot.deliveries) {
      // eslint-disable-next-line no-await-in-loop
      await this.#allocationStore.confirmHistoricalDelivery({
        cardId: delivery.cardId,
        recordId: delivery.record.recordId,
        deliveredAt: delivery.deliveredAt,
        confirmedBy: recoveredBy,
        at,
      });
    }
  }

  async #creditIntendedWorksheet(snapshot, { attributionId, reason, recoveredBy, pin, nowIso }) {
    let events = await this.#sessions.readEvents(snapshot.creditedSessionId);
    let state = reduceSession(events);
    if (!state.evidenceAttributions.some((row) => row.attributionId === attributionId)) {
      const seq = lastSeq(events);
      const built = createEvent({
        type: 'evidence_attributed', at: nowIso, sessionId: snapshot.creditedSessionId,
        attributionId,
        sourceSessionId: snapshot.sourceSessionId,
        sourceCardId: snapshot.sourceCardId,
        sourceRows: snapshot.sourceRows,
        targetCardId: snapshot.currentCardId,
        targetRows: snapshot.targetRows,
        itemIds: snapshot.itemIds,
        marks: snapshot.marks,
        reason,
        attributedBy: recoveredBy,
        baseSeq: seq,
        seq: seq + 1,
      });
      if (built.errors.length) throw new ValidationError(built.errors.join('; '));
      await this.#sessions.appendEvent(snapshot.creditedSessionId, built.event, { expectedSeq: seq });
      events = await this.#sessions.readEvents(snapshot.creditedSessionId);
      state = reduceSession(events);
    }
    if (['issued', 'reprinted'].includes(state.state)) {
      const submitted = await this.#submitPaperWork.execute({
        sessionId: snapshot.creditedSessionId,
        entries: {},
        blank: snapshot.itemIds,
        submittedBy: recoveredBy,
      });
      if (submitted.status !== 'submitted' && submitted.status !== 'duplicate') {
        throw new DomainInvariantError(`could not submit intended worksheet: ${submitted.message}`, {
          code: 'ATTRIBUTION_RECOVERY_CREDIT_SUBMIT_FAILED',
        });
      }
      state = reduceSession(await this.#sessions.readEvents(snapshot.creditedSessionId));
    }
    if (state.state === 'submitted') {
      const verdicts = Object.fromEntries(snapshot.itemIds.map((itemId) => [itemId, 'correct']));
      const graded = await this.#gradeSubmission.execute({
        sessionId: snapshot.creditedSessionId,
        verdicts,
        gradedBy: recoveredBy,
        pin,
      });
      if (graded.status !== 'graded' && graded.status !== 'duplicate') {
        throw new DomainInvariantError(`could not credit intended worksheet: ${graded.message}`, {
          code: 'ATTRIBUTION_RECOVERY_CREDIT_GRADE_FAILED',
        });
      }
      state = reduceSession(await this.#sessions.readEvents(snapshot.creditedSessionId));
    }
    if (state.gradedPercent !== 100 || state.gradedTotalCount !== snapshot.itemIds.length) {
      throw new DomainInvariantError('intended worksheet is not credited at full marks', {
        code: 'ATTRIBUTION_RECOVERY_CREDIT_MISMATCH',
      });
    }
    if (!state.outcome) {
      const closed = await this.#closeSessionOutcome.execute({ sessionId: snapshot.creditedSessionId });
      if (!['settled', 'already_settled'].includes(closed.status)) {
        throw new DomainInvariantError(`could not settle intended worksheet: ${closed.message}`, {
          code: 'ATTRIBUTION_RECOVERY_CREDIT_CLOSE_FAILED',
        });
      }
    }
    const [record] = (await this.#allocationStore.findByCard(snapshot.currentCardId))
      .filter((entry) => entry.sessionId === snapshot.creditedSessionId);
    if (record?.status === 'live') {
      await this.#allocationStore.updateStatus({
        cardId: snapshot.currentCardId, recordId: record.recordId, status: 'satisfied',
      });
    } else if (record?.status !== 'satisfied') {
      throw new DomainInvariantError('intended worksheet allocation is not live or satisfied', {
        code: 'ATTRIBUTION_RECOVERY_CREDIT_ALLOCATION_INVALID',
      });
    }
  }

  async #removeObsoleteRemediation(snapshot, { reason, recoveredBy, pin }) {
    const state = reduceSession(await this.#sessions.readEvents(snapshot.remediationSessionId));
    if (state.state !== 'abandoned') {
      await this.#markSessionAbandoned.execute({
        sessionId: snapshot.remediationSessionId,
        learnerId: snapshot.learnerId,
        reason: `source scan invalidated; full replacement required: ${reason}`,
        decidedBy: recoveredBy,
        pin,
      });
    }
    await this.#allocationStore.release({
      cardId: snapshot.sourceCardId,
      rows: snapshot.remediationRecord.rowRange,
    });
  }

  async #ensureFullReplacement({ snapshot, replacementKey, recoveredBy, nowIso }) {
    let sessionId = await this.#findReplacement({
      learnerId: snapshot.learnerId,
      sourceSessionId: snapshot.sourceSessionId,
      replacementKey,
    });
    if (sessionId) return sessionId;
    sessionId = this.#newSessionId();
    const built = createEvent({
      type: 'created', at: nowIso, sessionId,
      learnerId: snapshot.learnerId,
      unitId: snapshot.source.unitId,
      ...(snapshot.source.studyDay ? { studyDay: snapshot.source.studyDay } : {}),
      variant: 0,
      openedBy: recoveredBy,
      replacementKey,
      replacesSessionId: snapshot.sourceSessionId,
    });
    if (built.errors.length) throw new ValidationError(built.errors.join('; '));
    await this.#sessions.appendEvent(sessionId, built.event);
    return sessionId;
  }

  async #findReplacement({ learnerId, sourceSessionId, replacementKey }) {
    const rows = await this.#sessions.listForLearner(learnerId);
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop
      const events = await this.#sessions.readEvents(row.sessionId);
      const created = events.find((event) => event.type === 'created');
      if (created?.replacementKey === replacementKey
          && created.replacesSessionId === sourceSessionId
          && created.remediationOf === undefined) return row.sessionId;
    }
    return null;
  }

  #receipt({ applied, snapshot, issuance = null, replacementSessionId = snapshot.replacementSessionId }) {
    return {
      schema: 'school.worksheet-attribution-recovery/v1',
      applied,
      learnerId: snapshot.learnerId,
      source: {
        sessionId: snapshot.sourceSessionId,
        cardId: snapshot.sourceCardId,
        rows: snapshot.sourceRecord.rowRange,
        invalidationId: snapshot.invalidationId,
        attemptIds: snapshot.invalidation.attemptIds,
        effectiveGrade: null,
      },
      credited: {
        sessionId: snapshot.creditedSessionId,
        cardId: snapshot.currentCardId,
        rows: snapshot.targetRows,
        itemIds: snapshot.itemIds,
        marks: snapshot.marks,
        attributionId: snapshot.attributionId,
        percent: applied ? snapshot.credited.gradedPercent : 100,
      },
      remediation: {
        sessionId: snapshot.remediationSessionId,
        cardId: snapshot.sourceCardId,
        rows: snapshot.remediationRecord.rowRange,
        targetState: 'abandoned',
      },
      retiredCardId: snapshot.sourceCardId,
      replacement: {
        sessionId: replacementSessionId ?? null,
        unitId: snapshot.source.unitId,
        remediation: false,
        questionCount: snapshot.fullQuestionCount,
        cardId: snapshot.currentCardId,
        rows: snapshot.replacementRecord?.rowRange ?? snapshot.plannedReplacementRows,
        issuance,
      },
    };
  }
}

export default RecoverMisattributedWorksheet;
