/**
 * YAML persistence for the household economy.
 * Layout under data/users/{userId}/apps/economy/:
 *   ledger/{YYYY-MM-DD}.yml — append-only transaction list (sharded by txn.at date)
 *   wallet.yml              — balance snapshot + open metered session (cache)
 * Dumb storage only: no balance math, no policy. See EconomyService.
 */
import path from 'path';
import fs from 'fs';
import { loadYamlSafe, saveYaml, ensureDir } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

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

  appendTransaction(userId, txn) {
    const dir = this.#economyDir(userId);
    if (!dir) return null;
    const day = String(txn.at).slice(0, 10);
    const base = path.join(dir, 'ledger', day);
    ensureDir(path.dirname(base));
    const list = loadYamlSafe(base) || [];
    list.push(txn);
    saveYaml(base, list, { noRefs: true });
    return txn;
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
    if (!fs.existsSync(ledgerDir)) return [];
    return fs.readdirSync(ledgerDir)
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
