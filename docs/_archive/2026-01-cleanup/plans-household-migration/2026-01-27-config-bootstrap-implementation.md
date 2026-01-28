# Config-Driven Bootstrap & Household Restructuring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor bootstrap to be config-driven with manifest-based adapter discovery, and simplify household directory structure to flat `household[-{id}]/` pattern with subdomain routing.

**Architecture:** Adapters declare their metadata via manifest files. IntegrationLoader dynamically imports adapters based on household config. ConfigLoader discovers households from `household*/` directories. Subdomain middleware routes requests to households.

**Tech Stack:** Node.js ES modules, YAML config, Jest testing, glob for discovery

---

## Phase 1: Adapter Registry & Manifest Discovery

### Task 1.1: Create AdapterRegistry

**Files:**
- Create: `backend/src/0_system/registries/AdapterRegistry.mjs`
- Test: `tests/unit/suite/system/registries/AdapterRegistry.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/system/registries/AdapterRegistry.test.mjs
import { jest } from '@jest/globals';
import { AdapterRegistry } from '#backend/src/0_system/registries/AdapterRegistry.mjs';

describe('AdapterRegistry', () => {
  describe('discover()', () => {
    test('discovers manifest files and indexes by capability/provider', async () => {
      const registry = new AdapterRegistry();

      // Mock glob to return test manifests
      registry._glob = jest.fn().mockResolvedValue([
        '/fake/path/plex/manifest.mjs',
        '/fake/path/openai/manifest.mjs',
      ]);

      // Mock dynamic import
      registry._import = jest.fn()
        .mockResolvedValueOnce({
          default: {
            provider: 'plex',
            capability: 'media',
            displayName: 'Plex Media Server',
            adapter: () => Promise.resolve({ default: class PlexAdapter {} }),
          }
        })
        .mockResolvedValueOnce({
          default: {
            provider: 'openai',
            capability: 'ai',
            displayName: 'OpenAI',
            adapter: () => Promise.resolve({ default: class OpenAIAdapter {} }),
          }
        });

      await registry.discover();

      expect(registry.getProviders('media')).toContain('plex');
      expect(registry.getProviders('ai')).toContain('openai');
      expect(registry.getAllCapabilities()).toContain('media');
      expect(registry.getAllCapabilities()).toContain('ai');
    });
  });

  describe('getManifest()', () => {
    test('returns manifest for capability/provider pair', async () => {
      const registry = new AdapterRegistry();
      registry._glob = jest.fn().mockResolvedValue(['/fake/path/plex/manifest.mjs']);
      registry._import = jest.fn().mockResolvedValue({
        default: {
          provider: 'plex',
          capability: 'media',
          displayName: 'Plex Media Server',
          adapter: () => Promise.resolve({ default: class {} }),
        }
      });

      await registry.discover();

      const manifest = registry.getManifest('media', 'plex');
      expect(manifest.provider).toBe('plex');
      expect(manifest.displayName).toBe('Plex Media Server');
    });

    test('returns undefined for unknown capability/provider', async () => {
      const registry = new AdapterRegistry();
      registry._glob = jest.fn().mockResolvedValue([]);
      await registry.discover();

      expect(registry.getManifest('unknown', 'fake')).toBeUndefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/system/registries/AdapterRegistry.test.mjs -v`

Expected: FAIL with "Cannot find module"

**Step 3: Create directory structure**

```bash
mkdir -p backend/src/0_system/registries
mkdir -p tests/unit/suite/system/registries
```

**Step 4: Write minimal implementation**

```javascript
// backend/src/0_system/registries/AdapterRegistry.mjs
import { glob } from 'glob';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADAPTERS_ROOT = path.resolve(__dirname, '../../2_adapters');

/**
 * Discovers and indexes adapter manifests at startup.
 * Provides lookup by capability and provider.
 */
export class AdapterRegistry {
  #manifests = new Map();  // capability -> Map<provider, manifest>

  // Dependency injection points for testing
  _glob = (pattern) => glob(pattern, { absolute: true });
  _import = (path) => import(path);

  /**
   * Scan adapters directory for manifest files and index them.
   */
  async discover() {
    const pattern = path.join(ADAPTERS_ROOT, '**/manifest.mjs');
    const manifestPaths = await this._glob(pattern);

    for (const manifestPath of manifestPaths) {
      try {
        const { default: manifest } = await this._import(manifestPath);
        const { capability, provider } = manifest;

        if (!capability || !provider) {
          console.warn(`Invalid manifest at ${manifestPath}: missing capability or provider`);
          continue;
        }

        if (!this.#manifests.has(capability)) {
          this.#manifests.set(capability, new Map());
        }
        this.#manifests.get(capability).set(provider, manifest);
      } catch (err) {
        console.error(`Failed to load manifest at ${manifestPath}:`, err.message);
      }
    }
  }

  /**
   * Get manifest for a specific capability/provider pair.
   */
  getManifest(capability, provider) {
    return this.#manifests.get(capability)?.get(provider);
  }

  /**
   * Get all providers for a capability.
   */
  getProviders(capability) {
    const capMap = this.#manifests.get(capability);
    return capMap ? [...capMap.keys()] : [];
  }

  /**
   * Get all discovered capabilities.
   */
  getAllCapabilities() {
    return [...this.#manifests.keys()];
  }
}
```

**Step 5: Run test to verify it passes**

Run: `DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/system/registries/AdapterRegistry.test.mjs -v`

Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/0_system/registries/AdapterRegistry.mjs tests/unit/suite/system/registries/AdapterRegistry.test.mjs
git commit -m "feat(bootstrap): add AdapterRegistry for manifest discovery

Introduces AdapterRegistry class that scans backend/src/2_adapters/**/manifest.mjs
files at startup and indexes them by capability and provider. Supports lookup
by capability/provider pair and listing all providers per capability.

Part of config-driven bootstrap refactor.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 1.2: Create Plex Manifest (First Adapter Manifest)

**Files:**
- Create: `backend/src/2_adapters/content/media/plex/manifest.mjs`
- Test: `tests/unit/suite/adapters/content/media/plex/manifest.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/adapters/content/media/plex/manifest.test.mjs
import manifest from '#backend/src/2_adapters/content/media/plex/manifest.mjs';

describe('Plex Manifest', () => {
  test('has required fields', () => {
    expect(manifest.provider).toBe('plex');
    expect(manifest.capability).toBe('media');
    expect(manifest.displayName).toBe('Plex Media Server');
  });

  test('adapter factory returns PlexAdapter class', async () => {
    const { default: AdapterClass } = await manifest.adapter();
    expect(AdapterClass.name).toBe('PlexAdapter');
  });

  test('has config schema with required fields', () => {
    expect(manifest.configSchema.host.required).toBe(true);
    expect(manifest.configSchema.port.default).toBe(32400);
    expect(manifest.configSchema.token.secret).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/adapters/content/media/plex/manifest.test.mjs -v`

