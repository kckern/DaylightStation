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
 * a single in-memory filter with no day-boundary logic anywhere in this class.
 *
 * ## HOT file + monthly archives — because this file is written on a hardware path
 *
 * The original version of this store left the file unbounded, on the reasoning that scale
 * observations are a handful of rows per day. That reasoning was wrong about the COST, not
 * about the volume. `ObservationService.setWeight` reads, appends and re-reads on every
 * qualifying placement frame, and both halves are linear in the file. Measured on the prod
 * host, before archiving:
 *
 * ```
 *      0 rows            setWeight  11 ms
 *    900 rows  (146 KB)  setWeight  83 ms      one month at ~30 rows/day
 *  10 000 rows (1.6 MB)  setWeight 705 ms      one year
 *  20 000 rows (3.3 MB)  setWeight 1413 ms     two years
 * ```
 *
 * That is the shared single-threaded event loop which also serves the Player, Fitness and
 * the school Portal — one this repo already alerts on at 1 s (`system.event-loop.lag`).
 * The in-memory `Map` this store replaced was O(1), so this was the one place the durable
 * design was materially worse than what it replaced.
 *
 * The fix is `YamlNutriListDatastore`'s shape, not a new one: a bounded HOT file plus
 * per-month COLD archives at `lifelog/nutrition/archives/observations/{YYYY-MM}.yml`.
 * After archiving, on the same measurements:
 *
 * ```
 *  10 000 rows of history   setWeight  18 ms   (hot file ~200 rows)
 *  20 000 rows of history   setWeight  14 ms   (hot file ~195 rows)
 * ```
 *
 * — flat in total history, because the hot file is bounded by `HOT_ROLL_THRESHOLD_ROWS`
 * rather than by age.
 *
 * Three rules make it safe:
 *
 *  1. **Nothing is deleted.** Archiving is RELOCATION. The no-deletion contract below is
 *     unchanged: every row that was ever written is still readable, through `listByDate`,
 *     `findByPairedEntry`, `get` and `update`, which all consult archives.
 *  2. **An OPEN row is never archived, at any age.** That is what keeps `openForScale` —
 *     the one method on the frame path — correct while reading a single file.
 *  3. **The roll rides `append`.** No scheduler, no operator step, no window in which the
 *     file is unbounded because a job did not run. It is gated on row count, so the
 *     ordinary append never pays for the partition scan.
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
 * ## `updateMany` is ALL-OR-NOTHING
 *
 * A completed scale composition can consume up to three observations (a weight, a
 * density, a container tare) into one food-log entry. Applying that as N separate
 * `update()` calls means N separate read-modify-write-rename cycles; a crash or throw
 * between them can leave an entry backed by only some of its consumed observations, with
 * nothing able to detect the mismatch after the fact. `updateMany(userId, patches)`
 * applies a whole batch of per-id patches inside ONE read-modify-write-rename cycle, so
 * the set lands atomically or not at all.
 *
 * "Not at all" is a deliberate choice over "apply what you can and report the rest":
 * this method exists specifically for a consume operation where a partial application
 * is not a lesser success, it is exactly the corruption this fix was written to prevent —
 * two observations flip to `consumed` and point at an entry while a third stays `open`,
 * and nothing downstream can tell that happened short of a manual audit. Every id is
 * verified to exist BEFORE any write happens; if one is missing, `InfrastructureError`
 * `NOT_FOUND` is thrown (naming every missing id) and the file is untouched. Patch shape
 * (unknown fields, invalid `status`) is likewise validated for the whole batch before
 * touching the file — the same "build first, write second" discipline `CompositionStore`
 * documents for its own setters.
 *
 * ## `findByPairedEntry` is NOT date-scoped
 *
 * Same reasoning as `openForScale`: an entry's consumed observations are not guaranteed
 * to share the entry's own date (the 900s composition window can straddle midnight), so
 * the re-pair flow that needs to find "whichever observation(s) currently point at this
 * entry" cannot safely assume date-locality. Because storage is one file per user, "search
 * every row" costs nothing beyond a linear scan already implied by every other read
 * method here — there is no day-boundary reconciliation to get wrong. It returns an
 * ARRAY, not a single record, because one entry can be the pairing target of more than
 * one observation (weight + density + container all consumed into the same entry).
 *
 * ## `get` is READ-ONLY — it exists so a bare-id route never has to write to look up a row
 *
 * A pair/dismiss route typically receives only `:id` in its URL — no date, no scaleId,
 * no entry id — so none of `listByDate`/`openForScale`/`findByPairedEntry` can serve it.
 * `update(userId, id, {})` would technically return the row too, but only by taking an
 * unconditional write as a side effect — every lookup, including ones that turn out to be
 * no-ops or invalid, would touch disk. `get(userId, id)` performs no write, ever; it reads
 * through the same `#readAllValid` filter as every other read method, so a malformed row
 * is skipped identically rather than special-cased, and it throws the same `NOT_FOUND`
 * shape `update`/`updateMany` already raise so a caller can handle all three the same way.
 *
 * @module persistence/yaml/YamlObservationStore
 */

