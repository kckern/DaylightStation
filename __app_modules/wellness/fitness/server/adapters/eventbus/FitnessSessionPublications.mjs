export const FITNESS_SESSION_ENDED_TOPIC = 'fitness.session.ended';

/**
 * A workout ended: `{ sessionId, learnerIds, endMs, finalized }`. Internal bus
 * topic (publish only, no WebSocket): the economy settles ring payouts from it.
 */
export class FitnessSessionPublications {
  constructor({ eventBus }) { this.eventBus = eventBus; }
  ended(payload) { return this.eventBus?.publish?.(FITNESS_SESSION_ENDED_TOPIC, payload); }
}

export default FitnessSessionPublications;
