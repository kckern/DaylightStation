//
// Retract an UNANSWERED scale prompt — event-triggered (session-end sweep, forced
// supersede), the successor to the retired timer-based ExpireScaleLog. If the log is
// still untouched (user never engaged), reject it and delete its Telegram message. If
// the user has engaged (picked a container/density), leave it entirely alone.

export class RetractScaleLog {
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
    if (!this.#isUntouched(log)) return { success: true, retracted: false };

    await this.#foodLogStore.updateStatus(userId, logUuid, 'rejected');

    if (this.#conversationStateStore) {
      try {
        const st = await this.#conversationStateStore.get?.(conversationId);
        if (st?.flowState?.pendingLogUuid === logUuid) await this.#conversationStateStore.clear(conversationId);
      } catch (e) { this.#logger.debug?.('scaleRetract.clearFailed', { error: e.message }); }
    }

    if (messageId) {
      try { await this.#messagingGateway.deleteMessage(conversationId, messageId); }
      catch (e) { this.#logger.debug?.('scaleRetract.deleteFailed', { error: e.message }); }
    }

    this.#logger.info?.('scaleRetract.done', { conversationId, logUuid });
    return { success: true, retracted: true };
  }
}

export default RetractScaleLog;