Expected: FAIL with "Cannot find module"

**Step 3: Create directory structure**

```bash
mkdir -p tests/unit/suite/adapters/content/media/plex
```

**Step 4: Write manifest**

```javascript
// backend/src/2_adapters/content/media/plex/manifest.mjs

export default {
  provider: 'plex',
  capability: 'media',
  displayName: 'Plex Media Server',

  adapter: () => import('./PlexAdapter.mjs'),

  configSchema: {
    host: { type: 'string', required: true, description: 'Plex server URL (e.g., http://192.168.1.100:32400)' },
    port: { type: 'number', default: 32400, description: 'Plex server port' },
    token: { type: 'string', secret: true, description: 'X-Plex-Token for authentication' },
  }
};
```

**Step 5: Run test to verify it passes**

Run: `DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/adapters/content/media/plex/manifest.test.mjs -v`

Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/2_adapters/content/media/plex/manifest.mjs tests/unit/suite/adapters/content/media/plex/manifest.test.mjs
git commit -m "feat(adapters): add Plex manifest for auto-discovery

First adapter manifest following the config-driven bootstrap pattern.
Declares provider, capability, displayName, adapter factory, and configSchema.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 1.3: Create Filesystem Manifest

**Files:**
- Create: `backend/src/2_adapters/content/media/filesystem/manifest.mjs`
- Test: `tests/unit/suite/adapters/content/media/filesystem/manifest.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/adapters/content/media/filesystem/manifest.test.mjs
import manifest from '#backend/src/2_adapters/content/media/filesystem/manifest.mjs';

describe('Filesystem Manifest', () => {
  test('has required fields', () => {
    expect(manifest.provider).toBe('filesystem');
    expect(manifest.capability).toBe('media');
    expect(manifest.displayName).toBe('Local Filesystem');
  });

  test('adapter factory returns FilesystemAdapter class', async () => {
    const { default: AdapterClass } = await manifest.adapter();
    expect(AdapterClass.name).toBe('FilesystemAdapter');
  });

  test('has config schema with basePath', () => {
    expect(manifest.configSchema.basePath.required).toBe(true);
    expect(manifest.configSchema.basePath.type).toBe('string');
  });

  test('is marked as implicit (always available)', () => {
    expect(manifest.implicit).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/adapters/content/media/filesystem/manifest.test.mjs -v`

Expected: FAIL

**Step 3: Create directory structure**

```bash
mkdir -p tests/unit/suite/adapters/content/media/filesystem
```

**Step 4: Write manifest**

```javascript
// backend/src/2_adapters/content/media/filesystem/manifest.mjs

export default {
  provider: 'filesystem',
  capability: 'media',
  displayName: 'Local Filesystem',

  // Filesystem is always implicitly available
  implicit: true,

  adapter: () => import('./FilesystemAdapter.mjs'),

  configSchema: {
    basePath: { type: 'string', required: true, description: 'Base path for media files' },
  }
};
```

**Step 5: Run test to verify it passes**

Run: `DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/adapters/content/media/filesystem/manifest.test.mjs -v`

Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/2_adapters/content/media/filesystem/manifest.mjs tests/unit/suite/adapters/content/media/filesystem/manifest.test.mjs
git commit -m "feat(adapters): add Filesystem manifest with implicit flag

Filesystem adapter is always implicitly available as fallback media source.
The implicit flag indicates it doesn't need explicit configuration.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 1.4: Create OpenAI and Anthropic Manifests

**Files:**
- Create: `backend/src/2_adapters/ai/openai/manifest.mjs`
- Create: `backend/src/2_adapters/ai/anthropic/manifest.mjs`
- Test: `tests/unit/suite/adapters/ai/manifests.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/adapters/ai/manifests.test.mjs
import openaiManifest from '#backend/src/2_adapters/ai/openai/manifest.mjs';
import anthropicManifest from '#backend/src/2_adapters/ai/anthropic/manifest.mjs';

describe('AI Provider Manifests', () => {
  describe('OpenAI', () => {
    test('has required fields', () => {
      expect(openaiManifest.provider).toBe('openai');
      expect(openaiManifest.capability).toBe('ai');
      expect(openaiManifest.displayName).toBe('OpenAI');
    });

    test('adapter factory returns OpenAIAdapter class', async () => {
      const { default: AdapterClass } = await openaiManifest.adapter();
      expect(AdapterClass.name).toBe('OpenAIAdapter');
    });

    test('has config schema with api_key as secret', () => {
      expect(openaiManifest.configSchema.api_key.secret).toBe(true);
      expect(openaiManifest.configSchema.api_key.required).toBe(true);
    });
  });

  describe('Anthropic', () => {
    test('has required fields', () => {
      expect(anthropicManifest.provider).toBe('anthropic');
      expect(anthropicManifest.capability).toBe('ai');
      expect(anthropicManifest.displayName).toBe('Anthropic');
    });

    test('adapter factory returns AnthropicAdapter class', async () => {
      const { default: AdapterClass } = await anthropicManifest.adapter();
      expect(AdapterClass.name).toBe('AnthropicAdapter');
    });

    test('has config schema with api_key as secret', () => {
      expect(anthropicManifest.configSchema.api_key.secret).toBe(true);
      expect(anthropicManifest.configSchema.api_key.required).toBe(true);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/adapters/ai/manifests.test.mjs -v`

Expected: FAIL

**Step 3: Write manifests**

```javascript
// backend/src/2_adapters/ai/openai/manifest.mjs

export default {
  provider: 'openai',
  capability: 'ai',
  displayName: 'OpenAI',

  adapter: () => import('../OpenAIAdapter.mjs'),

  configSchema: {
    api_key: { type: 'string', secret: true, required: true, description: 'OpenAI API key' },
    model: { type: 'string', default: 'gpt-4o', description: 'Model to use for completions' },
    max_tokens: { type: 'number', default: 4000, description: 'Maximum tokens in response' },
  }
};
```

