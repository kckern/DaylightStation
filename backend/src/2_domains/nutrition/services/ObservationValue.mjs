// backend/src/2_domains/nutrition/services/ObservationValue.mjs

/**
 * What a scale observation's VALUE is allowed to be, per kind.
 *
 * One signal, one row: a settled weight in grams, a scanned caloric-density level, a
 * scanned container id, a scanned product code. Each kind admits exactly one shape, and
 * this module is the only place that says so.
 *
 * ## Why the rules refuse input instead of coercing it
 *
 * Everything validated here flows into `ScanNutritionService`, which requires finite
 * `number` inputs and throws on anything else — numeric strings included. Coercing
 * (`Number(grams)`, `Number(x) || 0`) breaks in three directions, and all three are worse
 * than a throw:
 *
 *   • `Number(undefined)` is `NaN`, and `NaN !== null` — so a composition built over that
 *     row reads `complete: true`, reaches the unattended commit, and only then fails.
 *     A silently-stored `NaN` weight is the single most dangerous value on this path.
 *   • `Number(null)` is `0` — a confident silent zero.
 *   • `Number('500')` succeeds here and is refused downstream, so the composition claims a
 *     completeness the pipeline cannot deliver.
 *
 * A composition with weight AND density finalises into nutrition history with no human
 * confirmation. That is why the posture is reject-loudly rather than coerce-quietly, and
 * why the rejection happens BEFORE the row is written rather than when something later
 * tries to use it.
 *
 * ## The one value that is stored rather than refused
 *
 * A NEGATIVE weight. A scale genuinely reads below zero after an item is lifted off, and
 * `computeNet` already owns the decision to clamp it and flag `clamped: true`. Refusing it
 * here would pre-empt that.
 *
 * ## Why the container id is checked for usability but not for SHAPE
 *
 * `ScanVocabularyService` owns the printed grammar's id pattern and does not export it.
 * Restating the regex here would create exactly the sheet-versus-parser drift that module
 * exists to prevent, so an unknown-but-well-formed id is deliberately NOT caught: a
 * container missing from the table resolves to `undefined`, and `computeNet` reads an
 * absent container as "no tare". Whoever resolves ids against the container table has to
 * reject the miss explicitly — `ApplyScanToComposition` does, before it ever gets here.
 *
 * @module nutrition/services/ObservationValue
 */

import { ValidationError } from '#domains/core/errors/index.mjs';
// Imported from the module directly, NOT the `#domains/nutrition` barrel: the barrel
// re-exports this file, so a barrel import would cycle.
import { MAX_DENSITY_LEVEL } from './ScanVocabularyService.mjs';

/**
 * Render a received value for an error message.
 *
 * Mirrors `ScanNutritionService`'s helper for the same reason: callers that surface these
 * errors log `err.message` alone and drop the structured payload, so someone debugging at
 * the fridge needs to see what actually arrived.
 *
 * @param {unknown} value
 * @returns {string}
 */
function describeValue(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return String(value);
  return typeof value;
}

/**
 * `label` and `field` are deliberately different things. The MESSAGE names what the value
 * means to a person — "container must be a non-empty string" — while `field` names the
 * ROW COLUMN a caller would go and look at, which for every kind but the unit is `value`.
 * Conflating them makes one of the two wrong: either the message says "value" and tells a
 * person nothing, or `field` says "container" and points at a column that does not exist.
 *
 * @param {unknown} value
 * @param {string} label human-facing name, for the message
 * @param {string} code
 * @param {string} [field='value'] the row column, for the structured payload
 * @returns {string}
 * @throws {ValidationError} If not a non-empty string.
 */
function requireNonEmptyString(value, label, code, field = 'value') {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(
      `${label} must be a non-empty string (received: ${describeValue(value)})`,
      { code, field, value },
    );
  }
  return value;
}

