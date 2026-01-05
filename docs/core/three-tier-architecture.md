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
