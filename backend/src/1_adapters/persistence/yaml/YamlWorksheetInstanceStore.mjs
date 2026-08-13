import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { promises as fs } from 'node:fs';
import yaml from 'js-yaml';

const SAFE_ID = /^[a-z0-9][a-z0-9._/-]*$/i;
const dump = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });

/** Append-only persistence for the exact worksheet a learner received. */
export class YamlWorksheetInstanceStore {
  #configService;
  constructor({ configService } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlWorksheetInstanceStore requires configService');
    this.#configService = configService;
  }
  #root() { return this.#configService.getHouseholdPath('apps/school/worksheet-instances'); }
  #file(id) {
    if (typeof id !== 'string' || !SAFE_ID.test(id) || id.includes('..')) throw new Error(`unsafe worksheet instance id: ${id}`);
    return path.join(this.#root(), `${id}.yml`);
  }
  async get(id) {
    try { return yaml.load(await fs.readFile(this.#file(id), 'utf8')) ?? null; } catch { return null; }
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
          try { values.push(yaml.load(await fs.readFile(file, 'utf8'))); } catch { /* ignored */ }
        }
      }
      return values;
    };
    return (await walk(this.#root())).find((value) => value?.sessionId === sessionId) ?? null;
  }
}

export default YamlWorksheetInstanceStore;
