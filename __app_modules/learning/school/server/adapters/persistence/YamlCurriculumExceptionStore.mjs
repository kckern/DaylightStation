import { readYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

/** Append-only curriculum exception ledger. */
export class YamlCurriculumExceptionStore {
  #configService; #writeChain = Promise.resolve();
  constructor({ configService } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlCurriculumExceptionStore requires configService');
    this.#configService = configService;
  }
  #file() { return this.#configService.getHouseholdPath('school/records/curriculum-exceptions.yml'); }
  async list() {
    try { const raw = readYamlFromPath(this.#file()); return Array.isArray(raw) ? raw : []; } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
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
    return this.activeAsOf(null);
  }

  /**
   * The exceptions in force at an instant: applied before `untilIso`, and not
   * retracted before it. `null` is "now" — every record counts, which is what
   * `active()` has always answered. A past-day replay passes the end of that
   * day's window, so an exception granted on Thursday does not re-colour
   * Tuesday, and one retracted on Friday still counted on Wednesday.
   *
   * `applied` rows carry `decidedAt`, `retracted` rows `retractedAt`
   * (`ManageCurriculumException`). A record with no readable stamp is treated as always in force: the ledger
   * predates the stamp, and dropping it would silently revoke an excuse.
   */
  async activeAsOf(untilIso = null) {
    const records = await this.list();
    const untilMs = untilIso == null ? null : Date.parse(untilIso);
    const before = (record) => {
      if (untilMs == null || !Number.isFinite(untilMs)) return true;
      const at = Date.parse(record?.decidedAt ?? record?.retractedAt ?? record?.at ?? '');
      return !Number.isFinite(at) || at < untilMs;
    };
    const retracted = new Set(records
      .filter((record) => record.operation === 'retracted' && before(record))
      .map((record) => record.exceptionId));
    return records.filter((record) => record.operation === 'applied' && before(record)
      && !retracted.has(record.exceptionId));
  }
}

export default YamlCurriculumExceptionStore;