```javascript
// backend/src/2_adapters/ai/anthropic/manifest.mjs

export default {
  provider: 'anthropic',
  capability: 'ai',
  displayName: 'Anthropic',

  adapter: () => import('../AnthropicAdapter.mjs'),

  configSchema: {
    api_key: { type: 'string', secret: true, required: true, description: 'Anthropic API key' },
    model: { type: 'string', default: 'claude-sonnet-4-20250514', description: 'Model to use for completions' },
    max_tokens: { type: 'number', default: 4000, description: 'Maximum tokens in response' },
  }
};
```

**Step 4: Create directories**

```bash
mkdir -p backend/src/2_adapters/ai/anthropic
```

**Step 5: Run test to verify it passes**

Run: `DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/adapters/ai/manifests.test.mjs -v`

Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/2_adapters/ai/openai/manifest.mjs backend/src/2_adapters/ai/anthropic/manifest.mjs tests/unit/suite/adapters/ai/manifests.test.mjs
git commit -m "feat(adapters): add OpenAI and Anthropic AI manifests

Both AI adapters declare api_key as secret/required and provide sensible
model defaults. Supports 1:N AI provider configuration per household.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 1.5: Create Home Assistant Manifest

**Files:**
- Create: `backend/src/2_adapters/home-automation/homeassistant/manifest.mjs`
- Test: `tests/unit/suite/adapters/home-automation/homeassistant/manifest.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/adapters/home-automation/homeassistant/manifest.test.mjs
import manifest from '#backend/src/2_adapters/home-automation/homeassistant/manifest.mjs';

describe('Home Assistant Manifest', () => {
  test('has required fields', () => {
    expect(manifest.provider).toBe('home_assistant');
    expect(manifest.capability).toBe('home_automation');
    expect(manifest.displayName).toBe('Home Assistant');
  });

  test('adapter factory returns HomeAssistantAdapter class', async () => {
    const { default: AdapterClass } = await manifest.adapter();
    expect(AdapterClass.name).toBe('HomeAssistantAdapter');
  });

  test('has config schema with host and token', () => {
    expect(manifest.configSchema.host.required).toBe(true);
    expect(manifest.configSchema.token.secret).toBe(true);
    expect(manifest.configSchema.token.required).toBe(true);
    expect(manifest.configSchema.port.default).toBe(8123);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/adapters/home-automation/homeassistant/manifest.test.mjs -v`

Expected: FAIL

**Step 3: Create directory**

```bash
mkdir -p tests/unit/suite/adapters/home-automation/homeassistant
```

**Step 4: Write manifest**

```javascript
// backend/src/2_adapters/home-automation/homeassistant/manifest.mjs

export default {
  provider: 'home_assistant',
  capability: 'home_automation',
  displayName: 'Home Assistant',

  adapter: () => import('./HomeAssistantAdapter.mjs'),

  configSchema: {
    host: { type: 'string', required: true, description: 'Home Assistant URL (e.g., http://192.168.1.50:8123)' },
    port: { type: 'number', default: 8123, description: 'Home Assistant port' },
    token: { type: 'string', secret: true, required: true, description: 'Long-lived access token' },
  }
};
```

**Step 5: Run test to verify it passes**

Run: `DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/adapters/home-automation/homeassistant/manifest.test.mjs -v`

Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/2_adapters/home-automation/homeassistant/manifest.mjs tests/unit/suite/adapters/home-automation/homeassistant/manifest.test.mjs
git commit -m "feat(adapters): add Home Assistant manifest

Home automation adapter with host and token (secret) configuration.
Supports 1:N home automation providers per household.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 2: Integration Loader

### Task 2.1: Create NoOp Adapter Factories

**Files:**
- Create: `backend/src/0_system/registries/noops/index.mjs`
- Test: `tests/unit/suite/system/registries/noops.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/system/registries/noops.test.mjs
import {
  createNoOpMediaAdapter,
  createNoOpAIGateway,
  createNoOpHomeAutomationGateway,
} from '#backend/src/0_system/registries/noops/index.mjs';

describe('NoOp Adapters', () => {
  describe('createNoOpMediaAdapter', () => {
    test('returns adapter with expected interface', () => {
      const adapter = createNoOpMediaAdapter();
      expect(adapter.sourceId).toBe('noop');
      expect(typeof adapter.list).toBe('function');
      expect(typeof adapter.getItem).toBe('function');
      expect(typeof adapter.search).toBe('function');
      expect(adapter.isAvailable()).toBe(false);
    });

    test('list returns empty array', async () => {
      const adapter = createNoOpMediaAdapter();
      expect(await adapter.list()).toEqual([]);
    });

    test('getItem returns null', async () => {
      const adapter = createNoOpMediaAdapter();
      expect(await adapter.getItem('any-id')).toBeNull();
    });
  });

  describe('createNoOpAIGateway', () => {
    test('returns gateway with expected interface', () => {
      const gateway = createNoOpAIGateway();
      expect(typeof gateway.chat).toBe('function');
      expect(gateway.isConfigured()).toBe(false);
    });

    test('chat throws error', async () => {
      const gateway = createNoOpAIGateway();
      await expect(gateway.chat({ messages: [] })).rejects.toThrow('AI provider not configured');
    });
  });

  describe('createNoOpHomeAutomationGateway', () => {
    test('returns gateway with expected interface', () => {
      const gateway = createNoOpHomeAutomationGateway();
      expect(typeof gateway.getState).toBe('function');
      expect(typeof gateway.callService).toBe('function');
      expect(gateway.isConnected()).toBe(false);
      expect(gateway.getProviderName()).toBe('noop');
    });

    test('getState returns null', async () => {
      const gateway = createNoOpHomeAutomationGateway();
      expect(await gateway.getState('any.entity')).toBeNull();
    });

    test('callService returns error result', async () => {
      const gateway = createNoOpHomeAutomationGateway();
      const result = await gateway.callService('domain', 'service', {});
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not configured');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/system/registries/noops.test.mjs -v`

Expected: FAIL

**Step 3: Create directory**

```bash
mkdir -p backend/src/0_system/registries/noops
mkdir -p tests/unit/suite/system/registries
```

**Step 4: Write implementation**

