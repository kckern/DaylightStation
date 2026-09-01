import { sha256Text } from '#system/utils/sha256.mjs';
import { ValidationError, EntityNotFoundError, DomainInvariantError } from '#domains/core/errors/index.mjs';
import {
  createAttempt, isAttemptInvalidation,
} from '#domains/school/attempt.mjs';
import { createEvent, reduceSession } from '#domains/school/sessions/sessionEvents.mjs';

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const lastSeq = (events) => events.reduce((max, event) => Math.max(max, Number(event?.seq) || 0), 0);

function stableInvalidationId({ sessionId, baseSeq, invalidatedBy, reason, attemptIds }) {
  return `inv_${sha256Text(JSON.stringify({
    sessionId, baseSeq, invalidatedBy, reason, attemptIds,
  })).slice(0, 16)}`;
}

function tombstoneFor(attempt, { invalidationId, invalidatedBy, reason, invalidatedAt }) {
  return createAttempt({
    ...attempt,
    id: `att_inv_${sha256Text(`${invalidationId}:${attempt.id}`).slice(0, 16)}`,
    // File the tombstone beside the work it invalidates. A historical report
    // reads bounded day shards, so filing this on today's admin date would let
    // the bad row reappear whenever the report's range excluded today.
    at: attempt.at,
    processedAt: invalidatedAt,
    provenance: {
      kind: 'invalidation', of: attempt.id, invalidationId,
      by: invalidatedBy, reason, invalidatedAt,
      source: attempt.provenance ?? null,
    },
  });
}

/** Append-only removal of a misattributed machine scan from effective learning evidence. */
export class InvalidateSessionEvidence {
  #sessions; #datastore; #teacherGate; #clock; #logger; #trustedAuthority;

  constructor({
    sessions, datastore, teacherGate, trustedAuthority = null,
    clock = () => new Date(), logger = console,
  } = {}) {
    if (!sessions || !datastore || !teacherGate) {
      throw new Error('InvalidateSessionEvidence requires sessions, datastore, and teacherGate');
    }
    this.#sessions = sessions;
    this.#datastore = datastore;
    this.#teacherGate = teacherGate;
    this.#trustedAuthority = trustedAuthority;
    this.#clock = clock;
    this.#logger = logger;
  }

  async execute({
    sessionId, reason, invalidatedBy = null, pin = null, baseSeq,
    invalidationId = null, apply = false,
  } = {}, { authority = null } = {}) {
    const trusted = this.#trustedAuthority !== null && authority === this.#trustedAuthority;
    if (!trusted) {
      this.#teacherGate.assert({
        userId: invalidatedBy, pin,
        action: apply ? 'sessions.evidence-invalidate' : 'sessions.evidence-invalidate.preview',
        context: { sessionId },
      });
    }
    if (!text(sessionId)) throw new ValidationError('sessionId is required');
    if (!text(reason)) throw new ValidationError('a reason is required to invalidate evidence');
    if (!text(invalidatedBy)) throw new ValidationError('invalidatedBy is required');

    const events = await this.#sessions.readEvents(sessionId);
    if (!events.length) throw new EntityNotFoundError('session', sessionId);
    const state = reduceSession(events);
    if (!state.machineGrade) throw new ValidationError(`session ${sessionId} has no machine grade to invalidate`);
    const currentSeq = lastSeq(events);
    const rawAttempts = this.#datastore.readAllAttempts(state.learnerId) ?? [];
    const attempts = rawAttempts.filter((attempt) => (
      attempt.sessionId === sessionId && !isAttemptInvalidation(attempt)
    ));
    if (!attempts.length) throw new ValidationError(`session ${sessionId} has no attempt evidence to invalidate`);
    const attemptIds = attempts.map((attempt) => attempt.id).sort();
    const id = text(invalidationId) ?? stableInvalidationId({
      sessionId, baseSeq: baseSeq ?? currentSeq, invalidatedBy: invalidatedBy.trim(),
      reason: reason.trim(), attemptIds,
    });
    const prior = events.find((event) => event.type === 'evidence_invalidated'
      && event.invalidationId === id);
    if (prior) {
      return {
        schema: 'school.evidence-invalidation-receipt/v1', applied: true, idempotent: true,
        sessionId, invalidationId: id, baseSeq: currentSeq, learnerId: state.learnerId,
        attemptIds: [...prior.attemptIds], effectiveGrade: null, outcome: reduceSession(events).outcome,
      };
    }
    if (events.some((event) => event.type === 'evidence_invalidated')) {
      throw new DomainInvariantError(`session ${sessionId} evidence is already invalidated`, {
        code: 'EVIDENCE_ALREADY_INVALIDATED',
      });
    }
    if (baseSeq !== undefined && baseSeq !== currentSeq) {
      throw new DomainInvariantError(`session ${sessionId} changed after this preview`, {
        code: 'STALE_SAVE', details: { expected: baseSeq, actual: currentSeq },
      });
    }
    const built = createEvent({
      type: 'evidence_invalidated', at: this.#clock().toISOString(), sessionId,
      invalidationId: id, attemptIds, reason: reason.trim(), invalidatedBy: invalidatedBy.trim(),
      baseSeq: currentSeq, seq: currentSeq + 1,
    });
    if (built.errors.length) throw new ValidationError(built.errors.join('; '));
    const preview = reduceSession([...events, built.event]);
    if (preview.errors.length > state.errors.length) {
      throw new DomainInvariantError(`evidence invalidation is not valid: ${preview.errors.at(-1)}`, {
        code: 'EVIDENCE_INVALIDATION_INVALID',
      });
    }

    if (apply) {
      const existingIds = new Set(rawAttempts.map((attempt) => attempt.id));
      for (const attempt of attempts) {
        const tombstone = tombstoneFor(attempt, {
          invalidationId: id, invalidatedBy: invalidatedBy.trim(), reason: reason.trim(),
          invalidatedAt: built.event.at,
        });
        if (!existingIds.has(tombstone.id)) this.#datastore.appendAttempt(state.learnerId, tombstone);
      }
      await this.#sessions.appendEvent(sessionId, built.event, { expectedSeq: currentSeq });
      this.#logger.info?.('school.session.evidence-invalidated', {
        sessionId, learnerId: state.learnerId, invalidationId: id,
        invalidatedBy: invalidatedBy.trim(), attemptCount: attemptIds.length,
      });
    }
    return {
      schema: 'school.evidence-invalidation-receipt/v1', applied: apply, idempotent: false,
      sessionId, invalidationId: id, baseSeq: currentSeq, learnerId: state.learnerId,
      attemptIds, machineGrade: state.machineGrade, effectiveGrade: null, outcome: preview.outcome,
    };
  }
}

export default InvalidateSessionEvidence;
