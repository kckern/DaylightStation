# SecretsHandler Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Abstract secrets/auth handling behind a provider interface to enable future encryption and Vault integration.

**Architecture:** SecretsHandler composes inside ConfigService, delegating to ISecretsProvider implementations. YamlSecretsProvider implements current flat-file behavior. Stubs for EncryptedYaml and Vault providers document future direction.

**Tech Stack:** Node.js ES modules, js-yaml for YAML I/O, Jest for testing.

**Design Doc:** `docs/plans/2026-01-28-secrets-handler-design.md`

---

## Task 1: Create ISecretsProvider Interface

**Files:**
- Create: `backend/src/0_system/secrets/ISecretsProvider.mjs`

**Step 1: Create the interface file**

```javascript
// backend/src/0_system/secrets/ISecretsProvider.mjs

/**
 * Interface for secrets storage backends.
 * Implementations: YamlSecretsProvider, EncryptedYamlProvider (future), VaultProvider (future)
 */
export class ISecretsProvider {
  // ─── System Secrets ─────────────────────────────────

  /**
   * Get a system-wide secret by key
   * @param {string} key - Secret key (e.g., 'OPENAI_API_KEY')
   * @returns {string|null}
   */
  getSecret(key) { throw new Error('Not implemented'); }

  /**
   * Set a system-wide secret
   * @param {string} key - Secret key
   * @param {string} value - Secret value
   */
  setSecret(key, value) { throw new Error('Not implemented'); }

  // ─── System Auth (bot tokens, platform credentials) ──

  /**
   * Get system-level auth (e.g., bot tokens)
   * @param {string} platform - Platform name (telegram, discord, etc.)
   * @param {string} key - Auth key within platform
   * @returns {string|null}
   */
  getSystemAuth(platform, key) { throw new Error('Not implemented'); }

  /**
   * Set system-level auth
   * @param {string} platform - Platform name
   * @param {string} key - Auth key
   * @param {string} value - Auth value
   */
  setSystemAuth(platform, key, value) { throw new Error('Not implemented'); }

  // ─── User Auth ──────────────────────────────────────

  /**
   * Get user-scoped auth credentials
   * @param {string} username - Username
   * @param {string} service - Service name (strava, google, etc.)
   * @returns {object|null} - Credentials object or null
   */
  getUserAuth(username, service) { throw new Error('Not implemented'); }

  /**
   * Set user-scoped auth credentials
   * @param {string} username - Username
   * @param {string} service - Service name
   * @param {object} value - Credentials object
   */
  setUserAuth(username, service, value) { throw new Error('Not implemented'); }

  // ─── Household Auth ─────────────────────────────────

  /**
   * Get household-scoped auth credentials
   * @param {string} householdId - Household ID
   * @param {string} service - Service name (plex, homeassistant, etc.)
   * @returns {object|null} - Credentials object or null
   */
  getHouseholdAuth(householdId, service) { throw new Error('Not implemented'); }

  /**
   * Set household-scoped auth credentials
   * @param {string} householdId - Household ID
   * @param {string} service - Service name
   * @param {object} value - Credentials object
   */
  setHouseholdAuth(householdId, service, value) { throw new Error('Not implemented'); }

  // ─── Lifecycle ──────────────────────────────────────

  /**
   * Initialize the provider - load secrets into memory
   * @returns {Promise<void>}
   */
  async initialize() { throw new Error('Not implemented'); }

  /**
   * Flush any pending writes (for providers with write buffering)
   * @returns {Promise<void>}
   */
  async flush() {}
}

export default ISecretsProvider;
```

**Step 2: Commit**

```bash
git add backend/src/0_system/secrets/ISecretsProvider.mjs
git commit -m "feat(secrets): add ISecretsProvider interface"
```

---

## Task 2: Create IEncryptionService Interface

**Files:**
- Create: `backend/src/0_system/encryption/IEncryptionService.mjs`

**Step 1: Create the interface file**

```javascript
// backend/src/0_system/encryption/IEncryptionService.mjs

/**
 * Interface for encryption backends.
 * Implementations handle key management internally.
 */
export class IEncryptionService {
  /**
   * Encrypt plaintext
   * @param {string} plaintext - Data to encrypt
   * @returns {string} Base64-encoded ciphertext
   */
  encrypt(plaintext) { throw new Error('Not implemented'); }

  /**
   * Decrypt ciphertext
   * @param {string} ciphertext - Base64-encoded ciphertext
   * @returns {string} Decrypted plaintext
   */
  decrypt(ciphertext) { throw new Error('Not implemented'); }
}

export default IEncryptionService;
```

