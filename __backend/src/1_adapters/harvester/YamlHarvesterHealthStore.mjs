import { loadYamlSafe, saveYaml } from '#system/utils/FileIO.mjs';

/** Harvester health state in one YAML file (household/harvester-health.yml). */
export class YamlHarvesterHealthStore {
  #path;
  constructor({ path }) { this.#path = path; }
  load() { return loadYamlSafe(this.#path) || null; }
  save(state) { saveYaml(this.#path, state); }
}
export default YamlHarvesterHealthStore;
