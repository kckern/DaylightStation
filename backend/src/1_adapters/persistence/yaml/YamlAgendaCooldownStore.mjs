/**
 * YAML persistence for the agenda print cooldown (Slice G,
 * 2026-08-22-omr-grading-integrity).
 *
 *   <dataDir>/household/school/runtime/agenda-cooldown/{learnerId}.yml
 *
 * Same tree, same one-file-per-key shape as the rest of School's transient
 * runtime state — `YamlTokenRegistry`'s `runtime/tokens/{body}.yml`,
 * `YamlReviewQueue`'s `runtime/review/{sessionId}.yml`. This is operational
 * state a re-scan needs to consult to decide whether to print again, not a
 * plan a parent edits (`school/plans/`) or a durable evidence record
 * (`school/records/`) — hence `runtime/`, following the existing split
 * rather than inventing a fourth tree.
 *
 * Keyed on **learnerId**, not card UID or artifact id: a learner with two
 * cards enrolled must still see ONE cooldown clock, not two.
 *
 * NEVER THROWS ON READ. A corrupt or missing file both answer `null` — "no
 * cooldown on record" — which is the fail-open direction: the worst a bad
 * file can do is let one extra agenda print, never silence a child's very
 * first tap of the day because a stray byte broke a YAML parse.
 */
import path from 'path';
import yaml from 'js-yaml';
import { IAgendaCooldownStore } from '#apps/school/ports/IAgendaCooldownStore.mjs';
import { readTextFromPath, writeFileAtomic } from '#system/utils/FileIO.mjs';

const LEARNER_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const isSafeLearnerId = (id) => typeof id === 'string' && LEARNER_ID_RE.test(id);
const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });

export class YamlAgendaCooldownStore extends IAgendaCooldownStore {
  #configService;
  #logger;
  #writeChain = Promise.resolve();

  /**
   * @param {object} config
   * @param {object} config.configService - `getHouseholdPath()` provider (required)
   * @param {object} [config.logger]
   */
  constructor({ configService, logger = console } = {}) {
    super();
    if (!configService || typeof configService.getHouseholdPath !== 'function') {
      throw new Error('YamlAgendaCooldownStore: configService with getHouseholdPath() is required');
    }
    this.#configService = configService;
    this.#logger = logger;
  }

  #root() { return this.#configService.getHouseholdPath('school/runtime/agenda-cooldown'); }

  #fileFor(learnerId) { return path.join(this.#root(), `${learnerId}.yml`); }

  /** @inheritdoc */
  async get(learnerId) {
    if (!isSafeLearnerId(learnerId)) return null;
    let text;
    try {
      text = readTextFromPath(this.#fileFor(learnerId));
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        this.#logger.warn?.('school.agenda-cooldown.read-failed', { learnerId, error: err.message });
      }
      return null;
    }
    try {
      const raw = yaml.load(text);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      return {
        learnerId,
        lastAgendaPrintedAt: typeof raw.lastAgendaPrintedAt === 'string' ? raw.lastAgendaPrintedAt : null,
        contentHash: typeof raw.contentHash === 'string' ? raw.contentHash : null,
      };
    } catch (err) {
      this.#logger.warn?.('school.agenda-cooldown.corrupt', { learnerId, error: err.message, file: this.#fileFor(learnerId) });
      return null;
    }
  }

  /** @inheritdoc */
  async put(record) {
    const learnerId = record?.learnerId;
    if (!isSafeLearnerId(learnerId)) throw new Error(`YamlAgendaCooldownStore: unsafe learnerId: ${learnerId}`);
    const stored = {
      learnerId,
      lastAgendaPrintedAt: typeof record.lastAgendaPrintedAt === 'string' ? record.lastAgendaPrintedAt : null,
      contentHash: typeof record.contentHash === 'string' ? record.contentHash : null,
    };
    // Queued like the sibling runtime stores (`YamlTokenRegistry`): a
    // learner tapping twice in a row must not interleave two writes to the
    // same file.
    const queued = this.#writeChain.then(async () => {
      writeFileAtomic(this.#fileFor(learnerId), dumpYaml(stored));
      return stored;
    });
    this.#writeChain = queued.catch(() => {});
    return queued;
  }
}

export default YamlAgendaCooldownStore;