```javascript
// backend/src/0_system/registries/noops/index.mjs

/**
 * NoOp adapters for disabled/unconfigured capabilities.
 * Satisfy port interfaces with graceful degradation.
 */

export function createNoOpMediaAdapter() {
  return {
    sourceId: 'noop',

    async list() { return []; },
    async getItem() { return null; },
    async search() { return []; },

    isAvailable() { return false; },
  };
}

export function createNoOpAIGateway() {
  return {
    async chat() {
      throw new Error('AI provider not configured');
    },

    isConfigured() { return false; },
  };
}

export function createNoOpHomeAutomationGateway() {
  return {
    async getState() { return null; },

    async callService() {
      return { ok: false, error: 'Not configured' };
    },

    async activateScene() {
      return { ok: false, error: 'Not configured' };
    },

    isConnected() { return false; },
    getProviderName() { return 'noop'; },
  };
}

export function createNoOpMessagingGateway() {
  return {
    async sendMessage() {
      throw new Error('Messaging not configured');
    },

    isConfigured() { return false; },
  };
}

export function createNoOpFinanceAdapter() {
  return {
    async getTransactions() { return []; },
    async getAccounts() { return []; },

    isConfigured() { return false; },
  };
}
```

**Step 5: Run test to verify it passes**

Run: `DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/system/registries/noops.test.mjs -v`

Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/0_system/registries/noops/index.mjs tests/unit/suite/system/registries/noops.test.mjs
git commit -m "feat(bootstrap): add NoOp adapter factories for graceful degradation

Unconfigured capabilities return NoOp adapters that satisfy port interfaces
but return empty/null results. Allows apps to handle missing providers gracefully.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 2.2: Create IntegrationLoader

**Files:**
- Create: `backend/src/0_system/registries/IntegrationLoader.mjs`
- Test: `tests/unit/suite/system/registries/IntegrationLoader.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/system/registries/IntegrationLoader.test.mjs
import { jest } from '@jest/globals';
import { IntegrationLoader } from '#backend/src/0_system/registries/IntegrationLoader.mjs';

describe('IntegrationLoader', () => {
  let mockRegistry;
  let mockLogger;

  beforeEach(() => {
    mockRegistry = {
      getAllCapabilities: jest.fn().mockReturnValue(['media', 'ai']),
      getManifest: jest.fn(),
    };
    mockLogger = {
      warn: jest.fn(),
      info: jest.fn(),
    };
  });

  describe('loadForHousehold()', () => {
    test('loads adapters for configured providers', async () => {
      const MockAdapter = class TestAdapter {
        constructor(config) { this.config = config; }
      };

      mockRegistry.getManifest
        .mockReturnValueOnce({
          provider: 'plex',
          capability: 'media',
          adapter: () => Promise.resolve({ default: MockAdapter }),
        })
        .mockReturnValueOnce(undefined);  // ai not configured

      const loader = new IntegrationLoader({ registry: mockRegistry, logger: mockLogger });

      const householdConfig = {
        media: [{ provider: 'plex', host: 'http://localhost:32400' }],
        ai: [],  // Not configured
      };
      const authConfig = { plex: { token: 'test-token' } };

      const adapters = await loader.loadForHousehold('default', householdConfig, authConfig, {});

      expect(adapters.media).toBeDefined();
      expect(adapters.media.config.host).toBe('http://localhost:32400');
      expect(adapters.media.config.token).toBe('test-token');
    });

    test('returns NoOp adapter for unconfigured capabilities', async () => {
      mockRegistry.getManifest.mockReturnValue(undefined);

      const loader = new IntegrationLoader({ registry: mockRegistry, logger: mockLogger });

      const adapters = await loader.loadForHousehold('default', {}, {}, {});

      expect(adapters.media.isAvailable()).toBe(false);
      expect(adapters.ai.isConfigured()).toBe(false);
    });

    test('merges auth config with provider config', async () => {
      const MockAdapter = class TestAdapter {
        constructor(config) { this.config = config; }
      };

      mockRegistry.getManifest.mockReturnValue({
        provider: 'openai',
        capability: 'ai',
        adapter: () => Promise.resolve({ default: MockAdapter }),
      });

      const loader = new IntegrationLoader({ registry: mockRegistry, logger: mockLogger });

      const householdConfig = {
        ai: [{ provider: 'openai', model: 'gpt-4o' }],
      };
      const authConfig = { openai: { api_key: 'sk-secret' } };

      const adapters = await loader.loadForHousehold('default', householdConfig, authConfig, {});

      expect(adapters.ai.config.model).toBe('gpt-4o');
      expect(adapters.ai.config.api_key).toBe('sk-secret');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/system/registries/IntegrationLoader.test.mjs -v`

Expected: FAIL

**Step 3: Write implementation**

```javascript
// backend/src/0_system/registries/IntegrationLoader.mjs
import {
  createNoOpMediaAdapter,
  createNoOpAIGateway,
  createNoOpHomeAutomationGateway,
  createNoOpMessagingGateway,
  createNoOpFinanceAdapter,
} from './noops/index.mjs';

/**
 * Config-driven adapter loading with lazy imports.
 * Loads adapters for a household based on their integrations config.
 */
export class IntegrationLoader {
  #registry;
  #loadedAdapters = new Map();
  #logger;

  constructor({ registry, logger = console }) {
    this.#registry = registry;
    this.#logger = logger;
  }

  /**
   * Load integrations for a household based on their config.
   *
   * @param {string} householdId - Household identifier
   * @param {object} householdConfig - Household integrations config (capability -> provider[])
   * @param {object} authConfig - Auth credentials keyed by provider
   * @param {object} deps - Shared dependencies (httpClient, logger, etc.)
   * @returns {object} Adapters keyed by capability
   */
  async loadForHousehold(householdId, householdConfig, authConfig, deps) {
    const adapters = {};

    for (const capability of this.#registry.getAllCapabilities()) {
      const configs = householdConfig[capability];

      // null, empty, or missing = use NoOp adapter
      if (!configs || configs.length === 0) {
        adapters[capability] = this.#createNoOp(capability);
        continue;
      }

      // Load all configured providers for this capability
      adapters[capability] = await this.#loadMultiple(
        capability, configs, authConfig, deps
      );
    }

    this.#loadedAdapters.set(householdId, adapters);
    return adapters;
  }

  async #loadMultiple(capability, configs, auth, deps) {
    const adapters = [];

    for (const config of configs) {
      const provider = config.provider;

      // Get manifest from discovered registry
      const manifest = this.#registry.getManifest(capability, provider);
      if (!manifest) {
        this.#logger.warn?.('provider-not-discovered', { capability, provider });
        continue;
      }

      // Dynamic import from manifest
      const { default: AdapterClass } = await manifest.adapter();

      // Merge config with secrets from auth files
      const mergedConfig = {
        ...config,
        ...(auth[provider] || {}),
      };

      adapters.push({
        provider,
        adapter: new AdapterClass(mergedConfig, deps),
      });
    }

    if (adapters.length === 0) {
      return this.#createNoOp(capability);
    }

    // Return single adapter or wrap in MultiProviderAdapter
    return adapters.length === 1
      ? adapters[0].adapter
      : new MultiProviderAdapter(capability, adapters);
  }

  #createNoOp(capability) {
    const noOps = {
      media: createNoOpMediaAdapter(),
      ai: createNoOpAIGateway(),
      home_automation: createNoOpHomeAutomationGateway(),
      messaging: createNoOpMessagingGateway(),
      finance: createNoOpFinanceAdapter(),
    };
    return noOps[capability] || {};
  }

  /**
   * Get loaded adapters for a household.
   */
  getAdapters(householdId) {
    return this.#loadedAdapters.get(householdId);
  }
}

/**
 * Wrapper for multiple providers of the same capability.
 * Routes requests to appropriate provider based on key prefix.
 */
class MultiProviderAdapter {
  #capability;
  #adapters;  // Array of { provider, adapter }

  constructor(capability, adapters) {
    this.#capability = capability;
    this.#adapters = adapters;
  }

  /**
   * Get adapter for a specific provider.
   */
  getProvider(provider) {
    return this.#adapters.find(a => a.provider === provider)?.adapter;
  }

  /**
   * Get all adapters.
   */
  getAllProviders() {
    return this.#adapters;
  }

  /**
   * Get the primary (first) adapter.
   */
  getPrimary() {
    return this.#adapters[0]?.adapter;
  }

  isAvailable() {
    return this.#adapters.length > 0;
  }

  isConfigured() {
    return this.#adapters.length > 0;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/system/registries/IntegrationLoader.test.mjs -v`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/0_system/registries/IntegrationLoader.mjs tests/unit/suite/system/registries/IntegrationLoader.test.mjs
