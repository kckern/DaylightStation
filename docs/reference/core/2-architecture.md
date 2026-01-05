# DaylightStation Three-Tier Architecture

**Version:** 2.0 (Consolidated)  
**Date:** December 30, 2025  
**Status:** Draft for Implementation

---

## Executive Summary

DaylightStation requires a consistent three-tier data architecture to support:
- **Multi-household deployment** - Multiple families using the same codebase
- **Multi-user support** - Each family member with their own accounts/credentials
- **Clean separation of concerns** - System infrastructure vs. household services vs. personal data

### The Three Tiers

| Tier | Scope | Examples | Storage Path |
|------|-------|----------|--------------|
| **System** | Infrastructure shared across ALL households | Database, logging, AI keys, OAuth app registrations | `config/config.secrets.yml` |
| **Household** | Shared within a family | Plex, Home Assistant, family calendar, weather | `data/households/{hid}/` |
| **User** | Personal per individual | Gmail, Todoist, Garmin, Strava, fitness data | `data/users/{username}/` |

---

## Directory Structure

```
DaylightStation/
│
├── config/                                    # SYSTEM LEVEL
│   ├── config.app.yml                         # App configuration
│   ├── config.secrets.yml                     # System-level secrets only
│   └── system.yml                             # System settings
│
└── data/
    │
    ├── households/                            # HOUSEHOLD LEVEL
    │   ├── default/
    │   │   ├── household.yml                  # Household config (users list, head, timezone)
    │   │   │
    │   │   ├── auth/                          # 🆕 Household credentials
    │   │   │   ├── plex.yml
    │   │   │   ├── home_assistant.yml
    │   │   │   ├── clickup.yml
    │   │   │   ├── weather.yml
    │   │   │   ├── infinity.yml
    │   │   │   ├── buxfer.yml
    │   │   │   └── foursquare.yml
    │   │   │
    │   │   ├── apps/                          # Household app config
    │   │   │   ├── fitness/config.yml
    │   │   │   └── finances/config.yml
    │   │   │
    │   │   ├── shared/                        # Household shared data
    │   │   │   ├── calendar.yml               # Aggregated family calendar
    │   │   │   ├── weather.yml                # Cached weather data
    │   │   │   └── gratitude/                 # Shared gratitude selections
    │   │   │
    │   │   └── history/                       # Household history/state
    │   │       ├── watchlist.yml
    │   │       └── media_memory/
    │   │
    │   └── {other-household}/                 # Additional households
    │
    └── users/                                 # USER LEVEL
        ├── {username}/
        │   ├── profile.yml                    # User profile & preferences
        │   │
        │   ├── auth/                          # User credentials
        │   │   ├── google.yml                 # Personal Gmail/Calendar OAuth
        │   │   ├── todoist.yml                # Personal task API key
        │   │   ├── garmin.yml                 # Personal fitness tracker
        │   │   ├── strava.yml                 # ✅ Already working
        │   │   ├── withings.yml               # ✅ Already working
        │   │   ├── lastfm.yml                 # Personal music profile
        │   │   ├── letterboxd.yml             # Personal movie diary
        │   │   └── goodreads.yml              # Personal reading list
        │   │
        │   └── lifelog/                       # User lifelog data
        │       ├── events.yml                 # Calendar events
        │       ├── garmin.yml                 # Garmin activities
        │       ├── fitness.yml                # Aggregated fitness
        │       ├── strava.yml                 # Strava workouts
        │       ├── health.yml                 # Apple Health data
        │       ├── todoist.yml                # Tasks
        │       ├── withings.yml               # Scale data
        │       └── nutrition/
        │           ├── nutrilog.yml
        │           ├── nutriday.yml
        │           └── nutricoach.yml
        │
        ├── elizabeth/
        │   ├── profile.yml
        │   ├── auth/                          # Her own credentials
        │   └── lifelog/
        │
        └── {other-users}/
```

---

## Complete I/O API

### API Overview

| Tier | Data Functions | Auth Functions | Config Helpers |
|------|----------------|----------------|----------------|
| **System** | `loadFile(path)` | N/A (env vars) | `loadFile('config/...')` |
| **Household** | `householdLoadFile(hid, path)` | `householdLoadAuth(hid, service)` | `householdLoadConfig(hid)` |
| **User** | `userLoadFile(username, service)` | `userLoadAuth(username, service)` | `userLoadProfile(username)` |

### Function Reference

```javascript
// =============================================================================
// SYSTEM LEVEL - config/, state/
// =============================================================================

loadFile(path)                      // loadFile('config/apps/fitness')
saveFile(path, data)                // saveFile('state/cron', data)

// System auth: accessed via process.env (loaded from config.secrets.yml)
// e.g., process.env.MYSQL_HOST, process.env.OPENAI_API_KEY

// =============================================================================
// HOUSEHOLD LEVEL - households/{hid}/
// =============================================================================

householdLoadFile(hid, path)        // householdLoadFile('default', 'shared/calendar')
householdSaveFile(hid, path, data)  // householdSaveFile('default', 'shared/weather', data)
householdLoadAuth(hid, service)     // householdLoadAuth('default', 'plex')
householdSaveAuth(hid, service, data)
householdLoadConfig(hid)            // Returns household.yml contents
getCurrentHouseholdId()             // Returns 'default' or configured hid

// =============================================================================
// USER LEVEL - users/{username}/
// =============================================================================

userLoadFile(username, service)     // userLoadFile('{username}', 'events')
userSaveFile(username, service, data)
userLoadAuth(username, service)     // userLoadAuth('{username}', 'strava')
userSaveAuth(username, service, data)
userLoadProfile(username)           // Returns profile.yml contents
getDefaultUsername()                // Returns head of household
```

### Path Resolution

| Function | Example | Resolves To |
|----------|---------|-------------|
| `loadFile('state/cron')` | System | `{dataDir}/state/cron.yml` |
| `householdLoadFile('default', 'shared/calendar')` | Household | `{dataDir}/households/default/shared/calendar.yml` |
| `householdLoadAuth('default', 'plex')` | Household | `{dataDir}/households/default/auth/plex.yml` |
| `userLoadFile('{username}', 'events')` | User | `{dataDir}/users/{username}/lifelog/events.yml` |
| `userLoadAuth('{username}', 'strava')` | User | `{dataDir}/users/{username}/auth/strava.yml` |

### Implementation Status

