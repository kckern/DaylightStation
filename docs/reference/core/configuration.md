# Configuration System Reference

## Overview

DaylightStation uses a hierarchical, file-based configuration system with:
- **YAML Source of Truth** - All config from YAML files, never hardcoded
- **Environment-Aware Loading** - Overrides via `system-local.{ENV}.yml`
- **Service Resolution** - Logical names resolved to hosts per environment
- **Multi-Level Config** - System > Household > User > App-specific
- **Secrets Isolation** - Tokens separated from config

---

## Core Concepts

### Separation of Concerns

| Concern | Location | Varies By |
|---------|----------|-----------|
| App ports, timezone | `system.yml` + `system-local.{env}.yml` | Environment |
| Service host resolution | `system/services.yml` | Environment |
| Shared services (MQTT, printer) | `system/adapters.yml` | - |
| Per-household services | `household[-{id}]/integrations.yml` | Household |
| Per-household secrets | `household[-{id}]/auth/*.yml` | Household |
| Household identity | `household[-{id}]/household.yml` | Household |
| User profiles | `users/{username}/profile.yml` | User |
| User secrets | `users/{username}/auth/*.yml` | User |

### Key Principle: Households Define What, System Defines Where

- **Households** specify logical service names and ports
- **System** resolves service names to physical hosts per environment
- Households never reference environment names (no abstraction leak)

---

## Environment Variables (.env)

```bash
DAYLIGHT_BASE_PATH=/path/to/DaylightStation  # Root directory
DAYLIGHT_ENV=kckern-server                    # Environment name
```

| Variable | Purpose | Example |
|----------|---------|---------|
| `DAYLIGHT_BASE_PATH` | Root directory | `/media/kckern/.../DaylightStation` |
| `DAYLIGHT_ENV` | Selects `system-local.{ENV}.yml` | `docker`, `kckern-server`, `kckern-macbook` |

---

## Environments

| Env | Machine | App Port | Notes |
|-----|---------|----------|-------|
| `docker` | Docker container | 3111 | Production |
| `kckern-server` | Docker host | 3112 | Dev (3111 taken by prod) |
| `kckern-macbook` | Laptop | 3111 | Dev (services at 10.0.0.x) |

---

## File Layout

```
data/
├── system/
│   ├── system.yml              # Base config (ports, timezone)
│   ├── system-local.docker.yml # Prod env overrides
│   ├── system-local.kckern-server.yml
│   ├── system-local.kckern-macbook.yml
│   ├── services.yml            # Service → host resolution
│   ├── adapters.yml            # Shared service config
│   ├── secrets.yml             # System-wide API keys
│   ├── logging.yml             # Log levels
│   └── apps/                   # App-specific config
│
├── household/                  # Default household
│   ├── household.yml           # Identity, users
│   ├── integrations.yml        # Service names + ports
│   ├── auth/
│   │   ├── plex.yml            # token only
│   │   └── homeassistant.yml
│   └── apps/
│       └── fitness/config.yml
│
├── household-jones/            # Secondary household
│   ├── household.yml
│   ├── integrations.yml
│   └── auth/
│
└── users/
    ├── kckern/
    │   ├── profile.yml
    │   └── auth/
    └── felix/
```

---

## System Configuration

### system.yml (Base Configuration)

Production defaults and shared settings:

```yaml
app:
  port: 3111              # Backend API port (Docker default)

households:
  default: default        # Default household ID

timezone: America/Los_Angeles
```

### system-local.{ENV}.yml (Environment Overrides)

Per-environment overrides merged on top of system.yml.

**Docker (system-local.docker.yml)**
```yaml
# Empty or minimal - system.yml has Docker defaults
```

**Linux Dev (system-local.kckern-server.yml)**
```yaml
app:
  port: 3112              # Different from Docker to avoid conflicts

webhook:
  port: 3120
```

**Macbook Dev (system-local.kckern-macbook.yml)**
```yaml
# Uses default ports (3111) - no Docker running
```

---

## Service Resolution

### The Problem

Services like Plex have different hostnames per environment:
- Docker: `plex` (container hostname)
- Dev on docker host: `localhost`
- Dev on laptop: `10.0.0.10`

Different households may have different service instances:
- Default household: `plex`
- Jones household: `plex-jones`

### The Solution: services.yml

One file maps logical service names to physical hosts per environment:

