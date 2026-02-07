# DaylightStation Configuration System: AS-IS Documentation

**Audit Date:** 2026-01-04

## Overview

This document maps the current state of configuration management in DaylightStation, documenting all config locations, formats, and patterns before suggesting improvements.

---

## 1. Physical Storage Locations

### 1.1 Development Environment

| Purpose | Path | Notes |
|---------|------|-------|
| **Local Dropbox (Primary Dev)** | `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/` | Synced via Dropbox, contains `data/` and `media/` |
| **Mounted NAS (Legacy)** | `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation` | SMB mount to homeserver, contains `config/`, `data/`, `media/` |
| **Remote Server** | `ssh homeserver.local:/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/` | Production data location |

**Current Issue:** Local Dropbox only contains `data/` and `media/`. The `config/` directory is only on the NAS mount, which is less reliable from macOS.

### 1.2 Docker Mount Points

```
Container Path              -> Host Path (prod)
/usr/src/app/data           -> /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data
/usr/src/app/media          -> /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media
/usr/src/app/config         -> /media/kckern/DockerDrive/Docker/DaylightStation/config
```

---

## 2. Configuration Tiers

### Tier 1: System Configuration
**Location:** `config/system.yml`
**Purpose:** Infrastructure, paths, network, hardware, external services

```yaml
# Key sections:
households:
  default: default

paths:
  data: /usr/src/app/data
  media: /usr/src/app/media
  img: /usr/src/app/data/img
  font: /usr/src/app/data/fonts
  icons: /usr/src/app/data/img/icons
  cache: /usr/src/app/data/cache

network:
  api_host: localhost
  api_port: 3112
  websocket_port: 3113

location:
  lat: 47.40946334059118
  lng: -122.16930726320584
  timezone: America/Los_Angeles

services:
  printer: { host: 10.0.0.50, port: 9100 }
  tv: { host: 10.0.0.11, ... }
  home_assistant: { host: https://home.kckern.net }
  scripture_guide: { host: scripture.guide, ... }
  memos: { uri: https://notes.kckern.net }
```

### Tier 2: Legacy System Configuration
**Location:** `config/config.app.yml` + `config/config.secrets.yml` + `config/config.app-local.yml`
**Purpose:** Original flat configuration (being phased out)

**Load Order:** `config.app.yml` -> `config.secrets.yml` -> `config.app-local.yml` (each overrides previous)

**Contents overlap with system.yml:**
- `path.*` - Duplicated from system.yml
- `weather.*` - Location data
- `chatbots.*` - Bot configs (now in apps/chatbots.yml)
- Various service configs

### Tier 3: App Configuration
**Location:** `config/apps/{appname}.yml`
**Purpose:** Per-application defaults and settings

**Current apps:**
| File | Purpose |
|------|---------|
| `chatbots.yml` | Bot definitions, identity mappings, data paths |
| `fitness.yml` | HR zones, ANT+ devices, gamification, session settings |
| `entropy.yml` | Data freshness tracking sources and thresholds |
| `finance.yml` | Financial app config |
| `gratitude.yml` | Gratitude app settings |
| `media.yml` | Media/Plex configuration |
| `storybook.yml` | Empty placeholder |

### Tier 4: Household Configuration
**Location:** `data/households/{householdId}/household.yml`
**Purpose:** Multi-user household settings

```yaml
# data/households/default/household.yml
version: "1.0"
household_id: default
name: "Default Household"
head: kckern

users:
  - kckern
  - elizabeth
  - felix
  - milo
  - alan
  - soren

apps:
  fitness:
    primary_users: [kckern, felix, milo, alan, soren]
  gratitude:
    enabled_categories: [gratitude, hopes]
```

### Tier 5: Household App Runtime Config
**Location:** `data/households/{householdId}/apps/{appname}/config.yml`
**Purpose:** Runtime app config that varies per household

**Example:** `data/households/default/apps/fitness/config.yml`
- Plex library settings
- Navigation items
- Music playlists
- Device mappings
- Guest/family lists

### Tier 6: User Profile
**Location:** `data/users/{username}/profile.yml`
**Purpose:** Individual user settings, goals, app overrides

```yaml
# data/users/kckern/profile.yml
version: "1.0"
username: kckern
household_id: default
display_name: "KC Kern"
birthyear: 1984
type: owner

identities:
  telegram:
    user_id: "575596036"
    default_bot: nutribot

preferences:
  timezone: America/Los_Angeles
  units: imperial

apps:
  nutribot:
    goals: { calories: 1600, protein: 150, ... }
  entropy:
    sources: { ... }  # User-specific tracking sources
```

