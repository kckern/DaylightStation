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
 * @module nutrition/scanNutrition
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

/** Atwater factors: kcal released per gram of each macronutrient. */
const KCAL_PER_G_FAT = 9;
const KCAL_PER_G_CARB = 4;
const KCAL_PER_G_PROTEIN = 4;

const PER_100G_FIELDS = ['fiber_g', 'sugar_g', 'sodium_mg'];

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
    throw new ValidationError(`${field} must be a finite number`, { code, field, value });
  }
  if (min !== undefined && value < min) {
    throw new ValidationError(`${field} must be at least ${min}`, { code, field, value });
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
    throw new ValidationError(`${field} must be an object`, { code, field, value });
  }
  return value;
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
  const tare = container === null || container === undefined
    ? 0
    : requireNumber(container.grams, 'container.grams', 'INVALID_CONTAINER_TARE', { min: 0 });

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
 * block as zero cannot fabricate calories the way a zeroed macro split would. A
 * field that is PRESENT but unusable still throws.
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
  const g = requireNumber(netG, 'netG', 'INVALID_NET_WEIGHT', { min: 0 });

  requireObject(level, 'level', 'INVALID_DENSITY_LEVEL');
  const kcalPerG = requireNumber(level.kcal_per_g, 'level.kcal_per_g', 'INVALID_KCAL_PER_G', { min: 0 });

  const macros = requireObject(level.macros, 'level.macros', 'INVALID_MACROS');
  const pct = (field) =>
    requireNumber(macros[field], `level.macros.${field}`, 'INVALID_MACROS', { min: 0 });
  const fatPct = pct('fat_pct');
  const carbPct = pct('carb_pct');
  const proteinPct = pct('protein_pct');

  const per100 = level.per_100g === null || level.per_100g === undefined
    ? {}
    : requireObject(level.per_100g, 'level.per_100g', 'INVALID_PER_100G');
  const [fiberPer100, sugarPer100, sodiumPer100] = PER_100G_FIELDS.map((field) =>
    per100[field] === undefined
      ? 0
      : requireNumber(per100[field], `level.per_100g.${field}`, 'INVALID_PER_100G', { min: 0 }));

  const calories = Math.round(g * kcalPerG);
  const scale = g / 100;

  return {
    calories,
    fat_g: (calories * fatPct / 100) / KCAL_PER_G_FAT,
    carb_g: (calories * carbPct / 100) / KCAL_PER_G_CARB,
    protein_g: (calories * proteinPct / 100) / KCAL_PER_G_PROTEIN,
    fiber_g: fiberPer100 * scale,
    sugar_g: sugarPer100 * scale,
    sodium_mg: sodiumPer100 * scale,
  };
}
