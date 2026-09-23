/**
 * YamlArtworkQueueStore — the artwork remediation queue, one file per user,
 * next to the rest of that user's nutrition data:
 *   users/{userId}/lifelog/nutrition/artwork-queue.yml
 *
 * Shape: `{ version, items: { [key]: item } }` (item shape: 2_domains/nutrition/
 * services/artworkQueue.mjs). Updates are synchronous read-modify-write inside
 * the process and written atomically, the YamlAgentStateStore pattern.
 */
import { loadYaml, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import { IArtworkQueueStore } from '#apps/nutrition/ports/IArtworkQueueStore.mjs';

export class YamlArtworkQueueStore extends IArtworkQueueStore {
  static PATH = 'lifelog/nutrition/artwork-queue';

  constructor({ dataService }) {
    super();
    if (!dataService?.user?.resolveDir) throw new Error('YamlArtworkQueueStore requires dataService');
    this.dataService = dataService;
  }

  path(userId) {
    if (typeof userId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(userId)) throw new Error('Invalid owner');
    return this.dataService.user.resolveDir(YamlArtworkQueueStore.PATH, userId);
  }

  load(userId) {
    const raw = loadYaml(this.path(userId));
    const items = raw?.items && typeof raw.items === 'object' && !Array.isArray(raw.items) ? raw.items : {};
    return { version: Number.isInteger(raw?.version) ? raw.version : 0, items };
  }

  update(userId, change) {
    const state = this.load(userId);
    const result = change(state);
    if (result?.then) throw new Error('Artwork queue changes must be synchronous');
    state.version++;
    saveYamlToPathAtomic(this.path(userId) + '.yml', state, { durable: true });
    return result;
  }
}
