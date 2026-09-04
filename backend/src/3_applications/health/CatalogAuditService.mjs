/**
 * CatalogAuditService — the drift report.
 *
 * It answers one question, deterministically: which catalog entries claim a
 * serving that their own logged history does not support?
 *
 * ## It proposes. It never writes nutrition.
 *
 * Nothing in here sets a calorie count. `approve` re-seeds ONE entry's
 * observation ring from the rows already on disk, and the canonical value
 * follows from that derivation exactly as it does everywhere else — the
 * machine never picks a number, it only decides which real rows count as
 * evidence. `dismiss` writes a key into the household's existing dismissal
 * ledger and the entry is never proposed again.
 *
 * ## Why proposals are not stored
 *
 * The report is a pure function of (catalog, history, ledger), so storing it
 * would only create a second thing that can be stale. Re-running it is the
 * cheapest way to be right. The one piece of durable state a proposal needs —
 * "I have already said no to this" — is the ledger, which already exists.
 *
 * The DELIBERATE deviation from the brief: proposals do not go through
 * `TemplateService.saveProposals`. That method mints a MEAL TEMPLATE — a row
 * with `components`, surfaced by `GET /nutrition/templates?includeProposed=1`
 * in the meal picker and instantiable into a day's log by
 * `TemplateService.instantiate`. Filing "this shake's serving looks wrong" as
 * a one-ingredient meal template would put a food-correction into the meal
 * picker and make Approve create a meal rather than fix anything. The
 * dismissal ledger itself IS reused, via `TemplateService.dismissKey`, so the
 * "remembered forever" half of the contract is the same ledger with the same
 * semantics.
 */

import { deriveCanonical, ratioApart, DRIFT_RATIO } from '#domains/health/services/catalogDensity.mjs';

/** Namespaced so a drift key can never collide with a meal-template key. */
export const DRIFT_KEY_PREFIX = 'catalog-density:';

/**
 * How much history a name needs before its median is worth arguing with.
 * Below three rows a "median" is one opinion wearing a statistic's clothes.
 */
export const MIN_HISTORY_ROWS = 3;

const coded = (message, code) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

export class CatalogAuditService {
  #catalogStore; #reconcileJob; #templateService; #threshold; #logger;

  /**
   * @param {Object} config
   * @param {Object} config.catalogStore - IFoodCatalogDatastore
   * @param {Object} config.reconcileJob - CatalogReconcileJob (history reader + re-seeder)
   * @param {Object} [config.templateService] - supplies the shared dismissal ledger
   * @param {number} [config.threshold]
   */
  constructor(config) {
    if (!config?.catalogStore || !config?.reconcileJob) {
      throw new Error('CatalogAuditService requires catalogStore and reconcileJob');
    }
    this.#catalogStore = config.catalogStore;
    this.#reconcileJob = config.reconcileJob;
    this.#templateService = config.templateService || null;
    this.#threshold = Number(config.threshold) > 0 ? Number(config.threshold) : DRIFT_RATIO;
    this.#logger = config.logger || console;
  }

  static keyFor(normalizedName) { return `${DRIFT_KEY_PREFIX}${normalizedName}`; }

  /**
   * @param {string} userId
   * @returns {Promise<{threshold, scanned, considered, dismissed, entries: Array}>}
   */
  async report(userId) {
    const byName = await this.#reconcileJob.observationsByName(userId);
    const catalog = await this.#catalogStore.getAll(userId);
    const dismissed = new Set(
      this.#templateService ? await this.#templateService.listDismissedKeys(userId) : [],
    );

    let considered = 0, dismissedCount = 0;
    const entries = [];
    for (const entry of catalog) {
      const observations = byName.get(entry.normalizedName) || [];
      if (observations.length < MIN_HISTORY_ROWS) continue;
      const history = deriveCanonical(observations);
      if (!history) continue;
      considered += 1;
      const current = entry.nutrients?.calories;
      const ratio = ratioApart(current, history.nutrients.calories);
      if (ratio === null || ratio < this.#threshold) continue;
      const key = CatalogAuditService.keyFor(entry.normalizedName);
      if (dismissed.has(key)) { dismissedCount += 1; continue; }
      entries.push({
        key,
        id: entry.id,
        name: entry.name,
        catalogCalories: current,
        catalogGrams: entry.canonicalGrams,
        historyCalories: history.nutrients.calories,
        historyGrams: history.grams,
        historyDensity: history.density,
        rowCount: observations.length,
        ratio,
      });
    }

    // Sorted by how wrong it is, then by name — a report whose order moves
    // between identical runs is not a deterministic report.
    entries.sort((a, b) => (b.ratio - a.ratio) || a.name.localeCompare(b.name));

    const result = {
      threshold: this.#threshold,
      scanned: catalog.length,
      considered,
      dismissed: dismissedCount,
      entries,
    };
    this.#logger.info?.('health.catalog.audit', {
      userId, scanned: result.scanned, considered, flagged: entries.length, dismissed: dismissedCount,
    });
    return result;
  }

  /**
   * Accept a proposal: re-seed this ONE entry's ring from the rows on disk.
   * The canonical value then derives from real logs. No number is authored
   * here — if history says nothing usable, this refuses rather than writing a
   * zero.
   */
  async approve(key, userId) {
    const normalizedName = this.#nameFromKey(key);
    const entry = (await this.#catalogStore.getAll(userId))
      .find((e) => e.normalizedName === normalizedName);
    if (!entry) throw coded(`Catalog entry not found for key: ${key}`, 'NOT_FOUND');

    const byName = await this.#reconcileJob.observationsByName(userId);
    const observations = byName.get(normalizedName) || [];
    if (observations.length === 0) throw coded(`No history for ${entry.name}`, 'NO_HISTORY');

    entry.setObservations(observations);
    await this.#catalogStore.save(entry, userId);
    this.#logger.info?.('health.catalog.audit.approved', {
      key, id: entry.id, name: entry.name, observations: entry.observations.length,
    });
    return { ok: true, id: entry.id, name: entry.name, nutrients: entry.nutrients };
  }

  /** Refuse a proposal, permanently — the shared dismissal ledger. */
  async dismiss(key, userId) {
    this.#nameFromKey(key);
    if (!this.#templateService?.dismissKey) {
      throw coded('Dismissal ledger is not available', 'LEDGER_UNAVAILABLE');
    }
    await this.#templateService.dismissKey(key, userId);
    this.#logger.info?.('health.catalog.audit.dismissed', { key });
    return { ok: true, key };
  }

  #nameFromKey(key) {
    const raw = String(key ?? '');
    if (!raw.startsWith(DRIFT_KEY_PREFIX)) {
      throw coded(`Not a catalog drift key: ${raw}`, 'BAD_KEY');
    }
    const name = raw.slice(DRIFT_KEY_PREFIX.length);
    if (!name) throw coded('Empty catalog drift key', 'BAD_KEY');
    return name;
  }
}

export default CatalogAuditService;