import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  readYamlFromPath, saveYamlToPathAtomic, dirExists, ensureDir, listYamlFiles,
} from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';
// The application-facing contract this adapter satisfies. D7: an adapter that imports
// an application port must EXTEND it rather than duck-type it, so the interface a
// service depends on and the class the composition root injects cannot drift apart.
import { IObservationStore } from '#apps/nutrition/ports/IObservationStore.mjs';

/**
 * A RESOLVED row older than this many days (measured from the newest row in the file, not
 * from a wall clock this store deliberately does not have) is eligible to roll into a
 * monthly archive.
 *
 * SEVEN, where `YamlNutriListDatastore` uses thirty, and the difference is the whole point:
 * nutrilist is written when a person logs a meal, this file is written on a hardware frame
 * path. `ObservationService.setWeight` reads, appends and re-reads on every qualifying
 * placement frame, and the cost of that is linear in the file. Measured on the prod host:
 * a 900-row hot file (one month at this household's ~30 rows/day) costs 83 ms per
 * `setWeight`, on the single shared event loop that also serves the Player, Fitness and
 * the school Portal — a loop this repo already alerts on at 1 s. Seven days keeps the
 * whole "this week" range of the day view in hot storage while holding the steady state
 * to a couple of hundred rows.
 */
const HOT_RETENTION_DAYS = 7;

/**
 * The roll is only CONSIDERED when the hot file is bigger than this, so the ordinary
 * append never pays for the partition scan or an archive read. Between rolls the hot file
 * grows to roughly this many rows and then drops back to whatever the retention window
 * holds — so this constant, not the file's age, is what bounds the write cost.
 */
const HOT_ROLL_THRESHOLD_ROWS = 250;

/** The four scale signal kinds this store persists. */
const KNOWN_KINDS = Object.freeze(['weight', 'upc', 'container', 'density']);

/** Lifecycle states an observation can be in. Not the entry `status` enum — see module docstring. */
const KNOWN_STATUSES = Object.freeze(['open', 'consumed', 'dismissed']);

/** Fields `update()` is allowed to touch. Everything else about a row is immutable history. */
const PATCHABLE_FIELDS = Object.freeze(['status', 'pairedEntryUuid']);

/** `formatLocalTimestamp`'s exact output shape: `YYYY-MM-DD HH:mm:ss`, local, never UTC-`Z`. */
const LOCAL_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Shift a `YYYY-MM-DD` by whole days. `Date.UTC` is used purely as arithmetic over the
 * digits — this module has no clock and must not acquire one; the reference date always
 * comes from the data (the newest row in the file), never from `Date.now()`.
 *
 * @param {string} date
 * @param {number} days
 * @returns {string}
 */
function shiftDateByDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

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

/**
 * Structural shape check for one row already inside the file (as opposed to `require*`,
 * which validates a caller's INPUT before it is ever written). A row failing this is
 * garbage that reached the file some other way — a hand edit, a future schema change read
 * by old code, disk corruption confined to one row rather than the whole document — and
 * is skipped rather than trusted, WITHOUT being removed from the underlying file (see
 * `#readAllValid`).
 *
 * Deliberately loose on `value`, `unit`, and `pairedEntryUuid`: those are allowed to be
 * various types or `null` by design, so over-constraining them here would reject valid
 * rows. This checks only the fields whose shape is load-bearing for every other method in
 * this class (id lookup, date filtering, scale filtering, status filtering).
 *
 * @param {unknown} r
 * @returns {boolean}
 */
