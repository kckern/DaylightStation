import { ISyncHealthStore } from '#apps/fitness/ports/ISyncHealthStore.mjs';
import { loadYamlSafe, saveYaml } from '#system/utils/FileIO.mjs';

/** Sync-health state in one YAML file (e.g. household/fitness/sync-health.yml). */
export class YamlSyncHealthStore extends ISyncHealthStore {
  #path;
  constructor({ path }) { super(); this.#path = path; }
  load() { return loadYamlSafe(this.#path) || null; }
  save(state) { saveYaml(this.#path, state); }
}
export default YamlSyncHealthStore;