git commit -m "feat(bootstrap): add IntegrationLoader for config-driven adapter wiring

IntegrationLoader dynamically imports adapters based on household config.
Merges provider config with auth credentials and returns NoOp adapters for
unconfigured capabilities. Supports multiple providers per capability.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 3: Household Restructuring

### Task 3.1: Update ConfigLoader for Flat Household Discovery

**Files:**
- Modify: `backend/src/0_system/config/configLoader.mjs:167-183`
- Test: `tests/unit/suite/system/config/configLoader.test.mjs` (create)

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/system/config/configLoader.test.mjs
import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// We'll test the discovery logic in isolation
describe('Household Discovery', () => {
  describe('discoverHouseholds()', () => {
    test('discovers household/ as primary with id "default"', () => {
      // Create mock filesystem structure
      const mockDirs = ['household', 'household-jones', 'household-test'];

      const result = discoverHouseholds(mockDirs);

      expect(result.primary).toBe('default');
      expect(result.all).toContain('default');
      expect(result.all).toContain('jones');
      expect(result.all).toContain('test');
    });

    test('falls back to first alphabetically if no household/ exists', () => {
      const mockDirs = ['household-beta', 'household-alpha', 'household-gamma'];

      const result = discoverHouseholds(mockDirs);

      expect(result.primary).toBe('alpha');
    });

    test('maps folder names to household IDs', () => {
      expect(parseHouseholdId('household')).toBe('default');
      expect(parseHouseholdId('household-jones')).toBe('jones');
      expect(parseHouseholdId('household-test')).toBe('test');
    });

    test('maps household IDs to folder names', () => {
      expect(toFolderName('default')).toBe('household');
      expect(toFolderName('jones')).toBe('household-jones');
      expect(toFolderName('test')).toBe('household-test');
    });
  });
});

// Helper functions extracted for testing
function parseHouseholdId(folderName) {
  if (folderName === 'household') return 'default';
  return folderName.replace(/^household-/, '');
}

function toFolderName(householdId) {
  if (householdId === 'default') return 'household';
  return `household-${householdId}`;
}

function discoverHouseholds(dirs) {
  const all = dirs.map(d => parseHouseholdId(d));

  // Primary: 'household' if exists, else first alphabetically
  const hasPrimaryFolder = dirs.includes('household');
  const primary = hasPrimaryFolder
    ? 'default'
    : [...all].sort()[0];

  return {
    primary,
    all,
    secondary: all.filter(id => id !== primary),
  };
}
```

**Step 2: Run test to verify the logic is correct**

Run: `DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/system/config/configLoader.test.mjs -v`

Expected: PASS (this is testing the discovery logic in isolation first)

**Step 3: Update configLoader.mjs to support both old and new patterns**

Modify `loadAllHouseholds()` in `backend/src/0_system/config/configLoader.mjs`:

```javascript
// backend/src/0_system/config/configLoader.mjs
// Update the loadAllHouseholds function (around line 167)

function loadAllHouseholds(dataDir) {
  const households = {};

  // Try new flat structure first (household/, household-*/)
  const flatDirs = listHouseholdDirs(dataDir);

  if (flatDirs.length > 0) {
    for (const dir of flatDirs) {
      const householdId = parseHouseholdId(dir);
      const configPath = path.join(dataDir, dir, 'household.yml');
      const config = readYaml(configPath);
      if (config) {
        households[householdId] = {
          ...config,
          _folderName: dir,  // Store for path resolution
          apps: loadHouseholdApps(dataDir, dir),
        };
      }
    }
  } else {
    // Fall back to old nested structure (households/{id}/)
    const householdsDir = path.join(dataDir, 'households');
    for (const hid of listDirs(householdsDir)) {
      const configPath = path.join(householdsDir, hid, 'household.yml');
      const config = readYaml(configPath);
      if (config) {
        households[hid] = {
          ...config,
          _folderName: hid,
          _legacyPath: true,
          apps: loadHouseholdAppsLegacy(householdsDir, hid),
        };
      }
    }
  }

  return households;
}

function listHouseholdDirs(dataDir) {
  if (!fs.existsSync(dataDir)) return [];

  return fs.readdirSync(dataDir)
    .filter(name => {
      if (name.startsWith('.') || name.startsWith('_')) return false;
      if (!name.startsWith('household')) return false;
      return fs.statSync(path.join(dataDir, name)).isDirectory();
    });
}

function parseHouseholdId(folderName) {
  if (folderName === 'household') return 'default';
  return folderName.replace(/^household-/, '');
}

function toFolderName(householdId) {
  if (householdId === 'default') return 'household';
  return `household-${householdId}`;
}

