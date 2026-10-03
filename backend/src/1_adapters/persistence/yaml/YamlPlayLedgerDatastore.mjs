/**
 * YamlPlayLedgerDatastore — the household play ledger on disk.
 *
 *   <root>/<YYYY-MM-DD>.yml   a YAML list of rows, bucketed by the row's LOCAL
 *                             day (`localTime` prefix), appended in order.
 *
 * Household-wide, not per device: the questions asked of it ("what played in
 * the house this week", "what played on this screen tonight") are windows of
 * time first. Retention: day files older than `retentionDays` are deleted,
 * checked at most once per local day on write.
 *
 * Reads are mtime-cached per file; writes are synchronous so two appends in
 * one process can never interleave a read-modify-write.
 */
import path from 'path';
import {
  loadYamlFromPath,
  saveYamlToPathAtomic,
  listYamlFiles,
  dirExists,
  getStats,
  deleteFile,
} from '#system/utils/FileIO.mjs';
import { IPlayLedgerDatastore } from '#apps/media/ports/IPlayLedgerDatastore.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayMinus(day, days) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export class YamlPlayLedgerDatastore extends IPlayLedgerDatastore {
  #root;
  #retentionDays;
  #today;
  #logger;
  #prunedOn = null;
  /** @type {Map<string, {mtimeMs:number, rows:Object[]}>} */
  #cache = new Map();

  /**
   * @param {Object} deps
   * @param {string} deps.root - absolute ledger directory (composition resolves it)
   * @param {number} deps.retentionDays
   * @param {() => string} deps.today - local `YYYY-MM-DD`
   */
  constructor({ root, retentionDays, today, logger = console }) {
    super();
    if (!root) throw new InfrastructureError('YamlPlayLedgerDatastore requires root', { code: 'MISSING_DEPENDENCY', dependency: 'root' });
    if (typeof today !== 'function') throw new InfrastructureError('YamlPlayLedgerDatastore requires today', { code: 'MISSING_DEPENDENCY', dependency: 'today' });
    this.#root = root;
    this.#retentionDays = retentionDays;
    this.#today = today;
    this.#logger = logger;
  }

  #file(day) { return path.join(this.#root, `${day}.yml`); }

  #read(day) {
    const file = this.#file(day);
    const stats = getStats(file);
    if (!stats) { this.#cache.delete(day); return []; }
    const cached = this.#cache.get(day);
    if (cached && cached.mtimeMs === stats.mtimeMs) return cached.rows;
    const data = loadYamlFromPath(file);
    const rows = Array.isArray(data) ? data : [];
    this.#cache.set(day, { mtimeMs: stats.mtimeMs, rows });
    return rows;
  }

  #days() {
    if (!dirExists(this.#root)) return [];
    return listYamlFiles(this.#root, { stripExtension: true }).filter((d) => DAY_RE.test(d)).sort();
  }

  #prune() {
    const today = this.#today();
    if (!this.#retentionDays || this.#prunedOn === today) return;
    this.#prunedOn = today;
    const cutoff = dayMinus(today, this.#retentionDays);
    for (const day of this.#days()) {
      if (day >= cutoff) break;
      deleteFile(this.#file(day));
      this.#cache.delete(day);
      this.#logger.info?.('media.play-ledger.pruned', { day });
    }
  }

  async append(row) {
    const day = typeof row?.localTime === 'string' && DAY_RE.test(row.localTime.slice(0, 10))
      ? row.localTime.slice(0, 10)
      : this.#today();
    const rows = [...this.#read(day), row];
    saveYamlToPathAtomic(this.#file(day), rows);
    this.#cache.delete(day);
    this.#prune();
  }

  async list({ fromDay = null, toDay = null } = {}) {
    const out = [];
    for (const day of this.#days()) {
      if (fromDay && day < fromDay) continue;
      if (toDay && day > toDay) continue;
      out.push(...this.#read(day));
    }
    return out;
  }
}

export default YamlPlayLedgerDatastore;
