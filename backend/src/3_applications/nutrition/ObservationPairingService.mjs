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
 * ## A measurement is a PLACEMENT, and it moves whole
 *
 * A weight, the container it sat in and the density card that described it are ONE piece
 * of evidence. Re-pairing used to move the named row alone and release its siblings, which
 * produced exactly the failure this phase exists to eliminate: the target was recomputed
 * from the weight ALONE — the untared 500 g gross with essentially no calories — and shown
 * under a "measured" badge, while the entry it came from kept the full numbers, so the day
 * counted the same food twice. `pair` now moves the whole placement or nothing.
 *
 * The other half of that failure is the entry left behind. Its numbers came from this
 * placement; with the evidence gone there is nothing left to recompute it from and no
 * honest number to write, and zeroing or deleting it would be an invention. So moving a
 * measurement that still backs a LIVING entry is REFUSED (`PRIOR_ENTRY_EXISTS`), naming
 * that entry and asking the person to delete or correct it first. The ordinary case —
 * attaching an unmatched measurement — is untouched: an open row backs nothing, so nothing
 * can be double-counted by moving it.
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
 * ## A GROUP row is never a target
 *
 * Group rows carry zero nutrition by design, which is what lets the day view sum every row
 * unconditionally and still count each gram once. A measurement attached to a group would
 * put real calories on the header while its children keep theirs — the same food counted
 * twice inside one entry tree, under a "measured" badge. `pair` refuses a group before
 * writing anything, and `recomputeEntry` refuses one again at the point of the write, so
 * neither the API nor some later caller can get nutrition onto a group row.
 *
 * ## The ratification stamp is NOT ours to write
 *
 * The entry write goes through `HealthOperations.updateNutritionItem` with
 * `ratify: false`. A re-pair corrects an entry's GRAMS and — with no density scan — leaves
 * its CALORIES exactly as the machine estimated them; stamping `settled: true` would
 * certify a calorie figure nobody looked at and would remove the "Unconfirmed" badge and
 * the Confirm affordance that ask them to. Correcting which meal a measurement belongs to
 * is not a review of that meal's estimate.
 *
 * ## Cross-file batches are REFUSED, not partially applied
 *
 * `updateMany` is atomic within ONE file. `YamlObservationStore` stores a bounded hot file
 * plus monthly archives, and a re-pair is the only operation in the system that can touch
 * both at once (its patches come from `findByPairedEntry`, which reads archives too —
 * unlike the composition consume path, whose patches come from `openForScale` and so are
 * always hot). The store refuses such a batch outright (`CROSS_FILE_BATCH`) before writing
 * a byte; this service lets that error through so the route can report it. The failure
 * mode is explicit and total: nothing is written, the ledger is exactly as it was, and the
 * person is told to act on one measurement at a time.
 *
 * @module nutrition/ObservationPairingService
 */

import { computeNutrition } from '#domains/nutrition/index.mjs';
import { MATCH_WINDOW_MS } from '#domains/nutrition/services/ObservationMatcher.mjs';
import { resolveScaleNet } from '#apps/nutribot/usecases/LogFoodFromScale.mjs';
import { densityForLevel } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';
import { ApplicationError } from '#apps/common/errors/index.mjs';

/**
 * The codebase's local timestamp (`YYYY-MM-DD HH:mm:ss`) as comparable milliseconds.
 * `Date.UTC` is used purely as an arithmetic combinator over the digits — never as an
 * instant — exactly as `ObservationMatcher` does, so the two agree by construction.
 */
function parseLocalTimestamp(ts) {
  if (typeof ts !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(ts);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec);
}

/** The last row of a kind wins: a placement appends a new row per >=5 g change. */
function latestOfKind(observations, kind) {
  let latest = null;
  for (const o of observations) {
    if (o?.kind !== kind) continue;
    if (!latest || String(o.at) >= String(latest.at)) latest = o;
  }
  return latest;
}

/**
 * A GROUP row can never carry a measurement's numbers.
 *
 * A group ("Curry") is a header whose children ("Rice", "Sauce") hold the real nutrition,
 * and it carries ZERO nutrition BY DESIGN — that is exactly what lets the day view sum
 * every row unconditionally and still count each gram once (`LogTable.jsx`'s `kcal`).
 * Writing a recomputed 448 kcal onto the group would make the bucket count the same food
 * twice inside one entry tree (330 -> 778 in the reproduced case), under a "measured"
 * badge. So a group is refused, not written to.
 *
 * Gated on `kind === 'group'` — the SAME field `EntryEditSheet`'s group mode and
 * `HealthOperations#cascadeMealTimeToChildren` gate on. If that ever stops being how a
 * group is identified, change it here too.
 */