---

## 3. Data Directory Structure

### 3.1 Users Directory
```
data/users/{username}/
├── profile.yml              # User profile (Tier 6)
├── auth/                    # OAuth tokens per service
│   ├── strava.yml
│   ├── withings.yml
│   ├── github.yml
│   ├── lastfm.yml
│   ├── foursquare.yml
│   ├── garmin.yml
│   ├── google.yml
│   └── ...
├── current/                 # Real-time/active state
│   ├── calendar.yml
│   ├── clickup.yml
│   ├── gmail.yml
│   └── todoist.yml
├── lifelog/                 # Historical life data
│   ├── strava.yml           # Hot storage (recent)
│   ├── fitness.yml
│   ├── lastfm.yml
│   ├── github.yml
│   ├── goodreads.yml
│   ├── letterboxd.yml
│   ├── checkins.yml
│   ├── weight.yml
│   ├── nutrition/           # Nutribot data
│   │   ├── nutrilog.yml
│   │   ├── nutrilist.yml
│   │   ├── nutricursor.yml
│   │   └── archives/
│   ├── archives/            # Cold storage
│   │   ├── strava/          # Per-activity files
│   │   ├── lastfm/2025.yml
│   │   ├── fitness/2025.yml
│   │   └── ...
│   └── journalist/          # Journal entries
└── ai/                      # AI/bot customizations
    ├── journalist/prompts.yml
    └── nutribot/prompts.yml
```

### 3.2 Households Directory
```
data/households/{householdId}/
├── household.yml            # Household config (Tier 4)
├── apps/
│   ├── finances/
│   │   ├── finances.yml     # Transactions
│   │   ├── budget.config.yml
│   │   ├── mortgage.transactions.yml
│   │   ├── payroll.yml
│   │   └── {year}/transactions.yml
│   └── fitness/
│       ├── config.yml       # Runtime config (Tier 5)
│       └── sessions/{date}/ # Workout sessions
├── common/                  # Shared household data
│   └── gratitude/
├── auth/                    # Household-level auth
└── history/                 # Household history
```

### 3.3 State Directory
```
data/state/
├── cron.yml                 # Cron job state
├── keyboard.yml             # Keyboard state
├── lists.yml                # Various lists
├── media_config.yml         # Media config cache
├── nav.yml                  # Navigation state
├── watchlist.yml            # Watch list data
├── weather.yml              # Weather cache
└── youtube.yml              # YouTube state
```

### 3.4 Content Directory
```
data/content/
├── scripture/               # Scripture data
├── poetry/remedy/           # Poetry content
├── songs/                   # Song lyrics
├── talks/                   # Conference talks
├── plex/                    # Plex metadata cache
├── households/{hid}/common/ # Household shared content
└── users/{username}/        # User content
```

---

## 4. Configuration Loading Architecture

### 4.1 Key Files

| File | Purpose |
|------|---------|
| `backend/lib/config/ConfigService.mjs` | Unified config singleton |
| `backend/lib/config/loader.mjs` | Config file loading & merging |
| `backend/lib/config/pathResolver.mjs` | Resolves paths from env vars |
| `backend/lib/config/UserDataService.mjs` | User-namespaced data ops |
| `backend/lib/config/UserService.mjs` | User profile resolution |
| `backend/lib/io.mjs` | Legacy YAML I/O (deprecating) |
| `backend/index.js` | Main entry, populates process.env |

### 4.2 Initialization Flow

```
1. pathResolver.resolveConfigPaths()
   └── Determines configDir, dataDir from:
       - DAYLIGHT_CONFIG_PATH env var
       - DAYLIGHT_DATA_PATH env var
       - Docker detection
       - Fallback paths

2. loader.loadAllConfig(options)
   └── Merges (lowest to highest priority):
       config.app.yml
       config/system.yml
       config/apps/*.yml
       config.secrets.yml
       config.app-local.yml
       Resolved path overrides

3. ConfigService.init(baseDir)
   └── Loads and caches:
       - Legacy configs
       - System config
       - App configs
       - User profiles (on demand)
       - Household configs (on demand)

4. process.env = { ...process.env, ...mergedConfig }
   └── Spreads config into process.env namespace
       e.g., process.env.path.data
```

### 4.3 Config Access Patterns

