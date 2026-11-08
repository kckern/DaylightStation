/**
 * Content-filter run state as YAML: `household/content-filter/jobs/<rk>.yml` (data volume).
 * Keeps the last 10 runs plus the latest audit. Writes are atomic.
 */
import path from 'path';
import { buildContainedPath, deleteFile, fileExists, fileMtimeMs, listYamlFiles, readYamlFromPath, saveYamlToPathAtomic, writeFileExclusive } from '#system/utils/FileIO.mjs';
import { IFilterJobStore } from '../../application/content-filter/ports/IFilterJobStore.mjs';

export const KEEP_RUNS = 10;
const LOCK_WAIT_MS = 10000;
const LOCK_STALE_MS = 30000;
const LOCK_RETRY_MS = 20;
const pause = (ms) => new Promise((r) => { setTimeout(r, ms); });

export class YamlFilterJobStore extends IFilterJobStore {
  #dir;

  constructor({ householdDir }) {
    super();
    if (!householdDir) throw new Error('YamlFilterJobStore requires householdDir');
    this.#dir = path.join(householdDir, 'content-filter', 'jobs');
  }

  #path(rk) {
    if (!/^\d+$/.test(String(rk ?? ''))) throw new Error(`bad ratingKey: ${rk}`);
    return buildContainedPath(this.#dir, `${rk}.yml`);
  }

  async load(rk) {
    const p = this.#path(rk);
    return p && fileExists(p) ? readYamlFromPath(p) || null : null;
  }

  async save(rk, record) {
    const runs = (record.runs || []).slice(-KEEP_RUNS);
    saveYamlToPathAtomic(this.#path(rk), { ...record, ratingKey: String(rk), runs }, { lineWidth: 140 });
  }

  /**
   * Read-modify-write one film's record under a lock file, so the app and the worker (two
   * processes) never lose each other's writes. fn(record) mutates in place; its value is returned.
   */
  async update(rk, fn) {
    this.#path(rk); // validates the rating key
    const lock = buildContainedPath(this.#dir, `locks/${rk}.lock`);
    const until = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try { writeFileExclusive(lock, `${process.pid}\n`); break; } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        const age = Date.now() - (fileMtimeMs(lock) ?? Date.now());
        if (age > LOCK_STALE_MS) { deleteFile(lock); continue; }
        if (Date.now() > until) throw new Error(`content-filter jobs: ${rk} stayed locked`);
        await pause(LOCK_RETRY_MS);
      }
    }
    try {
      const rec = (await this.load(rk)) || { ratingKey: String(rk), runs: [] };
      const out = await fn(rec);
      await this.save(rk, rec);
      return out;
    } finally { deleteFile(lock); }
  }

  /** Atomic across processes: the first worker to create the claim file owns the run. */
  async claim(rk, runId, owner) {
    if (!/^\d+$/.test(String(rk ?? ''))) throw new Error(`bad ratingKey: ${rk}`);
    if (!/^[A-Za-z0-9-]+$/.test(String(runId))) throw new Error(`bad runId: ${runId}`);
    try {
      writeFileExclusive(buildContainedPath(this.#dir, `claims/${rk}-${runId}.claim`), `${owner}\n`);
      return true;
    } catch (e) {
      if (e.code === 'EEXIST') return false;
      throw e;
    }
  }

  async list() {
    const out = [];
    for (const rk of listYamlFiles(this.#dir).filter((n) => /^\d+$/.test(n))) {
      const r = await this.load(rk);
      if (r) out.push(r);
    }
    return out;
  }
}
