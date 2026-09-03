/**
 * YamlObservationStore - durable per-user store for kitchen-scale observations.
 *
 * Replaces the in-memory `CompositionStore` (`3_applications/nutribot/CompositionStore.mjs`)
 * as the durability layer for scale signals — a weight, a scanned barcode, a container
 * tare, a scanned caloric-density level. `CompositionStore` still owns the ROLLING WINDOW
 * and slot-merge logic in memory; this store is the ledger underneath it, so a signal
 * survives a backend restart, is visible on the day it happened, and can be re-paired to
 * the right food-log entry after the fact. It does not replace `CompositionStore`'s window
 * math — that is a separate, later task.
 *
 * ## Storage shape: ONE file per user, not one per day
 *
 * `lifelog/nutrition/observations.yml`, resolved through the injected `dataService`
 * exactly as `YamlNutriListDatastore` resolves `nutrilist.yml` — same directory
 * convention (`users/{userId}/lifelog/nutrition/...`), same "whole list is small enough
 * to read/write in one shot" assumption `YamlNutriLogDatastore` and `YamlNutriListDatastore`
 * both make for their own per-user files.
 *
 * A single file (filtered by `date` in memory) beats a file per user-day for the exact
 * reason called out in the design brief: the composition matcher's 900s window can
 * straddle midnight. Sharded-by-day storage would force `openForScale` to open two files
 * (today's and yesterday's) and reconcile scaleId matches across both; one file makes that
 * a single in-memory filter with no day-boundary logic anywhere in this class. The
 * tradeoff is unbounded file growth over the life of a user — scale observations are a
 * handful of rows per day, not a per-request log, so this is not expected to reach the
 * sizes that make `YamlNutriListDatastore` need hot/cold archiving. If it ever does, that
 * is a follow-up, not a reason to complicate this file today.
 *
 * ## Observations are never deleted, only marked
 *
 * There is no `remove` / `delete` method. `status` moves `open -> consumed | dismissed`
 * via `update()`; the row stays in the file. This mirrors the program's standing rule that
 * logged things are not silently destroyed (see `settled`-absence handling elsewhere in
 * nutrition persistence, and the "NEVER rm in the data tree" project convention) — a
 * dismissed observation is evidence that a signal arrived and was judged not to matter,
 * which is itself useful when someone is debugging "why didn't my weight show up".
 *
 * ## Malformed-file posture: FAIL LOUD, distinguishably from "no data"
 *
 * A MISSING file (`ENOENT`) is a normal empty day — every read method returns `[]`,
 * with no error and no log line, because "this user has never had a scale observation
 * yet" is not a fault.
 *
 * A file that EXISTS but cannot be parsed (corrupt YAML) or does not deserialize to an
 * array (some other shape landed at this path) is NOT collapsed into the same `[]`. Doing
 * that would make a corrupt file indistinguishable from a clean day, and a clean day is
 * exactly the case quiet-commit and the day view are least likely to double-check. Instead
 * every read method logs `observationStore.read.corrupt` at `error` and throws an
 * `InfrastructureError` (`code: 'CORRUPT_OBSERVATIONS_FILE'`). That is a controlled,
 * typed throw a caller can catch by `err.code` — not an unhandled parser exception — but
 * it does not get swallowed into a value that reads the same as "nothing happened today".
 *
 * ## No-plausible-day posture: refuse the write, do not guess or drop
 *
 * `append()` requires `at`, a LOCAL timestamp string in the codebase's standard
 * `formatLocalTimestamp` shape (`YYYY-MM-DD HH:mm:ss` — see
 * `#domains/core/utils/time.mjs`). `date` is never accepted as a separate caller-supplied
 * field; it is always derived by slicing `at`, so the two can never disagree. A missing,
 * non-string, or malformed `at` throws `ValidationError` (`code: 'INVALID_OBSERVATION_AT'`)
 * — the observation is never written and never silently discarded. This mirrors
 * `YamlNutriListDatastore.saveMany`'s date-integrity guard ("accepting undefined or
 * malformed dates silently has caused real data to be bucketed to the wrong day. Fail
 * loudly.") and `CompositionStore`'s `requireScaleId` — both fail the call outright rather
 * than defaulting. The caller (the scale bridge, in a later task) decides what "no
 * plausible day" means for a raw scale frame — that is a clock-skew / retry policy
 * decision this storage layer has no basis to make on its own, so it declines to guess a
 * wrong day rather than picking one silently.
 *
 * ## Explicit `/index.mjs` on `#domains/*` imports
 *
 * `#domains/*` maps to a literal path with no directory resolution, so the bare barrel
 * form throws `ERR_UNSUPPORTED_DIR_IMPORT` under plain Node even though Vitest resolves
 * it — this file is loaded at boot, so it uses the explicit form. Same reasoning as
 * `CompositionStore.mjs`.
 *
 * @module persistence/yaml/YamlObservationStore
 */