**Step 2: Commit**

```bash
git add backend/src/0_system/encryption/IEncryptionService.mjs
git commit -m "feat(encryption): add IEncryptionService interface"
```

---

## Task 3: Create AesEncryptionService Stub

**Files:**
- Create: `backend/src/0_system/encryption/AesEncryptionService.mjs`

**Step 1: Create the stub**

```javascript
// backend/src/0_system/encryption/AesEncryptionService.mjs

import { IEncryptionService } from './IEncryptionService.mjs';

/**
 * AES-256-GCM encryption service.
 *
 * TODO: Implement when encrypted secrets are needed
 * - Key source: DAYLIGHT_MASTER_KEY env or keyfile path
 * - Format: base64(nonce + ciphertext + tag)
 * - Use Node.js crypto module
 */
export class AesEncryptionService extends IEncryptionService {
  /**
   * @param {object} options
   * @param {string} [options.keyEnvVar='DAYLIGHT_MASTER_KEY'] - Env var containing key
   * @param {string} [options.keyFile] - Path to key file (alternative to env)
   */
  constructor(options = {}) {
    super();
    throw new Error(
      'AesEncryptionService not yet implemented. ' +
      'See docs/plans/2026-01-28-secrets-handler-design.md for planned implementation.'
    );
  }
}

export default AesEncryptionService;
```

**Step 2: Commit**

```bash
git add backend/src/0_system/encryption/AesEncryptionService.mjs
git commit -m "feat(encryption): add AesEncryptionService stub"
```

---

## Task 4: Create Encryption Module Index

**Files:**
- Create: `backend/src/0_system/encryption/index.mjs`

**Step 1: Create the index**

```javascript
// backend/src/0_system/encryption/index.mjs

/**
 * Encryption module exports.
 *
 * Currently provides interfaces only.
 * Implementations will be added when encrypted secrets are needed.
 */

export { IEncryptionService } from './IEncryptionService.mjs';
export { AesEncryptionService } from './AesEncryptionService.mjs';
```

**Step 2: Commit**

```bash
git add backend/src/0_system/encryption/index.mjs
git commit -m "feat(encryption): add module index"
```

---

## Task 5: Create SecretsHandler

**Files:**
- Create: `backend/src/0_system/secrets/SecretsHandler.mjs`

**Step 1: Create the handler**

```javascript
// backend/src/0_system/secrets/SecretsHandler.mjs

/**
 * SecretsHandler - Orchestration layer for secrets access.
 *
 * Delegates to an ISecretsProvider implementation.
 * Provides a stable interface for ConfigService regardless of backend.
 */
export class SecretsHandler {
  #provider;

  /**
   * @param {import('./ISecretsProvider.mjs').ISecretsProvider} provider
   */
  constructor(provider) {
    if (!provider) {
      throw new Error('SecretsHandler requires a provider');
    }
    this.#provider = provider;
  }

  /**
   * Initialize the underlying provider
   * @returns {Promise<void>}
   */
  async initialize() {
    await this.#provider.initialize();
  }

  // ─── System Secrets ─────────────────────────────────

  getSecret(key) {
    return this.#provider.getSecret(key);
  }

  setSecret(key, value) {
    return this.#provider.setSecret(key, value);
  }

  // ─── System Auth ────────────────────────────────────

  getSystemAuth(platform, key) {
    return this.#provider.getSystemAuth(platform, key);
  }

  setSystemAuth(platform, key, value) {
    return this.#provider.setSystemAuth(platform, key, value);
  }

  // ─── User Auth ──────────────────────────────────────

  getUserAuth(username, service) {
    return this.#provider.getUserAuth(username, service);
  }

  setUserAuth(username, service, value) {
    return this.#provider.setUserAuth(username, service, value);
  }

  // ─── Household Auth ─────────────────────────────────

  getHouseholdAuth(householdId, service) {
    return this.#provider.getHouseholdAuth(householdId, service);
  }

  setHouseholdAuth(householdId, service, value) {
    return this.#provider.setHouseholdAuth(householdId, service, value);
  }

  // ─── Lifecycle ──────────────────────────────────────

  async flush() {
    await this.#provider.flush();
  }
}

export default SecretsHandler;
```

**Step 2: Commit**

