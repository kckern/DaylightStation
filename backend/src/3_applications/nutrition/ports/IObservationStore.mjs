/**
 * IObservationStore Port
 *
 * The application-facing contract for the durable kitchen-scale OBSERVATION ledger:
 * one row per raw signal (a settled weight, a scanned density level, a scanned
 * container tare, a scanned UPC), persisted per user so a signal survives a backend
 * restart and can be re-paired to a food-log entry after the fact.
 *
 * ## Why this port exists (Task 5.3, deliberately not created by Task 5.1)
 *
 * `ObservationService` (`#apps/nutrition/ObservationService.mjs`) is application code,
 * and the layer ratchet (`apps-no-adapters`) forbids it from importing
 * `YamlObservationStore` — or any other `1_adapters/` module — directly. The service
 * therefore depends on THIS interface and the composition root injects the concrete
 * adapter. `YamlObservationStore` extends it (D7: an adapter that imports an
 * application port must explicitly extend it rather than duck-type it).
 *
 * ## Contract notes that are NOT free-form
 *
 * These are load-bearing for `ObservationService` and are restated here so an
 * alternative implementation cannot quietly weaken them:
 *
 * - **A missing file is an empty day; a CORRUPT file is an error.** Read methods return
 *   `[]` for a user who has never had an observation. A file that exists but cannot be
 *   parsed throws (`InfrastructureError`, `code: 'CORRUPT_OBSERVATIONS_FILE'`). Those
 *   two must stay distinguishable — collapsing them makes a corrupt file read exactly
 *   like a clean day, which is the case quiet-commit is least likely to double-check.
 * - **`updateMany` is ALL-OR-NOTHING**, in ONE read-modify-write cycle. A completed
 *   composition consumes up to three observations into one entry; a partial application
 *   is not a lesser success, it is the corruption the batch exists to prevent. A missing
 *   id throws `NOT_FOUND` naming every missing id, and nothing is written. An
 *   implementation that cannot write its whole batch atomically must REFUSE the batch
 *   (`CROSS_FILE_BATCH`) before writing anything rather than apply the part it can:
 *   `YamlObservationStore` stores a bounded hot file plus monthly archives, and a batch
 *   spanning two of them was measured leaving the hot half applied and the cold half not.
 *   Only a manual re-pair of already-resolved history can produce such a batch — the
 *   composition consume path this method exists for patches only OPEN rows, which are
 *   never archived.
 * - **Rows are never deleted.** `status` moves `open -> consumed | dismissed`; the row
 *   stays. A dismissed observation is evidence that a signal arrived and was judged not
 *   to matter, which is what someone debugging "why didn't my weight show up" needs.
 * - **`date` is derived from `at`, never supplied.** `at` is a LOCAL timestamp
 *   (`YYYY-MM-DD HH:mm:ss`), never a UTC ISO string. A malformed `at` is refused, not
 *   defaulted to today and not dropped.
 * - **`openForScale` / `findByPairedEntry` are NOT date-scoped**, because the 900s
 *   composition window can straddle midnight.
 *
 * @module nutrition/ports/IObservationStore
 */

/** @typedef {'weight'|'upc'|'container'|'density'} ObservationKind */
/** @typedef {'open'|'consumed'|'dismissed'} ObservationStatus */

/**
 * @typedef {object} Observation
 * @property {string} id
 * @property {ObservationKind} kind
 * @property {number|string} value
 * @property {string|null} unit
 * @property {string} scaleId
 * @property {string} at Local timestamp `YYYY-MM-DD HH:mm:ss`.
 * @property {string} date `YYYY-MM-DD`, derived from `at`.
 * @property {ObservationStatus} status
 * @property {string|null} pairedEntryUuid
 */

export class IObservationStore {
  /**
   * Append a new observation. Assigns `id`, derives `date` from `at`, starts the row at
   * `status: 'open'` / `pairedEntryUuid: null`.
   *
   * @param {string} userId
   * @param {{kind: ObservationKind, value: number|string, unit?: string|null,
   *   scaleId: string, at: string}} obs
   * @returns {Observation}
   */
  append(userId, obs) {
    throw new Error('IObservationStore.append must be implemented');
  }

  /**
   * All observations for a calendar date, oldest first.
   *
   * @param {string} userId
   * @param {string} date `YYYY-MM-DD`
   * @returns {Observation[]}
   */
  listByDate(userId, date) {
    throw new Error('IObservationStore.listByDate must be implemented');
  }

  /**
   * Read one observation by bare id. Performs no write.
   *
   * @param {string} userId
   * @param {string} id
   * @returns {Observation}
   */
  get(userId, id) {
    throw new Error('IObservationStore.get must be implemented');
  }

  /**
   * Patch `status` / `pairedEntryUuid` on one observation. Everything else is
   * immutable history.
   *
   * @param {string} userId
   * @param {string} id
   * @param {{status?: ObservationStatus, pairedEntryUuid?: string|null}} patch
   * @returns {Observation}
   */
  update(userId, id, patch) {
    throw new Error('IObservationStore.update must be implemented');
  }

  /**
   * Apply a batch of per-id patches atomically — ALL-OR-NOTHING. A batch the
   * implementation cannot write atomically is refused outright (`ValidationError`,
   * `CROSS_FILE_BATCH`) with nothing written — never partially applied.
   *
   * @param {string} userId
   * @param {Array<{id: string, status?: ObservationStatus, pairedEntryUuid?: string|null}>} patches
   * @returns {Observation[]}
   */
  updateMany(userId, patches) {
    throw new Error('IObservationStore.updateMany must be implemented');
  }

  /**
   * The still-`open` observations for one scale, oldest first, across ALL dates.
   *
   * @param {string} userId
   * @param {string} scaleId
   * @returns {Observation[]}
   */
  openForScale(userId, scaleId) {
    throw new Error('IObservationStore.openForScale must be implemented');
  }

  /**
   * Every observation currently paired to a food-log entry, oldest first, across ALL
   * dates. An array, because one entry can be the target of several observations.
   *
   * @param {string} userId
   * @param {string} entryUuid
   * @returns {Observation[]}
   */
  findByPairedEntry(userId, entryUuid) {
    throw new Error('IObservationStore.findByPairedEntry must be implemented');
  }
}

/**
 * Duck-type check for callers that accept an injected store without importing the class.
 *
 * @param {any} obj
 * @returns {boolean}
 */
export function isObservationStore(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return (
    typeof obj.append === 'function' &&
    typeof obj.listByDate === 'function' &&
    typeof obj.update === 'function' &&
    typeof obj.updateMany === 'function' &&
    typeof obj.openForScale === 'function'
  );
}

export default IObservationStore;