// Update loadHouseholdApps to work with flat structure
function loadHouseholdApps(dataDir, folderName) {
  const appsDir = path.join(dataDir, folderName, 'apps');
  return loadAppsFromDir(appsDir);
}

// Keep old function for legacy path
function loadHouseholdAppsLegacy(householdsDir, hid) {
  const appsDir = path.join(householdsDir, hid, 'apps');
  return loadAppsFromDir(appsDir);
}

function loadAppsFromDir(appsDir) {
  const apps = {};

  // Load top-level YAML files in apps/
  for (const file of listYamlFiles(appsDir)) {
    const appName = path.basename(file, '.yml');
    const config = readYaml(file);
    if (config) {
      apps[appName] = config;
    }
  }

  // Load app subdirectories with config.yml
  for (const subdir of listDirs(appsDir)) {
    const configPath = path.join(appsDir, subdir, 'config.yml');
    const config = readYaml(configPath);
    if (config) {
      apps[subdir] = config;
    }
  }

  return apps;
}

// Export for testing
export { parseHouseholdId, toFolderName, listHouseholdDirs };
```

**Step 4: Commit**

```bash
git add backend/src/0_system/config/configLoader.mjs tests/unit/suite/system/config/configLoader.test.mjs
git commit -m "feat(config): support flat household directory structure

ConfigLoader now discovers households from household/ and household-*/ directories
with automatic ID mapping (household/ → default, household-jones/ → jones).
Falls back to legacy households/{id}/ structure if flat dirs not found.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 3.2: Update ConfigService Path Resolution

**Files:**
- Modify: `backend/src/0_system/config/ConfigService.mjs:93-138`
- Test: Add tests to existing ConfigService tests

**Step 1: Write the failing test**

```javascript
// Add to tests/unit/suite/system/config/ConfigService.test.mjs (or create)
describe('ConfigService household paths', () => {
  test('getHouseholdPath resolves flat structure', () => {
    const config = {
      system: { dataDir: '/data' },
      households: {
        default: { _folderName: 'household', name: 'Default' },
        jones: { _folderName: 'household-jones', name: 'Jones' },
      },
    };
    const service = new ConfigService(config);

    expect(service.getHouseholdPath('', 'default')).toBe('/data/household');
    expect(service.getHouseholdPath('', 'jones')).toBe('/data/household-jones');
    expect(service.getHouseholdPath('apps/fitness', 'default')).toBe('/data/household/apps/fitness');
  });

  test('getHouseholdPath resolves legacy structure', () => {
    const config = {
      system: { dataDir: '/data' },
      households: {
        default: { _folderName: 'default', _legacyPath: true, name: 'Default' },
      },
    };
    const service = new ConfigService(config);

    expect(service.getHouseholdPath('', 'default')).toBe('/data/households/default');
  });
});
```

**Step 2: Update ConfigService**

```javascript
// Update in backend/src/0_system/config/ConfigService.mjs

getHouseholdPath(relativePath, householdId = null) {
  const hid = householdId ?? this.#config.system.defaultHouseholdId ?? 'default';
  const household = this.#config.households[hid];

  if (!household) {
    throw new Error(`Household not found: ${hid}`);
  }

  const folderName = household._folderName || hid;
  const dataDir = this.#config.system.dataDir;

  // Legacy structure: data/households/{id}/
  if (household._legacyPath) {
    const basePath = path.join(dataDir, 'households', folderName);
    return relativePath ? path.join(basePath, relativePath) : basePath;
  }

  // New flat structure: data/household[-{id}]/
  const basePath = path.join(dataDir, folderName);
  return relativePath ? path.join(basePath, relativePath) : basePath;
}

householdExists(householdId) {
  return householdId in (this.#config.households || {});
}

getPrimaryHouseholdId() {
  return this.#config.system.defaultHouseholdId ?? 'default';
}

getAllHouseholdIds() {
  return Object.keys(this.#config.households || {});
}
```

**Step 3: Run tests**

Run: `DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/system/config/ -v`

Expected: PASS

**Step 4: Commit**

```bash
git add backend/src/0_system/config/ConfigService.mjs tests/unit/suite/system/config/
git commit -m "feat(config): update ConfigService for flat household paths

ConfigService.getHouseholdPath() now resolves paths based on _folderName
from household config. Supports both flat (household/) and legacy
(households/default/) structures transparently.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 3.3: Add Household Auth Loading for Flat Structure

**Files:**
- Modify: `backend/src/0_system/config/configLoader.mjs` (loadHouseholdAuth function)

**Step 1: Update loadHouseholdAuth**

```javascript
// Update in backend/src/0_system/config/configLoader.mjs

function loadHouseholdAuth(dataDir) {
  const auth = {};

  // Try new flat structure first
  const flatDirs = listHouseholdDirs(dataDir);

  if (flatDirs.length > 0) {
    for (const dir of flatDirs) {
      const householdId = parseHouseholdId(dir);
      const authDir = path.join(dataDir, dir, 'auth');
      if (!fs.existsSync(authDir)) continue;

      auth[householdId] = {};
      for (const file of listYamlFiles(authDir)) {
        const service = path.basename(file, '.yml');
        const creds = readYaml(file);
        if (creds) {
          auth[householdId][service] = creds;
        }
      }
    }
  } else {
    // Fall back to old nested structure
    const householdsDir = path.join(dataDir, 'households');
    for (const hid of listDirs(householdsDir)) {
      const authDir = path.join(householdsDir, hid, 'auth');
      if (!fs.existsSync(authDir)) continue;

      auth[hid] = {};
      for (const file of listYamlFiles(authDir)) {
        const service = path.basename(file, '.yml');
        const creds = readYaml(file);
        if (creds) {
          auth[hid][service] = creds;
        }
      }
    }
  }

  return auth;
}
```

**Step 2: Commit**

```bash
git add backend/src/0_system/config/configLoader.mjs
git commit -m "feat(config): update auth loading for flat household structure

loadHouseholdAuth() now discovers auth from household/auth/ and
household-*/auth/ directories, falling back to legacy households/{id}/auth/.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 4: Subdomain Routing

### Task 4.1: Create Household Resolver Middleware

