import path from 'node:path';
import { loadYaml, resolveYamlPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';
import { SLUG, STATUS_SCHEMA, emptyStatus } from '#domains/school/wordLadder/index.mjs';

const isMap = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * `users/{id}/apps/school/word-ladder/{package}/status.yml` — one learner's
 * word ladder for one word package (the lexicon's `package`). Keyed by word,
 * so status carries across weekly decks of the same package. A corrupt file is
 * never overwritten: it is a child's record.
 */
export class YamlWordLadderStore {
  #configService; #logger;
  constructor({ configService, logger = console } = {}) {
    if (typeof configService?.getUserDir !== 'function') {
      throw new InfrastructureError('YamlWordLadderStore requires configService.getUserDir()', { code: 'MISSING_DEPENDENCY' });
    }
    this.#configService = configService; this.#logger = logger;
  }
  #base(userId, pkg) {
    if (typeof pkg !== 'string' || !SLUG.test(pkg)) {
      throw new InfrastructureError(`invalid word package '${pkg}'`, { code: 'INVALID_WORD_PACKAGE' });
    }
    if (!this.#configService.getUserProfile?.(userId)) return null;
    return path.join(this.#configService.getUserDir(userId), 'apps', 'school', 'word-ladder', pkg, 'status');
  }
  #read(userId, pkg) {
    const base = this.#base(userId, pkg);
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
      this.#logger.error?.('school.word-ladder.status-corrupt', { learnerId: userId, package: pkg, file, error: error.message });
      return { state: 'corrupt', value: emptyStatus(), file };
    }
  }
  read(userId, pkg) { return structuredClone(this.#read(userId, pkg).value); }
  save(userId, pkg, value) {
    const current = this.#read(userId, pkg);
    if (!current.file) throw new InfrastructureError(`cannot resolve word-ladder status for ${userId}`, { code: 'UNKNOWN_USER' });
    if (current.state === 'corrupt') {
      throw new DomainInvariantError(`word-ladder status for '${userId}' is corrupt — refusing to overwrite it`, { code: 'WORD_LADDER_STATUS_CORRUPT' });
    }
    if (value?.schema !== STATUS_SCHEMA || !isMap(value.words)) throw new TypeError('word-ladder status has invalid shape');
    saveYamlToPathAtomic(current.file, value, { noRefs: true });
    return true;
  }
  update(userId, pkg, fn) {
    const next = fn(this.read(userId, pkg));
    this.save(userId, pkg, next);
    return structuredClone(next);
  }
}
export default YamlWordLadderStore;
