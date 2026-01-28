# Config-Driven Bootstrap Design

**Date:** 2026-01-27
**Status:** Design
**Scope:** Refactor `bootstrap.mjs` to be config-driven for self-hosted flexibility

---

## Problem Statement

`backend/src/0_system/bootstrap.mjs` currently has hardcoded assumptions about implementations:
- ~160 lines of adapter imports at the top
- Provider-specific knowledge baked in (Plex, OpenAI, Telegram, etc.)
- Conditional wiring with `if (config.plex?.host)` patterns
- No way for self-hosted users to declare their own service stack

**Goal:** Users declare what services they have, and bootstrap wires adapters dynamically based on configuration.

---

## Design Principles

1. **Lazy loading** - Only import adapters that are configured
2. **Graceful degradation** - Unconfigured capabilities return NoOp adapters
3. **1:N cardinality** - All integration types support multiple providers
4. **Two-tier config** - System declares available, household declares used
5. **Implicit capabilities** - Domains discover sources from configured integrations

---

## Configuration Model

### Tier 1: Auto-Discovery via Manifests

Available integrations are **discovered at startup** by scanning `2_adapters/`. Each adapter folder contains a `manifest.mjs` declaring its metadata.

```javascript
// backend/src/2_adapters/content/media/plex/manifest.mjs
export default {
  provider: 'plex',
  capability: 'media',
  displayName: 'Plex Media Server',
  adapter: () => import('./PlexAdapter.mjs'),
  proxy: () => import('#adapters/proxy/PlexProxyAdapter.mjs'),  // optional
  configSchema: {
    host: { type: 'string', required: true },
    port: { type: 'number', default: 32400 },
    token: { type: 'string', secret: true },
  }
};
```

```javascript
// backend/src/2_adapters/ai/openai/manifest.mjs
export default {
  provider: 'openai',
  capability: 'ai',
  displayName: 'OpenAI',
  adapter: () => import('./OpenAIAdapter.mjs'),
  configSchema: {
    api_key: { type: 'string', secret: true, required: true },
    model: { type: 'string', default: 'gpt-4o' },
    max_tokens: { type: 'number', default: 4000 },
  }
};
```

```javascript
// backend/src/2_adapters/home-automation/homeassistant/manifest.mjs
export default {
  provider: 'home_assistant',
  capability: 'home_automation',
  displayName: 'Home Assistant',
  adapter: () => import('./HomeAssistantAdapter.mjs'),
  configSchema: {
    host: { type: 'string', required: true },
    port: { type: 'number', default: 8123 },
    token: { type: 'string', secret: true, required: true },
  }
};
```

**Discovery at startup:**
```javascript
// backend/src/0_system/AdapterDiscovery.mjs
export async function discoverAdapters() {
  const manifests = await glob('2_adapters/**/manifest.mjs');
  const available = { integrations: {}, applications: {} };

  for (const path of manifests) {
    const { default: manifest } = await import(path);
    const cap = manifest.capability;
    available.integrations[cap] = available.integrations[cap] || [];
    available.integrations[cap].push(manifest);
  }

  return available;
}
```

**No `system.yml` needed** - the codebase IS the source of truth for what's available.

### Tier 2: Household Configuration

Declares what each household **uses** from available integrations.

```yaml
# data/households/{hid}/household.yml

household_id: default
name: "Default Household"
head: kckern

users:
  - kckern
  - elizabeth
  - felix
  - milo

integrations:

  # ─── Media Sources (1:N) ───────────────────────────────────
  media:
    - provider: plex
      host: "192.168.1.100"
      port: 32400
    - provider: audiobookshelf
      host: "192.168.1.100"
      port: 13378
    - provider: immich
      host: "192.168.1.100"
      port: 2283

  # ─── AI Providers (1:N) ────────────────────────────────────
  ai:
    - provider: openai
      model: gpt-4o
      max_tokens: 4000
    - provider: anthropic
      model: claude-sonnet-4-20250514

  # ─── Home Automation (1:N) ─────────────────────────────────
  home_automation:
    - provider: home_assistant
      host: "192.168.1.50"
      port: 8123
    - provider: smartlife
      # for incompatible devices

  # ─── Messaging (1:N) ───────────────────────────────────────
  messaging:
    - provider: telegram
    - provider: discord

  # ─── Finance (1:N with user mapping) ───────────────────────
  finance:
    - provider: buxfer
      users: [kckern, elizabeth]
    - provider: ynab
      users: [felix, milo]

  # ─── Harvesters (1:N) ──────────────────────────────────────
  harvesters:
    - strava
    - withings
    - todoist
    - github

apps:
  fitness:
    enabled: true
    primary_users: [kckern, felix]
  nutribot:
    enabled: true
  journalist:
    enabled: false
  homebot:
    enabled: true
  gratitude:
    enabled: true
    categories: [gratitude, hopes]
```

