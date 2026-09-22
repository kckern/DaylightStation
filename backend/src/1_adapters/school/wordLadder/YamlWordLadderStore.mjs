import path from 'node:path';
import { loadYaml, resolveYamlPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';
import { STATUS_SCHEMA, emptyStatus } from '#domains/school/wordLadder/index.mjs';

const isMap = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * `users/{id}/apps/school/{programDir}/status.yml` — one learner's word
 * ladder. Keyed by word, so status carries across weekly decks. A corrupt
 * file is never overwritten: it is a child's record.
 */
export class YamlWordLadderStore {
  #configService; #logger; #programDir;
  constructor({ configService, programDir = 'korean-vocab', logger = console } = {}) {
    if (typeof configService?.getUserDir !== 'function') {
      throw new InfrastructureError('YamlWordLadderStore requires configService.getUserDir()', { code: 'MISSING_DEPENDENCY' });
    }
    this.#configService = configService; this.#logger = logger; this.#programDir = programDir;
  }
  #base(userId) {
    if (!this.#configService.getUserProfile?.(userId)) return null;
    return path.join(this.#configService.getUserDir(userId), 'apps', 'school', this.#programDir, 'status');
  }
  #read(userId) {
    const base = this.#base(userId);
    if (!base) return { state: 'missing', value: emptyStatus(), file: null };
    const file = resolveYamlPath(base);
    if (!file) return { state: 'missing', value: emptyStatus(), file: `${base}.yml` };
    try {
      const raw = loadYaml(base);
      if (raw == null) return { state: 'ok', value: emptyStatus(), file };
      if (raw.schema !== STATUS_SCHEMA || !isMap(raw.words)) throw new Error('invalid shape');
      return {
        state: 'ok',
        file,
        value: {
          ...emptyStatus(), ...raw,
          paperAttemptsFolded: Array.isArray(raw.paperAttemptsFolded) ? raw.paperAttemptsFolded : [],
          days: isMap(raw.days) ? raw.days : {},
          sessions: isMap(raw.sessions) ? raw.sessions : {},
        },
      };
    } catch (error) {
      this.#logger.error?.('school.word-ladder.status-corrupt', { learnerId: userId, file, error: error.message });
      return { state: 'corrupt', value: emptyStatus(), file };
    }
  }
  read(userId) { return structuredClone(this.#read(userId).value); }
  save(userId, value) {
    const current = this.#read(userId);
    if (!current.file) throw new InfrastructureError(`cannot resolve word-ladder status for ${userId}`, { code: 'UNKNOWN_USER' });
    if (current.state === 'corrupt') {
      throw new DomainInvariantError(`word-ladder status for '${userId}' is corrupt — refusing to overwrite it`, { code: 'WORD_LADDER_STATUS_CORRUPT' });
    }
    if (value?.schema !== STATUS_SCHEMA || !isMap(value.words)) throw new TypeError('word-ladder status has invalid shape');
    saveYamlToPathAtomic(current.file, value, { noRefs: true });
    return true;
  }
  update(userId, fn) {
    const next = fn(this.read(userId));
    this.save(userId, next);
    return structuredClone(next);
  }
}
export default YamlWordLadderStore;
