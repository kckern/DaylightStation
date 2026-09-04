/**
 * ObservationPairingService — the HUMAN half of the kitchen-scale ledger.
 *
 * Phase 5 made scale signals durable (`YamlObservationStore`) and matchable
 * (`ObservationMatcher`, `ObservationService`). Everything up to here happens without a
 * person: a weight lands, a composition forms, an entry is committed or the rows lapse.
 * This service is what a PERSON can do to that ledger afterwards, from the day view:
 *
 *  - **read** a day's observations, so "the scale definitely weighed something" stops
 *    being a claim only the log store can confirm;
 *  - **re-pair** one observation to a different food-log entry, recomputing that entry
 *    from the measurement's real values;
 *  - **dismiss** one, so a signal nobody ever finished with stops being pending forever.
 *
 * ## Why dismissal matters more than it looks
 *
 * Nothing in the automatic path resolves a row that aged out of the 900 s window.
 * `endPlacement` / `clear` / `undo` only ever resolve ids that are still inside the live
 * composition. The ordinary kitchen case — a bowl goes on the scale, no density card is
 * ever scanned, the person walks away — therefore leaves a permanently-`open` row, and
 * `YamlObservationStore` never archives an open row at any age. Those rows accumulate in
 * the HOT file, which is on the scale's own frame path (measured: ~297 ms per append at
 * 10 000 open rows, on the single event loop that also serves the Player, Fitness and the
 * school Portal). `dismiss()` is the first thing in the system that can move such a row
 * out of the open population, which also makes it archivable.
 *
 * ## Recompute: the arithmetic is borrowed, never re-implemented
 *
 * Net weight comes from `resolveScaleNet` (`#apps/nutribot/usecases/LogFoodFromScale.mjs`),
 * which is the scale path's SINGLE source for "gross minus tare" and wraps the domain's
 * `computeNet`. Calories/macros come from the domain's `computeNutrition`. Re-pairing
 * therefore produces exactly the numbers the automatic path would have produced from the
 * same evidence — the two cannot drift, because there is one implementation.
 *
 * ## What "the evidence" is
 *
 * An entry's evidence is every observation currently paired to it — an ARRAY, because one
 * placement legitimately leaves several rows: `ObservationService` appends a new weight
 * row per >=5 g change while food is being added to the bowl, plus at most one container
 * row and one density row. The recompute therefore takes the LATEST weight (the one the
 * person settled on), the latest container and the latest density, rather than assuming
 * one row per kind.
 *
 * Calories are recomputed ONLY when a density observation is part of that evidence. With
 * no density there is no measured kcal/g, and inventing one — or scaling whatever the
 * entry already said — would be exactly the confident-looking wrong number this phase
 * exists to eliminate. Grams are still corrected; the calories stay the human's.
 *
 * ## Cross-file batches are REFUSED, not partially applied
 *
 * `updateMany` is atomic within ONE file. `YamlObservationStore` stores a bounded hot file
 * plus monthly archives, and a re-pair is the only operation in the system that can touch
 * both at once (its patches come from `findByPairedEntry`, which reads archives too —
 * unlike the composition consume path, whose patches come from `openForScale` and so are
 * always hot). The store now refuses such a batch outright (`CROSS_FILE_BATCH`) before
 * writing a byte; this service lets that error through so the route can report it. The
 * failure mode is explicit and total: nothing is written, the ledger is exactly as it was,
 * and the person is told to act on one observation at a time.
 *
 * @module nutrition/ObservationPairingService
 */

import { computeNutrition } from '#domains/nutrition/index.mjs';
import { resolveScaleNet } from '#apps/nutribot/usecases/LogFoodFromScale.mjs';
import { densityForLevel } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';
import { ApplicationError } from '#apps/common/errors/index.mjs';

/** The last row of a kind wins: a placement appends a new row per >=5 g change. */
function latestOfKind(observations, kind) {
  let latest = null;
  for (const o of observations) {
    if (o?.kind !== kind) continue;
    if (!latest || String(o.at) >= String(latest.at)) latest = o;
  }
  return latest;
}

/** One decimal, and never `NaN`/`Infinity` — nutrilist rows are read by arithmetic. */
function round1(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : 0;
}

/**
 * @param {object} deps
 * @param {object} deps.observationStore An `IObservationStore` implementation.
 * @param {{find: Function, update: Function}} deps.entries Food-log entry access, injected
 *   by the composition root (it wraps `HealthOperations`, which owns the field whitelist
 *   and the settled stamp — this service never writes nutrilist fields directly).
 * @param {Function} [deps.scaleConfig] Returns the NORMALIZED scale config (containers +
 *   densityLevels). A function, not a value, because the config is cached at boot and a
 *   reload must be picked up without rebuilding this service.
 * @param {object} [deps.logger]
 */
