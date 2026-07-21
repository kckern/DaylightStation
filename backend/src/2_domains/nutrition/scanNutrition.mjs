/**
 * Net weight and nutrient derivation for scan-enriched scale entries.
 *
 * Turns a gross scale reading plus a scanned container tare and caloric-density
 * level into the numbers that land in nutrition history.
 *
 * Macros are stored as PERCENT OF CALORIES (must sum to 100) rather than grams,
 * which makes the hand-authored density table self-validating: a typo fails the
 * config schema check instead of producing a level whose macro grams do not
 * reconcile with its own calorie count. Grams are derived here.
 *
 * ## Why this module refuses input instead of coercing it
 *
 * Everything computed here feeds an entry that AUTO-ACCEPTS into history when a
 * weight and a density are both present. There is no human in the loop to notice
 * a wrong number, so the failure mode that matters is a plausible-looking entry
 * built from garbage — above all a silent 0 kcal.
 *
 * The idiomatic `Number(x) || 0` guard produces exactly that: it maps NaN,
 * undefined, null and '' onto 0, so a corrupt scale frame or a container row with
 * no weight yields a confident, unflagged, wrong entry. So every numeric input is
 * required to be a finite `number` and anything else throws. Numeric STRINGS are
 * refused too — a stringified weight reaching this module is itself a defect, and
 * surfacing it beats quietly papering over it.
 *
 * The one input that is tolerated rather than refused is a negative result, which
 * is a real physical reading (see `computeNet`).
 *
 * ## Macro grams are returned UNROUNDED — do not "tidy" them
 *
 * `fat_g` comes back as 9.333333333333334, which looks untidy beside a whole
 * `grams: 74` in the history YAML. Rounding it here would break the invariant
 * that justifies the percent-of-calories design: the derived grams must burn
 * back to exactly the stored calorie total (`fat_g*9 + carb_g*4 + protein_g*4
 * === calories`). Round at the display or storage boundary instead, where the
 * reconciliation has already been done.
 *
 * @module nutrition/scanNutrition
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

/** Atwater factors: kcal released per gram of each macronutrient. */
const KCAL_PER_G_FAT = 9;
const KCAL_PER_G_CARB = 4;
const KCAL_PER_G_PROTEIN = 4;

/**
 * Render a received value for an error message.
 *
 * The message is appended with what actually arrived because the callers that
 * surface these errors log `err.message` alone and drop the structured
 * `code`/`field`/`value`. Without this, someone debugging at the fridge learns
 * which field was bad but never what it held.
 *
 * @param {unknown} value
 * @returns {string}
 */
function describe(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return String(value);
  return typeof value;
}

/**
 * @param {unknown} value
 * @param {string} field Dotted path, for the error payload.
 * @param {string} code Machine-readable error code.
 * @param {{min?: number}} [opts]
 * @returns {number}
 * @throws {ValidationError} If not a finite number, or below `min`.
 */
function requireNumber(value, field, code, { min } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(
      `${field} must be a finite number (received: ${describe(value)})`,
      { code, field, value },
    );
  }
  if (min !== undefined && value < min) {
    throw new ValidationError(
      `${field} must be at least ${min} (received: ${describe(value)})`,
      { code, field, value },
    );
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {string} code
 * @returns {Record<string, unknown>}
 * @throws {ValidationError} If not a non-null, non-array object.
 */
function requireObject(value, field, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(
      `${field} must be an object (received: ${describe(value)})`,
      { code, field, value },
    );
  }
  return value;
}

/**
 * Read one optional secondary-nutrient field off a `per_100g` block.
 *
 * Absent means "none recorded" and yields 0. YAML-blank (`fiber_g:` with no
 * value) parses to `null` and is treated the same as absent — the density table
 * is hand-authored, that slip is plausible, and a zero secondary nutrient cannot
 * fabricate calories. A field that is present with an unusable value still throws.
 *
 * Deliberately NOT symmetric with `macros`, where a blank field must throw: a
 * zeroed macro split yields a plausible-looking but wrong entry, which is the
 * failure this module exists to prevent.
 *
 * @param {Record<string, unknown>} per100
 * @param {string} field
 * @returns {number}
 */
function optionalPer100(per100, field) {
  const value = per100[field];
  if (value === undefined || value === null) return 0;
  return requireNumber(value, `level.per_100g.${field}`, 'INVALID_PER_100G', { min: 0 });
}

