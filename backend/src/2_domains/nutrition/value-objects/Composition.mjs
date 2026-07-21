// backend/src/2_domains/nutrition/value-objects/Composition.mjs

/**
 * One in-progress food composition, as an immutable value.
 *
 * Four slots — `grams` / `unit` / `density` / `container` — filled by whichever
 * event arrives, in any order. Every `with*` returns a NEW instance, so a
 * composition can be shared, stored, or handed across a boundary without any
 * caller being able to reach back and change it.
 *
 * ## Modality-agnostic on purpose
 *
 * This object knows nothing about scales, scan codes, Telegram, or time. A
 * density tapped on a Telegram button and a `dl:4` fridge scan both produce the
 * same `composition.withDensity(4)`. Where a composition lives, how long it
 * lives, and what ends it are the application layer's concerns — see
 * `CompositionStore` in `3_applications/nutribot/`. There is deliberately no
 * clock, no window, and no keyed collection here.
 *
 * ## Why the setters refuse input instead of coercing it
 *
 * Everything here flows into `ScanNutritionService`, which requires finite
 * `number` inputs and throws on anything else — including numeric strings. If
 * this object coerced (`Number(grams)`, `Number(x) || 0`), three things go
 * wrong. `Number(undefined)` is NaN, which is not `null`, so `isComplete`
 * reports true and the entry reaches auto-accept before failing.
 * `Number(null)` is 0, a confident silent zero. And `Number('500')` succeeds
 * here but is refused downstream, so the composition would claim a completeness
 * the pipeline cannot deliver. A composition with weight AND density
 * auto-accepts into nutrition history with no human confirmation, which is why
 * the posture throughout is reject-loudly rather than coerce-quietly.
 *
 * Validation runs BEFORE construction, so a rejected `with*` yields no instance
 * at all — never a half-built one — and leaves the receiver untouched.
 *
 * The one value that is stored rather than refused is a NEGATIVE weight: a scale
 * genuinely reads below zero after an item is lifted off, and `computeNet`
 * already owns the decision to clamp-and-flag it. Refusing it here would
 * pre-empt that.
 *
 * @module nutrition/value-objects/Composition
 */

import { ValidationError } from '#domains/core/errors/index.mjs';
// Imported from the module directly, NOT the `#domains/nutrition` barrel: the
// barrel re-exports this file, so a barrel import would cycle.
import { MAX_DENSITY_LEVEL } from '../services/ScanVocabularyService.mjs';

/** Unit assumed when a weight payload omits one. */
const DEFAULT_UNIT = 'g';

/**
 * Render a received value for an error message.
 *
 * Mirrors `ScanNutritionService`'s helper for the same reason: callers that
 * surface these errors log `err.message` alone and drop the structured payload,
 * so someone debugging at the fridge needs to see what actually arrived.
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
 * @param {unknown} value
 * @param {string} field
 * @param {string} code
 * @returns {string}
 * @throws {ValidationError} If not a non-empty string.
 */
function requireNonEmptyString(value, field, code) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(
      `${field} must be a non-empty string (received: ${describeValue(value)})`,
      { code, field, value },
    );
  }
  return value;
}

/**
 * An empty slot is `null` or `undefined`; anything else must satisfy the slot's
 * validator. Only the constructor may treat an absent value as an empty slot —
 * the `with*` setters pass values straight to the validators, so `withDensity(null)`
 * is a rejection rather than a slot-clearing operation.
 *
 * @template T
 * @param {unknown} value
 * @param {(v: unknown) => T} validate
 * @returns {T|null}
 */
function emptyOr(value, validate) {
  if (value === null || value === undefined) return null;
  return validate(value);
}

/**
 * Must be a finite number.
 *
 * `typeof` is checked before `Number.isFinite` so a numeric string is rejected
 * rather than quietly passing.
 *
 * @param {unknown} grams
 * @returns {number}
 * @throws {ValidationError}
 */