| Function | Status | Notes |
|----------|--------|-------|
| `loadFile` / `saveFile` | ✅ Exists | Core functions in io.mjs |
| `userLoadFile` / `userSaveFile` | ✅ Exists | With legacy path fallback |
| `userLoadAuth` / `userSaveAuth` | ✅ Exists | Used by strava.mjs, withings.mjs |
| `userLoadProfile` | ✅ Implemented | Returns profile.yml contents |
| `getDefaultUsername` | ✅ Implemented | Head of household from config |
| `householdLoadFile` / `householdSaveFile` | ✅ Implemented | New functions |
| `householdLoadAuth` / `householdSaveAuth` | ✅ Implemented | With env fallback during migration |
| `householdLoadConfig` | ✅ Implemented | Returns household.yml contents |
| `getCurrentHouseholdId` | ✅ Implemented | From env or defaults to 'default' |

---

## Credential Classification

### Current config.secrets.yml Analysis

| Key | Current | Correct Tier | Action |
|-----|---------|--------------|--------|
| **✅ Keep at System** ||||
| `MYSQL_*` | System | System | ✅ Keep |
| `LOGGLY_*` | System | System | ✅ Keep |
| `OPENAI_API_KEY` | System | System | ✅ Keep |
| `TELEGRAM_*_BOT_TOKEN` | System | System | ✅ Keep |
| `GOOGLE_CLIENT_ID/SECRET` | System | System | ✅ Keep (OAuth app) |
| `STRAVA_CLIENT_ID/SECRET` | System | System | ✅ Keep (OAuth app) |
| `WITHINGS_CLIENT/SECRET` | System | System | ✅ Keep (OAuth app) |
| `FITSYNC_CLIENT_ID/SECRET` | System | System | ✅ Keep (OAuth app) |
| `LAST_FM_API_KEY` | System | System | ✅ Keep (app key) |
| `ED_APP_ID/KEY`, `UPCITE` | System | System | ✅ Keep (app keys) |
| **❌ Move to Household** ||||
| `PLEX_TOKEN` | System | Household | → `households/{hid}/auth/plex.yml` |
| `HOME_ASSISTANT_TOKEN` | System | Household | → `households/{hid}/auth/home_assistant.yml` |
| `CLICKUP_PK` | System | Household | → `households/{hid}/auth/clickup.yml` |
| `OPEN_WEATHER_API_KEY` | System | Household | → `households/{hid}/auth/weather.yml` |
| `INFINITY_*` | System | Household | → `households/{hid}/auth/infinity.yml` |
| `BUXFER_EMAIL/PW` | System | Household | → `households/{hid}/auth/buxfer.yml` |
| `PAYROLL_*` | System | Household | → `households/{hid}/auth/payroll.yml` |
| `FOURSQUARE_TOKEN` | System | Household | → `households/{hid}/auth/foursquare.yml` |
| `MEMOS_TOKEN` | System | Household | → `households/{hid}/auth/memos.yml` |
| `FULLY_KIOSK_PASSWORD` | System | Household | → `households/{hid}/auth/fully_kiosk.yml` |
| `IFTTT_KEY` | System | Household | → `households/{hid}/auth/ifttt.yml` |
| **❌ Move to User** ||||
| `GOOGLE_REFRESH_TOKEN` | System | User | → `users/{username}/auth/google.yml` |
| `GGL_ACCESS` | System | User | → `users/{username}/auth/google.yml` |
| `TODOIST_KEY` | System | User | → `users/{username}/auth/todoist.yml` |
| `GARMIN_USERNAME/PASSWORD` | System | User | → `users/{username}/auth/garmin.yml` |
| `LAST_FM_USER` | System | User | → `users/{username}/auth/lastfm.yml` |
| `LETTERBOXD_USER` | System | User | → `users/{username}/auth/letterboxd.yml` |
| `GOODREADS_USER` | System | User | → `users/{username}/auth/goodreads.yml` |

**Summary:** 12 keys correct ✅ | 11 keys → Household | 7 keys → User

### Auth File Schemas

#### Household Auth Examples
```yaml
# households/default/auth/plex.yml
token: SZMcgR9vv5ntHSaezzBE
server_url: http://plex.local:32400

# households/default/auth/home_assistant.yml
token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
base_url: http://homeassistant.local:8123

# households/default/auth/clickup.yml
api_key: pk_5827339_33M0N3ALR432W2KK2DQ3QAQ2EPO2NIF2
workspace_id: 3833120
```

#### User Auth Examples
```yaml
# users/{username}/auth/google.yml
refresh_token: 1//05jfC5qCi3EQLCgYIARAAGAUSNwF-L9Ir...
access_token: ya29.HgKyffpDVvwLJqalK66uPP7w_k4TbFk3A...
expiresAt: 1767136504
services: [gmail, calendar, photos]

# users/{username}/auth/todoist.yml
api_key: 2e7c36ec309986be3349a55ae95fc4bb90f83656

# users/{username}/auth/garmin.yml
username: user@example.com
password: buEpVyv,cdRosiUwxFB7

# users/{username}/auth/strava.yml (✅ already working)
refresh: 845dfacce657333c4c813a61d8fdb33783e389e6
access_token: 9bccd5b5d088e911906ea40c1ec179b58141ceff
expires_at: 1767136504
```

---

## Data Sources Assessment

### Available Lifelog Data (User Level)

| Source | Path | Harvester | Data Quality |
|--------|------|-----------|--------------|
| **Calendar Events** | `lifelog/events.yml` | `/harvest/gcal` | 🟢 Excellent |
| **Garmin Activities** | `lifelog/garmin.yml` | `/harvest/garmin` | 🟢 Excellent |
| **Fitness Aggregated** | `lifelog/fitness.yml` | `/harvest/fitness` | 🟢 Excellent |
| **Strava Workouts** | `lifelog/strava.yml` | `/harvest/strava` | 🟢 Excellent |
| **Tasks (Todoist)** | `lifelog/todoist.yml` | `/harvest/todoist` | 🟢 Excellent |
| **Nutrition** | `lifelog/nutrition/nutriday.yml` | Internal | 🟢 Excellent |
| **Body Metrics** | `lifelog/withings.yml` | `/harvest/withings` | 🟢 Good |
| **Health** | `lifelog/health.yml` | `/harvest/health` | 🟢 Good |
| **Music (Last.fm)** | `lifelog/lastfm.yml` | `/harvest/lastfm` | 🟡 TBD |
| **Movies** | `lifelog/letterboxd.yml` | `/harvest/letterboxd` | 🟡 TBD |
| **Email** | `lifelog/gmail.yml` | `/harvest/gmail` | 🟡 TBD |