**Modern (Preferred):**
```javascript
import { configService } from '../lib/config/ConfigService.mjs';

configService.getSystem('paths.data');
configService.getAppConfig('fitness', 'zones');
configService.getUserProfile('kckern');
configService.getHouseholdConfig('default');
configService.resolveUsername('telegram', '575596036');
```

**Legacy (Deprecating):**
```javascript
import { loadFile, saveFile } from './lib/io.mjs';

loadFile('state/cron');
loadFile('households/default/apps/fitness/config');
```

**Direct process.env (Anti-pattern but widespread):**
```javascript
process.env.path.data
process.env.path.media
process.env.TELEGRAM_TOKEN
```

---

## 5. Archive/Rotation System

**Config:** `config/archive.yml`

### 5.1 Patterns

| Pattern | Services | Hot Path | Cold Path |
|---------|----------|----------|-----------|
| `time-based` | lastfm, goodreads, garmin, fitness, nutrilog, nutrilist | `lifelog/{service}.yml` | `lifelog/archives/{service}/{year}.yml` |
| `summary-detail` | strava | `lifelog/strava.yml` (index) | `lifelog/archives/strava/{activityId}.yml` |

### 5.2 Key Settings per Service

```yaml
services:
  lastfm:
    pattern: time-based
    retentionDays: 90
    archiveGranularity: yearly
    timestampField: timestamp

  strava:
    pattern: summary-detail
    archiveGranularity: per-item
    summaryFields: [id, title, type, startTime, ...]

  nutrilog:
    pattern: time-based
    retentionDays: 30
    archiveGranularity: monthly
    basePath: nutrition  # Special: stored in nutrition/ not lifelog/
```

---

## 6. Identity Mapping

Platform IDs are resolved to internal usernames via multiple sources:

### 6.1 Chatbots Identity Mapping
**Location:** `config/apps/chatbots.yml`
```yaml
identity_mappings:
  telegram:
    "575596036": kckern
```

### 6.2 User Profile Identities
**Location:** `data/users/{username}/profile.yml`
```yaml
identities:
  telegram:
    user_id: "575596036"
    default_bot: nutribot
```

### 6.3 Legacy Fallback
**Location:** `config/config.app.yml`
```yaml
chatbots:
  users:
    kckern:
      telegram_user_id: 575596036
```

---

## 7. Known Issues & Technical Debt

### 7.1 Hardcoded Paths (High Severity)

| File | Issue |
|------|-------|
| `backend/lib/io.mjs` | 7+ direct `process.env.path.*` accesses |
| `backend/routers/fetch.mjs` | Module-level `const dataPath = process.env.path.data` |
| `backend/routers/media.mjs` | Module-level path constants |
| `backend/lib/budget.mjs` | Module-level `dataPath` constant |
| `backend/lib/ArchiveService.mjs` | Hardcoded fallback: `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStationconfig` |

### 7.2 Direct YAML Loading (Bypassing ConfigService)

| File | Pattern |
|------|---------|
| `backend/lib/buxfer.mjs` | `yaml.load(readFileSync(...))` |
| `backend/lib/budget.mjs` | Multiple direct YAML loads |
| `backend/jobs/finance/payroll.mjs` | Direct YAML for secrets/config |

### 7.3 Duplicate Configuration

- `path.*` exists in both `system.yml` and `config.app.yml`
- Chatbot configs in both `chatbots.yml` and `config.app.yml`
- Location data in `system.yml.location` and `config.app.yml.weather`

### 7.4 Module-Level Constants (Early Init Problem)

```javascript
// These run before ConfigService is initialized
const dataPath = `${process.env.path.data}`;  // budget.mjs, fetch.mjs, media.mjs
```

### 7.5 Missing Data in Local Dropbox

The local Dropbox sync (`~/Library/CloudStorage/Dropbox/Apps/DaylightStation/`) only contains:
- `data/` (synced)
- `media/` (synced)

But **missing**:
- `config/` - Only exists on NAS mount

---

## 8. Migration Status

From `config/README.md`:

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | Complete | New structure created (templates + local instance) |
| 2 | Pending | Data migration to new locations |
| 3 | In Progress | Code updated to use new ConfigService |
| 4 | Pending | Legacy `config.app.yml` removed |

---

## 9. Environment Variables

