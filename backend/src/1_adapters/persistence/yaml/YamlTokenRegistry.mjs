/**
 * YAML persistence for printed action tokens (spec §6.1).
 *
 *   <dataDir>/household/apps/school/tokens/{body}.yml
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
 */
import path from 'path';
import { promises as fs } from 'fs';
import { isDeepStrictEqual } from 'node:util';
import yaml from 'js-yaml';
import { ITokenRegistry } from '#apps/school/ports/ITokenRegistry.mjs';
import { TOKEN_PREFIX } from '#domains/school/sessions/tokens.mjs';

// The mint charset is [A-Z0-9]; the bound is wide enough for a future format and
// narrow enough that "..", ".", "a/b" and hidden names cannot match.
const BODY_RE = /^[A-Za-z0-9]{4,64}$/;

const DAY_MS = 86_400_000;
/** Expired records stay resolvable ("out of date") this long before deletion. */
export const DEFAULT_PRUNE_GRACE_MS = 7 * DAY_MS;
/** Opportunistic sweeps after a mint happen at most this often. */
export const SWEEP_INTERVAL_MS = 6 * 3_600_000;

const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });

/** Scanned code → filesystem-safe body, or null when it could never be one of ours. */
function bodyOf(token) {
  if (typeof token !== 'string') return null;
  const trimmed = token.trim();
  const body = trimmed.startsWith(TOKEN_PREFIX) ? trimmed.slice(TOKEN_PREFIX.length) : trimmed;
  return BODY_RE.test(body) ? body : null;
}

export class YamlTokenRegistry extends ITokenRegistry {
  #configService;
  #writeChain = Promise.resolve();
  #now;
  #graceMs;
  #logger;
  #lastSweepMs = -Infinity;

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

  #root() { return this.#configService.getHouseholdPath('apps/school/tokens'); }

  #fileFor(body) { return path.join(this.#root(), `${body}.yml`); }

  #enqueue(run) {
    const queued = this.#writeChain.then(run);
    this.#writeChain = queued.catch(() => {});
    return queued;
  }

  async #write(body, record) {
    await fs.mkdir(this.#root(), { recursive: true });
    await fs.writeFile(this.#fileFor(body), dumpYaml(record), 'utf8');
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
    const nowMs = this.#now();
    this.#lastSweepMs = nowMs;
    let names;
    try {
      names = await fs.readdir(this.#root());
    } catch {
      return { removed: 0, kept: 0 }; // no directory yet: nothing ever minted
    }
    let removed = 0;
    let kept = 0;
    for (const name of names) {
      let expired = false;
      if (name.endsWith('.yml')) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const raw = yaml.load(await fs.readFile(path.join(this.#root(), name), 'utf8'));
          const expiresMs = Date.parse(raw?.expiresAt ?? '');
          // Unparseable, corrupt, or unexpiring records are all KEPT: deletion
          // is only ever justified by a timestamp that is legibly long past.
          expired = Number.isFinite(expiresMs) && nowMs - expiresMs > this.#graceMs;
        } catch (err) {
          // Keeping an unreadable token is the safe answer — deletion needs a
          // legible timestamp — but a token record that cannot be read will be
          // kept forever and never explain why, so it is named once per sweep.
          expired = false;
          this.#logger?.warn?.('school.tokens.record-unreadable', { file: name, error: err?.message });
        }
      }
      if (expired) {
        // eslint-disable-next-line no-await-in-loop
        await fs.unlink(path.join(this.#root(), name)).catch(() => {});
        removed += 1;
      } else {
        kept += 1;
      }
    }
    if (removed > 0) this.#logger?.info?.('school.tokens.pruned', { removed, kept });
    return { removed, kept };
  }

  /** @inheritdoc */
  async get(token) {
    const body = bodyOf(token);
    if (!body) return null;
    try {
      const raw = yaml.load(await fs.readFile(this.#fileFor(body), 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      return raw;
    } catch {
      // Missing OR unreadable: the resolver prints an explanation slip either
      // way, and one bad record must not poison the rest of the registry.
      return null;
    }
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
