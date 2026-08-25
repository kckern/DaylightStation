import { createHash } from 'node:crypto';
import { ValidationError, EntityNotFoundError, DomainInvariantError } from '#domains/core/errors/index.mjs';
import { createEvent, reduceSession } from '#domains/school/sessions/sessionEvents.mjs';

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const lastSeq = (events) => events.reduce((max, event) => Math.max(max, Number(event?.seq) || 0), 0);

function stableAdjustmentId({ sessionId, baseSeq, adjustedBy, reason, percent, correctCount, totalCount,
  missedItemIds, itemVerdicts }) {
  const digest = createHash('sha256')
    .update(JSON.stringify({ sessionId, baseSeq, adjustedBy, reason, percent, correctCount, totalCount,
      missedItemIds, itemVerdicts }))
    .digest('hex').slice(0, 16);
  return `adj_${digest}`;
}

/** Append-only, preview-first correction of one settled session's grade. */
export class AdjustSessionGrade {
  #sessions; #teacherGate; #worksheets; #reviews; #curriculum; #economy; #economyEnabled; #clock; #logger; #receiptIssuer;

  constructor({ sessions, teacherGate, worksheetInstances = null, reviewQueue = null,
    curriculum = null, economy = null, economyEnabled = false,
    receiptIssuer = null, clock = () => new Date(), logger = console } = {}) {
    if (!sessions) throw new Error('AdjustSessionGrade requires sessions');
    if (!teacherGate) throw new Error('AdjustSessionGrade requires teacherGate');
    this.#sessions = sessions;
    this.#teacherGate = teacherGate;
    this.#worksheets = worksheetInstances;
    this.#reviews = reviewQueue;
    this.#curriculum = curriculum;
    this.#economy = economy;
    this.#economyEnabled = economyEnabled === true;
    this.#receiptIssuer = receiptIssuer;
    this.#clock = clock;
    this.#logger = logger;
  }