/**
 * Must be a finite number.
 *
 * `typeof` is checked before `Number.isFinite` so a numeric string is rejected rather than
 * quietly passing.
 *
 * @param {unknown} grams
 * @returns {number}
 * @throws {ValidationError}
 */
export function validateWeightValue(grams) {
  if (typeof grams !== 'number' || !Number.isFinite(grams)) {
    throw new ValidationError(
      `grams must be a finite number (received: ${describeValue(grams)})`,
      { code: 'INVALID_WEIGHT', field: 'value', value: grams },
    );
  }
  return grams;
}

/**
 * An absent unit reads as grams: the value is a gram figure, the scale's canonical unit is
 * grams, and a defaulted unit LABEL cannot fabricate a nutrient figure the way a defaulted
 * NUMBER could. A unit that is PRESENT but unusable is a different story — that is a
 * malformed frame, and `'ml'` silently becoming `'g'` would mislabel the entry.
 *
 * @param {unknown} unit
 * @returns {string|null} `null` when absent.
 * @throws {ValidationError}
 */
export function validateWeightUnit(unit) {
  if (unit === undefined || unit === null) return null;
  return requireNonEmptyString(unit, 'unit', 'INVALID_WEIGHT_UNIT', 'unit');
}

/**
 * Range-checked even though `parseScan` already guarantees an integer 1..MAX_DENSITY_LEVEL,
 * because this row is reachable from callers that never touched the parser — a Telegram
 * button, a replayed record, a hand-edited file. The failure it prevents is a
 * misdiagnosis: an out-of-range level sails through to `computeNutrition`, misses the
 * config table, and surfaces as MALFORMED_DENSITY_LEVEL — "fix the YAML" — when the truth
 * is "rescan".
 *
 * @param {unknown} density
 * @returns {number}
 * @throws {ValidationError}
 */
export function validateDensityValue(density) {
  if (!Number.isInteger(density) || density < 1 || density > MAX_DENSITY_LEVEL) {
    throw new ValidationError(
      `density level must be an integer 1-${MAX_DENSITY_LEVEL} (received: ${describeValue(density)})`,
      { code: 'INVALID_DENSITY_LEVEL', field: 'value', value: density },
    );
  }
  return density;
}

/**
 * @param {unknown} container
 * @returns {string}
 * @throws {ValidationError}
 */
export function validateContainerValue(container) {
  return requireNonEmptyString(container, 'container', 'INVALID_CONTAINER_ID');
}

/**
 * @param {unknown} code
 * @returns {string}
 * @throws {ValidationError}
 */
export function validateUpcValue(code) {
  return requireNonEmptyString(code, 'upc', 'INVALID_UPC_CODE');
}

/**
 * Validate one observation's value against its kind, returning the pair to store.
 *
 * The KIND itself is not checked here — the storage layer owns which kinds exist, and
 * checks that before asking this module what the value may be.
 *
 * @param {{kind: string, value: unknown, unit?: unknown}} observation
 * @returns {{value: number|string, unit: string|null}} The values to persist verbatim.
 * @throws {ValidationError} With a per-kind `code`, so a caller branching on `err.code`
 *   can tell "rescan" from "fix the config" from "upstream defect".
 */
export function validateObservationValue({ kind, value, unit } = {}) {
  if (kind === 'weight') {
    return { value: validateWeightValue(value), unit: validateWeightUnit(unit) };
  }
  if (kind === 'density') {
    return { value: validateDensityValue(value), unit: null };
  }
  if (kind === 'container') {
    return { value: validateContainerValue(value), unit: null };
  }
  if (kind === 'upc') {
    return { value: validateUpcValue(value), unit: null };
  }
  // Unreachable through the storage layer, which checks the kind first. Refused rather
  // than passed through, so a kind added to the store without a rule here cannot write an
  // unvalidated value.
  throw new ValidationError(
    `no value rule for observation kind (received: ${describeValue(kind)})`,
    { code: 'INVALID_OBSERVATION_KIND', field: 'kind', value: kind },
  );
}

export default validateObservationValue;