**Files:**
- Create: `backend/src/4_api/middleware/householdResolver.mjs`
- Test: `tests/unit/suite/api/middleware/householdResolver.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/api/middleware/householdResolver.test.mjs
import { jest } from '@jest/globals';
import { householdResolver, matchPatterns } from '#backend/src/4_api/middleware/householdResolver.mjs';

describe('householdResolver middleware', () => {
  let mockConfigService;
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    mockConfigService = {
      householdExists: jest.fn().mockReturnValue(true),
      getHousehold: jest.fn().mockReturnValue({ name: 'Test Household' }),
    };
    mockReq = { headers: {} };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
  });

  describe('explicit domain mapping', () => {
    test('resolves household from explicit mapping', () => {
      const domainConfig = {
        domain_mapping: {
          'daylight.example.com': 'default',
          'daylight-jones.example.com': 'jones',
          'localhost:3112': 'default',
        },
        patterns: [],
      };

      const middleware = householdResolver({ domainConfig, configService: mockConfigService });
      mockReq.headers.host = 'daylight-jones.example.com';

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.householdId).toBe('jones');
      expect(mockNext).toHaveBeenCalled();
    });

    test('resolves localhost with port', () => {
      const domainConfig = {
        domain_mapping: { 'localhost:3112': 'default' },
        patterns: [],
      };

      const middleware = householdResolver({ domainConfig, configService: mockConfigService });
      mockReq.headers.host = 'localhost:3112';

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.householdId).toBe('default');
    });
  });

  describe('pattern matching', () => {
    test('matches daylight-{household}.example.com pattern', () => {
      const domainConfig = {
        domain_mapping: {},
        patterns: [
          { regex: '^daylight-(?<household>\\w+)\\.' },
        ],
      };

      const middleware = householdResolver({ domainConfig, configService: mockConfigService });
      mockReq.headers.host = 'daylight-smith.example.com';

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.householdId).toBe('smith');
    });

    test('matches {household}.daylight.example.com pattern', () => {
      const domainConfig = {
        domain_mapping: {},
        patterns: [
          { regex: '^(?<household>\\w+)\\.daylight\\.' },
        ],
      };

      const middleware = householdResolver({ domainConfig, configService: mockConfigService });
      mockReq.headers.host = 'jones.daylight.example.com';

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.householdId).toBe('jones');
    });
  });

  describe('fallback behavior', () => {
    test('falls back to default when no match', () => {
      const domainConfig = {
        domain_mapping: {},
        patterns: [],
      };

      const middleware = householdResolver({ domainConfig, configService: mockConfigService });
      mockReq.headers.host = 'unknown.domain.com';

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.householdId).toBe('default');
    });
  });

  describe('household validation', () => {
    test('returns 404 for non-existent household', () => {
      mockConfigService.householdExists.mockReturnValue(false);

      const domainConfig = {
        domain_mapping: { 'fake.example.com': 'nonexistent' },
        patterns: [],
      };

      const middleware = householdResolver({ domainConfig, configService: mockConfigService });
      mockReq.headers.host = 'fake.example.com';

      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Household not found',
        household: 'nonexistent',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});

describe('matchPatterns', () => {
  test('returns first matching household from patterns', () => {
    const patterns = [
      { regex: '^daylight-(?<household>\\w+)\\.' },
      { regex: '^(?<household>\\w+)\\.daylight\\.' },
    ];

    expect(matchPatterns('daylight-jones.example.com', patterns)).toBe('jones');
    expect(matchPatterns('smith.daylight.example.com', patterns)).toBe('smith');
    expect(matchPatterns('unknown.com', patterns)).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/api/middleware/householdResolver.test.mjs -v`

Expected: FAIL

**Step 3: Create directory**

```bash
mkdir -p backend/src/4_api/middleware
mkdir -p tests/unit/suite/api/middleware
```

**Step 4: Write implementation**

```javascript
// backend/src/4_api/middleware/householdResolver.mjs

/**
 * Middleware that resolves household from request host.
 * Uses explicit domain mapping first, then pattern matching, then default.
 */
export function householdResolver({ domainConfig, configService }) {
  const explicitMap = domainConfig.domain_mapping || {};
  const patterns = domainConfig.patterns || [];

  return (req, res, next) => {
    const host = req.headers.host || '';

    // 1. Check explicit mapping
    if (explicitMap[host]) {
      req.householdId = explicitMap[host];
    }
    // 2. Try pattern matching
    else {
      req.householdId = matchPatterns(host, patterns) || 'default';
    }

    // 3. Validate household exists
    if (!configService.householdExists(req.householdId)) {
      return res.status(404).json({
        error: 'Household not found',
        household: req.householdId,
      });
    }

    // 4. Attach household context
    req.household = configService.getHousehold?.(req.householdId);

    next();
  };
}

/**
 * Match host against regex patterns to extract household.
 */
export function matchPatterns(host, patterns) {
  for (const { regex } of patterns) {
    const match = host.match(new RegExp(regex));
    if (match?.groups?.household) {
      return match.groups.household;
    }
  }
  return null;
}
```

**Step 5: Run test to verify it passes**

Run: `DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/api/middleware/householdResolver.test.mjs -v`

Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/4_api/middleware/householdResolver.mjs tests/unit/suite/api/middleware/householdResolver.test.mjs
git commit -m "feat(api): add householdResolver middleware for subdomain routing

Resolves household from request host using:
1. Explicit domain mapping (highest priority)
2. Regex patterns with named capture groups
3. Fallback to 'default'

Returns 404 for non-existent households.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 4.2: Create Domain Config File

**Files:**
- Create: `backend/config/domains.yml`

**Step 1: Create config file**

```yaml
# backend/config/domains.yml
# Domain → household mapping for subdomain routing

domain_mapping:
  # Explicit mappings (checked first)
  "daylight.example.com": default
  "localhost:3111": default
  "localhost:3112": default
  # Add more explicit mappings as needed:
  # "daylight-jones.example.com": jones
  # "smithfamily.example.com": smith

# Fallback patterns (checked if no explicit match)
# Uses named capture group (?<household>...) to extract household ID
patterns:
  - regex: "^daylight-(?<household>\\w+)\\."
    # Matches: daylight-jones.example.com → jones
  - regex: "^(?<household>\\w+)\\.daylight\\."
    # Matches: jones.daylight.example.com → jones
```

**Step 2: Create directory**

```bash
mkdir -p backend/config
```

**Step 3: Commit**

```bash
git add backend/config/domains.yml
git commit -m "feat(config): add domain mapping config for subdomain routing

Configures explicit domain → household mappings and fallback regex patterns
for multi-household deployments with different subdomains.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 5: Integration & Migration Script

### Task 5.1: Create Migration Script

**Files:**
- Create: `scripts/migrate-households.sh`

**Step 1: Create script**

```bash
#!/bin/bash
# migrate-households.sh
# Safely migrate from households/ to flat household/ structure

set -e

