# ConfigService Migration Plan

**Goal:** Clean separation - .env provides paths only, ConfigService provides all config. No process.env spreading.

## Target Architecture

```
.env
├── DAYLIGHT_DATA_PATH=/path/to/data   ← Required: where config lives
└── DAYLIGHT_ENV=kckern-server         ← Optional: for system-local.{env}.yml

ConfigService.init()
├── Reads DAYLIGHT_DATA_PATH from process.env
├── Loads data/system/system.yml
├── Loads data/system/secrets.yml
├── Merges data/system/system-local.{DAYLIGHT_ENV}.yml (if exists)
├── Loads data/system/apps/*.yml
├── Loads data/households/*/
├── Loads data/users/*/
└── Returns frozen config object (no process.env spreading)
```

### Key Principles
- `.env` contains ONLY two vars: `DAYLIGHT_DATA_PATH` and `DAYLIGHT_ENV`
- Everything else (port, timezone, secrets, auth, app config) lives in YMLs
- All config access goes through ConfigService methods
- No `process.env = {...spread}` anywhere
- Code should never read `process.env.*` except for the two bootstrap vars

---

## Current Violations

### 1. process.env Spreading (6 locations)

These lines dump YAML configs into process.env, breaking clean separation:

| File | Line | Code |
|------|------|------|
| `backend/src/server.mjs` | 72 | `process.env = { ...process.env, isDocker, ...configResult.config }` |
| `backend/src/app.mjs` | 135 | `process.env = { ...process.env, isDocker, ...configResult.config }` |
| `backend/index.js` | 74 | `process.env = { ...process.env, isDocker, ...configResult.config }` |
| `backend/_legacy/app.mjs` | 108 | `process.env = { ...process.env, ...config }` |
| `backend/src/0_infrastructure/logging/config.js` | 139 | `process.env = { ...process.env, ...merged }` |
| `backend/_legacy/chatbots/.../test-debrief-local.mjs` | 37 | `process.env = { ...process.env, ...config }` |

**Action:** Remove all spreading. Pass config explicitly to services.

---

## 2. process.env Usages to Migrate

### Category A: Path Resolution (migrate to ConfigService.getDataDir/getMediaDir)

| File | Usage | Migration |
|------|-------|-----------|
| `app.mjs:172` | `process.env.path?.data \|\| process.env.DATA_PATH` | `configService.getDataDir()` |
| `app.mjs:173` | `process.env.path?.media \|\| process.env.MEDIA_PATH` | `configService.getMediaDir()` |
| `app.mjs:244` | `process.env.path?.watchState` | `configService.getPath('watchState')` |
| `app.mjs:393` | `process.env.path?.img` | `configService.getPath('img')` |
| `placeholderImage.mjs:13` | `process.env.path?.media` | Pass mediaPath as param |
| `UserDataService.mjs:33,86` | `process.env.path?.data` | Already has configService fallback |
| `JournalistContainer.mjs:177-178` | `process.env.path?.data` | Pass dataPath in config |

### Category B: Secrets (migrate to ConfigService.getSecret)

| File | Usage | Migration |
|------|-------|-----------|
| `app.mjs:327` | `process.env.OPENAI_API_KEY` | `configService.getSecret('OPENAI_API_KEY')` |
| `app.mjs:428` | `process.env.OPENAI_API_KEY` | `configService.getSecret('OPENAI_API_KEY')` |
| `app.mjs:564` | `process.env.OPENAI_API_KEY` | `configService.getSecret('OPENAI_API_KEY')` |
| `TTSAdapter.mjs:178` | `process.env.OPENAI_API_KEY` | Pass in config object |
| `logging/config.js:169,176` | `process.env.LOGGLY_TOKEN/SUBDOMAIN` | `configService.getSecret('LOGGLY_*')` |

### Category C: Service Auth (migrate to ConfigService.getHouseholdAuth/getUserAuth)

