/**
 * YAML persistence for the DoNow dispatch service (spec §4/§5). Dumb storage
 * only — occupancy checks, approval policy, and notification wording all live
 * in the domain/application layers; this adapter just reads and writes the
 * two files the spec names:
 *
 *   pending: household[-{hid}]/donow/pending.yml
 *     One row per outstanding parental-approval request
 *     (`{ id, surface, action, label, learnerId, requestedBy, ref, occupant,
 *     createdAt, expiresAt, repended? }`). Upserted by `id`; pruned lazily
 *     on read (TTL) rather than by a background job — a pending file is small
 *     and read on every dispatch, so pruning there is enough. "Pruned on
 *     read" means the read path also PERSISTS the pruned file back to disk
 *     (not just filters what it returns) — otherwise the file grows forever
 *     with rows nobody will ever look at again.
 *
 *   dispatch log: household[-{hid}]/donow/log/{YYYY-MM-DD}.yml   (append-only)
 *     One row per `dispatched` decision (`{ at, surface, decision, learnerId,
 *     requestedBy, ref, programId?, approvalId? }`), sharded by the UTC date
 *     of the row's `at` (the economy-ledger pattern) — Task 12 reads two
 *     shards around the study-day boundary, so the shard rule must be exactly
 *     "UTC date of `at`", not the day the append happened to run.
 *
 *   `programId` and `approvalId` are written ONLY when the caller supplies a
 *   non-null value — the KEY is absent, not present-with-null — because
 *   Task 12's evidence query filters on key presence (`programId` in a row),
 *   not truthiness.
 *
 * Concurrency: every method that touches the pending file OR a log shard
 * runs through a single per-instance `#writeChain` (same shape as
 * `YamlWorkSessionDatastore`'s write queue) — a read-modify-write with an
 * await gap between the read and the write is otherwise a lost-update race
 * (two concurrent `putPending` upserts, or two concurrent `appendDispatch`
 * calls into the same day shard, would silently drop all but the last).
 * Unlike the economy-ledger precedent this mirrors in file layout, that
 * precedent's `appendTransaction` is fully SYNCHRONOUS (no interleaving
 * window), so it doesn't need a queue — this store's fs/promises calls do.
 */
import path from 'path';
import yaml from 'js-yaml';
import { readTextFromPathAsync, writeTextFileAsync } from '#system/utils/FileIO.mjs';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const PENDING_FILE = 'pending.yml';

const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });
const isSafeDayStamp = (day) => typeof day === 'string' && DAY_RE.test(day);

/** UTC calendar date (YYYY-MM-DD) of an ISO-8601 timestamp. */
function utcDayOf(at) {
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) {
    throw new Error('YamlDoNowDatastore: appendDispatch requires an ISO-8601 `at` timestamp');
  }
  return new Date(ms).toISOString().slice(0, 10);
}

export class YamlDoNowDatastore {
  #configService;
  #householdId;
  #logger;
  // One queue for every mutation on this instance (pending file AND log
  // shards alike) — see the header note on concurrency. A read path that
  // also persists a prune enqueues too, so it can't race a concurrent
  // putPending/appendDispatch either.
  #writeChain = Promise.resolve();

  /**
   * @param {Object} config
   * @param {Object} config.configService - Must expose getHouseholdPath(rel, hid).
   * @param {string|null} [config.householdId] - null = default household.
   * @param {Object} [config.logger] - Logger with debug/info/warn/error methods.
   */
  constructor(config = {}) {
    if (typeof config.configService?.getHouseholdPath !== 'function') {
      throw new Error('YamlDoNowDatastore requires configService with getHouseholdPath');
    }
    this.#configService = config.configService;
    this.#householdId = config.householdId ?? null;
    this.#logger = config.logger || console;
  }

  /** Absolute path to this household's donow folder. Exposed for tests. */
  rootPath() { return this.#root(); }

  /**
   * Run `fn` after every previously-enqueued operation on this instance has
   * settled, and keep the chain alive even if `fn` rejects — one bad write
   * must not strand every later one. The caller still sees the rejection
   * through the returned promise.
   */
  #enqueue(fn) {
    const queued = this.#writeChain.then(fn);
    this.#writeChain = queued.catch(() => {});
    return queued;
  }