import { v4 as uuidv4 } from 'uuid';
import { readYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

/** The four scale signal kinds this store persists. */
const KNOWN_KINDS = Object.freeze(['weight', 'upc', 'container', 'density']);

/** Lifecycle states an observation can be in. Not the entry `status` enum — see module docstring. */
const KNOWN_STATUSES = Object.freeze(['open', 'consumed', 'dismissed']);

/** Fields `update()` is allowed to touch. Everything else about a row is immutable history. */
const PATCHABLE_FIELDS = Object.freeze(['status', 'pairedEntryUuid']);

/** `formatLocalTimestamp`'s exact output shape: `YYYY-MM-DD HH:mm:ss`, local, never UTC-`Z`. */
const LOCAL_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function describeValue(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return String(value);
  return typeof value;
}

function requireUserId(userId) {
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new ValidationError(
      `userId must be a non-empty string (received: ${describeValue(userId)})`,
      { code: 'INVALID_USER_ID', field: 'userId', value: userId },
    );
  }
  return userId;
}

function requireScaleId(scaleId) {
  if (typeof scaleId !== 'string' || scaleId.length === 0) {
    throw new ValidationError(
      `scaleId must be a non-empty string (received: ${describeValue(scaleId)})`,
      { code: 'INVALID_SCALE_ID', field: 'scaleId', value: scaleId },
    );
  }
  return scaleId;
}

function requireDate(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    throw new ValidationError(
      `date must be a YYYY-MM-DD string (received: ${describeValue(date)})`,
      { code: 'INVALID_DATE', field: 'date', value: date },
    );
  }
  return date;
}

function requireAt(at) {
  if (typeof at !== 'string' || !LOCAL_TIMESTAMP_RE.test(at)) {
    // This IS the "no plausible day" guard: a missing or unparseable local
    // timestamp is refused here rather than defaulted to "today" (which would
    // misfile a clock-skewed reading under a wrong, confident-looking date) or
    // dropped silently (which would lose a real scale signal with no trace).
    throw new ValidationError(
      `at must be a local timestamp "YYYY-MM-DD HH:mm:ss" (received: ${describeValue(at)})`,
      { code: 'INVALID_OBSERVATION_AT', field: 'at', value: at },
    );
  }
  return at;
}

function requireKind(kind) {
  if (!KNOWN_KINDS.includes(kind)) {
    throw new ValidationError(
      `kind must be one of ${KNOWN_KINDS.join('|')} (received: ${describeValue(kind)})`,
      { code: 'INVALID_OBSERVATION_KIND', field: 'kind', value: kind },
    );
  }
  return kind;
}

function requireValue(value) {
  if (value === undefined) {
    throw new ValidationError('value is required (received: undefined)', {
      code: 'INVALID_OBSERVATION_VALUE', field: 'value', value,
    });
  }
  return value;
}

/** @typedef {'weight'|'upc'|'container'|'density'} ObservationKind */
/** @typedef {'open'|'consumed'|'dismissed'} ObservationStatus */

/**
 * @typedef {object} Observation
 * @property {string} id UUID, assigned by `append`.
 * @property {ObservationKind} kind
 * @property {number|string} value Grams for `weight`, the level for `density`, the
 *   scanned code for `upc`/`container`. This store does not constrain the type further —
 *   that is a domain concern one layer up, same division of labor `CompositionStore`
 *   draws with `Composition`.
 * @property {string|null} unit E.g. `'g'` for a weight. `null` where not applicable.
 * @property {string} scaleId Which physical scale produced the signal.
 * @property {string} at Local timestamp, `YYYY-MM-DD HH:mm:ss`. NEVER a UTC ISO string —
 *   see `docs/reference/nutrition/README.md` / the household-timezone convention in
 *   `#domains/core/utils/time.mjs`.
 * @property {string} date `YYYY-MM-DD`, derived from `at` (never independently supplied).
 * @property {ObservationStatus} status Starts `'open'`.
 * @property {string|null} pairedEntryUuid The NutriLog item this observation was matched
 *   to, once matched. `null` until then.
 */

