//
// Bridge-invoked entry point: a settled scale weight becomes a pending NutriLog and
// a Telegram prompt. No responseContext (not a user-initiated event) — uses the raw
// messagingGateway. Posts the container keyboard first when the gross weight exceeds
// the configured threshold, otherwise the density keyboard.

import { NutriLog } from '#domains/nutrition/entities/NutriLog.mjs';
import {
  buildDensityKeyboard,
  buildContainerKeyboard,
  densityPromptText,
  containerPromptText,
} from '../lib/scaleNutribotConfig.mjs';

export class LogFoodFromScale {
  #messagingGateway; #foodLogStore; #conversationStateStore; #scaleConfig; #config; #logger; #encodeCallback;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    this.#messagingGateway = deps.messagingGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#scaleConfig = deps.scaleConfig;
    this.#config = deps.config;
    this.#logger = deps.logger || console;
    this.#encodeCallback = deps.encodeCallback || ((cmd, data) => JSON.stringify({ cmd, ...data }));
  }

  async execute(input) {
    const { userId, conversationId, grams, unit, scaleId } = input;
    const gross = Math.round(Number(grams));
    if (!Number.isFinite(gross) || gross <= 0) {
      this.#logger.warn?.('logScale.badGrams', { scaleId, grams });
      return { success: false, error: 'bad grams' };
    }

    const timezone = this.#config?.getUserTimezone?.(userId) || 'America/Los_Angeles';
    const nutriLog = NutriLog.create({
      userId,
      conversationId,
      items: [{ label: 'Unknown', grams: gross, calories: 0, unit: unit || 'g', amount: 1, color: 'yellow' }],
      metadata: { source: 'scale', scaleId: scaleId || null, grossGrams: gross },
      timezone,
      timestamp: new Date(),
    });
    await this.#foodLogStore.save(nutriLog);

    const cfg = this.#scaleConfig;
    const useContainer = gross > cfg.containers.thresholdG && cfg.containers.items.length > 0;

    let text, choices, stage;
    if (useContainer) {
      text = containerPromptText(gross);
      choices = buildContainerKeyboard(cfg, this.#encodeCallback, nutriLog.id);
      stage = 'container';
    } else {
      text = densityPromptText(gross);
      choices = buildDensityKeyboard(cfg, this.#encodeCallback, nutriLog.id);
      stage = 'density';
      // Arm the describe path only once grams are final (no container step).
      if (this.#conversationStateStore) {
        await this.#conversationStateStore.set(conversationId, {
          conversationId,
          activeFlow: 'scale_describe',
          flowState: { pendingLogUuid: nutriLog.id },
        });
      }
    }

    const sent = await this.#messagingGateway.sendMessage(conversationId, text, { choices, inline: true });
    const messageId = sent?.messageId;
    if (messageId) {
      await this.#foodLogStore.save(nutriLog.with({ metadata: { ...nutriLog.metadata, messageId: String(messageId) } }, new Date()));
    }

    this.#logger.info?.('logScale.posted', { conversationId, logUuid: nutriLog.id, gross, stage });
    return { success: true, logUuid: nutriLog.id, stage };
  }
}

export default LogFoodFromScale;