### Tier 3: Auth Configuration (Existing Pattern)

Secrets stored separately per service.

```yaml
# data/households/{hid}/auth/plex.yml
token: "xxxxx"

# data/households/{hid}/auth/openai.yml
api_key: "sk-xxxxx"

# data/households/{hid}/auth/home_assistant.yml
token: "xxxxx"
```

---

## Architecture

### Conceptual Layers

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend Apps (TV, Fitness, Office)                        │
│  - Pure UI shells                                           │
│  - Consume backend APIs                                     │
│  - Adapt to what's available                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Backend Applications (nutribot, journalist, homebot)       │
│  - Orchestration logic                                      │
│  - Use capabilities via ports                               │
│  - Enabled per household                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Capabilities (media, lists, AI, messaging)                 │
│  - Domain services                                          │
│  - Discover sources from configured integrations            │
│  - Always deployed, powered by integrations                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Integrations (plex, openai, telegram, home_assistant)      │
│  - External service connections                             │
│  - Declared available at system level                       │
│  - Configured per household                                 │
└─────────────────────────────────────────────────────────────┘
```

### Media Key Prefixing

Media items use prefixed keys to identify their source:

| Key | Routes To |
|-----|-----------|
| `plex:545064` | PlexAdapter |
| `jfin:abc123` | JellyfinAdapter |
| `abs:audiobook-1` | AudiobookshelfAdapter |
| `immich:photo-456` | ImmichAdapter |
| `fs:clips/intro.mp4` | FilesystemAdapter |

**Smart cascade for media keys:**

Media has intelligent fallback since filesystem is always implicit:

```javascript
resolveMediaKey(key) {
  // 1. Explicit prefix always wins
  if (key.includes(':')) {
    const [prefix, id] = key.split(':', 2);
    return { provider: prefix, id };
  }

  // 2. All digits → assume Plex (Plex uses numeric IDs)
  if (/^\d+$/.test(key)) {
    return { provider: 'plex', id: key };
  }

  // 3. Otherwise → filesystem (path-like)
  return { provider: 'filesystem', id: key };
}
```

| Key | Resolved To | Why |
|-----|-------------|-----|
| `545064` | plex:545064 | Digits = Plex ID |
| `clips/intro` | fs:clips/intro | Path-like = filesystem |
| `plex:545064` | plex:545064 | Explicit prefix |
| `abs:book-1` | abs:book-1 | Explicit prefix |
| `immich:photo-456` | immich:photo-456 | Explicit prefix |

**Note:** Filesystem keys never include file extensions. The FilesystemAdapter deduces the actual file (`.mp4`, `.mkv`, `.mp3`, etc.) from the path.

**For other capabilities:** If only one provider is configured, prefix is optional. If multiple configured, explicit prefix required.

---

## Implementation

### Adapter Registry (Built from Discovery)

The registry is built dynamically from discovered manifests at startup:

```javascript
// backend/src/0_system/AdapterRegistry.mjs

export class AdapterRegistry {
  #manifests = new Map();  // capability -> provider -> manifest

  async discover() {
    const manifestPaths = await glob('#adapters/**/manifest.mjs');

    for (const path of manifestPaths) {
      const { default: manifest } = await import(path);
      const { capability, provider } = manifest;

      if (!this.#manifests.has(capability)) {
        this.#manifests.set(capability, new Map());
      }
      this.#manifests.get(capability).set(provider, manifest);
    }
  }

  getManifest(capability, provider) {
    return this.#manifests.get(capability)?.get(provider);
  }