function isStructurallyValid(r) {
  return (
    r !== null && typeof r === 'object' &&
    typeof r.id === 'string' && r.id.length > 0 &&
    KNOWN_KINDS.includes(r.kind) &&
    typeof r.scaleId === 'string' && r.scaleId.length > 0 &&
    typeof r.at === 'string' && LOCAL_TIMESTAMP_RE.test(r.at) &&
    typeof r.date === 'string' && DATE_RE.test(r.date) &&
    KNOWN_STATUSES.includes(r.status)
  );
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
export class YamlObservationStore extends IObservationStore {
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
    super();
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

  #archiveDir(userId) {
    return this.#dataService.user.resolveDir('lifelog/nutrition/archives/observations', userId);
  }

  #archivePath(userId, yearMonth) {
    return path.join(this.#archiveDir(userId), `${yearMonth}.yml`);
  }

  /** The `YYYY-MM` archives that exist for a user, oldest first. */
  #archiveMonths(userId) {
    const dir = this.#archiveDir(userId);
    if (!dirExists(dir)) return [];
    return listYamlFiles(dir, { stripExtension: true }).sort();
  }

  #readArchive(userId, yearMonth) {
    const filePath = this.#archivePath(userId, yearMonth);
    let raw;
    try {
      raw = readYamlFromPath(filePath);
    } catch (err) {
      if (err?.code === 'ENOENT') return [];
      this.#logger.error?.('observationStore.archive.corrupt', { userId, filePath, error: err?.message });
      throw new InfrastructureError(
        `Observation archive is corrupt and could not be parsed: ${filePath}`,
        { code: 'CORRUPT_OBSERVATIONS_FILE', filePath, userId, cause: err?.message },
      );
    }
    if (raw === null || raw === undefined) return [];
    if (!Array.isArray(raw)) {
      this.#logger.error?.('observationStore.archive.malformedShape', { userId, filePath, typeOf: typeof raw });
      throw new InfrastructureError(
        `Observation archive has an unexpected shape (expected an array): ${filePath}`,
        { code: 'CORRUPT_OBSERVATIONS_FILE', filePath, userId },
      );
    }
    return raw;
  }

  #writeArchive(userId, yearMonth, records) {
    ensureDir(this.#archiveDir(userId));
    saveYamlToPathAtomic(this.#archivePath(userId, yearMonth), records, { noRefs: true, lineWidth: -1 });
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

  /**
   * Roll RESOLVED, aged rows out of the hot file into per-month archives — the same
   * hot/cold shape `YamlNutriListDatastore` uses (`archiveOldItems` + monthly
   * `archives/…/{YYYY-MM}.yml`), with two deliberate differences.
   *
   * **It is triggered by `append`, not by a scheduled job.** `append` is already a
   * read-modify-write of the whole file, so the roll rides a cycle that has to happen
   * anyway and needs no cron, no wiring and no operator step. The alternative — a
   * maintenance job — leaves the file unbounded until someone remembers to run it, which
   * on a path that a household uses daily is the same as not fixing it.
   *
   * **An OPEN row is NEVER archived, at any age.** That is the invariant that keeps
   * `openForScale` — which is deliberately not date-scoped, because the composition window
   * can straddle midnight — complete from the hot file alone, and therefore keeps the
   * frame path down to one file. An observation nobody ever resolved stays hot and stays
   * visible; it is exactly the row the day view exists to surface.
   *
   * **Archives are written BEFORE the hot file.** A crash between the two leaves a row in
   * both places, never in neither; every read path dedupes by id, so a duplicate is
   * invisible and a loss would not have been.
   *
   * The cutoff is derived from the newest row IN THE FILE, not from a wall clock: this
   * store has no clock by design (`at` is always caller-supplied), and giving it one to
   * decide what to archive would make the layout depend on when a write happened rather
   * than on what the data says.
   *
   * @param {string} userId
   * @param {object[]} records The raw hot array, as read.
   * @returns {object[]} The rows that remain hot.
   */
  #rollToArchives(userId, records) {
    if (records.length <= HOT_ROLL_THRESHOLD_ROWS) return records;

    let newest = '';
    for (const r of records) {
      if (typeof r?.date === 'string' && DATE_RE.test(r.date) && r.date > newest) newest = r.date;
    }
    if (!newest) return records;
    const cutoff = shiftDateByDays(newest, -HOT_RETENTION_DAYS);

    const hot = [];
    const byMonth = new Map();
    for (const r of records) {
      const archivable = isStructurallyValid(r) && r.status !== 'open' && r.date < cutoff;
      if (!archivable) { hot.push(r); continue; }
      const yearMonth = r.date.slice(0, 7);
      if (!byMonth.has(yearMonth)) byMonth.set(yearMonth, []);
      byMonth.get(yearMonth).push(r);
    }
    if (byMonth.size === 0) return records;

    for (const [yearMonth, rows] of byMonth) {
      const existing = this.#readArchive(userId, yearMonth);
      const seen = new Set(existing.map((r) => r?.id));
      const merged = existing.concat(rows.filter((r) => !seen.has(r.id)));
      merged.sort((a, b) => String(a?.at).localeCompare(String(b?.at)));
      this.#writeArchive(userId, yearMonth, merged);
    }

    this.#logger.info?.('observationStore.archive.rolled', {
      userId, archived: records.length - hot.length, kept: hot.length,
      months: [...byMonth.keys()], cutoff,
    });
    return hot;
  }

  /** Hot rows plus the named archives, deduped by id (hot wins) and structurally filtered. */
  #readValidWithArchives(userId, yearMonths) {
    const rows = this.#readAllValid(userId);
    const seen = new Set(rows.map((r) => r.id));
    for (const yearMonth of yearMonths) {
      for (const r of this.#readArchive(userId, yearMonth)) {
        if (isStructurallyValid(r) && !seen.has(r.id)) { seen.add(r.id); rows.push(r); }
      }
    }
    return rows;
  }

  /**
   * `#readAll`, minus any row that fails `isStructurallyValid`. Used by every method that
   * hands rows BACK to a caller (`listByDate`, `openForScale`, `findByPairedEntry`, `get`) — never
   * by `append`/`update`/`updateMany`, which read-modify-write the RAW array so a
   * malformed row already on disk is preserved untouched rather than dropped by an
   * unrelated write. One bad row must not deny the rest of the day, so this logs a `warn`
   * per skipped row and continues instead of throwing — a single corrupt record is not the
   * same failure as a corrupt FILE (see `#readAll`'s `CORRUPT_OBSERVATIONS_FILE`, which is
   * reserved for "the document itself could not be parsed / is not a list at all").
   *
   * @param {string} userId
   * @returns {Observation[]}
   */
  #readAllValid(userId) {
    const raw = this.#readAll(userId);
    const valid = [];
    for (const [i, r] of raw.entries()) {
      if (isStructurallyValid(r)) {
        valid.push(r);
      } else {
        this.#logger.warn?.('observationStore.read.invalidRecordSkipped', {
          userId, index: i, id: r?.id, kind: r?.kind, date: r?.date,
        });
      }
    }
    return valid;
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

    // The roll rides this cycle: `append` already reads and rewrites the whole file, so
    // bounding it here costs nothing extra and needs no scheduler.
    const records = this.#rollToArchives(userId, this.#readAll(userId));
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
    // One extra file read, and only when that month has actually been archived. Simpler
    // and always correct compared with reasoning about a retention cutoff here: the month
    // a date belongs to is the only archive that can hold it.
    const yearMonth = date.slice(0, 7);
    const months = this.#archiveMonths(userId).includes(yearMonth) ? [yearMonth] : [];
    return this.#readValidWithArchives(userId, months)
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
    this.#requirePatchId(id);
    this.#requirePatchShape(patch);

    const records = this.#readAll(userId);
    const index = records.findIndex((r) => r.id === id);
    if (index !== -1) {
      records[index] = { ...records[index], ...patch };
      this.#writeAll(userId, records);
      return { ...records[index] };
    }

    // The row may have been rolled into an archive. It is patched WHERE IT LIES rather
    // than promoted back to hot: promotion would grow the file this archiving exists to
    // bound, and a re-pair of an old observation is a UI action, not a frame.
    for (const yearMonth of this.#archiveMonths(userId).reverse()) {
      const rows = this.#readArchive(userId, yearMonth);
      const i = rows.findIndex((r) => r?.id === id);
      if (i === -1) continue;
      rows[i] = { ...rows[i], ...patch };
      this.#writeArchive(userId, yearMonth, rows);
      return { ...rows[i] };
    }

    throw new InfrastructureError(`Observation not found: ${id}`, {
      code: 'NOT_FOUND', entity: 'Observation', id,
    });
  }

  #requirePatchId(id) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new ValidationError(`id must be a non-empty string (received: ${describeValue(id)})`, {
        code: 'INVALID_OBSERVATION_ID', field: 'id', value: id,
      });
    }
    return id;
  }

  #requirePatchShape(patch) {
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
    return patch;
  }

  /**
   * Apply a batch of per-id patches in ONE read-modify-write-rename cycle — ALL-OR-NOTHING.
   * See the module docstring ("`updateMany` is ALL-OR-NOTHING") for the reasoning.
   *
   * Every entry's shape is validated (same rules as `update`'s `patch`), every `id` is
   * confirmed to exist, and duplicate ids within one call are rejected — ALL before the
   * file is touched. `[]` is a no-op: it validates trivially and writes nothing.
   *
   * @param {string} userId
   * @param {Array<{id: string, status?: ObservationStatus, pairedEntryUuid?: string|null}>} patches
   * @returns {Observation[]} The updated records, in the same order as `patches`.
   * @throws {ValidationError} `INVALID_OBSERVATION_ID` / `UNKNOWN_PATCH_FIELD` /
   *   `INVALID_OBSERVATION_STATUS` for a malformed entry; `DUPLICATE_PATCH_ID` if the same
   *   `id` appears more than once in `patches`. Nothing is written when any of these throw.
   * @throws {InfrastructureError} `NOT_FOUND` if ANY id in `patches` does not exist —
   *   lists every missing id in `context.ids`, and nothing is written, not even for the
   *   ids that DID exist.
   * @throws {InfrastructureError} `CORRUPT_OBSERVATIONS_FILE` — see `#readAll`.
   */
  updateMany(userId, patches) {
    requireUserId(userId);
    if (!Array.isArray(patches)) {
      throw new ValidationError(`patches must be an array (received: ${describeValue(patches)})`, {
        code: 'INVALID_BATCH', field: 'patches', value: patches,
      });
    }
    if (patches.length === 0) return [];

    const seen = new Set();
    for (const entry of patches) {
      const id = this.#requirePatchId(entry?.id);
      if (seen.has(id)) {
        throw new ValidationError(`patches contains id "${id}" more than once`, {
          code: 'DUPLICATE_PATCH_ID', field: 'id', value: id,
        });
      }
      seen.add(id);
      const { id: _id, ...patch } = entry;
      this.#requirePatchShape(patch);
    }

    const records = this.#readAll(userId);
    const indexById = new Map(records.map((r, i) => [r.id, i]));

    // Locate anything not in the hot file among the archives, BEFORE writing anything.
    //
    // The all-or-nothing guarantee is unchanged for the case it was written for: a
    // composition consume only ever touches OPEN rows, an open row is never archived, so
    // that batch is still one read-modify-write-rename of one file. A batch that spans the
    // hot file and an archive can only come from a manual re-pair of already-resolved
    // history, and it still validates every id before touching a byte — what it cannot
    // offer is a single rename across two files.
    const archiveLocation = new Map();
    const unresolved = patches.map((p) => p.id).filter((id) => !indexById.has(id));
    if (unresolved.length > 0) {
      for (const yearMonth of this.#archiveMonths(userId)) {
        const ids = new Set(this.#readArchive(userId, yearMonth).map((r) => r?.id));
        for (const id of unresolved) {
          if (!archiveLocation.has(id) && ids.has(id)) archiveLocation.set(id, yearMonth);
        }
      }
    }

    const missing = patches.map((p) => p.id)
      .filter((id) => !indexById.has(id) && !archiveLocation.has(id));
    if (missing.length > 0) {
      throw new InfrastructureError(
        `Observation(s) not found: ${missing.join(', ')}`,
        { code: 'NOT_FOUND', entity: 'Observation', ids: missing },
      );
    }

    const updated = new Map();

    const hotPatches = patches.filter(({ id }) => indexById.has(id));
    if (hotPatches.length > 0) {
      for (const { id, ...patch } of hotPatches) {
        const index = indexById.get(id);
        records[index] = { ...records[index], ...patch };
        updated.set(id, records[index]);
      }
      this.#writeAll(userId, records);
    }

    const byMonth = new Map();
    for (const entry of patches) {
      const yearMonth = archiveLocation.get(entry.id);
      if (!yearMonth) continue;
      if (!byMonth.has(yearMonth)) byMonth.set(yearMonth, []);
      byMonth.get(yearMonth).push(entry);
    }
    for (const [yearMonth, monthPatches] of byMonth) {
      const rows = this.#readArchive(userId, yearMonth);
      const rowIndex = new Map(rows.map((r, i) => [r?.id, i]));
      for (const { id, ...patch } of monthPatches) {
        const i = rowIndex.get(id);
        rows[i] = { ...rows[i], ...patch };
        updated.set(id, rows[i]);
      }
      this.#writeArchive(userId, yearMonth, rows);
    }

    return patches.map(({ id }) => ({ ...updated.get(id) }));
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
    return this.#readAllValid(userId)
      .filter((r) => r.scaleId === scaleId && r.status === 'open')
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((r) => ({ ...r }));
  }

  /**
   * Every observation currently paired to a given food-log entry, oldest first, across
   * the WHOLE file (not date-scoped — see the module docstring). Returns an array because
   * more than one observation (weight + density + container) can share one
   * `pairedEntryUuid` from a single consumed composition.
   *
   * @param {string} userId
   * @param {string} entryUuid
   * @returns {Observation[]} `[]` if nothing is currently paired to `entryUuid` — including
   *   for a user with no observations at all.
   * @throws {ValidationError} `INVALID_ENTRY_UUID` if `entryUuid` is not a non-empty string.
   * @throws {InfrastructureError} `CORRUPT_OBSERVATIONS_FILE` — see `#readAll`.
   */
  findByPairedEntry(userId, entryUuid) {
    requireUserId(userId);
    if (typeof entryUuid !== 'string' || entryUuid.length === 0) {
      throw new ValidationError(
        `entryUuid must be a non-empty string (received: ${describeValue(entryUuid)})`,
        { code: 'INVALID_ENTRY_UUID', field: 'entryUuid', value: entryUuid },
      );
    }
    // Every archive, because an entry's observations carry no index. This is a pairing /
    // day-view call, never the frame path, so a linear scan across a handful of month
    // files is the right trade against maintaining a second index that could disagree.
    return this.#readValidWithArchives(userId, this.#archiveMonths(userId))
      .filter((r) => r.pairedEntryUuid === entryUuid)
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((r) => ({ ...r }));
  }

  /**
   * Read-only fetch of a single observation by bare id — no date, no scaleId, no entry
   * id required. Exists because a route that only receives `:id` (e.g. a pair/dismiss
   * endpoint) has no OTHER contractual way to read a row's `kind`/`value`/`unit`/`status`/
   * `pairedEntryUuid` before deciding what to do with it. `update(userId, id, {})` could
   * do this as a side effect of an unconditional write, but that would mean every lookup
   * — including ones that turn out to be no-ops or invalid — performs a spurious disk
   * write; `get` performs NO write under any circumstance.
   *
   * Reads through the same `#readAllValid` filter as `listByDate` / `openForScale` /
   * `findByPairedEntry`, so a malformed row is skipped here exactly as it would be
   * anywhere else — `get` does not special-case its way past that guard. Deliberately not
   * date- or status-scoped: a bare id is either in the file or it isn't, regardless of
   * which day it fell on or whether it is still `open`.
   *
   * @param {string} userId
   * @param {string} id
   * @returns {Observation} The record (a plain-object copy).
   * @throws {ValidationError} `INVALID_OBSERVATION_ID` if `id` is not a non-empty string.
   * @throws {InfrastructureError} `NOT_FOUND` if no observation with `id` exists (same
   *   shape `update`/`updateMany` already raise, so a caller can handle all three
   *   uniformly); `CORRUPT_OBSERVATIONS_FILE` — see `#readAll`.
   */
  get(userId, id) {
    requireUserId(userId);
    this.#requirePatchId(id);

    let record = this.#readAllValid(userId).find((r) => r.id === id);
    if (!record) {
      // Newest archive first: a bare id most often belongs to something recent.
      for (const yearMonth of this.#archiveMonths(userId).reverse()) {
        record = this.#readArchive(userId, yearMonth).find((r) => isStructurallyValid(r) && r.id === id);
        if (record) break;
      }
    }
    if (!record) {
      throw new InfrastructureError(`Observation not found: ${id}`, {
        code: 'NOT_FOUND', entity: 'Observation', id,
      });
    }
    return { ...record };
  }
}

export default YamlObservationStore;