DATA_PATH="${1:?Usage: migrate-households.sh <data-path>}"
cd "$DATA_PATH"

echo "=== Household Structure Migration ==="
echo "Data path: $DATA_PATH"
echo ""

# Check if already migrated
if [ -d "household" ] || ls -d household-* 2>/dev/null | grep -q .; then
  echo "⚠️  Flat structure already exists. Aborting to avoid data loss."
  echo "   Remove household/ and household-*/ directories first if you want to re-run."
  exit 1
fi

# Check for source data
if [ ! -d "households" ]; then
  echo "❌ No households/ directory found. Nothing to migrate."
  exit 1
fi

echo "Found households:"
ls -d households/*/ 2>/dev/null | while read dir; do
  echo "  - $(basename "$dir")"
done
echo ""

# Confirmation
read -p "Proceed with migration? (y/N) " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "=== Copying data (originals preserved) ==="

# Copy default household to new location
if [ -d "households/default" ]; then
  echo "Copying households/default → household/"
  cp -r households/default household
fi

# Copy secondary households
for dir in households/*/; do
  name=$(basename "$dir")
  if [ "$name" != "default" ] && [ "$name" != "example" ]; then
    echo "Copying households/$name → household-$name/"
    cp -r "$dir" "household-$name"
  fi
done

echo ""
echo "=== Migration complete ==="
echo ""
echo "New structure:"
ls -d household*/ 2>/dev/null || echo "  (none)"
echo ""
echo "Old 'households/' directory left intact."
echo "After verifying the new structure works, run:"
echo "  rm -rf $DATA_PATH/households/"
echo ""
```

**Step 2: Make executable and commit**

```bash
mkdir -p scripts
chmod +x scripts/migrate-households.sh
git add scripts/migrate-households.sh
git commit -m "feat(scripts): add household structure migration script

Safely copies households/{id}/ to flat household[-{id}]/ structure.
Preserves originals until deploy is verified.

Usage: ./scripts/migrate-households.sh /path/to/data

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 5.2: Create Index Exports for Registries

**Files:**
- Create: `backend/src/0_system/registries/index.mjs`

**Step 1: Create barrel export**

```javascript
// backend/src/0_system/registries/index.mjs

export { AdapterRegistry } from './AdapterRegistry.mjs';
export { IntegrationLoader } from './IntegrationLoader.mjs';
export * from './noops/index.mjs';
```

**Step 2: Commit**

```bash
git add backend/src/0_system/registries/index.mjs
git commit -m "chore(registries): add barrel export for registry modules

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 6: Verification

### Task 6.1: Run Full Test Suite

**Step 1: Run all tests**

```bash
DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/system/ tests/unit/suite/adapters/ -v
```

**Step 2: Verify no regressions**

Expected: All tests pass

---

### Task 6.2: Integration Test with Discovery

**Step 1: Create integration test**

```javascript
// tests/integration/suite/bootstrap/adapter-discovery.test.mjs
import { AdapterRegistry } from '#backend/src/0_system/registries/AdapterRegistry.mjs';

describe('Adapter Discovery Integration', () => {
  test('discovers all manifests in adapters directory', async () => {
    const registry = new AdapterRegistry();
    await registry.discover();

    // Verify expected adapters were discovered
    expect(registry.getProviders('media')).toContain('plex');
    expect(registry.getProviders('media')).toContain('filesystem');
    expect(registry.getProviders('ai')).toContain('openai');
    expect(registry.getProviders('ai')).toContain('anthropic');
    expect(registry.getProviders('home_automation')).toContain('home_assistant');
  });

  test('can load adapter from manifest', async () => {
    const registry = new AdapterRegistry();
    await registry.discover();

    const manifest = registry.getManifest('media', 'plex');
    const { default: PlexAdapter } = await manifest.adapter();

    expect(PlexAdapter.name).toBe('PlexAdapter');
  });
});
```

**Step 2: Run integration test**

```bash
DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/integration/suite/bootstrap/adapter-discovery.test.mjs -v
```

**Step 3: Commit**

```bash
git add tests/integration/suite/bootstrap/adapter-discovery.test.mjs
git commit -m "test(bootstrap): add integration test for adapter discovery

Verifies AdapterRegistry discovers all manifests and can load adapters.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

This plan implements config-driven bootstrap in 6 phases:

1. **Phase 1**: AdapterRegistry + manifests (5 tasks)
2. **Phase 2**: IntegrationLoader + NoOps (2 tasks)
3. **Phase 3**: Household restructuring (3 tasks)
4. **Phase 4**: Subdomain routing (2 tasks)
5. **Phase 5**: Migration + exports (2 tasks)
6. **Phase 6**: Verification (2 tasks)

**Total: 16 tasks, ~45 steps**

Each task follows TDD: write failing test → implement → verify → commit.

---

## Files Changed Summary

### New Files
- `backend/src/0_system/registries/AdapterRegistry.mjs`
- `backend/src/0_system/registries/IntegrationLoader.mjs`
- `backend/src/0_system/registries/noops/index.mjs`
- `backend/src/0_system/registries/index.mjs`
- `backend/src/2_adapters/content/media/plex/manifest.mjs`
- `backend/src/2_adapters/content/media/filesystem/manifest.mjs`
- `backend/src/2_adapters/ai/openai/manifest.mjs`
- `backend/src/2_adapters/ai/anthropic/manifest.mjs`
- `backend/src/2_adapters/home-automation/homeassistant/manifest.mjs`
- `backend/src/4_api/middleware/householdResolver.mjs`
- `backend/config/domains.yml`
- `scripts/migrate-households.sh`

### Modified Files
- `backend/src/0_system/config/configLoader.mjs`
- `backend/src/0_system/config/ConfigService.mjs`

### Test Files
- `tests/unit/suite/system/registries/AdapterRegistry.test.mjs`
- `tests/unit/suite/system/registries/IntegrationLoader.test.mjs`
- `tests/unit/suite/system/registries/noops.test.mjs`
- `tests/unit/suite/system/config/configLoader.test.mjs`
- `tests/unit/suite/adapters/content/media/plex/manifest.test.mjs`
- `tests/unit/suite/adapters/content/media/filesystem/manifest.test.mjs`
- `tests/unit/suite/adapters/ai/manifests.test.mjs`
- `tests/unit/suite/adapters/home-automation/homeassistant/manifest.test.mjs`
- `tests/unit/suite/api/middleware/householdResolver.test.mjs`
- `tests/integration/suite/bootstrap/adapter-discovery.test.mjs`
