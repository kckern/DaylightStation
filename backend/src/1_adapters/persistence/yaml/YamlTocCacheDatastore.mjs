// backend/src/1_adapters/persistence/yaml/YamlTocCacheDatastore.mjs

import { ITocCacheDatastore } from '#apps/agents/paged-media-toc/ports/ITocCacheDatastore.mjs';

/**
 * YamlTocCacheDatastore — YAML-backed persistence for TOC cache.
 *
 * Cache path: household common/komga/toc/{bookId}.yml
 * Config path: household config/lists/queries/komga
 *
 * @module adapters/persistence/yaml/YamlTocCacheDatastore
 */
export class YamlTocCacheDatastore extends ITocCacheDatastore {
  #dataService;
  #configService;

  constructor({ dataService, configService }) {
    super();
    if (!dataService) throw new Error('YamlTocCacheDatastore requires dataService');
    this.#dataService = dataService;
    this.#configService = configService;
  }

  readCache(bookId) {
    return this.#dataService.household.read(`common/komga/toc/${bookId}.yml`);
  }

  writeCache(bookId, tocData) {
    this.#dataService.household.write(`common/komga/toc/${bookId}.yml`, tocData);
  }

  readQueryConfig() {
    const username = this.#configService?.getHeadOfHousehold?.();
    if (username) {
      const userConfig = this.#dataService.user.read('config/queries/komga', username);
      if (userConfig) return userConfig;
    }
    return this.#dataService.household.read('config/lists/queries/komga');
  }
}
