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

export class YamlMilestoneStore {
  #configService; #logger; #writeChain = Promise.resolve();

  constructor({ configService, logger = console } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlMilestoneStore requires configService');
    this.#configService = configService;
    this.#logger = logger;
  }

  #file() { return path.join(this.#configService.getHouseholdPath('apps/school'), 'milestones.yml'); }

  #read() {
    try {
      const raw = yaml.load(fsSync.readFileSync(this.#file(), 'utf8'));
      return raw && typeof raw === 'object' ? { milestones: raw.milestones ?? [], history: raw.history ?? [] } : { milestones: [], history: [] };
    } catch { return { milestones: [], history: [] }; }
  }

  list() { return structuredClone(this.#read().milestones); }

  async replace(milestones, { editedBy = null, at = new Date().toISOString() } = {}) {
    this.#writeChain = this.#writeChain.then(async () => {
      const current = this.#read();
      const history = [...current.history, { at, editedBy, milestones }];
      await fs.mkdir(path.dirname(this.#file()), { recursive: true });
      await fs.writeFile(this.#file(), dumpYaml({ milestones, history }), 'utf8');
      this.#logger.info?.('school.milestones.replaced', { editedBy, count: milestones.length });
    });
    await this.#writeChain;
  }
}

export default YamlMilestoneStore;