### 9.1 Path Resolution
- `DAYLIGHT_CONFIG_PATH` - Config directory path
- `DAYLIGHT_DATA_PATH` - Data directory path
- `DAYLIGHT_NAS_MOUNT` - NAS mount point
- `DAYLIGHT_SMB_SHARE` - SMB share for auto-mount

### 9.2 Secrets (Direct env access)
```
OPENAI_API_KEY, PLEX_TOKEN, TELEGRAM_*_TOKEN, LOGGLY_TOKEN,
STRAVA_ACCESS_TOKEN, GOOGLE_REFRESH_TOKEN, TODOIST_KEY,
FOURSQUARE_TOKEN, LAST_FM_USER, BUXFER_TOKEN, HOME_ASSISTANT_TOKEN
```

### 9.3 Runtime Config
- `NODE_ENV` - Environment (dev/prod)
- `PORT` - Server port
- `TZ` / `TIMEZONE` - Timezone
- `HOUSEHOLD_ID` - Override default household

---

## 10. File Inventory by Location

### In Codebase (Templates Only)
```
config/
├── system.example.yml
├── secrets.example.yml
├── logging.yml
├── logging.production.yml
├── logging.development.example.yml
└── apps/
    ├── chatbots.example.yml
    ├── fitness.example.yml
    ├── gratitude.example.yml
    ├── finance.example.yml
    ├── media.example.yml
    └── _schemas/
```

### On NAS Mount / Production
```
config/
├── system.yml              # Actual system config
├── config.app.yml          # Legacy config
├── config.secrets.yml      # Secrets
├── config.app-local.yml    # Local overrides (dev only)
├── archive.yml             # Archive rotation
├── logging.yml             # Logging config
└── apps/
    ├── chatbots.yml
    ├── entropy.yml
    ├── finance.yml
    ├── fitness.yml
    ├── gratitude.yml
    ├── media.yml
    └── storybook.yml
```

---

## Summary

The current configuration system is in a transitional state:

1. **Three-tier hierarchy is defined** (system → household → user) but not fully implemented
2. **ConfigService exists** but many files bypass it with direct process.env access
3. **Legacy config.app.yml** still contains duplicate data that should be in system.yml/apps/*.yml
4. **io.mjs** is being deprecated but still handles most YAML I/O
5. **Identity mapping** exists in 3+ places
6. **Local dev** lacks config sync (only data/media via Dropbox)
7. **Module-level constants** break the ConfigService initialization model

The next step would be to prioritize consolidation and complete the migration to ConfigService.

---

## 11. Design for Improvement

### 11.1 Design Principles

#### Separation of Concerns (Validated)
The current 6-tier hierarchy is sound:
```
System → Household → User → App (per-tier)
```

However, we need to add an **environment dimension**:
```
                    ┌─────────────────────────────────────────┐
                    │           Environment Layer             │
                    │  (dev / prod / test / new-deployment)   │
                    └─────────────────────────────────────────┘
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        ▼                              ▼                              ▼
   ┌─────────┐                  ┌─────────────┐                ┌───────────┐
   │ System  │                  │  Household  │                │   User    │
   │ Config  │                  │   Config    │                │  Profile  │
   └────┬────┘                  └──────┬──────┘                └─────┬─────┘
        │                              │                             │
        ▼                              ▼                             ▼
   ┌─────────┐                  ┌─────────────┐                ┌───────────┐
   │  Apps   │                  │  Household  │                │   User    │
   │ Defaults│                  │  App Config │                │ App Prefs │
   └─────────┘                  └─────────────┘                └───────────┘
```

#### Environment Management Strategy

**Minimal `.env` as Bootstrap (New Approach)**

Currently avoided, but a minimal `.env` serves as the "primer" for config discovery:

```bash
# .env (minimal - ONLY deployment bootstrap)
DAYLIGHT_ENV=development          # or: production, test
DAYLIGHT_DATA_ROOT=/path/to/data  # Single root for all config/data
```

**Why minimal .env:**
- Single source of truth for "where to look"
- Environment detection without hardcoding
- Works in Docker, local dev, and new deployments
- Everything else lives in YAML configs

**Resolution Chain:**
```
1. .env (bootstrap only: env type + data root)
2. {DATA_ROOT}/config/system.yml (infrastructure)
3. {DATA_ROOT}/config/apps/*.yml (app defaults)
4. {DATA_ROOT}/households/{id}/ (household config + data)
5. {DATA_ROOT}/users/{id}/ (user config + data)
```

### 11.2 Structural Changes

#### Config Inside Data Directory

**Current (Problematic):**
```
/path/to/mount/
├── config/          # Separate mount, not in Dropbox sync
├── data/            # In Dropbox sync
└── media/           # In Dropbox sync
```

**Proposed (Unified):**
```
/path/to/DaylightStation/        # Single DATA_ROOT
├── config/                       # Now inside, syncs with data
│   ├── system.yml
│   ├── system.local.yml         # Environment overrides (gitignored)
│   ├── secrets.yml              # Secrets (gitignored, future: external)
│   ├── logging.yml
│   └── apps/
│       ├── chatbots.yml
│       ├── fitness.yml
│       └── ...
├── households/                   # Moved up from data/
│   └── {householdId}/
│       ├── household.yml
│       ├── apps/{app}/config.yml
│       ├── common/
│       └── auth/                 # Household-level auth
├── users/                        # Moved up from data/
│   └── {username}/
│       ├── profile.yml
│       ├── auth/                 # User-level auth
│       ├── lifelog/
│       └── current/
├── state/                        # Runtime state
├── content/                      # Static content
└── media/                        # Media files (may stay separate mount)
```

**Benefits:**
- Single sync point (Dropbox, rsync, etc.)
- Single Docker volume mount
- Config travels with data
- Simpler path resolution

#### Docker Mount Simplification

**Current:**
```yaml
volumes:
  - /path/config:/usr/src/app/config
  - /path/data:/usr/src/app/data
  - /path/media:/usr/src/app/media
```

**Proposed:**
```yaml
volumes:
  - ${DAYLIGHT_DATA_ROOT}:/usr/src/app/data
  - ${DAYLIGHT_MEDIA_ROOT:-/usr/src/app/data/media}:/usr/src/app/media  # Optional override
```

### 11.3 Environment Overrides

#### Override Chain (Most Specific Wins)

```
Base Config                    →  Environment Override           →  Runtime Override
config/system.yml              →  config/system.{env}.yml        →  ENV vars
config/apps/fitness.yml        →  config/apps/fitness.{env}.yml  →  CLI args
households/{id}/household.yml  →  (no env override needed)       →  (runtime state)
```

#### Host/Network Overrides

For calling from different hostnames (dev proxy, tunnels, etc.):

```yaml
# config/system.yml (base)
network:
  api_host: localhost
  api_port: 3112
  public_url: https://daylightstation-api.kckern.net

# config/system.development.yml (dev override)
network:
  api_host: 0.0.0.0
  public_url: http://localhost:3112
  cors_origins:
    - http://localhost:3111
    - http://10.0.0.68:3119

# config/system.production.yml (prod override)
network:
  public_url: https://daylightstation-api.kckern.net
  cors_origins:
    - https://daylight.kckern.net
```

### 11.4 Initialization & Defaults

#### Boilerplate Generation

For new deployments or recovery, ConfigService should:

1. **Detect missing config** → Generate from examples
2. **Validate existing config** → Warn on missing required fields
3. **Provide sensible defaults** → Hardcode only when unavoidable

```javascript
// ConfigService initialization flow
class ConfigService {
  async initialize(dataRoot) {
    // 1. Ensure directory structure
    await this.ensureDirectories(dataRoot);

    // 2. Check for config files, generate from examples if missing
    await this.ensureConfigs(dataRoot);

    // 3. Load and validate
    const config = await this.loadWithDefaults(dataRoot);

    // 4. Warn about missing optional config
    this.validateAndWarn(config);

    return config;
  }

  async ensureConfigs(dataRoot) {
    const configDir = path.join(dataRoot, 'config');
    const examplesDir = path.join(this.codebaseRoot, 'config');

    // Copy examples to actuals if missing
    for (const example of await glob('**/*.example.yml', examplesDir)) {
      const actual = example.replace('.example.yml', '.yml');
      const targetPath = path.join(configDir, actual);

      if (!await exists(targetPath)) {
        await copyWithComment(
          path.join(examplesDir, example),
          targetPath,
          '# Generated from example. Edit as needed.'
        );
        logger.info('config.generated_from_example', { file: actual });
      }
    }
  }
}
```

#### Default Fallback Strategy

```javascript
// Defaults embedded in code (last resort)
const HARDCODED_DEFAULTS = {
  // Only truly universal defaults
  timezone: 'UTC',
  locale: 'en-US',
  logLevel: 'info',
};

// Defaults from example files (preferred)
const EXAMPLE_DEFAULTS = await loadYaml('config/system.example.yml');

