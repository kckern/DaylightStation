# Integration Loader Standardization - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix "integrations is not iterable" error by updating IntegrationLoader to handle current config structure with convention-based mapping and per-app routing.

**Architecture:** Replace registry-based capability iteration with config-driven parsing. Parse integrations.yml into services (plex, homeassistant) and app routing (ai.nutribot→openai). Return HouseholdAdapters wrapper with `.get(capability, appName)` API.

**Tech Stack:** ES Modules, Jest for testing, YAML config files

**Design Doc:** `docs/plans/2026-01-28-integration-loader-standardization.md`

---

## Task 1: Add HouseholdAdapters Class

**Files:**
- Create: `backend/src/0_system/registries/HouseholdAdapters.mjs`
- Test: `tests/unit/suite/system/registries/HouseholdAdapters.test.mjs`

**Step 1: Write the failing test**

Create `tests/unit/suite/system/registries/HouseholdAdapters.test.mjs`:

```javascript
import { jest } from '@jest/globals';
import { HouseholdAdapters } from '#backend/src/0_system/registries/HouseholdAdapters.mjs';

describe('HouseholdAdapters', () => {
  describe('get()', () => {
    test('returns adapter for capability without app', () => {
      const mockPlexAdapter = { name: 'plex' };
      const adapters = new HouseholdAdapters({
        adapters: {
          media: { plex: mockPlexAdapter }
        },
        appRouting: {},
        defaults: { media: 'plex' }
      });

      expect(adapters.get('media')).toBe(mockPlexAdapter);
    });

    test('returns app-specific adapter when app routing exists', () => {
      const mockOpenAI = { name: 'openai' };
      const mockAnthropic = { name: 'anthropic' };
      const adapters = new HouseholdAdapters({
        adapters: {
          ai: { openai: mockOpenAI, anthropic: mockAnthropic }
        },
        appRouting: {
          ai: { nutribot: 'openai', journalist: 'anthropic' }
        },
        defaults: { ai: 'openai' }
      });

      expect(adapters.get('ai', 'nutribot')).toBe(mockOpenAI);
      expect(adapters.get('ai', 'journalist')).toBe(mockAnthropic);
    });

    test('returns default adapter when app not in routing', () => {
      const mockOpenAI = { name: 'openai' };
      const adapters = new HouseholdAdapters({
        adapters: {
          ai: { openai: mockOpenAI }
        },
        appRouting: {},
        defaults: { ai: 'openai' }
      });

      expect(adapters.get('ai', 'unknown-app')).toBe(mockOpenAI);
    });

    test('returns NoOp for unconfigured capability', () => {
      const adapters = new HouseholdAdapters({
        adapters: {},
        appRouting: {},
        defaults: {}
      });

      const result = adapters.get('finance');
      expect(result.isConfigured()).toBe(false);
    });
  });

  describe('has()', () => {
    test('returns true for configured capability', () => {
      const mockAdapter = { isConfigured: () => true };
      const adapters = new HouseholdAdapters({
        adapters: { media: { plex: mockAdapter } },
        appRouting: {},
        defaults: { media: 'plex' }
      });

      expect(adapters.has('media')).toBe(true);
    });

    test('returns false for unconfigured capability', () => {
      const adapters = new HouseholdAdapters({
        adapters: {},
        appRouting: {},
        defaults: {}
      });

      expect(adapters.has('finance')).toBe(false);
    });
  });

  describe('providers()', () => {
    test('lists all providers for a capability', () => {
      const adapters = new HouseholdAdapters({
        adapters: {
          ai: { openai: {}, anthropic: {} }
        },
        appRouting: {},
        defaults: { ai: 'openai' }
      });

      expect(adapters.providers('ai')).toEqual(['openai', 'anthropic']);
    });

    test('returns empty array for unconfigured capability', () => {
      const adapters = new HouseholdAdapters({
        adapters: {},
        appRouting: {},
        defaults: {}
      });

      expect(adapters.providers('finance')).toEqual([]);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/system/registries/HouseholdAdapters.test.mjs -v`

Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

Create `backend/src/0_system/registries/HouseholdAdapters.mjs`:

