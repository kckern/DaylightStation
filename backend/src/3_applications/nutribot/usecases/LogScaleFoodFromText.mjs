// Describe path for a pending scale entry. The grams are EXACT (from a scale), so the
// AI's only job is to estimate the dish's blended caloric density (kcal/g) + macros/g.
// No portion guessing, no portionBoost — that is the whole point of the scale.

import { buildConfirmButtons } from '../lib/scaleNutribotConfig.mjs';

export class LogScaleFoodFromText {
  #messagingGateway; #aiGateway; #foodLogStore; #conversationStateStore; #logger; #encodeCallback;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.aiGateway) throw new Error('aiGateway is required');
    this.#messagingGateway = deps.messagingGateway;
    this.#aiGateway = deps.aiGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#logger = deps.logger || console;
    this.#encodeCallback = deps.encodeCallback || ((cmd, data) => JSON.stringify({ cmd, ...data }));
  }

  #getMessaging(responseContext, conversationId) {
    if (responseContext) return responseContext;
    return { updateMessage: (msgId, updates) => this.#messagingGateway.updateMessage(conversationId, msgId, updates) };
  }

  #buildPrompt(grams, text) {
    return [
      {
        role: 'system',
        content: `You estimate caloric density. The user weighed food on a kitchen scale, so the gram weight is EXACT — do NOT estimate quantity. Given a description, estimate the whole dish as ONE item and return its BLENDED caloric density (kcal per gram) plus macro grams-per-gram. Density must be between 0.1 and 9.0 (pure fat ≈ 9). Respond ONLY as JSON:
{"label": "<short name>", "density_kcal_per_g": <number>, "protein_per_g": <number>, "carbs_per_g": <number>, "fat_per_g": <number>}`,
      },
      { role: 'user', content: `${grams} g of: ${text}` },
    ];
  }

  #parse(response) {
    const match = response && response.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const p = JSON.parse(match[0]);
      const density = Number(p.density_kcal_per_g);
      if (!Number.isFinite(density)) return null;
      return {
        label: p.label || 'Food',
        density: Math.min(9, Math.max(0.1, density)),
        proteinPerG: Number(p.protein_per_g) || 0,
        carbsPerG: Number(p.carbs_per_g) || 0,
        fatPerG: Number(p.fat_per_g) || 0,
      };
    } catch { return null; }
  }

  async execute(input) {
    const { userId, conversationId, logUuid, text, messageId, responseContext } = input;
    const messaging = this.#getMessaging(responseContext, conversationId);

    const nutriLog = await this.#foodLogStore.findByUuid(logUuid, userId);
    if (!nutriLog || !nutriLog.items?.length) return { success: false, error: 'log not found' };
    if (nutriLog.status !== 'pending') return { success: false, error: 'already processed' };

    const item0 = typeof nutriLog.items[0].toJSON === 'function' ? nutriLog.items[0].toJSON() : { ...nutriLog.items[0] };
    const grams = Math.round(Number(item0.grams));

    const response = await this.#aiGateway.chat(this.#buildPrompt(grams, text), { maxTokens: 300 });
    const est = this.#parse(response);
    if (!est) {
      this.#logger.warn?.('logScaleText.parseFailed', { logUuid, response: response?.slice?.(0, 200) });
      return { success: false, error: 'could not estimate' };
    }

    const round1 = (n) => Math.round(n * 10) / 10;
    const calories = Math.round(grams * est.density);
    const updatedItem = {
      ...item0, label: est.label, calories,
      protein: round1(grams * est.proteinPerG),
      carbs: round1(grams * est.carbsPerG),
      fat: round1(grams * est.fatPerG),
    };
    const updatedLog = nutriLog.with({
      items: [updatedItem],
      metadata: { ...nutriLog.metadata, densityEstimated: est.density, describedAs: text },
    }, new Date());
    await this.#foodLogStore.save(updatedLog);

    if (this.#conversationStateStore) {
      try { await this.#conversationStateStore.clear(conversationId); } catch (e) { this.#logger.debug?.('logScaleText.clearFailed', { error: e.message }); }
    }

    const t = `⚖️ ${grams} g · ${est.label}\n🔥 ~${calories} kcal · P${updatedItem.protein} C${updatedItem.carbs} F${updatedItem.fat}`;
    const choices = buildConfirmButtons(this.#encodeCallback, logUuid);
    if (messageId) {
      try { await messaging.updateMessage(messageId, { text: t, choices, inline: true }); }
      catch (e) { this.#logger.warn?.('logScaleText.updateFailed', { error: e.message }); }
    }

    this.#logger.info?.('logScaleText.done', { logUuid, grams, density: est.density, calories });
    return { success: true, calories };
  }
}

export default LogScaleFoodFromText;