### Sample Data Structures

#### Calendar Events
```yaml
- id: 6eh88r2gsfco9o1184ubip3mde_20251218T193000Z
  start: '2025-12-18T11:30:00-08:00'
  end: '2025-12-18T12:30:00-08:00'
  duration: 1
  summary: Third-Thursday Zoom Lunch
  type: calendar
  location: https://us02web.zoom.us/j/81151274466
  calendarName: Family Calendar
  allday: false
```

#### Garmin Activities
```yaml
'2025-12-27':
  - date: '2025-12-27'
    activityId: 21368123280
    activityName: Cardio
    duration: 67
    calories: 345
    averageHR: 98
    maxHR: 161
    hrZones: [22, 13, 6, 1, 0]
```

#### Fitness Aggregated
```yaml
'2025-09-17':
  steps:
    steps_count: 6345
    calories: 108
    maxHeartRate: 110
    avgHeartRate: 67
  activities:
    - title: Strength Training
      calories: 106
      minutes: 41.78
      startTime: 06:01 am
      avgHeartrate: 77
```

#### Tasks (Todoist)
```yaml
- id: '9106200118'
  projectId: '2331848314'
  content: Add Memos to Amazon Transactions
  isCompleted: false
  priority: 1
  createdAt: '2025-04-27T00:16:11.892562Z'
  due: null
```

---

## Harvester Updates Required

After migration, harvesters need to use the correct auth source:

### User-Level Harvesters
```javascript
// backend/lib/gcal.mjs - BEFORE
const { GOOGLE_REFRESH_TOKEN } = process.env;

// backend/lib/gcal.mjs - AFTER
const username = req.targetUsername || getDefaultUsername();
const auth = userLoadAuth(username, 'google');
const { refresh_token } = auth;
// CLIENT_ID/SECRET still from system config (OAuth app registration)
```

### Household-Level Harvesters
```javascript
// backend/lib/plex.mjs - BEFORE
const { PLEX_TOKEN } = process.env;

// backend/lib/plex.mjs - AFTER
const hid = getCurrentHouseholdId();
const auth = householdLoadAuth(hid, 'plex');
const { token } = auth;
```

### Harvesters by Auth Level

| Harvester | Auth Level | Auth Source |
|-----------|------------|-------------|
| `gcal` | User | `userLoadAuth(username, 'google')` |
| `gmail` | User | `userLoadAuth(username, 'google')` |
| `todoist` | User | `userLoadAuth(username, 'todoist')` |
| `garmin` | User | `userLoadAuth(username, 'garmin')` |
| `strava` | User | `userLoadAuth(username, 'strava')` ✅ |
| `withings` | User | `userLoadAuth(username, 'withings')` ✅ |
| `lastfm` | User | `userLoadAuth(username, 'lastfm')` |
| `letterboxd` | User | `userLoadAuth(username, 'letterboxd')` |
| `goodreads` | User | `userLoadAuth(username, 'goodreads')` |
| `plex` | Household | `householdLoadAuth(hid, 'plex')` |
| `weather` | Household | `householdLoadAuth(hid, 'weather')` |
| `clickup` | Household | `householdLoadAuth(hid, 'clickup')` |
| `budget` | Household | `householdLoadAuth(hid, 'buxfer')` |

---

## Test Harness

### CLI Interface

```bash
# Run all validation
node cli/auth-validator.cli.mjs

# Test specific tier
node cli/auth-validator.cli.mjs --tier system
node cli/auth-validator.cli.mjs --tier household --hid default
node cli/auth-validator.cli.mjs --tier user --username {username}

# Dry-run (check files only, no API calls)
node cli/auth-validator.cli.mjs --dry-run

# JSON output for CI
node cli/auth-validator.cli.mjs --json
```

### Validation Categories

1. **File Existence** - Auth files present with required keys
2. **API Connectivity** - Tokens valid, can connect to services
3. **Harvester Readiness** - Each harvester has required auth at correct level

### Expected Output

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                    DaylightStation Auth Validator                            ║
╠══════════════════════════════════════════════════════════════════════════════╣
║ Household: default    User: {username}    Mode: full                         ║
╚══════════════════════════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────────────────────┐
│ SYSTEM LEVEL                                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│ ✅ MYSQL_HOST              │ 54.190.52.236                                  │
│ ✅ OPENAI_API_KEY          │ sk-NTh...nS (valid)                            │
│ ✅ TELEGRAM_NUTRIBOT       │ @NutribotDev                                   │
│ ✅ GOOGLE_CLIENT_ID        │ 441580976495-...                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                                          System: 9/9 passed ✅

┌─────────────────────────────────────────────────────────────────────────────┐
│ HOUSEHOLD LEVEL (default)                                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│ ✅ plex                    │ Connected (user: {username})                   │
│ ✅ home_assistant          │ Connected                                      │
│ ✅ clickup                 │ Connected (user: {username})                   │
│ ✅ weather                 │ API key valid                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                                       Household: 4/4 req ✅

┌─────────────────────────────────────────────────────────────────────────────┐
│ USER LEVEL ({username})                                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│ ✅ google                  │ OAuth token valid                              │
│ ✅ todoist                 │ API key valid                                  │
│ ✅ garmin                  │ Credentials present                            │
│ ✅ strava                  │ OAuth token valid                              │
│ ✅ withings                │ OAuth token valid                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                                            User: 5/5 req ✅

══════════════════════════════════════════════════════════════════════════════
  SUMMARY: 18/18 required checks passed ✅
