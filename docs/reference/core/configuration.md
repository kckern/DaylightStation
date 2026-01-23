# Configuration System Reference

## Overview

DaylightStation uses a hierarchical, file-based configuration system with:
- **YAML Source of Truth (SSOT)** - All config from YAML files, never hardcoded
- **Environment-Aware Loading** - Overrides via `system-local.{ENV}.yml`
- **ConfigService Pattern** - Pure accessor receives pre-validated config
- **Multi-Level Config** - System > Household > User > App-specific
- **Sensitive Data Isolation** - Secrets separated, PII redaction built-in

## Environment Variables (.env)

```bash
DAYLIGHT_BASE_PATH=/path/to/DaylightStation  # Root directory
DAYLIGHT_ENV=kckern-server                    # Environment name
```

| Variable | Purpose | Used By |
|----------|---------|---------|
| `DAYLIGHT_BASE_PATH` | Root directory; data/media are subdirectories | Backend, Vite, Tests |
| `DAYLIGHT_ENV` | Loads `system-local.{ENV}.yml` overrides | All components |

---

## System YAML Files

All system config lives in `data/system/`.

### system.yml (Base Configuration)

Production defaults and shared settings:

```yaml
server:
  port: 3111           # Backend API port (Docker default)

webhook:
  port: 3119           # Webhook receiver port

households:
  default: default     # Default household ID

timezone: America/Los_Angeles

# External services (Docker hostnames)
plex:
  host: plex
  port: 32400

home_assistant:
  host: homeassistant
  port: 8123

mqtt:
  host: mqtt
  port: 1883
```

### system-local.{ENV}.yml (Environment Overrides)

Per-environment overrides merged on top of system.yml.

**Docker (system-local.docker.yml)**
```yaml
# Empty - uses production defaults from system.yml
```

**Linux Dev (system-local.kckern-server.yml)**
```yaml
server:
  port: 3112          # Different from Docker to avoid conflicts

webhook:
  port: 3120

services_host: localhost   # Override all service hosts for local dev

vite:
  port: 5173          # Frontend dev server port
```

**How `services_host` works:** When defined, overrides individual service hosts (plex, home_assistant, mqtt, etc.) so dev machines can reach services on localhost.

### adapters.yml (External Service Config)

Connection settings for external services:

```yaml
# Proxy adapters
plex:
  host: http://plex:32400
  protocol: dash
  # token: via configService.getSecret() or household auth

immich:
  host: http://immich:2283

freshrss:
  host: http://freshrss:8080

# Hardware adapters
mqtt:
  broker: mqtt://mqtt:1883
  namespace: daylight

printer:
  type: thermal
  host: thermal-printer

tts:
  provider: openai
  voice: shimmer

# Harvesters (API URLs, OAuth redirects)
strava:
  api_url: https://www.strava.com/api/v3
  oauth_redirect: /api/v1/harvest/strava/callback

withings:
  api_url: https://wbsapi.withings.net
```

### secrets.yml (API Keys & Tokens)

System-wide secrets (never committed to git):

```yaml
OPENAI_API_KEY: sk-...
PLEX_TOKEN: ...
TELEGRAM_BOT_TOKEN: ...
GOOGLE_CLIENT_ID: ...
GOOGLE_CLIENT_SECRET: ...
STRAVA_CLIENT_ID: ...
STRAVA_CLIENT_SECRET: ...
LOGGLY_TOKEN: ...
OPENWEATHER_API_KEY: ...
```

### logging.yml (Log Levels)

```yaml
defaultLevel: info

loggers:
  websocket: warn
  health: warn
  fitness: debug
  api: info

loggly:
  tags:
    - daylight-station
    - production
```

### Other System Files

| File | Purpose |
|------|---------|
| `apps/*.yml` | App-specific config (fitness.yml, chatbots.yml, etc.) |
| `archive.yml` | Data retention policies |
| `cron-jobs.yml` | Scheduled task definitions |
| `jobs.yml` | One-off job definitions |
| `testdata.yml` | Test fixture configuration |

---

## Household & User Config

### Household Structure

Location: `data/households/{household_id}/`

**household.yml**
```yaml
version: "1.0"
household_id: default
name: "Default Household"
head: kckern                    # Head of household (username)
users:                          # All users in household
  - kckern
  - felix
  - milo

apps:
  fitness:
    primary_users: [kckern, felix, milo]
```

