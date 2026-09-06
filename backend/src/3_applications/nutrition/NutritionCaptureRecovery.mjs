import moment from 'moment-timezone';
import { sha256Text } from '#system/utils/sha256.mjs';
import { nutritionLookupFor } from '#shared/contracts/nutrition/nutritionLookup.mjs';
import { provisionalReview } from '#shared/contracts/nutrition/reviewLifecycle.mjs';
import { serializeFoodItem } from '#shared/contracts/nutrition/foodItemRecord.mjs';
import { densityForLevel } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

const fail = message => { throw Object.assign(new Error(message), { status: 409 }); };

/** Operator-selected recovery, not a bulk migration or a model mutation tool.
 * Original capture/item IDs remain authoritative. Dry run does not write. */
export class NutritionCaptureRecovery {
  constructor({ review, observations, scaleConfig, items }) { Object.assign(this, { review, observations, scaleConfig, items }); }
  async recover({ userId, logUuid, expectedVersion, operationId, observationIds = [], dryRun = true }) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(operationId || '') || !expectedVersion || !logUuid
      || typeof dryRun !== 'boolean' || !Array.isArray(observationIds) || observationIds.length > 3
      || new Set(observationIds).size !== observationIds.length) fail('Invalid recovery request');
    const fingerprint = sha256Text(JSON.stringify({ logUuid, expectedVersion, observationIds }));
    const result = await this.review.restoreCapture({ userId, logUuid, expectedVersion, operationId, fingerprint, dryRun,
      prepare: async log => {
        if (log.items.length !== 1) fail('Recovery requires one unambiguous captured food');
        const item = log.items[0];
        const startedAt = moment.tz(log.createdAt, log.timezone).valueOf();
        if (!Number.isFinite(startedAt)) fail('Capture time is unavailable');
        const upc = log.metadata.sourceUpc || log.metadata.upc;
        let patch, evidence;
        if (upc) {
          if (observationIds.length) fail('Separate UPC food cannot inherit a scale placement');
          const lookup = nutritionLookupFor(log);
          const unknown = !lookup || lookup.source === 'legacy-barcode'
            ? ['fiber', 'sugar', 'sodium', 'cholesterol'] : lookup.missing || [];
          patch = { ...Object.fromEntries(unknown.map(field => [field, null])), icon: 'default',
            amount: item.grams > 0 ? item.grams : item.unit === 'ml' ? item.amount : 1,
            unit: item.grams > 0 ? 'g' : item.unit === 'ml' ? 'ml' : 'serving' };
          evidence = { source: 'upc', upc, assumption: 'one-serving', recoveredFrom: log.id };
        } else if (log.metadata.source === 'scale') {
          const records = observationIds.map(id => this.observations.get(userId, id));
          if (records.length !== 2 || records.some(row => !row || row.scaleId !== log.metadata.scaleId
            || (row.pairedEntryUuid && row.pairedEntryUuid !== item.uuid))) fail('Select the original unclaimed weight and density observations');
          const weight = records.find(row => row.kind === 'weight');
          const density = records.find(row => row.kind === 'density');
          const times = records.map(row => moment.tz(row.at, log.timezone).valueOf());
          if (!weight || !density || weight.unit !== 'g' || !(weight.value > 0) || weight.value !== log.metadata.grossGrams
            || times.some(time => !Number.isFinite(time) || Math.abs(time - startedAt) > 15 * 60000)) fail('Observations do not match this capture');
          const level = densityForLevel(this.scaleConfig(), density.value);
          if (!level) fail('Density is unavailable');
          patch = { label: level.label || 'Mixed food', amount: weight.value, grams: weight.value, unit: 'g',
            calories: Math.round(weight.value * level.kcal_per_g),
            protein: null, carbs: null, fat: null, fiber: null, sugar: null, sodium: null, cholesterol: null };
          evidence = { source: 'scale', recoveredFrom: log.id, observationIds,
            grossGrams: weight.value, tareGrams: null, weightBasis: 'gross-assumed-net', kcalPer100g: level.kcal_per_g * 100,
            assumptions: ['Container tare unknown; reading provisionally treated as net.'] };
        } else fail('No recoverable barcode or scale evidence');
        const recovered = item.with({ ...patch, captureEvidence: evidence,
          ...provisionalReview(serializeFoodItem(item), startedAt, evidence.source) });
        return { items: [recovered], metadata: { captureEvidence: evidence } };
      },
    });
    if (!dryRun && observationIds.length) {
      const entry = result.receipt.after[0];
      if (!await this.items.findByUuid(userId, entry.uuid)) fail('Recovered entry was removed; refusing observation links');
      // Resume a link-write failure with the same receipt and original food IDs.
      this.observations.updateMany(userId, observationIds.map(id => ({ id, status: 'consumed', pairedEntryUuid: entry.uuid })));
    }
    return result;
  }
}