══════════════════════════════════════════════════════════════════════════════
```

---

## Implementation Roadmap

### Phase 0: Infrastructure (Day 1) ✅ COMPLETE
- [x] Add `householdLoadFile()` / `householdSaveFile()` to io.mjs
- [x] Add `householdLoadAuth()` / `householdSaveAuth()` to io.mjs
- [x] Add `getCurrentHouseholdId()` helper
- [x] Add `userLoadProfile()` helper
- [x] Add `getDefaultUsername()` helper
- [x] Create `data/households/default/auth/` directory

### Phase 1: Household Auth Migration (Day 1-2) ✅ COMPLETE
- [x] Create household auth files from current secrets (11 files)
- [x] Update `plex.mjs` to use `householdLoadAuth`
- [x] Update `homeassistant.mjs` to use `householdLoadAuth`
- [x] Update `clickup.mjs` to use `householdLoadAuth`
- [x] Update `weather.mjs` to use `householdLoadAuth`
- [x] Update `buxfer.mjs` to use `householdLoadAuth`
- [x] Test all household-level harvesters (20/20 tests passed)

### Phase 2: User Auth Migration (Day 2-3) ✅ COMPLETE
- [x] Create user auth files from current secrets (6 new files)
- [x] Update `gcal.mjs` to use `userLoadAuth`
- [x] Update `gmail.mjs` to use `userLoadAuth`
- [x] Update `todoist.mjs` to use `userLoadAuth`
- [x] Update `garmin.mjs` to use `userLoadAuth`
- [x] Update `lastfm.mjs` to use `userLoadAuth`
- [x] Update `letterboxd.mjs` to use `userLoadAuth`
- [x] Update `goodreads.mjs` to use `userLoadAuth`
- [x] Test all user-level harvesters (26/26 tests passed)

### Phase 3: Cleanup (Day 3) ✅ COMPLETE
- [x] Create auth-validator CLI tool (35/35 checks passed)
- [x] Run full validation suite
- [x] Document secrets safe to remove (see below)
- [x] Document migration in changelog

#### Secrets Safe to Remove from config.secrets.yml

After migration, these secrets are now stored in tiered auth files and can be removed from `config.secrets.yml`:

**Migrated to Household Auth (`data/households/default/auth/`):**
- `PLEX_TOKEN` → `plex.yml`
- `HOME_ASSISTANT_TOKEN` → `home_assistant.yml`
- `CLICKUP_PK` → `clickup.yml`
- `OPEN_WEATHER_API_KEY` → `weather.yml`
- `BUXFER_EMAIL`, `BUXFER_PW` → `buxfer.yml`
- `INFINITY_WORKSPACE`, `INFINITY_CLI`, `INFINITY_CLIS`, `INFINITY_DEV` → `infinity.yml`
- `FOURSQUARE_TOKEN` → `foursquare.yml`
- `MEMOS_TOKEN` → `memos.yml`
- `PAYROLL_AUTH`, `PAYROLL_BASE`, `PAYROLL_COMPANY`, `PAYROLL_EMPLOYEE`, `PAYROLL_AUTHKEY` → `payroll.yml`
- `IFTTT_KEY` → `ifttt.yml`
- `FULLY_KIOSK_PASSWORD` → `fully_kiosk.yml`

**Migrated to User Auth (`data/users/{username}/auth/`):**
- `GOOGLE_REFRESH_TOKEN`, `GGL_ACCESS` → `google.yml`
- `TODOIST_KEY` → `todoist.yml`
- `GARMIN_USERNAME`, `GARMIN_PASSWORD` → `garmin.yml`
- `LAST_FM_USER` → `lastfm.yml`
- `LETTERBOXD_USER` → `letterboxd.yml`
- `GOODREADS_USER` → `goodreads.yml`

**Keep in config.secrets.yml (System Level):**
- `MYSQL_*` - Database credentials
- `LOGGLY_*` - Logging service
- `OPENAI_API_KEY` - AI service
- `TELEGRAM_*_BOT_TOKEN` - Bot tokens (app-level)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - OAuth app registration
- `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` - OAuth app registration
- `WITHINGS_CLIENT`, `WITHINGS_SECRET` - OAuth app registration
- `FITSYNC_CLIENT_ID`, `FITSYNC_CLIENT_SECRET` - OAuth app registration
- `LAST_FM_API_KEY` - App API key (not user-specific)
- `ED_APP_ID`, `ED_APP_KEY`, `UPCITE` - App API keys

### Phase 4: Journalist Integration (Day 4+)
- [ ] JournalistContainer uses UserResolver for username
- [ ] LifelogAggregator uses `userLoadFile(username, service)`
- [ ] Morning debrief pulls from correct user's lifelog
- [ ] Multi-user testing

---

## Migration Script

```javascript
// scripts/migrate-secrets-to-tiers.mjs
import { householdSaveAuth, userSaveAuth, loadFile } from '../backend/lib/io.mjs';

const HOUSEHOLD_ID = 'default';
const PRIMARY_USER = '{username}';

// Load current secrets
const secrets = process.env;

// Household migrations
const householdAuth = {
  plex: { token: secrets.PLEX_TOKEN },
  home_assistant: { token: secrets.HOME_ASSISTANT_TOKEN, base_url: 'http://homeassistant.local:8123' },
  clickup: { api_key: secrets.CLICKUP_PK, workspace_id: '3833120' },
  weather: { api_key: secrets.OPEN_WEATHER_API_KEY },
  infinity: { workspace: secrets.INFINITY_WORKSPACE, cli_token: secrets.INFINITY_CLI },
  buxfer: { email: secrets.BUXFER_EMAIL, password: secrets.BUXFER_PW },
  foursquare: { token: secrets.FOURSQUARE_TOKEN },
  memos: { token: secrets.MEMOS_TOKEN },
};

// User migrations
const userAuth = {
  google: { refresh_token: secrets.GOOGLE_REFRESH_TOKEN, access_token: secrets.GGL_ACCESS },
  todoist: { api_key: secrets.TODOIST_KEY },
  garmin: { username: secrets.GARMIN_USERNAME, password: secrets.GARMIN_PASSWORD },
  lastfm: { username: secrets.LAST_FM_USER },
  letterboxd: { username: secrets.LETTERBOXD_USER },
  goodreads: { user_id: secrets.GOODREADS_USER },
};

// Execute
console.log('=== Migrating Household Auth ===');
for (const [service, data] of Object.entries(householdAuth)) {
  if (Object.values(data).some(v => v)) {
    householdSaveAuth(HOUSEHOLD_ID, service, data);
    console.log(`✅ households/${HOUSEHOLD_ID}/auth/${service}.yml`);
  }
}

console.log('\n=== Migrating User Auth ===');
for (const [service, data] of Object.entries(userAuth)) {
  if (Object.values(data).some(v => v)) {
    userSaveAuth(PRIMARY_USER, service, data);
    console.log(`✅ users/${PRIMARY_USER}/auth/${service}.yml`);
  }
}