/**
 * Durable per-user observation ledger for kitchen-scale signals.
 *
 * @implements durable replacement for the in-memory half of `CompositionStore`'s state
 */
export class YamlObservationStore {
  #dataService;
  #logger;

  /**
   * @param {object} options
   * @param {object} options.dataService DataService instance (uses `.user.resolveDir`).
   * @param {object} [options.logger] Injected logger (`.error`/`.warn`). Defaults to
   *   `console` only as a last resort — adapters that need real log routing should always
   *   inject one; see `YamlNutriListDatastore` for the identical fallback.
   */
  constructor(options) {
    if (!options?.dataService) {
      throw new InfrastructureError('YamlObservationStore requires dataService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataService',
      });
    }
    this.#dataService = options.dataService;
    this.#logger = options.logger || console;
  }

  // ==================== Path helpers ====================

  #basePath(userId) {
    return this.#dataService.user.resolveDir('lifelog/nutrition/observations', userId);
  }

  #filePath(userId) {
    return `${this.#basePath(userId)}.yml`;
  }

  // ==================== File I/O ====================

  /**
   * Read every observation for a user.
   *
   * @param {string} userId
   * @returns {Observation[]}
   * @throws {InfrastructureError} `CORRUPT_OBSERVATIONS_FILE` if the file exists but
   *   cannot be parsed, or does not deserialize to an array. Never thrown for a missing
   *   file — see the malformed-file posture in the module docstring.
   */
  #readAll(userId) {
    const filePath = this.#filePath(userId);
    let raw;
    try {
      raw = readYamlFromPath(filePath);
    } catch (err) {
      if (err?.code === 'ENOENT') return [];
      this.#logger.error?.('observationStore.read.corrupt', {
        userId, filePath, error: err?.message,
      });
      throw new InfrastructureError(
        `Observation file is corrupt and could not be parsed: ${filePath}`,
        { code: 'CORRUPT_OBSERVATIONS_FILE', filePath, userId, cause: err?.message },
      );
    }

    // `yaml.load('')` (an empty-but-existing file) returns `undefined` — that is a
    // normal empty day too, not a malformed shape.
    if (raw === null || raw === undefined) return [];

    if (!Array.isArray(raw)) {
      this.#logger.error?.('observationStore.read.malformedShape', {
        userId, filePath, typeOf: typeof raw,
      });
      throw new InfrastructureError(
        `Observation file has an unexpected shape (expected an array): ${filePath}`,
        { code: 'CORRUPT_OBSERVATIONS_FILE', filePath, userId },
      );
    }

    return raw;
  }

  #writeAll(userId, records) {
    saveYamlToPathAtomic(this.#filePath(userId), records, { noRefs: true, lineWidth: -1 });
  }

  // ==================== Public API ====================

  /**
   * Append a new observation. Assigns `id`, derives `date` from `at`, and starts the
   * record at `status: 'open'` / `pairedEntryUuid: null`.
   *
   * @param {string} userId
   * @param {object} obs
   * @param {ObservationKind} obs.kind
   * @param {number|string} obs.value
   * @param {string|null} [obs.unit]
   * @param {string} obs.scaleId
   * @param {string} obs.at Local timestamp `YYYY-MM-DD HH:mm:ss`.
   * @returns {Observation} The persisted record (a plain-object copy).
   * @throws {ValidationError} If any required field is missing or malformed. The
   *   observation is not written when this throws.
   * @throws {InfrastructureError} `CORRUPT_OBSERVATIONS_FILE` if the existing file
   *   cannot be read (see `#readAll`) — a corrupt file blocks new writes too, since
   *   appending would otherwise require silently discarding whatever else is in it.
   */
  append(userId, obs) {
    requireUserId(userId);
    const kind = requireKind(obs?.kind);
    const value = requireValue(obs?.value);
    const scaleId = requireScaleId(obs?.scaleId);
    const at = requireAt(obs?.at);
    const unit = obs?.unit ?? null;

    /** @type {Observation} */
    const record = {
      id: uuidv4(),
      kind,
      value,
      unit,
      scaleId,
      at,
      date: at.slice(0, 10),
      status: 'open',
      pairedEntryUuid: null,
    };

    const records = this.#readAll(userId);
    records.push(record);
    this.#writeAll(userId, records);

    return { ...record };
  }

  /**
   * All observations recorded for a given calendar date, oldest first.
   *
   * @param {string} userId
   * @param {string} date `YYYY-MM-DD`.
   * @returns {Observation[]} `[]` for a day with no observations OR a user who has never
   *   had one — see the malformed-file posture for the one case this does NOT mean.
   * @throws {InfrastructureError} `CORRUPT_OBSERVATIONS_FILE` — see `#readAll`.
   */
  listByDate(userId, date) {
    requireUserId(userId);
    requireDate(date);
    return this.#readAll(userId)
      .filter((r) => r.date === date)
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((r) => ({ ...r }));
  }

  /**
   * Update the lifecycle status and/or pairing of one observation by id. Only `status`
   * and `pairedEntryUuid` may be patched — `id`, `kind`, `value`, `unit`, `scaleId`,
   * `at`, and `date` are immutable history.
   *
   * @param {string} userId
   * @param {string} id
   * @param {{status?: ObservationStatus, pairedEntryUuid?: string|null}} patch
   * @returns {Observation} The updated record.
   * @throws {ValidationError} `UNKNOWN_PATCH_FIELD` if `patch` contains anything other
   *   than `status` / `pairedEntryUuid`; `INVALID_OBSERVATION_STATUS` if `status` is
   *   supplied but not one of the known lifecycle values.
   * @throws {InfrastructureError} `NOT_FOUND` if no observation with `id` exists;
   *   `CORRUPT_OBSERVATIONS_FILE` — see `#readAll`.
   */
  update(userId, id, patch) {
    requireUserId(userId);
    if (typeof id !== 'string' || id.length === 0) {
      throw new ValidationError(`id must be a non-empty string (received: ${describeValue(id)})`, {
        code: 'INVALID_OBSERVATION_ID', field: 'id', value: id,
      });
    }

    const patchKeys = Object.keys(patch ?? {});
    const unknown = patchKeys.filter((k) => !PATCHABLE_FIELDS.includes(k));
    if (unknown.length > 0) {
      throw new ValidationError(
        `update() may only patch ${PATCHABLE_FIELDS.join('/')} (received unknown field(s): ${unknown.join(', ')})`,
        { code: 'UNKNOWN_PATCH_FIELD', field: unknown[0], value: patch },
      );
    }
    if ('status' in (patch ?? {}) && !KNOWN_STATUSES.includes(patch.status)) {
      throw new ValidationError(
        `status must be one of ${KNOWN_STATUSES.join('|')} (received: ${describeValue(patch.status)})`,
        { code: 'INVALID_OBSERVATION_STATUS', field: 'status', value: patch.status },
      );
    }

    const records = this.#readAll(userId);
    const index = records.findIndex((r) => r.id === id);
    if (index === -1) {
      throw new InfrastructureError(`Observation not found: ${id}`, {
        code: 'NOT_FOUND', entity: 'Observation', id,
      });
    }

    records[index] = { ...records[index], ...patch };
    this.#writeAll(userId, records);

    return { ...records[index] };
  }

  /**
   * The still-`open` observations for one scale, oldest first, regardless of date.
   *
   * Deliberately not date-scoped: the composition matcher's rolling window (up to 900s,
   * per `docs/reference/nutrition/README.md`) can straddle midnight, and this store's
   * one-file-per-user layout means "regardless of date" costs nothing extra — no
   * yesterday/today file boundary to reconcile.
   *
   * @param {string} userId
   * @param {string} scaleId
   * @returns {Observation[]}
   * @throws {InfrastructureError} `CORRUPT_OBSERVATIONS_FILE` — see `#readAll`.
   */
  openForScale(userId, scaleId) {
    requireUserId(userId);
    requireScaleId(scaleId);
    return this.#readAll(userId)
      .filter((r) => r.scaleId === scaleId && r.status === 'open')
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((r) => ({ ...r }));
  }
}

export default YamlObservationStore;
