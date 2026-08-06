/**
 * YAML persistence for per-learner curriculum assignments (spec §7.2).
 *
 *   <dataDir>/household/apps/school/assignments/{learnerId}.yml
 *
 * Parent-editable by design: this is the one School file a grown-up is expected
 * to open in a text editor, so it is a flat, obvious mapping and the reader is
 * forgiving about shape (`../../../2_domains/school/planner.mjs` normalises the
 * entries). Dumb storage — nothing here knows what a course is.
 */
import path from 'path';
import { promises as fs } from 'fs';
import yaml from 'js-yaml';
import { IAssignmentStore } from '#apps/school/ports/IAssignmentStore.mjs';

// One flat segment starting alphanumeric: "..", "/", and hidden names cannot
// match, which is what keeps traversal out (same guard as the sibling stores).
const LEARNER_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const YAML_FILE_RE = /\.(yml|yaml)$/;

const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });
const isSafeLearnerId = (id) => typeof id === 'string' && LEARNER_ID_RE.test(id);

export class YamlAssignmentStore extends IAssignmentStore {
  #configService;
  #writeChain = Promise.resolve();

  constructor(config = {}) {
    super();
    if (!config.configService || typeof config.configService.getHouseholdPath !== 'function') {
      throw new Error('YamlAssignmentStore: configService with getHouseholdPath() is required');
    }
    this.#configService = config.configService;
  }

  #root() { return this.#configService.getHouseholdPath('apps/school/assignments'); }

  #fileFor(learnerId) { return path.join(this.#root(), `${learnerId}.yml`); }

  // History lives one level up, alongside (not inside) the current-state
  // directory: `apps/school/history/{learnerId}.yml`, not `apps/school/assignments/history/...`.
  #historyRoot() { return path.join(this.#root(), '..', 'history'); }

  #historyFileFor(learnerId) { return path.join(this.#historyRoot(), `${learnerId}.yml`); }

  async #readHistory(learnerId) {
    try {
      const raw = yaml.load(await fs.readFile(this.#historyFileFor(learnerId), 'utf8'));
      return Array.isArray(raw) ? raw : [];
    } catch {
      // Missing OR unparseable: same forgiving answer as #read — a mid-edit
      // or absent history file means "nothing recorded yet", not a 500.
      return [];
    }
  }

  async #read(learnerId) {
    try {
      const raw = yaml.load(await fs.readFile(this.#fileFor(learnerId), 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      return {
        learnerId: typeof raw.learnerId === 'string' ? raw.learnerId : learnerId,
        courses: Array.isArray(raw.courses) ? raw.courses : [],
        units: Array.isArray(raw.units) ? raw.units : [],
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
      };
    } catch {
      // Missing OR unparseable, deliberately the same answer: a parent
      // mid-edit must not blank every other child's agenda.
      return null;
    }
  }

  /** @inheritdoc */
  async get(learnerId) {
    if (!isSafeLearnerId(learnerId)) return null;
    return this.#read(learnerId);
  }

  /** @inheritdoc */
  async put(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error('YamlAssignmentStore: record must be a mapping');
    }
    const { learnerId } = record;
    if (!isSafeLearnerId(learnerId)) throw new Error(`YamlAssignmentStore: unsafe learnerId: ${learnerId}`);
    const stored = {
      learnerId,
      courses: Array.isArray(record.courses) ? record.courses : [],
      units: Array.isArray(record.units) ? record.units : [],
      // WHO changed the plan. The write is adult-only (SetAssignments), and the
      // record is the only place that fact survives — a plan that changed with
      // nobody's name on it is a plan nobody can ask about.
      assignedBy: typeof record.assignedBy === 'string' && record.assignedBy ? record.assignedBy : null,
      updatedAt: record.updatedAt ?? null,
    };
    const queued = this.#writeChain.then(async () => {
      await fs.mkdir(this.#root(), { recursive: true });
      await fs.writeFile(this.#fileFor(learnerId), dumpYaml(stored), 'utf8');
      // History append happens in the SAME queued task as the current-state
      // write — never a torn pair where one lands and the other doesn't, and
      // never racing a concurrent put for the same or another learner.
      const entry = { ...stored, recordedAt: stored.updatedAt ?? new Date().toISOString() };
      const history = await this.#readHistory(learnerId);
      history.push(entry);
      await fs.mkdir(this.#historyRoot(), { recursive: true });
      await fs.writeFile(this.#historyFileFor(learnerId), dumpYaml(history), 'utf8');
      return stored;
    });
    this.#writeChain = queued.catch(() => {});
    return queued;
  }

  /** @inheritdoc */
  async history(learnerId) {
    if (!isSafeLearnerId(learnerId)) return [];
    return this.#readHistory(learnerId);
  }

  /** @inheritdoc */
  async list() {
    let names;
    try {
      names = await fs.readdir(this.#root());
    } catch {
      return [];
    }
    const ids = names
      .filter((n) => YAML_FILE_RE.test(n))
      .map((n) => n.replace(YAML_FILE_RE, ''))
      .filter(isSafeLearnerId)
      .sort();
    const records = await Promise.all(ids.map((id) => this.#read(id)));
    return records.filter(Boolean);
  }
}

export default YamlAssignmentStore;