function validateGrams(grams) {
  if (typeof grams !== 'number' || !Number.isFinite(grams)) {
    throw new ValidationError(
      `grams must be a finite number (received: ${describeValue(grams)})`,
      { code: 'INVALID_WEIGHT', field: 'grams', value: grams },
    );
  }
  return grams;
}

/**
 * @param {unknown} unit
 * @returns {string}
 * @throws {ValidationError}
 */
function validateUnit(unit) {
  return requireNonEmptyString(unit, 'unit', 'INVALID_WEIGHT_UNIT');
}

/**
 * Range-checked here even though `parseScan` already guarantees an integer
 * 1..MAX_DENSITY_LEVEL, because this object is reachable from callers that never
 * touched the parser — a Telegram button, a replayed record. The failure it
 * prevents is a misdiagnosis: an out-of-range level would sail through to
 * `computeNutrition`, miss the config table, and surface as
 * MALFORMED_DENSITY_LEVEL — "fix the YAML" — when the truth is "rescan".
 *
 * @param {unknown} density
 * @returns {number}
 * @throws {ValidationError}
 */
function validateDensity(density) {
  if (!Number.isInteger(density) || density < 1 || density > MAX_DENSITY_LEVEL) {
    throw new ValidationError(
      `density level must be an integer 1-${MAX_DENSITY_LEVEL} (received: ${describeValue(density)})`,
      { code: 'INVALID_DENSITY_LEVEL', field: 'density', value: density },
    );
  }
  return density;
}

/**
 * Checked for usability but NOT against `ScanVocabularyService`'s id pattern:
 * that regex is the printed grammar's business and is not exported, and
 * restating it here would create exactly the sheet-versus-parser drift
 * `ScanVocabularyService` exists to prevent.
 *
 * An unknown-but-well-formed id is therefore NOT caught here. A container
 * missing from the table resolves to `undefined`, and `computeNet` reads an
 * absent container as "no tare" and returns silently — so a mistyped or retired
 * container id yields an untared entry rather than an error. Whoever resolves
 * ids against the container table has to reject the miss explicitly; do not
 * assume this layer or `ScanNutritionService` will surface it.
 *
 * @param {unknown} container
 * @returns {string}
 * @throws {ValidationError}
 */
function validateContainer(container) {
  return requireNonEmptyString(container, 'container', 'INVALID_CONTAINER_ID');
}

/**
 * @param {unknown} value
 * @param {string} code
 * @param {string} field
 * @throws {ValidationError} If not a plain-ish object.
 */
function requireObject(value, code, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(
      `${field} must be an object (received: ${describeValue(value)})`,
      { code, field, value },
    );
  }
  return value;
}

/** Immutable snapshot of one in-progress food composition. */
export class Composition {
  #grams;
  #unit;
  #density;
  #container;

  /**
   * @param {object} slots
   * @param {number|null} [slots.grams]
   * @param {string|null} [slots.unit]
   * @param {number|null} [slots.density]
   * @param {string|null} [slots.container]
   * @throws {ValidationError} If any present slot is unusable.
   */
  constructor(slots) {
    requireObject(slots, 'INVALID_COMPOSITION_DATA', 'composition data');

    const { grams, unit, density, container } = slots;

    // Every slot is validated before a single field is assigned, so a rejected
    // construction produces no object rather than a partially populated one.
    const checked = {
      grams: emptyOr(grams, validateGrams),
      unit: emptyOr(unit, validateUnit),
      density: emptyOr(density, validateDensity),
      container: emptyOr(container, validateContainer),
    };

    this.#grams = checked.grams;
    this.#unit = checked.unit;
    this.#density = checked.density;
    this.#container = checked.container;

    Object.freeze(this);
  }

