/** Identify provider webhooks and coordinate enrichment/coaching side effects. */
export class FitnessWebhookService {
  constructor({ providerWebhookAdapters = {}, enrichmentService = null, shouldSendExerciseReaction = () => false, getCoachingOrchestrator = () => null, getCoachingConversationId = () => null, logger = console }) {
    this.adapters = providerWebhookAdapters;
    this.enrichmentService = enrichmentService;
    this.shouldSendExerciseReaction = shouldSendExerciseReaction;
    this.getCoachingOrchestrator = getCoachingOrchestrator;
    this.getCoachingConversationId = getCoachingConversationId;
    this.logger = logger;
  }

  adapterCount() { return Object.keys(this.adapters).length; }

  challenge({ query, method = 'GET' }) {
    const request = { method, query };
    for (const adapter of Object.values(this.adapters)) {
      if (adapter.identify?.(request) === 'challenge') {
        const result = adapter.handleChallenge(query);
        return result.ok
          ? { kind: 'accepted', challenge: result.response }
          : {
              kind: 'rejected',
              category: result.reason === 'token-mismatch' ? 'authorization' : 'input',
              reason: result.reason,
            };
      }
    }
    return { kind: 'unrecognized' };
  }

  event({ payload, method = 'POST' }) {
    const request = { method, body: payload };
    for (const [name, adapter] of Object.entries(this.adapters)) {
      if (adapter.identify?.(request) !== 'event') continue;
      const event = adapter.parseEvent(payload);
      if (!event) {
        this.logger.warn?.('fitness.provider.webhook.parse_failed', { provider: name });
        return { kind: 'parse_failed' };
      }
      this.logger.info?.('fitness.provider.webhook.identified', {
        provider: name,
        objectType: event.objectType,
        objectId: event.objectId,
        aspectType: event.aspectType,
      });
      const shouldEnrich = adapter.shouldEnrich?.(event);
      if (!shouldEnrich) {
        this.logger.info?.('fitness.provider.webhook.skip_enrich', {
          provider: name,
          objectId: event.objectId,
          reason: `${event.objectType}/${event.aspectType} not enrichable`,
        });
      } else if (!this.enrichmentService) {
        this.logger.warn?.('fitness.provider.webhook.no_enrichment_service', { provider: name, objectId: event.objectId });
      } else {
        this.enrichmentService.handleEvent(event);
      }
      if (shouldEnrich && this.shouldSendExerciseReaction(event)) this.#sendReaction(event);
      return { kind: 'accepted' };
    }
    this.logger.warn?.('fitness.provider.webhook.unknown', { bodyKeys: Object.keys(payload || {}) });
    return { kind: 'unknown' };
  }

  #sendReaction(event) {
    const orchestrator = this.getCoachingOrchestrator();
    const conversationId = this.getCoachingConversationId() || null;
    if (!orchestrator || !conversationId) return;
    orchestrator.sendExerciseReaction({
      userId: event.ownerId,
      conversationId,
      activity: {
        type: event.type || 'Workout',
        durationMin: Math.round((event.duration || 0) / 60),
        caloriesBurned: event.calories || 0,
      },
    }).catch((error) => this.logger.warn?.('strava.exerciseReaction.error', { error: error.message }));
  }
}

export default FitnessWebhookService;