| File | Usage | Migration |
|------|-------|-----------|
| `app.mjs:227-229` | `process.env.media?.plex` | `configService.getHouseholdAuth('plex')` |
| `app.mjs:403-404` | `process.env.plex?.host/token` | `configService.getHouseholdAuth('plex')` |
| `PlexProxyAdapter.mjs:124-125` | `process.env.plex?.host/token` | Pass in factory config |
| `AudiobookshelfProxyAdapter.mjs:119-120` | `process.env.audiobookshelf` | Pass in factory config |
| `FreshRSSProxyAdapter.mjs:138-141` | `process.env.freshrss` | Pass in factory config |
| `ImmichProxyAdapter.mjs:119-120` | `process.env.immich` | Pass in factory config |
| `WithingsHarvester.mjs:208-213` | `process.env.WITHINGS_*` | `configService.getUserAuth('withings')` |
| `StravaHarvester.mjs:198-200` | `process.env.STRAVA_*` | `configService.getUserAuth('strava')` |
| `TodoistHarvester.mjs:115` | `process.env.TODOIST_KEY` | `configService.getUserAuth('todoist')` |
| `ClickUpHarvester.mjs:122-123` | `process.env.CLICKUP_PK` | `configService.getUserAuth('clickup')` |
| `GCalHarvester.mjs:214` | `process.env.GOOGLE_REFRESH_TOKEN` | `configService.getUserAuth('google')` |
| `GmailHarvester.mjs:187` | `process.env.GOOGLE_REFRESH_TOKEN` | `configService.getUserAuth('google')` |
| `LastfmHarvester.mjs:112` | `process.env.LAST_FM_USER` | `configService.getUserAuth('lastfm')` |
| `FoursquareHarvester.mjs:126` | `process.env.FOURSQUARE_TOKEN` | `configService.getUserAuth('foursquare')` |
| `GoodreadsHarvester.mjs:104` | `process.env.GOODREADS_USER` | `configService.getUserAuth('goodreads')` |
| `LetterboxdHarvester.mjs:104` | `process.env.LETTERBOXD_USER` | `configService.getUserAuth('letterboxd')` |
| `WeatherHarvester.mjs:104-105` | `process.env.WEATHER_LAT/LNG` | `configService.getAppConfig('weather')` |

### Category D: App Config (migrate to ConfigService.getAppConfig)

| File | Usage | Migration |
|------|-------|-----------|
| `app.mjs:280-282` | `process.env.finance?.buxfer` | `configService.getAppConfig('finance', 'buxfer')` |
| `app.mjs:311` | `process.env.home_assistant` | `configService.getAppConfig('home_assistant')` |
| `app.mjs:426` | `process.env.printer` | `configService.getAppConfig('printer')` |
| `app.mjs:427` | `process.env.mqtt` | `configService.getAppConfig('mqtt')` |
| `app.mjs:504` | `process.env.kiosk` | `configService.getAppConfig('kiosk')` |
| `app.mjs:505` | `process.env.tasker` | `configService.getAppConfig('tasker')` |
| `app.mjs:506` | `process.env.remote_exec` | `configService.getAppConfig('remote_exec')` |
| `app.mjs:548` | `process.env.telegram` | `configService.getAppConfig('telegram')` |
| `app.mjs:549` | `process.env.gmail` | `configService.getAppConfig('gmail')` |
| `app.mjs:563` | `process.env.nutribot` | `configService.getAppConfig('nutribot')` |
| `app.mjs:593` | `process.env.journalist` | `configService.getAppConfig('journalist')` |
| `ClickUpHarvester.mjs:95-96` | `process.env.clickup?.statuses` | `configService.getAppConfig('clickup')` |
| `ThermalPrinterAdapter.mjs:894-895` | `process.env.printer` | Pass in factory config |
| `MQTTSensorAdapter.mjs:414-416` | `process.env.mqtt` | Pass in factory config |
| `TTSAdapter.mjs:179-180` | `process.env.TTS_MODEL/VOICE` | Pass in config object |

### Category E: Bootstrap Only (the ONLY allowed env vars)

| Env Var | Purpose |
|---------|---------|
| `DAYLIGHT_DATA_PATH` | Path to data directory |
| `DAYLIGHT_ENV` | Environment name for local overrides |

### Category F: Move to system.yml (currently in process.env)

