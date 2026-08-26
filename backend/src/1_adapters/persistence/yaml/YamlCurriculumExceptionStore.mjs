import path from 'node:path';
import { promises as fs } from 'node:fs';
import yaml from 'js-yaml';
import { saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

/** Append-only curriculum exception ledger. */
export class YamlCurriculumExceptionStore {
  #configService; #writeChain = Promise.resolve();
  constructor({ configService } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlCurriculumExceptionStore requires configService');
    this.#configService = configService;
  }
  #file() { return this.#configService.getHouseholdPath('school/records/curriculum-exceptions.yml'); }
  async list() {
    try { const raw = yaml.load(await fs.readFile(this.#file(), 'utf8')); return Array.isArray(raw) ? raw : []; } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async append(record) {
    const run = async () => {
      const records = await this.list(); records.push(structuredClone(record));
      // Atomic replacement: #writeChain already stops two appends racing, but
      // a truncate-then-write still exposes a reader (or a crash) to a
      // half-written ledger.
      saveYamlToPathAtomic(this.#file(), records, { noRefs: true });
      return structuredClone(record);
    };
    const queued = this.#writeChain.then(run); this.#writeChain = queued.catch(() => {}); return queued;
  }
  async active() {
    const records = await this.list();
    const retracted = new Set(records.filter((record) => record.operation === 'retracted').map((record) => record.exceptionId));
    return records.filter((record) => record.operation === 'applied' && !retracted.has(record.exceptionId));
  }
}

export default YamlCurriculumExceptionStore;
