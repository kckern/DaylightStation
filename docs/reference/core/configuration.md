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
├── household/                  # Default household — DOMAIN-FIRST
│   ├── household.yml           # Identity, users
│   ├── integrations.yml        # Service names + ports
│   ├── auth/
│   │   ├── plex.yml            # token only
│   │   └── homeassistant.yml
│   ├── screens/  assets/       # Not domains — different scope
│   ├── fitness/                # A DOMAIN owns everything for itself
│   │   ├── exercise-index.yml  #   live state
│   │   ├── workouts/           #   live state
│   │   └── log/                #   append-only, date-keyed, prunable
│   ├── school/  piano/  finance/  weather/  automotive/    …one per domain
│   ├── hardware/               #   scales.yml, barcode/, omr/, pressure-mats/
│   ├── gaming/                 #   rules, content, manifests, profiles, assets
│   ├── media/                  #   config.yml = DOMAIN, app.yml = SURFACE
│   ├── triggers/               #   sources/responses/endpoints + bindings/ + state/
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
    └── user_2/
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

logging:
  fileSink:               # Durable general backend log (all optional)
    path: null            # Absolute path; default <mediaDir>/logs/backend.log
    maxSizeMb: 25         # Rotate at this size
    maxFiles: 8           # Generations kept, including the live file
```

**`logging.fileSink`.** The durable general backend log — the sink that carries
`http.response`, `plex.stream.mint` and every other backend event, and the one
thing that survives a container restart. Defaults to `<mediaDir>/logs/backend.log`
at a 200 MB ceiling, roughly three to four days at the measured intake. That
window is sized for how problems are actually reported (the next morning, by
whoever hit them), not for how small the file can be made.

`media/logs/` is the sanctioned home for heavy logs and is Dropbox-synced on
prod; for the periodic writers that sync cost is an accepted decision. **Do not
add a `.dropboxignore` to it** — excluding an already-synced folder can remove
the remote copy.

`backend.log` is the exception and no longer uses that default anywhere. It
appends continuously (~3 KB/s), so Dropbox re-uploaded it without pause, and
with prod and a macbook dev server writing the same synced file it could not
converge — five "conflicted copy" files in three minutes on 2026-08-16. Every
environment now sets `logging.fileSink.path` to a non-synced but still
persistent location, so the survives-a-restart guarantee is intact:

| Env | Path |
|-----|------|
| `docker` | `/usr/src/app/logs/backend.log` (bind mount → `DockerDrive/daylight-logs`) |
| `kckern-macbook` | `~/Library/Logs/DaylightStation/backend.log` |
| `kckern-server` | `DockerDrive/daylight-logs/backend-kckern-server.log` |

The Docker entry needs the `logs` bind mount in `docker/docker-compose.yml`;
without it the path lands in the container's ephemeral layer and dies on
redeploy. Point any of these back at `media/logs/` and the sync loop returns.

Unusable values (zero, negative, non-numeric) fall back to the defaults rather
than producing a transport that rotates on every line. Read by
`backend/src/0_system/logging/generalSinks.mjs`.

**AI usage ledger.** Every OpenAI/Anthropic API call is recorded twice: an
`openai.usage` / `anthropic.usage` info event in the structured log (model,
tokens in/out, estimated `costUsd`, duration, status), and a durable JSONL row
appended to `<dataDir>/system/history/ai-usage/YYYY-MM.jsonl` — the billing
trail that outlives the log store's 7-day retention. Cost estimates come from
`backend/src/1_adapters/ai/aiPricing.mjs`; unknown models record `costUsd: null`
(tokens still recorded) until a price is added there or via the `pricing:` map
on the provider's integration config. Written by
`backend/src/1_adapters/ai/AiUsageLedger.mjs`; recording never breaks the call
it observes.

Pricing is per 1M tokens and models four rates — `input`, `cachedInput`,
`cacheWrite`, `output` — plus an optional `long` block for long-context rates.
Cache hits matter: on the gpt-5.6 family they bill at a tenth of the input rate.
Both providers report them, but differently — OpenAI nests
`prompt_tokens_details.cached_tokens` *inside* `prompt_tokens`, Anthropic
reports `cache_read_input_tokens` *outside* `input_tokens` — so the adapters
normalize to "cached is a subset of prompt" before pricing. The long-context
threshold defaults to 128K prompt tokens; that boundary is an assumption, not a
published figure, and is overridable per model with `longThreshold`. Every call
this codebase makes today is far below it. OpenAI `reasoning_tokens` are logged
separately: they already bill inside `completion_tokens`, but they are otherwise
invisible spend.

### system-local.{ENV}.yml (Environment Overrides)

Per-environment overrides merged on top of system.yml.

**Docker (system-local.docker.yml)**
```yaml
# system.yml has the Docker port/scheduler defaults; this file carries the
# per-machine log path, which cannot live in system.yml because ConfigService
# .get() does no env resolution — it returns whatever literal is there.
logging:
  fileSink:
    path: /usr/src/app/logs/backend.log
