//
// 'st' callback handler: subtract a known container weight from the gross scale
// reading, then advance to the density stage (edit the message into the density
// keyboard + arm the describe path).

import { resolveScaleNet } from './LogFoodFromScale.mjs';
import {
  buildDensityKeyboard, densityPromptText,
  buildContainerKeyboard, containerPromptText,
} from '../lib/scaleNutribotConfig.mjs';

export class SelectScaleContainer {
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
    if (responseContext) {
      return responseContext;
    }
    return {
      updateMessage: (msgId, updates) => this.#messagingGateway.updateMessage(conversationId, msgId, updates),
    };
  }

  async execute(input) {
    const { userId, conversationId, logUuid, containerId, messageId, responseContext } = input;
    const messaging = this.#getMessaging(responseContext, conversationId);

    const nutriLog = await this.#foodLogStore.findByUuid(logUuid, userId);
    if (!nutriLog || !nutriLog.items?.length) return { success: false, error: 'log not found' };
    if (nutriLog.status !== 'pending') return { success: false, error: 'already processed' };

    const item0 = typeof nutriLog.items[0].toJSON === 'function' ? nutriLog.items[0].toJSON() : { ...nutriLog.items[0] };
    const gross = Math.round(Number(nutriLog.metadata?.grossGrams ?? item0.grams));

    // Show mode: the density keyboard's "📦 On a container?" button routes here with
    // no containerId. Post the container picker (against gross) without subtracting.
    if (containerId === undefined || containerId === null || containerId === '') {
      const choices = buildContainerKeyboard(this.#scaleConfig, this.#encodeCallback, logUuid);
      if (messageId) {
        try { await messaging.updateMessage(messageId, { text: containerPromptText(gross), choices, inline: true }); }
        catch (e) { this.#logger.warn?.('selectContainer.showFailed', { error: e.message }); }
      }
      return { success: true, shown: true };
    }

    // Same resolver as the scan path (LogFoodFromScale), so a button tap and a
    // `ct:` scan can never produce different nets for the same gross + container.
    // It also owns the "tare is not lighter than the reading" refusal this path
    // has always had, so the rule is stated once rather than in two places.
    const r = resolveScaleNet({ gross, composition: { container: containerId } }, this.#scaleConfig.containers);
    let net = gross;
    let containerId2 = null, containerGrams = 0;
    if (r.unknownId) {
      this.#logger.warn?.('selectContainer.unknownContainer', { logUuid, containerId });
    } else if (r.error) {
      this.#logger.warn?.('selectContainer.badContainer', { logUuid, container: r.container?.id, error: r.error.message });
    } else if (r.refused) {
      this.#logger.warn?.('selectContainer.tooHeavy', { logUuid, container: r.container.id, containerGrams: r.container.grams, gross });
    } else if (r.container) {
      net = r.net;
      containerId2 = r.container.id;
      containerGrams = r.container.grams;
    }

    const updatedItem = { ...item0, grams: net };
    const updatedLog = nutriLog.with({
      items: [updatedItem],
      metadata: { ...nutriLog.metadata, containerId: containerId2, containerGrams },
    }, new Date());
    await this.#foodLogStore.save(updatedLog);

    // Advance to density stage (edit the container message in place).
    const choices = buildDensityKeyboard(this.#scaleConfig, this.#encodeCallback, logUuid);
    if (messageId) {
      try {
        await messaging.updateMessage(messageId, { text: densityPromptText(net), choices, inline: true });
      } catch (e) {
        this.#logger.warn?.('selectContainer.updateFailed', { error: e.message });
      }
    }
    if (this.#conversationStateStore) {
      await this.#conversationStateStore.set(conversationId, {
        conversationId, activeFlow: 'scale_describe', flowState: { pendingLogUuid: logUuid },
      });
    }

    this.#logger.info?.('selectContainer.done', { logUuid, gross, net, containerId: containerId2 });
    return { success: true, net };
  }
}

export default SelectScaleContainer;