```yaml
# system/services.yml

# Shared services (all households)
mqtt:
  docker: mosquitto
  kckern-server: localhost
  kckern-macbook: 10.0.0.10

printer:
  docker: 10.0.0.50
  kckern-server: 10.0.0.50
  kckern-macbook: 10.0.0.50

# Default household services (base names)
plex:
  docker: plex
  kckern-server: localhost
  kckern-macbook: 10.0.0.10

homeassistant:
  docker: homeassistant
  kckern-server: localhost
  kckern-macbook: 10.0.0.10

# Jones household services (suffixed names)
plex-jones:
  docker: plex-jones
  kckern-server: localhost
  kckern-macbook: 10.0.0.11

homeassistant-jones:
  docker: ha-jones
  kckern-server: localhost
  kckern-macbook: 10.0.0.11
```

### Naming Convention

| Household | Service Name Pattern | Example |
|-----------|---------------------|---------|
| default | `{service}` (base name) | `plex`, `homeassistant` |
| jones | `{service}-jones` | `plex-jones`, `homeassistant-jones` |
| smith | `{service}-smith` | `plex-smith`, `homeassistant-smith` |

### Resolution Flow

```
Request for jones household Plex
    ↓
household-jones/integrations.yml
    service: plex-jones, port: 32400
    ↓
system/services.yml
    plex-jones.{DAYLIGHT_ENV} = localhost (if kckern-server)
    ↓
Result: http://localhost:32400
```

### Resolution Matrix Example

| Household | Service | docker | kckern-server | kckern-macbook |
|-----------|---------|--------|---------------|----------------|
| default | plex | `plex:32400` | `localhost:32400` | `10.0.0.10:32400` |
| default | homeassistant | `homeassistant:8123` | `localhost:8123` | `10.0.0.10:8123` |
| jones | plex | `plex-jones:32400` | `localhost:32400` | `10.0.0.11:32400` |
| jones | homeassistant | `ha-jones:8123` | `localhost:8123` | `10.0.0.11:8123` |
| (shared) | mqtt | `mosquitto:1883` | `localhost:1883` | `10.0.0.10:1883` |

---

## Shared Services

### adapters.yml

Shared services used by all households. Uses service names for resolution.

```yaml
# system/adapters.yml

mqtt:
  service: mqtt
  port: 1883

thermal_printer:
  service: printer
  port: 9100

weather:
  api_url: https://api.weather.gov
  # No service resolution - external API

strava:
  api_url: https://www.strava.com/api/v3
  # OAuth config, no local service
```

---

## Household Configuration

### Directory Structure

Flat structure at data root:

| Folder | Household ID |
|--------|--------------|
| `household/` | `default` |
| `household-jones/` | `jones` |
| `household-smith/` | `smith` |

### household.yml

Identity and users:

```yaml
version: "1.0"
household_id: default
name: "Default Household"
head: kckern

users:
  - kckern
  - elizabeth
  - felix
  - milo

apps:
  fitness:
    primary_users: [kckern, felix, milo]
```

### integrations.yml

Per-household service configuration. References logical service names.

**Default household (uses base names):**
```yaml
# household/integrations.yml

plex:
  service: plex
  port: 32400
  protocol: dash
  platform: Chrome

homeassistant:
  service: homeassistant
  port: 8123
```

**Secondary households (use suffixed names):**
```yaml
# household-jones/integrations.yml

plex:
  service: plex-jones
  port: 32400
  protocol: dash
  platform: Chrome

homeassistant:
  service: homeassistant-jones
  port: 8123
```

### auth/*.yml

Secrets only. No hosts or config.

```yaml
# household/auth/plex.yml
token: SZMcgR9vv5ntHSaezzBE

# household/auth/homeassistant.yml
token: eyJhbGciOiJIUzI1NiIs...
```

---

## User Configuration

### Directory Structure

Location: `data/users/{username}/`

### profile.yml

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

### auth/*.yml

Per-user OAuth tokens and API keys:

```yaml
# users/kckern/auth/strava.yml
access_token: ...
refresh_token: ...
expires_at: 1234567890

# users/kckern/auth/google.yml
refresh_token: ...
```

---

## Secrets Management

### System Secrets (secrets.yml)

System-wide API keys shared across all users/households:

```yaml
# system/secrets.yml
OPENAI_API_KEY: sk-...
GOOGLE_CLIENT_ID: ...
GOOGLE_CLIENT_SECRET: ...
STRAVA_CLIENT_ID: ...
STRAVA_CLIENT_SECRET: ...
TELEGRAM_BOT_TOKEN: ...
```

### Household Secrets (auth/*.yml)

Per-household service tokens:

