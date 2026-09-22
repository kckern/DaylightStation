/**
 * ScanDataRepair - pure planners for the 2026-09-22 scan data-quality repair
 * (docs/_wip/audits/2026-09-22-health-app-data-quality-audit.md).
 *
 * Nothing here reads or writes storage. `cli/health-scan-repair.cli.mjs`
 * gathers the rows, the catalog and the placeholder photos, calls these, and
 * applies the result through the ledger's `mutateEntries` and the catalog
 * datastore's `save`.
 *
 * Icons: the hi-res manifest's `icons` keys are the EXCLUSIVE icon set. A
 * stored icon that is neither `default` nor offered (the retired 20 px flat
 * vocabulary, or a literal emoji) is re-iconed by FOOD NAME from the reviewed
 * table, else set to the neutral fallback. A table target that is not offered
 * is refused outright, so this planner can never propose flat art.
 */

import { normalizeProductName } from '#shared/contracts/health/productName.mjs';
import { NUTRIENT_KEYS } from '#shared/contracts/health/foodQuantity.mjs';
import { normalizeIconFoodName } from '#domains/nutrition/services/icons.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';

const NEUTRAL_ICON = 'default';
/** Two scans of the same product this close together are one scan re-fired. */
export const REFIRE_WINDOW_MS = 30_000;

const identity = row => row.uuid || row.id;
const rowName = row => String(row.name ?? row.item ?? row.label ?? '');
const isUpc = row => row.review?.source === 'upc';
const asSet = value => (value instanceof Set ? value : new Set(value || []));
const round1 = value => Math.round(value * 10) / 10;

/**
 * The reviewed name → slug table, checked. A value is an offered slug, or
 * null ("no suitable art", which means the neutral fallback).
 */
function iconTable(iconByName, offered) {
  const table = new Map();
  const refused = [];
  for (const [name, slug] of Object.entries(iconByName || {})) {
    if (slug !== null && slug !== NEUTRAL_ICON && !offered.has(slug)) refused.push(`${name} -> ${slug}`);
    table.set(normalizeIconFoodName(name), slug === NEUTRAL_ICON ? null : slug);
  }
  if (refused.length) throw new Error(`Icon table targets not offered by the manifest: ${refused.join(', ')}`);
  return {
    has: (...names) => names.some(n => table.has(normalizeIconFoodName(n))),
    get: (...names) => {
      const hit = names.map(n => normalizeIconFoodName(n)).find(key => table.has(key));
      return hit === undefined ? undefined : table.get(hit);
    },
  };
}

/**
 * @param {object[]} rows - every NutriList row, hot file and archives
 * @param {object} options
 * @param {Iterable<string>} options.placeholderPhotoRefs - photoRefs whose bytes are stock "no image" art
 * @param {Record<string, number>} options.labelGrams - product name → grams per label serving
 * @param {Record<string, string|null>} options.iconByName - reviewed food name → offered slug
 * @param {Iterable<string>} options.offered - the manifest's `icons` keys
 * @param {string[]} [options.deleteIds] - ids a person chose to delete
 * @param {Record<string, string>} [options.renames] - exact name → corrected name
 *   (the only way a duplicated word is collapsed; name normalization keeps
 *   repeated words because "Mahi Mahi" is a real name)
 * @returns {{ deleteIds: string[], updates: object[], report: object }}
 */
