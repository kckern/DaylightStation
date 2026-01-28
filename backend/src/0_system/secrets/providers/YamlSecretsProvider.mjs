// backend/src/0_system/secrets/providers/YamlSecretsProvider.mjs

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { ISecretsProvider } from '../ISecretsProvider.mjs';

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
    if (!fs.existsSync(filePath)) return null;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return yaml.load(content) ?? null;
    } catch (err) {
      console.error(`Failed to parse ${filePath}: ${err.message}`);
      return null;
    }
  }

  #writeYaml(relativePath, data) {
    const filePath = path.join(this.#dataDir, relativePath);
    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const content = yaml.dump(data, { lineWidth: -1 });
    fs.writeFileSync(filePath, content, 'utf8');
  }

  // ─── Private: Load helpers ──────────────────────────

  #listDirs(dir) {
    const fullPath = path.join(this.#dataDir, dir);
    if (!fs.existsSync(fullPath)) return [];

    return fs.readdirSync(fullPath).filter(name => {
      if (name.startsWith('.') || name.startsWith('_') || name === 'example') {
        return false;
      }
      return fs.statSync(path.join(fullPath, name)).isDirectory();
    });
  }

  #listYamlFiles(dir) {
    const fullPath = path.join(this.#dataDir, dir);
    if (!fs.existsSync(fullPath)) return [];

    return fs.readdirSync(fullPath)
      .filter(f => (f.endsWith('.yml') || f.endsWith('.yaml')) && !f.startsWith('.'))
      .map(f => path.join(dir, f));
  }

  #listHouseholdDirs() {
    if (!fs.existsSync(this.#dataDir)) return [];

    return fs.readdirSync(this.#dataDir)
      .filter(name => {
        if (name.startsWith('.') || name.startsWith('_')) return false;
        if (name !== 'household' && !name.startsWith('household-')) return false;
        return fs.statSync(path.join(this.#dataDir, name)).isDirectory();
      });
  }

  #parseHouseholdId(folderName) {
    if (folderName === 'household') return 'default';
    return folderName.replace(/^household-/, '');
  }

  #toFolderName(householdId) {
    if (householdId === 'default') return 'household';
    return `household-${householdId}`;
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
    for (const dir of this.#listHouseholdDirs()) {
      const householdId = this.#parseHouseholdId(dir);
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
    const folderName = this.#toFolderName(householdId);
    this.#writeYaml(`${folderName}/auth/${service}.yml`, value);
  }
}

export default YamlSecretsProvider;