console.log('\n✅ Migration complete!');
```

---

## Summary

| Metric | Before | After |
|--------|--------|-------|
| **Secrets in config.secrets.yml** | 30+ mixed | 12 system-only |
| **Household auth files** | 0 | 11 |
| **User auth files** | 3 (strava, withings, fitnesssyncer) | 9 |
| **Multi-user ready** | ❌ No | ✅ Yes |
| **Multi-household ready** | ❌ No | ✅ Yes |
| **Auth validation** | Manual | Automated CLI |

**Total Implementation Time:** ~3-4 days

**Prerequisite For:**
- Journalist Bot 2.0 multi-user support
- Family member onboarding
- Future household deployment
# Harvester Bifurcation: Lifelog vs Current Data

**Version:** 1.0  
**Date:** December 31, 2025  
**Status:** Design Document

---

## Executive Summary

Several harvesters (Gmail, ClickUp, Todoist, Calendar/Events) collect data that serves **dual purposes**:
1. **Lifelog (Past)** - Historical records of completed actions (sent emails, finished tasks, past events)
2. **Current (Present)** - Active items requiring attention (unread inbox, pending tasks, upcoming events)

This document proposes a clean bifurcation strategy to separate these concerns, enabling:
- **Lifelog extractors** to pull from historical/completed data
- **Upcoming module** to pull from current/pending data
- **Entropy metrics** to use both (days-since from lifelog, pending counts from current)

---

## Problem Statement

### Current Architecture Issues

| Harvester | Current Behavior | Problem |
|-----------|------------------|---------|
| **Gmail** | Saves inbox messages only | No date field; can't distinguish read vs unread history |
| **Todoist** | Saves open tasks only | No completion dates; lifelog can't see what was done |
| **ClickUp** | Saves in-progress tasks only | No `date_done`; lifelog can't track completed work |
| **Calendar** | Saves upcoming events only | Past events pruned; lifelog can't reconstruct day's schedule |

### Data Flow Confusion

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Harvester  │────▶│  Single YML File │◀────│  Multiple Readers│
│  (mixed)    │     │  (mixed data)    │     │  (confused)      │
└─────────────┘     └──────────────────┘     └──────────────────┘
                                                    │
                    ┌───────────────────────────────┼───────────────────────┐
                    │                               │                       │
                    ▼                               ▼                       ▼
            ┌──────────────┐              ┌──────────────┐         ┌──────────────┐
            │ Upcoming.jsx │              │  Lifelog     │         │  Entropy     │
            │ (wants curr) │              │  Extractors  │         │  (wants both)│
            └──────────────┘              │  (wants past)│         └──────────────┘
                                          └──────────────┘
```

---

## Proposed Architecture

### Directory Structure

```
data/
└── users/{username}/
    ├── lifelog/                    # PAST DATA (historical, date-keyed)
    │   ├── gmail.yml               # Emails by date (sent, received, archived)
    │   ├── todoist.yml             # Tasks by completion date
    │   ├── clickup.yml             # Tasks by completion date
    │   ├── calendar.yml            # Events by occurrence date
    │   ├── events.yml              # Aggregated events (deprecated, merge into calendar)
    │   └── ...                     # Other lifelog sources
    │
    └── current/                    # PRESENT DATA (active, ephemeral)
        ├── gmail.yml               # Current inbox (unread/flagged)
        ├── todoist.yml             # Open tasks with due dates
        ├── clickup.yml             # In-progress tickets
        ├── calendar.yml            # Upcoming events (next 6 weeks)
        └── events.yml              # Aggregated upcoming items

households/{hid}/
└── shared/
    ├── events.yml                  # Household aggregated upcoming events (for TV display)
    └── current/                    # Household-level current data
        └── calendar.yml            # Shared family calendar (upcoming)
```

### Data Flow (Bifurcated)

```
┌─────────────────┐
│    Harvester    │
│  (fetches ALL)  │
└────────┬────────┘
         │
         ├─────────────────────────────────────┐
         │                                     │
         ▼                                     ▼
┌─────────────────────────┐       ┌─────────────────────────┐
│  users/{u}/lifelog/     │       │  users/{u}/current/     │
│  ─────────────────────  │       │  ─────────────────────  │
│  • Date-keyed history   │       │  • Active items only    │
│  • Completed tasks      │       │  • Pending tasks        │
│  • Past events          │       │  • Upcoming events      │
│  • Sent/archived mail   │       │  • Unread inbox         │
└────────────┬────────────┘       └────────────┬────────────┘
             │                                 │
             ▼                                 ▼
┌─────────────────────────┐       ┌─────────────────────────┐
│   Lifelog Extractors    │       │     Upcoming Module     │
│   ─────────────────────  │       │   ─────────────────────  │
│   • Morning debrief     │       │   • TV display widget   │
│   • Journalist context  │       │   • What's next panel   │
│   • Historical queries  │       │   • Real-time updates   │
└─────────────────────────┘       └─────────────────────────┘
             │                                 │
             └────────────────┬────────────────┘
                              ▼
                    ┌─────────────────────────┐
                    │      Entropy Module     │
                    │   ─────────────────────  │
                    │   • Days-since (lifelog)│
                    │   • Item counts (curr)  │
                    └─────────────────────────┘
```

---

## Per-Harvester Bifurcation Design

### 1. Gmail Harvester

**API Capabilities:**
- List messages with query filters (`is:inbox`, `is:unread`, `after:YYYY/MM/DD`)
- Get message details including `internalDate`, `labelIds`

**Bifurcation Logic:**

| Destination | What Gets Saved | Rationale |
|-------------|-----------------|-----------|
| **Lifelog** | All sent emails + inbox emails received TODAY | Captures outbound communication and "important enough to keep" inbound |
| **Current** | All emails currently in inbox | Shows active inbox state for entropy/attention metrics |

**Proposed Changes:**