// Resolution: config file → example defaults → hardcoded
const getValue = (path) => {
  return resolvePath(loadedConfig, path)
      ?? resolvePath(EXAMPLE_DEFAULTS, path)
      ?? resolvePath(HARDCODED_DEFAULTS, path);
};
```

### 11.5 Expandability

#### Adding New Apps

```yaml
# To add a new app:
# 1. Create config/apps/newapp.example.yml (template in codebase)
# 2. On deployment, ConfigService generates config/apps/newapp.yml
# 3. Optionally add household-level config: households/{id}/apps/newapp/config.yml
# 4. Optionally add user-level prefs: users/{id}/profile.yml → apps.newapp

# config/apps/newapp.example.yml
version: "1.0"
app_id: newapp
defaults:
  setting1: value1
  setting2: value2
identity_mappings: {}  # Platform ID → username
data_paths:
  primary: "{username}/lifelog/newapp"
```

#### Adding New Households

```yaml
# To add a new household:
# 1. Create directory: {DATA_ROOT}/households/newhousehold/
# 2. Copy from example: households/example/household.yml → households/newhousehold/household.yml
# 3. Edit household.yml with users, settings

# households/example/household.yml (template)
version: "1.0"
household_id: example
name: "Example Household"
head: null  # Set to primary username
users: []   # Add usernames
timezone: America/Los_Angeles
apps: {}    # App-specific household settings
```

#### ConfigService App/Household Discovery

```javascript
class ConfigService {
  // Auto-discover apps from config/apps/*.yml
  discoverApps() {
    const appConfigs = glob.sync('config/apps/*.yml', { cwd: this.dataRoot });
    return appConfigs
      .filter(f => !f.includes('.example.') && !f.startsWith('_'))
      .map(f => path.basename(f, '.yml'));
  }

  // Auto-discover households from households/*/household.yml
  discoverHouseholds() {
    const households = glob.sync('households/*/household.yml', { cwd: this.dataRoot });
    return households
      .filter(f => !f.includes('example'))
      .map(f => path.dirname(f).split('/').pop());
  }

  // Register new app at runtime
  registerApp(appId, defaultConfig) {
    // Merge with existing or create new
  }
}
```

### 11.6 Path Management

#### All Path Resolution Through ConfigService

```javascript
class ConfigService {
  // Canonical path resolution - ALL paths go through here
  resolvePath(pathType, ...segments) {
    const roots = {
      data: this.dataRoot,
      config: path.join(this.dataRoot, 'config'),
      households: path.join(this.dataRoot, 'households'),
      users: path.join(this.dataRoot, 'users'),
      state: path.join(this.dataRoot, 'state'),
      content: path.join(this.dataRoot, 'content'),
      media: this.mediaRoot,  // May be separate mount
      cache: path.join(this.dataRoot, 'cache'),
      tmp: path.join(this.dataRoot, 'tmp'),
    };

    const root = roots[pathType];
    if (!root) throw new Error(`Unknown path type: ${pathType}`);

    return path.join(root, ...segments);
  }

  // Convenience methods
  userPath(username, ...segments) {
    return this.resolvePath('users', username, ...segments);
  }

  householdPath(householdId, ...segments) {
    return this.resolvePath('households', householdId, ...segments);
  }

  appConfigPath(appId) {
    return this.resolvePath('config', 'apps', `${appId}.yml`);
  }
}

// Usage throughout codebase (replaces process.env.path.*)
const lifelogPath = configService.userPath('kckern', 'lifelog', 'strava.yml');
const fitnessConfig = configService.householdPath('default', 'apps', 'fitness', 'config.yml');
```

### 11.7 Authentication Management

#### Current State (Validated Location, Needs Abstraction)

```
Auth currently lives in correct places:
├── users/{username}/auth/{service}.yml      # User OAuth tokens
└── households/{householdId}/auth/{service}.yml  # common/household tokens
```

#### Abstraction Layer for Future Secrets Management

```javascript
class AuthService {
  constructor(configService, secretsProvider = null) {
    this.configService = configService;
    // Default: file-based. Future: Vault, AWS Secrets Manager, etc.
    this.secretsProvider = secretsProvider || new FileSecretsProvider(configService);
  }

  async getToken(scope, scopeId, service) {
    // scope: 'user' | 'household' | 'system'
    return this.secretsProvider.get(scope, scopeId, service);
  }