  getProviders(capability) {
    return [...(this.#manifests.get(capability)?.keys() || [])];
  }

  getAllCapabilities() {
    return [...this.#manifests.keys()];
  }
}
```

### Integration Loader

Handles config-driven wiring with lazy loading.

```javascript
// backend/src/0_system/IntegrationLoader.mjs

export class IntegrationLoader {
  #registry;          // AdapterRegistry (discovered manifests)
  #loadedAdapters;
  #logger;

  constructor({ registry, logger }) {
    this.#registry = registry;
    this.#loadedAdapters = new Map();
    this.#logger = logger;
  }

  /**
   * Load integrations for a household
   */
  async loadForHousehold(householdId, householdConfig, authConfig, deps) {
    const adapters = {};

    for (const capability of this.#registry.getAllCapabilities()) {
      const configs = householdConfig[capability];

      // null, empty, or missing = disabled
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
        this.#logger.warn('provider-not-discovered', { capability, provider });
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

    // Return multi-adapter wrapper or single adapter
    return adapters.length === 1
      ? adapters[0].adapter
      : new MultiProviderAdapter(capability, adapters);
  }

  #createNoOp(capability) {
    // Return capability-specific NoOp
    const noOps = {
      media: createNoOpMediaAdapter(),
      ai: createNoOpAIGateway(),
      home_automation: createNoOpHomeAutomationGateway(),
      messaging: createNoOpMessagingGateway(),
      finance: createNoOpFinanceAdapter(),
    };
    return noOps[capability] || {};
  }
}
```

### Simplified bootstrap.mjs

Bootstrap becomes a thin orchestrator.

```javascript
// backend/src/0_system/bootstrap.mjs

import { AdapterRegistry } from './AdapterRegistry.mjs';
import { IntegrationLoader } from './IntegrationLoader.mjs';

// Domain services (not provider-specific)
import { ContentSourceRegistry } from '#domains/content/services/ContentSourceRegistry.mjs';
import { SessionService } from '#domains/fitness/services/SessionService.mjs';

// Router factories
import { createContentRouter } from '../4_api/v1/routers/content.mjs';
import { createFitnessRouter } from '../4_api/v1/routers/fitness.mjs';

// Singleton registry - discovered once at startup
let adapterRegistry = null;

async function getRegistry() {
  if (!adapterRegistry) {
    adapterRegistry = new AdapterRegistry();
    await adapterRegistry.discover();
  }
  return adapterRegistry;
}

/**
 * Bootstrap application for a household
 */
export async function bootstrapHousehold(householdId, { configService, httpClient, logger }) {
  const registry = await getRegistry();
  const householdConfig = configService.getHouseholdIntegrations(householdId);
  const authConfig = configService.getHouseholdAuth(householdId);

  const loader = new IntegrationLoader({ registry, logger });

  const adapters = await loader.loadForHousehold(
    householdId,
    householdConfig,
    authConfig,
    { httpClient, logger }
  );

  // Wire adapters to domain registries
  const contentRegistry = new ContentSourceRegistry();
  if (adapters.media) {
    contentRegistry.registerAll(adapters.media);
  }

  return {
    adapters,
    services: {
      contentRegistry,
    },
    routers: {
      content: createContentRouter(contentRegistry, ...),
    }
  };
}
```

### NoOp Adapters

Disabled capabilities return NoOp adapters satisfying port interfaces.

```javascript
// backend/src/0_system/registries/noops/index.mjs

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
  // Already exists in IHomeAutomationGateway.mjs
  return {
    async getState() { return null; },
    async callService() { return { ok: false, error: 'Not configured' }; },
    async activateScene() { return { ok: false, error: 'Not configured' }; },
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

---

## Initial Implementation Scope

**Phase 1:** Implement for 3 capabilities (proof of concept)
- `media` - Multiple providers, high visibility
- `ai` - Simple swap pattern
- `home_automation` - Already has NoOp pattern

**Phase 2:** Extend to remaining capabilities
- `messaging`
- `finance`
- `harvesters`

**Phase 3:** Migrate all bootstrap.mjs wiring to config-driven

---

## File Changes Summary

### New Files
- `backend/src/0_system/AdapterRegistry.mjs` - Discovers and indexes manifests
- `backend/src/0_system/IntegrationLoader.mjs` - Config-driven wiring
- `backend/src/0_system/noops/index.mjs` - NoOp adapter factories
- `backend/src/2_adapters/content/media/plex/manifest.mjs` - Plex manifest
- `backend/src/2_adapters/content/media/filesystem/manifest.mjs` - Filesystem manifest
- `backend/src/2_adapters/ai/openai/manifest.mjs` - OpenAI manifest
- `backend/src/2_adapters/ai/anthropic/manifest.mjs` - Anthropic manifest
- `backend/src/2_adapters/home-automation/homeassistant/manifest.mjs` - HA manifest
- *(manifest.mjs for each adapter)*

### Modified Files
- `data/households/{hid}/household.yml` - Add `integrations:` section
- `backend/src/0_system/bootstrap.mjs` - Simplify to use IntegrationLoader
- `backend/src/0_system/config/ConfigService.mjs` - Add `getHouseholdIntegrations()`

### Unchanged
- `data/households/{hid}/auth/*.yml` - Secrets stay in existing location
- All adapter implementations - No changes to adapter classes
- All port interfaces - No changes needed

### Removed
- No `system.yml` - availability is auto-discovered from manifests

---

## Validation

Bootstrap validates on startup:
1. Manifest discovery completes without errors
2. Household integrations reference only discovered providers
3. Required config fields present (per manifest `configSchema`)
4. Auth files exist for providers with `secret: true` fields

---

## Related Documents

- `docs/_wip/audits/2026-01-27-backend-ddd-adherence-audit.md` - Current architecture evaluation
- `docs/reference/core/layers-of-abstraction/ddd-reference.md` - DDD patterns reference
