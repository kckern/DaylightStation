import { loadYaml, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import { IAgentStateStore } from '#apps/agents/ports/IAgentStateStore.mjs';

/** Per-owner durable dispatch and interaction records. Updates are synchronous
 * inside the process; no async callbacks may enter the read/modify/write section.
 */
export class YamlAgentStateStore extends IAgentStateStore {
  constructor({ dataService, namespace = 'nutrition-cleanup' }) {
    super();
    if (!/^[a-z0-9-]+$/.test(namespace)) throw new Error('Invalid agent namespace');
    Object.assign(this, { dataService, namespace });
  }
  path(userId) {
    if (typeof userId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(userId)) throw new Error('Invalid owner');
    return this.dataService.user.resolveDir('agents/' + this.namespace, userId);
  }
  load(userId) {
    return loadYaml(this.path(userId)) || { version: 0, settings: { enabled: false, dryRun: true, telegram: true }, runs: {}, questions: {} };
  }
  update(userId, change) {
    const state = this.load(userId);
    const result = change(state);
    if (result?.then) throw new Error('Agent state changes must be synchronous');
    state.version++;
    saveYamlToPathAtomic(this.path(userId) + '.yml', state, { durable: true });
    return result;
  }
}