**Auth files:** `households/{hid}/auth/{service}.yml`
- `plex.yml` - `server_url`, `token`
- `homeassistant.yml` - `token`

### User Structure

Location: `data/users/{username}/`

**profile.yml**
```yaml
version: "1.0"
username: felix
household_id: default
display_name: "Felix"
birthyear: 2016
type: family_member
group: primary

apps:
  fitness:
    heart_rate_zones:
      active: 120
      warm: 140
      hot: 160
      fire: 180
```

**Auth files:** `users/{username}/auth/{service}.yml`
- Per-user OAuth tokens (google.yml, strava.yml, withings.yml)
- Per-user API keys (todoist.yml, lastfm.yml)

---

## ConfigService API

Location: `backend/src/0_infrastructure/config/`

### Initialization

```javascript
import { initConfigService, configService } from './0_infrastructure/config/index.mjs';

// At startup (once)
initConfigService(dataDir);

// Anywhere else
const apiKey = configService.getSecret('OPENAI_API_KEY');
```

### Methods

**Secrets**
```javascript
getSecret(key)                    // Returns API key or null
```

**Households**
```javascript
getDefaultHouseholdId()           // Returns default household ID
getHeadOfHousehold(householdId)   // Returns head's username
getHouseholdUsers(householdId)    // Returns array of usernames
getHouseholdTimezone(householdId) // Returns timezone string
```

**Users**
```javascript
getUserProfile(username)          // Returns profile.yml contents
getAllUserProfiles()              // Returns Map<username, profile>
resolveUsername(platform, id)     // Maps external ID to username
```

**Auth**
```javascript
getUserAuth(service, username)      // User's auth for service
getHouseholdAuth(service, hid)      // Household's auth for service
```

**Apps**
```javascript
getAppConfig(appName, pathStr)    // App config with optional path
```

**Paths**
```javascript
getDataDir()                      // Path to data directory
getMediaDir()                     // Path to media directory
getUserDir(username)              // Path to user data
getConfigDir()                    // Path to system config
getPath(name)                     // Named path (img, font, icons)
```

**Adapters**
```javascript
getAdapterConfig(name)            // Config for one adapter
getAllAdapterConfigs()            // All adapter configs
```

**System**
```javascript
get(pathStr)                      // Generic lookup ("server.port")
getServiceConfig(name)            // Service config with services_host override
getEnv()                          // Environment name
getPort()                         // Server port (3111/3112)
getWebhookPort()                  // Webhook port (3119/3120)
getSafeConfig()                   // Config safe for exposure (secrets redacted)
```

---

## Port Configuration

### Single App Port Per Environment

Each environment defines ONE port - the **public-facing app port**:

```yaml
app:
  port: 3112    # The port users/tests hit
```

| Environment | `app.port` | User hits | Backend listens | Webhook |
|-------------|------------|-----------|-----------------|---------|
| Docker (prod) | 3111 | 3111 | 3111 (serves static + API) | 3119 |
| kckern-macbook (dev) | 3111 | 3111 (Vite) | 3112 (hidden) | 3119 |
| kckern-server (dev) | 3112 | 3112 (Vite) | 3113 (hidden) | 3120 |

### Key Principle

**Same surface topology everywhere.** Users and tests only know about `app.port`. In dev, the backend port (`app.port + 1`) is an implementation detail only Vite knows about.

### Detection Logic

```javascript
const isDocker = existsSync('/.dockerenv');
const backendPort = isDocker ? appPort : appPort + 1;
```

- Docker → prod mode → backend serves everything on `app.port`
- No Docker → dev mode → Vite on `app.port`, backend on `app.port + 1`

### How Ports Flow

```
system-local.{ENV}.yml (app.port)
        ↓
   ConfigService.getAppPort()  → returns public port
        ↓
   backend/index.js            → listens on appPort (prod) or appPort+1 (dev)
        ↓
   vite.config.js              → Vite on appPort, proxy to appPort+1
        ↓
   configHelper.mjs            → test URLs use appPort only
        ↓
   playwright.config.mjs       → baseURL = appPort
```

---

## Vite Configuration

Location: `frontend/vite.config.js`

Reads app port from system config, backend is always +1:

