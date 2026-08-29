/**
 * YAML persistence for printed action tokens (spec §6.1).
 *
 *   <dataDir>/household/school/runtime/tokens/{body}.yml
 *
 * No `apps/` segment: that layout applies to per-user data
 * (users/{id}/apps/{app}/), not to household-scoped school data.
 *
 * The `sch:` prefix never reaches the filesystem: a colon is legal in a POSIX
 * filename but the prefix is a routing marker, not identity, and stripping it
 * keeps one token to one file however it was scanned (with prefix, without, or
 * with the trailing whitespace a scanner appends).
 *
 * One token is one whole-file write, so there is no read-modify-write to lose —
 * except `revoke`, which is queued behind the same chain as every other write.
 *
 * EXPIRED FILES ARE PRUNED, ON A GRACE PERIOD. Every mint is a new file and
 * nothing else ever deleted one, so the directory grew without bound. A sweep
 * (at boot, and after a mint at most once per {@link SWEEP_INTERVAL_MS})
 * removes records whose `expiresAt` is more than {@link DEFAULT_PRUNE_GRACE_MS}
 * past. The grace window is the difference between two slips a child can be
 * handed: a record still on file resolves to "that ticket is out of date",
 * a pruned one to "we do not know that ticket" — recently-expired paper
 * deserves the first. Records with no expiry are never pruned, and a
 * corrupt file is left alone (same posture as `get`: isolate, don't destroy).
 *
 * A SECOND KEY: the printed 6-digit panel code. Records are one-per-file keyed
 * by token body, so resolving a typed code needs an index — an in-memory
 * `Map<accessCode, {body, issuedAt}>` written on every store and rebuilt from
 * disk on a miss. The rebuild is the same walk the sweep already does, not a
 * second one, and it is throttled ({@link REBUILD_INTERVAL_MS}): a miss is
 * usually a child mistyping a digit, and the directory grows without bound
 * because `identify` and `learning_action` records forbid an expiry and so are
 * never pruned. Every hit is verified against the file it points at before it
 * is returned, so an entry that has gone stale (code changed, record revoked,
 * file pruned) heals itself instead of serving the wrong work.
 *
 * TWO RECORDS ON ONE CODE resolve to the NEWEST paper, tie-broken by body, so
 * the panel's answer can never depend on readdir order — a rebuilt index and a
 * live one must not open two different children's lessons. It is logged as
 * `school.tokens.access-code-collision`, because whichever one wins, some
 * child's printed page has become a lie.
 */
import path from 'path';
import { isDeepStrictEqual } from 'node:util';
import yaml from 'js-yaml';
import { ITokenRegistry } from '#apps/school/ports/ITokenRegistry.mjs';
import { TOKEN_PREFIX, isAccessCodeLive } from '#domains/school/sessions/tokens.mjs';
import { normalizeAccessCode } from '#domains/school/sessions/accessCode.mjs';
import {
  deleteFileStrictAsync, ensureDirAsync, readDirectoryAsync, readTextFromPathAsync, writeTextFileAsync,
} from '#system/utils/FileIO.mjs';

// The mint charset is [A-Z0-9]; the bound is wide enough for a future format and
// narrow enough that "..", ".", "a/b" and hidden names cannot match.
const BODY_RE = /^[A-Za-z0-9]{4,64}$/;

const DAY_MS = 86_400_000;
/** Expired records stay resolvable ("out of date") this long before deletion. */
export const DEFAULT_PRUNE_GRACE_MS = 7 * DAY_MS;
/** Opportunistic sweeps after a mint happen at most this often. */
export const SWEEP_INTERVAL_MS = 6 * 3_600_000;
/**
 * A code lookup that misses rebuilds the index at most this often. Short enough
 * that a code minted by another process is typable almost immediately, long
 * enough that a child holding the keypad down cannot make every keystroke read
 * every record on disk.
 */
export const REBUILD_INTERVAL_MS = 5_000;

const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });

/** Scanned code → filesystem-safe body, or null when it could never be one of ours. */
function bodyOf(token) {
  if (typeof token !== 'string') return null;
  const trimmed = token.trim();
  const body = trimmed.startsWith(TOKEN_PREFIX) ? trimmed.slice(TOKEN_PREFIX.length) : trimmed;
  return BODY_RE.test(body) ? body : null;
}

