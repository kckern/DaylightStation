/**
 * Content-filter run state as YAML: `household/content-filter/jobs/<rk>.yml` (data volume).
 * Keeps the last 10 runs plus the latest audit. Writes are atomic.
 */
import path from 'path';
import { buildContainedPath, fileExists, listYamlFiles, readYamlFromPath, saveYamlToPathAtomic, writeFileExclusive } from '#system/utils/FileIO.mjs';
import { IFilterJobStore } from '../../application/content-filter/ports/IFilterJobStore.mjs';

export const KEEP_RUNS = 10;

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