```bash
git add backend/src/0_system/secrets/SecretsHandler.mjs
git commit -m "feat(secrets): add SecretsHandler orchestration layer"
```

---

## Task 6: Create YamlSecretsProvider - Part 1 (Structure and Initialization)

**Files:**
- Create: `backend/src/0_system/secrets/providers/YamlSecretsProvider.mjs`

**Step 1: Create provider with initialization logic**

```javascript
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
```

**Step 2: Commit**

```bash
git add backend/src/0_system/secrets/providers/YamlSecretsProvider.mjs
git commit -m "feat(secrets): add YamlSecretsProvider implementation"
```

---

## Task 7: Create Provider Stubs

**Files:**
- Create: `backend/src/0_system/secrets/providers/EncryptedYamlSecretsProvider.mjs`
- Create: `backend/src/0_system/secrets/providers/VaultSecretsProvider.mjs`

**Step 1: Create EncryptedYamlSecretsProvider stub**

```javascript
// backend/src/0_system/secrets/providers/EncryptedYamlSecretsProvider.mjs

import { ISecretsProvider } from '../ISecretsProvider.mjs';

/**
 * Encrypted YAML secrets provider.
 * Wraps YamlSecretsProvider with encryption layer.
 *
 * TODO: Implement when encryption is needed
 * - Requires AesEncryptionService from 0_system/encryption
 * - Master key from DAYLIGHT_MASTER_KEY env or keyfile
 * - Encrypts values before writing, decrypts on read
 * - File structure same as YamlSecretsProvider (values are encrypted strings)
 */
export class EncryptedYamlSecretsProvider extends ISecretsProvider {
  /**
   * @param {string} dataDir - Path to data directory
   * @param {import('../../encryption/IEncryptionService.mjs').IEncryptionService} encryptionService
   */
  constructor(dataDir, encryptionService) {
    super();
    throw new Error(
      'EncryptedYamlSecretsProvider not yet implemented. ' +
      'See docs/plans/2026-01-28-secrets-handler-design.md for planned implementation.'
    );
  }
}

export default EncryptedYamlSecretsProvider;
```

**Step 2: Create VaultSecretsProvider stub**

```javascript
// backend/src/0_system/secrets/providers/VaultSecretsProvider.mjs

import { ISecretsProvider } from '../ISecretsProvider.mjs';

/**
 * HashiCorp Vault secrets provider.
 *
 * TODO: Implement when migrating to Vault
 * - Config via system.yml: secrets.vault.address, secrets.vault.mount
 * - Auth: AppRole recommended, or Kubernetes service account
 * - Paths: {mount}/system/secrets, {mount}/users/{username}, etc.
 * - Consider caching with TTL for performance
 */
export class VaultSecretsProvider extends ISecretsProvider {
  /**
   * @param {object} vaultConfig
   * @param {string} vaultConfig.address - Vault server address
   * @param {string} vaultConfig.mount - Secrets mount path
   * @param {string} [vaultConfig.roleId] - AppRole role ID
   * @param {string} [vaultConfig.secretId] - AppRole secret ID
   */
  constructor(vaultConfig) {
    super();
    throw new Error(
      'VaultSecretsProvider not yet implemented. ' +
      'See docs/plans/2026-01-28-secrets-handler-design.md for planned implementation.'
    );
  }
}

export default VaultSecretsProvider;
```

**Step 3: Commit**

```bash
git add backend/src/0_system/secrets/providers/EncryptedYamlSecretsProvider.mjs \
        backend/src/0_system/secrets/providers/VaultSecretsProvider.mjs
git commit -m "feat(secrets): add EncryptedYaml and Vault provider stubs"
```

---

## Task 8: Create Secrets Module Index

**Files:**
- Create: `backend/src/0_system/secrets/index.mjs`

**Step 1: Create the index**

```javascript
// backend/src/0_system/secrets/index.mjs

/**
 * Secrets module exports.
 *
 * Usage:
 *   import { SecretsHandler, YamlSecretsProvider } from './secrets/index.mjs';
 *
 *   const provider = new YamlSecretsProvider(dataDir);
 *   await provider.initialize();
 *   const handler = new SecretsHandler(provider);
 */

// Interface
export { ISecretsProvider } from './ISecretsProvider.mjs';

// Handler
export { SecretsHandler } from './SecretsHandler.mjs';

// Providers
export { YamlSecretsProvider } from './providers/YamlSecretsProvider.mjs';
export { EncryptedYamlSecretsProvider } from './providers/EncryptedYamlSecretsProvider.mjs';
export { VaultSecretsProvider } from './providers/VaultSecretsProvider.mjs';
```

