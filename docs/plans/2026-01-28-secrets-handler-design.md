# SecretsHandler Abstraction Design

## Overview

Abstract secrets and auth handling behind a provider interface to enable:
1. Clean separation of sensitive data loading from ConfigService
2. Future encrypted flat-file secrets
3. Future Vault integration

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    ConfigService                         │
│  (public API unchanged - getSecret, getUserAuth, etc.)  │
└──────────────────────┬──────────────────────────────────┘
                       │ delegates
                       ▼
┌─────────────────────────────────────────────────────────┐
│                   SecretsHandler                         │
│  (orchestrates provider, potential logging/metrics)     │
└──────────────────────┬──────────────────────────────────┘
                       │ uses
                       ▼
┌─────────────────────────────────────────────────────────┐
│               ISecretsProvider                          │
│  ┌─────────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ YamlProvider    │  │ Encrypted    │  │ Vault     │  │
│  │ (implement now) │  │ (stub)       │  │ (stub)    │  │
│  └─────────────────┘  └──────────────┘  └───────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Key principle:** ConfigService's public API doesn't change. Existing callers continue working unchanged.

## File Structure

```
backend/src/0_system/
├── secrets/
│   ├── index.mjs
│   ├── ISecretsProvider.mjs
│   ├── SecretsHandler.mjs
│   └── providers/
│       ├── YamlSecretsProvider.mjs          # Full implementation
│       ├── EncryptedYamlSecretsProvider.mjs # Stub
│       └── VaultSecretsProvider.mjs         # Stub
│
└── encryption/
    ├── index.mjs
    ├── IEncryptionService.mjs
    └── AesEncryptionService.mjs             # Stub
```

## ISecretsProvider Interface

```javascript
export class ISecretsProvider {
  // ─── System Secrets ─────────────────────────────────
  getSecret(key) { throw new Error('Not implemented'); }
  setSecret(key, value) { throw new Error('Not implemented'); }

  // ─── System Auth (bot tokens, platform credentials) ──
  getSystemAuth(platform, key) { throw new Error('Not implemented'); }
  setSystemAuth(platform, key, value) { throw new Error('Not implemented'); }

  // ─── User Auth ──────────────────────────────────────
  getUserAuth(username, service) { throw new Error('Not implemented'); }
  setUserAuth(username, service, value) { throw new Error('Not implemented'); }

  // ─── Household Auth ─────────────────────────────────
  getHouseholdAuth(householdId, service) { throw new Error('Not implemented'); }
  setHouseholdAuth(householdId, service, value) { throw new Error('Not implemented'); }

  // ─── Lifecycle ──────────────────────────────────────
  async initialize() { throw new Error('Not implemented'); }
  async flush() {}
}
```

## IEncryptionService Interface

```javascript
export class IEncryptionService {
  /** Encrypt plaintext, returns base64-encoded ciphertext */
  encrypt(plaintext) { throw new Error('Not implemented'); }

  /** Decrypt base64-encoded ciphertext, returns plaintext */
  decrypt(ciphertext) { throw new Error('Not implemented'); }
}
```

## SecretsHandler

Thin orchestration layer that delegates to the provider:

```javascript
export class SecretsHandler {
  #provider;

  constructor(provider) {
    this.#provider = provider;
  }

  async initialize() {
    await this.#provider.initialize();
  }

  getSecret(key) { return this.#provider.getSecret(key); }
  setSecret(key, value) { return this.#provider.setSecret(key, value); }

  getUserAuth(username, service) { return this.#provider.getUserAuth(username, service); }
  setUserAuth(username, service, value) { return this.#provider.setUserAuth(username, service, value); }

  getHouseholdAuth(householdId, service) { return this.#provider.getHouseholdAuth(householdId, service); }
  setHouseholdAuth(householdId, service, value) { return this.#provider.setHouseholdAuth(householdId, service, value); }

  getSystemAuth(platform, key) { return this.#provider.getSystemAuth(platform, key); }
  setSystemAuth(platform, key, value) { return this.#provider.setSystemAuth(platform, key, value); }

  async flush() { await this.#provider.flush(); }
}
```

## ConfigService Integration

```javascript
export class ConfigService {
  #config;
  #secretsHandler;

  constructor(config, secretsHandler) {
    this.#config = Object.freeze(config);
    this.#secretsHandler = secretsHandler;
  }

  // Delegates to SecretsHandler (public API unchanged)
  getSecret(key) {
    return this.#secretsHandler.getSecret(key);
  }

  getUserAuth(service, username = null) {
    const user = username ?? this.getHeadOfHousehold();
    if (!user) return null;
    return this.#secretsHandler.getUserAuth(user, service);
  }

  getHouseholdAuth(service, householdId = null) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    return this.#secretsHandler.getHouseholdAuth(hid, service);
  }

  getSystemAuth(platform, key) {
    return this.#secretsHandler.getSystemAuth(platform, key);
  }
}
```

## Bootstrap Changes

