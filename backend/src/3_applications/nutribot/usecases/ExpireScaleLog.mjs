//
// Auto-expire an unanswered scale prompt. The bridge arms a timer per prompt; on fire it
// calls this. If the log is still untouched (the user never engaged), we reject it and
// delete the message — a phantom (e.g. the scale's shelf/idle load) nobody logged. If the
// user has engaged (picked a container/density), we leave it entirely alone.

export class ExpireScaleLog {
  #messagingGateway; #foodLogStore; #conversationStateStore; #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    this.#messagingGateway = deps.messagingGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#logger = deps.logger || console;
  }

  #isUntouched(log) {
    return !!log
      && log.status === 'pending'
      && log.metadata?.source === 'scale'
      && log.metadata?.containerId == null
      && log.metadata?.densityLevel == null;
  }

  async execute(input) {
    const { userId, conversationId, logUuid, messageId } = input;
    const log = await this.#foodLogStore.findByUuid(logUuid, userId);
    if (!this.#isUntouched(log)) return { success: true, expired: false };

    await this.#foodLogStore.updateStatus(userId, logUuid, 'rejected');

    if (this.#conversationStateStore) {
      try {
        const st = await this.#conversationStateStore.get?.(conversationId);
        if (st?.flowState?.pendingLogUuid === logUuid) await this.#conversationStateStore.clear(conversationId);
      } catch (e) { this.#logger.debug?.('scaleExpire.clearFailed', { error: e.message }); }
    }

    if (messageId) {
      try { await this.#messagingGateway.deleteMessage(conversationId, messageId); } catch (e) { this.#logger.debug?.('scaleExpire.deleteFailed', { error: e.message }); }
    }

    this.#logger.info?.('scaleExpire.done', { conversationId, logUuid });
    return { success: true, expired: true };
  }
}

export default ExpireScaleLog;
