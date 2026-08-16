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
  #root() { return this.#configService.getHouseholdPath('school/worksheet-instances'); }
  #file(id) {
    if (typeof id !== 'string' || !SAFE_WORKSHEET_INSTANCE_ID.test(id) || id.includes('..')) throw new Error(`unsafe worksheet instance id: ${id}`);
    return path.join(this.#root(), `${id}.yml`);
  }
  async get(id) {
    // An issued worksheet is the self-contained record grading reads back — a
    // corrupt one silently answering "absent" turns into "this lesson was never
    // issued", so missing stays quiet and unreadable-but-present is reported.
    try {
      return yaml.load(await fs.readFile(this.#file(id), 'utf8')) ?? null;
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        this.#logger.error?.('school.worksheet-instance.unreadable', { instanceId: id, error: err?.message });
      }
      return null;
    }
  }
  async put(instance) {
    const file = this.#file(instance?.id);
    const existing = await this.get(instance.id);
    if (existing) {
      if (isDeepStrictEqual(existing, JSON.parse(JSON.stringify(instance)))) return existing;
      throw new Error(`worksheet instance '${instance.id}' is immutable`);
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, dump(instance), { encoding: 'utf8', flag: 'wx' });
    return instance;
  }
  async findBySession(sessionId) {
    const walk = async (dir) => {
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
      const values = [];
      for (const entry of entries) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) values.push(...await walk(file));
        else if (/\.ya?ml$/i.test(entry.name)) {
          // Skipping a corrupt instance keeps the scan useful for the rest of
          // the session, but a skipped sheet is one the learner did receive —
          // report it rather than quietly returning a short list.
          try {
            values.push(yaml.load(await fs.readFile(file, 'utf8')));
          } catch (err) {
            this.#logger.warn?.('school.worksheet-instance.scan-skipped', { file, sessionId, error: err?.message });
          }
        }
      }
      return values;
    };
    return (await walk(this.#root())).find((value) => value?.sessionId === sessionId) ?? null;
  }
}

export default YamlWorksheetInstanceStore;
