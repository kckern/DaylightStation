/**
 * NearestIconChooser — picks the nearest existing icon for a food name.
 *
 * A typed decision model answers first: one choice over the whole icon
 * vocabulary, with a calibrated confidence. When that confidence clears the
 * floor the pick stands; otherwise (or when no decision model is configured,
 * or it fails) the caller's LLM fallback decides. Either way the decision
 * model's candidate is logged, so its agreement with the fallback can be
 * measured before the floor is moved.
 *
 * The vocabulary may be any size; provider option caps are the decision
 * adapter's concern.
 */

import { choice } from '#apps/common/ports/IDecisionGateway.mjs';

const DEFAULT_CONFIDENCE_FLOOR = 0.5;

const INSTRUCTIONS = 'Which icon picture is the nearest match for `food`? There may be no exact match: '
  + 'choose the closest picture of the same kind of food or drink. Icon names describe the picture.';

export class NearestIconChooser {
  #decisionGateway; #confidenceFloor; #logger;

  /**
   * @param {Object} deps
   * @param {Object} [deps.decisionGateway] - IDecisionGateway
   * @param {number} [deps.confidenceFloor=0.5] - Minimum confidence to accept the decision model's pick
   * @param {Object} [deps.logger]
   */
  constructor({ decisionGateway = null, confidenceFloor = DEFAULT_CONFIDENCE_FLOOR, logger = console } = {}) {
    this.#decisionGateway = decisionGateway?.isConfigured?.() === false ? null : decisionGateway;
    this.#confidenceFloor = confidenceFloor;
    this.#logger = logger;
  }

  get hasDecisionModel() { return !!this.#decisionGateway; }

  /**
   * @param {Object} params
   * @param {string} params.name - Food name
   * @param {Object} [params.detail] - Extra context (brand, calories, …) shown to the model
   * @param {Iterable<string>} params.vocabulary - Icon slugs to choose from
   * @param {Function} [params.fallback] - `async () => slug|null`, the LLM pick
   * @param {string} [params.source] - Caller label for logs
   * @returns {Promise<{ icon: string|null, via: 'jev'|'fallback'|null, confidence: number|null }>}
   */
  async choose({ name, detail = {}, vocabulary, fallback = null, source = null }) {
    const slugs = [...new Set(vocabulary)].filter(Boolean);
    const allowed = new Set(slugs);
    let candidate = null;
    let reason = 'no-decision-model';

    if (this.#decisionGateway && slugs.length >= 2) {
      try {
        const result = await this.#decisionGateway.evaluate({ food: name, ...detail }, { icon: choice(INSTRUCTIONS, slugs) });
        const answer = result.answers.icon;
        candidate = { icon: allowed.has(answer.choice) ? answer.choice : null, confidence: answer.confidence ?? null, model: result.model };
        reason = !candidate.icon ? 'outside-vocabulary'
          : candidate.confidence >= this.#confidenceFloor ? null : 'low-confidence';
      } catch (error) {
        reason = 'decision-failed';
        this.#logger.warn?.('nutrition.icon.decision_failed', { source, name, error: error.message });
      }
    }

    if (!reason) {
      this.#logger.info?.('nutrition.icon.pick', { source, name, via: 'jev', icon: candidate.icon,
        confidence: candidate.confidence, model: candidate.model });
      return { icon: candidate.icon, via: 'jev', confidence: candidate.confidence };
    }

    const fallbackIcon = fallback ? await fallback() : null;
    const icon = allowed.has(fallbackIcon) ? fallbackIcon : null;
    this.#logger.info?.('nutrition.icon.pick', { source, name, via: icon ? 'fallback' : null, icon, reason,
      jevIcon: candidate?.icon ?? null, jevConfidence: candidate?.confidence ?? null,
      agreed: candidate?.icon != null && candidate.icon === icon });
    return { icon, via: icon ? 'fallback' : null, confidence: null };
  }
}

export default NearestIconChooser;
