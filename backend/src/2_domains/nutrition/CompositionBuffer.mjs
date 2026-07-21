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
 * @param {() => number} options.now REQUIRED clock. There is deliberately no
 *   `Date.now` default: this module's contract is deterministic window math, and a
 *   default would let a caller who forgets to inject silently get wall-clock aging
 *   that no test would catch. Making it required turns that into a startup error.
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
  const { windowMs = DEFAULT_WINDOW_MS, now } = options ?? {};

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
     * exists to prevent.
     *
     * An unknown-but-well-formed id is therefore NOT caught anywhere today. A
     * container missing from the table resolves to `undefined`, and `computeNet`
     * reads an absent container as "no tare" and returns silently — so a mistyped
     * or retired container id currently yields an untared entry rather than an
     * error. Whoever resolves ids against the container table (Task 4/5) has to
     * reject the miss explicitly; do not assume this layer or `scanNutrition`
     * will surface it.
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
     * UNCONDITIONAL: it consumes whether or not a weight was ever recorded. Gating
     * on a recorded weight looks safer and is not. `ScaleNutribotBridge` routinely
     * ends sessions that never yield a weight — the `min_grams` floor guard, and the
     * suspicion filter that suppresses a placement landing in the `storage_weight_g`
     * band or making a `heavy_g` jump after a post storm ("logged, not posted", see
     * `_extensions/food-scale-relay/config.example.yml`). Each opens on a rise and
     * ends at baseline with nothing posted. Under a weight-gate the scans would
     * survive all of them and the NEXT real weight would inherit a density and a
     * tare that belong to no food on the scale — then auto-accept, because weight
     * plus density is the accept condition.
     *
     * The two failure directions are not symmetric. Consuming too eagerly loses a
     * pre-scan: the entry comes back incomplete and the user rescans, having seen
     * it. Consuming too little writes a wrong calorie count to history with nobody
     * watching. Prefer the visible failure.
     *
     * ## Integration requirement (Task 4/5) — call this on the TRANSITION only
     *
     * Because there is no weight-gate left to absorb it, the caller now owns the
     * edge detection. `rise <= baselineTolG` is true on EVERY settled at-rest frame,
     * and the firmware emits those at 0.5 Hz forever while the scale sits on its
     * shelf. Calling `endPlacement` per at-rest frame would consume any pre-scan
     * within about two seconds and make scan-before-placing impossible — the flow
     * this buffer exists to support. Call it once, when the scale CROSSES from
     * placed to at-rest.
     *
     * @param {string} scaleId
     * @returns {boolean} Whether there was anything live to consume.
     */
    endPlacement(scaleId) {
      requireScaleId(scaleId);
      const had = live(scaleId) !== null;
      scales.delete(scaleId);
      return had;
    },

    /**
     * Discard everything for a scale — the `rs:clear` scan.
     *
     * Mechanically identical to `endPlacement` — both wipe the scale's slots and
     * report whether anything was live. They are kept separate because they mean
     * different things and are expected to diverge: this one is the human saying
     * "forget it" and pairs with a user-visible ack, while `endPlacement` is the
     * machine observing that a placement finished. Collapsing them into one method
     * would make the call sites lie about which event occurred, and would have to
     * be un-collapsed the moment either side grows a distinct behaviour.
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
