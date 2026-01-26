# Adapter ConfigService Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate all 22 adapters in `backend/src/2_adapters/` from `process.env` to ConfigService, making ConfigService the true Single Source of Truth (SSOT).

**Architecture:**
- Add `getAdapterConfig(name)` method to ConfigService for adapter-specific config
- Create YAML schema for adapter configs in `data/system/adapters.yml`
- Update factory functions (`createXxxAdapter`) to use ConfigService instead of `process.env`
- Remove legacy io.mjs import from UserDataService

**Tech Stack:** Node.js ES Modules, ConfigService, YAML

---

## Summary

| Task | Description | Files Changed |
|------|-------------|---------------|
| 1 | Add adapter config support to ConfigService | 2 modify |
| 2 | Create adapter config YAML schema | 1 create |
| 3 | Fix UserDataService legacy import | 1 modify |
| 4 | Migrate proxy adapters (4 files) | 4 modify |
| 5 | Migrate hardware adapters (3 files) | 3 modify |
| 6 | Migrate harvester adapters (14 files) | 14 modify |
| 7 | Migrate content adapter (1 file) | 1 modify |
| 8 | Final verification | 0 |

---

## Task 1: Add Adapter Config Support to ConfigService

**Files:**
- Modify: `backend/src/0_infrastructure/config/ConfigService.mjs`
- Modify: `backend/src/0_infrastructure/config/configLoader.mjs`

**Step 1: Add getAdapterConfig method to ConfigService**

Add after line 104 in `ConfigService.mjs`:

```javascript
  // ─── Adapters ────────────────────────────────────────────

  /**
   * Get adapter configuration by name
   * @param {string} adapterName - Adapter identifier (plex, immich, mqtt, etc.)
   * @returns {object|null}
   */
  getAdapterConfig(adapterName) {
    return this.#config.adapters?.[adapterName] ?? null;
  }

  /**
   * Get all adapter configurations
   * @returns {object}
   */
  getAllAdapterConfigs() {
    return this.#config.adapters ?? {};
  }
```

**Step 2: Update configLoader to load adapters.yml**

In `configLoader.mjs`, add adapters loading in the `loadAllConfig` function after loading system config:

```javascript
// Load adapters config
const adaptersPath = path.join(dataDir, 'system', 'adapters.yml');
if (fs.existsSync(adaptersPath)) {
  const adaptersContent = fs.readFileSync(adaptersPath, 'utf8');
  config.adapters = yaml.load(adaptersContent) || {};
} else {
  config.adapters = {};
}
```

**Step 3: Run tests**

Run: `npm run test:unit -- --grep ConfigService`

Expected: Tests pass

**Step 4: Commit**

```bash
git add backend/src/0_infrastructure/config/ConfigService.mjs backend/src/0_infrastructure/config/configLoader.mjs
git commit -m "feat(config): add adapter config support to ConfigService

- Add getAdapterConfig(name) method
- Add getAllAdapterConfigs() method
- Load adapters.yml in configLoader"
```

---

## Task 2: Create Adapter Config YAML Schema

**Files:**
- Create: `data/system/adapters.yml`

**Step 1: Create adapters.yml with all adapter configs**

