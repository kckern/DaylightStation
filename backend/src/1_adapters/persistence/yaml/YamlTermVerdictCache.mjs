/**
 * Per-learner, per-term verdict cache at
 * `<household>/school/records/verdicts/<learnerId>/<termId>.yml`:
 *
 *   schema: school.term-verdicts/v1
 *   version: 1            # termVerdict.VERDICT_VERSION the rows were made with
 *   computedAt: <iso>
 *   days:
 *     2026-09-01: { state, reason, served, asked, weekday, computedAt, sections: [...], weekly: [...] }
 *
 * Beside the reading log, because it is the same kind of thing — a dated,
 * per-learner school record — and because the household path is what the
 * school stores are given. Missing, empty, corrupt or unreadable all read as
 * "nothing cached" (with a warn for the last two): this is a cache, and the
 * worst a bad file can cost is one recompute.
 */
import path from 'path';
import yaml from 'js-yaml';
import { fileExists, readFile, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import { ITermVerdictCache } from '#apps/school/ports/ITermVerdictCache.mjs';

const SCHEMA = 'school.term-verdicts/v1';
const SAFE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;

export class YamlTermVerdictCache extends ITermVerdictCache {
  #configService; #logger; #writeChain = Promise.resolve();

  constructor({ configService, logger = console } = {}) {
    super();
    if (!configService?.getHouseholdPath) throw new Error('YamlTermVerdictCache requires configService');
    this.#configService = configService;
    this.#logger = logger;
  }

  #fileFor(learnerId, termId) {
    if (!SAFE.test(learnerId ?? '') || !SAFE.test(termId ?? '')) {
      throw new TypeError(`YamlTermVerdictCache: unsafe id (${learnerId}/${termId})`);
    }
    return path.join(this.#configService.getHouseholdPath('school/records/verdicts'), learnerId, `${termId}.yml`);
  }

  async read(learnerId, termId) {
    const file = this.#fileFor(learnerId, termId);
    if (!fileExists(file)) return null;
    const text = readFile(file);
    if (typeof text !== 'string' || !text.trim()) return null;
    let raw;
    try { raw = yaml.load(text); } catch (err) {
      this.#logger.warn?.('school.term-verdicts.corrupt', { learnerId, termId, file, error: err.message });
      return null;
    }
    if (!raw || typeof raw !== 'object' || raw.schema !== SCHEMA || !raw.days || typeof raw.days !== 'object') {
      this.#logger.warn?.('school.term-verdicts.unrecognised', { learnerId, termId, file });
      return null;
    }
    return {
      version: Number.isInteger(raw.version) ? raw.version : 0,
      computedAt: typeof raw.computedAt === 'string' ? raw.computedAt : null,
      days: { ...raw.days },
    };
  }

  async write(learnerId, termId, doc) {
    const file = this.#fileFor(learnerId, termId);
    const run = async () => {
      saveYamlToPathAtomic(file, {
        schema: SCHEMA, learnerId, termId,
        version: doc.version, computedAt: doc.computedAt, days: doc.days,
      }, { noRefs: true });
    };
    const queued = this.#writeChain.then(run);
    this.#writeChain = queued.catch(() => {});
    return queued;
  }
}

export default YamlTermVerdictCache;
