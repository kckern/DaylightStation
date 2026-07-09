import fs from 'fs';
import path from 'path';
import { loadYamlSafe, saveYaml } from '#system/utils/FileIO.mjs';
import { LifePlan } from '#domains/lifeplan/entities/LifePlan.mjs';

export class YamlLifePlanStore {
  #basePath;

  constructor({ basePath }) {
    this.#basePath = basePath;
  }

  load(username) {
    const filePath = this.#filePath(username);
    const data = loadYamlSafe(filePath);
    if (!data) return null;
    return new LifePlan(data);
  }

  save(username, lifePlan) {
    const filePath = this.#filePath(username);
    const data = lifePlan instanceof LifePlan ? lifePlan.toJSON() : lifePlan;
    saveYaml(filePath, data);
  }

  /**
   * List usernames that have a lifeplan.yml under the base path.
   * @returns {string[]}
   */
  listUsernames() {
    let entries;
    try {
      entries = fs.readdirSync(this.#basePath, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter(e => e.isDirectory() && fs.existsSync(path.join(this.#basePath, e.name, 'lifeplan.yml')))
      .map(e => e.name);
  }

  #filePath(username) {
    return path.join(this.#basePath, username, 'lifeplan.yml');
  }
}
