/**
 * ReplaceRemediation — teacher-authorized correction of an unworked retry.
 *
 * A course repair may land after a retry sheet was already issued. Rewinding
 * that session would rewrite what the child received, so replacement creates
 * a new sibling, updates the failed attempt's active remediation link, and
 * abandons the obsolete sibling. Every artifact and event remains intact.
 */
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { createEvent, reduceSession, statesAccepting } from '#domains/school/sessions/sessionEvents.mjs';
import { shortId } from '#system/utils/id.mjs';

const REPLACEABLE_STATES = new Set(['created', 'issued', 'reprinted']);

export class ReplaceRemediation {
  #curriculum; #sessions; #teacherGate; #clock; #newSessionId; #logger;

  constructor({
    curriculum, sessions, teacherGate,
    clock = () => new Date(), newSessionId = () => `ses_${shortId(8)}`, logger = console,
  } = {}) {
    if (!curriculum || !sessions || !teacherGate) {
      throw new Error('ReplaceRemediation requires curriculum, sessions and teacherGate');
    }
    this.#curriculum = curriculum;
    this.#sessions = sessions;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#newSessionId = newSessionId;
    this.#logger = logger;
  }

  async execute({
    sessionId, currentSessionId, reason, replacedBy = null, pin = null, idempotencyKey,
  } = {}) {
    this.#teacherGate.assert({
      userId: replacedBy, pin, action: 'sessions.remediation.replace',
      context: { sessionId, currentSessionId },
    });
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new ValidationError('a reason is required to replace a remediation attempt');
    }
    if (typeof replacedBy !== 'string' || !replacedBy.trim()) {
      throw new ValidationError('replacedBy is required to replace a remediation attempt');
    }
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
      throw new ValidationError('idempotencyKey is required to replace a remediation attempt');
    }

    const parent = await this.#state(sessionId);
    if (!parent.sessionId) throw new EntityNotFoundError('session', sessionId);

    const prior = parent.remediationHistory.find((entry) => (
      entry.kind === 'replaced' && entry.replacementKey === idempotencyKey.trim()
    ));
    if (prior) {
      if (prior.previousSessionId !== currentSessionId) {
        throw new ValidationError('that idempotencyKey already replaced a different remediation session');
      }
      await this.#abandonIfNeeded({
        sessionId: prior.previousSessionId,
        reason: `replaced by ${prior.newSessionId}: ${prior.reason}`,
        replacedBy: prior.replacedBy,
      });
      return {
        status: 'already_replaced', sessionId, previousSessionId: prior.previousSessionId,
        newSessionId: prior.newSessionId, variant: prior.variant,
      };
    }

    if (parent.state !== 'remediation_opened' || parent.remediation?.newSessionId !== currentSessionId) {
      throw new ValidationError(`session ${currentSessionId} is not the active remediation for ${sessionId}`);
    }
    const current = await this.#state(currentSessionId);
    if (!current.sessionId) throw new EntityNotFoundError('session', currentSessionId);
    if (current.remediationOf !== sessionId || current.learnerId !== parent.learnerId
        || current.unitId !== parent.unitId) {
      throw new ValidationError('the remediation session does not belong to that failed attempt');
    }
    if (!REPLACEABLE_STATES.has(current.state) || current.attemptIds.length
        || current.machineGrade || current.outcome || current.transport) {
      throw new ValidationError(
        `session ${currentSessionId} already has learner evidence or is ${current.state}; it cannot be replaced`,
      );
    }

    const unit = await this.#curriculum.getUnit(parent.unitId);
    const variants = Math.max(1, unit?.retry?.variants ?? 1);
    const variant = (current.variant + 1) % variants;
    const key = idempotencyKey.trim();
    const nowIso = this.#clock().toISOString();

    // Recovery for a crash after the sibling was created but before the
    // parent's active link was updated: find the created event by its durable
    // request key and continue instead of minting another sibling.
    let newSessionId = await this.#findCreatedReplacement({
      learnerId: parent.learnerId, sessionId, currentSessionId, replacementKey: key,
    });
    if (!newSessionId) {
      newSessionId = this.#newSessionId();
      const created = createEvent({
        type: 'created', at: nowIso, sessionId: newSessionId,
        learnerId: parent.learnerId, unitId: parent.unitId,
        remediationOf: sessionId,
        remediationItemIds: current.remediationItemIds.length
          ? current.remediationItemIds : parent.missedItemIds,
        variant, openedBy: replacedBy.trim(),
        replacementKey: key, replacesSessionId: currentSessionId,
      });
      if (created.errors.length) {
        throw new Error(`ReplaceRemediation: could not create replacement: ${created.errors.join('; ')}`);
      }
      await this.#sessions.appendEvent(newSessionId, created.event);
    }

    const linked = createEvent({
      type: 'remediation_replaced', at: nowIso, sessionId,
      previousSessionId: currentSessionId, newSessionId, variant,
      replacementKey: key, reason: reason.trim(), replacedBy: replacedBy.trim(),
    });
    if (linked.errors.length) {
      throw new Error(`ReplaceRemediation: could not link replacement: ${linked.errors.join('; ')}`);
    }
    await this.#sessions.appendEvent(sessionId, linked.event);

    await this.#abandonIfNeeded({
      sessionId: currentSessionId,
      reason: `replaced by ${newSessionId}: ${reason.trim()}`,
      replacedBy: replacedBy.trim(),
    });

    this.#logger.info?.('school.remediation.replaced', {
      sessionId, previousSessionId: currentSessionId, newSessionId,
      learnerId: parent.learnerId, unitId: parent.unitId, variant,
      replacementKey: key, replacedBy: replacedBy.trim(), reason: reason.trim(),
    });
    return {
      status: 'replaced', sessionId, previousSessionId: currentSessionId, newSessionId, variant,
    };
  }

  async #state(sessionId) {
    return reduceSession(await this.#sessions.readEvents(sessionId));
  }

  async #findCreatedReplacement({ learnerId, sessionId, currentSessionId, replacementKey }) {
    const rows = await this.#sessions.listForLearner(learnerId);
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop
      const events = await this.#sessions.readEvents(row.sessionId);
      const created = events.find((event) => event.type === 'created');
      if (created?.replacementKey === replacementKey && created.remediationOf === sessionId
          && created.replacesSessionId === currentSessionId) {
        const state = reduceSession(events);
        if (!state.terminal) return row.sessionId;
      }
    }
    return null;
  }

  async #abandonIfNeeded({ sessionId, reason, replacedBy }) {
    const state = await this.#state(sessionId);
    if (state.state === 'abandoned') return;
    if (!statesAccepting('abandoned').has(state.state) || state.attemptIds.length) {
      throw new ValidationError(`session ${sessionId} changed while it was being replaced; it was not abandoned`);
    }
    const event = createEvent({
      type: 'abandoned', at: this.#clock().toISOString(), sessionId,
      reason, decidedBy: replacedBy,
    });
    if (event.errors.length) throw new Error(`ReplaceRemediation: could not abandon old retry: ${event.errors.join('; ')}`);
    await this.#sessions.appendEvent(sessionId, event.event);
  }
}

export default ReplaceRemediation;
