import path from 'node:path';
import { loadYaml, resolveYamlPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';
import { DAY_SCHEMA, SLUG, STATUS_SCHEMA_V3, emptyDay, emptyStatusV3, migrateStatusV2 } from '#domains/school/wordLadder/index.mjs';

const isMap = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `users/{id}/apps/school/word-ladder/{package}/status.yml` + `days/{day}.yml`
 * (spec §4 Storage). A v1 status is migrated on read and written as v3 on the
 * next transaction. A corrupt file is never overwritten: it is a child's record.
 */
export class YamlWordLadderStore {
  #configService; #logger;
  constructor({ configService, logger = console } = {}) {
    if (typeof configService?.getUserDir !== 'function') {
      throw new InfrastructureError('YamlWordLadderStore requires configService.getUserDir()', { code: 'MISSING_DEPENDENCY' });
    }
    this.#configService = configService; this.#logger = logger;
  }
  #dir(userId, pkg) {
    if (typeof pkg !== 'string' || !SLUG.test(pkg)) throw new InfrastructureError(`invalid word package '${pkg}'`, { code: 'INVALID_WORD_PACKAGE' });
    if (!this.#configService.getUserProfile?.(userId)) return null;
    return path.join(this.#configService.getUserDir(userId), 'apps', 'school', 'word-ladder', pkg);
  }
  #load(base, parse, empty, context) {
    if (!resolveYamlPath(base)) return { state: 'missing', value: empty() };
    try {
      const raw = loadYaml(base);
      return { state: 'ok', value: raw == null ? empty() : parse(raw) };
    } catch (error) {
      this.#logger.error?.('school.word-ladder.status-corrupt', { ...context, error: error.message });
      return { state: 'corrupt', value: empty() };
    }
  }
  #status(userId, pkg) {
    const dir = this.#dir(userId, pkg);
    if (!dir) return { state: 'missing', value: emptyStatusV3(), file: null };
    const loaded = this.#load(path.join(dir, 'status'), (raw) => {
      if (raw.schema === STATUS_SCHEMA_V3 && isMap(raw.words)) return { ...emptyStatusV3(), ...raw };
      return migrateStatusV2(raw);
    }, emptyStatusV3, { learnerId: userId, package: pkg, file: 'status' });
    return { ...loaded, file: path.join(dir, 'status.yml') };
  }
  #day(userId, pkg, day) {
    if (!DAY.test(day)) throw new InfrastructureError(`invalid study day '${day}'`, { code: 'INVALID_DAY' });
    const dir = this.#dir(userId, pkg);
    if (!dir) return { state: 'missing', value: emptyDay(day), file: null };
    const loaded = this.#load(path.join(dir, 'days', day), (raw) => {
      if (raw.schema !== DAY_SCHEMA) throw new Error('invalid day shape');
      return { ...emptyDay(day), ...raw };
    }, () => emptyDay(day), { learnerId: userId, package: pkg, file: `days/${day}` });
    return { ...loaded, file: path.join(dir, 'days', `${day}.yml`) };
  }
  readStatus(userId, pkg) { return structuredClone(this.#status(userId, pkg).value); }
  readDay(userId, pkg, day) { return structuredClone(this.#day(userId, pkg, day).value); }
  transact(userId, pkg, day, fn) {
    const status = this.#status(userId, pkg);
    const dayFile = this.#day(userId, pkg, day);
    if (!status.file || !dayFile.file) throw new InfrastructureError(`cannot resolve word-ladder files for ${userId}`, { code: 'UNKNOWN_USER' });
    if (status.state === 'corrupt' || dayFile.state === 'corrupt') {
      throw new DomainInvariantError(`word-ladder status for '${userId}' is corrupt — refusing to overwrite it`, { code: 'WORD_LADDER_STATUS_CORRUPT' });
    }
    const next = fn({ status: structuredClone(status.value), dayFile: structuredClone(dayFile.value) });
    if (next?.status?.schema !== STATUS_SCHEMA_V3 || next?.dayFile?.schema !== DAY_SCHEMA) throw new TypeError('word-ladder transaction returned an invalid shape');
    saveYamlToPathAtomic(dayFile.file, next.dayFile, { noRefs: true });
    saveYamlToPathAtomic(status.file, next.status, { noRefs: true });
    return structuredClone(next);
  }
}
export default YamlWordLadderStore;
