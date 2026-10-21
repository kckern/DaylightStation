/**
 * YAML persistence for the household economy.
 * Layout under data/users/{userId}/apps/economy/:
 *   ledger/{YYYY-MM-DD}.yml — append-only transaction list (sharded by txn.at date)
 *   wallet.yml              — balance snapshot + open metered session (cache)
 * Dumb storage only: no balance math, no policy. See EconomyService.
 *
 * Appends are serialized per user and written atomically (staged, then
 * renamed). `withUserLock` runs a read-check-write on the same per-user queue;
 * an append made inside it writes straight through instead of queueing behind
 * the lock it is already holding. "Inside" means while the lock's body is
 * running: a timer it started that fires after the lock released queues
 * like any other caller.
 *
 * A day shard that exists but does not parse is never appended to: treating
 * it as empty would replace that day's history with one entry.
 */
import path from 'path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { dirExists, fileExists, listEntries, loadYaml, loadYamlSafe, saveYaml, saveYamlToPathAtomic, ensureDir } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

// One queue per user ledger, shared by every datastore instance in the
// process (the ledger is one set of files however many instances read it).
const queues = new Map(); // ledger key → tail promise
// The lock the current async context runs under: { key, live, parent }.
// `live` turns false when that lock's body settles, so work it left behind
// (a timer, an un-awaited promise) stops counting as inside it.
const held = new AsyncLocalStorage();

function holds(key) {
  for (let t = held.getStore(); t; t = t.parent) if (t.live && t.key === key) return true;
  return false;
}

function enqueue(key, fn) {
  const run = (queues.get(key) ?? Promise.resolve()).then(() => {
    const token = { key, live: true, parent: held.getStore() };
    return held.run(token, async () => {
      try { return await fn(); } finally { token.live = false; }
    });
  });
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
}

function withKey(key, fn) {
  return holds(key) ? Promise.resolve().then(fn) : enqueue(key, fn);
}

export class YamlEconomyDatastore {
  #configService;

  constructor(config = {}) {
    if (!config.configService) {
      throw new InfrastructureError('YamlEconomyDatastore requires configService', {
        code: 'MISSING_DEPENDENCY', dependency: 'configService',
      });
    }
    this.#configService = config.configService;
  }

  #economyDir(userId) {
    if (!this.#configService.getUserProfile?.(userId)) return null;
    return path.join(this.#configService.getUserDir(userId), 'apps', 'economy');
  }

  /** @returns {Promise<object|null>} the appended txn, or null for an unknown user */
  async appendTransaction(userId, txn) {
    const dir = this.#economyDir(userId);
    if (!dir) return null;
    return withKey(dir, () => {
      const base = path.join(dir, 'ledger', String(txn.at).slice(0, 10));
      const list = this.#loadShardForAppend(`${base}.yml`);
      list.push(txn);
      saveYamlToPathAtomic(`${base}.yml`, list, { noRefs: true });
      return txn;
    });
  }

  #loadShardForAppend(file) {
    if (!fileExists(file)) return [];
    let list;
    try {
      list = loadYaml(file);
    } catch (err) {
      throw new InfrastructureError(`economy ledger shard is unreadable: ${file}`, { code: 'CORRUPT_LEDGER', file, cause: err.message });
    }
    if (list == null) return [];
    if (!Array.isArray(list)) throw new InfrastructureError(`economy ledger shard is not a list: ${file}`, { code: 'CORRUPT_LEDGER', file });
    return list;
  }

  /**
   * Run `fn` holding this user's ledger queue: no append from outside lands
   * until it settles. Appends inside `fn` (and a nested lock) run directly.
   * @template T
   * @param {string} userId
   * @param {() => T|Promise<T>} fn
   * @returns {Promise<T>}
   */
  withUserLock(userId, fn) {
    return withKey(this.#economyDir(userId) ?? `user:${userId}`, fn);
  }

  readLedgerDay(userId, day) {
    const dir = this.#economyDir(userId);
    if (!dir) return [];
    return loadYamlSafe(path.join(dir, 'ledger', day)) || [];
  }

  /** Every ledger entry, oldest shard first. `fromDay` (YYYY-MM-DD) skips earlier shards. */
  readAllTransactions(userId, { fromDay = null } = {}) {
    const dir = this.#economyDir(userId);
    if (!dir) return [];
    const ledgerDir = path.join(dir, 'ledger');
    if (!dirExists(ledgerDir)) return [];
    return listEntries(ledgerDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.yml$/.test(f))
      .filter((f) => fromDay == null || f.slice(0, 10) >= fromDay)
      .sort()
      .flatMap((f) => loadYamlSafe(path.join(ledgerDir, f.replace(/\.yml$/, ''))) || []);
  }

  readWallet(userId) {
    const dir = this.#economyDir(userId);
    if (!dir) return null;
    return loadYamlSafe(path.join(dir, 'wallet'));
  }

  writeWallet(userId, wallet) {
    const dir = this.#economyDir(userId);
    if (!dir) return null;
    ensureDir(dir);
    saveYaml(path.join(dir, 'wallet'), wallet, { noRefs: true });
    return wallet;
  }
}

export default YamlEconomyDatastore;
