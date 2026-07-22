/**
 * Startup validation for the scan vocabulary in scales.yml `nutribot:`.
 *
 * Every check here is one a laminated sheet would otherwise surface weeks later,
 * when the remedy is a reprint rather than a code fix.
 *
 * Validating through the ENCODERS rather than a local regex is the point: if
 * `encodeContainer` would throw on an id, that id can never be printed, so it
 * must not be accepted into the table either. A second copy of the grammar here
 * could drift from the one the parser and the sheet generator share.
 *
 * @module nutribot/lib/validateScanConfig
 */

import { ValidationError } from '#domains/core/errors/index.mjs';
import { encodeContainer, encodeDensity, MAX_DENSITY_LEVEL } from '#domains/nutrition/index.mjs';

const fail = (message, code, value) => {
  throw new ValidationError(message, { code, field: 'nutribot', value });
};

/**
 * Assert the density table and container table can both be printed and resolved.
 *
 * @param {{densityLevels?: Array<object>, containers?: {items?: Array<object>}}} [cfg]
 *   Normalized config, as returned by `normalizeScaleNutribotConfig`.
 * @returns {true}
 * @throws {ValidationError} On the first unprintable, duplicate, missing or
 *   malformed row.
 */
export function validateScanConfig({ densityLevels = [], containers = {} } = {}) {
  const seenLevels = new Set();

  for (const row of densityLevels) {
    // Throws INVALID_DENSITY_LEVEL for anything unprintable, including >MAX.
    // Its message already names the legal range, so it needs no re-wrapping.
    encodeDensity(row?.level);

    if (seenLevels.has(row.level)) {
      fail(`Duplicate density level ${row.level}`, 'DUPLICATE_DENSITY_LEVEL', row.level);
    }
    seenLevels.add(row.level);

    const m = row.macros;
    if (!m || typeof m !== 'object') {
      fail(`Density level ${row.level} is missing macros`, 'MALFORMED_DENSITY_LEVEL', row.macros);
    }
    const sum = Number(m.fat_pct) + Number(m.carb_pct) + Number(m.protein_pct);
    if (!Number.isFinite(sum) || Math.round(sum) !== 100) {
      fail(
        `Density level ${row.level} macros must sum to 100 (got ${sum})`,
        'MALFORMED_DENSITY_LEVEL',
        m,
      );
    }
  }

  // A gap means a printed dl:N resolves to nothing. Better caught here.
  for (let n = 1; n <= MAX_DENSITY_LEVEL; n += 1) {
    if (!seenLevels.has(n)) fail(`Density table is missing level ${n}`, 'MISSING_DENSITY_LEVEL', n);
  }

  const seenIds = new Set();
  for (const item of containers.items || []) {
    // `encodeContainer` carries the offending id only in the error PAYLOAD, and
    // the callers that surface this log `err.message` alone. Re-throw with the id
    // inlined so the operator learns which row to fix, not just that one is bad.
    try {
      encodeContainer(item?.id);
    } catch (err) {
      fail(
        `Container id ${JSON.stringify(item?.id ?? null)} cannot be printed: ${err.message}`,
        'INVALID_CONTAINER_ID',
        item?.id,
      );
    }

    if (seenIds.has(item.id)) {
      fail(`Duplicate container id "${item.id}"`, 'DUPLICATE_CONTAINER_ID', item.id);
    }
    seenIds.add(item.id);

    if (!Number.isFinite(Number(item.grams)) || Number(item.grams) <= 0) {
      fail(`Container "${item.id}" needs a positive grams`, 'INVALID_CONTAINER_TARE', item.grams);
    }
  }

  return true;
}