  get grams() { return this.#grams; }
  get unit() { return this.#unit; }
  get density() { return this.#density; }
  get container() { return this.#container; }

  /**
   * Weight AND density (D4): those two are what auto-accept requires. A
   * container is optional enrichment and never gates completeness, and neither
   * does the unit — a volumetric 'ml' is carried faithfully and the refusal, if
   * any, belongs to the application layer.
   *
   * Compared against `null` rather than tested for truthiness, so a genuine
   * zero-gram reading still counts as a weight.
   *
   * @returns {boolean}
   */
  get isComplete() {
    return this.#grams !== null && this.#density !== null;
  }

  /** A composition with every slot empty. */
  static empty() {
    return new Composition({});
  }

  /**
   * Reconstitute from a plain object. Stored data gets the same validation as a
   * live scan — a corrupted or hand-edited record must fail loudly rather than
   * reach auto-accept.
   *
   * @param {object} data
   * @returns {Composition}
   * @throws {ValidationError}
   */
  static fromData(data) {
    return new Composition(data);
  }

  /**
   * A new composition carrying this weight.
   *
   * An absent unit reads as grams: the field is literally named `grams`, the
   * scale's canonical unit is grams, and a defaulted unit label cannot fabricate
   * a nutrient figure the way a defaulted number could. A unit that is PRESENT
   * but unusable is a different story — that is a malformed frame, and 'ml'
   * silently becoming 'g' would mislabel the entry.
   *
   * Weight is stored VERBATIM, not rounded. The bridge already rounds before it
   * gets here, `ScanNutritionService` needs no integer, and rounding twice only
   * risks disagreement.
   *
   * @param {{grams: number, unit?: string|null}} payload
   * @returns {Composition}
   * @throws {ValidationError} If the payload or its weight or unit is unusable.
   */
  withWeight(payload) {
    // Validated as an object before destructuring: `withWeight()` or
    // `withWeight(null)` would otherwise throw a bare TypeError, which a caller
    // catching ValidationError will not handle.
    requireObject(payload, 'INVALID_WEIGHT_PAYLOAD', 'weight payload');

    const { grams, unit } = payload;

    // Validated here rather than left to the constructor, which reads an absent
    // value as an empty slot. At this setter an absent weight is a rejection.
    validateGrams(grams);
    const resolvedUnit = (unit === undefined || unit === null)
      ? DEFAULT_UNIT
      : validateUnit(unit);

    return new Composition({
      grams,
      unit: resolvedUnit,
      density: this.#density,
      container: this.#container,
    });
  }

  /**
   * A new composition carrying this caloric-density level.
   *
   * @param {number} level Integer 1..MAX_DENSITY_LEVEL.
   * @returns {Composition}
   * @throws {ValidationError} If the level is outside the printed grammar.
   */
  withDensity(level) {
    // Null reads as "empty slot" in the constructor; at this setter it is simply
    // not a level, so it is refused like any other unusable input.
    validateDensity(level);

    return new Composition({
      grams: this.#grams,
      unit: this.#unit,
      density: level,
      container: this.#container,
    });
  }

  /**
   * A new composition carrying this container/tare id.
   *
   * @param {string} containerId
   * @returns {Composition}
   * @throws {ValidationError} If the container id is unusable.
   */
  withContainer(containerId) {
    validateContainer(containerId);

    return new Composition({
      grams: this.#grams,
      unit: this.#unit,
      density: this.#density,
      container: containerId,
    });
  }

  /**
   * Value equality across all four slots. Two compositions built by different
   * paths but holding the same slots are equal.
   *
   * @param {unknown} other
   * @returns {boolean}
   */
  equals(other) {
    if (!(other instanceof Composition)) return false;
    return this.#grams === other.grams
      && this.#unit === other.unit
      && this.#density === other.density
      && this.#container === other.container;
  }

  /**
   * A fresh plain object, safe to persist. Mutating it cannot reach back into
   * this composition.
   *
   * @returns {{grams: number|null, unit: string|null, density: number|null, container: string|null}}
   */
  toData() {
    return {
      grams: this.#grams,
      unit: this.#unit,
      density: this.#density,
      container: this.#container,
    };
  }
}