  async execute({
    sessionId, percent, correctCount, totalCount, missedItemIds, itemVerdicts,
    reason, adjustedBy = null, pin = null, baseSeq, adjustmentId = null, apply = false,
  } = {}) {
    this.#teacherGate.assert({ userId: adjustedBy, pin,
      action: apply === true ? 'sessions.grade-adjust' : 'sessions.grade-adjust.preview', context: { sessionId } });
    if (!text(sessionId)) throw new ValidationError('sessionId is required');
    if (!text(reason)) throw new ValidationError('a reason is required for a grade correction');

    const events = await this.#sessions.readEvents(sessionId);
    if (!events.length) throw new EntityNotFoundError('session', sessionId);
    const currentSeq = lastSeq(events);
    const state = reduceSession(events);
    if (!state.machineGrade) throw new ValidationError(`session ${sessionId} has no machine grade to correct`);
    const normalized = await this.#normalizeItemVerdicts({
      sessionId, state, percent, correctCount, totalCount, missedItemIds, itemVerdicts,
    });
    const id = text(adjustmentId) ?? stableAdjustmentId({
      sessionId, baseSeq: baseSeq ?? currentSeq, adjustedBy, reason: reason.trim(), ...normalized,
    });
    const prior = events.find((event) => event?.type === 'grade_adjusted' && event.adjustmentId === id);
    if (prior) {
      const sameRequest = JSON.stringify({
        adjustedBy: prior.adjustedBy, reason: prior.reason, percent: prior.percent,
        correctCount: prior.correctCount, totalCount: prior.totalCount,
        missedItemIds: prior.missedItemIds, itemVerdicts: prior.itemVerdicts,
      }) === JSON.stringify({ adjustedBy, reason: reason.trim(), ...normalized });
      if (!sameRequest) throw new DomainInvariantError(`adjustment id ${id} was already used for another correction`, {
        code: 'IDEMPOTENCY_CONFLICT',
      });
      let effective = reduceSession(events);
      const reconciliation = apply === true
        ? await this.#reconcileReward({ sessionId, events, before: state, after: effective,
          sourceAdjustmentId: id, reconciliationId: `grade-adjustment:${id}` })
        : await this.#rewardPreview(state, effective);
      if (reconciliation?.applied) effective = reduceSession(await this.#sessions.readEvents(sessionId));
      return { schema: 'school.grade-adjustment-receipt/v1', applied: true, idempotent: true,
        sessionId, adjustmentId: id, baseSeq: currentSeq, machineGrade: effective.machineGrade,
        effectiveGrade: gradeOf(effective), outcome: effective.outcome, rewardReconciliation: reconciliation };
    }
    if (baseSeq !== undefined && baseSeq !== currentSeq) {
      throw new DomainInvariantError(`session ${sessionId} changed after this preview`, {
        code: 'STALE_SAVE', details: { expected: baseSeq, actual: currentSeq },
      });
    }
    const built = createEvent({
      type: 'grade_adjusted', at: this.#clock().toISOString(), sessionId,
      adjustmentId: id, ...normalized,
      reason: reason.trim(), adjustedBy, baseSeq: currentSeq, seq: currentSeq + 1,
    });
    if (built.errors.length) throw new ValidationError(built.errors.join('; '));
    const preview = reduceSession([...events, built.event]);
    if (preview.errors.length > state.errors.length) {
      throw new DomainInvariantError(`grade correction is not valid: ${preview.errors.at(-1)}`, { code: 'GRADE_ADJUSTMENT_INVALID' });
    }
    let reconciliation = await this.#rewardPreview(state, preview);
    if (apply === true) {
      await this.#sessions.appendEvent(sessionId, built.event, { expectedSeq: currentSeq });
      reconciliation = await this.#reconcileReward({ sessionId, events: [...events, built.event],
        before: state, after: preview, sourceAdjustmentId: id, reconciliationId: `grade-adjustment:${id}` });
      this.#logger.info?.('school.session.grade-adjusted', {
        sessionId, adjustmentId: id, adjustedBy, from: state.gradedPercent, to: preview.gradedPercent,
      });
    }
    const receiptArtifact = apply === true
      ? await this.#receiptIssuer?.execute?.({ sessionId, correctionId: id, reason: reason.trim() }) : null;
    return {
      schema: 'school.grade-adjustment-receipt/v1', applied: apply === true, idempotent: false,
      sessionId, adjustmentId: id, baseSeq: currentSeq,
      machineGrade: preview.machineGrade, previousEffectiveGrade: gradeOf(state),
      effectiveGrade: gradeOf(preview), previousOutcome: state.outcome, outcome: preview.outcome,
      rewardChanged: reconciliation.delta !== 0, rewardReconciliation: reconciliation,
      receiptArtifact,
    };
  }

  async #desiredReward(before, after) {
    if (after.outcome?.result !== 'passed') return 0;
    const unit = await this.#curriculum?.getUnit?.(after.unitId);
    const declared = Number(unit?.reward?.amount);
    if (unit?.reward?.requiresSignoff && (before.rewardAmount ?? 0) === 0) return 0;
    return this.#economyEnabled && this.#economy && Number.isFinite(declared)
      ? Math.max(0, Math.floor(declared))
      : 0;
  }

  async #rewardPreview(before, after) {
    const desired = await this.#desiredReward(before, after);
    return { status: 'preview', applied: false, currentAmount: before.rewardAmount ?? 0,
      desiredAmount: desired, delta: desired - (before.rewardAmount ?? 0) };
  }

  async reconcileReward(args) { return this.#reconcileReward(args); }
  async previewReward(before, after) { return this.#rewardPreview(before, after); }

  async #reconcileReward({ sessionId, events, before, after, sourceAdjustmentId, reconciliationId }) {
    const existing = events.find((event) => event.type === 'reward_reconciled'
      && event.reconciliationId === reconciliationId);
    if (existing) return { status: 'applied', applied: true, idempotent: true,
      currentAmount: before.rewardAmount ?? 0, desiredAmount: before.rewardAmount ?? 0,
      delta: existing.delta, txnId: existing.txnId };

    // A correction cannot manufacture a sign-off. It may preserve or reverse
    // an already signed-off award, but a new sign-off reward stays pending.
    const desiredAmount = await this.#desiredReward(before, after);
    const currentAmount = before.rewardAmount ?? 0;
    const delta = desiredAmount - currentAmount;
    if (delta === 0) return { status: 'unchanged', applied: false, idempotent: false,
      currentAmount, desiredAmount, delta: 0, txnId: null };

    const at = this.#clock().toISOString();
    try {
      const adjusted = await this.#economy.adjust(after.learnerId, {
        delta, source: 'school-grade-correction', ref: reconciliationId,
        note: `Session ${sessionId}; adjustment ${sourceAdjustmentId}`,
      });
      const built = createEvent({ type: 'reward_reconciled', at, sessionId, reconciliationId,
        delta, txnId: adjusted?.txnId ?? reconciliationId, sourceAdjustmentId });
      if (built.errors.length) throw new ValidationError(built.errors.join('; '));
      await this.#sessions.appendEvent(sessionId, built.event);
      return { status: 'applied', applied: true, idempotent: adjusted?.idempotent === true,
        currentAmount, desiredAmount, delta, txnId: built.event.txnId };
    } catch (error) {
      const failed = createEvent({ type: 'reward_reconciliation_failed', at, sessionId,
        reconciliationId, delta, reason: error.message, sourceAdjustmentId });
      if (!failed.errors.length) await this.#sessions.appendEvent(sessionId, failed.event);
      this.#logger.warn?.('school.session.reward-reconciliation-failed', {
        sessionId, reconciliationId, delta, error: error.message,
      });
      return { status: 'failed', applied: false, idempotent: false,
        currentAmount, desiredAmount, delta, error: error.message };
    }
  }

  async #normalizeItemVerdicts({ sessionId, state, percent, correctCount, totalCount, missedItemIds, itemVerdicts }) {
    const [worksheet, evidence] = await Promise.all([
      this.#worksheets?.findBySession?.(sessionId) ?? null,
      this.#reviews?.listForSession?.(sessionId) ?? [],
    ]);
    const roster = worksheet?.itemIds?.length
      ? worksheet.itemIds
      : evidence.map((item) => item.itemId).filter(Boolean);
    if (!roster.length) {
      // Legacy sessions have no immutable item snapshot. Their only honest
      // correction surface is the historical percent/count override.
      return { percent, correctCount, totalCount, missedItemIds, itemVerdicts };
    }
    if (!Array.isArray(itemVerdicts)) throw new ValidationError('itemVerdicts are required when the printed question snapshot exists');
    const supplied = new Map(itemVerdicts.map((entry) => [entry?.itemId, entry]));
    const machine = new Map(evidence.map((item) => [item.itemId, item.verdict === 'correct']));
    const normalized = roster.map((itemId) => {
      const entry = supplied.get(itemId);
      if (!entry) throw new ValidationError(`a verdict is required for printed item ${itemId}`);
      const verdict = entry.verdict ?? (typeof entry.correct === 'boolean' ? (entry.correct ? 'correct' : 'incorrect') : null);
      if (!['unchanged', 'correct', 'incorrect'].includes(verdict)) {
        throw new ValidationError(`item ${itemId} verdict must be unchanged, correct, or incorrect`);
      }
      const correct = verdict === 'unchanged'
        ? (machine.has(itemId) ? machine.get(itemId) : !state.machineGrade.missedItemIds.includes(itemId))
        : verdict === 'correct';
      return { itemId, correct, verdict };
    });
    const derivedCorrect = normalized.filter((entry) => entry.correct).length;
    return {
      percent: Math.round((derivedCorrect / roster.length) * 10000) / 100,
      correctCount: derivedCorrect,
      totalCount: roster.length,
      missedItemIds: normalized.filter((entry) => !entry.correct).map((entry) => entry.itemId),
      itemVerdicts: normalized,
    };
  }
}

