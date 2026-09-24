/**
 * Retry Image Detection Use Case
 * @module nutribot/usecases/RetryImageDetection
 *
 * Handles the 'ir' retry callback emitted by a failed LogFoodFromImage.
 * Reads retry state from conversationStateStore, cleans up the stale
 * error-caption photo, and re-invokes LogFoodFromImage with the stored
 * imageData.
 */

export class RetryImageDetection {
  #conversationStateStore;
  #logFoodFromImage;
  #messagingGateway;
  #logger;

  constructor(deps) {
    if (!deps.conversationStateStore) throw new Error('conversationStateStore is required');
    if (!deps.logFoodFromImage) throw new Error('logFoodFromImage is required');

    this.#conversationStateStore = deps.conversationStateStore;
    this.#logFoodFromImage = deps.logFoodFromImage;
    this.#messagingGateway = deps.messagingGateway;
    this.#logger = deps.logger || console;
  }

  async execute({ userId, conversationId, messageId = null, responseContext }) {
    // Current: the retry lives in the failed photo's own session. Legacy: the
    // root flow (written before sessions were used; still honoured).
    const session = messageId ? await this.#conversationStateStore.get(conversationId, String(messageId)) : null;
    const fromSession = session?.activeFlow === 'image_retry';
    const state = fromSession ? session : await this.#conversationStateStore.get(conversationId);
    const flowState = state?.flowState;

    if (state?.activeFlow !== 'image_retry' || !flowState?.imageData?.fileId) {
      this.#logger.info?.('retryImage.stale', { conversationId, hasState: !!state });
      const staleMessage = '🚫 This retry is no longer available.';
      if (responseContext?.sendMessage) {
        await responseContext.sendMessage(staleMessage);
      } else if (this.#messagingGateway?.sendMessage) {
        await this.#messagingGateway.sendMessage(conversationId, staleMessage);
      }
      return { success: false, error: 'stale' };
    }

    const { imageData, retryMessageId } = flowState;

    try {
      // Consume only this retry; clearing the root would end an open revision.
      if (fromSession) await this.#conversationStateStore.set(conversationId, { consumedAt: new Date().toISOString() }, String(messageId));
      else await this.#conversationStateStore.clear(conversationId);
    } catch (e) {
      this.#logger.warn?.('retryImage.clearState.failed', { conversationId, error: e.message });
      // Continue — the new LogFoodFromImage flow will overwrite state anyway
    }

    if (retryMessageId) {
      try {
        if (responseContext?.deleteMessage) {
          await responseContext.deleteMessage(retryMessageId);
        } else if (this.#messagingGateway?.deleteMessage) {
          await this.#messagingGateway.deleteMessage(conversationId, retryMessageId);
        }
      } catch (e) {
        this.#logger.debug?.('retryImage.deleteOldPhoto.failed', { error: e.message });
      }
    }

    this.#logger.info?.('retryImage.dispatch', { conversationId, fileId: imageData.fileId });

    return await this.#logFoodFromImage.execute({
      userId,
      conversationId,
      imageData,
      messageId: null,
      responseContext,
    });
  }
}

export default RetryImageDetection;