```javascript
// backend/lib/gmail.mjs

const listMails = async (logger, job_id, targetUsername = null) => {
    // ... auth setup ...
    
    const today = moment().format('YYYY-MM-DD');
    
    // === CURRENT DATA: All emails currently in inbox ===
    const inboxQuery = 'is:inbox';
    const { data: inboxData } = await gmail.users.messages.list({ 
        userId: 'me', 
        q: inboxQuery,
        maxResults: 100 
    });
    
    const inboxMessages = await Promise.all(
        (inboxData.messages || []).map(async msg => {
            const { data } = await gmail.users.messages.get({ userId: 'me', id: msg.id });
            return formatMessage(data);
        })
    );
    
    // Save to current/
    userSaveCurrent(username, 'gmail', {
        lastUpdated: new Date().toISOString(),
        unreadCount: inboxMessages.filter(m => m.isUnread).length,
        totalCount: inboxMessages.length,
        messages: inboxMessages
    });
    
    // === LIFELOG DATA ===
    // 1. All sent emails (last 7 days for incremental harvest)
    const weekAgo = moment().subtract(7, 'days').format('YYYY/MM/DD');
    const sentQuery = `is:sent after:${weekAgo}`;
    const { data: sentData } = await gmail.users.messages.list({
        userId: 'me',
        q: sentQuery,
        maxResults: 200
    });
    
    const sentMessages = await Promise.all(
        (sentData.messages || []).map(async msg => {
            const { data } = await gmail.users.messages.get({ userId: 'me', id: msg.id });
            return { ...formatMessage(data), category: 'sent' };
        })
    );
    
    // 2. Inbox emails received TODAY (still in inbox = deemed important)
    const todaysInboxMessages = inboxMessages
        .filter(m => m.date === today && !m.isSent)
        .map(m => ({ ...m, category: 'received' }));
    
    // Combine and merge into date-keyed lifelog
    const lifelogMessages = [...sentMessages, ...todaysInboxMessages];
    const existingLifelog = userLoadFile(username, 'gmail') || {};
    const updatedLifelog = mergeByDate(existingLifelog, lifelogMessages);
    userSaveFile(username, 'gmail', updatedLifelog);
    
    return { 
        current: inboxMessages.length, 
        lifelog: { sent: sentMessages.length, received: todaysInboxMessages.length }
    };
};

// Helper: Format message with date
const formatMessage = (data) => {
    const headers = data.payload.headers;
    const internalDate = new Date(parseInt(data.internalDate));
    
    return {
        id: data.id,
        date: moment(internalDate).format('YYYY-MM-DD'),
        time: moment(internalDate).format('HH:mm'),
        subject: sanitize(headers.find(h => h.name === 'Subject')?.value || 'No Subject'),
        from: sanitize(headers.find(h => h.name === 'From')?.value || 'Unknown'),
        to: sanitize(headers.find(h => h.name === 'To')?.value || 'Unknown'),
        snippet: sanitize(data.snippet),
        isUnread: data.labelIds?.includes('UNREAD'),
        isSent: data.labelIds?.includes('SENT')
    };
};

// Helper: Merge messages by date into lifelog structure
const mergeByDate = (existing, newMessages) => {
    const merged = { ...existing };
    for (const msg of newMessages) {
        if (!merged[msg.date]) merged[msg.date] = [];
        if (!merged[msg.date].find(m => m.id === msg.id)) {
            merged[msg.date].push(msg);
        }
    }
    // Sort each day's messages by time
    for (const date of Object.keys(merged)) {
        merged[date].sort((a, b) => a.time.localeCompare(b.time));
    }
    return merged;
};
```

**Data Structures:**

```yaml
# users/{username}/current/gmail.yml
lastUpdated: '2025-12-31T10:30:00Z'
unreadCount: 12
totalCount: 45
messages:
  - id: '1947f...'
    date: '2025-12-31'
    time: '09:15'
    subject: 'Your order has shipped'
    from: 'Amazon <ship-confirm@amazon.com>'
    isUnread: true
    isSent: false
  - id: '1946b...'
    date: '2025-12-28'
    time: '14:30'
    subject: 'Old email still in inbox'
    from: 'newsletter@example.com'
    isUnread: false
    isSent: false

# users/{username}/lifelog/gmail.yml  
'2025-12-31':
  - id: '1947a...'
    time: '08:30'
    subject: 'Re: Project update'
    from: 'kckern@gmail.com'
    to: 'colleague@company.com'
    category: sent
  - id: '1947f...'
    time: '09:15'
    subject: 'Your order has shipped'
    from: 'Amazon <ship-confirm@amazon.com>'
    category: received         # Still in inbox at harvest = important
'2025-12-30':
  - id: '1946c...'
    time: '16:45'
    subject: 'Meeting confirmation'
    from: 'kckern@gmail.com'
    to: 'boss@company.com'
    category: sent
```

**Note:** Received emails only appear in lifelog if they're still in the inbox at harvest time. This naturally filters out spam/noise (which gets deleted) and captures emails the user deemed worth keeping.
```

---

### 2. Todoist Harvester

**API Capabilities:**
- `getTasks()` - Returns only uncompleted tasks
- `getCompletedTasks()` - Returns completed tasks with `completed_at` timestamp (requires Pro plan or use activity log)

**Proposed Changes:**

```javascript
// backend/lib/todoist.mjs

const getTasks = async (logger, job_id, targetUsername = null) => {
    // ... auth setup ...
    
    // === CURRENT DATA: Open tasks ===
    const openTasks = await api.getTasks();
    const currentTasks = openTasks.map(task => ({
        id: task.id,
        content: task.content,
        description: task.description,
        priority: task.priority,
        dueDate: task.due?.date || null,
        dueString: task.due?.string || null,
        projectId: task.projectId,
        labels: task.labels,
        url: task.url
    }));
    
    userSaveFile(username, 'current/todoist', {
        lastUpdated: new Date().toISOString(),
        taskCount: currentTasks.length,
        tasks: currentTasks
    });
    
    // === LIFELOG DATA: Completed tasks (last 7 days) ===
    // Option A: Use Activity Log API (available on all plans)
    const since = moment().subtract(7, 'days').toISOString();
    const activityUrl = `https://api.todoist.com/sync/v9/activity/get`;
    const { data: activity } = await axios.post(activityUrl, {
        event_type: 'item:completed',
        since
    }, { headers: { Authorization: `Bearer ${apiKey}` }});
    
    // Option B: Use completed tasks endpoint (Pro only)
    // const completed = await api.getCompletedTasks({ since });
    
    const completedTasks = (activity.events || []).map(event => ({
        id: event.object_id,
        content: event.extra_data?.content || 'Unknown task',
        completedAt: event.event_date,
        date: moment(event.event_date).format('YYYY-MM-DD'),
        projectId: event.parent_project_id
    }));
    
    // Merge into date-keyed lifelog
    const existingLifelog = userLoadFile(username, 'todoist') || {};
    const updatedLifelog = mergeCompletedByDate(existingLifelog, completedTasks);
    userSaveFile(username, 'todoist', updatedLifelog);
    
    saveEvents(job_id);
    return { current: currentTasks.length, completed: completedTasks.length };
};
```

**Data Structures:**

```yaml
# users/{username}/current/todoist.yml
lastUpdated: '2025-12-31T10:30:00Z'
taskCount: 15
tasks:
  - id: '9106200118'
    content: 'Add Memos to Amazon Transactions'
    priority: 2
    dueDate: '2025-12-31'
    dueString: 'today'
    labels: ['finance']

# users/{username}/lifelog/todoist.yml
'2025-12-30':
  - id: '9106200100'
    content: 'Review budget spreadsheet'
    completedAt: '2025-12-30T16:45:00Z'
    projectId: '2342113574'
