/**
 * CatalogReconcileJob — seeds each catalog entry's observation ring from the
 * food history that is already on disk.
 *
 * ## Why this is not `backfill`
 *
 * `FoodCatalogService.backfill` walks history and calls `recordUsage` per row,
 * which increments `useCount` every time it runs — decision 2.29. Running it
 * twice therefore doubles every counter, and it can never be re-run safely.
 * This job shares none of that machinery on purpose.
 *
 * It is idempotent by CONSTRUCTION, not by care:
 *
 *  - it REBUILDS each ring from history rather than appending to it, so the
 *    result is a pure function of the rows on disk;
 *  - the rows it keeps are chosen by a total order — `(date, uuid)` — so the
 *    same history always yields the same twenty survivors regardless of file
 *    order;
 *  - it touches `observations` and nothing else. `useCount`, `lastUsed`,
 *    `createdAt`, `icon`, `favorite` and `usageByBucket` are read-only to it.
 *
 * Run it three times and hash the catalog: the hash does not move. That is the
 * check, and it is the check because a previous phase's equivalent claim was
 * wrong.
 *
 * It creates NO catalog entries. A name in history with no entry is not this
 * job's business — seeding one would be `backfill`'s job, and `backfill`'s
 * problems.
 */

import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';
import { observationFromRow, sortObservations, normalizeRing } from '#domains/health/services/catalogDensity.mjs';

/** Local (not UTC) YYYY-MM-DD — the UTC form reads as tomorrow every evening here. */
function localDateISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftDays(iso, days) {
  const at = new Date(`${iso}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Far enough back to cover the whole archived nutrilist. */
export const RECONCILE_WINDOW_DAYS = 730;

export class CatalogReconcileJob {
  #catalogStore; #nutriListStore; #clock; #windowDays; #logger;

  constructor({ catalogStore, nutriListStore, clock, windowDays = RECONCILE_WINDOW_DAYS, logger }) {
    if (!catalogStore || !nutriListStore || !clock?.now) {
      throw new Error('CatalogReconcileJob requires catalogStore, nutriListStore, clock');
    }
    this.#catalogStore = catalogStore;
    this.#nutriListStore = nutriListStore;
    this.#clock = clock;
    this.#windowDays = windowDays;
    this.#logger = logger || console;
  }

  /**
   * Group every history row that can be an observation by normalized name.
   * Exposed so the drift audit reads history through exactly the same rules
   * the reconcile does — two different readings of "what does history say"
   * would be two different answers.
   *
   * @returns {Promise<Map<string, Array<Object>>>}
   */
  async observationsByName(userId) {
    const today = localDateISO(new Date(this.#clock.now()));
    const from = shiftDays(today, -this.#windowDays);
    const rows = await this.#nutriListStore.findByDateRange(userId, from, today);
    const byName = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const name = row?.name || row?.item || row?.label;
      // 'Unknown' is the store's sentinel for a row with no name at all, and
      // is not a food. A group HEADER carries no nutrition by design
      // (decision 2.4) and would otherwise enter the ring as a zero-calorie
      // observation; `observationFromRow` drops it, but naming the reason here
      // keeps the next reader from "fixing" that.
      if (!name || name === 'Unknown') continue;
      const observation = observationFromRow(row);
      if (!observation) continue;
      const key = FoodCatalogEntry.normalize(name);
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(observation);
    }
    return byName;
  }

  /**
   * @param {string} userId
   * @param {Object} [options]
   * @param {boolean} [options.dryRun=false] - compute everything, write nothing
   * @returns {Promise<{scanned, seeded, unchanged, skipped, dryRun}>}
   */
  async run(userId, { dryRun = false } = {}) {
    const byName = await this.observationsByName(userId);
    const catalog = await this.#catalogStore.getAll(userId);

    let seeded = 0, unchanged = 0, skipped = 0;
    for (const entry of catalog) {
      const observations = byName.get(entry.normalizedName);
      if (!observations || observations.length === 0) { skipped += 1; continue; }
      // `normalizeRing` is what `setObservations` will store, so the change
      // check below compares like with like. Comparing against the raw
      // history instead made an entry with two rows under one id look changed
      // on every run — identical bytes on disk, but `seeded` never reached 0,
      // which is the exact claim this job exists to be able to make.
      const next = carrySource(entry.observations, normalizeRing(observations));
      // A ring that is already exactly this is not rewritten. This is what
      // makes the second and third runs no-ops rather than merely harmless
      // ones, and it is why the written file is byte-stable.
      if (sameRing(entry.observations, next)) { unchanged += 1; continue; }
      entry.setObservations(next);
      if (!dryRun) await this.#catalogStore.save(entry, userId);
      seeded += 1;
    }

    const result = { scanned: catalog.length, seeded, unchanged, skipped, dryRun };
    this.#logger.info?.('health.catalog.reconcile', { userId, ...result });
    return result;
  }
}

/**
 * Re-attach the `source` label the ring already had.
 *
 * A stored nutrilist row does not record which capture path produced it — only
 * the NutriLog does — so an observation rebuilt from history comes back
 * sourceless, and a UPC scan would silently lose the extra weight the
 * derivation gives a manufacturer's own panel. Matching is by identity first
 * (`logId`) and then by the observation's own numbers, each existing label
 * consumed at most once, so this is deterministic and can only ever re-attach
 * a label — it never touches a number.
 */
function carrySource(existing, next) {
  const labelled = new Map();
  for (const obs of sortObservations(Array.isArray(existing) ? existing : [])) {
    if (!obs?.source) continue;
    if (obs.logId) labelled.set(`id:${obs.logId}`, obs.source);
    labelled.set(`v:${obs.date}|${obs.kcal}|${obs.grams}`, obs.source);
  }
  if (labelled.size === 0) return next;
  return next.map((obs) => {
    const byId = obs.logId ? labelled.get(`id:${obs.logId}`) : undefined;
    const source = byId ?? labelled.get(`v:${obs.date}|${obs.kcal}|${obs.grams}`);
    return source ? { ...obs, source } : obs;
  });
}

/** Ring equality by the fields that survive a round trip. */
function sameRing(a, b) {
  const left = Array.isArray(a) ? a : [];
  if (left.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) {
    const x = left[i], y = b[i];
    if (!x) return false;
    if (x.logId !== y.logId || x.date !== y.date || x.kcal !== y.kcal || x.grams !== y.grams) return false;
    if (x.protein !== y.protein || x.carbs !== y.carbs || x.fat !== y.fat) return false;
    if ((x.source ?? null) !== (y.source ?? null)) return false;
  }
  return true;
}

export default CatalogReconcileJob;