```javascript
// config/index.mjs

export async function initConfigService(dataDir) {
  // 1. Load system config first (non-sensitive, tells us how to load secrets)
  const systemConfig = loadSystemConfig(dataDir);

  // 2. Create secrets provider based on system config
  const secretsProvider = createSecretsProvider(dataDir, systemConfig);
  await secretsProvider.initialize();
  const secretsHandler = new SecretsHandler(secretsProvider);

  // 3. Load remaining config (no secrets in here anymore)
  const config = loadConfig(dataDir);
  validateConfig(config, dataDir);

  return new ConfigService(config, secretsHandler);
}

function createSecretsProvider(dataDir, systemConfig) {
  const providerType = systemConfig.secrets?.provider ?? 'yaml';

  switch (providerType) {
    case 'yaml': return new YamlSecretsProvider(dataDir);
    case 'encrypted': return new EncryptedYamlSecretsProvider(dataDir);
    case 'vault': return new VaultSecretsProvider(systemConfig.secrets?.vault);
    default: throw new Error(`Unknown secrets provider: ${providerType}`);
  }
}
```

## Configuration (system.yml)

```yaml
# Default (implicit yaml provider)
timezone: America/Los_Angeles

# Future: encrypted flat files
secrets:
  provider: encrypted

# Future: HashiCorp Vault
secrets:
  provider: vault
  vault:
    address: https://vault.example.com
    mount: secret/daylight
```

## YamlSecretsProvider

Moves current loading logic from `configLoader.mjs`:

```javascript
export class YamlSecretsProvider extends ISecretsProvider {
  #dataDir;
  #secrets = {};
  #systemAuth = {};
  #userAuth = {};
  #householdAuth = {};

  constructor(dataDir) {
    super();
    this.#dataDir = dataDir;
  }

  async initialize() {
    this.#secrets = this.#loadYaml('system/secrets.yml') ?? {};
    this.#systemAuth = this.#loadSystemAuth();
    this.#userAuth = this.#loadUserAuth();
    this.#householdAuth = this.#loadHouseholdAuth();
  }

  // Reads
  getSecret(key) { return this.#secrets[key] ?? null; }
  getSystemAuth(platform, key) { return this.#systemAuth[platform]?.[key] ?? null; }
  getUserAuth(username, service) { return this.#userAuth[username]?.[service] ?? null; }
  getHouseholdAuth(householdId, service) { return this.#householdAuth[householdId]?.[service] ?? null; }

  // Writes
  setSecret(key, value) {
    this.#secrets[key] = value;
    this.#writeYaml('system/secrets.yml', this.#secrets);
  }

  setUserAuth(username, service, value) {
    this.#userAuth[username] ??= {};
    this.#userAuth[username][service] = value;
    this.#writeYaml(`users/${username}/auth/${service}.yml`, value);
  }

  // Similar for setHouseholdAuth, setSystemAuth...
}
```

## Stub Providers

Stubs throw on construction for clear errors if accidentally selected:

```javascript
// EncryptedYamlSecretsProvider.mjs
export class EncryptedYamlSecretsProvider extends ISecretsProvider {
  constructor(dataDir, encryptionService) {
    super();
    throw new Error('EncryptedYamlSecretsProvider not yet implemented');
  }
}

// VaultSecretsProvider.mjs
export class VaultSecretsProvider extends ISecretsProvider {
  constructor(vaultConfig) {
    super();
    throw new Error('VaultSecretsProvider not yet implemented');
  }
}

// AesEncryptionService.mjs
export class AesEncryptionService extends IEncryptionService {
  constructor(keySource) {
    super();
    throw new Error('AesEncryptionService not yet implemented');
  }
}
```

## Migration Steps

1. Add `secrets/` directory with interface, handler, and YamlSecretsProvider
2. Add `encryption/` directory with interface and stub
3. Modify `configLoader.mjs` - remove secrets/auth loading functions
4. Modify `config/index.mjs` - wire up SecretsHandler in bootstrap
5. Modify `ConfigService.mjs` - accept and delegate to SecretsHandler
6. Update tests

## Files Changed

- `backend/src/0_system/config/configLoader.mjs` - remove ~100 lines (secrets loading)
- `backend/src/0_system/config/ConfigService.mjs` - modify 4 methods to delegate
- `backend/src/0_system/config/index.mjs` - modify init function

## Files Added

```
backend/src/0_system/secrets/
├── index.mjs
├── ISecretsProvider.mjs
├── SecretsHandler.mjs
└── providers/
    ├── YamlSecretsProvider.mjs
    ├── EncryptedYamlSecretsProvider.mjs
    └── VaultSecretsProvider.mjs

backend/src/0_system/encryption/
├── index.mjs
├── IEncryptionService.mjs
└── AesEncryptionService.mjs
```

## Testing Strategy

- Unit tests for YamlSecretsProvider (reads/writes to temp directory)
- Unit tests for SecretsHandler (mock provider)
- Existing ConfigService tests should pass unchanged (API didn't change)
- Integration test verifying end-to-end bootstrap

## Future Work (Not In Scope)

- `EncryptedYamlSecretsProvider` implementation - when encrypted flat files needed
- `AesEncryptionService` implementation - AES-256-GCM with key from env/keyfile
- `VaultSecretsProvider` implementation - when migrating to HashiCorp Vault
