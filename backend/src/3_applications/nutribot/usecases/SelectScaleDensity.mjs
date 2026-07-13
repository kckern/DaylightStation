//
// 'sd' callback handler: resolve a pending scale entry by tapping a density level.
// calories = round(netGrams × kcal_per_g). Then show Accept/Revise/Discard.

import { densityForLevel, buildConfirmButtons } from '../lib/scaleNutribotConfig.mjs';

export class SelectScaleDensity {
  #messagingGateway; #foodLogStore; #conversationStateStore; #scaleConfig; #logger; #encodeCallback;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    this.#messagingGateway = deps.messagingGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#scaleConfig = deps.scaleConfig;
    this.#logger = deps.logger || console;
    this.#encodeCallback = deps.encodeCallback || ((cmd, data) => JSON.stringify({ cmd, ...data }));
  }

  #getMessaging(responseContext, conversationId) {
    if (responseContext) return responseContext;
    return { updateMessage: (msgId, updates) => this.#messagingGateway.updateMessage(conversationId, msgId, updates) };
  }

  async execute(input) {
    const { userId, conversationId, logUuid, level, messageId, responseContext } = input;
    const messaging = this.#getMessaging(responseContext, conversationId);

    const lvl = densityForLevel(this.#scaleConfig, level);
    if (!lvl) return { success: false, error: 'unknown level' };

    const nutriLog = await this.#foodLogStore.findByUuid(logUuid, userId);
    if (!nutriLog || !nutriLog.items?.length) return { success: false, error: 'log not found' };
    if (nutriLog.status !== 'pending') return { success: false, error: 'already processed' };

    const item0 = typeof nutriLog.items[0].toJSON === 'function' ? nutriLog.items[0].toJSON() : { ...nutriLog.items[0] };
    const grams = Math.round(Number(item0.grams));
    const calories = Math.round(grams * lvl.kcal_per_g);

    const updatedItem = { ...item0, label: lvl.label, calories };
    const updatedLog = nutriLog.with({
      items: [updatedItem],
      metadata: { ...nutriLog.metadata, densityLevel: lvl.level },
    }, new Date());
    await this.#foodLogStore.save(updatedLog);

    if (this.#conversationStateStore) {
      try { await this.#conversationStateStore.clear(conversationId); } catch (e) { this.#logger.debug?.('selectDensity.clearFailed', { error: e.message }); }
    }

    const text = `⚖️ ${grams} g · ${lvl.emoji} ${lvl.label}\n🔥 ~${calories} kcal`;
    const choices = buildConfirmButtons(this.#encodeCallback, logUuid);
    if (messageId) {
      try { await messaging.updateMessage(messageId, { text, choices, inline: true }); }
      catch (e) { this.#logger.warn?.('selectDensity.updateFailed', { error: e.message }); }
    }

    this.#logger.info?.('selectDensity.done', { logUuid, grams, level: lvl.level, calories });
    return { success: true, calories };
  }
}

export default SelectScaleDensity;