/**
 * The panel code on a record, or null when the domain would not accept it as
 * one. A hand-edited `accessCode: hello` must not take a slot in the index that
 * no lookup could ever reach — and what six digits means stays in the domain.
 */
function codeOf(record) {
  try {
    return normalizeAccessCode(record?.accessCode);
  } catch {
    return null;
  }
}

/**
 * Which of two records holding the same code the panel opens: the newest paper
 * wins, with the body as a total-order tie-break. Deliberately independent of
 * the order the files came back in, so an index rebuilt after a restart gives
 * the same answer as the one that was live before it.
 */
function outranks(record, body, existing) {
  const mine = Date.parse(record?.issuedAt ?? '');
  const theirs = Date.parse(existing?.issuedAt ?? '');
  const a = Number.isFinite(mine) ? mine : -Infinity;
  const b = Number.isFinite(theirs) ? theirs : -Infinity;
  return a === b ? body > existing.body : a > b;
}

export class YamlTokenRegistry extends ITokenRegistry {
  #configService;
  #writeChain = Promise.resolve();
  #now;
  #graceMs;
  #logger;
  #lastSweepMs = -Infinity;
  #lastRebuildMs = -Infinity;
  /** The walk in flight, so concurrent misses share one readdir. */
  #rebuilding = null;
  /** Secondary index: panel code → `{ body, issuedAt }`. Never authoritative. */
  #bodyByCode = new Map();

  /**
   * @param {object} config
   * @param {object} config.configService - `getDataDir()` provider (required)
   * @param {() => number} [config.now] - ms clock, injectable for tests
   * @param {number} [config.pruneGraceMs] - how long past `expiresAt` a record
   *   stays resolvable before the sweep removes it
   * @param {object} [config.logger] - `school.tokens.pruned` lands here
   */
  constructor(config = {}) {
    super();
    if (!config.configService || typeof config.configService.getHouseholdPath !== 'function') {
      throw new Error('YamlTokenRegistry: configService with getHouseholdPath() is required');
    }
    this.#configService = config.configService;
    this.#now = typeof config.now === 'function' ? config.now : () => Date.now();
    this.#graceMs = Number.isFinite(config.pruneGraceMs) ? config.pruneGraceMs : DEFAULT_PRUNE_GRACE_MS;
    this.#logger = config.logger ?? null;
  }

  #root() { return this.#configService.getHouseholdPath('school/runtime/tokens'); }

  #fileFor(body) { return path.join(this.#root(), `${body}.yml`); }

