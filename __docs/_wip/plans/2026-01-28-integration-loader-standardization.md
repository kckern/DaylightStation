# Integration Loader Standardization

**Date:** 2026-01-28
**Status:** Approved
**Branch:** refactor/ddd-migration

## Problem

The `IntegrationLoader` expects per-capability arrays but `integrations.yml` uses a different structure (per-service configs and per-app routing). This causes "integrations is not iterable" errors at startup, forcing fallback to hardcoded adapters.

## Goals

1. Dynamic adapter loading based on config (not hardcoded imports)
2. Per-app provider routing (nutribot→openai, journalist→anthropic)
3. Per-household configuration (household A uses telegram, household B uses discord)

## Config Schema

The `integrations.yml` structure stays as-is:

```yaml
# ─── Service Connections ───────────────────────────────
# Top-level keys matching known providers are service configs.
# Capability is inferred by convention.

plex:                          # capability: media
  port: 32400
  protocol: dash
  platform: Chrome

homeassistant:                 # capability: home_automation
  port: 8123

# ─── Per-App Provider Routing ──────────────────────────
# Keys matching capability names contain per-app mappings.

ai:                            # capability: ai
  nutribot:
    - provider: openai
  journalist:
    - provider: anthropic
  homebot:
    - provider: anthropic

messaging:                     # capability: messaging
  nutribot:
    - platform: telegram
  journalist:
    - platform: telegram
```

### Convention Mapping

| Provider | Capability |
|----------|------------|
| plex, jellyfin | media |
| homeassistant | home_automation |
| openai, anthropic | ai |
| telegram, discord | messaging |
| buxfer | finance |

## API Design

### Lookup API

```javascript
// Loading (at app startup)
const adapters = await loadHouseholdIntegrations({
  householdId: 'default',
  httpClient: axios,
  logger
});

// Capability only (non-app-specific)
const haAdapter = adapters.get('home_automation');
const mediaAdapter = adapters.get('media');

// Capability + app (per-app routing)
const nutribotAI = adapters.get('ai', 'nutribot');        // → OpenAI
const journalistAI = adapters.get('ai', 'journalist');    // → Anthropic

// Fallback behavior
adapters.get('ai');              // → Default AI adapter (first configured)
adapters.get('ai', 'unknown');   // → Default (no app-specific config)
adapters.get('finance');         // → NoOp (not configured)
```

### HouseholdAdapters Class

```javascript
class HouseholdAdapters {
  #adapters;    // capability → provider → adapter
  #appRouting;  // capability → app → provider
  #defaults;    // capability → default provider

  get(capability, appName = null) {
    const capAdapters = this.#adapters[capability];
    if (!capAdapters) return this.#createNoOp(capability);

    let provider;
    if (appName && this.#appRouting[capability]?.[appName]) {
      provider = this.#appRouting[capability][appName];
    } else {
      provider = this.#defaults[capability];
    }

    return capAdapters[provider] ?? this.#createNoOp(capability);
  }

  has(capability, appName = null) { /* ... */ }
  providers(capability) { /* ... */ }
}
```

## Internal Data Structure

```javascript
{
  adapters: {
    media: { plex: PlexAdapter },
    home_automation: { homeassistant: HomeAssistantAdapter },
    ai: { openai: OpenAIAdapter, anthropic: AnthropicAdapter },
    messaging: { telegram: TelegramAdapter }
  },
  appRouting: {
    ai: { nutribot: 'openai', journalist: 'anthropic', homebot: 'anthropic' },
    messaging: { nutribot: 'telegram', journalist: 'telegram' }
  },
  defaults: {
    media: 'plex',
    home_automation: 'homeassistant',
    ai: 'openai',
    messaging: 'telegram'
  }
}
```

## Config Parsing

```javascript
const PROVIDER_CAPABILITY_MAP = {
  plex: 'media',
  jellyfin: 'media',
  homeassistant: 'home_automation',
  openai: 'ai',
  anthropic: 'ai',
  telegram: 'messaging',
  discord: 'messaging',
  buxfer: 'finance',
};

const CAPABILITY_KEYS = ['ai', 'messaging', 'media', 'home_automation', 'finance'];

function parseIntegrationsConfig(config) {
  const services = {};
  const appRouting = {};

  for (const [key, value] of Object.entries(config)) {
    if (CAPABILITY_KEYS.includes(key)) {
      appRouting[key] = parseAppRouting(value);
    } else if (PROVIDER_CAPABILITY_MAP[key]) {
      services[key] = value;
    }
    // Unknown keys logged as warning
  }

  return { services, appRouting };
}
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| No `integrations.yml` | All capabilities return NoOp, log info |
| Unknown provider | Log warning, skip entry |
| App references unconfigured provider | Log warning, return NoOp |
| Adapter import fails | Log error, skip provider, continue |
| Empty capability section | No app routing, use default |

## Files to Change

| File | Changes |
|------|---------|
| `IntegrationLoader.mjs` | Major rewrite with new parsing and HouseholdAdapters class |
| `ConfigService.mjs` | Remove `getCapabilityIntegrations()` |
| `bootstrap.mjs` | Update `loadHouseholdIntegrations` return type |
| `app.mjs` | Update ~5 adapter lookups to use `.get(capability, app)` |

## Migration

Breaking change in `app.mjs`. Update from:
```javascript
householdAdapters?.ai ?? null
```
To:
```javascript
householdAdapters.get('ai', 'nutribot')
```