export function planScanDataRepair(rows, {
  placeholderPhotoRefs = [], labelGrams = {}, iconByName = {}, offered = [], deleteIds: chosen = [], renames = {},
} = {}) {
  const offeredSet = asSet(offered);
  const placeholders = asSet(placeholderPhotoRefs);
  const table = iconTable(iconByName, offeredSet);

  // A row stored in both the hot file and an archive is one row.
  const unique = [];
  const seen = new Set();
  for (const row of rows) {
    const id = identity(row);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(row);
  }

  const missing = chosen.filter(id => !seen.has(id));
  if (missing.length) throw new Error(`Chosen delete ids are not in the ledger: ${missing.join(', ')}`);

  // ── Re-fire duplicates ───────────────────────────────────────────────────
  const duplicates = [];
  const groups = new Map();
  for (const row of unique) {
    const at = Date.parse(row.review?.startedAt);
    if (!isUpc(row) || !Number.isFinite(at)) continue;
    const key = JSON.stringify([row.date, row.mealTime, rowName(row), row.calories ?? null]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ row, at });
  }
  const duplicateIds = new Set();
  for (const group of groups.values()) {
    group.sort((a, b) => a.at - b.at);
    group.forEach(({ row, at }, index) => {
      const earlier = group.slice(0, index).find(prev => at - prev.at <= REFIRE_WINDOW_MS);
      if (!earlier) return;
      duplicateIds.add(identity(row));
      duplicates.push({ id: identity(row), of: identity(earlier.row), name: rowName(row), date: row.date,
        secondsAfter: round1((at - earlier.at) / 1000) });
    });
  }
  const deleteIds = [
    ...unique.map(identity).filter(id => duplicateIds.has(id)),
    ...chosen.filter(id => !duplicateIds.has(id)),
  ];
  const deleting = new Set(deleteIds);

  // ── Per-row updates ──────────────────────────────────────────────────────
  const updates = [];
  const report = { rows: unique.length, duplicates, explicitDeletes: [...chosen], placeholderPhotos: [], renames: [],
    manualNamesKept: [], mlToGrams: [], mlUnresolved: [], icons: [], emptyUpc: [] };
  for (const row of unique) {
    const id = identity(row);
    if (deleting.has(id)) continue;
    const name = rowName(row);
    const changes = {};
    const reasons = [];

    if (row.photoRef && placeholders.has(row.photoRef)) {
      changes.photoRef = null;
      reasons.push('placeholder-photo');
      report.placeholderPhotos.push(id);
    }

    const manualName = (row.manualFields || []).includes('name');
    const target = Object.hasOwn(renames, name) ? renames[name] : isUpc(row) ? normalizeProductName(name) : name;
    if (target && target !== name) {
      if (manualName) report.manualNamesKept.push({ id, name, proposed: target });
      else {
        changes.name = target;
        reasons.push('rename');
        report.renames.push({ id, from: name, to: target });
      }
    }
    const finalName = changes.name ?? name;

    const perServing = labelGrams[name] ?? labelGrams[finalName];
    const servingAmount = Number(row.originalQuantity?.amount);
    const servingUnit = row.originalQuantity?.unit ?? null;
    const amount = Number(row.amount);
    // The ratio is only meaningful when the serving it divides by is the same
    // ml serving the label gram figure describes.
    if (row.unit === 'ml' && Number.isFinite(perServing) && servingUnit !== 'ml') {
      report.mlUnresolved.push({ id, name, reason: `serving basis is ${servingUnit ?? 'missing'}, not ml` });
    } else if (row.unit === 'ml' && Number.isFinite(perServing) && servingAmount > 0 && Number.isFinite(amount)) {
      const grams = round1(amount * perServing / servingAmount);
      Object.assign(changes, { grams, unit: 'g', amount: grams });
      reasons.push('ml-to-grams');
      report.mlToGrams.push({ id, name: finalName, from: `${amount} ml`, grams });
    }

    const icon = typeof row.icon === 'string' && row.icon ? row.icon : NEUTRAL_ICON;
    const reviewed = table.get(finalName, name);
    if (icon !== NEUTRAL_ICON && !offeredSet.has(icon)) {
      changes.icon = reviewed ?? NEUTRAL_ICON;
      reasons.push('retired-icon');
    } else if (reviewed && reviewed !== icon && !(row.manualFields || []).includes('icon')) {
      changes.icon = reviewed;
      reasons.push('reviewed-icon');
    }
    if (Object.hasOwn(changes, 'icon')) report.icons.push({ id, name: finalName, from: row.icon ?? null, to: changes.icon, reason: reasons.at(-1) });

    if (reasons.length) updates.push({ id, expectedVersion: row.version ?? 1, changes, reasons });

    if (isUpc(row) && NUTRIENT_KEYS.every(key => row[key] == null)) {
      report.emptyUpc.push({ id, date: row.date, name, upc: row.captureEvidence?.upc ?? null });
    }
  }
  return { deleteIds, updates, report };
}

/**
 * Catalog icons and names.
 *
 * An entry whose `icon` or `iconOverride` is not offered is re-iconed by name
 * and a non-offered pin cleared. The catalog never stores the neutral
 * sentinel: an entry with no reviewed icon gets `null`, which the next capture
 * can fill (FoodCatalogService.recordUsage). An entry with no usable pin whose
 * name is in the reviewed table takes the table's icon.
 *
 * Names normalize the way ingest does (plus the explicit `renames` map). A
 * rename whose lowercase key another entry already holds would 409 in
 * `updateDefinition`, so it is skipped and reported.
 *
 * @returns {{ iconUpdates: object[], renames: object[], skippedRenames: object[] }}
 */
export function planCatalogIconRepair(entries, { iconByName = {}, offered = [], renames = {} } = {}) {
  const offeredSet = asSet(offered);
  const table = iconTable(iconByName, offeredSet);
  const usable = slug => typeof slug === 'string' && slug !== '' && slug !== NEUTRAL_ICON && offeredSet.has(slug);

  const iconUpdates = [];
  for (const entry of entries) {
    const iconBad = entry.icon != null && !usable(entry.icon);
    const pinBad = entry.iconOverride != null && !usable(entry.iconOverride);
    const reviewed = table.get(entry.name);
    const pinned = usable(entry.iconOverride);
    let icon = entry.icon ?? null;
    if (iconBad) icon = reviewed ?? null;
    else if (!pinned && reviewed && reviewed !== entry.icon) icon = reviewed;
    const iconOverride = pinBad ? null : (entry.iconOverride ?? null);
    if (icon === (entry.icon ?? null) && iconOverride === (entry.iconOverride ?? null)) continue;
    iconUpdates.push({ id: entry.id, name: entry.name,
      from: { icon: entry.icon ?? null, iconOverride: entry.iconOverride ?? null }, icon, iconOverride });
  }

  const keyOf = entry => entry.normalizedName || FoodCatalogEntry.normalize(entry.name);
  const planned = [], skippedRenames = [];
  const claimed = new Map();
  for (const entry of entries) {
    const name = String(entry.name ?? '');
    const to = Object.hasOwn(renames, name) ? renames[name] : normalizeProductName(name);
    if (!to || to === name) continue;
    const key = FoodCatalogEntry.normalize(to);
    const conflict = entries.find(other => other.id !== entry.id && keyOf(other) === key)
      || (claimed.has(key) ? { id: claimed.get(key) } : null);
    if (conflict) { skippedRenames.push({ id: entry.id, from: name, to, conflictId: conflict.id }); continue; }
    claimed.set(key, entry.id);
    planned.push({ id: entry.id, from: name, to });
  }
  return { iconUpdates, renames: planned, skippedRenames };
}
