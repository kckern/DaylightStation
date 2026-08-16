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
import { DomainInvariantError } from '#domains/core/errors/index.mjs';

// One flat segment starting alphanumeric: "..", "/", and hidden names cannot
// match, which is what keeps traversal out (same guard as the sibling stores).
const LEARNER_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const YAML_FILE_RE = /\.(yml|yaml)$/;

const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });
const isSafeLearnerId = (id) => typeof id === 'string' && LEARNER_ID_RE.test(id);

const stagingPathFor = (filePath) => `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export class YamlAssignmentStore extends IAssignmentStore {
  #configService;
  #logger;
  #writeChain = Promise.resolve();

  // Same posture as YamlSchoolDatastore#readAttemptShard: missing and corrupt
  // are different answers, and ONLY corrupt is remembered here — per
  // learnerId, current-file and history-file are tracked separately since a
  // learner can have one broken without the other. A read that comes back
  // clean clears the flag, so a parent fixing the file by hand un-wedges the
  // next put() without a restart.
  #corruptCurrent = new Set();
  #corruptHistory = new Set();

  constructor(config = {}) {
    super();
    if (!config.configService || typeof config.configService.getHouseholdPath !== 'function') {
      throw new Error('YamlAssignmentStore: configService with getHouseholdPath() is required');
    }
    this.#configService = config.configService;
    this.#logger = config.logger || console;
  }

  #root() { return this.#configService.getHouseholdPath('school/assignments'); }

  #fileFor(learnerId) { return path.join(this.#root(), `${learnerId}.yml`); }

  // History lives one level up, alongside (not inside) the current-state
  // directory: `apps/school/history/{learnerId}.yml`, not `apps/school/assignments/history/...`.
  #historyRoot() { return path.join(this.#root(), '..', 'history'); }

  #historyFileFor(learnerId) { return path.join(this.#historyRoot(), `${learnerId}.yml`); }

  /**
   * Read + parse the history file, tracking corrupt-vs-missing in
   * `#corruptHistory` (read for its SIDE EFFECT by `put`, below, before it
   * decides whether an append is safe). Missing is quiet; an existing but
   * unparseable file logs `school.assignments.history-corrupt` and answers
   * `[]` to any caller that only wants to read — the refusal to WRITE lives
   * in `put`, not here.
   */
  async #readHistory(learnerId) {
    let text;
    try {
      text = await fs.readFile(this.#historyFileFor(learnerId), 'utf8');
    } catch (err) {
      if (err?.code === 'ENOENT') { this.#corruptHistory.delete(learnerId); return []; }
      this.#markHistoryCorrupt(learnerId);
      return [];
    }
    try {
      const raw = yaml.load(text);
      this.#corruptHistory.delete(learnerId);
      return Array.isArray(raw) ? raw : [];
    } catch {
      this.#markHistoryCorrupt(learnerId);
      return [];
    }
  }

  #markHistoryCorrupt(learnerId) {
    this.#corruptHistory.add(learnerId);
    this.#logger.error?.('school.assignments.history-corrupt', { learnerId, file: this.#historyFileFor(learnerId) });
  }

  /**
   * Read + parse the current-state file, tracking corrupt-vs-missing in
   * `#corruptCurrent` (same reasoning as `#readHistory`). A parent mid-edit
   * or an absent file both answer `null` to `get()` — that half of the
   * contract is unchanged — but only the unparseable case is remembered as
   * "corrupt", which is what lets `put` refuse to clobber it.
   */
  async #read(learnerId) {
    let text;
    try {
      text = await fs.readFile(this.#fileFor(learnerId), 'utf8');
    } catch (err) {
      if (err?.code === 'ENOENT') { this.#corruptCurrent.delete(learnerId); return null; }
      this.#markCurrentCorrupt(learnerId);
      return null;
    }
    let raw;
    try {
      raw = yaml.load(text);
    } catch {
      this.#markCurrentCorrupt(learnerId);
      return null;
    }
    this.#corruptCurrent.delete(learnerId);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return {
      learnerId: typeof raw.learnerId === 'string' ? raw.learnerId : learnerId,
      courses: Array.isArray(raw.courses) ? raw.courses : [],
      units: Array.isArray(raw.units) ? raw.units : [],
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
      // Written on every put and then DROPPED on read for two waves — the
      // UI's "Assigned by …" line was dead code (admin advocacy #9).
      assignedBy: typeof raw.assignedBy === 'string' ? raw.assignedBy : null,
    };
  }

  #markCurrentCorrupt(learnerId) {
    this.#corruptCurrent.add(learnerId);
    this.#logger.error?.('school.assignments.file-corrupt', { learnerId, file: this.#fileFor(learnerId) });
  }

  /** Atomically replace a YAML file: write beside it, then rename over it. */
  async #writeYamlAtomic(filePath, content) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const staging = stagingPathFor(filePath);
    try {
      await fs.writeFile(staging, dumpYaml(content), 'utf8');
      await fs.rename(staging, filePath);
    } catch (err) {
      await fs.unlink(staging).catch(() => {});
      throw err;
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
      // Freshest corruption check right before writing — inside the queued
      // task, not before it, so a put queued behind another learner's write
      // still sees the file state at the moment it actually runs. `#read`
      // and `#readHistory` are called for their SIDE EFFECT of updating the
      // `#corrupt*` sets; their return values are irrelevant here.
      await this.#read(learnerId);
      if (this.#corruptCurrent.has(learnerId)) {
        throw new DomainInvariantError(
          `assignment file for learner '${learnerId}' is corrupt — refusing to overwrite it`,
          { code: 'ASSIGNMENTS_CORRUPT', details: { learnerId, file: this.#fileFor(learnerId) } },
        );
      }
      const history = await this.#readHistory(learnerId);
      if (this.#corruptHistory.has(learnerId)) {
        throw new DomainInvariantError(
          `assignment history for learner '${learnerId}' is corrupt — refusing to overwrite it`,
          { code: 'ASSIGNMENTS_CORRUPT', details: { learnerId, file: this.#historyFileFor(learnerId) } },
        );
      }
      await this.#writeYamlAtomic(this.#fileFor(learnerId), stored);
      this.#corruptCurrent.delete(learnerId);
      // History append happens in the SAME queued task as the current-state
      // write — never a torn pair where one lands and the other doesn't, and
      // never racing a concurrent put for the same or another learner.
      const entry = { ...stored, recordedAt: stored.updatedAt ?? new Date().toISOString() };
      history.push(entry);
      await this.#writeYamlAtomic(this.#historyFileFor(learnerId), history);
      this.#corruptHistory.delete(learnerId);
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