**Step 2: Commit**

```bash
git add backend/src/0_system/secrets/index.mjs
git commit -m "feat(secrets): add module index"
```

---

## Task 9: Write YamlSecretsProvider Tests

**Files:**
- Create: `tests/unit/suite/secrets/YamlSecretsProvider.test.mjs`

**Step 1: Create test file**

```javascript
// tests/unit/suite/secrets/YamlSecretsProvider.test.mjs

import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { YamlSecretsProvider } from '#backend/src/0_system/secrets/providers/YamlSecretsProvider.mjs';

describe('YamlSecretsProvider', () => {
  let tempDir;
  let provider;

  beforeEach(() => {
    // Create temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-test-'));
    provider = new YamlSecretsProvider(tempDir);
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    test('throws if dataDir not provided', () => {
      expect(() => new YamlSecretsProvider()).toThrow('requires dataDir');
    });

    test('accepts valid dataDir', () => {
      const p = new YamlSecretsProvider('/some/path');
      expect(p).toBeInstanceOf(YamlSecretsProvider);
    });
  });

  describe('getSecret / setSecret', () => {
    beforeEach(async () => {
      // Create secrets file
      fs.mkdirSync(path.join(tempDir, 'system'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'system/secrets.yml'),
        yaml.dump({ OPENAI_API_KEY: 'sk-test-123', OTHER_KEY: 'value' })
      );
      await provider.initialize();
    });

    test('returns secret value for existing key', () => {
      expect(provider.getSecret('OPENAI_API_KEY')).toBe('sk-test-123');
    });

    test('returns null for missing key', () => {
      expect(provider.getSecret('NONEXISTENT')).toBeNull();
    });

    test('setSecret updates value and persists', () => {
      provider.setSecret('NEW_KEY', 'new-value');

      expect(provider.getSecret('NEW_KEY')).toBe('new-value');

      // Verify written to disk
      const content = yaml.load(fs.readFileSync(
        path.join(tempDir, 'system/secrets.yml'), 'utf8'
      ));
      expect(content.NEW_KEY).toBe('new-value');
    });
  });

  describe('getSystemAuth / setSystemAuth', () => {
    beforeEach(async () => {
      fs.mkdirSync(path.join(tempDir, 'system/auth'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'system/auth/telegram.yml'),
        yaml.dump({ NUTRIBOT_TOKEN: 'bot-token-123' })
      );
      await provider.initialize();
    });

    test('returns auth value for existing platform/key', () => {
      expect(provider.getSystemAuth('telegram', 'NUTRIBOT_TOKEN')).toBe('bot-token-123');
    });

    test('returns null for missing platform', () => {
      expect(provider.getSystemAuth('discord', 'BOT_TOKEN')).toBeNull();
    });

    test('returns null for missing key', () => {
      expect(provider.getSystemAuth('telegram', 'NONEXISTENT')).toBeNull();
    });

    test('setSystemAuth updates value and persists', () => {
      provider.setSystemAuth('telegram', 'NEW_BOT', 'new-token');

      expect(provider.getSystemAuth('telegram', 'NEW_BOT')).toBe('new-token');

      // Verify written to disk
      const content = yaml.load(fs.readFileSync(
        path.join(tempDir, 'system/auth/telegram.yml'), 'utf8'
      ));
      expect(content.NEW_BOT).toBe('new-token');
    });
  });

  describe('getUserAuth / setUserAuth', () => {
    beforeEach(async () => {
      fs.mkdirSync(path.join(tempDir, 'users/alice/auth'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'users/alice/auth/strava.yml'),
        yaml.dump({ token: 'strava-token', user_id: '12345' })
      );
      await provider.initialize();
    });

    test('returns auth object for existing user/service', () => {
      const auth = provider.getUserAuth('alice', 'strava');
      expect(auth).toEqual({ token: 'strava-token', user_id: '12345' });
    });

    test('returns null for missing user', () => {
      expect(provider.getUserAuth('bob', 'strava')).toBeNull();
    });

    test('returns null for missing service', () => {
      expect(provider.getUserAuth('alice', 'google')).toBeNull();
    });

    test('setUserAuth creates file and updates value', () => {
      provider.setUserAuth('alice', 'google', { refresh_token: 'grt-123' });

      expect(provider.getUserAuth('alice', 'google')).toEqual({ refresh_token: 'grt-123' });

      // Verify written to disk
      const content = yaml.load(fs.readFileSync(
        path.join(tempDir, 'users/alice/auth/google.yml'), 'utf8'
      ));
      expect(content).toEqual({ refresh_token: 'grt-123' });
    });

    test('setUserAuth creates user directory if needed', () => {
      provider.setUserAuth('newuser', 'service', { token: 'tok' });

      expect(fs.existsSync(path.join(tempDir, 'users/newuser/auth/service.yml'))).toBe(true);
    });
  });

  describe('getHouseholdAuth / setHouseholdAuth', () => {
    beforeEach(async () => {
      // Default household
      fs.mkdirSync(path.join(tempDir, 'household/auth'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'household/auth/plex.yml'),
        yaml.dump({ token: 'plex-token' })
      );
      // Named household
      fs.mkdirSync(path.join(tempDir, 'household-jones/auth'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'household-jones/auth/homeassistant.yml'),
        yaml.dump({ token: 'ha-token' })
      );
      await provider.initialize();
    });

    test('returns auth for default household', () => {
      expect(provider.getHouseholdAuth('default', 'plex')).toEqual({ token: 'plex-token' });
    });

    test('returns auth for named household', () => {
      expect(provider.getHouseholdAuth('jones', 'homeassistant')).toEqual({ token: 'ha-token' });
    });

    test('returns null for missing household', () => {
      expect(provider.getHouseholdAuth('smith', 'plex')).toBeNull();
    });

    test('setHouseholdAuth updates default household', () => {
      provider.setHouseholdAuth('default', 'immich', { api_key: 'immich-key' });

      expect(provider.getHouseholdAuth('default', 'immich')).toEqual({ api_key: 'immich-key' });

      // Verify written to disk (default = 'household' folder)
      const content = yaml.load(fs.readFileSync(
        path.join(tempDir, 'household/auth/immich.yml'), 'utf8'
      ));
      expect(content).toEqual({ api_key: 'immich-key' });
    });

    test('setHouseholdAuth updates named household', () => {
      provider.setHouseholdAuth('jones', 'plex', { token: 'new-plex' });

      // Verify written to household-jones folder
      const content = yaml.load(fs.readFileSync(
        path.join(tempDir, 'household-jones/auth/plex.yml'), 'utf8'
      ));
      expect(content).toEqual({ token: 'new-plex' });
    });
  });

  describe('initialize', () => {
    test('works with empty data directory', async () => {
      await expect(provider.initialize()).resolves.not.toThrow();
    });

    test('skips example auth files', async () => {
      fs.mkdirSync(path.join(tempDir, 'system/auth'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'system/auth/telegram.example.yml'),
        yaml.dump({ TOKEN: 'example-token' })
      );

      await provider.initialize();

      expect(provider.getSystemAuth('telegram.example', 'TOKEN')).toBeNull();
    });
  });
});
```