/**
 * Subtract a scanned container's tare from a gross scale reading.
 *
 * A negative result CLAMPS to zero and sets `clamped`, rather than throwing. Two
 * things produce one legitimately: the container table ships with placeholder
 * tare weights, so `gross < tare` is a certainty until a human measures them; and
 * a scale can read below zero after an item is lifted off. Both are real states
 * the caller must surface, so the flag is the contract — a clamped entry must not
 * be logged as a silent 0 kcal.
 *
 * `tared` reports whether the gross was actually adjusted, so a zero-weight
 * container reads as untared. The container's identity is recorded separately by
 * the caller; this flag is about the arithmetic.
 *
 * @param {number} grossG Gross reading in grams. Finite; may be negative.
 * @param {{grams: number}|null} [container] Scanned container, or null when none
 *   was scanned (D1: the gross is then treated as net and flagged `tared: false`).
 * @returns {{netG: number, tared: boolean, clamped: boolean}}
 * @throws {ValidationError} If the gross is not a finite number, or a container
 *   was supplied without a usable non-negative `grams`.
 */
export function computeNet(grossG, container = null) {
  const gross = requireNumber(grossG, 'grossG', 'INVALID_GROSS_WEIGHT');

  // Only an absent container means "no tare". A container that IS present but
  // carries no usable weight is a defect in the container table: coercing it to a
  // 0 tare would silently log the container's own weight as food.
  let tare = 0;
  if (container !== null && container !== undefined) {
    requireObject(container, 'container', 'INVALID_CONTAINER_TARE');
    tare = requireNumber(container.grams, 'container.grams', 'INVALID_CONTAINER_TARE', { min: 0 });
  }

  const raw = gross - tare;
  return {
    netG: Math.max(0, raw),
    tared: tare > 0,
    clamped: raw < 0,
  };
}

/**
 * Derive calories and nutrient grams for a net weight at a given density level.
 *
 * Macro grams are derived from the ROUNDED calorie figure so they reconcile
 * against the calorie total that actually gets stored.
 *
 * Whether the macro percentages sum to 100 is the config schema's business, not
 * this module's — duplicating that check here would let the two definitions
 * drift. Grams are derived from whatever split this is handed.
 *
 * `per_100g` is optional: it carries secondary nutrients, and treating an absent
 * block as zero cannot fabricate calories the way a zeroed macro split would.
 * Absent, `null`, and a `null` individual field all read as zero; a field present
 * with an unusable non-null value still throws. See `optionalPer100` for why this
 * leniency stops at `per_100g` and does not extend to `macros`.
 *
 * @param {number} netG Net weight in grams. Finite and non-negative — normally
 *   straight from `computeNet`, which guarantees both.
 * @param {{kcal_per_g: number,
 *          macros: {fat_pct: number, carb_pct: number, protein_pct: number},
 *          per_100g?: {fiber_g?: number, sugar_g?: number, sodium_mg?: number}}} level
 * @returns {{calories: number, fat_g: number, carb_g: number, protein_g: number,
 *            fiber_g: number, sugar_g: number, sodium_mg: number}}
 * @throws {ValidationError} If the net weight or any required level field is unusable.
 */
export function computeNutrition(netG, level) {
  const netGrams = requireNumber(netG, 'netG', 'INVALID_NET_WEIGHT', { min: 0 });

  // MALFORMED_ rather than INVALID_DENSITY_LEVEL: ScanVocabulary already uses
  // that code for an out-of-range SCANNED level, whose remediation is "rescan".
  // This one means the config table row is malformed — "fix the YAML". A caller
  // branching on err.code must be able to tell those apart.
  const densityLevel = requireObject(level, 'level', 'MALFORMED_DENSITY_LEVEL');
  const kcalPerG = requireNumber(densityLevel.kcal_per_g, 'level.kcal_per_g', 'INVALID_KCAL_PER_G', { min: 0 });

  const macros = requireObject(densityLevel.macros, 'level.macros', 'INVALID_MACROS');
  const pct = (field) =>
    requireNumber(macros[field], `level.macros.${field}`, 'INVALID_MACROS', { min: 0 });
  const fatPct = pct('fat_pct');
  const carbPct = pct('carb_pct');
  const proteinPct = pct('protein_pct');

  const per100 = densityLevel.per_100g === null || densityLevel.per_100g === undefined
    ? {}
    : requireObject(densityLevel.per_100g, 'level.per_100g', 'INVALID_PER_100G');

  const calories = Math.round(netGrams * kcalPerG);
  const scale = netGrams / 100;

  return {
    calories,
    fat_g: (calories * fatPct / 100) / KCAL_PER_G_FAT,
    carb_g: (calories * carbPct / 100) / KCAL_PER_G_CARB,
    protein_g: (calories * proteinPct / 100) / KCAL_PER_G_PROTEIN,
    fiber_g: optionalPer100(per100, 'fiber_g') * scale,
    sugar_g: optionalPer100(per100, 'sugar_g') * scale,
    sodium_mg: optionalPer100(per100, 'sodium_mg') * scale,
  };
}