  async setToken(scope, scopeId, service, tokenData) {
    return this.secretsProvider.set(scope, scopeId, service, tokenData);
  }
}

// File-based implementation (current)
class FileSecretsProvider {
  async get(scope, scopeId, service) {
    const authPath = this.resolvePath(scope, scopeId, service);
    return loadYaml(authPath);
  }
}

// Future: External secrets manager
class VaultSecretsProvider {
  async get(scope, scopeId, service) {
    return this.vault.read(`daylight/${scope}/${scopeId}/auth/${service}`);
  }
}
```

#### Secrets Migration Path

```yaml
# Phase 1: Current file-based (no change)
# Phase 2: Add secrets.yml with references
# config/secrets.yml
secrets:
  system:
    openai_api_key: ${OPENAI_API_KEY}  # From env
    plex_token: ${PLEX_TOKEN}

  # Future: reference external provider
  provider: file  # or: vault, aws-secrets-manager
  vault:
    address: https://vault.internal:8200
    path_prefix: secret/daylight

# Phase 3: Move auth to external provider
# Auth files become references:
# users/kckern/auth/strava.yml
provider: vault
path: secret/daylight/users/kckern/auth/strava
```

### 11.8 Logging Configuration

#### Log Levels Per Component

```yaml
# config/logging.yml
version: "1.0"

defaults:
  level: info
  format: json  # or: pretty (dev)

# Per-component overrides
components:
  config: debug     # ConfigService
  auth: info
  fitness: info
  chatbots: info
  harvesters: warn

# Per-environment (in logging.{env}.yml)
# logging.development.yml
defaults:
  level: debug
  format: pretty

# logging.production.yml
defaults:
  level: info
  format: json
  outputs:
    - type: stdout
    - type: loggly
      token: ${LOGGLY_TOKEN}
```

#### Integration with ConfigService

```javascript
class ConfigService {
  getLogLevel(component = null) {
    const loggingConfig = this.get('logging');
    if (component && loggingConfig?.components?.[component]) {
      return loggingConfig.components[component];
    }
    return loggingConfig?.defaults?.level || 'info';
  }
}
```

### 11.9 Abstraction for External Services

#### Service Provider Interface

```javascript
// Future-proof: ConfigService can delegate to external providers
class ConfigService {
  constructor(options = {}) {
    this.providers = {
      config: options.configProvider || new FileConfigProvider(),
      secrets: options.secretsProvider || new FileSecretsProvider(),
      // Future additions:
      // config: new ConsulConfigProvider(),
      // secrets: new VaultSecretsProvider(),
    };
  }

  async get(path) {
    return this.providers.config.get(path);
  }

  async getSecret(path) {
    return this.providers.secrets.get(path);
  }
}

// Docker Compose for future config management container
# docker-compose.yml (future)
services:
  config-manager:
    image: hashicorp/vault:latest
    # or: consul, etcd, custom config service

  daylight-station:
    environment:
      - CONFIG_PROVIDER=vault
      - VAULT_ADDR=http://config-manager:8200
