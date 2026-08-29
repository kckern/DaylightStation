/** Reconciles Fitness-owned attempt facts into School's work-session ledger. */
import { createEvent, reduceSession } from '#domains/school/sessions/sessionEvents.mjs';

export class FitnessSchoolAssessmentBridge {
  #realtime; #sessions; #curriculum; #close; #evidence; #clock; #logger; #unsubscribers = [];
  constructor({ realtime, sessions, curriculum, closeSessionOutcome, evidenceRepository = null,
    clock = () => new Date(), logger = console } = {}) {
    if (!realtime?.onFitnessActivityAccepted || !realtime?.onFitnessActivityAssessed || !sessions || !curriculum || !closeSessionOutcome) {
      throw new Error('FitnessSchoolAssessmentBridge requires realtime, sessions, curriculum and closeSessionOutcome');
    }
    this.#realtime = realtime; this.#sessions = sessions; this.#curriculum = curriculum;
    this.#close = closeSessionOutcome; this.#evidence = evidenceRepository; this.#clock = clock; this.#logger = logger;
  }

  start() {
    if (this.#unsubscribers.length) return;
    this.#unsubscribers.push(
      this.#realtime.onFitnessActivityAccepted((payload) => this.#accepted(payload).catch((error) => this.#failed('accepted', payload, error))),
      this.#realtime.onFitnessActivityAssessed((payload) => this.#assessed(payload).catch((error) => this.#failed('assessed', payload, error))),
    );
  }
  stop() { this.#unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.()); }

  async #accepted(payload) {
    const checked = await this.#check(payload);
    if (!checked || checked.state.state !== 'created') return;
    const built = createEvent({
      type: 'external_activity_dispatched', at: payload.acceptedAt ?? this.#clock().toISOString(),
      sessionId: payload.workSessionId, provider: payload.provider,
      attemptId: payload.workSessionId, courseRevision: payload.courseRevision,
      policyRevision: payload.policyRevision,
    });
    if (built.errors.length) throw new Error(built.errors.join('; '));
    await this.#sessions.appendEvent(payload.workSessionId, built.event);
    this.#logger.info?.('school.external-activity.dispatched', { sessionId: payload.workSessionId, learnerId: payload.learnerId });
  }

  async #assessed(payload) {
    const checked = await this.#check(payload);
    if (!checked || checked.state.outcome) return;
    if (checked.state.state === 'created') await this.#accepted({ ...payload, acceptedAt: payload.assessedAt });
    const current = reduceSession(await this.#sessions.readEvents(payload.workSessionId));
    if (current.state !== 'external_activity_dispatched') return;
    const built = createEvent({
      type: 'external_activity_assessed', at: payload.assessedAt ?? this.#clock().toISOString(),
      sessionId: payload.workSessionId, provider: payload.provider,
      assessmentId: payload.assessmentId, courseRevision: payload.courseRevision,
      policyRevision: payload.policyRevision, result: payload.result, measures: payload.observations,
    });
    if (built.errors.length) throw new Error(built.errors.join('; '));
    await this.#sessions.appendEvent(payload.workSessionId, built.event);
    await this.#recordEvidence(payload, checked.unit);
    await this.#close.execute({ sessionId: payload.workSessionId });
    this.#logger.info?.('school.external-activity.assessed', {
      sessionId: payload.workSessionId, learnerId: payload.learnerId,
      assessmentId: payload.assessmentId, result: payload.result,
    });
  }

  async #check(payload) {
    if (!payload?.workSessionId || payload.provider !== 'fitness') return null;
    const state = reduceSession(await this.#sessions.readEvents(payload.workSessionId));
    if (!state.sessionId || state.learnerId !== payload.learnerId || state.unitId !== payload.unitId) return null;
    const unit = await this.#curriculum.getUnit(state.unitId);
    const activity = unit?.activity;
    if (activity?.provider !== 'fitness'
      || activity.courseRevision !== payload.courseRevision
      || activity.policyRevision !== payload.policyRevision) {
      this.#logger.warn?.('school.external-activity.revision-mismatch', { sessionId: payload.workSessionId });
      return null;
    }
    return { state, unit };
  }

  async #recordEvidence(payload, unit) {
    if (!this.#evidence?.appendEvidence) return;
    await this.#evidence.appendEvidence({
      schema: 'school.learning-evidence/v1', evidenceId: payload.assessmentId,
      learnerId: payload.learnerId, occurredAt: payload.assessedAt,
      verification: 'verified',
      activity: { id: payload.assessmentId, kind: 'fitness_activity', assessmentId: payload.assessmentId,
        graded: true, action: 'complete' },
      learning: { subjectId: unit.subject, courseId: unit.courseId, unitId: unit.module, lessonId: unit.unitId },
      measures: payload.observations ?? { engagements: 1 },
      source: { surface: 'garage-fitness', transport: 'external-assessment' },
    });
  }
  #failed(stage, payload, error) {
    this.#logger.warn?.('school.external-activity.bridge-failed', { stage, sessionId: payload?.workSessionId, error: error.message });
  }
}

export default FitnessSchoolAssessmentBridge;
