/**
 * Per-scale composition buffer for scan-enriched food logging.
 *
 * Three slots — `grams` / `density` / `container` — filled by whichever event
 * arrives, in any order, within a rolling window. A weight may precede its scans
 * or follow them; the buffer converges to the same state either way. That order
 * independence is this module's entire correctness claim, so the permutation test
 * is the load test, not a formality.
 *
 * ## The window refresh set EXCLUDES raw scale frames
 *
 * Refreshes come from vocabulary scans and qualifying placements only. The scale
 * firmware heartbeats at 0.5 Hz continuously while it rests on its shelf
 * (`emit.heartbeat_hz` in `_extensions/food-scale-relay/config.example.yml`), so a
 * frame-driven refresh would mean the window never expires and the buffer never
 * forgets. `read()` does not refresh either — polling is not activity.
 *
 * ## Slots are CONSUMED at placement end (D10)
 *
 * Without consumption, the second food of the evening inherits the first food's
 * density and tare: weigh yogurt with `dl:2` + `ct:small-bowl`, eat it, come back
 * six minutes later and weigh pasta without scanning, and the pasta logs as
 * level-2 density minus a 180 g bowl that is not on the scale — and auto-accepts,
 * because weight plus density is the auto-accept condition. That is an ordinary
 * evening, not an edge case.
 *
 * ## Why the setters refuse input instead of coercing it
 *
 * Everything buffered here flows into `scanNutrition`, which requires finite
 * `number` inputs and throws on anything else — including numeric strings. If this
 * buffer coerced (`Number(grams)`, `Math.round(Number(grams))`), three things go
 * wrong. `Number(undefined)` is NaN, which is not `null`, so `complete` reports
 * true and the entry reaches auto-accept before failing. `Number(null)` is 0, a
 * confident silent zero. And `Number('500')` succeeds here but is refused
 * downstream, so the buffer would report a completeness it cannot deliver.
 *
 * A rejected setter leaves the buffer exactly as it was — no half-filled slot, and
 * no window refresh. A call that did not happen must not extend the window.
 *
 * The one value that is stored rather than refused is a NEGATIVE weight: a scale
 * genuinely reads below zero after an item is lifted off, and `computeNet` already
 * owns the decision to clamp-and-flag it. Refusing it here would pre-empt that.
 *
 * @module nutrition/CompositionBuffer
 */

import { ValidationError } from '#domains/core/errors/index.mjs';
import { MAX_DENSITY_LEVEL } from './ScanVocabulary.mjs';

/** Default rolling window: 15 minutes (D2). */
const DEFAULT_WINDOW_MS = 900_000;

/** Unit assumed when a weight payload omits one. */
const DEFAULT_UNIT = 'g';

const emptySlots = () => ({
  grams: null,
  unit: null,
  density: null,
  container: null,
  touchedAt: 0,
});

/**
 * Render a received value for an error message.
 *
 * Mirrors `scanNutrition`'s helper for the same reason: callers that surface these
 * errors log `err.message` alone and drop the structured payload, so someone
 * debugging at the fridge needs to see what actually arrived.
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
 * @param {string} field
 * @param {string} code
 * @returns {string}
 * @throws {ValidationError} If not a non-empty string.
 */
function requireNonEmptyString(value, field, code) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(
      `${field} must be a non-empty string (received: ${describe(value)})`,
      { code, field, value },
    );
  }
  return value;
}

/**
 * Create a composition buffer.
 *
 * @param {object} [options]
 * @param {number} [options.windowMs=900000] Rolling window in ms. Must be finite
 *   and positive — a zero or negative window would expire every slot on arrival,
 *   silently disabling scan enrichment rather than failing loudly.
 * @param {() => number} [options.now] Clock injection. Supply a deterministic
 *   clock under test; this module never reads the wall clock itself.
 * @returns {{
 *   setWeight: (scaleId: string, payload: {grams: number, unit?: string}) => object,
 *   setDensity: (scaleId: string, level: number) => object,
 *   setContainer: (scaleId: string, containerId: string) => object,
 *   endPlacement: (scaleId: string) => boolean,
 *   clear: (scaleId: string) => boolean,
 *   read: (scaleId: string) => object,
 * }}
 * @throws {ValidationError} If `windowMs` or `now` is unusable.
 */
