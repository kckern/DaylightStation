import path from 'node:path';
import { ensureDir, fileExists, renameFile } from '#system/utils/FileIO.mjs';

const STATE_PATH = 'feed/item-state';

export class YamlFeedItemStateStore {
  #dataService;
  #logger;
  #queues = new Map();

  constructor({ dataService, logger = console }) {
    this.#dataService = dataService;
    this.#logger = logger;
  }

  load(username) {
    return this.#dataService.user.read(STATE_PATH, username) || { version: 1, items: {}, aliases: {} };
  }

  getMany(username, stateKeys) {
    const data = this.load(username);
    return new Map(stateKeys.map(key => [key, data.items?.[key] || null]));
  }

  async update(username, updater) {
    const previous = this.#queues.get(username) || Promise.resolve();
    const next = previous.then(async () => {
      const data = this.load(username);
      const updated = await updater(data) || data;
      this.#atomicWrite(username, updated);
      return updated;
    });
    this.#queues.set(username, next.catch(() => {}));
    return next;
  }

  #atomicWrite(username, value) {
    const target = this.#dataService.user.resolvePath(STATE_PATH, username);
    ensureDir(path.dirname(target));
    const yaml = this.#dataService.user.write;
    // Use DataService serialization into the temporary path, then atomically rename.
    const tmpRelative = `${STATE_PATH}.${process.pid}.tmp.yml`;
    const written = yaml.call(this.#dataService.user, tmpRelative, value, username);
    const generated = this.#dataService.user.resolvePath(tmpRelative, username);
    if (!written || !fileExists(generated)) throw new Error('Failed to persist feed item state');
    renameFile(generated, target);
    this.#logger.debug?.('feed.state.persisted', { username, count: Object.keys(value.items || {}).length });
  }
}

export default YamlFeedItemStateStore;
