/**
 * ScanDataRepair - pure planners for the 2026-09-22 scan data-quality repair
 * (docs/_wip/audits/2026-09-22-health-app-data-quality-audit.md).
 *
 * Nothing here reads or writes storage. `cli/health-scan-repair.cli.mjs`
 * gathers the rows, the catalog and the placeholder photos, calls these, and
 * applies the result through the ledger's `mutateEntries` and the catalog
 * datastore's `save`.
 *
 * Icons: the hi-res manifest is the EXCLUSIVE icon set. A stored slug is one of
 *   - neutral  `default` (or none): left alone unless a reviewed name applies;
 *   - offered  a key of the manifest's `icons`: acceptable;
 *   - alias    a key of `aliases` (every alias points at hi-res art). It is
 *              mapped to the `icons` key with the same path when one exists
 *              (same picture, offered slug), else KEPT — it still resolves;
 *   - retired  anything else (the 20 px flat vocabulary, a literal emoji):
 *              re-iconed by FOOD NAME from the reviewed table, else the
 *              neutral fallback.
 * A table target that is not offered is refused outright, so this planner can
 * never propose flat art.
 */

import { normalizeProductName } from '#shared/contracts/health/productName.mjs';
import { NUTRIENT_KEYS } from '#shared/contracts/health/foodQuantity.mjs';
import { normalizeIconFoodName } from '#domains/nutrition/services/icons.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';

const NEUTRAL_ICON = 'default';
const RETIRED_ART_PREFIX = 'img/icons/food/';
/** Two scans of the same product this close together are one scan re-fired. */
export const REFIRE_WINDOW_MS = 30_000;
/** Fields that mean a person set the portion; ml → g never overrides them. */
const MANUAL_QUANTITY_FIELDS = ['amount', 'unit', 'grams'];

const identity = row => row.uuid || row.id;
const rowName = row => String(row.name ?? row.item ?? row.label ?? '');
const isUpc = row => row.review?.source === 'upc';
const asSet = value => (value instanceof Set ? value : new Set(value || []));
const round1 = value => Math.round(value * 10) / 10;
/** The ledger's portion precision (shared/contracts/health/foodQuantity.mjs scaleFoodPortion). */
const round2 = value => Math.round(value * 100) / 100;
const bump = (counts, key) => { counts[key] = (counts[key] || 0) + 1; };

/**
 * Alias → replacement slug. An alias whose path is also an offered icon's path
 * maps to that icon (same art, offered slug); otherwise it maps to itself
 * (kept: it resolves to hi-res art). Flat-art entries are neither offered nor
 * aliased — the manifest store drops them at load.
 *
 * @param {{ icons?: object, aliases?: object }} manifest
 * @returns {{ offered: string[], aliases: Record<string, string> }}
 */
export function manifestVocabulary(manifest) {
  const hiRes = section => Object.entries(section && typeof section === 'object' ? section : {})
    .filter(([, entry]) => typeof entry?.path === 'string' && !entry.path.startsWith(RETIRED_ART_PREFIX));
  const icons = hiRes(manifest?.icons);
  const byPath = new Map();
  for (const [slug, entry] of [...icons].sort(([a], [b]) => a.localeCompare(b))) {
    if (!byPath.has(entry.path)) byPath.set(entry.path, slug);
  }
  const aliases = {};
  for (const [slug, entry] of hiRes(manifest?.aliases)) aliases[slug] = byPath.get(entry.path) ?? slug;
  return { offered: icons.map(([slug]) => slug).sort(), aliases };
}

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
    get: (...names) => {
      const hit = names.map(n => normalizeIconFoodName(n)).find(key => table.has(key));
      return hit === undefined ? undefined : table.get(hit);
    },
  };
}

function classifier(offeredSet, aliases) {
  return slug => {
    if (typeof slug !== 'string' || slug === '' || slug === NEUTRAL_ICON) return { kind: 'neutral' };
    if (offeredSet.has(slug)) return { kind: 'offered' };
    if (Object.hasOwn(aliases, slug)) return aliases[slug] === slug ? { kind: 'kept-alias' } : { kind: 'alias', to: aliases[slug] };
    return { kind: 'retired' };
  };
}

/** Label facts keyed case-insensitively, so a renamed row still finds its label. */
function labelLookup(map) {
  const byKey = new Map(Object.entries(map || {}).map(([name, value]) => [FoodCatalogEntry.normalize(name), { name, value }]));
  return (...names) => names.map(n => byKey.get(FoodCatalogEntry.normalize(n))).find(Boolean) || null;
}