```yaml
# Adapter Configuration
# All external service connections are configured here.
# Secrets should be in secrets.yml, referenced by key name.

# ─── Proxy Adapters ─────────────────────────────────────────

plex:
  host: "${PLEX_HOST}"
  # token from secrets.yml

immich:
  host: "${IMMICH_HOST}"
  # apiKey from secrets.yml

freshrss:
  host: "${FRESHRSS_HOST}"
  # apiKey from secrets.yml

audiobookshelf:
  host: "${AUDIOBOOKSHELF_HOST}"
  # apiKey from secrets.yml

# ─── Hardware Adapters ──────────────────────────────────────

mqtt:
  host: "${MQTT_HOST}"
  port: 1883

thermal_printer:
  host: "${PRINTER_HOST}"
  port: 9100

tts:
  host: "${TTS_HOST}"
  port: 5002

# ─── Harvester Adapters ─────────────────────────────────────

strava:
  # OAuth credentials from secrets.yml
  redirect_uri: "${STRAVA_REDIRECT_URI}"

withings:
  # OAuth credentials from secrets.yml
  redirect_uri: "${WITHINGS_REDIRECT_URI}"

weather:
  api_url: "https://api.weather.gov"
  # No auth needed for weather.gov

clickup:
  api_url: "https://api.clickup.com/api/v2"
  # token from secrets.yml

github:
  api_url: "https://api.github.com"
  # token from secrets.yml

todoist:
  api_url: "https://api.todoist.com/rest/v2"
  # token from secrets.yml

foursquare:
  api_url: "https://api.foursquare.com/v2"
  # OAuth credentials from secrets.yml

goodreads:
  # RSS-based, no API key needed
  rss_base_url: "https://www.goodreads.com/review/list_rss"

lastfm:
  api_url: "http://ws.audioscrobbler.com/2.0/"
  # api_key from secrets.yml

letterboxd:
  # RSS-based, no API key needed
  rss_base_url: "https://letterboxd.com"

reddit:
  api_url: "https://oauth.reddit.com"
  # OAuth credentials from secrets.yml

gcal:
  # OAuth credentials from secrets.yml
  scopes:
    - "https://www.googleapis.com/auth/calendar.readonly"

gmail:
  # OAuth credentials from secrets.yml
  scopes:
    - "https://www.googleapis.com/auth/gmail.readonly"

shopping:
  # Configuration for shopping list harvester
  enabled: true
```

**Step 2: Verify file loads**

Run: `node -e "import('./backend/src/0_infrastructure/config/index.mjs').then(m => { m.initConfigService(process.env.DAYLIGHT_DATA_PATH); console.log('adapters:', Object.keys(m.configService.getAllAdapterConfigs())); })"`

Expected: Lists adapter names

**Step 3: Commit**

```bash
git add data/system/adapters.yml
git commit -m "feat(config): add adapter configuration YAML

All adapter configs centralized in adapters.yml.
Secrets remain in secrets.yml."
```

---

## Task 3: Fix UserDataService Legacy Import

**Files:**
- Modify: `backend/src/0_infrastructure/config/UserDataService.mjs`

**Step 1: Read current io.mjs to understand what functions are used**

The UserDataService uses `loadFile` and `saveFile` from `_legacy/lib/io.mjs`.

**Step 2: Create local YAML read/write functions**

Replace lines 14-19 in `UserDataService.mjs`:

Before:
```javascript
import { loadFile, saveFile } from '../../../_legacy/lib/io.mjs';
```

After:
```javascript
import yaml from 'js-yaml';

/**
 * Read YAML file and parse contents
 * @param {string} absolutePath - Full path to YAML file
 * @returns {object|null}
 */
const readYamlFile = (absolutePath) => {
  try {
    if (!fs.existsSync(absolutePath)) return null;
    const content = fs.readFileSync(absolutePath, 'utf8');
    return yaml.load(content) || null;
  } catch (err) {
    logger.warn('yaml.read.error', { path: absolutePath, error: err.message });
    return null;
  }
};

/**
 * Write data to YAML file with directory creation
 * @param {string} absolutePath - Full path to YAML file
 * @param {object} data - Data to write
 * @returns {boolean}
 */
const writeYamlFile = (absolutePath, data) => {
  try {
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const content = yaml.dump(data, { lineWidth: -1, quotingType: '"' });
    fs.writeFileSync(absolutePath, content, 'utf8');
    return true;
  } catch (err) {
    logger.error('yaml.write.error', { path: absolutePath, error: err.message });
    return false;
  }
};
```

**Step 3: Update readYaml and writeYaml helper functions**