  #enqueue(run) {
    const queued = this.#writeChain.then(run);
    this.#writeChain = queued.catch(() => {});
    return queued;
  }

  async #write(body, record) {
    await ensureDirAsync(this.#root());
    await writeTextFileAsync(this.#fileFor(body), dumpYaml(record));
    this.#index(body, record);
  }

  /**
   * Point a panel code at the body that carries it. `revoke` writes through here
   * like every other store, so cancelling a ticket cannot leave the index
   * resolving it.
   *
   * Liveness is NOT decided here — that is `isAccessCodeLive`'s call on the way
   * out. Dropping a revoked record is index hygiene: a cancelled ticket has no
   * reason to hold a slot that a later code could want.
   */
  #index(body, record) {
    const code = codeOf(record);
    if (!code) return;
    const existing = this.#bodyByCode.get(code);
    if (record.revokedAt) {
      if (existing?.body === body) this.#bodyByCode.delete(code);
      return;
    }
    if (existing && existing.body !== body) {
      // Two live records on one code. Whichever the panel opens, the other
      // child's printed page is now a lie — name it rather than let the wrong
      // lesson start with nothing in the log to explain it.
      this.#logger?.warn?.('school.tokens.access-code-collision', {
        code, existing: existing.body, body,
      });
      if (!outranks(record, body, existing)) return;
    }
    this.#bodyByCode.set(code, { body, issuedAt: record.issuedAt ?? null });
  }

  /** The injected clock as an ISO string, or null when it is unusable. */
  #nowIso() {
    const ms = this.#now();
    if (!Number.isFinite(ms)) return null;
    const when = new Date(ms);
    // Finite but absurd (1e18) makes an Invalid Date, whose toISOString THROWS.
    // Never-throw has to survive a miswired clock, not only a missing one.
    return Number.isNaN(when.getTime()) ? null : when.toISOString();
  }

  /** @inheritdoc */
  async put(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error('YamlTokenRegistry: record must be a mapping');
    }
    const body = bodyOf(record.token);
    if (!body) throw new Error(`YamlTokenRegistry: not a school token: ${record.token}`);
    return this.#enqueue(async () => {
      await this.#write(body, record);
      // Housekeeping rides the mint: agendas print daily, so the directory is
      // swept regularly without a scheduler — but at most once per interval,
      // and inside the same chain task so it can never race a write.
      if (this.#now() - this.#lastSweepMs >= SWEEP_INTERVAL_MS) await this.#sweep();
      return record;
    });
  }

  /** @inheritdoc */
  async claim(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error('YamlTokenRegistry: record must be a mapping');
    }
    const body = bodyOf(record.token);
    if (!body) throw new Error(`YamlTokenRegistry: not a school token: ${record.token}`);
    return this.#enqueue(async () => {
      const current = await this.get(record.token);
      if (current) {
        const sameMeaning = current.token === record.token
          && current.tokenClass === record.tokenClass
          && isDeepStrictEqual(current.subject, record.subject);
        return { status: sameMeaning ? 'duplicate' : 'conflict', record: current };
      }
      await this.#write(body, record);
      if (this.#now() - this.#lastSweepMs >= SWEEP_INTERVAL_MS) await this.#sweep();
      return { status: 'accepted', record };
    });
  }

  /**
   * Delete records whose `expiresAt` is more than the grace period past.
   * Safe to call at boot; serialized behind every other write.
   *
   * @returns {Promise<{removed: number, kept: number}>}
   */
  async prune() {
    return this.#enqueue(() => this.#sweep());
  }

  async #sweep() {
    return this.#walk({ prune: true });
  }

  /**
   * One walk of the record directory, serving both jobs that need it: pruning
   * long-expired files, and seeding the panel-code index from what survives.
   *
   * `prune: false` is the index rebuild after a code lookup misses. A miss is a
   * child mistyping a digit, and a read must not delete anything, so that pass
   * only reads — it does not unlink, does not log a prune, and does not count
   * as the periodic sweep. It stays silent about unreadable files too: on the
   * read path a half-written record is transient and expected, and one warning
   * per keystroke would bury the sweep's real report.
   *
   * @param {{ prune?: boolean, liveCodes?: Set<string>|null }} opts
   * @returns {Promise<{removed: number, kept: number}>}
   */
  async #walk({ prune = false, liveCodes = null } = {}) {
    const nowMs = this.#now();
    const nowIso = this.#nowIso();
    this.#lastRebuildMs = nowMs; // every walk is a full index refresh
    if (prune) this.#lastSweepMs = nowMs;
    let names;
    try {
      names = await readDirectoryAsync(this.#root());
    } catch {
      return { removed: 0, kept: 0 }; // no directory yet: nothing ever minted
    }
    let removed = 0;
    let kept = 0;
    for (const name of names) {
      let expired = false;
      let record = null;
      if (name.endsWith('.yml')) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const raw = yaml.load(await readTextFromPathAsync(path.join(this.#root(), name)));
          record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
          const expiresMs = Date.parse(raw?.expiresAt ?? '');
          // Unparseable, corrupt, or unexpiring records are all KEPT: deletion
          // is only ever justified by a timestamp that is legibly long past.
          expired = prune && Number.isFinite(expiresMs) && nowMs - expiresMs > this.#graceMs;
        } catch (err) {
          // Keeping an unreadable token is the safe answer — deletion needs a
          // legible timestamp — but a token record that cannot be read will be
          // kept forever and never explain why, so it is named once per sweep.
          expired = false;
          if (prune) {
            this.#logger?.warn?.('school.tokens.record-unreadable', { file: name, error: err?.message });
          }
        }
      }
      if (expired) {
        // eslint-disable-next-line no-await-in-loop
        await deleteFileStrictAsync(path.join(this.#root(), name)).catch(() => {});
        // The file it pointed at is gone, so the index entry goes with it.
        this.#forget(name.slice(0, -'.yml'.length), record);
        removed += 1;
      } else {
        if (record) {
          this.#index(name.slice(0, -'.yml'.length), record);
          if (liveCodes && isAccessCodeLive(record, { now: nowIso })) liveCodes.add(record.accessCode);
        }
        kept += 1;
      }
    }
    if (removed > 0) this.#logger?.info?.('school.tokens.pruned', { removed, kept });
    return { removed, kept };
  }

  /** Drop a code entry whose file no longer exists. */
  #forget(body, record) {
    const code = codeOf(record);
    if (!code) return;
    if (this.#bodyByCode.get(code)?.body === body) this.#bodyByCode.delete(code);
  }

  /**
   * Re-read the directory into the index, at most once per
   * {@link REBUILD_INTERVAL_MS} and never twice at the same time — a keypad can
   * produce misses far faster than a directory of token files can be read.
   *
   * `force` is for the one case that is EVIDENCE rather than a guess: an index
   * entry that pointed at a file which no longer holds that code. Never throws;
   * a failed rebuild just leaves the lookup to answer "try again".
   */
  async #rebuildIndex({ force = false } = {}) {
    if (this.#rebuilding) return this.#rebuilding;
    if (!force && this.#now() - this.#lastRebuildMs < REBUILD_INTERVAL_MS) return undefined;
    this.#rebuilding = this.#walk({ prune: false })
      .catch(() => ({ removed: 0, kept: 0 }))
      .finally(() => { this.#rebuilding = null; });
    return this.#rebuilding;
  }

  /**
   * Read what an index entry points at, dropping the entry when it lies.
   * The index is a hint; the file is the truth.
   */
  async #readIndexed(code) {
    const entry = this.#bodyByCode.get(code);
    if (!entry) return null;
    const record = await this.get(entry.body);
    if (record && codeOf(record) === code) return record;
    if (this.#bodyByCode.get(code) === entry) this.#bodyByCode.delete(code);
    return null;
  }

  /** @inheritdoc */
  async get(token) {
    const body = bodyOf(token);
    if (!body) return null;
    try {
      const raw = yaml.load(await readTextFromPathAsync(this.#fileFor(body)));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      return raw;
    } catch {
      // Missing OR unreadable: the resolver prints an explanation slip either
      // way, and one bad record must not poison the rest of the registry.
      return null;
    }
  }

  /** @inheritdoc */
  async getByAccessCode(code) {
    // What six digits means is `accessCode.mjs`'s rule, not this adapter's — but
    // a keypad never dead-ends, so its ValidationError becomes a null here and
    // a mistyped code costs no directory walk.
    try {
      normalizeAccessCode(code);
    } catch {
      return null;
    }

    const knewIt = this.#bodyByCode.has(code);
    let record = await this.#readIndexed(code);
    if (!record) {
      // Either the index never knew this code (a mistype, or the first lookup
      // in a fresh process — throttled), or it pointed somewhere that no longer
      // holds it. The second case is EVIDENCE of staleness, so it forces a walk:
      // a child who typed the right digits must not be told to try again.
      await this.#rebuildIndex({ force: knewIt });
      record = await this.#readIndexed(code);
    }
    if (!record) return null;

    // Expiry and revocation are the domain's rule, not the adapter's: the code
    // dies at the study-day rollover while its token — and the QR printed
    // beside it — lives on. Reading `expiresAt` here would fuse the two clocks.
    return isAccessCodeLive(record, { now: this.#nowIso() }) ? record : null;
  }

  /** @inheritdoc */
  async liveAccessCodes() {
    // Always a fresh walk, never the throttled rebuild: this answer decides
    // what a mint may draw, and a stale one prints a duplicate code onto a
    // child's paper. It is called once per agenda build, not per keystroke.
    const codes = new Set();
    await this.#walk({ liveCodes: codes });
    return codes;
  }

  /** @inheritdoc */
  async revoke(token, { at } = {}) {
    const body = bodyOf(token);
    if (!body) return null;
    if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) {
      throw new Error('YamlTokenRegistry: revoke requires an ISO-8601 `at`');
    }
    return this.#enqueue(async () => {
      const record = await this.get(token);
      if (!record) return null;
      // First revocation wins: re-revoking is a retry, and moving the timestamp
      // would rewrite when the card actually stopped working.
      if (record.revokedAt) return record;
      const revoked = { ...record, revokedAt: at };
      await this.#write(body, revoked);
      return revoked;
    });
  }
}

export default YamlTokenRegistry;
