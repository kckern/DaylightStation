//
// Bridge-invoked entry point: a settled scale weight becomes (or updates) a pending
// NutriLog + a slim Telegram density prompt. Always density-first; the container picker
// is a button on the prompt, not a leading question. No responseContext (not a
// user-initiated event) — uses the raw messagingGateway.
//
// Create-or-edit: when the bridge passes existingLogUuid + messageId and that log is an
// untouched pending scale log, we edit the grams in place instead of posting a new
// message. If it's already touched/gone/non-pending, we no-op (the bridge's committed
// flag owns that case) — posting a fresh prompt would duplicate.

import { NutriLog } from '#domains/nutrition/entities/NutriLog.mjs';
import { buildDensityKeyboard, densityPromptText } from '../lib/scaleNutribotConfig.mjs';

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

  #isUntouched(log) {
    return !!log
      && log.status === 'pending'
      && log.metadata?.source === 'scale'
      && log.metadata?.containerId == null
      && log.metadata?.densityLevel == null;
  }

  async execute(input) {
    const { userId, conversationId, grams, unit, scaleId, existingLogUuid, messageId } = input;
    const gross = Math.round(Number(grams));
    if (!Number.isFinite(gross) || gross <= 0) {
      this.#logger.warn?.('logScale.badGrams', { scaleId, grams });
      return { success: false, error: 'bad grams' };
    }

    const cfg = this.#scaleConfig;

    // Edit-in-place: an untouched pending scale prompt exists → update its grams only.
    if (existingLogUuid && messageId) {
      const existing = await this.#foodLogStore.findByUuid(existingLogUuid, userId);
      if (this.#isUntouched(existing)) {
        const item0 = typeof existing.items[0].toJSON === 'function' ? existing.items[0].toJSON() : { ...existing.items[0] };
        const updated = existing.with({
          items: [{ ...item0, grams: gross }],
          metadata: { ...existing.metadata, grossGrams: gross },
        }, new Date());
        await this.#foodLogStore.save(updated);
        const choices = buildDensityKeyboard(cfg, this.#encodeCallback, existingLogUuid);
        try {
          await this.#messagingGateway.updateMessage(conversationId, messageId, { text: densityPromptText(gross), choices, inline: true });
        } catch (e) {
          this.#logger.warn?.('logScale.editFailed', { error: e.message });
        }
        this.#logger.info?.('logScale.edited', { conversationId, logUuid: existingLogUuid, gross });
        return { success: true, logUuid: existingLogUuid, messageId: String(messageId), stage: 'density', edited: true };
      }
      // Touched / missing / non-pending: the user owns it now. The bridge's committed
      // flag handles the still-loaded food; posting a fresh prompt would duplicate. No-op.
      return { success: true, logUuid: existingLogUuid, edited: false, touched: true };
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

    const text = densityPromptText(gross);
    const choices = buildDensityKeyboard(cfg, this.#encodeCallback, nutriLog.id);
    if (this.#conversationStateStore) {
      await this.#conversationStateStore.set(conversationId, {
        conversationId,
        activeFlow: 'scale_describe',
        flowState: { pendingLogUuid: nutriLog.id },
      });
    }

    const sent = await this.#messagingGateway.sendMessage(conversationId, text, { choices, inline: true });
    const newMessageId = sent?.messageId;
    if (newMessageId) {
      await this.#foodLogStore.save(nutriLog.with({ metadata: { ...nutriLog.metadata, messageId: String(newMessageId) } }, new Date()));
    }

    this.#logger.info?.('logScale.posted', { conversationId, logUuid: nutriLog.id, gross, stage: 'density' });
    return { success: true, logUuid: nutriLog.id, messageId: newMessageId ? String(newMessageId) : null, stage: 'density', edited: undefined };
  }
}

export default LogFoodFromScale;