  #root() {
    return this.#configService.getHouseholdPath('donow', this.#householdId);
  }

  #pendingFile() { return path.join(this.#root(), PENDING_FILE); }

  #logFile(dayStamp) { return path.join(this.#root(), 'log', `${dayStamp}.yml`); }

  async #readYaml(file) {
    try {
      return yaml.load(await readTextFromPathAsync(file));
    } catch {
      // Missing OR unparseable, deliberately the same answer: one corrupt
      // file must not take down dispatch for the whole household.
      return null;
    }
  }

  async #readPendingRaw() {
    const raw = await this.#readYaml(this.#pendingFile());
    return Array.isArray(raw) ? raw : [];
  }

  async #writePendingRaw(rows) {
    await writeTextFileAsync(this.#pendingFile(), dumpYaml(rows));
  }

  /** Unexpired rows as of `nowIso` (expiresAt strictly after now survives). */
  #unexpired(rows, nowIso) {
    const now = Date.parse(nowIso);
    return rows.filter((row) => {
      if (!row || typeof row !== 'object') return false;
      const expires = Date.parse(row.expiresAt);
      // No usable expiresAt: fail open on the side of keeping the row rather
      // than silently discarding a malformed-but-real pending request.
      if (Number.isNaN(expires)) return true;
      return expires > now;
    });
  }

  // ===========================================================================
  // Pending queue
  // ===========================================================================

  /**
   * Read the pending file, drop expired rows, and — if anything was
   * dropped — persist the pruned list before returning. Every public
   * pending-file method funnels through this, so a "just reading" call and
   * a concurrent upsert can never interleave into a lost update.
   */
  async #loadPrunedPending(nowIso) {
    const rows = await this.#readPendingRaw();
    const kept = this.#unexpired(rows, nowIso);
    if (kept.length !== rows.length) await this.#writePendingRaw(kept);
    return kept;
  }

  /** @returns {Promise<Array>} every unexpired pending row. */
  async listPending() {
    return this.#enqueue(() => this.#loadPrunedPending(new Date().toISOString()));
  }

  /** Upsert a pending row by `id`. */
  async putPending(record) {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string' || !record.id) {
      throw new Error('YamlDoNowDatastore: putPending requires a record with a string id');
    }
    return this.#enqueue(async () => {
      const rows = await this.#readPendingRaw();
      const idx = rows.findIndex((row) => row && row.id === record.id);
      if (idx >= 0) rows[idx] = record;
      else rows.push(record);
      await this.#writePendingRaw(rows);
      return record;
    });
  }

  /** Remove a pending row by id. No-op if the id is not present. */
  async removePending(id) {
    return this.#enqueue(async () => {
      const rows = await this.#readPendingRaw();
      const next = rows.filter((row) => !(row && row.id === id));
      if (next.length === rows.length) return;
      await this.#writePendingRaw(next);
    });
  }

  /**
   * Find an UNEXPIRED pending row matching surface + ref — the dedup lookup
   * behind "an impatient re-scan while pending must not page a parent twice".
   * @param {Object} param
   * @param {string} param.surface
   * @param {*} param.ref
   * @param {string} [param.nowIso] - Defaults to the current time.
   * @returns {Promise<Object|null>}
   */
  async findPending({ surface, ref, nowIso = new Date().toISOString() } = {}) {
    return this.#enqueue(async () => {
      const kept = await this.#loadPrunedPending(nowIso);
      return kept.find((row) => row.surface === surface && row.ref === ref) ?? null;
    });
  }

  /**
   * Drop expired pending rows, persisting the pruned list.
   * @param {string} [nowIso] - Defaults to the current time.
   * @returns {Promise<Array>} the surviving (unexpired) rows.
   */
  async prunePending(nowIso = new Date().toISOString()) {
    return this.#enqueue(() => this.#loadPrunedPending(nowIso));
  }

  // ===========================================================================
  // Dispatch log (append-only, date-sharded)
  // ===========================================================================

  /**
   * Append one dispatch-decision row, sharded by the UTC date of `at`.
   * @param {Object} row
   * @param {string} row.at - ISO-8601 timestamp.
   * @param {string} row.surface
   * @param {string} row.decision
   * @param {string|null} row.learnerId
   * @param {string} row.requestedBy
   * @param {*} row.ref
   * @param {string} [row.programId] - Written only when present (non-null).
   * @param {string} [row.approvalId] - Written only when present (non-null).
   * @returns {Promise<Object>} the row as stored.
   */
  async appendDispatch({ at, surface, decision, learnerId, requestedBy, ref, programId, approvalId }) {
    const dayStamp = utcDayOf(at);
    const stored = { at, surface, decision, learnerId, requestedBy, ref };
    // Absent key, not a null value — Task 12's evidence query filters on
    // `programId` presence, so a caller-supplied null/undefined must not
    // survive into the row at all.
    if (programId != null) stored.programId = programId;
    if (approvalId != null) stored.approvalId = approvalId;

    return this.#enqueue(async () => {
      const file = this.#logFile(dayStamp);
      const rows = await this.#readYaml(file);
      const list = Array.isArray(rows) ? rows : [];
      list.push(stored);
      await writeTextFileAsync(file, dumpYaml(list));
      this.#logger.debug?.('donow.dispatch.appended', { dayStamp, surface, decision, ref });
      return stored;
    });
  }

  /**
   * Read back every dispatch row for one UTC day shard, in append order.
   * @param {Object} param
   * @param {string} param.dayStamp - YYYY-MM-DD (UTC).
   * @returns {Promise<Array>}
   */
  async listDispatches({ dayStamp } = {}) {
    if (!isSafeDayStamp(dayStamp)) return [];
    const rows = await this.#readYaml(this.#logFile(dayStamp));
    return Array.isArray(rows) ? rows : [];
  }
}

export default YamlDoNowDatastore;