Replace lines 28-59:

Before:
```javascript
const toRelativePath = (absolutePath) => { ... };
const readYaml = (absolutePath) => { ... };
const writeYaml = (absolutePath, data) => { ... };
```

After:
```javascript
/**
 * Read YAML file (handles extension normalization)
 */
const readYaml = (absolutePath) => {
  return readYamlFile(absolutePath);
};

/**
 * Write YAML file (handles extension normalization)
 */
const writeYaml = (absolutePath, data) => {
  return writeYamlFile(absolutePath, data);
};
```

**Step 4: Remove legacy readLegacyData that uses loadFile**

Update `readLegacyData` method (lines 507-519) to not use `loadFile`:

```javascript
readLegacyData(legacyPath, username = null) {
  // Try user-namespaced first if username provided
  if (username) {
    const userData = this.readUserData(username, legacyPath);
    if (userData !== null) {
      return userData;
    }
  }

  // Fall back to legacy path directly
  this.#ensureInitialized();
  let fullPath = path.join(this.#dataDir, legacyPath);
  if (!fullPath.match(/\.(ya?ml|json)$/)) {
    fullPath += '.yml';
  }
  return readYaml(fullPath);
}
```

**Step 5: Run tests**

Run: `npm run test:unit -- --grep UserDataService`

Expected: Tests pass

**Step 6: Commit**

```bash
git add backend/src/0_infrastructure/config/UserDataService.mjs
git commit -m "refactor(UserDataService): remove legacy io.mjs import

- Inline YAML read/write using js-yaml directly
- Remove dependency on _legacy/lib/io.mjs
- Simplify readLegacyData fallback"
```

---

## Task 4: Migrate Proxy Adapters

**Files:**
- Modify: `backend/src/2_adapters/proxy/PlexProxyAdapter.mjs`
- Modify: `backend/src/2_adapters/proxy/ImmichProxyAdapter.mjs`
- Modify: `backend/src/2_adapters/proxy/FreshRSSProxyAdapter.mjs`
- Modify: `backend/src/2_adapters/proxy/AudiobookshelfProxyAdapter.mjs`

**Step 1: Update PlexProxyAdapter factory function**

Replace lines 117-128:

Before:
```javascript
export function createPlexProxyAdapter(options = {}) {
  const host = process.env.plex?.host || process.env.PLEX_HOST;
  const token = process.env.plex?.token || process.env.PLEX_TOKEN;

  return new PlexProxyAdapter({ host, token }, options);
}
```

After:
```javascript
import { configService } from '../../0_infrastructure/config/index.mjs';

export function createPlexProxyAdapter(options = {}) {
  const adapterConfig = configService.getAdapterConfig('plex') || {};
  const host = adapterConfig.host;
  const token = configService.getSecret('PLEX_TOKEN');

  return new PlexProxyAdapter({ host, token }, options);
}
```

**Step 2: Update ImmichProxyAdapter factory function**

Replace lines 113-123:

Before:
```javascript
export function createImmichProxyAdapter(options = {}) {
  const host = process.env.immich?.host || process.env.IMMICH_HOST;
  const apiKey = process.env.immich?.apiKey || process.env.IMMICH_API_KEY;

  return new ImmichProxyAdapter({ host, apiKey }, options);
}
```

After:
```javascript
import { configService } from '../../0_infrastructure/config/index.mjs';

export function createImmichProxyAdapter(options = {}) {
  const adapterConfig = configService.getAdapterConfig('immich') || {};
  const host = adapterConfig.host;
  const apiKey = configService.getSecret('IMMICH_API_KEY');

  return new ImmichProxyAdapter({ host, apiKey }, options);
}
```

**Step 3: Update FreshRSSProxyAdapter factory function**

Same pattern - use `configService.getAdapterConfig('freshrss')` and `configService.getSecret('FRESHRSS_API_KEY')`.

