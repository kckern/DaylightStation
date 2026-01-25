/**
 * Handle Review Command Use Case
 * @module nutribot/usecases/HandleReviewCommand
 *
 * Starts the adjustment/review flow.
 */

/**
 * Handle review command use case
 */
export class HandleReviewCommand {
  #startAdjustmentFlow;
  #logger;

  constructor(deps) {
    if (!deps.startAdjustmentFlow) throw new Error('startAdjustmentFlow is required');
    this.#startAdjustmentFlow = deps.startAdjustmentFlow;
    this.#logger = deps.logger || console;
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {Object} [input.responseContext] - Bound response context for DDD-compliant messaging
   */
  async execute(input) {
    const { userId, conversationId, responseContext } = input;

    this.#logger.debug?.('command.review', { userId, hasResponseContext: !!responseContext });

    // Delegate to StartAdjustmentFlow
    return this.#startAdjustmentFlow.execute({ userId, conversationId, responseContext });
  }
}

export default HandleReviewCommand;
