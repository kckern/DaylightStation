import { serializeFoodItem } from '../../../../health/server/nutrition-records.mjs';
import { pickMicros } from '../../../../health/server/nutrition-capture-values.mjs';

// FoodItem supplies display defaults when hydrating. Retain exactly which
// nutrient values the parser supplied, including an explicitly reported zero.
export function captureCatalogMicros(items) {
  return Object.fromEntries(items.map(item => [item.id, pickMicros(item)]));
}

export async function finishQuickInputEnrichment(log, catalogService, foodLogStore, logger) {
  const items = log.items.map(serializeFoodItem);
  const densityFindings = await enrichFoodCapture(log, items, catalogService, logger);
  const enriched = log.with({ metadata: {
    ...log.metadata, densityFindings, quickInput: { ...log.metadata.quickInput, enriched: true },
  } }, new Date());
  await foodLogStore.save(enriched);
  return enriched;
}

export async function enrichFoodCapture(log, foodItems, catalogService, logger, userId = log.userId) {
  const { conversationId } = log;
  // 5a-bis. Density guard (catalog-density fix, step 2). Runs BEFORE the
  // catalog donation below, because a donation adds this very row to the
  // history the guard compares against — judging a row against a median it
  // has already moved is not a check. It never corrects a number: the row
  // is logged exactly as parsed and lands UNSETTLED like every capture
  // (NutribotInputRouter stamps `settled: false`), so a flagged item simply
  // arrives on the pending-review surface with a reason attached.
  let densityFindings = [];
  if (catalogService?.assessDensity) {
    try {
      const findings = await catalogService.assessDensity(foodItems, userId);
      densityFindings = findings;
      if (findings.length) logger.info?.('nutribot.density.findings', { logId: log.id, findings });
    } catch (err) {
      logger.warn?.('nutribot.density.assess_failed', { conversationId, error: err.message });
    }
  }

  // 5b. Record food items in catalog for quick-add
  if (catalogService) {
    for (const item of foodItems) {
      try {
        await catalogService.recordUsage({
          foodId: item.foodId,
          name: item.label,
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
          // The MASS, and the id that makes this row's observation
          // idempotent. Without these the catalog can only remember a
          // total, which is the portion-multiple problem it just stopped
          // having.
          grams: item.grams,
          unit: item.unit,
          amount: item.amount,
          logId: item.id,
          // Spread, not four named fields: an unanswered micro is ABSENT
          // on `item` (see the mapper), and naming it here would
          // resurrect it as `undefined` -> a donated structural zero.
          ...(log.metadata.quickInput
            ? log.metadata.quickInput.catalogMicros?.[item.id] || {}
            : pickMicros(item)),
          ...(log.metadata.quickInput && { quickInputUsageId: item.id }),
          // Only a provenanced row donates its micros at all —
          // see FoodCatalogService.recordUsage.
          microsSource: item.microsSource,
          source: 'nutritionix',
        }, userId);
      } catch (err) {
        logger.warn?.('nutribot.catalog.record_failed', { name: item.label, error: err.message });
        if (log.metadata.quickInput) throw err;
      }
    }
  }
  return densityFindings;
}