export function createCompositionBuffer(options = {}) {
  const { windowMs = DEFAULT_WINDOW_MS, now = () => Date.now() } = options ?? {};

  if (typeof windowMs !== 'number' || !Number.isFinite(windowMs) || windowMs <= 0) {
    throw new ValidationError(
      `windowMs must be a finite positive number (received: ${describe(windowMs)})`,
      { code: 'INVALID_WINDOW_MS', field: 'windowMs', value: windowMs },
    );
  }
  if (typeof now !== 'function') {
    throw new ValidationError(
      `now must be a function (received: ${describe(now)})`,
      { code: 'INVALID_CLOCK', field: 'now', value: now },
    );
  }

  /** @type {Map<string, ReturnType<typeof emptySlots>>} */
  const scales = new Map();

  const requireScaleId = (scaleId) =>
    requireNonEmptyString(scaleId, 'scaleId', 'INVALID_SCALE_ID');

  /**
   * Live slots for a scale, or null. Expired slots are dropped on sight rather
   * than merged into whatever arrives next — a stale density must never attach
   * itself to a fresh weight.
   *
   * The boundary is inclusive: a slot touched exactly `windowMs` ago is still live.
   */
  const live = (scaleId) => {
    const slots = scales.get(scaleId);
    if (!slots) return null;
    if (now() - slots.touchedAt > windowMs) {
      scales.delete(scaleId);
      return null;
    }
    return slots;
  };

  /** Fetch-or-create live slots and refresh the window. Callers must validate first. */
  const touch = (scaleId) => {
    let slots = live(scaleId);
    if (!slots) {
      slots = emptySlots();
      scales.set(scaleId, slots);
    }
    slots.touchedAt = now();
    return slots;
  };

  /**
   * Snapshot of a scale's slots. Never refreshes the window, and returns a fresh
   * object each call so a caller cannot mutate buffer state through it.
   *
   * `active` distinguishes "no buffer here" from "a live buffer with nothing in it
   * yet" — the two are otherwise identical all-null reads, and the `rs:clear` ack
   * and any operator diagnostics need to tell them apart.
   *
   * `complete` is weight AND density, per D4: those two are what auto-accept
   * requires. A container is optional enrichment and never gates completeness.
   */
  const read = (scaleId) => {
    requireScaleId(scaleId);
    const slots = live(scaleId);
    const s = slots ?? emptySlots();
    return {
      grams: s.grams,
      unit: s.unit,
      density: s.density,
      container: s.container,
      complete: s.grams !== null && s.density !== null,
      active: slots !== null,
    };
  };

  return {
    /**
     * Record a weight. Refreshes the window: a qualifying placement is activity,
     * unlike the raw frames that produced it.
     *
     * @param {string} scaleId
     * @param {{grams: number, unit?: string}} payload
     * @returns {object} The resulting snapshot.
     * @throws {ValidationError} If the payload or its weight is unusable.
     */
    setWeight(scaleId, payload) {
      requireScaleId(scaleId);

      // Validate the payload as an object before destructuring: `setWeight(id)` or
      // `setWeight(id, null)` would otherwise throw a bare TypeError from the
      // destructure, which a caller catching ValidationError will not handle.
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new ValidationError(
          `weight payload must be an object (received: ${describe(payload)})`,
          { code: 'INVALID_WEIGHT_PAYLOAD', field: 'payload', value: payload },
        );
      }

      const { grams, unit } = payload;
      if (typeof grams !== 'number' || !Number.isFinite(grams)) {
        throw new ValidationError(
          `grams must be a finite number (received: ${describe(grams)})`,
          { code: 'INVALID_WEIGHT', field: 'grams', value: grams },
        );
      }

      // An absent unit reads as grams: the field is literally named `grams`, the
      // scale's canonical unit is grams, and a defaulted unit label cannot
      // fabricate a nutrient figure the way a defaulted number could. A unit that
      // is PRESENT but unusable is a different story — that is a malformed frame,
      // and 'ml' silently becoming 'g' would mislabel the entry.
      let resolvedUnit = DEFAULT_UNIT;
      if (unit !== undefined && unit !== null) {
        resolvedUnit = requireNonEmptyString(unit, 'unit', 'INVALID_WEIGHT_UNIT');
      }

      // Weight is stored VERBATIM, not rounded. The bridge already rounds before
      // it gets here, and `scanNutrition` needs no integer; rounding is a storage
      // and display concern, and doing it twice only risks disagreement.
      const slots = touch(scaleId);
      slots.grams = grams;
      slots.unit = resolvedUnit;
      return read(scaleId);
    },

    /**
     * Record a scanned caloric-density level. Refreshes the window.
     *
     * The level is range-checked here even though `parseScan` already guarantees
     * an integer 1..MAX_DENSITY_LEVEL. This module is exported through the domain
     * barrel and reachable from callers that never touched the parser, and the
     * failure it prevents is a misdiagnosis: an out-of-range level would sail
     * through to `computeNutrition`, miss the config table, and surface as
     * MALFORMED_DENSITY_LEVEL — "fix the YAML" — when the truth is "rescan".
     * `scanNutrition` deliberately separates those two codes; honouring that
     * distinction costs three lines here.
     *
     * @param {string} scaleId
     * @param {number} level Integer 1..MAX_DENSITY_LEVEL.
     * @returns {object} The resulting snapshot.
     * @throws {ValidationError} If the level is outside the printed grammar.
     */
    setDensity(scaleId, level) {
      requireScaleId(scaleId);
      if (!Number.isInteger(level) || level < 1 || level > MAX_DENSITY_LEVEL) {
        throw new ValidationError(
          `density level must be an integer 1-${MAX_DENSITY_LEVEL} (received: ${describe(level)})`,
          { code: 'INVALID_DENSITY_LEVEL', field: 'level', value: level },
        );
      }
      const slots = touch(scaleId);
      slots.density = level;
      return read(scaleId);
    },

    /**
     * Record a scanned container/tare id. Refreshes the window.
     *
     * Checked for usability but NOT against `ScanVocabulary`'s id pattern: that
     * regex is the printed grammar's business and is not exported, and restating
     * it here would create exactly the sheet-versus-parser drift ScanVocabulary
     * exists to prevent. An unknown-but-well-formed id fails at table lookup,
     * where the error can name the missing container.
     *
     * @param {string} scaleId
     * @param {string} containerId
     * @returns {object} The resulting snapshot.
     * @throws {ValidationError} If the container id is unusable.
     */
    setContainer(scaleId, containerId) {
      requireScaleId(scaleId);
      requireNonEmptyString(containerId, 'containerId', 'INVALID_CONTAINER_ID');
      const slots = touch(scaleId);
      slots.container = containerId;
      return read(scaleId);
    },

    /**
     * Consume the slots at the end of a placement (D10) — the bridge's session-end,
     * `rise <= baselineTolG`, and after a post.
     *
     * Consumes ONLY when a weight was actually recorded. A session-end with no
     * weight is not a placement ending; it is noise — a bump, a re-baseline, a
     * settling shelf. Wiping on that would destroy scans the user made in advance
     * of putting the food down, which is the exact flow order-independence exists
     * to support, and would fail in the same silent direction as the leak this
     * method prevents.
     *
     * @param {string} scaleId
     * @returns {boolean} Whether a placement was consumed.
     */
    endPlacement(scaleId) {
      requireScaleId(scaleId);
      const slots = live(scaleId);
      if (!slots || slots.grams === null) return false;
      scales.delete(scaleId);
      return true;
    },

    /**
     * Discard everything for a scale — the `rs:clear` scan.
     *
     * Unconditional, which is the asymmetry with `endPlacement`: this is an
     * explicit human "forget it", so it wipes a weightless buffer of pre-scans too.
     * `endPlacement` is the machine inferring that a placement finished, and must
     * be conservative; `clear` is the human saying so, and must be total.
     *
     * @param {string} scaleId
     * @returns {boolean} Whether there was anything live to clear. Drives the
     *   "nothing to clear" ack on a bare `rs:clear`.
     */
    clear(scaleId) {
      requireScaleId(scaleId);
      const had = live(scaleId) !== null;
      scales.delete(scaleId);
      return had;
    },

    read,
  };
}