```javascript
function getPortsFromConfig(env) {
  // Load config...
  const appPort = config?.app?.port ?? 3111;
  const backendPort = appPort + 1;  // Always +1 in dev

  return { app: appPort, backend: backendPort };
}
```

Configures Vite server and proxy:

```javascript
server: {
  port: ports.app,         // e.g., 3112 for kckern-server
  proxy: {
    '/api': `http://localhost:${ports.backend}`,  // e.g., 3113
    '/ws': { target: `ws://localhost:${ports.backend}`, ws: true }
  }
}
```

---

## Test Configuration

Location: `tests/lib/configHelper.mjs`

Tests only need the app port - same topology as prod:

```javascript
import { getAppPort, getTestUrls } from '#testlib/configHelper.mjs';

const appPort = getAppPort();  // e.g., 3112

const urls = getTestUrls();
// All URLs point to appPort - tests don't know about internal backend
// { frontend: 'http://localhost:3112', backend: 'http://localhost:3112', ws: 'ws://localhost:3112/ws' }
```

Used by:
- `playwright.config.mjs` - baseURL, webServer.url
- `tests/_fixtures/runtime/urls.mjs` - FRONTEND_URL, BACKEND_URL (both same port)

---

## Config Loading Chain

### Backend Startup

```
1. Detect base directory
   - Docker: /.dockerenv → /usr/src/app
   - Dev: DAYLIGHT_BASE_PATH from .env

2. Derive paths
   - dataDir = ${baseDir}/data
   - configDir = ${dataDir}/system

3. Initialize ConfigService
   - loadConfig(dataDir)      → Read all YAML, merge env overrides
   - validateConfig(config)   → Throw on invalid
   - new ConfigService(config) → Freeze and store singleton

4. All modules use configService singleton
```

### Vite Startup

```
1. Load .env (DAYLIGHT_BASE_PATH, DAYLIGHT_ENV)
2. Read system-local.{ENV}.yml
3. Extract ports for server config and proxy
4. Start dev server on vite.port
5. Proxy /api/* to backend on server.port
```

### Test Startup

```
1. configHelper reads .env and system YAML
2. playwright.config.mjs gets ports from configHelper
3. Test fixtures export URLs based on config
4. Tests use consistent URLs across environments
```

---

## Sensitive Data Handling

ConfigService.getSafeConfig() applies automatic filtering:

| Pattern | Treatment | Example |
|---------|-----------|---------|
| token, secret, password, api_key | **Redacted** `[REDACTED]` | `PLEX_TOKEN` |
| username, email, phone, name | **Masked** `k*****` | `display_name` |
| Everything else | **Public** (passed through) | `port`, `timezone` |

Used for: Status endpoints, debug output, logging.

---

## Adding New Configuration

### New System Setting

1. Add to `system.yml` (production default)
2. Add environment override to `system-local.{ENV}.yml` if needed
3. Add accessor method to `ConfigService.mjs`
4. Update validation in `configValidator.mjs` if required

### New Adapter

1. Add connection config to `adapters.yml`
2. Add secrets to `secrets.yml` (or use household/user auth)
3. Use `configService.getAdapterConfig('name')` in adapter code

### New App Config

1. Create `data/system/apps/{app}.yml`
2. Use `configService.getAppConfig('app', 'path.to.setting')`

---

## Troubleshooting

### "Port already in use"
Check which environment's ports you're using. Docker (3111) and dev (3112) use different ports to avoid conflicts.

### "Config validation failed"
Check the error message for which file/field is invalid. Common issues:
- Missing required secret
- Household references non-existent user
- User profile missing required field

### "services_host not working"
Ensure `services_host` is in your environment's `system-local.{ENV}.yml`, not in base `system.yml`.

### "Plex/HA not connecting in dev"
Check that `services_host: localhost` is set and the services are actually running on localhost.

---

## Related Files

| File | Purpose |
|------|---------|
| `backend/src/0_infrastructure/config/index.mjs` | Singleton entry point |
| `backend/src/0_infrastructure/config/ConfigService.mjs` | Pure accessor class |
| `backend/src/0_infrastructure/config/configLoader.mjs` | YAML loading & merging |
| `backend/src/0_infrastructure/config/configValidator.mjs` | Validation rules |
| `frontend/vite.config.js` | Frontend port/proxy config |
| `tests/lib/configHelper.mjs` | Test config helper |
| `playwright.config.mjs` | Test runner config |
