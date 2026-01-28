# Messaging Integration Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add messaging capability to the config-driven integration system, supporting system-level bots with household-level platform selection.

**Architecture:** Two-tier model where bots are registered at system level (one bot per app×platform), and households choose which platform(s) to use for each app. SystemBotLoader handles system-level bot creation, IntegrationLoader pattern extended for household platform preferences.

**Tech Stack:** Existing DDD config system, TelegramAdapter, ConfigService extensions

---

## Config Structure

### System-level bot registration (`system/bots.yml`)

```yaml
# Available bots - one per (app × platform)
nutribot:
  telegram:
    bot_id: "6898194425"
    webhook: https://daylightstation-api.kckern.net/nutribot/webhook

journalist:
  telegram:
    bot_id: "580626020"
    webhook: https://daylightstation-api.kckern.net/journalist/webhook

homebot:
  telegram:
    bot_id: "456789123"
    webhook: https://daylightstation-api.kckern.net/homebot/webhook
```

### System-level credentials (`system/auth/telegram.yml`)

```yaml
# Tokens keyed by app name
nutribot: "bot6898194425:ABC..."
journalist: "bot580626020:DEF..."
homebot: "bot456789123:GHI..."
```

### Household integration selection (`household/integrations.yml`)

```yaml
media:
  - provider: plex

home_automation:
  - provider: homeassistant

ai:
  - provider: openai

finance:
  - provider: buxfer

# NEW: Messaging platform preferences per app
messaging:
  nutribot:
    - platform: telegram
  journalist:
    - platform: telegram
  homebot:
    - platform: telegram
```

### User platform IDs (`data/users/{username}/profile.yml`)

```yaml
id: kckern
name: Kevin
email: kevin@example.com

# Platform identities for messaging
platform_ids:
  telegram: "575596036"
  # discord: "..." (future)

fitness:
  max_hr: 185
  # ...
```

---

## Code Structure

### New: SystemBotLoader (`backend/src/0_system/registries/SystemBotLoader.mjs`)

```javascript
export class SystemBotLoader {
  #configService;
  #bots = new Map();  // Map<"nutribot:telegram", TelegramAdapter>
  #logger;

  constructor({ configService, logger }) {
    this.#configService = configService;
    this.#logger = logger || console;
  }

  async loadBots(deps = {}) {
    const botDefs = this.#configService.getSystemConfig('bots');
    if (!botDefs) {
      this.#logger.debug?.('systemBotLoader.noBotConfig');
      return;
    }

    for (const [appName, platforms] of Object.entries(botDefs)) {
      for (const [platform, config] of Object.entries(platforms)) {
        const token = this.#configService.getSystemAuth(platform, appName);
        if (!token) {
          this.#logger.debug?.('systemBotLoader.noToken', { appName, platform });
          continue;
        }

        const adapter = await this.#createAdapter(platform, {
          ...config,
          token
        }, deps);

        this.#bots.set(`${appName}:${platform}`, adapter);
        this.#logger.info?.('systemBotLoader.loaded', { appName, platform });
      }
    }
  }

  getBot(appName, platform) {
    return this.#bots.get(`${appName}:${platform}`);
  }

  getBotForHousehold(householdId, appName) {
    const platform = this.#configService.getHouseholdMessagingPlatform(householdId, appName);
    return platform ? this.getBot(appName, platform) : null;
  }

  async #createAdapter(platform, config, deps) {
    if (platform === 'telegram') {
      const { TelegramAdapter } = await import('#adapters/messaging/TelegramAdapter.mjs');
      return new TelegramAdapter({
        token: config.token,
        httpClient: deps.httpClient,
        transcriptionService: deps.transcriptionService,
        logger: this.#logger
      });
    }
    // Future: discord, etc.
    throw new Error(`Unknown messaging platform: ${platform}`);
  }
}
```

### ConfigService additions

```javascript
// Read system/{name}.yml
getSystemConfig(name) {
  return this.#loadYaml(`system/${name}.yml`);
}

// Read system/auth/{platform}.yml[key]
getSystemAuth(platform, key) {
  const auth = this.#loadYaml(`system/auth/${platform}.yml`);
  return auth?.[key];
}

// Get household's messaging platform choice for an app
getHouseholdMessagingPlatform(householdId, appName) {
  const integrations = this.getHouseholdConfig(householdId, 'integrations');
  const appConfig = integrations?.messaging?.[appName];
  // Return first configured platform (or null)
  return appConfig?.[0]?.platform ?? null;
}
```

---

## Bootstrap Integration

### initializeIntegrations (extended)

