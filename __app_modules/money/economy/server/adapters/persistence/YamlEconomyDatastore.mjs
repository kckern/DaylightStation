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
 * the lock it is already holding.
 */
import path from 'path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { dirExists, listEntries, loadYamlSafe, saveYaml, saveYamlToPathAtomic, ensureDir } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

// One queue per user ledger, shared by every datastore instance in the
// process (the ledger is one set of files however many instances read it).
const queues = new Map(); // ledger key → tail promise
const held = new AsyncLocalStorage(); // Set of ledger keys the current async context holds

function enqueue(key, fn) {
  const run = (queues.get(key) ?? Promise.resolve())
    .then(() => held.run(new Set([...(held.getStore() ?? []), key]), fn));
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
}

function withKey(key, fn) {
  return held.getStore()?.has(key) ? Promise.resolve().then(fn) : enqueue(key, fn);
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
      const list = loadYamlSafe(base) || [];
      list.push(txn);
      saveYamlToPathAtomic(`${base}.yml`, list, { noRefs: true });
      return txn;
    });
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

  readAllTransactions(userId) {
    const dir = this.#economyDir(userId);
    if (!dir) return [];
    const ledgerDir = path.join(dir, 'ledger');
    if (!dirExists(ledgerDir)) return [];
    return listEntries(ledgerDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.yml$/.test(f))
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
