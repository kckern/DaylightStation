//
// 'sd' callback handler: resolve a pending scale entry by tapping a density level.
// calories = round(netGrams × kcal_per_g), and — Task 5.5 — fat/carb/protein grams
// derived from the SAME density row via the domain's `computeNutrition`. Then show
// Accept/Revise/Discard.
//
// ## Macros land on the item's existing protein/carbs/fat fields (Task 5.5)
//
// Before this task `computeNutrition` (`#domains/nutrition/services/ScanNutritionService`)
// had no production caller: this handler re-implemented only the calorie half of its
// arithmetic inline (`grams * kcal_per_g`) and left every scan-enriched entry
// macro-less. This is the SAME computation `ObservationPairingService.recomputeEntry`
// already uses for a re-pair — both now call `computeNutrition` with a net weight and a
// resolved density level, and both round the returned grams to one decimal
// (`round1`) so the two paths cannot drift apart the way `computeNutrition`'s own
// arithmetic and this handler's hand-rolled calorie line already had.
//
// `microsSource` is written `null` explicitly (not left to whatever `item0` already
// held): a density-derived estimate is percent-of-calories arithmetic over a
// hand-authored table, not AI or catalog micronutrient data, and `'ai'`/`'catalog'`
// are the only other values that field may legitimately hold.
import { densityForLevel } from '../lib/scaleNutribotConfig.mjs';
import { ApplicationError } from '#apps/common/errors/index.mjs';
import { serializeFoodItem } from '../nutriLogRecords.mjs';
import { computeNutrition } from '#domains/nutrition/index.mjs';

/** One decimal, and never `NaN`/`Infinity` — matches `ObservationPairingService.round1`
 *  exactly, so a commit and a later re-pair of the same placement produce the same
 *  stored numbers. */
function round1(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : 0;
}

export class SelectScaleDensity {
  #receipts; #foodLogStore; #conversationStateStore; #scaleConfig; #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    this.#receipts = deps.receipts || (() => null);
    this.#foodLogStore = deps.foodLogStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#scaleConfig = deps.scaleConfig;
    this.#logger = deps.logger || console;
  }

  async execute(input) {
    const { userId, conversationId, logUuid, level, messageId, responseContext } = input;

    const lvl = densityForLevel(this.#scaleConfig, level);
    if (!lvl) throw scaleError('unknown level', 'UNKNOWN_LEVEL', { level });

    const nutriLog = await this.#foodLogStore.findByUuid(logUuid, userId);
    if (!nutriLog || !nutriLog.items?.length) throw scaleError('log not found', 'LOG_NOT_FOUND', { logUuid });
    if (nutriLog.status !== 'pending') throw scaleError('already processed', 'ALREADY_PROCESSED', { logUuid });

    const item0 = serializeFoodItem(nutriLog.items[0]);
    const grams = Math.round(Number(item0.grams));

    // SINGLE SOURCE for calories AND macros — the domain's `computeNutrition`, the same
    // function `ObservationPairingService.recomputeEntry` calls for a re-pair. `calories`
    // here is identical to the pre-Task-5.5 `Math.round(grams * lvl.kcal_per_g)` (macro
    // grams are derived from that same rounded figure), so history already committed
    // under the old arithmetic does not shift.
    const nutrition = computeNutrition(grams, lvl);
    const { calories } = nutrition;

    const updatedItem = {
      ...item0,
      label: lvl.label,
      calories,
      protein: round1(nutrition.protein_g),
      carbs: round1(nutrition.carb_g),
      fat: round1(nutrition.fat_g),
      fiber: round1(nutrition.fiber_g),
      sugar: round1(nutrition.sugar_g),
      sodium: round1(nutrition.sodium_mg),
      // Never inherited from item0: a density estimate is not micronutrient data.
      microsSource: null,
    };
    const updatedLog = nutriLog.with({
      items: [updatedItem],
      metadata: { ...nutriLog.metadata, densityLevel: lvl.level },
    }, new Date());
    await this.#foodLogStore.save(updatedLog);

    if (this.#conversationStateStore) {
      try { await this.#conversationStateStore.clear(conversationId); } catch (e) { this.#logger.debug?.('selectDensity.clearFailed', { error: e.message }); }
    }

    await this.#receipts()?.refresh(userId, logUuid, { ready: true });

    this.#logger.info?.('selectDensity.done', { logUuid, grams, level: lvl.level, calories });
    return { success: true, calories };
  }
}

function scaleError(message, reason, details) {
  return new ApplicationError(message, { code: `NUTRIBOT_SCALE_${reason}`, ...details });
}

export default SelectScaleDensity;
