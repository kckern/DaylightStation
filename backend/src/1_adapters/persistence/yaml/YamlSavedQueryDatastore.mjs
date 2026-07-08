// backend/src/1_adapters/persistence/yaml/YamlSavedQueryDatastore.mjs

import path from 'path';
import { loadYamlSafe, listYamlFiles, saveYaml, deleteYaml } from '#system/utils/FileIO.mjs';

/**
 * YamlSavedQueryDatastore — YAML-file persistence for saved query definitions
 * (query:dailynews etc.), with household-over-user precedence.
 *
 * Extracted from the inline read/list closures in bootstrap's
 * createContentRegistry (audit S-3).
 *
 * Layout:
 * - Household queries: `{householdConfigDir}/lists/queries/{name}.yml` (queriesDir)
 * - Per-user queries:  `users/{username}/config/queries/{name}.yml` (userQueryDirs)
 *
 * Precedence (behavior-preserving):
 * - readQuery: household first, then user dirs in listed order.
 * - listQueries: union of names (household + all user dirs), deduped.
 * - listQueriesDetailed: household entries first, then user entries; first
 *   occurrence of a name wins (household shadows user, earlier user shadows later).
 * - writeQuery/deleteQuery: household dir only.
 */
export class YamlSavedQueryDatastore {
  #queriesDir;
  #userQueryDirs;

  /**
   * @param {Object} config
   * @param {string} config.queriesDir - Household queries directory
   * @param {Array<{username: string, dir: string}>} [config.userQueryDirs] - Per-user query directories, in precedence order
   */
  constructor({ queriesDir, userQueryDirs = [] } = {}) {
    this.#queriesDir = queriesDir;
    this.#userQueryDirs = userQueryDirs;
  }

  /**
   * Read a query definition by name (household first, then users).
   * @param {string} name
   * @returns {Object|null}
   */
  readQuery(name) {
    const householdResult = loadYamlSafe(path.join(this.#queriesDir, name));
    if (householdResult) return householdResult;
    for (const { dir } of this.#userQueryDirs) {
      const userResult = loadYamlSafe(path.join(dir, name));
      if (userResult) return userResult;
    }
    return null;
  }

  /**
   * List all query names (household + users, deduped).
   * @returns {string[]}
   */
  listQueries() {
    const names = new Set(listYamlFiles(this.#queriesDir));
    for (const { dir } of this.#userQueryDirs) {
      for (const name of listYamlFiles(dir)) {
        names.add(name);
      }
    }
    return [...names];
  }

  /**
   * List queries with origin metadata. Household entries first; first
   * occurrence of a name wins.
   * @returns {Array<{name: string, origin: 'household'|'user', username?: string}>}
   */
  listQueriesDetailed() {
    const seen = new Set();
    const results = [];
    for (const name of listYamlFiles(this.#queriesDir)) {
      if (!seen.has(name)) {
        seen.add(name);
        results.push({ name, origin: 'household' });
      }
    }
    for (const { username, dir } of this.#userQueryDirs) {
      for (const name of listYamlFiles(dir)) {
        if (!seen.has(name)) {
          seen.add(name);
          results.push({ name, origin: 'user', username });
        }
      }
    }
    return results;
  }

  /**
   * Write a query definition to the household dir.
   * @param {string} name
   * @param {Object} data
   */
  writeQuery(name, data) {
    return saveYaml(path.join(this.#queriesDir, name), data);
  }

  /**
   * Delete a query definition from the household dir.
   * @param {string} name
   */
  deleteQuery(name) {
    return deleteYaml(path.join(this.#queriesDir, name));
  }
}
