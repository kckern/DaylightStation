/**
 * CatalogServingRepair — plan the backfill for barcode foods whose catalog
 * entry lost its serving, photo and icon (design 2026-09-23 §6).
 *
 * Before the fix, LogFoodFromUPC recorded a scan into the catalog without the
 * label serving, the product photo or the resolved icon, and quick-add wrote
 * `{grams: 0, amount: 0}` as the remembered portion of any food with no mass.
 * A 325 ml Strawberry Milkshake therefore became an entry with no serving, no
 * picture and an afternoon portion of "0 g", and its quick-adds logged rows
 * with `amount: null` and the neutral dot.
 *
 * PURE: the caller supplies the raw catalog entries, every ledger row (hot and
 * archived) and two lookups; this returns what would change. Deterministic for
 * the same input, so an apply can re-plan and prove convergence.
 *
 * Evidence is the entry's own original scan rows — a row whose
 * `captureEvidence.upc` is the entry's barcode, or a UPC capture filed under
 * the entry's foodId. Nothing is guessed from other foods.
 */

import { usableQuantity, usableServing } from '#domains/health/entities/FoodCatalogEntry.mjs';
import { guessIconForName, NEUTRAL_ICON } from '#domains/nutrition/services/icons.mjs';

const isRealIcon = icon => typeof icon === 'string' && icon !== '' && icon !== NEUTRAL_ICON;
const identity = row => row.uuid || row.id;
const rowTime = row => `${row.date || ''}|${row.review?.startedAt || row.createdAt || ''}|${identity(row) || ''}`;

/** The serving a scan row recorded: the label serving it was logged against. */
function scanServing(row) {
  const evidence = row.captureEvidence?.serving;
  const grams = row.originalQuantity?.grams ?? null;
  return usableServing({ amount: evidence?.size ?? evidence?.amount, unit: evidence?.unit, grams })
    ?? usableServing(row.originalQuantity);
}

/**
 * @param {Object} input
 * @param {Object[]} input.entries - raw food_catalog.yml entries
 * @param {Object[]} input.rows - every nutrilist row, hot file and archives
 * @param {(photoRef: string) => boolean} [input.photoExists] - the photo file is on disk
 * @param {Set<string>|null} [input.vocabulary] - iconVocabulary() over the OFFERED manifest
 *   slugs (with reviewed foodNames). Absent: icons are only copied from scan rows unchecked.
 * @returns {{ catalogUpdates: Object[], rowUpdates: Object[], report: Object }}
 */
export function planCatalogServingRepair({ entries, rows, photoExists = () => true, vocabulary = null }) {
  const catalogUpdates = [];
  const rowUpdates = [];
  const report = { entries: 0, upcEntries: 0, missing: { serving: 0, photoRef: 0, icon: 0 },
    filled: { serving: 0, photoRef: 0, icon: 0 }, unresolved: [], zeroQuantitiesCleared: 0, rowsFilled: 0 };
  const offered = slug => isRealIcon(slug) && (!vocabulary || vocabulary.has(slug));
  // One copy per row id: a row can sit in the hot file and an archive month.
  const seen = new Set();
  const ledger = (rows || []).filter(row => row && typeof row === 'object' && row.kind !== 'group')
    .filter(row => { const id = identity(row); if (!id || seen.has(id)) return false; seen.add(id); return true; });

  for (const entry of entries || []) {
    if (!entry?.id) continue;
    report.entries++;
    const changes = {};
    // 1. Remembered portions of nothing (`{grams: 0, amount: 0}`) are cleared,
    //    on every entry: the quick-add bug did not care where a food came from.
    const clearedBuckets = Object.entries(entry.usageByBucket || {})
      .filter(([, usage]) => usage?.quantity != null && usableQuantity(usage.quantity) === null)
      .map(([bucket]) => bucket).sort();
    report.zeroQuantitiesCleared += clearedBuckets.length;

    const isUpc = entry.source === 'upc' || !!entry.barcodeUpc;
    let serving = usableServing(entry.serving);
    let photoRef = typeof entry.photoRef === 'string' && entry.photoRef ? entry.photoRef : null;
    const evidence = [];
    if (isUpc) {
      report.upcEntries++;
      const scans = ledger.filter(row => (entry.barcodeUpc && row.captureEvidence?.upc === entry.barcodeUpc)
        || (row.foodId === entry.id && row.captureEvidence?.source === 'upc'))
        .sort((a, b) => rowTime(b).localeCompare(rowTime(a)));
      const missing = [];
      if (!serving) {
        report.missing.serving++;
        const scan = scans.find(scanServing);
        if (scan) { serving = scanServing(scan); changes.serving = serving; report.filled.serving++; evidence.push(identity(scan)); }
        else missing.push('serving');
      }
      if (!photoRef) {
        report.missing.photoRef++;
        const scan = scans.find(row => typeof row.photoRef === 'string' && row.photoRef && photoExists(row.photoRef));
        if (scan) { photoRef = scan.photoRef; changes.photoRef = photoRef; report.filled.photoRef++; evidence.push(identity(scan)); }
        else missing.push('photoRef');
      }
      if (!isRealIcon(entry.icon) && !isRealIcon(entry.iconOverride)) {
        report.missing.icon++;
        const scan = scans.find(row => offered(row.icon));
        const guessed = !scan && vocabulary ? guessIconForName(entry.name, vocabulary) : null;
        const icon = scan?.icon || (offered(guessed) ? guessed : null);
        if (icon) { changes.icon = icon; report.filled.icon++; if (scan) evidence.push(identity(scan)); }
        else missing.push('icon');
      }
      if (missing.length) report.unresolved.push({ id: entry.id, name: entry.name, missing, scans: scans.length });
    }

    if (Object.keys(changes).length || clearedBuckets.length) {
      catalogUpdates.push({ id: entry.id, name: entry.name, changes, clearedBuckets, evidence: [...new Set(evidence)] });
    }

    // 2. Rows of this food that were logged with no quantity (the quick-adds
    //    the bug produced) take the serving the entry's numbers describe, and
    //    the product photo when they have none. A person's own amount is kept.
    if (!serving) continue;
    for (const row of ledger) {
      if (row.foodId !== entry.id || row.manualFields?.includes('amount')) continue;
      if (typeof row.amount === 'number' && row.amount > 0) continue;
      const rowChanges = { amount: serving.amount, unit: serving.unit, grams: serving.grams ?? null };
      if (!row.photoRef && photoRef) rowChanges.photoRef = photoRef;
      rowUpdates.push({ id: identity(row), expectedVersion: row.version ?? 1, changes: rowChanges,
        name: row.item || row.name || row.label || entry.name, date: row.date || null, foodId: entry.id });
      report.rowsFilled++;
    }
  }
  rowUpdates.sort((a, b) => `${a.date}|${a.id}`.localeCompare(`${b.date}|${b.id}`));
  return { catalogUpdates, rowUpdates, report };
}
