// backend/src/3_applications/nutribot/CompositionStore.mjs

/**
 * Per-scale composition state for scan-enriched food logging.
 *
 * Holds a `Map<scaleId, { composition, touchedAt }>` and the window/expiry rules
 * around it. The slots themselves live in the `Composition` value object
 * (`2_domains/nutrition/value-objects/Composition.mjs`); this store owns only
 * *where* a composition lives, *how long* it lives, and *what ends it*. It never
 * reimplements `Composition`'s validation — it constructs the next composition
 * and lets the value object throw.
 *
 * A weight and a density may arrive in any order — a scan may precede its
 * placement or follow it — and the store converges to the same state either way.
 * That order independence is the correctness claim, so the permutation test is
 * the load test, not a formality.
 *
 * ## The window refresh set EXCLUDES raw scale frames
 *
 * Refreshes come from `setWeight` / `setDensity` / `setContainer` only —
 * vocabulary scans and qualifying placements. The scale firmware heartbeats at
 * 0.5 Hz continuously while it rests on its shelf (`emit.heartbeat_hz` in
 * `_extensions/food-scale-relay/config.example.yml`), so a frame-driven refresh
 * would mean the window never expires and the store never forgets. `read()` does
 * not refresh either — polling is not activity.
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
 * ## A rejected setter leaves the store exactly as it was
 *
 * No half-filled slot, and no window refresh: a call that did not happen must not
 * extend the window. That guarantee is split across two objects now —
 * `Composition` never yields a partially built instance, and this store never
 * writes `touchedAt` until the new composition exists. Hence the ordering in
 * every setter: build first, write second.
 *
 * @module nutribot/CompositionStore
 */

import { ValidationError } from '#domains/core/errors/index.mjs';
// Explicit `/index.mjs`: `#domains/*` maps to a literal path with no directory
// resolution, so the bare barrel form throws ERR_UNSUPPORTED_DIR_IMPORT under
// plain Node even though Vitest resolves it. This file is loaded at boot.
import { Composition } from '#domains/nutrition/index.mjs';

/** Default rolling window: 15 minutes (D2). */
const DEFAULT_WINDOW_MS = 900_000;

/**
 * Render a received value for an error message.
 *
 * Mirrors `Composition`'s helper for the same reason: callers that surface these
 * errors log `err.message` alone and drop the structured payload, so someone
 * debugging at the fridge needs to see what actually arrived.
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
 * @param {unknown} scaleId
 * @returns {string}
 * @throws {ValidationError} If not a non-empty string.
 */
function requireScaleId(scaleId) {
  if (typeof scaleId !== 'string' || scaleId.length === 0) {
    throw new ValidationError(
      `scaleId must be a non-empty string (received: ${describeValue(scaleId)})`,
      { code: 'INVALID_SCALE_ID', field: 'scaleId', value: scaleId },
    );
  }
  return scaleId;
}

/** Per-scale composition state with a rolling expiry window. */
export class CompositionStore {
  #windowMs;
  #now;
  /** @type {Map<string, {composition: Composition, touchedAt: number}>} */
  #scales;

  /**
   * @param {object} [options]
   * @param {number} [options.windowMs=900000] Rolling window in ms. Must be
   *   finite and positive — a zero or negative window would expire every slot on
   *   arrival, silently disabling scan enrichment rather than failing loudly.
   * @param {() => number} options.now REQUIRED clock. There is deliberately no
   *   `Date.now` default: this store's contract is deterministic window math, and
   *   a default would let a caller who forgets to inject silently get wall-clock
   *   aging that no test would catch. Making it required turns that into a
   *   startup error.
   * @throws {ValidationError} If `windowMs` or `now` is unusable.
   */
  constructor(options = {}) {
    const { windowMs = DEFAULT_WINDOW_MS, now } = options ?? {};

    if (typeof windowMs !== 'number' || !Number.isFinite(windowMs) || windowMs <= 0) {
      throw new ValidationError(
        `windowMs must be a finite positive number (received: ${describeValue(windowMs)})`,
        { code: 'INVALID_WINDOW_MS', field: 'windowMs', value: windowMs },
      );
    }
    if (typeof now !== 'function') {
      throw new ValidationError(
        `now must be a function (received: ${describeValue(now)})`,
        { code: 'INVALID_CLOCK', field: 'now', value: now },
      );
    }

    this.#windowMs = windowMs;
    this.#now = now;
    this.#scales = new Map();

    // Bound so the methods survive destructuring. The bridge and the scan
    // handler are separate call sites and either may pull `read` off the store;
    // unbound class methods would throw on the private-field access.
    this.setWeight = this.setWeight.bind(this);
    this.setDensity = this.setDensity.bind(this);
    this.setContainer = this.setContainer.bind(this);
    this.endPlacement = this.endPlacement.bind(this);
    this.clear = this.clear.bind(this);
    this.read = this.read.bind(this);
  }

