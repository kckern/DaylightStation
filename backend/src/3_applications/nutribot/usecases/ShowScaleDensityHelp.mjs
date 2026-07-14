//
// 'sh' callback handler: toggle the density prompt between the slim grams line and the
// full legend (label · kcal/g · examples). Pure presentation — never mutates the log.
// The Help/Back button state is carried in the callback (h:1 = show, h:0 = back).

import { buildDensityKeyboard, densityPromptText, densityHelpText } from '../lib/scaleNutribotConfig.mjs';

export class ShowScaleDensityHelp {
  #messagingGateway; #foodLogStore; #scaleConfig; #logger; #encodeCallback;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    this.#messagingGateway = deps.messagingGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#scaleConfig = deps.scaleConfig;
    this.#logger = deps.logger || console;
    this.#encodeCallback = deps.encodeCallback || ((cmd, data) => JSON.stringify({ cmd, ...data }));
  }

  #getMessaging(responseContext, conversationId) {
    if (responseContext) return responseContext;
    return { updateMessage: (msgId, updates) => this.#messagingGateway.updateMessage(conversationId, msgId, updates) };
  }

  async execute(input) {
    const { userId, conversationId, logUuid, showHelp, messageId, responseContext } = input;
    if (!messageId) return { success: false, error: 'no message' };
    const messaging = this.#getMessaging(responseContext, conversationId);

    const log = await this.#foodLogStore.findByUuid(logUuid, userId);
    if (!log || !log.items?.length) return { success: false, error: 'log not found' };
    const item0 = typeof log.items[0].toJSON === 'function' ? log.items[0].toJSON() : { ...log.items[0] };
    const grams = Math.round(Number(item0.grams));

    const text = showHelp ? densityHelpText(this.#scaleConfig, grams) : densityPromptText(grams);
    const choices = buildDensityKeyboard(this.#scaleConfig, this.#encodeCallback, logUuid, { showingHelp: showHelp });
    try {
      await messaging.updateMessage(messageId, { text, choices, inline: true });
    } catch (e) {
      this.#logger.warn?.('scaleHelp.updateFailed', { error: e.message });
    }

    return { success: true, showHelp: !!showHelp };
  }
}

export default ShowScaleDensityHelp;