/**
 * @param {object[]} rows - every NutriList row, hot file then archives
 * @param {object} options
 * @param {Iterable<string>} options.placeholderPhotoRefs - photoRefs whose bytes are stock "no image" art
 * @param {Record<string, number>} options.labelGrams - product name → grams per label serving
 * @param {Record<string, string|null>} options.iconByName - reviewed food name → offered slug
 * @param {Iterable<string>} options.offered - the manifest's hi-res `icons` keys
 * @param {Record<string, string>} [options.aliases] - alias → replacement (see manifestVocabulary)
 * @param {string[]} [options.deleteIds] - ids a person chose to delete
 * @param {Record<string, string>} [options.renames] - exact name → corrected name
 *   (the only way a duplicated word is collapsed; name normalization keeps
 *   repeated words because "Mahi Mahi" is a real name)
 * @returns {{ deleteIds: string[], updates: object[], report: object }}
 */
export function planScanDataRepair(rows, {
  placeholderPhotoRefs = [], labelGrams = {}, iconByName = {}, offered = [], aliases = {}, deleteIds: chosen = [], renames = {},
} = {}) {
  const offeredSet = asSet(offered);
  const placeholders = asSet(placeholderPhotoRefs);
  const table = iconTable(iconByName, offeredSet);
  const classify = classifier(offeredSet, aliases);
  const labelOf = labelLookup(labelGrams);

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
  // A row is a re-fire when an earlier row of its group started <= 30 s
  // before it. It is reported against the row that survives (the most recent
  // non-duplicate before it), so a person can see what is kept.
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
    let kept = null;
    group.forEach(({ row, at }, index) => {
      const earlier = group.slice(0, index).find(prev => at - prev.at <= REFIRE_WINDOW_MS);
      if (!earlier) { kept = { row, at }; return; }
      duplicateIds.add(identity(row));
      duplicates.push({ id: identity(row), keptId: identity(kept.row), name: rowName(row), date: row.date,
        secondsAfter: round1((at - kept.at) / 1000) });
    });
  }
  const deleteIds = [
    ...unique.map(identity).filter(id => duplicateIds.has(id)),
    ...chosen.filter(id => !duplicateIds.has(id)),
  ];
  const deleting = new Set(deleteIds);

  // ── Label serving sizes seen on the ledger (for the catalog's portions) ──
  const servingSeen = new Map();
  for (const row of unique) {
    const label = labelOf(rowName(row));
    const amount = Number(row.originalQuantity?.amount);
    if (!label || row.originalQuantity?.unit !== 'ml' || !(amount > 0)) continue;
    if (!servingSeen.has(label.name)) servingSeen.set(label.name, {});
    bump(servingSeen.get(label.name), amount);
  }
  // The label's ml serving is the one most rows were captured with; a tie is
  // ambiguous and the catalog portion is left for a person.
  const labelServingMl = {};
  const labelServingAmbiguous = {};
  for (const [name, counts] of servingSeen) {
    const ranked = Object.entries(counts).sort(([, a], [, b]) => b - a);
    if (ranked.length === 1 || ranked[0][1] > ranked[1][1]) labelServingMl[name] = Number(ranked[0][0]);
    else labelServingAmbiguous[name] = counts;
  }
  const labelServingSeen = Object.fromEntries(servingSeen);

  // ── Per-row updates ──────────────────────────────────────────────────────
  const updates = [];
  const report = { rows: unique.length, duplicates, explicitDeletes: [...chosen], placeholderPhotos: [], renames: [],
    manualNamesKept: [], mlToGrams: [], mlUnresolved: [], icons: [], fellThroughToDefault: {}, emptyUpc: [],
    labelServingMl, labelServingAmbiguous, labelServingSeen };
  for (const row of unique) {
    const id = identity(row);
    if (deleting.has(id)) continue;
    const name = rowName(row);
    const manual = row.manualFields || [];
    const changes = {};
    const reasons = [];

    if (row.photoRef && placeholders.has(row.photoRef)) {
      changes.photoRef = null;
      reasons.push('placeholder-photo');
      report.placeholderPhotos.push(id);
    }

    const target = Object.hasOwn(renames, name) ? renames[name] : isUpc(row) ? normalizeProductName(name) : name;
    if (target && target !== name) {
      if (manual.includes('name')) report.manualNamesKept.push({ id, name, proposed: target });
      else {
        changes.name = target;
        reasons.push('rename');
        report.renames.push({ id, from: name, to: target });
      }
    }
    const finalName = changes.name ?? name;

    const label = row.unit === 'ml' ? labelOf(name, finalName) : null;
    if (label) {
      const servingAmount = Number(row.originalQuantity?.amount);
      const servingUnit = row.originalQuantity?.unit ?? null;
      const amount = Number(row.amount);
      const manualQuantity = MANUAL_QUANTITY_FIELDS.filter(field => manual.includes(field));
      // The ratio is only meaningful when the serving it divides by is the
      // same ml serving the label gram figure describes, and only when no
      // person set this portion.
      if (manualQuantity.length) report.mlUnresolved.push({ id, name, reason: `portion set by a person (${manualQuantity.join(', ')})` });
      else if (servingUnit !== 'ml') report.mlUnresolved.push({ id, name, reason: `serving basis is ${servingUnit ?? 'missing'}, not ml` });
      else if (!(servingAmount > 0) || !Number.isFinite(amount)) report.mlUnresolved.push({ id, name, reason: 'no serving amount' });
      else {
        const grams = round2(amount * label.value / servingAmount);
        Object.assign(changes, { grams, unit: 'g', amount: grams });
        reasons.push('ml-to-grams');
        report.mlToGrams.push({ id, name: finalName, from: `${amount} ml`, grams });
      }
    }

    const stored = typeof row.icon === 'string' && row.icon ? row.icon : NEUTRAL_ICON;
    const reviewed = table.get(finalName, name);
    const kind = classify(stored);
    let current = stored;
    let iconReason = null;
    if (kind.kind === 'retired') {
      current = reviewed ?? NEUTRAL_ICON;
      iconReason = 'retired-icon';
      if (reviewed === undefined) bump(report.fellThroughToDefault, stored);
    } else {
      if (kind.kind === 'alias') { current = kind.to; iconReason = 'alias-icon'; }
      if (reviewed && reviewed !== current && !manual.includes('icon')) { current = reviewed; iconReason = 'reviewed-icon'; }
    }
    if (iconReason && current !== row.icon) {
      changes.icon = current;
      reasons.push(iconReason);
      report.icons.push({ id, name: finalName, from: row.icon ?? null, to: current, reason: iconReason });
    }

    if (reasons.length) updates.push({ id, expectedVersion: row.version ?? 1, changes, reasons });

    if (isUpc(row) && NUTRIENT_KEYS.every(key => row[key] == null)) {
      report.emptyUpc.push({ id, date: row.date, name, upc: row.captureEvidence?.upc ?? null });
    }
  }
  return { deleteIds, updates, report };
}

