import path from 'node:path';
import { fileExists, readDirectory } from '#system/utils/FileIO.mjs';

/** Owns query YAML locations and projects filenames to semantic query keys. */
export class YamlFeedQueryRepository {
  #dataService;
  #configService;
  #logger;
  constructor({ dataService, configService, logger = console }) {
    this.#dataService = dataService;
    this.#configService = configService;
    this.#logger = logger;
  }
  #load(directory, read) {
    if (!directory || !fileExists(directory)) return [];
    return readDirectory(directory).filter(file => file.endsWith('.yml')).map(file => {
      const key = file.slice(0, -4);
      const data = read(key);
      return data ? { ...data, key } : null;
    }).filter(Boolean);
  }
  loadHouseholdQueries() {
    try {
      const directory = this.#dataService.content.resolveDir('lists/queries');
      return this.#load(directory, key => this.#dataService.content.read(`lists/queries/${key}`));
    } catch (error) {
      this.#logger.warn?.('feed.queries.load.error', { error: error.message });
      return [];
    }
  }
  loadUserQueries(username) {
    try {
      const directory = path.join(this.#configService.getDataDir(), 'users', username, 'config', 'queries');
      return this.#load(directory, key => this.#dataService.user.read(`config/queries/${key}`, username));
    } catch { return []; }
  }
}

export default YamlFeedQueryRepository;