**Step 2: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=secrets
```

Expected: All tests pass.

**Step 3: Commit**

```bash
git add tests/unit/suite/secrets/YamlSecretsProvider.test.mjs
git commit -m "test(secrets): add YamlSecretsProvider unit tests"
```

---

## Task 10: Write SecretsHandler Tests

**Files:**
- Create: `tests/unit/suite/secrets/SecretsHandler.test.mjs`

**Step 1: Create test file**

```javascript
// tests/unit/suite/secrets/SecretsHandler.test.mjs

import { jest } from '@jest/globals';
import { SecretsHandler } from '#backend/src/0_system/secrets/SecretsHandler.mjs';

describe('SecretsHandler', () => {
  let mockProvider;
  let handler;

  beforeEach(() => {
    mockProvider = {
      initialize: jest.fn().mockResolvedValue(undefined),
      flush: jest.fn().mockResolvedValue(undefined),
      getSecret: jest.fn(),
      setSecret: jest.fn(),
      getSystemAuth: jest.fn(),
      setSystemAuth: jest.fn(),
      getUserAuth: jest.fn(),
      setUserAuth: jest.fn(),
      getHouseholdAuth: jest.fn(),
      setHouseholdAuth: jest.fn(),
    };
    handler = new SecretsHandler(mockProvider);
  });

  describe('constructor', () => {
    test('throws if provider not provided', () => {
      expect(() => new SecretsHandler()).toThrow('requires a provider');
      expect(() => new SecretsHandler(null)).toThrow('requires a provider');
    });

    test('accepts valid provider', () => {
      expect(handler).toBeInstanceOf(SecretsHandler);
    });
  });

  describe('initialize', () => {
    test('calls provider.initialize()', async () => {
      await handler.initialize();
      expect(mockProvider.initialize).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSecret / setSecret', () => {
    test('delegates getSecret to provider', () => {
      mockProvider.getSecret.mockReturnValue('secret-value');

      const result = handler.getSecret('MY_KEY');

      expect(mockProvider.getSecret).toHaveBeenCalledWith('MY_KEY');
      expect(result).toBe('secret-value');
    });

    test('delegates setSecret to provider', () => {
      handler.setSecret('MY_KEY', 'new-value');

      expect(mockProvider.setSecret).toHaveBeenCalledWith('MY_KEY', 'new-value');
    });
  });

  describe('getSystemAuth / setSystemAuth', () => {
    test('delegates getSystemAuth to provider', () => {
      mockProvider.getSystemAuth.mockReturnValue('bot-token');

      const result = handler.getSystemAuth('telegram', 'BOT_TOKEN');

      expect(mockProvider.getSystemAuth).toHaveBeenCalledWith('telegram', 'BOT_TOKEN');
      expect(result).toBe('bot-token');
    });

    test('delegates setSystemAuth to provider', () => {
      handler.setSystemAuth('telegram', 'BOT_TOKEN', 'new-token');

      expect(mockProvider.setSystemAuth).toHaveBeenCalledWith('telegram', 'BOT_TOKEN', 'new-token');
    });
  });

  describe('getUserAuth / setUserAuth', () => {
    test('delegates getUserAuth to provider', () => {
      mockProvider.getUserAuth.mockReturnValue({ token: 'user-token' });

      const result = handler.getUserAuth('alice', 'strava');

      expect(mockProvider.getUserAuth).toHaveBeenCalledWith('alice', 'strava');
      expect(result).toEqual({ token: 'user-token' });
    });

    test('delegates setUserAuth to provider', () => {
      handler.setUserAuth('alice', 'strava', { token: 'new-token' });

      expect(mockProvider.setUserAuth).toHaveBeenCalledWith('alice', 'strava', { token: 'new-token' });
    });
  });

  describe('getHouseholdAuth / setHouseholdAuth', () => {
    test('delegates getHouseholdAuth to provider', () => {
      mockProvider.getHouseholdAuth.mockReturnValue({ token: 'plex-token' });

      const result = handler.getHouseholdAuth('default', 'plex');

      expect(mockProvider.getHouseholdAuth).toHaveBeenCalledWith('default', 'plex');
      expect(result).toEqual({ token: 'plex-token' });
    });

    test('delegates setHouseholdAuth to provider', () => {
      handler.setHouseholdAuth('default', 'plex', { token: 'new-token' });

      expect(mockProvider.setHouseholdAuth).toHaveBeenCalledWith('default', 'plex', { token: 'new-token' });
    });
  });

  describe('flush', () => {
    test('calls provider.flush()', async () => {
      await handler.flush();
      expect(mockProvider.flush).toHaveBeenCalledTimes(1);
    });
  });
});
```

**Step 2: Run tests**

```bash
npm test -- --testPathPattern=secrets
```

Expected: All tests pass.

**Step 3: Commit**

```bash
git add tests/unit/suite/secrets/SecretsHandler.test.mjs
git commit -m "test(secrets): add SecretsHandler unit tests"
```

---

## Task 11: Modify configLoader to Remove Secrets Loading

**Files:**
- Modify: `backend/src/0_system/config/configLoader.mjs`

**Step 1: Remove secrets-related functions and references**

In `loadConfig()` function, remove these lines:
- `secrets: loadSecrets(dataDir),`
- `auth: loadAllAuth(dataDir),`
- `systemAuth: loadSystemAuth(dataDir),`

Remove these functions entirely:
- `loadSecrets()`
- `loadAllAuth()`
- `loadUserAuth()`
- `loadHouseholdAuth()`
- `loadSystemAuth()`

Keep the `loadSystemConfig` function exported (needed for provider selection).

**Step 2: Update loadConfig function**

The updated `loadConfig` should look like:

```javascript
export function loadConfig(dataDir) {
  const config = {
    system: loadSystemConfig(dataDir),
    // secrets, auth, systemAuth removed - now handled by SecretsHandler
    services: loadServices(dataDir),
    households: loadAllHouseholds(dataDir),
    users: loadAllUsers(dataDir),
    apps: loadAllApps(dataDir),
    adapters: loadAdapters(dataDir),
    systemBots: loadSystemBots(dataDir),
    identityMappings: {},
  };

  config.identityMappings = buildIdentityMappings(config.users);

  return config;
}
```

**Step 3: Export loadSystemConfig**

Add to exports:
```javascript
export { loadSystemConfig };
```

**Step 4: Commit**

```bash
git add backend/src/0_system/config/configLoader.mjs
git commit -m "refactor(config): remove secrets loading from configLoader

Secrets/auth now handled by SecretsHandler via provider."
```

---

## Task 12: Modify ConfigService to Accept SecretsHandler

**Files:**
- Modify: `backend/src/0_system/config/ConfigService.mjs`

**Step 1: Update constructor**

```javascript
export class ConfigService {
  #config;
  #secretsHandler;  // NEW

  constructor(config, secretsHandler = null) {  // NEW parameter
    this.#config = Object.freeze(config);
    this.#secretsHandler = secretsHandler;
  }
```

**Step 2: Update getSecret method**

```javascript
  getSecret(key) {
    if (this.#secretsHandler) {
      return this.#secretsHandler.getSecret(key);
    }
    // Fallback for tests using createTestConfigService with inline secrets
    return this.#config.secrets?.[key] ?? null;
  }
```

**Step 3: Update getUserAuth method**

```javascript
  getUserAuth(service, username = null) {
    const user = username ?? this.getHeadOfHousehold();
    if (!user) return null;

    if (this.#secretsHandler) {
      return this.#secretsHandler.getUserAuth(user, service);
    }
    // Fallback for tests
    return this.#config.auth?.users?.[user]?.[service] ?? null;
  }
```

**Step 4: Update getHouseholdAuth method**

```javascript
  getHouseholdAuth(service, householdId = null) {
    const hid = householdId ?? this.getDefaultHouseholdId();

    if (this.#secretsHandler) {
      return this.#secretsHandler.getHouseholdAuth(hid, service);
    }
    // Fallback for tests
    return this.#config.auth?.households?.[hid]?.[service] ?? null;
  }
```

**Step 5: Update getSystemAuth method**

```javascript
  getSystemAuth(platform, key) {
    if (this.#secretsHandler) {
      return this.#secretsHandler.getSystemAuth(platform, key);
    }
    // Fallback for tests
    return this.#config.systemAuth?.[platform]?.[key] ?? null;
  }
```

**Step 6: Commit**

```bash
git add backend/src/0_system/config/ConfigService.mjs
git commit -m "refactor(config): ConfigService delegates to SecretsHandler

- Constructor accepts optional secretsHandler
- Auth/secret methods delegate to handler when present
- Fallback to config object for backward compatibility in tests"
```

---

## Task 13: Modify config/index.mjs Bootstrap

**Files:**
- Modify: `backend/src/0_system/config/index.mjs`

**Step 1: Add imports**

```javascript
import { SecretsHandler, YamlSecretsProvider, EncryptedYamlSecretsProvider, VaultSecretsProvider } from '../secrets/index.mjs';
import { loadSystemConfig } from './configLoader.mjs';
```

**Step 2: Add createSecretsProvider function**

```javascript
/**
 * Create secrets provider based on system config.
 * Provider type configured in system.yml: secrets.provider
 *
 * @param {string} dataDir - Path to data directory
 * @param {object} systemConfig - Loaded system config
 * @returns {import('../secrets/ISecretsProvider.mjs').ISecretsProvider}
 */
function createSecretsProvider(dataDir, systemConfig) {
  const providerType = systemConfig.secrets?.provider ?? 'yaml';

  switch (providerType) {
    case 'yaml':
      return new YamlSecretsProvider(dataDir);
    case 'encrypted':
      return new EncryptedYamlSecretsProvider(dataDir);
    case 'vault':
      return new VaultSecretsProvider(systemConfig.secrets?.vault);
    default:
      throw new Error(`Unknown secrets provider: ${providerType}`);
  }
}
```

**Step 3: Update createConfigService function**

```javascript
export async function createConfigService(dataDir) {
  // 1. Load system config first (determines secrets provider)
  const systemConfig = loadSystemConfig(dataDir);

  // 2. Initialize secrets handler
  const secretsProvider = createSecretsProvider(dataDir, systemConfig);
  await secretsProvider.initialize();
  const secretsHandler = new SecretsHandler(secretsProvider);

  // 3. Load remaining config (no secrets)
  const config = loadConfig(dataDir);
  validateConfig(config, dataDir);

  return new ConfigService(config, secretsHandler);
}
```

**Step 4: Update initConfigService to be async**

```javascript
export async function initConfigService(dataDir) {
  if (instance) {
    throw new Error('ConfigService already initialized');
  }
  instance = await createConfigService(dataDir);
  setEnvPaths(instance);
  return instance;
}
```

**Step 5: Re-export secrets module**

```javascript
// Re-exports
export { SecretsHandler, YamlSecretsProvider, ISecretsProvider } from '../secrets/index.mjs';
```

**Step 6: Commit**

```bash
git add backend/src/0_system/config/index.mjs
git commit -m "feat(config): integrate SecretsHandler into bootstrap

- createConfigService now async
- Loads system config first to determine provider
- Creates SecretsHandler and passes to ConfigService
- Provider selection via system.yml secrets.provider"
```

---

## Task 14: Update configValidator

**Files:**
- Modify: `backend/src/0_system/config/configValidator.mjs`

**Step 1: Remove secrets/auth from required sections**

Find the validation that checks for required sections and remove `secrets` and `auth` from the list.

**Step 2: Commit**

```bash
git add backend/src/0_system/config/configValidator.mjs
git commit -m "refactor(config): remove secrets/auth from validation

Secrets now validated by SecretsHandler, not configValidator."
```

---

## Task 15: Update Callers of initConfigService (Async)

**Files:**
- Modify: `backend/src/app.mjs` (or wherever initConfigService is called)
- Modify: `backend/src/server.mjs`

**Step 1: Add await to initConfigService calls**

Find all calls to `initConfigService(dataDir)` and ensure they are awaited:

```javascript
// Before
const configService = initConfigService(dataDir);

// After
const configService = await initConfigService(dataDir);
```

**Step 2: Run application to verify**

```bash
npm run dev
```

Expected: Application starts without errors.

**Step 3: Commit**

```bash
git add backend/src/app.mjs backend/src/server.mjs
git commit -m "refactor: await async initConfigService"
```

---

## Task 16: Run Full Test Suite

**Step 1: Run all tests**

```bash
npm test
```

Expected: All tests pass.

**Step 2: Run integration tests**

```bash
npm run test:integration
```

Expected: All tests pass.

**Step 3: Manual smoke test**

Start the dev server and verify secrets are accessible:

```bash
npm run dev
# In another terminal, call an endpoint that uses secrets
curl http://localhost:3112/api/v1/status
```

---

## Task 17: Final Commit and Summary

**Step 1: Review all changes**

```bash
git log --oneline -15
git diff main..HEAD --stat
```

**Step 2: Create summary commit if needed**

If any cleanup is needed, commit it.

---

## Summary

After completing all tasks:

**New files:**
- `backend/src/0_system/secrets/index.mjs`
- `backend/src/0_system/secrets/ISecretsProvider.mjs`
- `backend/src/0_system/secrets/SecretsHandler.mjs`
- `backend/src/0_system/secrets/providers/YamlSecretsProvider.mjs`
- `backend/src/0_system/secrets/providers/EncryptedYamlSecretsProvider.mjs`
- `backend/src/0_system/secrets/providers/VaultSecretsProvider.mjs`
- `backend/src/0_system/encryption/index.mjs`
- `backend/src/0_system/encryption/IEncryptionService.mjs`
- `backend/src/0_system/encryption/AesEncryptionService.mjs`
- `tests/unit/suite/secrets/YamlSecretsProvider.test.mjs`
- `tests/unit/suite/secrets/SecretsHandler.test.mjs`

**Modified files:**
- `backend/src/0_system/config/configLoader.mjs` - removed secrets loading
- `backend/src/0_system/config/ConfigService.mjs` - delegates to SecretsHandler
- `backend/src/0_system/config/index.mjs` - async init, provider selection
- `backend/src/0_system/config/configValidator.mjs` - removed secrets validation
- `backend/src/app.mjs` - await initConfigService
- `backend/src/server.mjs` - await initConfigService

**To enable encryption later:**
1. Implement `AesEncryptionService`
2. Implement `EncryptedYamlSecretsProvider`
3. Set `secrets.provider: encrypted` in system.yml

**To enable Vault later:**
1. Implement `VaultSecretsProvider`
2. Set `secrets.provider: vault` and `secrets.vault.*` in system.yml
