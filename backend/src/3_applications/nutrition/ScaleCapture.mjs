import { createNutriLog } from '#apps/nutribot/nutriLogRecords.mjs';
import { resolveScaleNet } from '#apps/nutribot/usecases/LogFoodFromScale.mjs';
import { densityForLevel } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';
import { computeNutrition } from '#domains/nutrition/index.mjs';
import { provisionalReview } from '#shared/contracts/nutrition/reviewLifecycle.mjs';
import { sha256Text } from '#system/utils/sha256.mjs';

/** One decimal, and never `NaN`/`Infinity` — matches `ObservationPairingService.round1`
 *  and `SelectScaleDensity.round1` exactly, so an automatic capture, a Telegram
 *  density button and a later re-pair of the same placement all store the same
 *  numbers. This path used to store none of them at all. */
function round1(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : 0;
}

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
    // NOBODY NAMED A CONTAINER and the reading is heavy enough that one is
    // plausible. The gross may be hiding a vessel's tare, so the entry is HELD
    // (see `heldForReview`) rather than left to settle itself — a 398 g bowl of
    // level-5 food billed 756 kcal when ~200 g of it was the bowl, and nothing on
    // the record said so louder than an assumption string nobody reads. Below the
    // threshold a vessel is unlikely enough that assume-net still stands.
    const thresholdG = Number(this.config?.containers?.thresholdG);
    const tareUnknown = snapshot.container == null
      && Number.isFinite(thresholdG) && snapshot.grams >= thresholdG;
    // `complete` still means "write it to the ledger": an entry withheld from the
    // ledger never appears on the day at all (`readNutritionDay` reads accepted
    // entries), so gating THIS on the tare would drop the food rather than hold
    // it. The hold rides on `tareUnknown` in the evidence instead, where
    // `heldForReview` stops the 72-hour clock from settling a guess — visible,
    // estimated, and permanently unconfirmed until a person says otherwise.
    const complete = !!level && !invalidTare;
    let nutrition = null;
    if (complete) {
      // A density row with no (or a malformed) `macros` block costs the SPLIT and
      // nothing else — calories fall back to the bare `kcal_per_g` arithmetic this
      // path has always used. `ObservationPairingService.recomputeEntry` degrades
      // the same way, for the same reason: a config typo must not silently delete
      // the calories off a real measurement.
      try { nutrition = computeNutrition(net.net, level); } catch (error) {
        this.logger?.warn?.('nutrition.scale.macros_skipped',
          { placementId: placement.id, level: snapshot.density, error: error.message });
      }
    }
    const evidence = { source: 'scale', placementId: placement.id, observationIds: snapshot.observationIds,
      grossGrams: snapshot.grams, tareGrams: net.tared ? net.container.grams : snapshot.container === 'none' ? 0 : null,
      weightBasis: net.tared || snapshot.container === 'none' ? 'net' : 'gross-assumed-net',
      kcalPer100g: level ? level.kcal_per_g * 100 : null, tareUnknown,
      assumptions: [...(!snapshot.container ? [tareUnknown
        ? `Container tare unknown above ${thresholdG} g; treated as net and held for confirmation.`
        : 'Container tare unknown; reading provisionally treated as net.'] : []),
      ...(invalidTare ? ['Scanned tare could not be applied.'] : [])] };
    const changes = { label: level?.label || 'Weighed food', grams: net.net, amount: net.net, unit: 'g',
      // The density row's own artwork. Only sent when there IS one: the log is
      // created on whichever evidence lands first, so a weight-then-density order
      // used to leave the icon at 'default' forever with nothing to update it.
      ...(level?.ui_icon ? { icon: level.ui_icon } : {}),
      calories: complete ? (nutrition ? nutrition.calories : Math.round(net.net * level.kcal_per_g)) : null,
      // Density gives a macro SPLIT (percent of calories, from the config table's
      // `macros`), which is what this path threw away for a year while the two
      // other paths that apply the same table kept it. It still gives no
      // micronutrient data, so `microsSource` stays null and cholesterol unknown.
      protein: nutrition ? round1(nutrition.protein_g) : null,
      carbs: nutrition ? round1(nutrition.carb_g) : null,
      fat: nutrition ? round1(nutrition.fat_g) : null,
      fiber: nutrition ? round1(nutrition.fiber_g) : null,
      sugar: nutrition ? round1(nutrition.sugar_g) : null,
      sodium: nutrition ? round1(nutrition.sodium_mg) : null,
      cholesterol: null, microsSource: null,
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
        items: [{ ...changes, icon: level?.ui_icon || 'default', color: 'yellow',
          ...provisionalReview({}, placement.startedAt, 'scale') }], metadata,
        timezone: this.timezone, timestamp: new Date(placement.startedAt) }, { newId: () => placement.id });
      await this.foodLogs.save(log);
    }
    const result = await this.review.reconcileCapture({ userId: this.userId, logUuid: placement.id,
      changes, metadata, complete, operationId: `scale:${placement.id}:${fingerprint}` });
    this.logger?.info?.('nutrition.scale.projected', { placementId: placement.id, complete, grams: net.net,
      calories: changes.calories, tareUnknown, icon: changes.icon ?? null });
    return { ...result, complete, logUuid: placement.id };
  }
  async discard(placement) {
    const log = await this.foodLogs.findById(this.userId, placement.id);
    if (log) await this.review.execute({ userId: this.userId, logUuid: placement.id, action: 'discard', operationId: `clear:${placement.id}` });
  }
}