**Step 4: Update AudiobookshelfProxyAdapter factory function**

Same pattern - use `configService.getAdapterConfig('audiobookshelf')` and `configService.getSecret('AUDIOBOOKSHELF_API_KEY')`.

**Step 5: Run tests**

Run: `npm run test:unit -- --grep ProxyAdapter`

Expected: Tests pass

**Step 6: Commit**

```bash
git add backend/src/2_adapters/proxy/
git commit -m "refactor(proxy): migrate all proxy adapters to ConfigService

- PlexProxyAdapter
- ImmichProxyAdapter
- FreshRSSProxyAdapter
- AudiobookshelfProxyAdapter

All now use configService.getAdapterConfig() and getSecret()."
```

---

## Task 5: Migrate Hardware Adapters

**Files:**
- Modify: `backend/src/2_adapters/hardware/mqtt-sensor/MQTTSensorAdapter.mjs`
- Modify: `backend/src/2_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs`
- Modify: `backend/src/2_adapters/hardware/tts/TTSAdapter.mjs`

**Step 1: Update MQTTSensorAdapter factory function**

Replace lines 413-419:

Before:
```javascript
export function createMQTTSensorAdapter(options = {}) {
  const mqttConfig = process.env.mqtt || {};
  const host = mqttConfig.host || process.env.MQTT_HOST;
  const port = mqttConfig.port || process.env.MQTT_PORT || 1883;

  return new MQTTSensorAdapter({ host, port }, options);
}
```

After:
```javascript
import { configService } from '../../../0_infrastructure/config/index.mjs';

export function createMQTTSensorAdapter(options = {}) {
  const adapterConfig = configService.getAdapterConfig('mqtt') || {};
  const host = adapterConfig.host;
  const port = adapterConfig.port || 1883;

  return new MQTTSensorAdapter({ host, port }, options);
}
```

**Step 2: Update ThermalPrinterAdapter factory function**

Same pattern - use `configService.getAdapterConfig('thermal_printer')`.

**Step 3: Update TTSAdapter factory function**

Same pattern - use `configService.getAdapterConfig('tts')`.

**Step 4: Run tests**

Run: `npm run test:unit -- --grep -E "(MQTT|Printer|TTS)"`

Expected: Tests pass

**Step 5: Commit**

```bash
git add backend/src/2_adapters/hardware/
git commit -m "refactor(hardware): migrate hardware adapters to ConfigService

- MQTTSensorAdapter
- ThermalPrinterAdapter
- TTSAdapter

All now use configService.getAdapterConfig()."
```

---

## Task 6: Migrate Harvester Adapters

**Files (14 total):**
- `backend/src/2_adapters/harvester/fitness/StravaHarvester.mjs`
- `backend/src/2_adapters/harvester/fitness/WithingsHarvester.mjs`
- `backend/src/2_adapters/harvester/other/WeatherHarvester.mjs`
- `backend/src/2_adapters/harvester/productivity/ClickUpHarvester.mjs`
- `backend/src/2_adapters/harvester/productivity/GitHubHarvester.mjs`
- `backend/src/2_adapters/harvester/productivity/TodoistHarvester.mjs`
- `backend/src/2_adapters/harvester/social/FoursquareHarvester.mjs`
- `backend/src/2_adapters/harvester/social/GoodreadsHarvester.mjs`
- `backend/src/2_adapters/harvester/social/LastfmHarvester.mjs`
- `backend/src/2_adapters/harvester/social/LetterboxdHarvester.mjs`
- `backend/src/2_adapters/harvester/social/RedditHarvester.mjs`
- `backend/src/2_adapters/harvester/communication/GCalHarvester.mjs`
- `backend/src/2_adapters/harvester/communication/GmailHarvester.mjs`
- `backend/src/2_adapters/harvester/finance/ShoppingHarvester.mjs`

**Pattern for each harvester:**