```

**Linux Dev (system-local.kckern-server.yml)**
```yaml
app:
  port: 3112              # Different from Docker to avoid conflicts

webhook:
  port: 3120

logging:
  fileSink:
    path: /media/kckern/DockerDrive/daylight-logs/backend-kckern-server.log
```

**Macbook Dev (system-local.kckern-macbook.yml)**
```yaml
# Uses default ports (3111) - no Docker running
logging:
  fileSink:
    path: /Users/kckern/Library/Logs/DaylightStation/backend.log
```

Note that `app.ports.{env}` and `scheduler.enabled.{env}` in `system.yml` are
env-keyed maps resolved by dedicated accessors (`getAppPort`,
`isSchedulerEnabled`). Generic `configService.get('some.path')` has no such
resolution, so anything machine-specific reached that way belongs in these
files instead.

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

### ConfigService Helpers

- `resolveServiceUrl(serviceName, protocol = 'http')` builds the service URL using `system/services.yml` and $DAYLIGHT_ENV.
- `getServiceCredentials(serviceName, householdId)` combines the resolved URL with household auth for that service.

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

## Household layout: one domain, one folder

`household/<domain>/` owns everything for that domain. Inside a domain, **`log/`
is the one reserved name** — append-only, date-keyed, prunable. Everything else
in the folder is live state.

Two things stay at the household root because they are not domains: `auth/`
(the bootstrap loads it before any path resolver exists) and `screens/` +
`assets/` (a different scope — per-surface and shared static).

### Where an app config lives: `shared/contracts/householdConfig.mjs`

There is no `household/config/` directory. `shared/contracts/householdConfig.mjs`
is the only place an app's config path is declared — one registry, one map
from app name to a domain-grouped path under the household folder:

```javascript
// shared/contracts/householdConfig.mjs
export const HOUSEHOLD_APP_CONFIGS = Object.freeze({
  scales:      'hardware/scales',
  chess:       'gaming/chess',
  vehicles:    'automotive/vehicles',
  media:       'media/config',      // the DOMAIN (plex host, protocol, board ids)
  'media-app': 'media/app',         // the MediaApp SURFACE (browse menu, searchScopes)
  …
});
```

**Folder = the domain**, named after `backend/src/3_applications/`.
**Filename = the facet** — `config` for domain policy, another name for a
surface or a second facet.

**There is no fallback.** An app not in this registry has no config: reads
resolve to `null` rather than degrading to a flat file, and writes refuse
with a `NotFoundError` rather than silently creating a file nothing else will
ever read back. Adding an app's config is exactly one edit — a line in this
map — because everything else derives from it:

| Consumer | What it derives |
|---|---|
| `configLoader.loadHouseholdApps` | the app union built at boot |
| `ConfigService.#resolveHouseholdAppConfigPath` | read AND write path resolution |
| `AppsConfigService.APP_CONFIGS` | the admin per-app editor |
| `YamlConfigFileService.ALLOWED_FILES` | the admin YAML browser allowlist |
| `frontend/…/Admin/utils/adminConfigPaths.js` | the admin UI's fetch paths |