| File | Current Usage | Migration |
|------|---------------|-----------|
| `logging/config.js:71` | `process.env.NODE_ENV` | `configService.get('env')` or detect from DAYLIGHT_ENV |
| `Scheduler.mjs:29` | `process.env.ENABLE_CRON` | `configService.get('scheduler.enabled')` |
| `server.mjs:135` | `process.env.PORT` | `configService.get('server.port')` |
| `cutoverFlags.mjs:10` | `process.env.CUTOVER_FLAGS_PATH` | `configService.getPath('cutoverFlags')` |
| `PlexAdapter.mjs:212` | `process.env.NODE_ENV` | `configService.get('env')` |
| Various | `process.env.TZ` | `configService.get('timezone')` |

---

## 3. ConfigService Methods Needed

### Existing Methods (use these)
- `getSecret(key)` - for API keys, tokens
- `getDataDir()` - for data path
- `getHouseholdAuth(service, householdId)` - for service auth
- `getUserAuth(service, username)` - for user-specific auth
- `getAppConfig(appName, pathStr)` - for app configs

### New Methods to Add
```javascript
// Path accessors
getMediaDir() → string
getPath(name: 'watchState' | 'img' | ...) → string

// Convenience for common patterns
getPlexConfig(householdId?) → { host, token }
getHomeAssistantConfig(householdId?) → { host, token, entities }
```

---

## 4. Migration Phases

### Phase 1: Add Missing ConfigService Methods
1. Add `getMediaDir()` method
2. Add `getPath(name)` for paths defined in system.yml (watchState, img, etc.)
3. Add `getEnv()` to return DAYLIGHT_ENV value
4. Add convenience getters: `getPlexConfig()`, `getHomeAssistantConfig()`, etc.

### Phase 2: Remove process.env Spreading
1. Remove spreading from `server.mjs`, `app.mjs`, `index.js`
2. Remove `hydrateProcessEnvFromConfigs()` from logging/config.js
3. Simplify `pathResolver.mjs` - only reads DAYLIGHT_DATA_PATH
4. Pass ConfigService instance to domain services explicitly

### Phase 3: Migrate Domain Services
1. Update `app.mjs` - replace all `process.env.X` with ConfigService calls
2. Update harvesters - pass auth config in constructor
3. Update proxy adapters - pass config in factory functions
4. Update hardware adapters - pass config in factory functions

### Phase 4: Migrate Legacy Backend
1. Update `backend/_legacy/app.mjs`
2. Update test files

### Phase 5: Cleanup
1. Remove `DAYLIGHT_CONFIG_PATH` from .env (deprecated)
2. Update .env.example to document allowed vars
3. Add validation that process.env only has allowed keys
4. Delete dead code paths for old env var names

---

## 5. .env Final State

After migration, .env contains ONLY:

```bash
DAYLIGHT_DATA_PATH=/path/to/data
DAYLIGHT_ENV=kckern-server
```

That's it. Two variables:
1. **DAYLIGHT_DATA_PATH** - Where to find `system/system.yml`
2. **DAYLIGHT_ENV** - Which `system-local.{env}.yml` to merge

### Everything Else in YMLs

| What | Where |
|------|-------|
| Port | `system.yml` → `server.port` |
| Timezone | `system.yml` → `timezone` |
| Media path | `system.yml` → `paths.media` |
| API keys, tokens | `secrets.yml` |
| App configs | `apps/*.yml` |
| Household auth | `households/*/auth/*.yml` |
| User auth | `users/*/auth/*.yml` |
| Scheduler enabled | `system.yml` → `scheduler.enabled` |

### NOT Allowed in .env

```bash
# None of these belong in .env
NODE_ENV=production     # → system.yml
PORT=3111               # → system.yml
TZ=America/Los_Angeles  # → system.yml
ENABLE_CRON=true        # → system.yml
OPENAI_API_KEY=...      # → secrets.yml
PLEX_TOKEN=...          # → households/*/auth/plex.yml
```

---

## 6. Verification Checklist

After migration:
- [ ] `grep -r "process\.env\." backend/src/` shows only Category E usages
- [ ] `grep -r "process\.env\s*=" backend/` returns empty
- [ ] All tests pass
- [ ] Server starts without config errors
- [ ] All services (Plex, HA, harvesters) work correctly
