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
  const seenCodes = new Set();

  for (const row of densityLevels) {
    // Two different numbers, checked separately.
    //
    //   row.level     ordinal rung, 1..MAX_DENSITY_LEVEL — orders the table and
    //                 keys the Telegram keyboard's callback payload
    //   printed code  round(kcal_per_g * 100) — what the QR actually carries
    //
    // The PRINTED one is what `encodeDensity` bounds, so that is what gets passed
    // to it. Deriving the code here exactly as `sheetProviders` does is what makes
    // this a real pre-flight: an unprintable calorie figure fails at config load
    // rather than at PDF generation.
    const code = Math.round(Number(row?.kcal_per_g) * 100);
    try {
      encodeDensity(code);
    } catch (err) {
      fail(
        `Density level ${row?.level} has an unprintable kcal_per_g `
        + `${JSON.stringify(row?.kcal_per_g ?? null)}: ${err.message}`,
        'INVALID_DENSITY_LEVEL',
        row?.kcal_per_g,
      );
    }

    if (!Number.isInteger(row.level) || row.level < 1 || row.level > MAX_DENSITY_LEVEL) {
      fail(
        `Density level must be an integer 1-${MAX_DENSITY_LEVEL} (got ${JSON.stringify(row.level)})`,
        'INVALID_DENSITY_LEVEL',
        row.level,
      );
    }

    if (seenLevels.has(row.level)) {
      fail(`Duplicate density level ${row.level}`, 'DUPLICATE_DENSITY_LEVEL', row.level);
    }
    seenLevels.add(row.level);

    // Two rungs rounding to the same printed code (1.44 and 1.45 kcal/g) would put
    // the SAME QR on two cards, and a scan would resolve to whichever row came
    // first — the other rung would be unreachable from the sheet with no error.
    if (seenCodes.has(code)) {
      fail(
        `Density levels collide on printed code dl:${code} — `
        + `two rows round to the same kcal per 100 g`,
        'DUPLICATE_DENSITY_LEVEL',
        code,
      );
    }
    seenCodes.add(code);

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

  // A gap means the ordinal ladder is broken — the Telegram keyboard renders one
  // button per rung and its callbacks carry `level`, so a missing rung is a dead
  // button. The printed sheet no longer depends on contiguity (it prints calorie
  // figures, not rungs), but the keyboard still does.
  for (let n = 1; n <= MAX_DENSITY_LEVEL; n += 1) {
    if (!seenLevels.has(n)) fail(`Density table is missing level ${n}`, 'MISSING_DENSITY_LEVEL', n);
  }

  const seenIds = new Set();
  const seenTares = new Set();
  for (const item of containers.items || []) {
    // The TARE is what gets printed, so the tare is what has to be printable.
    // `encodeContainer` carries the offending value only in the error PAYLOAD, and
    // the callers that surface this log `err.message` alone. Re-throw with the row
    // inlined so the operator learns which one to fix, not just that one is bad.
    const grams = Math.round(Number(item?.grams));
    try {
      encodeContainer(grams);
    } catch (err) {
      fail(
        `Container ${JSON.stringify(item?.id ?? null)} has an unprintable tare `
        + `${JSON.stringify(item?.grams ?? null)}: ${err.message}`,
        'INVALID_CONTAINER_ID',
        item?.grams,
      );
    }

    if (seenIds.has(item.id)) {
      fail(`Duplicate container id "${item.id}"`, 'DUPLICATE_CONTAINER_ID', item.id);
    }

    // Equal tares are the SAME printed QR on two cards. `containerForTare` resolves
    // to whichever row comes first, so the second vessel could never be scanned and
    // its label would never appear on an ack — with nothing to indicate why.
    if (seenTares.has(grams)) {
      fail(
        `Containers collide on printed code ct:${grams} — `
        + `"${item.id}" shares a tare with an earlier row`,
        'DUPLICATE_CONTAINER_ID',
        grams,
      );
    }
    seenTares.add(grams);
    seenIds.add(item.id);

    if (!Number.isFinite(Number(item.grams)) || Number(item.grams) <= 0) {
      fail(`Container "${item.id}" needs a positive grams`, 'INVALID_CONTAINER_TARE', item.grams);
    }
  }

  return true;
}