It lives in `shared/` rather than `0_system/config/` because `3_applications/`
may not import `#system/config/*` (rule `apps-no-config-internals`), and a
naming contract is not config internals — no logic, no I/O.

**It is a security boundary.** Because `ALLOWED_FILES` derives from it, adding
an entry grants the admin YAML browser read/write on that file. Never register
a path under an auth directory. (`MASKED_DIRS` is checked before the allowlist,
so a mask still wins — but do not rely on that as the only defence.)

**The admin per-app editor's IDs are not always the registry's app names.**
`AppsConfigService.ADMIN_ID_TO_APP` maps the two that differ: the admin ID
`media` resolves to the app name `media-app`, because the admin edits the
MediaApp SURFACE (browse menu, searchScopes at `household/media/app.yml`) —
never the `media` DOMAIN config (`household/media/config.yml`), which holds
the Plex host and protocol and has no admin editor of its own. The admin ID
`shopping` resolves to the app name `harvest` — the admin calls it Shopping;
the app is `harvest`. Every other admin ID matches its app name directly.

Configs that are NOT in the registry, deliberately:
- `home/dashboard` and `player/config` are read directly via
  `dataService.household.read()` rather than through the app union.
- `triggers/` is bindings, not app config.
- `household.yml`, `integrations.yml` and `hardware/devices.yml` are not app
  configs either. The first two are loaded by `configLoader`'s own dedicated
  loaders (household identity at the household root, `loadHouseholdIntegrations`
  for integrations), not through the `HOUSEHOLD_APP_CONFIGS` union.
  `integrations.yml` is still reachable through the admin YAML browser — it's
  one of the few entries added to `ALLOWED_FILES` by hand rather than derived,
  because `IntegrationsQueryService` is read-only and the file would otherwise
  be editable only by shelling into the container. `household.yml` and
  `hardware/devices.yml` deliberately stay off `ALLOWED_FILES`: both have a
  dedicated admin write surface (`HouseholdAdminService`, including device
  CRUD) instead of the generic YAML browser.

**There is no `apps/`, `common/`, `shared/`, `history/` or `state/` root.**
Those five sat side by side with no rule saying which one a domain belonged in,
so domains drifted into several at once: `fitness`, `gaming`, `piano`, `media`,
`komga`, `school`, `weather` and `automotive` each lived under two roots
simultaneously. The ambiguity was not cosmetic — it produced real bugs,
including a `getHouseholdSharedPath` that hardcoded `'shared'` and made **every
household calendar read return null**, because the file was in `common/`.

Two rules follow:

- **Resolve through `ConfigService.getHouseholdPath(rel, hid)`** (or
  `DataService.household.read/write`). Building `<dataDir>/household/...` by
  hand silently ignores `hid` and always resolves the default household.
- **Per-user data is NOT household data.** It stays at `users/{id}/apps/{app}/`
  and is reached with `getUserDir(userId)`. A domain can have both — `school`
  keeps household assignments and syllabi while each learner's attempts, report
  cards and sittings stay under their own user directory. Renaming one must
  never rename the other.

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
head: user_1

users:
  - user_1
  - user_9
  - user_2
  - user_3

apps:
  fitness:
    primary_users: [user_1, user_2, user_3]
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
token: xxxxx

# household/auth/homeassistant.yml
token: xxxxx
```

---

## User Configuration

### Directory Structure

Location: `data/users/{username}/`

### profile.yml

```yaml
version: "1.0"
username: user_2
household_id: default
display_name: "User_2"
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
configService.getUserAuth('strava', 'user_1');
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
