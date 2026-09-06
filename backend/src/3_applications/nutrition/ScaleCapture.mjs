import { createNutriLog } from '#apps/nutribot/nutriLogRecords.mjs';
import { resolveScaleNet } from '#apps/nutribot/usecases/LogFoodFromScale.mjs';
import { densityForLevel } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';
import { provisionalReview } from '#shared/contracts/nutrition/reviewLifecycle.mjs';
import { sha256Text } from '#system/utils/sha256.mjs';

/** One scale placement owns one capture ID. No messaging lies on the save path. */
export class ScaleCapture {
  constructor({ foodLogs, review, config, userId, conversationId, timezone, clock, logger }) {
    Object.assign(this, { foodLogs, review, config, userId, conversationId, timezone, clock, logger });
  }
  async reconcile(placement, snapshot) {
    if (!(snapshot.grams > 0) || snapshot.unit !== 'g') return { status: 'incomplete', reason: 'non-gram-or-missing-weight' };
    const level = densityForLevel(this.config, snapshot.density);
    const net = resolveScaleNet({ gross: snapshot.grams, composition: snapshot }, this.config.containers);
    const invalidTare = net.refused || net.unknownId || net.error;
    const complete = !!level && !invalidTare;
    const evidence = { source: 'scale', placementId: placement.id, observationIds: snapshot.observationIds,
      grossGrams: snapshot.grams, tareGrams: net.tared ? net.container.grams : snapshot.container === 'none' ? 0 : null,
      weightBasis: net.tared || snapshot.container === 'none' ? 'net' : 'gross-assumed-net',
      kcalPer100g: level ? level.kcal_per_g * 100 : null,
      assumptions: [...(!snapshot.container ? ['Container tare unknown; reading provisionally treated as net.'] : []),
        ...(invalidTare ? ['Scanned tare could not be applied.'] : [])] };
    const changes = { label: level?.label || 'Weighed food', grams: net.net, amount: net.net, unit: 'g',
      calories: complete ? Math.round(net.net * level.kcal_per_g) : null,
      // Density alone does not tell us a food's macro or micronutrient makeup.
      protein: null, carbs: null, fat: null, fiber: null, sugar: null, sodium: null, cholesterol: null,
      captureEvidence: evidence,
      nutrientProvenance: { calories: { source: 'scale-density', at: new Date(this.clock.now()).toISOString(), grams: net.net } } };
    const metadata = { source: 'scale', scaleId: placement.scaleId, placementId: placement.id,
      grossGrams: snapshot.grams, densityLevel: snapshot.density, captureEvidence: evidence };
    const fingerprint = sha256Text(JSON.stringify({ ...changes, nutrientProvenance: undefined, metadata }));
    // Provenance time belongs to the evidence, so a retry hashes identically.
    changes.nutrientProvenance.calories.at = snapshot.lastInputAt || placement.startedAt;
    let log = await this.foodLogs.findById(this.userId, placement.id);
    if (!log) {
      log = createNutriLog({ userId: this.userId, conversationId: this.conversationId,
        items: [{ ...changes, icon: 'default', color: 'yellow',
          ...provisionalReview({}, placement.startedAt, 'scale') }], metadata,
        timezone: this.timezone, timestamp: new Date(placement.startedAt) }, { newId: () => placement.id });
      await this.foodLogs.save(log);
    }
    const result = await this.review.reconcileCapture({ userId: this.userId, logUuid: placement.id,
      changes, metadata, complete, operationId: `scale:${placement.id}:${fingerprint}` });
    this.logger?.info?.('nutrition.scale.projected', { placementId: placement.id, complete, grams: net.net, calories: changes.calories });
    return { ...result, complete, logUuid: placement.id };
  }
  async discard(placement) {
    const log = await this.foodLogs.findById(this.userId, placement.id);
    if (log) await this.review.execute({ userId: this.userId, logUuid: placement.id, action: 'discard', operationId: `clear:${placement.id}` });
  }
}