  /**
   * The live entry for a scale, or null. Expired entries are dropped on sight
   * rather than merged into whatever arrives next — a stale density must never
   * attach itself to a fresh weight.
   *
   * The boundary is INCLUSIVE: an entry touched exactly `windowMs` ago is still
   * live, so the comparison is strictly greater-than.
   *
   * @param {string} scaleId
   * @returns {{composition: Composition, touchedAt: number}|null}
   */
  #live(scaleId) {
    const entry = this.#scales.get(scaleId);
    if (!entry) return null;
    if (this.#now() - entry.touchedAt > this.#windowMs) {
      this.#scales.delete(scaleId);
      return null;
    }
    return entry;
  }

  /**
   * The live composition for a scale, or an empty one to build on.
   *
   * @param {string} scaleId
   * @returns {Composition}
   */
  #current(scaleId) {
    return this.#live(scaleId)?.composition ?? Composition.empty();
  }

  /**
   * Store a composition and refresh the window.
   *
   * Callers MUST have already built `composition` — that construction is what
   * validates, and it has to happen before this is reached so a rejected setter
   * leaves `touchedAt` alone.
   *
   * @param {string} scaleId
   * @param {Composition} composition
   */
  #commit(scaleId, composition) {
    this.#scales.set(scaleId, { composition, touchedAt: this.#now() });
  }

  /**
   * Record a weight. Refreshes the window: a qualifying placement is activity,
   * unlike the raw frames that produced it.
   *
   * @param {string} scaleId
   * @param {{grams: number, unit?: string|null}} payload
   * @returns {object} The resulting snapshot.
   * @throws {ValidationError} If the scale id, the payload, or its weight or unit
   *   is unusable.
   */
  setWeight(scaleId, payload) {
    requireScaleId(scaleId);
    const next = this.#current(scaleId).withWeight(payload);
    this.#commit(scaleId, next);
    return this.read(scaleId);
  }

  /**
   * Record a scanned caloric-density level. Refreshes the window.
   *
   * @param {string} scaleId
   * @param {number} level Integer 1..MAX_DENSITY_LEVEL.
   * @returns {object} The resulting snapshot.
   * @throws {ValidationError} If the scale id or the level is unusable.
   */
  setDensity(scaleId, level) {
    requireScaleId(scaleId);
    const next = this.#current(scaleId).withDensity(level);
    this.#commit(scaleId, next);
    return this.read(scaleId);
  }

  /**
   * Record a scanned container/tare id. Refreshes the window.
   *
   * An unknown-but-well-formed id is NOT caught here or by `Composition` — a
   * container missing from the table resolves to `undefined`, and `computeNet`
   * reads an absent container as "no tare" and returns silently. Whoever resolves
   * ids against the container table has to reject the miss explicitly.
   *
   * @param {string} scaleId
   * @param {string} containerId
   * @returns {object} The resulting snapshot.
   * @throws {ValidationError} If the scale id or the container id is unusable.
   */
  setContainer(scaleId, containerId) {
    requireScaleId(scaleId);
    const next = this.#current(scaleId).withContainer(containerId);
    this.#commit(scaleId, next);
    return this.read(scaleId);
  }

  /**
   * Consume the composition at the end of a placement (D10) — the bridge's
   * session-end, `rise <= baselineTolG`, and after a post.
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
   * ## Integration requirement — call this on the TRANSITION only
   *
   * Because there is no weight-gate left to absorb it, the caller owns the edge
   * detection. `rise <= baselineTolG` is true on EVERY settled at-rest frame, and
   * the firmware emits those at 0.5 Hz forever while the scale sits on its shelf.
   * Calling `endPlacement` per at-rest frame would consume any pre-scan within
   * about two seconds and make scan-before-placing impossible — the flow this
   * store exists to support. Call it once, when the scale CROSSES from placed to
   * at-rest.
   *
   * @param {string} scaleId
   * @returns {boolean} Whether there was anything live to consume. An already
   *   expired entry reports false: it was not consumed by this placement.
   * @throws {ValidationError} If the scale id is unusable.
   */
  endPlacement(scaleId) {
    requireScaleId(scaleId);
    const had = this.#live(scaleId) !== null;
    this.#scales.delete(scaleId);
    return had;
  }

  /**
   * Discard everything for a scale — the `rs:clear` scan.
   *
   * Mechanically identical to `endPlacement` — both wipe the scale's entry and
   * report whether anything was live. They are kept separate because they mean
   * different things and are expected to diverge: this one is the human saying
   * "forget it" and pairs with a user-visible ack, while `endPlacement` is the
   * machine observing that a placement finished. Collapsing them into one method
   * would make the call sites lie about which event occurred, and would have to be
   * un-collapsed the moment either side grows a distinct behaviour.
   *
   * @param {string} scaleId
   * @returns {boolean} Whether there was anything live to clear. Drives the
   *   "nothing to clear" ack on a bare `rs:clear`.
   * @throws {ValidationError} If the scale id is unusable.
   */
  clear(scaleId) {
    requireScaleId(scaleId);
    const had = this.#live(scaleId) !== null;
    this.#scales.delete(scaleId);
    return had;
  }

  /**
   * Snapshot of a scale's composition. Never refreshes the window, and returns a
   * fresh plain object each call so a caller cannot reach store state through it.
   *
   * `active` distinguishes "no entry here" from "a live entry with nothing in it
   * yet" — the two are otherwise identical all-null reads, and the `rs:clear` ack
   * and any operator diagnostics need to tell them apart.
   *
   * `complete` is weight AND density, per D4: those two are what auto-accept
   * requires. A container is optional enrichment and never gates completeness.
   *
   * @param {string} scaleId
   * @returns {{grams: number|null, unit: string|null, density: number|null,
   *   container: string|null, complete: boolean, active: boolean}}
   * @throws {ValidationError} If the scale id is unusable.
   */
  read(scaleId) {
    requireScaleId(scaleId);
    const entry = this.#live(scaleId);
    const composition = entry?.composition ?? Composition.empty();
    return {
      ...composition.toData(),
      complete: composition.isComplete,
      active: entry !== null,
    };
  }
}
