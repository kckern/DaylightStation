/**
 * YAML persistence for granted play time.
 *
 * Layout: `users/{userId}/apps/gaming/grants/{YYYY-MM-DD}.yml` — a list of
 * entries, folded to a balance on read. Mirrors the household economy's
 * date-segmented, append-only ledger, for the same reason: the record of who
 * granted what has to survive, and a single mutable total cannot be audited.
 *
 * Nothing is ever deleted. Revoking is an entry with a negative delta, so the
 * history shows the grant AND the revocation rather than neither.
 */
import path from 'path';
import { loadYamlSafe, saveYaml, ensureDir } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { IPlayGrantLedger } from '#apps/gaming/ports/IPlayGrantLedger.mjs';

export class YamlPlayGrantLedger extends IPlayGrantLedger {
  #configService; #logger;

  constructor({ configService, logger = console } = {}) {
    super();
    if (!configService) {
      throw new InfrastructureError('YamlPlayGrantLedger requires configService', {
        code: 'MISSING_DEPENDENCY', dependency: 'configService',
      });
    }
    this.#configService = configService;
    this.#logger = logger;
  }

  #path(userId, isoDate) {
    return path.join(
      this.#configService.getUserDir(userId), 'apps', 'gaming', 'grants', String(isoDate).slice(0, 10),
    );
  }

  async forUserOn(userId, isoDate) {
    if (!userId) return { grantedMs: 0, entries: [] };
    let entries = [];
    try {
      entries = loadYamlSafe(this.#path(userId, isoDate)) || [];
    } catch (error) {
      // An unreadable ledger must read as NO time, never as unlimited.
      this.#logger.warn?.('play.grant.ledger_unreadable', { userId, isoDate, error: error.message });
      return { grantedMs: 0, entries: [] };
    }
    if (!Array.isArray(entries)) return { grantedMs: 0, entries: [] };
    const grantedMs = entries.reduce((total, entry) => total + (Number(entry?.deltaMs) || 0), 0);
    return { grantedMs: Math.max(0, grantedMs), entries };
  }

  async append(userId, isoDate, entry) {
    const file = this.#path(userId, isoDate);
    ensureDir(path.dirname(file));
    const entries = loadYamlSafe(file) || [];
    const row = {
      at: entry.at || new Date().toISOString(),
      deltaMs: Number(entry.deltaMs) || 0,
      by: entry.by || null,
      reason: entry.reason || null,
    };
    entries.push(row);
    saveYaml(file, entries, { noRefs: true });
    return row;
  }
}

export default YamlPlayGrantLedger;
