import { loadYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

/** Append-only, study-day-scoped program obligation bypass ledger. */
export class YamlProgramDayBypassStore {
  #configService; #writeChain = Promise.resolve();
  constructor({ configService } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlProgramDayBypassStore requires configService');
    this.#configService = configService;
  }
  #file() { return this.#configService.getHouseholdPath('school/records/program-day-bypasses.yml'); }

  /** Missing file (nothing has ever been excused) reads as an empty ledger. */
  async list() {
    const raw = loadYamlFromPath(this.#file());
    return Array.isArray(raw) ? raw : [];
  }

  async append(record) {
    const run = async () => {
      const records = await this.list();
      records.push(structuredClone(record));
      saveYamlToPathAtomic(this.#file(), records, { noRefs: true });
      return structuredClone(record);
    };
    const queued = this.#writeChain.then(run);
    this.#writeChain = queued.catch(() => {});
    return queued;
  }

  async active() {
    const records = await this.list();
    const retracted = new Set(records.filter((r) => r.operation === 'retracted').map((r) => r.bypassId));
    return records.filter((r) => r.operation === 'applied' && !retracted.has(r.bypassId));
  }

  /** The active bypass (if any) for one learner + program + study day. */
  async activeFor({ learnerId, programId, studyDate }) {
    const active = await this.active();
    return active.find((r) => r.learnerId === learnerId && r.programId === programId && r.studyDate === studyDate) ?? null;
  }
}

export default YamlProgramDayBypassStore;