```yaml
# household/auth/plex.yml
token: ...

# household/auth/homeassistant.yml
token: ...
```

### User Secrets (auth/*.yml)

Per-user OAuth tokens:

```yaml
# users/kckern/auth/strava.yml
access_token: ...
refresh_token: ...
```

### Access Pattern

```javascript
// System secret
configService.getSecret('OPENAI_API_KEY');

// Household secret
configService.getHouseholdAuth('plex', 'default');

// User secret
configService.getUserAuth('strava', 'kckern');
```

---

## ConfigService API

Location: `backend/src/0_system/config/`

### Initialization

```javascript
import { initConfigService, configService } from './0_system/config/index.mjs';

// At startup (once)
initConfigService(dataDir);

// Anywhere else
const apiKey = configService.getSecret('OPENAI_API_KEY');
```

### Service Resolution

```javascript
// Get resolved service URL for a household
const plexUrl = configService.resolveServiceUrl('default', 'plex');
// → "http://localhost:32400" (in kckern-server env)

// Get integration config
const plexConfig = configService.getHouseholdIntegration('default', 'plex');
// → { service: 'plex', port: 32400, protocol: 'dash', platform: 'Chrome' }
```

### Other Methods

**Secrets**
```javascript
getSecret(key)                    // System API key
getUserAuth(service, username)    // User's auth for service
getHouseholdAuth(service, hid)    // Household's auth for service
```

**Households**
```javascript
getDefaultHouseholdId()           // Returns default household ID
getHouseholdUsers(householdId)    // Returns array of usernames
getHouseholdIntegration(hid, svc) // Returns integration config
```

**Users**
```javascript
getUserProfile(username)          // Returns profile.yml contents
resolveUsername(platform, id)     // Maps external ID to username
```

**Paths**
```javascript
getDataDir()                      // Path to data directory
getHouseholdPath(householdId)     // Path to household folder
getUserDir(username)              // Path to user data
```

**System**
```javascript
getEnv()                          // Environment name
getPort()                         // Server port
```

---

## Port Configuration

### Single App Port Per Environment

Each environment defines ONE port - the public-facing app port:

| Environment | `app.port` | User hits | Backend listens |
|-------------|------------|-----------|-----------------|
| docker (prod) | 3111 | 3111 | 3111 |
| kckern-server (dev) | 3112 | 3112 (Vite) | 3113 (hidden) |
| kckern-macbook (dev) | 3111 | 3111 (Vite) | 3112 (hidden) |

> **Note:** Webhooks are now served on the main app port. The separate webhook port (3119) was deprecated.

### Dev Mode

In dev, Vite runs on `app.port` and proxies to backend on `app.port + 1`:

```javascript
// vite.config.js
server: {
  port: appPort,           // e.g., 3112
  proxy: {
    '/api': `http://localhost:${appPort + 1}`,  // e.g., 3113
  }
}
```

---

## Adding New Configuration

### New Environment

1. Create `system-local.{newenv}.yml` with port overrides
2. Add service host mappings to `services.yml`
3. Set `DAYLIGHT_ENV={newenv}` in `.env`

### New Household

1. Create `household-{name}/` directory
2. Add `household.yml` with identity and users
3. Add `integrations.yml` with service names (use `{service}-{name}` pattern)
4. Add `auth/*.yml` for service tokens
5. Add service mappings to `services.yml`

### New Service

1. Add to `services.yml` with host mappings for all envs
2. If shared: add config to `adapters.yml`
3. If per-household: add to each `household[-{id}]/integrations.yml`
4. Add secrets to appropriate `auth/` directory

---

## Troubleshooting

### "Port already in use"
Check which environment's ports you're using. Docker (3111) and dev (3112) use different ports.

### "Service not found"
Check that the service name in `integrations.yml` matches an entry in `services.yml`.

### "Connection refused in dev"
Check `services.yml` has correct host for your environment. Common issue: service mapped to `localhost` but running on different IP.

### "Household not found"
Check directory name matches pattern: `household/` for default, `household-{name}/` for others.

---

## Related Files

| File | Purpose |
|------|---------|
| `backend/src/0_system/config/index.mjs` | Singleton entry point |
| `backend/src/0_system/config/ConfigService.mjs` | Pure accessor class |
| `backend/src/0_system/config/configLoader.mjs` | YAML loading & merging |
| `backend/src/0_system/config/configValidator.mjs` | Validation rules |
| `frontend/vite.config.js` | Frontend port/proxy config |
| `tests/lib/configHelper.mjs` | Test config helper |