```javascript
import {
  createNoOpMediaAdapter,
  createNoOpAIGateway,
  createNoOpHomeAutomationGateway,
  createNoOpMessagingGateway,
  createNoOpFinanceAdapter,
} from './noops/index.mjs';

/**
 * Wrapper for household adapters with per-app routing support.
 *
 * @example
 * const adapters = new HouseholdAdapters({ adapters, appRouting, defaults });
 * adapters.get('ai', 'nutribot');  // → OpenAI adapter
 * adapters.get('media');           // → Plex adapter (default)
 */
export class HouseholdAdapters {
  #adapters;    // capability → provider → adapter
  #appRouting;  // capability → app → provider
  #defaults;    // capability → default provider

  constructor({ adapters, appRouting, defaults }) {
    this.#adapters = adapters;
    this.#appRouting = appRouting;
    this.#defaults = defaults;
  }

  /**
   * Get adapter for a capability, optionally scoped to an app.
   *
   * @param {string} capability - Capability name (ai, media, etc.)
   * @param {string} [appName] - App name for per-app routing (nutribot, journalist, etc.)
   * @returns {object} Adapter instance or NoOp adapter
   */
  get(capability, appName = null) {
    const capAdapters = this.#adapters[capability];
    if (!capAdapters || Object.keys(capAdapters).length === 0) {
      return this.#createNoOp(capability);
    }

    // Determine which provider to use
    let provider;
    if (appName && this.#appRouting[capability]?.[appName]) {
      // App-specific routing
      provider = this.#appRouting[capability][appName];
    } else {
      // Default provider for capability
      provider = this.#defaults[capability];
    }

    return capAdapters[provider] ?? this.#createNoOp(capability);
  }

  /**
   * Check if capability is configured (not NoOp).
   */
  has(capability, appName = null) {
    const adapter = this.get(capability, appName);
    if (!adapter) return false;
    if (typeof adapter.isConfigured === 'function') return adapter.isConfigured();
    if (typeof adapter.isAvailable === 'function') return adapter.isAvailable();
    return Object.keys(adapter).length > 0;
  }

  /**
   * List all configured providers for a capability.
   */
  providers(capability) {
    return Object.keys(this.#adapters[capability] ?? {});
  }

  #createNoOp(capability) {
    const noOps = {
      media: createNoOpMediaAdapter(),
      ai: createNoOpAIGateway(),
      home_automation: createNoOpHomeAutomationGateway(),
      messaging: createNoOpMessagingGateway(),
      finance: createNoOpFinanceAdapter(),
    };
    return noOps[capability] ?? { isConfigured: () => false };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/system/registries/HouseholdAdapters.test.mjs -v`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/0_system/registries/HouseholdAdapters.mjs tests/unit/suite/system/registries/HouseholdAdapters.test.mjs
git commit -m "feat(integrations): add HouseholdAdapters class with per-app routing"
```

---

## Task 2: Add Config Parsing Utilities

**Files:**
- Create: `backend/src/0_system/registries/integrationConfigParser.mjs`
- Test: `tests/unit/suite/system/registries/integrationConfigParser.test.mjs`

**Step 1: Write the failing test**

Create `tests/unit/suite/system/registries/integrationConfigParser.test.mjs`:

```javascript
import { jest } from '@jest/globals';
import {
  PROVIDER_CAPABILITY_MAP,
  CAPABILITY_KEYS,
  parseIntegrationsConfig,
  parseAppRouting,
} from '#backend/src/0_system/registries/integrationConfigParser.mjs';