/**
 * Catalog icons, names and remembered portions.
 *
 * Icons: an alias with an offered twin becomes the twin; a kept alias stays; a
 * retired icon is re-iconed by name, else `null` (the catalog never stores the
 * neutral sentinel — a stored `default` blocks every later capture from
 * filling it); a retired pin is cleared. An entry with no usable pin whose name
 * is in the reviewed table takes the table's icon.
 *
 * Names normalize the way ingest does (plus the explicit `renames` map). A
 * rename whose lowercase key another entry already holds would 409, so it is
 * skipped and reported.
 *
 * Portions: `usageByBucket.*.quantity` in ml for a product with a label gram
 * figure is converted with the same ratio the ledger uses, from the label's
 * ml serving seen on the ledger (`labelServingMl`), so the next quick-add
 * logs grams instead of re-logging "170 ml".
 */
export function planCatalogIconRepair(entries, {
  iconByName = {}, offered = [], aliases = {}, renames = {}, labelGrams = {}, labelServingMl = {},
} = {}) {
  const offeredSet = asSet(offered);
  const table = iconTable(iconByName, offeredSet);
  const classify = classifier(offeredSet, aliases);
  const labelOf = labelLookup(labelGrams);

  const iconUpdates = [];
  const fellThroughToNull = {};
  const pinsCleared = {};
  for (const entry of entries) {
    const reviewed = table.get(entry.name);
    const iconKind = classify(entry.icon);
    const pinKind = classify(entry.iconOverride);
    let iconOverride = entry.iconOverride ?? null;
    if (pinKind.kind === 'alias') iconOverride = pinKind.to;
    else if (pinKind.kind === 'retired' || (pinKind.kind === 'neutral' && iconOverride !== null)) {
      bump(pinsCleared, entry.iconOverride);
      iconOverride = null;
    }
    let icon = entry.icon ?? null;
    if (iconKind.kind === 'alias') icon = iconKind.to;
    if (iconKind.kind === 'retired' || (iconKind.kind === 'neutral' && icon !== null)) {
      if (reviewed === undefined && iconKind.kind === 'retired') bump(fellThroughToNull, entry.icon);
      icon = reviewed ?? null;
    } else if (!iconOverride && reviewed && reviewed !== icon) icon = reviewed;
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

  const quantityUpdates = [], quantityUnresolved = [];
  for (const entry of entries) {
    const label = labelOf(entry.name);
    if (!label) continue;
    for (const [bucket, usage] of Object.entries(entry.usageByBucket || {})) {
      const quantity = usage?.quantity;
      if (quantity?.unit !== 'ml') continue;
      const servingMl = labelServingMl[label.name];
      const amount = Number(quantity.amount);
      if (!(servingMl > 0) || !(amount > 0)) {
        quantityUnresolved.push({ id: entry.id, name: entry.name, bucket, reason: servingMl > 0 ? 'no amount' : 'no ml serving seen on the ledger' });
        continue;
      }
      const grams = round2(amount * label.value / servingMl);
      quantityUpdates.push({ id: entry.id, name: entry.name, bucket, from: { ...quantity }, to: { grams, unit: 'g', amount: grams } });
    }
  }
  return { iconUpdates, renames: planned, skippedRenames, quantityUpdates, quantityUnresolved, fellThroughToNull, pinsCleared };
}
