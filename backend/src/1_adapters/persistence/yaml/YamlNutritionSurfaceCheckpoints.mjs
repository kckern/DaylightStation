import { loadYaml, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

/** Delivery acknowledgements only; this store never owns food records. */
export class YamlNutritionSurfaceCheckpoints {
  constructor({ dataService }) { this.dataService = dataService; }
  path(userId) { return this.dataService.user.resolveDir('lifelog/nutrition/surface-sync', userId); }
  async load(userId) { return loadYaml(this.path(userId)) || null; }
  async save(userId, state) {
    saveYamlToPathAtomic(`${this.path(userId)}.yml`, state);
  }
}