'2025-12-29':
  - id: '9106200095'
    content: 'Schedule dentist appointment'
    completedAt: '2025-12-29T10:30:00Z'
```

---

### 3. ClickUp Harvester

**API Capabilities:**
- Task list with status filtering
- `date_done` field available on completed tasks
- `date_updated` available for tracking changes

**Proposed Changes:**

```javascript
// backend/lib/clickup.mjs

const getTickets = async () => {
    const { apiKey } = getClickUpAuth();
    const { clickup: { statuses, done_statuses, team_id } } = process.env;
    
    // === CURRENT DATA: In-progress tasks ===
    const currentStatuses = statuses.filter(s => !done_statuses?.includes(s));
    const currentTasks = await fetchTasksByStatus(team_id, apiKey, currentStatuses);
    
    userSaveFile(username, 'current/clickup', {
        lastUpdated: new Date().toISOString(),
        taskCount: currentTasks.length,
        tasks: currentTasks.map(formatTask)
    });
    
    // === LIFELOG DATA: Recently completed tasks ===
    // Fetch tasks with done status from last 7 days
    const doneTasks = await fetchTasksByStatus(team_id, apiKey, done_statuses || ['done', 'complete']);
    const recentlyDone = doneTasks.filter(t => {
        const doneDate = t.date_done || t.date_updated;
        return doneDate && moment(parseInt(doneDate)).isAfter(moment().subtract(7, 'days'));
    });
    
    // Merge into date-keyed lifelog
    const existingLifelog = userLoadFile(username, 'clickup') || {};
    const updatedLifelog = mergeTasksByDoneDate(existingLifelog, recentlyDone);
    userSaveFile(username, 'clickup', updatedLifelog);
    
    return { current: currentTasks.length, completed: recentlyDone.length };
};
```

**Data Structures:**

```yaml
# users/{username}/current/clickup.yml
lastUpdated: '2025-12-31T10:30:00Z'
taskCount: 8
tasks:
  - id: 'abc123'
    name: 'UI Improvements'
    status: 'in progress'
    taxonomy:
      901607520316: 'TV View'
    url: 'https://app.clickup.com/t/abc123'

# users/{username}/lifelog/clickup.yml
'2025-12-30':
  - id: 'xyz789'
    name: 'Fix login bug'
    completedAt: '2025-12-30T17:00:00Z'
    taxonomy:
      901607520316: 'TV View'
'2025-12-29':
  - ...
```

---

### 4. Calendar/Events Harvester

**API Capabilities:**
- Google Calendar API: `timeMin`, `timeMax` parameters
- Can fetch both past and future events

**Proposed Changes:**

```javascript
// backend/lib/gcal.mjs

const listCalendarEvents = async (logger, job_id, targetUsername = null) => {
    // ... auth setup ...
    
    const now = new Date();
    const sixWeeksAgo = new Date();
    sixWeeksAgo.setDate(now.getDate() - 42);
    const sixWeeksFromNow = new Date();
    sixWeeksFromNow.setDate(now.getDate() + 42);
    
    // === CURRENT DATA: Upcoming events (next 6 weeks) ===
    let upcomingEvents = [];
    for (const cal of calendars) {
        const { data } = await calendar.events.list({
            calendarId: cal.id,
            timeMin: now.toISOString(),
            timeMax: sixWeeksFromNow.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });
        upcomingEvents = upcomingEvents.concat(data.items);
    }
    
    // Save to current/ (for Upcoming module)
    userSaveFile(username, 'current/calendar', formatEvents(upcomingEvents));
    
    // Also save to household shared (for TV display)
    const hid = process.env.household_id || 'default';
    saveFile(`households/${hid}/shared/calendar`, formatEvents(upcomingEvents));
    
    // === LIFELOG DATA: Past events (last 6 weeks) ===
    let pastEvents = [];
    for (const cal of calendars) {
        const { data } = await calendar.events.list({
            calendarId: cal.id,
            timeMin: sixWeeksAgo.toISOString(),
            timeMax: now.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });
        pastEvents = pastEvents.concat(data.items);
    }
    
    // Merge into date-keyed lifelog
    const existingLifelog = userLoadFile(username, 'calendar') || {};
    const updatedLifelog = mergeEventsByDate(existingLifelog, pastEvents);
    userSaveFile(username, 'calendar', updatedLifelog);
    
    saveEvents(job_id);  // Regenerate combined events
    return { upcoming: upcomingEvents.length, past: pastEvents.length };
};
```

**Data Structures:**

```yaml
# users/{username}/current/calendar.yml (also households/{hid}/shared/calendar.yml)
- id: 'event123'
  start: '2025-12-31T14:00:00Z'
  end: '2025-12-31T15:00:00Z'
  summary: 'Team standup'
  calendarName: 'Work'
  location: 'https://zoom.us/j/123'
  allday: false

# users/{username}/lifelog/calendar.yml
'2025-12-30':
  - id: 'event120'
    time: '10:00 AM'
    endTime: '11:00 AM'
    summary: 'Doctor appointment'
    duration: 1
    calendarName: 'Personal'
    location: 'Medical Center'
'2025-12-29':
  - ...
```

---

### 5. Events Job (Aggregator)

The `events.mjs` job should be updated to pull from `current/` subdirectories:

```javascript
// backend/jobs/events.mjs

export default async (job_id) => {
    const username = getDefaultUsername();
    
    // Load from CURRENT sources (not lifelog)
    const calendarEvents = userLoadFile(username, 'current/calendar') || [];
    const todoItems = userLoadFile(username, 'current/todoist')?.tasks || [];
    const clickupData = userLoadFile(username, 'current/clickup')?.tasks || [];
    
    // ... rest of aggregation logic ...
    
    // Save to household shared location (for Upcoming module)
    const hid = process.env.household_id || 'default';
    saveFile(`households/${hid}/shared/events`, allItems);
    
    return allItems;
};
```

---

## I/O Layer Updates

### New Functions for io.mjs

```javascript
// backend/lib/io.mjs

/**
 * Load current (ephemeral) data for a specific user
 * @param {string} username - The username
 * @param {string} service - The service name (e.g., 'gmail', 'todoist')
 * @returns {object|null} The loaded data or null if not found
 */
const userLoadCurrent = (username, service) => {
    if (!username) {
        ioLogger.warn('io.userLoadCurrent.noUsername', { service });
        return null;
    }
    return loadFile(`users/${username}/current/${service}`);
};

