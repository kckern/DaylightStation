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
  #sessions; #teacherGate; #clock; #logger;

  constructor({ sessions, teacherGate, clock = () => new Date(), logger = console } = {}) {
    if (!sessions) throw new Error('AdjustSessionGrade requires sessions');
    if (!teacherGate) throw new Error('AdjustSessionGrade requires teacherGate');
    this.#sessions = sessions;
    this.#teacherGate = teacherGate;
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
    const id = text(adjustmentId) ?? stableAdjustmentId({
      sessionId, baseSeq: baseSeq ?? currentSeq, adjustedBy, reason: reason.trim(), percent, correctCount, totalCount,
      missedItemIds, itemVerdicts,
    });
    const prior = events.find((event) => event?.type === 'grade_adjusted' && event.adjustmentId === id);
    if (prior) {
      const sameRequest = JSON.stringify({
        adjustedBy: prior.adjustedBy, reason: prior.reason, percent: prior.percent,
        correctCount: prior.correctCount, totalCount: prior.totalCount,
        missedItemIds: prior.missedItemIds, itemVerdicts: prior.itemVerdicts,
      }) === JSON.stringify({ adjustedBy, reason: reason.trim(), percent, correctCount, totalCount,
        missedItemIds, itemVerdicts });
      if (!sameRequest) throw new DomainInvariantError(`adjustment id ${id} was already used for another correction`, {
        code: 'IDEMPOTENCY_CONFLICT',
      });
      const effective = reduceSession(events);
      return { schema: 'school.grade-adjustment-receipt/v1', applied: true, idempotent: true,
        sessionId, adjustmentId: id, baseSeq: currentSeq, machineGrade: effective.machineGrade,
        effectiveGrade: gradeOf(effective), outcome: effective.outcome };
    }
    if (baseSeq !== undefined && baseSeq !== currentSeq) {
      throw new DomainInvariantError(`session ${sessionId} changed after this preview`, {
        code: 'STALE_SAVE', details: { expected: baseSeq, actual: currentSeq },
      });
    }
    const state = reduceSession(events);
    if (!state.machineGrade) throw new ValidationError(`session ${sessionId} has no machine grade to correct`);

    const built = createEvent({
      type: 'grade_adjusted', at: this.#clock().toISOString(), sessionId,
      adjustmentId: id, percent, correctCount, totalCount, missedItemIds, itemVerdicts,
      reason: reason.trim(), adjustedBy, baseSeq: currentSeq, seq: currentSeq + 1,
    });
    if (built.errors.length) throw new ValidationError(built.errors.join('; '));
    const preview = reduceSession([...events, built.event]);
    if (preview.errors.length > state.errors.length) {
      throw new DomainInvariantError(`grade correction is not valid: ${preview.errors.at(-1)}`, { code: 'GRADE_ADJUSTMENT_INVALID' });
    }
    if (apply === true) {
      await this.#sessions.appendEvent(sessionId, built.event, { expectedSeq: currentSeq });
      this.#logger.info?.('school.session.grade-adjusted', {
        sessionId, adjustmentId: id, adjustedBy, from: state.gradedPercent, to: preview.gradedPercent,
      });
    }
    return {
      schema: 'school.grade-adjustment-receipt/v1', applied: apply === true, idempotent: false,
      sessionId, adjustmentId: id, baseSeq: currentSeq,
      machineGrade: preview.machineGrade, previousEffectiveGrade: gradeOf(state),
      effectiveGrade: gradeOf(preview), previousOutcome: state.outcome, outcome: preview.outcome,
      rewardChanged: false,
    };
  }
}

export class RetractSessionGradeAdjustment {
  #sessions; #teacherGate; #clock; #logger;

  constructor({ sessions, teacherGate, clock = () => new Date(), logger = console } = {}) {
    if (!sessions) throw new Error('RetractSessionGradeAdjustment requires sessions');
    if (!teacherGate) throw new Error('RetractSessionGradeAdjustment requires teacherGate');
    this.#sessions = sessions;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#logger = logger;
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
      return { schema: 'school.grade-adjustment-retraction-receipt/v1', applied: true,
        idempotent: true, sessionId, adjustmentId, baseSeq: currentSeq, effectiveGrade: gradeOf(state), outcome: state.outcome };
    }
    if (baseSeq !== undefined && baseSeq !== currentSeq) {
      throw new DomainInvariantError(`session ${sessionId} changed after this preview`, { code: 'STALE_SAVE' });
    }
    const built = createEvent({ type: 'grade_adjustment_retracted', at: this.#clock().toISOString(), sessionId,
      adjustmentId, reason: reason.trim(), retractedBy, baseSeq: currentSeq, seq: currentSeq + 1 });
    if (built.errors.length) throw new ValidationError(built.errors.join('; '));
    const preview = reduceSession([...events, built.event]);
    if (apply === true) {
      await this.#sessions.appendEvent(sessionId, built.event, { expectedSeq: currentSeq });
      this.#logger.info?.('school.session.grade-adjustment-retracted', { sessionId, adjustmentId, retractedBy });
    }
    return { schema: 'school.grade-adjustment-retraction-receipt/v1', applied: apply === true,
      idempotent: false, sessionId, adjustmentId, baseSeq: currentSeq,
      previousEffectiveGrade: gradeOf(state), effectiveGrade: gradeOf(preview), outcome: preview.outcome };
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