1. Find `process.env.TZ` usages → replace with `configService.getTimezone()`
2. Find `process.env.SERVICENAME_*` usages → replace with `configService.getSecret('SERVICENAME_*')` or `configService.getAdapterConfig('servicename')`
3. Add import: `import { configService } from '../../../0_infrastructure/config/index.mjs';`

**Step 1: Update StravaHarvester**

Lines 53 and 197-201 use `process.env`:

```javascript
// Line 53: timezone = process.env.TZ
timezone = configService.getTimezone(),

// Lines 197-201: reauthSequence
const clientId = configService.getSecret('STRAVA_CLIENT_ID');
const defaultRedirectUri = configService.getAdapterConfig('strava')?.redirect_uri ||
                           'http://localhost:3000/api/auth/strava/callback';
```

**Step 2-14: Repeat pattern for remaining harvesters**

Each harvester follows the same pattern. Key replacements:
- `process.env.TZ` → `configService.getTimezone()`
- `process.env.SERVICE_TOKEN` → `configService.getSecret('SERVICE_TOKEN')`
- `process.env.service?.config` → `configService.getAdapterConfig('service')?.config`

**Step 15: Run tests**

Run: `npm run test:unit -- --grep Harvester`

Expected: Tests pass

**Step 16: Commit**

```bash
git add backend/src/2_adapters/harvester/
git commit -m "refactor(harvesters): migrate all harvesters to ConfigService

14 harvesters updated:
- Fitness: Strava, Withings
- Productivity: ClickUp, GitHub, Todoist
- Social: Foursquare, Goodreads, Lastfm, Letterboxd, Reddit
- Communication: GCal, Gmail
- Finance: Shopping
- Other: Weather

All now use configService.getTimezone(), getSecret(), getAdapterConfig()."
```

---

## Task 7: Migrate Content Adapter

**Files:**
- Modify: `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs`

**Step 1: Find and replace process.env usages**

Add ConfigService import and replace any `process.env` references with ConfigService calls.

**Step 2: Run tests**

Run: `npm run test:unit -- --grep PlexAdapter`

Expected: Tests pass

**Step 3: Commit**

```bash
git add backend/src/2_adapters/content/media/plex/PlexAdapter.mjs
git commit -m "refactor(content): migrate PlexAdapter to ConfigService"
```

---

## Task 8: Final Verification

**Step 1: Verify no process.env in adapters (except allowed)**

Run: `grep -rn "process\.env\." backend/src/2_adapters/ --include="*.mjs" | grep -v "NODE_ENV\|DAYLIGHT"`

Expected: No matches (or only NODE_ENV/DAYLIGHT_ENV references)

**Step 2: Verify no _legacy imports in src/**

Run: `grep -rn "_legacy" backend/src/ --include="*.mjs" --include="*.js" | grep -v "node_modules"`

Expected: No matches

**Step 3: Run full test suite**

Run: `npm run test:integration`

Expected: Tests pass

**Step 4: Start server and verify adapters initialize**

Run: `node backend/index.js`

Check logs for adapter initialization messages.

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: adapter ConfigService migration complete

- All 22 adapters now use ConfigService
- UserDataService no longer imports from _legacy
- adapters.yml provides centralized adapter config
- ConfigService is now the true SSOT"
```

---

## Verification Checklist

After all tasks:

- [ ] `grep -rn "process\.env\." backend/src/2_adapters/` returns only NODE_ENV/DAYLIGHT references
- [ ] `grep -rn "_legacy" backend/src/` returns no matches
- [ ] `npm run test:unit` passes
- [ ] `npm run test:integration` passes
- [ ] Server starts with `node backend/index.js`
- [ ] No deprecation warnings in logs

## Follow-up Work (Out of Scope)

These remain for future cleanup:
- `backend/_legacy/` chatbots subsystem (separate migration)
- `backend/_legacy/lib/` remaining utilities
- Environment-specific adapter configs (dev vs prod)
