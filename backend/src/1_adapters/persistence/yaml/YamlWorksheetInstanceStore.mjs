import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { promises as fs } from 'node:fs';
import yaml from 'js-yaml';

/**
 * The one definition of a well-formed worksheet-instance id. Exported because
 * anything else that turns an operator-supplied id into a path (e.g.
 * `school-docs reprint`) must apply the IDENTICAL rule — two copies of this
 * regex would eventually drift and reopen the traversal it exists to close.
 */
export const SAFE_WORKSHEET_INSTANCE_ID = /^[a-z0-9][a-z0-9._/-]*$/i;
const SAFE_SESSION_ID = /^[a-z0-9][a-z0-9_-]*$/i;
const dump = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });

/** Append-only persistence for the exact worksheet a learner received. */
export class YamlWorksheetInstanceStore {
  #configService;
  #logger;
  constructor({ configService, logger = console } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlWorksheetInstanceStore requires configService');
    this.#configService = configService;
    this.#logger = logger;
  }
  #root() { return this.#configService.getHouseholdPath('school/records/worksheets'); }
  #fileForSession(sessionId) {
    if (typeof sessionId !== 'string' || !SAFE_SESSION_ID.test(sessionId)) throw new Error(`unsafe worksheet session id: ${sessionId}`);
    return path.join(this.#root(), `${sessionId}.yml`);
  }
  async get(id) {
    if (typeof id !== 'string' || !SAFE_WORKSHEET_INSTANCE_ID.test(id) || id.includes('..')) throw new Error(`unsafe worksheet instance id: ${id}`);
    let entries;
    try { entries = await fs.readdir(this.#root(), { withFileTypes: true }); } catch { return null; }
    for (const entry of entries.filter((candidate) => candidate.isFile() && /\.ya?ml$/i.test(candidate.name))) {
      try {
        const value = yaml.load(await fs.readFile(path.join(this.#root(), entry.name), 'utf8')) ?? null;
        if (value?.id === id) return value;
      } catch (err) {
        this.#logger.error?.('school.worksheet-instance.unreadable', { instanceId: id, file: entry.name, error: err?.message });
      }
    }
    return null;
  }
  async #readBySession(sessionId) {
    // An issued worksheet is the self-contained record grading reads back — a
    // corrupt one silently answering "absent" turns into "this lesson was never
    // issued", so missing stays quiet and unreadable-but-present is reported.
    try {
      return yaml.load(await fs.readFile(this.#fileForSession(sessionId), 'utf8')) ?? null;
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        this.#logger.error?.('school.worksheet-instance.unreadable', { sessionId, error: err?.message });
      }
      return null;
    }
  }
  async put(instance) {
    if (typeof instance?.id !== 'string' || !SAFE_WORKSHEET_INSTANCE_ID.test(instance.id) || instance.id.includes('..')) {
      throw new Error(`unsafe worksheet instance id: ${instance?.id}`);
    }
    const file = this.#fileForSession(instance?.sessionId);
    const existing = await this.#readBySession(instance.sessionId);
    if (existing) {
      if (isDeepStrictEqual(existing, JSON.parse(JSON.stringify(instance)))) return existing;
      throw new Error(`worksheet session '${instance.sessionId}' already has an immutable instance`);
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, dump(instance), { encoding: 'utf8', flag: 'wx' });
    return instance;
  }
  async findBySession(sessionId) {
    if (typeof sessionId !== 'string' || !SAFE_SESSION_ID.test(sessionId)) return null;
    return this.#readBySession(sessionId);
  }
}

export default YamlWorksheetInstanceStore;