describe('integrationConfigParser', () => {
  describe('PROVIDER_CAPABILITY_MAP', () => {
    test('maps plex to media', () => {
      expect(PROVIDER_CAPABILITY_MAP.plex).toBe('media');
    });

    test('maps homeassistant to home_automation', () => {
      expect(PROVIDER_CAPABILITY_MAP.homeassistant).toBe('home_automation');
    });

    test('maps openai to ai', () => {
      expect(PROVIDER_CAPABILITY_MAP.openai).toBe('ai');
    });

    test('maps telegram to messaging', () => {
      expect(PROVIDER_CAPABILITY_MAP.telegram).toBe('messaging');
    });

    test('maps buxfer to finance', () => {
      expect(PROVIDER_CAPABILITY_MAP.buxfer).toBe('finance');
    });
  });

  describe('parseIntegrationsConfig()', () => {
    test('separates service entries from capability entries', () => {
      const config = {
        plex: { port: 32400, protocol: 'dash' },
        homeassistant: { port: 8123 },
        ai: {
          nutribot: [{ provider: 'openai' }],
          journalist: [{ provider: 'anthropic' }],
        },
        messaging: {
          nutribot: [{ platform: 'telegram' }],
        },
      };

      const result = parseIntegrationsConfig(config);

      expect(result.services).toEqual({
        plex: { port: 32400, protocol: 'dash' },
        homeassistant: { port: 8123 },
      });
      expect(result.appRouting).toEqual({
        ai: { nutribot: 'openai', journalist: 'anthropic' },
        messaging: { nutribot: 'telegram' },
      });
    });

    test('handles empty config', () => {
      const result = parseIntegrationsConfig({});

      expect(result.services).toEqual({});
      expect(result.appRouting).toEqual({});
    });

    test('ignores unknown keys', () => {
      const config = {
        plex: { port: 32400 },
        unknown_service: { foo: 'bar' },
      };

      const result = parseIntegrationsConfig(config);

      expect(result.services).toEqual({ plex: { port: 32400 } });
      expect(result.unknownKeys).toContain('unknown_service');
    });
  });

  describe('parseAppRouting()', () => {
    test('extracts provider from array format', () => {
      const capabilityConfig = {
        nutribot: [{ provider: 'openai' }],
        journalist: [{ provider: 'anthropic' }],
      };

      const result = parseAppRouting(capabilityConfig);

      expect(result).toEqual({
        nutribot: 'openai',
        journalist: 'anthropic',
      });
    });

    test('handles platform key for messaging', () => {
      const capabilityConfig = {
        nutribot: [{ platform: 'telegram' }],
      };

      const result = parseAppRouting(capabilityConfig);

      expect(result).toEqual({ nutribot: 'telegram' });
    });

    test('handles empty config', () => {
      expect(parseAppRouting({})).toEqual({});
      expect(parseAppRouting(null)).toEqual({});
      expect(parseAppRouting(undefined)).toEqual({});
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/system/registries/integrationConfigParser.test.mjs -v`

Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

Create `backend/src/0_system/registries/integrationConfigParser.mjs`:

```javascript
/**
 * Convention-based provider → capability mapping.
 * Used to infer capability from service config keys.
 */
export const PROVIDER_CAPABILITY_MAP = {
  // Media
  plex: 'media',
  jellyfin: 'media',

  // Home automation
  homeassistant: 'home_automation',

  // AI
  openai: 'ai',
  anthropic: 'ai',

  // Messaging
  telegram: 'messaging',
  discord: 'messaging',

  // Finance
  buxfer: 'finance',
};

/**
 * Keys that represent capability sections (not service entries).
 */
export const CAPABILITY_KEYS = ['ai', 'messaging', 'media', 'home_automation', 'finance'];

/**
 * Parse integrations.yml config into services and app routing.
 *
 * @param {object} config - Raw integrations.yml content
 * @returns {{ services: object, appRouting: object, unknownKeys: string[] }}
 */
export function parseIntegrationsConfig(config) {
  const services = {};
  const appRouting = {};
  const unknownKeys = [];

  if (!config || typeof config !== 'object') {
    return { services, appRouting, unknownKeys };
  }

  for (const [key, value] of Object.entries(config)) {
    if (CAPABILITY_KEYS.includes(key)) {
      // Per-app routing section (ai, messaging, etc.)
      appRouting[key] = parseAppRouting(value);
    } else if (PROVIDER_CAPABILITY_MAP[key]) {
      // Service connection entry (plex, homeassistant, etc.)
      services[key] = value;
    } else {
      // Unknown key
      unknownKeys.push(key);
    }
  }

  return { services, appRouting, unknownKeys };
}

/**
 * Parse per-app routing from capability config section.
 *
 * Input: { nutribot: [{ provider: 'openai' }], journalist: [{ provider: 'anthropic' }] }
 * Output: { nutribot: 'openai', journalist: 'anthropic' }
 *
 * @param {object} capabilityConfig - Config for a single capability (ai, messaging, etc.)
 * @returns {object} App → provider mapping
 */
export function parseAppRouting(capabilityConfig) {
  if (!capabilityConfig || typeof capabilityConfig !== 'object') {
    return {};
  }

  const routing = {};

  for (const [appName, configs] of Object.entries(capabilityConfig)) {
    if (!Array.isArray(configs) || configs.length === 0) continue;

    // Take first config entry
    const config = configs[0];
    // Support both 'provider' and 'platform' keys
    const provider = config.provider ?? config.platform;
    if (provider) {
      routing[appName] = provider;
    }
  }

  return routing;
}
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/system/registries/integrationConfigParser.test.mjs -v`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/0_system/registries/integrationConfigParser.mjs tests/unit/suite/system/registries/integrationConfigParser.test.mjs
git commit -m "feat(integrations): add config parsing with convention mapping"
```

---

## Task 3: Rewrite IntegrationLoader

**Files:**
- Modify: `backend/src/0_system/registries/IntegrationLoader.mjs`
- Modify: `tests/unit/suite/system/registries/IntegrationLoader.test.mjs`

**Step 1: Update test file with new tests for config-driven loading**

Add to `tests/unit/suite/system/registries/IntegrationLoader.test.mjs`:

```javascript
// Add these imports at top
import {
  parseIntegrationsConfig,
  PROVIDER_CAPABILITY_MAP,
} from '#backend/src/0_system/registries/integrationConfigParser.mjs';

// Add new describe block for config-driven loading
describe('Config-driven loading', () => {
  test('parses service entries and loads adapters by convention', async () => {
    const MockPlexAdapter = class PlexAdapter {
      constructor(config) { this.config = config; }
      isConfigured() { return true; }
    };

    // Config matches production integrations.yml structure
    const rawConfig = {
      plex: { port: 32400, protocol: 'dash' },
      ai: {
        nutribot: [{ provider: 'openai' }],
      },
    };

    mockRegistry.getManifest.mockImplementation((capability, provider) => {
      if (capability === 'media' && provider === 'plex') {
        return {
          provider: 'plex',
          capability: 'media',
          adapter: () => Promise.resolve({ default: MockPlexAdapter }),
        };
      }
      return undefined;
    });

    // Mock ConfigService to return raw integrations config
    const mockConfigService = {
      getIntegrationsConfig: jest.fn().mockReturnValue(rawConfig),
      getHouseholdAuth: jest.fn().mockReturnValue(null),
      resolveServiceUrl: jest.fn().mockReturnValue(null),
      getSecret: jest.fn().mockReturnValue(null),
    };

    const loader = new IntegrationLoader({
      registry: mockRegistry,
      configService: mockConfigService,
      logger: mockLogger,
    });

    const adapters = await loader.loadForHousehold('default', {});

    // Should return HouseholdAdapters instance
    expect(typeof adapters.get).toBe('function');
    expect(adapters.get('media').isConfigured()).toBe(true);
  });

  test('builds app routing from capability sections', async () => {
    const MockOpenAI = class OpenAI {
      constructor(config) { this.config = config; this.name = 'openai'; }
    };
    const MockAnthropic = class Anthropic {
      constructor(config) { this.config = config; this.name = 'anthropic'; }
    };

    const rawConfig = {
      ai: {
        nutribot: [{ provider: 'openai' }],
        journalist: [{ provider: 'anthropic' }],
      },
    };

    mockRegistry.getManifest.mockImplementation((capability, provider) => {
      if (capability === 'ai' && provider === 'openai') {
        return { provider: 'openai', capability: 'ai', adapter: () => Promise.resolve({ default: MockOpenAI }) };
      }
      if (capability === 'ai' && provider === 'anthropic') {
        return { provider: 'anthropic', capability: 'ai', adapter: () => Promise.resolve({ default: MockAnthropic }) };
      }
      return undefined;
    });

    const mockConfigService = {
      getIntegrationsConfig: jest.fn().mockReturnValue(rawConfig),
      getHouseholdAuth: jest.fn().mockReturnValue(null),
      resolveServiceUrl: jest.fn().mockReturnValue(null),
      getSecret: jest.fn().mockReturnValue(null),
    };

    const loader = new IntegrationLoader({
      registry: mockRegistry,
      configService: mockConfigService,
      logger: mockLogger,
    });

    const adapters = await loader.loadForHousehold('default', {});

    // Per-app routing should work
    expect(adapters.get('ai', 'nutribot').name).toBe('openai');
    expect(adapters.get('ai', 'journalist').name).toBe('anthropic');
  });

  test('handles object config that was causing "not iterable" error', async () => {
    // This is the exact config structure that caused the original bug
    const rawConfig = {
      plex: { service: 'plex', port: 32400 },
      homeassistant: { service: 'homeassistant', port: 8123 },
      ai: {
        nutribot: [{ provider: 'openai' }],
        journalist: [{ provider: 'anthropic' }],
      },
      messaging: {
        nutribot: [{ platform: 'telegram' }],
      },
    };

    const mockConfigService = {
      getIntegrationsConfig: jest.fn().mockReturnValue(rawConfig),
      getHouseholdAuth: jest.fn().mockReturnValue(null),
      resolveServiceUrl: jest.fn().mockReturnValue(null),
      getSecret: jest.fn().mockReturnValue(null),
    };

    const loader = new IntegrationLoader({
      registry: mockRegistry,
      configService: mockConfigService,
      logger: mockLogger,
    });

    // Should NOT throw "integrations is not iterable"
    await expect(loader.loadForHousehold('default', {})).resolves.toBeDefined();
  });
});
```

**Step 2: Run tests to verify new tests fail**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/system/registries/IntegrationLoader.test.mjs -v`

Expected: FAIL (new tests fail, old tests may also fail)

**Step 3: Rewrite IntegrationLoader implementation**

Replace `backend/src/0_system/registries/IntegrationLoader.mjs` with:

```javascript
import { HouseholdAdapters } from './HouseholdAdapters.mjs';
import {
  parseIntegrationsConfig,
  PROVIDER_CAPABILITY_MAP,
} from './integrationConfigParser.mjs';

/**
 * Config-driven adapter loading with convention-based capability mapping.
 *
 * Parses integrations.yml to:
 * 1. Load service adapters (plex → media, homeassistant → home_automation)
 * 2. Build per-app routing (ai.nutribot → openai, ai.journalist → anthropic)
 */
export class IntegrationLoader {
  #registry;
  #configService;
  #loadedAdapters = new Map();
  #logger;

  constructor({ registry, configService, logger = console }) {
    this.#registry = registry;
    this.#configService = configService;
    this.#logger = logger;
  }

  /**
   * Load integrations for a household based on their config.
   *
   * @param {string} householdId
   * @param {object} deps - Shared dependencies (httpClient, etc.)
   * @returns {HouseholdAdapters}
   */
  async loadForHousehold(householdId, deps = {}) {
    // Get raw integrations config
    const rawConfig = this.#configService.getIntegrationsConfig?.(householdId) ?? {};

    // Parse into services and app routing
    const { services, appRouting, unknownKeys } = parseIntegrationsConfig(rawConfig);

    // Log unknown keys
    for (const key of unknownKeys) {
      this.#logger.warn?.('integration.unknown-key', { householdId, key });
    }

    // Load adapters for each service
    const adapters = {};
    const defaults = {};

    for (const [provider, serviceConfig] of Object.entries(services)) {
      const capability = PROVIDER_CAPABILITY_MAP[provider];
      if (!capability) continue;

      const adapter = await this.#loadAdapter(householdId, capability, provider, serviceConfig, deps);
      if (adapter) {
        if (!adapters[capability]) adapters[capability] = {};
        adapters[capability][provider] = adapter;

        // First adapter becomes default
        if (!defaults[capability]) defaults[capability] = provider;
      }
    }

    // Load adapters referenced in app routing
    for (const [capability, appProviders] of Object.entries(appRouting)) {
      const uniqueProviders = [...new Set(Object.values(appProviders))];

      for (const provider of uniqueProviders) {
        // Skip if already loaded from services section
        if (adapters[capability]?.[provider]) continue;

        const adapter = await this.#loadAdapter(householdId, capability, provider, {}, deps);
        if (adapter) {
          if (!adapters[capability]) adapters[capability] = {};
          adapters[capability][provider] = adapter;

          if (!defaults[capability]) defaults[capability] = provider;
        }
      }
    }

    // Create HouseholdAdapters wrapper
    const householdAdapters = new HouseholdAdapters({
      adapters,
      appRouting,
      defaults,
    });

    this.#loadedAdapters.set(householdId, householdAdapters);

    this.#logger.info?.('integrations.loaded', {
      householdId,
      services: Object.keys(services),
      capabilities: Object.keys(adapters),
      appRouting: Object.keys(appRouting),
    });

    return householdAdapters;
  }

  async #loadAdapter(householdId, capability, provider, serviceConfig, deps) {
    const manifest = this.#registry.getManifest(capability, provider);
    if (!manifest) {
      this.#logger.warn?.('integration.provider-not-discovered', { capability, provider });
      return null;
    }

    const config = this.#buildAdapterConfig(householdId, provider, serviceConfig);

    try {
      const { default: AdapterClass } = await manifest.adapter();
      const adapter = new AdapterClass(config, deps);

      this.#logger.info?.('integration.adapter.loaded', { householdId, capability, provider });
      return adapter;
    } catch (err) {
      this.#logger.error?.('integration.adapter.failed', {
        capability,
        provider,
        error: err.message,
      });
      return null;
    }
  }

  #buildAdapterConfig(householdId, provider, serviceConfig) {
    const auth = this.#configService.getHouseholdAuth?.(provider, householdId) ?? {};
    const serviceUrl = this.#configService.resolveServiceUrl?.(provider);
    const secrets = this.#getProviderSecrets(provider);

    const config = {
      ...serviceConfig,
      ...auth,
      ...secrets,
      ...(serviceUrl ? { host: serviceUrl } : {}),
    };

    return this.#normalizeConfig(provider, config);
  }

  #getProviderSecrets(provider) {
    const secretKeyMap = {
      openai: { OPENAI_API_KEY: 'apiKey' },
      anthropic: { ANTHROPIC_API_KEY: 'apiKey' },
      telegram: { TELEGRAM_BOT_TOKEN: 'token' },
    };

    const keyMappings = secretKeyMap[provider] || {};
    const secrets = {};

    for (const [envKey, configKey] of Object.entries(keyMappings)) {
      const value = this.#configService.getSecret?.(envKey);
      if (value) secrets[configKey] = value;
    }

    return secrets;
  }

  #normalizeConfig(provider, config) {
    const normalized = { ...config };

    const fieldMappings = {
      api_key: 'apiKey',
      base_url: 'baseUrl',
      access_token: 'accessToken',
    };

    for (const [snake, camel] of Object.entries(fieldMappings)) {
      if (normalized[snake] !== undefined && normalized[camel] === undefined) {
        normalized[camel] = normalized[snake];
        delete normalized[snake];
      }
    }

    if (provider === 'homeassistant' && normalized.host && !normalized.baseUrl) {
      normalized.baseUrl = normalized.host;
      delete normalized.host;
    }

    return normalized;
  }

  getAdapters(householdId) {
    return this.#loadedAdapters.get(householdId);
  }

  hasCapability(householdId, capability, appName = null) {
    const adapters = this.#loadedAdapters.get(householdId);
    return adapters?.has(capability, appName) ?? false;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/system/registries/IntegrationLoader.test.mjs -v`

Expected: Most tests PASS (some old tests may need updating due to API change)

**Step 5: Update failing old tests**

Update tests that use the old API (direct property access) to use the new `.get()` API.

**Step 6: Commit**

```bash
git add backend/src/0_system/registries/IntegrationLoader.mjs tests/unit/suite/system/registries/IntegrationLoader.test.mjs
git commit -m "refactor(integrations): rewrite IntegrationLoader with config-driven parsing

- Parse integrations.yml into services and app routing
- Convention-based capability mapping (plex→media, etc.)
- Return HouseholdAdapters with .get(capability, app) API
- Fix 'integrations is not iterable' error"
```

---

## Task 4: Add getIntegrationsConfig to ConfigService

**Files:**
- Modify: `backend/src/0_system/config/ConfigService.mjs`
- Modify: `tests/unit/suite/config/ConfigService.test.mjs` (if exists)

**Step 1: Add method to ConfigService**

Add to `backend/src/0_system/config/ConfigService.mjs` (near `getCapabilityIntegrations`):

```javascript
/**
 * Get raw integrations config for a household.
 * Returns the entire integrations.yml content for parsing.
 *
 * @param {string} [householdId]
 * @returns {object} Raw integrations config
 */
getIntegrationsConfig(householdId) {
  const hid = householdId ?? this.getDefaultHouseholdId();
  return this.#config.households?.[hid]?.integrations ?? {};
}
```

**Step 2: Run all integration loader tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/system/registries/ -v`

Expected: PASS

**Step 3: Commit**

```bash
git add backend/src/0_system/config/ConfigService.mjs
git commit -m "feat(config): add getIntegrationsConfig for raw config access"
```

---

## Task 5: Update app.mjs Adapter Lookups

**Files:**
- Modify: `backend/src/app.mjs` (lines 348, 401, 480, 650, 726)

**Step 1: Update all householdAdapters usages**

Replace each usage pattern:

| Line | Old Code | New Code |
|------|----------|----------|
| 348 | `householdAdapters?.finance ?? null` | `householdAdapters?.get('finance') ?? null` |
| 401 | `householdAdapters?.home_automation ?? null` | `householdAdapters?.get('home_automation') ?? null` |
| 480 | `householdAdapters?.finance ?? null` | `householdAdapters?.get('finance') ?? null` |
| 650 | `householdAdapters?.home_automation ?? null` | `householdAdapters?.get('home_automation') ?? null` |
| 726 | `householdAdapters?.ai ?? null` | `householdAdapters?.get('ai') ?? null` |

For per-app AI routing, update line 726 area:

```javascript
// Old:
let sharedAiGateway = householdAdapters?.ai ?? null;

// New - default AI gateway (for general use):
let sharedAiGateway = householdAdapters?.get('ai') ?? null;

// Then later, for bot-specific AI (around lines 766, 822, 857):
const nutribotAiGateway = householdAdapters?.get('ai', 'nutribot') ?? sharedAiGateway;
const journalistAiGateway = householdAdapters?.get('ai', 'journalist') ?? sharedAiGateway;
const homebotAiGateway = householdAdapters?.get('ai', 'homebot') ?? sharedAiGateway;
```

**Step 2: Verify server starts**

Run: `node backend/index.js` (or check dev server)

Expected: Server starts without "integrations is not iterable" error

**Step 3: Commit**

```bash
git add backend/src/app.mjs
git commit -m "refactor(app): update to HouseholdAdapters.get() API

- Replace direct property access with .get(capability, app)
- Enable per-app AI routing for nutribot/journalist/homebot"
```

---

## Task 6: Export New Modules from Index

**Files:**
- Modify: `backend/src/0_system/registries/index.mjs`

**Step 1: Add exports**

Update `backend/src/0_system/registries/index.mjs`:

```javascript
export { IntegrationLoader } from './IntegrationLoader.mjs';
export { HouseholdAdapters } from './HouseholdAdapters.mjs';
export {
  parseIntegrationsConfig,
  parseAppRouting,
  PROVIDER_CAPABILITY_MAP,
  CAPABILITY_KEYS,
} from './integrationConfigParser.mjs';
export { AdapterRegistry } from './AdapterRegistry.mjs';
// ... existing exports
```

**Step 2: Commit**

```bash
git add backend/src/0_system/registries/index.mjs
git commit -m "chore(registries): export new integration modules"
```

---

## Task 7: Run Full Test Suite & Deploy Check

**Step 1: Run all unit tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/ --runInBand`

Expected: PASS

**Step 2: Start dev server and verify no errors**

Run: `npm run dev` or `node backend/index.js`

Check logs for:
- No "integrations is not iterable" error
- `integrations.loaded` log with services/capabilities

**Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address test/runtime issues from integration loader refactor"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | HouseholdAdapters class | +2 files |
| 2 | Config parsing utilities | +2 files |
| 3 | Rewrite IntegrationLoader | ~2 files |
| 4 | ConfigService.getIntegrationsConfig | ~1 file |
| 5 | Update app.mjs lookups | ~1 file |
| 6 | Export from index | ~1 file |
| 7 | Test & verify | - |

**Total: ~7 commits, ~9 file changes**