```javascript
let systemBotLoaderInstance = null;

export async function initializeIntegrations(config) {
  const { configService, logger = console } = config;

  // Existing adapter registry
  if (!adapterRegistryInstance) {
    adapterRegistryInstance = new AdapterRegistry();
    await adapterRegistryInstance.discover();
  }

  // Existing household integration loader
  if (!integrationLoaderInstance) {
    integrationLoaderInstance = new IntegrationLoader({
      registry: adapterRegistryInstance,
      configService,
      logger
    });
  }

  // NEW: System bot loader
  if (!systemBotLoaderInstance) {
    systemBotLoaderInstance = new SystemBotLoader({
      configService,
      logger
    });
  }

  return {
    registry: adapterRegistryInstance,
    loader: integrationLoaderInstance,
    botLoader: systemBotLoaderInstance
  };
}

export async function loadSystemBots(deps = {}) {
  await systemBotLoaderInstance.loadBots(deps);
}

export function getMessagingAdapter(householdId, appName) {
  return systemBotLoaderInstance?.getBotForHousehold(householdId, appName);
}
```

---

## Wiring in app.mjs

### Current (hardcoded)

```javascript
const nutribotToken = configService.getSecret('TELEGRAM_NUTRIBOT_TOKEN');
const journalistToken = configService.getSecret('TELEGRAM_JOURNALIST_BOT_TOKEN');
// ... manually create each TelegramAdapter
```

### New (config-driven with fallback)

```javascript
// Initialize system bots
const { botLoader } = await initializeIntegrations({ configService, logger });
await loadSystemBots({
  httpClient: axios,
  transcriptionService: voiceTranscriptionService
});

// Get adapter for NutriBot (tries new config, falls back to legacy)
let nutribotAdapter = getMessagingAdapter(householdId, 'nutribot');
if (!nutribotAdapter) {
  // Fallback to legacy secrets.yml approach
  const token = configService.getSecret('TELEGRAM_NUTRIBOT_TOKEN');
  if (token) {
    nutribotAdapter = new TelegramAdapter({ token, httpClient: axios, ... });
  }
}

const nutribotServices = createNutribotServices({
  telegramAdapter: nutribotAdapter,
  // ...
});
```

---

## Webhook Handling

### Route with platform query param

```javascript
router.post('/nutribot/webhook', async (req, res) => {
  const platform = req.query.platform || 'telegram';  // default for backwards compat
  const adapter = systemBotLoader.getBot('nutribot', platform);

  if (!adapter) {
    return res.status(503).json({ error: 'Platform not configured' });
  }

  // ... handle webhook
});
```

### Webhook URLs

```
POST /nutribot/webhook?platform=telegram
POST /journalist/webhook?platform=telegram
POST /homebot/webhook?platform=telegram
```

Default to `telegram` for backwards compatibility with existing webhook registrations.

---

## User Identity Resolution

### UserResolver extensions

```javascript
// Build reverse index at startup
buildPlatformIndex() {
  // Scan data/users/*/profile.yml for platform_ids
  // Build: Map<"telegram:575596036", { username, householdId }>
}

// Resolve on webhook
resolveFromPlatform(platform, platformId) {
  return this.#platformIndex.get(`${platform}:${platformId}`);
  // Returns: { username: 'kckern', householdId: 'default' } or null
}
```

### Webhook flow

1. Webhook arrives with Telegram user ID `575596036`
2. `userResolver.resolveFromPlatform('telegram', '575596036')` → `{ username, householdId }`
3. `systemBotLoader.getBotForHousehold(householdId, 'nutribot')` → adapter
4. Process message with correct user context

Unknown users return null - bot handles gracefully.

---

## Migration Path

### Phase 1: Add new config files (additive)

- Create `system/bots.yml`
- Create `system/auth/telegram.yml`
- Add `messaging:` section to `household/integrations.yml`
- Add `platform_ids:` to user profiles
- Old files remain untouched

### Phase 2: Add SystemBotLoader (with fallback)

- Implement `SystemBotLoader.mjs`
- Add ConfigService methods
- Fallback to `secrets.yml` tokens if new config missing
- Wire into bootstrap alongside existing code

### Phase 3: Update app.mjs (graceful)

- Try SystemBotLoader first
- Fall back to existing hardcoded approach if not configured
- Both paths work simultaneously

### Phase 4: Post-deploy cleanup (deferred)

See: `docs/_wip/cleanup-post-messaging-migration.md`

---

## Post-Deploy Cleanup (DO NOT EXECUTE UNTIL PROD VERIFIED)

After successful production deployment and verification:

1. **Remove from `secrets.yml`:**
   - `TELEGRAM_NUTRIBOT_TOKEN`
   - `TELEGRAM_JOURNALIST_BOT_TOKEN`
   - `TELEGRAM_HOMEBOT_TOKEN`

2. **Delete files:**
   - `config/apps/chatbots.yml`
   - `config/apps/chatbots.example.yml`

3. **Remove fallback code:**
   - Legacy token lookups in `app.mjs`
   - Fallback adapter creation paths

4. **Update documentation:**
   - Remove references to old chatbots.yml structure