```

---

## 12. Migration Plan

### Phase 0: Bootstrap (.env Introduction)
**Goal:** Minimal environment detection without breaking existing setup

**Tasks:**
1. Add `.env.example` to codebase:
   ```bash
   DAYLIGHT_ENV=development
   DAYLIGHT_DATA_ROOT=/path/to/DaylightStation
   ```
2. Update `pathResolver.mjs` to read `.env` first
3. Existing `DAYLIGHT_CONFIG_PATH`/`DAYLIGHT_DATA_PATH` continue to work (backwards compatible)
4. Document in README

**Risk:** Low (additive only)

### Phase 1: Directory Restructure
**Goal:** Move `config/` inside unified data root

**Tasks:**
1. Create new structure in parallel (don't delete old yet):
   ```
   {DATA_ROOT}/
   ├── config/           # NEW: moved from parallel location
   ├── households/       # NEW: moved from data/households
   ├── users/            # NEW: moved from data/users
   ├── state/            # Existing
   ├── content/          # Existing
   └── media/            # May stay separate or move
   ```
2. Update ConfigService to check new location first, fall back to old
3. Add deprecation warnings for old paths
4. Update Docker mounts documentation
5. Migrate production, then dev

**Risk:** Medium (requires coordinated data move)

### Phase 2: ConfigService as Single Gateway
**Goal:** All config access through ConfigService

**Tasks:**
1. Add `resolvePath()` method to ConfigService
2. Create `configService.userPath()`, `householdPath()`, etc.
3. Audit and replace all `process.env.path.*` usages (identified in Section 7.1)
4. Remove module-level path constants (lazy load instead)
5. Deprecate direct `io.mjs` usage for config reads

**Files to update:**
- `backend/lib/io.mjs` → Add deprecation, delegate to ConfigService
- `backend/routers/fetch.mjs` → Remove module-level constants
- `backend/routers/media.mjs` → Remove module-level constants
- `backend/lib/budget.mjs` → Remove module-level constants
- `backend/lib/ArchiveService.mjs` → Remove hardcoded fallback

**Risk:** Medium (many files, but mechanical changes)

### Phase 3: Environment Override System
**Goal:** Clean dev/prod separation

**Tasks:**
1. Implement `config/system.{env}.yml` loading
2. Implement `config/apps/{app}.{env}.yml` loading
3. Add merge logic: base → env-specific → runtime
4. Remove duplicate config from `config.app.yml`
5. Delete `config.app-local.yml` pattern (replaced by `.development.yml`)

**Risk:** Low (additive, then removal)

### Phase 4: Auth Abstraction
**Goal:** Prepare for external secrets management

**Tasks:**
1. Create `AuthService` wrapper
2. Create `SecretsProvider` interface
3. Implement `FileSecretsProvider` (current behavior)
4. Migrate auth reads to `AuthService.getToken()`
5. Document secrets management upgrade path

**Risk:** Low (abstraction only, no behavior change)

### Phase 5: Initialization & Defaults
**Goal:** Graceful handling of missing config

**Tasks:**
1. Add `ConfigService.ensureDirectories()`
2. Add `ConfigService.ensureConfigs()` (copy from examples)
3. Add validation with warnings (not errors) for optional config
4. Add `--init` CLI command for new deployments
5. Document initialization process

**Risk:** Low (additive)

### Phase 6: Legacy Cleanup
**Goal:** Remove deprecated patterns

**Tasks:**
1. Remove `config.app.yml` (all content migrated to `system.yml` + `apps/*.yml`)
2. Remove `config.secrets.yml` (migrated to `secrets.yml` in new location)
3. Remove `io.mjs` loadFile/saveFile for config (keep for data files)
4. Remove old path constants from codebase
5. Update all documentation

**Risk:** High (breaking change, needs thorough testing)

---

## 13. Implementation Priority

| Phase | Priority | Effort | Risk | Dependencies |
|-------|----------|--------|------|--------------|
| 0: Bootstrap .env | High | Low | Low | None |
| 1: Directory Restructure | High | Medium | Medium | Phase 0 |
| 2: ConfigService Gateway | High | Medium | Medium | Phase 1 |
| 3: Environment Overrides | Medium | Low | Low | Phase 2 |
| 4: Auth Abstraction | Medium | Low | Low | Phase 2 |
| 5: Init & Defaults | Medium | Low | Low | Phase 1 |
| 6: Legacy Cleanup | Low | Medium | High | All above |

**Recommended Order:** 0 → 1 → 2 → 5 → 3 → 4 → 6

---

## 14. New Deployment Workflow

After migration, new deployments follow this process:

```bash
# 1. Clone codebase
git clone https://github.com/user/DaylightStation.git
cd DaylightStation

# 2. Create minimal .env
cat > .env << EOF
DAYLIGHT_ENV=production
DAYLIGHT_DATA_ROOT=/path/to/data
EOF

# 3. Initialize config (copies examples, creates directories)
npm run init
# Or: node cli/init.mjs

# 4. Edit generated configs
vim /path/to/data/config/system.yml
vim /path/to/data/config/secrets.yml

# 5. Create first household and user
npm run create-household default
npm run create-user kckern --household=default --head

# 6. Start application
docker-compose up -d
# Or: npm run start
```

---

## 15. Success Criteria

Configuration system redesign is complete when:

1. **Single data root** - All config, data, users, households under one path
2. **No hardcoded paths** - All paths resolved through ConfigService
3. **Environment separation** - Clean dev/prod config without duplication
4. **Graceful initialization** - New deployments work with example-based defaults
5. **Auth abstraction** - Ready for external secrets management
6. **Expandable** - Adding apps/households is self-service via config files
7. **No legacy config** - `config.app.yml` and parallel config mount removed
8. **Documentation** - Clear guides for deployment, configuration, and extension
