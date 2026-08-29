// backend/src/1_adapters/secrets/YamlSecretsProvider.mjs

import path from 'path';
import { ISecretsProvider } from '#system/secrets/ISecretsProvider.mjs';
import { listHouseholdDirs, parseHouseholdId, toFolderName } from '#system/utils/householdDirs.mjs';
import {
  fileExists, getStats, listEntries, loadYamlFromPath, saveYamlToPath,
} from '#system/utils/FileIO.mjs';

/**
 * YAML-based secrets provider.
 * Reads secrets from flat files, matching current configLoader behavior.
 *
 * File structure:
 * - data/system/secrets.yml - System secrets
 * - data/system/auth/{platform}.yml - System auth
 * - data/users/{username}/auth/{service}.yml - User auth
 * - data/household[-{id}]/auth/{service}.yml - Household auth
 */
export class YamlSecretsProvider extends ISecretsProvider {
  #dataDir;
  #secrets = {};
  #systemAuth = {};
  #userAuth = {};
  #householdAuth = {};

  /**
   * @param {string} dataDir - Path to data directory
   */
  constructor(dataDir) {
    super();
    if (!dataDir) {
      throw new Error('YamlSecretsProvider requires dataDir');
    }
    this.#dataDir = dataDir;
  }

  async initialize() {
    this.#secrets = this.#loadYaml('system/secrets.yml') ?? {};
    this.#systemAuth = this.#loadSystemAuth();
    this.#userAuth = this.#loadUserAuth();
    this.#householdAuth = this.#loadHouseholdAuth();
  }

  // ─── Private: YAML I/O ──────────────────────────────

  #loadYaml(relativePath) {
    const filePath = path.join(this.#dataDir, relativePath);
    if (!fileExists(filePath)) return null;

    try {
      return loadYamlFromPath(filePath) ?? null;
    } catch (err) {
      console.error(`Failed to parse ${filePath}: ${err.message}`);
      return null;
    }
  }

  #writeYaml(relativePath, data) {
    const filePath = path.join(this.#dataDir, relativePath);
    try {
      saveYamlToPath(filePath, data, { lineWidth: -1 });
    } catch (err) {
      console.error(`Failed to write ${filePath}: ${err.message}`);
      throw err;  // Re-throw so callers know write failed
    }
  }

  // ─── Private: Load helpers ──────────────────────────

  #listDirs(dir) {
    const fullPath = path.join(this.#dataDir, dir);
    if (!fileExists(fullPath)) return [];

    return listEntries(fullPath).filter(name => {
      if (name.startsWith('.') || name.startsWith('_') || name === 'example') {
        return false;
      }
      try {
        return getStats(path.join(fullPath, name))?.isDirectory() === true;
      } catch (err) {
        return false;  // Skip entries that can't be stat'd
      }
    });
  }

  #listYamlFiles(dir) {
    const fullPath = path.join(this.#dataDir, dir);
    if (!fileExists(fullPath)) return [];

    return listEntries(fullPath)
      .filter(f => (f.endsWith('.yml') || f.endsWith('.yaml')) && !f.startsWith('.'))
      .map(f => path.join(dir, f));
  }

  #loadSystemAuth() {
    const auth = {};
    for (const relativePath of this.#listYamlFiles('system/auth')) {
      const basename = path.basename(relativePath);
      if (basename.includes('.example.')) continue;

      const platform = path.basename(relativePath, '.yml');
      const creds = this.#loadYaml(relativePath);
      if (creds) {
        auth[platform] = creds;
      }
    }
    return auth;
  }

  #loadUserAuth() {
    const auth = {};
    for (const username of this.#listDirs('users')) {
      const authFiles = this.#listYamlFiles(`users/${username}/auth`);
      if (authFiles.length === 0) continue;

      auth[username] = {};
      for (const relativePath of authFiles) {
        const service = path.basename(relativePath, '.yml');
        const creds = this.#loadYaml(relativePath);
        if (creds) {
          auth[username][service] = creds;
        }
      }
    }
    return auth;
  }

  #loadHouseholdAuth() {
    const auth = {};
    for (const dir of listHouseholdDirs(this.#dataDir)) {
      const householdId = parseHouseholdId(dir);
      const authFiles = this.#listYamlFiles(`${dir}/auth`);
      if (authFiles.length === 0) continue;

      auth[householdId] = {};
      for (const relativePath of authFiles) {
        const service = path.basename(relativePath, '.yml');
        const creds = this.#loadYaml(relativePath);
        if (creds) {
          auth[householdId][service] = creds;
        }
      }
    }
    return auth;
  }

  // ─── Public: Reads ──────────────────────────────────

  getSecret(key) {
    return this.#secrets[key] ?? null;
  }

  getSystemAuth(platform, key) {
    return this.#systemAuth[platform]?.[key] ?? null;
  }

  getUserAuth(username, service) {
    return this.#userAuth[username]?.[service] ?? null;
  }

  getHouseholdAuth(householdId, service) {
    return this.#householdAuth[householdId]?.[service] ?? null;
  }

  // ─── Public: Writes ─────────────────────────────────

  setSecret(key, value) {
    this.#secrets[key] = value;
    this.#writeYaml('system/secrets.yml', this.#secrets);
  }

  setSystemAuth(platform, key, value) {
    this.#systemAuth[platform] ??= {};
    this.#systemAuth[platform][key] = value;
    this.#writeYaml(`system/auth/${platform}.yml`, this.#systemAuth[platform]);
  }

  setUserAuth(username, service, value) {
    this.#userAuth[username] ??= {};
    this.#userAuth[username][service] = value;
    this.#writeYaml(`users/${username}/auth/${service}.yml`, value);
  }

  setHouseholdAuth(householdId, service, value) {
    this.#householdAuth[householdId] ??= {};
    this.#householdAuth[householdId][service] = value;
    const folderName = toFolderName(householdId);
    this.#writeYaml(`${folderName}/auth/${service}.yml`, value);
  }
}

export default YamlSecretsProvider;
