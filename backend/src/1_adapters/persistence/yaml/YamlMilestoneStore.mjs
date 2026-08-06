/**
 * YamlMilestoneStore — expected-progress targets (plan W3-3):
 * `apps/school/milestones.yml` `{milestones, history}`. Planner-scale
 * whole-list replace (the assignments posture); statuses are DERIVED by
 * `GetMilestoneStatuses` on every read, never stored.
 */
import path from 'path';
import fsSync from 'fs';
import { promises as fs } from 'fs';
import yaml from 'js-yaml';

const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });

async function atomicWrite(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, file);
}


export class YamlMilestoneStore {
  #configService; #logger; #writeChain = Promise.resolve();

  constructor({ configService, logger = console } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlMilestoneStore requires configService');
    this.#configService = configService;
    this.#logger = logger;
  }

  #file() { return path.join(this.#configService.getHouseholdPath('apps/school'), 'milestones.yml'); }

  #readState() {
    let text;
    try { text = fsSync.readFileSync(this.#file(), 'utf8'); } catch { return { state: 'missing', milestones: [], history: [] }; }
    try {
      const raw = yaml.load(text);
      if (raw && typeof raw === 'object') return { state: 'ok', milestones: raw.milestones ?? [], history: raw.history ?? [] };
    } catch { /* fall through */ }
    this.#logger.error?.('school.milestones.file-corrupt', { file: this.#file() });
    return { state: 'corrupt', milestones: [], history: [] };
  }

  #read() { return this.#readState(); }

  list() { return structuredClone(this.#read().milestones); }

  historyLength() { return (this.#read().history ?? []).length; }

  async replace(milestones, { editedBy = null, at = new Date().toISOString() } = {}) {
    this.#writeChain = this.#writeChain.then(async () => {
      await this.#write(() => milestones, { editedBy, at });
    });
    await this.#writeChain;
  }

  /**
   * Learner-scoped replace INSIDE the write chain (M3 review): the
   * read-merge happens in the same chained closure as the write, so two
   * teachers saving different learners cannot lose each other's edit.
   */
  async replaceForLearner(learnerId, rows, { editedBy = null, at = new Date().toISOString() } = {}) {
    this.#writeChain = this.#writeChain.then(async () => {
      await this.#write((current) => [
        ...current.filter((m) => m.learnerId !== learnerId), ...rows,
      ], { editedBy, at });
    });
    await this.#writeChain;
  }

  async #write(nextFrom, { editedBy, at }) {
    const current = this.#readState();
    if (current.state === 'corrupt') {
      throw new Error(`milestones.yml exists but cannot be read — fix or move it before editing (${this.#file()})`);
    }
    const milestones = nextFrom(current.milestones);
    const history = [...current.history, { at, editedBy, milestones }];
    await atomicWrite(this.#file(), dumpYaml({ milestones, history }));
    this.#logger.info?.('school.milestones.replaced', { editedBy, count: milestones.length });
  }
}

export default YamlMilestoneStore;