export function createObservationPairingService({
  observationStore,
  entries,
  scaleConfig = () => ({}),
  logger = console,
}) {
  if (!observationStore?.get) throw new Error('createObservationPairingService: observationStore required');
  if (typeof entries?.find !== 'function' || typeof entries?.update !== 'function') {
    throw new Error('createObservationPairingService: entries with find/update required');
  }

  /** Every observation recorded on one calendar date, oldest first. */
  const listByDate = (userId, date) => observationStore.listByDate(userId, date);

  /**
   * Recompute one entry from the observations currently paired to it.
   *
   * @returns {object|null} The applied changes, or `null` when the evidence carries no
   *   usable weight (nothing is written in that case — an entry is never blanked because
   *   a person paired a density card to it).
   */
  const recomputeEntry = async (userId, entryUuid) => {
    const evidence = observationStore.findByPairedEntry(userId, entryUuid);
    const weight = latestOfKind(evidence, 'weight');
    const gross = Number(weight?.value);
    if (!Number.isFinite(gross) || gross <= 0) return null;

    const cfg = scaleConfig() || {};
    const containerObs = latestOfKind(evidence, 'container');
    // `resolveScaleNet` owns every failure mode the tare has (unknown id, malformed row,
    // tare >= gross) and degrades to the untared gross for each — the same degradation the
    // automatic path takes, so a re-pair can never produce a net the live path wouldn't.
    const resolution = resolveScaleNet(
      { gross, composition: { container: containerObs?.value ?? null } },
      cfg.containers,
    );
    if (resolution.error || resolution.refused || resolution.unknownId) {
      logger.warn?.('observation.repair.tare_not_applied', {
        entryUuid, gross, containerId: containerObs?.value ?? null,
        refused: resolution.refused, unknownId: resolution.unknownId,
        error: resolution.error?.message ?? null,
      });
    }
    const net = resolution.net;

    const changes = { grams: net, amount: net, unit: weight?.unit || 'g' };

    // Calories ONLY with a measured density — see the module docstring.
    const densityObs = latestOfKind(evidence, 'density');
    const level = densityObs ? densityForLevel(cfg, densityObs.value) : null;
    if (level) {
      try {
        const n = computeNutrition(net, level);
        changes.calories = n.calories;
        changes.fat = round1(n.fat_g);
        changes.carbs = round1(n.carb_g);
        changes.protein = round1(n.protein_g);
        changes.fiber = round1(n.fiber_g);
        changes.sugar = round1(n.sugar_g);
        changes.sodium = round1(n.sodium_mg);
      } catch (err) {
        // A malformed density row in config must not cost the grams correction.
        logger.warn?.('observation.repair.nutrition_skipped', {
          entryUuid, level: densityObs.value, error: err.message,
        });
      }
    }

    const result = await entries.update(userId, entryUuid, changes);
    if (!result) {
      throw new ApplicationError(`Food-log entry not found: ${entryUuid}`, {
        code: 'ENTRY_NOT_FOUND', entryUuid,
      });
    }
    return changes;
  };

  /**
   * Point one observation at a food-log entry, releasing whatever it pointed at before.
   *
   * ORDER: the ledger is written FIRST, the entry recomputed second. The ledger is the
   * evidence trail — the thing the day view reads to say "this entry was scale-measured" —
   * so a failure after it lands leaves an entry that is visibly paired but not yet
   * recomputed, which the person can see and simply repeat. The reverse order would leave
   * an entry silently rewritten from evidence it does not own. Repeating is safe: pairing
   * an observation to the entry it already points at is a no-op on the ledger and still
   * recomputes, which is exactly the retry story.
   *
   * @throws {InfrastructureError} `NOT_FOUND` when the observation does not exist.
   * @throws {ApplicationError} `ENTRY_NOT_FOUND` when the target entry does not exist.
   * @throws {ValidationError} `CROSS_FILE_BATCH` when releasing the prior pairing would
   *   require writing two files — nothing is written.
   */
  const pair = async (userId, observationId, entryUuid) => {
    const observation = observationStore.get(userId, observationId);

    const entry = await entries.find(userId, entryUuid);
    if (!entry) {
      throw new ApplicationError(`Food-log entry not found: ${entryUuid}`, {
        code: 'ENTRY_NOT_FOUND', entryUuid,
      });
    }

    const prior = observation.pairedEntryUuid ?? null;
    const patches = [];
    let released = [];
    if (prior && prior !== entryUuid) {
      // Every row that pointed at the PRIOR entry goes back to `open`. Leaving them would
      // have that entry still claiming a placement whose weight has just been attributed
      // elsewhere; releasing them puts each one back in the unmatched list where it is
      // visible, re-pairable and dismissible. The prior entry's own logged numbers are
      // deliberately left alone — this service never rewrites an entry the person did not
      // name — but nothing in the ledger claims them any more.
      released = observationStore.findByPairedEntry(userId, prior)
        .filter((o) => o.id !== observation.id)
        .map((o) => o.id);
      for (const id of released) patches.push({ id, status: 'open', pairedEntryUuid: null });
    }
    // Also patched when the pairing already points here but the row is not `consumed` —
    // a dismissed row being pointed at an entry is a re-pair, not a no-op.
    if (prior !== entryUuid || observation.status !== 'consumed') {
      patches.push({ id: observation.id, status: 'consumed', pairedEntryUuid: entryUuid });
    }

    if (patches.length > 0) observationStore.updateMany(userId, patches);

    const recomputed = await recomputeEntry(userId, entryUuid);
    logger.info?.('observation.paired', {
      observationId, entryUuid, prior, released: released.length, recomputed: Boolean(recomputed),
    });

    return {
      observation: observationStore.get(userId, observationId),
      released,
      recomputed,
    };
  };

  /**
   * Resolve an observation as "not food I am logging" — the ONLY way a row that aged out
   * of the composition window ever leaves the permanently-open population.
   *
   * Always exactly one row, so always exactly one file: `update` cannot straddle the
   * hot/archive boundary the way a batch can.
   *
   * @throws {InfrastructureError} `NOT_FOUND` when the observation does not exist.
   */
  const dismiss = (userId, observationId) => {
    const before = observationStore.get(userId, observationId);
    const observation = observationStore.update(userId, observationId, {
      status: 'dismissed', pairedEntryUuid: null,
    });
    logger.info?.('observation.dismissed', {
      observationId, kind: before.kind, wasStatus: before.status,
    });
    return { observation };
  };

  return { listByDate, pair, dismiss };
}

export default createObservationPairingService;