export class RetractSessionGradeAdjustment {
  #sessions; #teacherGate; #clock; #logger; #rewardReconciler; #receiptIssuer;

  constructor({ sessions, teacherGate, clock = () => new Date(), logger = console,
    curriculum = null, economy = null, economyEnabled = false, receiptIssuer = null } = {}) {
    if (!sessions) throw new Error('RetractSessionGradeAdjustment requires sessions');
    if (!teacherGate) throw new Error('RetractSessionGradeAdjustment requires teacherGate');
    this.#sessions = sessions;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#logger = logger;
    this.#rewardReconciler = new AdjustSessionGrade({ sessions, teacherGate, clock, logger,
      curriculum, economy, economyEnabled });
    this.#receiptIssuer = receiptIssuer;
  }

  async execute({ sessionId, adjustmentId, reason, retractedBy = null, pin = null, baseSeq, apply = false } = {}) {
    this.#teacherGate.assert({ userId: retractedBy, pin,
      action: apply === true ? 'sessions.grade-adjustment.retract' : 'sessions.grade-adjustment.retract-preview',
      context: { sessionId, adjustmentId } });
    if (!text(sessionId) || !text(adjustmentId)) throw new ValidationError('sessionId and adjustmentId are required');
    if (!text(reason)) throw new ValidationError('a reason is required to retract a grade correction');
    const events = await this.#sessions.readEvents(sessionId);
    if (!events.length) throw new EntityNotFoundError('session', sessionId);
    const currentSeq = lastSeq(events);
    const state = reduceSession(events);
    const target = state.gradeAdjustments.find((row) => row.adjustmentId === adjustmentId);
    if (!target) throw new EntityNotFoundError('grade adjustment', adjustmentId);
    if (target.retracted) {
      const prior = [...events].reverse().find((event) => event?.type === 'grade_adjustment_retracted'
        && event.adjustmentId === adjustmentId);
      if (prior?.reason !== reason.trim() || prior?.retractedBy !== retractedBy) {
        throw new DomainInvariantError(`adjustment ${adjustmentId} was already retracted by another request`, {
          code: 'IDEMPOTENCY_CONFLICT',
        });
      }
      const reconciliation = apply === true
        ? await this.#rewardReconciler.reconcileReward({ sessionId, events, before: state, after: state,
          sourceAdjustmentId: adjustmentId, reconciliationId: `grade-adjustment-retraction:${adjustmentId}` })
        : await this.#rewardReconciler.previewReward(state, state);
      return { schema: 'school.grade-adjustment-retraction-receipt/v1', applied: true,
        idempotent: true, sessionId, adjustmentId, baseSeq: currentSeq, effectiveGrade: gradeOf(state),
        outcome: state.outcome, rewardReconciliation: reconciliation };
    }
    if (baseSeq !== undefined && baseSeq !== currentSeq) {
      throw new DomainInvariantError(`session ${sessionId} changed after this preview`, { code: 'STALE_SAVE' });
    }
    const built = createEvent({ type: 'grade_adjustment_retracted', at: this.#clock().toISOString(), sessionId,
      adjustmentId, reason: reason.trim(), retractedBy, baseSeq: currentSeq, seq: currentSeq + 1 });
    if (built.errors.length) throw new ValidationError(built.errors.join('; '));
    const preview = reduceSession([...events, built.event]);
    let reconciliation = await this.#rewardReconciler.previewReward(state, preview);
    if (apply === true) {
      await this.#sessions.appendEvent(sessionId, built.event, { expectedSeq: currentSeq });
      reconciliation = await this.#rewardReconciler.reconcileReward({ sessionId,
        events: [...events, built.event], before: state, after: preview,
        sourceAdjustmentId: adjustmentId, reconciliationId: `grade-adjustment-retraction:${adjustmentId}` });
      this.#logger.info?.('school.session.grade-adjustment-retracted', { sessionId, adjustmentId, retractedBy });
    }
    const receiptArtifact = apply === true
      ? await this.#receiptIssuer?.execute?.({ sessionId, correctionId: `retraction-${adjustmentId}`, reason: reason.trim() }) : null;
    return { schema: 'school.grade-adjustment-retraction-receipt/v1', applied: apply === true,
      idempotent: false, sessionId, adjustmentId, baseSeq: currentSeq,
      previousEffectiveGrade: gradeOf(state), effectiveGrade: gradeOf(preview), outcome: preview.outcome,
      rewardChanged: reconciliation?.delta !== 0, rewardReconciliation: reconciliation, receiptArtifact };
  }
}

function gradeOf(state) {
  return {
    percent: state.gradedPercent,
    passingPercent: state.gradedPassingPercent,
    correctCount: state.gradedCorrectCount,
    totalCount: state.gradedTotalCount,
    missedItemIds: state.missedItemIds,
  };
}

export default AdjustSessionGrade;