function requireNotGroup(entry, entryUuid) {
  if (entry?.kind !== 'group') return entry;
  const name = entry.name || entry.item || entry.label || 'this dish';
  throw new ApplicationError(
    `"${name}" is a dish, not an item — its own row holds no nutrition, so a measurement `
    + 'attached here would be counted twice. Attach it to one of its items instead.',
    { code: 'ENTRY_IS_GROUP', entryUuid, entryName: name },
  );
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
    // Refused HERE as well as in `pair`, because this is the function that would do the
    // writing: a future caller reaching it by another route must not be able to put
    // nutrition on a group row either.
    requireNotGroup(await entries.find(userId, entryUuid), entryUuid);

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
        // Task 5.5: explicit, not left to whatever the entry already held. A
        // density-derived estimate is not AI or catalog micronutrient data, and this
        // recompute may be overwriting macros an earlier capture attributed to one of
        // those sources — leaving the old value would misstate where these numbers
        // came from. Matches `SelectScaleDensity`, the commit path for the same
        // computation.
        changes.microsSource = null;
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
   * The PLACEMENT one observation belongs to — the unit this service moves.
   *
   * A measurement is not a row, it is an event: a weight, the container it sat in and the
   * density card that described it are ONE piece of evidence, and an entry computed from
   * any fragment of it is a confident wrong number (an untared gross with no calories,
   * under a "measured" badge). So the placement moves together or not at all.
   *
   * Two ways to know what belongs together, matching how the rows got there:
   *  - a CONSUMED row was attached to its entry as a set, so that entry's whole evidence
   *    set IS the placement;
   *  - an OPEN row has not been grouped yet, so the placement is what the matcher itself
   *    would compose: the open rows on the SAME scale inside the same 900 s window, which
   *    is the exact rule `ObservationMatcher` uses to decide a composition.
   *
   * A `upc` row is never part of a placement — it names a product, not a scale slot (same
   * exclusion `ObservationMatcher` makes) — so pairing one moves only itself.
   */
  const placementFor = (userId, observation) => {
    if (observation.pairedEntryUuid) {
      const set = observationStore.findByPairedEntry(userId, observation.pairedEntryUuid);
      return set.length > 0 ? set : [observation];
    }
    if (observation.kind === 'upc') return [observation];
    const anchor = parseLocalTimestamp(observation.at);
    const siblings = observationStore.openForScale(userId, observation.scaleId)
      .filter((o) => o.kind !== 'upc')
      .filter((o) => {
        const t = parseLocalTimestamp(o.at);
        return anchor !== null && t !== null && Math.abs(t - anchor) <= MATCH_WINDOW_MS;
      });
    return siblings.some((o) => o.id === observation.id) ? siblings : [observation, ...siblings];
  };

  /**
   * Attach a measurement — the WHOLE placement it belongs to — to a food-log entry.
   *
   * ## Moving a measurement that already backs an entry is REFUSED while that entry lives
   *
   * The prior entry's numbers came from this placement. Move the placement away and one of
   * two things has to be untrue: either the prior entry keeps numbers nothing measured any
   * more (and the day counts that food twice, once there and once on the target), or this
   * service silently rewrites an entry the person did not name. There is no third option
   * that invents nothing — with its evidence gone there is no measurement left to
   * recompute the prior entry from, and zeroing it would be a fabricated number.
   *
   * So the collision is SURFACED rather than resolved by guesswork:
   * `PRIOR_ENTRY_EXISTS`, naming the entry and its numbers, telling the person to delete
   * or correct it first. Once that entry is gone the same request succeeds. Nothing is
   * written when it refuses.
   *
   * The ordinary case — attaching an UNMATCHED measurement to an entry — is untouched by
   * this: an open row backs nothing, so nothing can be double-counted by moving it.
   *
   * ## Order and idempotency
   *
   * The ledger is written FIRST, the entry recomputed second. The ledger is the evidence
   * trail the day view reads, so a failure after it lands leaves an entry visibly attached
   * but not yet recomputed — visible, and fixed by simply repeating. Repeating is safe:
   * re-pairing a placement to the entry it already backs patches nothing and still
   * recomputes.
   *
   * @throws {InfrastructureError} `NOT_FOUND` when the observation does not exist.
   * @throws {ApplicationError} `ENTRY_NOT_FOUND` when the target entry does not exist;
   *   `ENTRY_IS_GROUP` when the target is a dish header rather than an item;
   *   `PRIOR_ENTRY_EXISTS` when the measurement still backs another, living entry.
   * @throws {ValidationError} `CROSS_FILE_BATCH` when the placement cannot be rewritten in
   *   one atomic file write — nothing is written.
   */
  const pair = async (userId, observationId, entryUuid) => {
    const observation = observationStore.get(userId, observationId);

    const entry = await entries.find(userId, entryUuid);
    if (!entry) {
      throw new ApplicationError(`Food-log entry not found: ${entryUuid}`, {
        code: 'ENTRY_NOT_FOUND', entryUuid,
      });
    }
    // Before ANY write: a refused target must leave the ledger untouched, not attached to
    // a row the recompute will then decline to update.
    requireNotGroup(entry, entryUuid);

    const prior = observation.pairedEntryUuid ?? null;
    if (prior && prior !== entryUuid) {
      const priorEntry = await entries.find(userId, prior);
      if (priorEntry) {
        const name = priorEntry.name || priorEntry.item || priorEntry.label || 'another entry';
        const kcal = Math.round(Number(priorEntry.calories) || 0);
        throw new ApplicationError(
          `This measurement is what "${name}" (${kcal} kcal) was calculated from. `
          + 'Moving it would leave that entry counting the same food a second time. '
          + `Delete or correct "${name}" first, then attach the measurement here.`,
          { code: 'PRIOR_ENTRY_EXISTS', priorEntryUuid: prior, priorEntryName: name, priorEntryCalories: kcal },
        );
      }
    }

    const placement = placementFor(userId, observation);
    const patches = placement
      .filter((o) => !(o.status === 'consumed' && o.pairedEntryUuid === entryUuid))
      .map((o) => ({ id: o.id, status: 'consumed', pairedEntryUuid: entryUuid }));

    if (patches.length > 0) observationStore.updateMany(userId, patches);

    const recomputed = await recomputeEntry(userId, entryUuid);
    logger.info?.('observation.paired', {
      observationId, entryUuid, prior,
      moved: placement.length, recomputed: Boolean(recomputed),
    });

    return {
      observation: observationStore.get(userId, observationId),
      moved: placement.map((o) => o.id),
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
