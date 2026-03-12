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

  #filePath(username) {
    return path.join(this.#basePath, username, 'lifeplan.yml');
  }
}