/**
 * Save current (ephemeral) data for a specific user
 * @param {string} username - The username
 * @param {string} service - The service name (e.g., 'gmail', 'todoist')
 * @param {object} data - The data to save
 * @returns {boolean} True if saved successfully
 */
const userSaveCurrent = (username, service, data) => {
    if (!username) {
        ioLogger.warn('io.userSaveCurrent.noUsername', { service });
        return false;
    }
    return saveFile(`users/${username}/current/${service}`, data);
};

// Export new functions
export {
    // ... existing exports ...
    userLoadCurrent,
    userSaveCurrent
};
```

---

## Consumer Updates

### Upcoming Module (Frontend)

No changes needed - already pulls from `/data/events` endpoint which will now be populated from `current/` sources.

### Lifelog Extractors

Update extractors to use the new date-keyed structure:

```javascript
// backend/lib/lifelog-extractors/gmail.mjs (NEW)

export const gmailExtractor = {
  source: 'gmail',
  category: 'communication',
  filename: 'gmail',
  
  extractForDate(data, date) {
    // Data is now date-keyed: { '2025-12-30': [...], ... }
    const dayMessages = data?.[date];
    if (!Array.isArray(dayMessages) || !dayMessages.length) return null;
    
    return {
      sent: dayMessages.filter(m => m.isSent),
      received: dayMessages.filter(m => !m.isSent),
      total: dayMessages.length
    };
  },

  summarize(entry) {
    if (!entry) return null;
    const lines = ['EMAIL ACTIVITY:'];
    if (entry.sent.length) {
      lines.push(`  Sent ${entry.sent.length} email${entry.sent.length > 1 ? 's' : ''}`);
      entry.sent.slice(0, 3).forEach(m => {
        lines.push(`    - To: ${m.to.split('<')[0].trim()} - "${m.subject}"`);
      });
    }
    if (entry.received.length) {
      lines.push(`  Received ${entry.received.length} email${entry.received.length > 1 ? 's' : ''}`);
    }
    return lines.join('\n');
  }
};
```

```javascript
// backend/lib/lifelog-extractors/todoist.mjs (NEW)

export const todoistExtractor = {
  source: 'todoist',
  category: 'productivity',
  filename: 'todoist',
  
  extractForDate(data, date) {
    // Data is now date-keyed: { '2025-12-30': [...], ... }
    const completedTasks = data?.[date];
    if (!Array.isArray(completedTasks) || !completedTasks.length) return null;
    
    return {
      tasks: completedTasks,
      count: completedTasks.length
    };
  },

  summarize(entry) {
    if (!entry || !entry.count) return null;
    const lines = [`TASKS COMPLETED (${entry.count}):`];
    entry.tasks.forEach(t => {
      lines.push(`  ✓ ${t.content}`);
    });
    return lines.join('\n');
  }
};
```

### Entropy Module

Update to pull from appropriate sources:

```javascript
// backend/lib/entropy.mjs

export const getEntropyReport = async () => {
    const config = configService.getAppConfig('entropy');
    const username = getDefaultUsername();
    
    for (const [id, sourceConfig] of Object.entries(config.sources)) {
        let value = 0;
        let label = '';
        
        if (sourceConfig.metric === 'days_since') {
            // LIFELOG: Check last entry date
            const data = userLoadFile(username, sourceConfig.dataPath);
            // ... existing days_since logic ...
        } 
        else if (sourceConfig.metric === 'count') {
            // CURRENT: Check pending item count
            const data = userLoadCurrent(username, sourceConfig.dataPath);
            if (sourceConfig.dataPath === 'gmail') {
                value = data?.unreadCount || 0;
                label = `${value} unread email${value === 1 ? '' : 's'}`;
            } else if (sourceConfig.dataPath === 'todoist') {
                value = data?.taskCount || 0;
                label = `${value} pending task${value === 1 ? '' : 's'}`;
            }
        }
        // ... rest of entropy calculation ...
    }
};
```

---

## Migration Path

### Phase 1: Add Current Data (Non-Breaking)

1. Add `userLoadCurrent`/`userSaveCurrent` to io.mjs
2. Update harvesters to ALSO save to `current/` (don't change existing lifelog saves)
3. Update Upcoming module to prefer `current/events` if available

### Phase 2: Update Lifelog Structure

1. Update harvesters to save date-keyed lifelog data
2. Add new lifelog extractors (gmail, todoist, clickup)
3. Update existing extractors to handle new structure
4. Run migration script to convert existing data

### Phase 3: Update Entropy ✅ COMPLETED

1. ✅ Updated entropy config to specify `lifelog` vs `current` data source (`dataSource` field)
2. ✅ Updated entropy.mjs to use `userLoadCurrent()` for count metrics and `userLoadFile()` for days_since metrics
3. ✅ Added `countField` and `itemName` to config for flexible field mapping

### Phase 4: Cleanup

1. Remove redundant saves
2. Archive/remove deprecated paths
3. Update documentation

---

## Configuration

### Entropy Config Update

```yaml
# config/apps/entropy.yml
sources:
  weight:
    name: Weight
    icon: scale
    dataPath: weight              # lifelog (days_since)
    metric: days_since
    dataSource: lifelog           # NEW: explicit source
    thresholds:
      green: 1
      yellow: 3
      
  inbox:
    name: Inbox
    icon: envelope
    dataPath: gmail               # current (count)
    metric: count
    dataSource: current           # NEW: explicit source
    thresholds:
      green: 10
      yellow: 25
      
  tasks:
    name: Tasks
    icon: check-square
    dataPath: todoist             # current (count)
    metric: count
    dataSource: current           # NEW: explicit source
    thresholds:
      green: 5
      yellow: 15
```

---

## Summary

| Component | Before | After |
|-----------|--------|-------|
| **Gmail** | `lifelog/gmail.yml` (flat array) | `lifelog/gmail.yml` (date-keyed: sent + today's inbox) + `current/gmail.yml` (full inbox) |
| **Todoist** | `lifelog/todoist.yml` (open tasks) | `lifelog/todoist.yml` (completed) + `current/todoist.yml` (open) |
| **ClickUp** | `lifelog/clickup.yml` (in-progress) | `lifelog/clickup.yml` (done) + `current/clickup.yml` (active) |
| **Calendar** | `shared/calendar.yml` (upcoming) | `lifelog/calendar.yml` (past) + `current/calendar.yml` (upcoming) |
| **Events** | Reads lifelog sources | Reads current sources |
| **Entropy** | Mixed sources | Explicit `dataSource: lifelog|current` |

This bifurcation cleanly separates temporal concerns while maintaining backward compatibility during migration.
