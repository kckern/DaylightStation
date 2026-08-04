import { normalizeFollowUpAction } from '#domains/school/progress/index.mjs';

/**
 * Project durable offered/active remediation sessions into the generic School
 * follow-up language. The target remains a session ID; surfaces decide how to
 * transport the interaction and never receive the private tutor context.
 */
export class AdaptiveRemediationFollowUpSource {
  #sessions;

  constructor({ sessions } = {}) {
    if (!sessions || typeof sessions.listAvailable !== 'function') {
      throw new Error('AdaptiveRemediationFollowUpSource requires sessions');
    }
    this.#sessions = sessions;
  }

  async listFollowUps({ scope, deliveryContext = {} } = {}) {
    if (!scope || !Array.isArray(scope.learnerIds) || scope.learnerIds.length === 0) {
      throw new Error('Adaptive remediation follow-ups require a resolved learner scope');
    }
    const learnerIds = new Set(scope.learnerIds);
    const { surface, endpointId = null } = deliveryContext;
    if (typeof surface !== 'string' || !surface) return [];
    const sessions = await this.#sessions.listAvailable({
      surface, endpointId, learnerIds: [...learnerIds],
    });
    return sessions
      .filter((session) => learnerIds.has(session.learnerId))
      .map((session) => validatedAction({
        actionId: `remediation:${session.sessionId}`,
        learnerId: session.learnerId,
        kind: 'remediation',
        label: session.status === 'active' ? 'Continue tutoring' : 'Get tutor help',
        // A web request is itself current transport evidence. Low-bandwidth
        // clients still require their relay before this action is executable.
        availability: surface === 'web' ? 'ready' : 'requires_connection',
        target: { type: 'remediation_session', id: session.sessionId },
        reason: session.status === 'active'
          ? 'An adaptive remediation conversation is in progress'
          : `A ${session.initialScorePercent}% assessment opened adaptive remediation`,
        priority: session.status === 'active' ? 5 : 10,
      }))
      .sort((left, right) => left.priority - right.priority
        || left.actionId.localeCompare(right.actionId));
  }
}

function validatedAction(raw) {
  const result = normalizeFollowUpAction(raw);
  if (result.errors.length) {
    throw new Error(`Adaptive remediation follow-up is invalid: ${result.errors.join('; ')}`);
  }
  return result.action;
}

export default AdaptiveRemediationFollowUpSource;
