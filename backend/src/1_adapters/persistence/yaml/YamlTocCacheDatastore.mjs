// backend/src/1_adapters/persistence/yaml/YamlTocCacheDatastore.mjs

import { ITocCacheDatastore } from '#apps/agents/paged-media-toc/ports/ITocCacheDatastore.mjs';

/**
 * YamlTocCacheDatastore — YAML-backed persistence for TOC cache.
 *
 * Cache path: content/komga/toc/{bookId}.yml (LLM/vision-extracted, not a
 * disposable cache — lives beside the content it indexes)
 * Config path: content/lists/queries/komga (not household-scoped)
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
    return this.#dataService.content.read(`komga/toc/${bookId}.yml`);
  }

  writeCache(bookId, tocData) {
    this.#dataService.content.write(`komga/toc/${bookId}.yml`, tocData);
  }

  readQueryConfig() {
    const username = this.#configService?.getHeadOfHousehold?.();
    if (username) {
      const userConfig = this.#dataService.user.read('config/queries/komga', username);
      if (userConfig) return userConfig;
    }
    return this.#dataService.content.read('lists/queries/komga');
  }
}
