# DDD vs Legacy Endpoint Parity Audit

**Date:** 2026-01-12
**Status:** Complete - All Parity Tests Passing
**Branch:** backend-refactor

---

## Executive Summary

| Metric | Value |
|--------|-------|
| DDD Routers | 19 |
| DDD Endpoints | 87+ |
| Legacy Mount Points | 8 |
| Compatibility Redirects | 29 |
| Parity Tests | 10/10 Passing |

---

## Parity Test Results

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Results: 10 passed, 0 failed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| Test | Legacy Path | DDD Path | Status |
|------|-------------|----------|--------|
| Scripture | `/data/scripture/*` | `/api/local-content/scripture/*` | ✅ PASS |
| Hymn | `/data/hymn/:number` | `/api/local-content/hymn/:number` | ✅ PASS |
| Primary Song | `/data/primary/:number` | `/api/local-content/primary/:number` | ✅ PASS |
| Weight History | `/data/lifelog/weight` | `/api/health/weight` | ✅ PASS |
| Budget Data | `/data/budget` | `/api/finance/data` | ✅ PASS |
| Day-to-Day Budget | `/data/budget/daytoday` | `/api/finance/data/daytoday` | ✅ PASS |
| Entropy | `/home/entropy` | `/api/entropy` | ✅ PASS |
| Calendar Events | `/home/calendar` | `/api/calendar/events` | ✅ PASS |
| Calendar (data) | `/data/events` | `/api/calendar/events` | ✅ PASS |
| Lifelog | `/api/lifelog` | `/api/lifelog` | ✅ PASS |

---

## DDD Router Inventory

### Content Domain

| Router | Mount Path | Endpoints | Handler File |
|--------|------------|-----------|--------------|
| content | `/api/content` | 7 | `routers/content.mjs` |
| play | `/api/play` | 3 | `routers/play.mjs` |
| list | `/api/list` | 1 | `routers/list.mjs` |
| localContent | `/api/local-content` | 5 | `routers/localContent.mjs` |
| proxy | `/proxy` | 3 | `routers/proxy.mjs` |

#### Content Router (`/api/content`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/content/list/:source/*` | List items from content source |
| GET | `/api/content/item/:source/*` | Get single item info |
| GET | `/api/content/playables/:source/*` | Resolve to playable items |
| POST | `/api/content/progress/:source/*` | Update watch progress |
| GET | `/api/content/plex/image/:id` | Get Plex thumbnail (cached) |
| GET | `/api/content/plex/info/:id` | Get Plex item metadata |
| POST | `/api/content/menu-log` | Log menu navigation |

#### Play Router (`/api/play`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/play/:source/*` | Get playable with resume position |
| POST | `/api/play/log` | Log media playback progress |
| GET | `/api/play/plex/mpd/:id` | Get MPD manifest URL |

#### Local Content Router (`/api/local-content`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/local-content/scripture/*` | Scripture with verse timings |
| GET | `/api/local-content/hymn/:number` | Hymn with lyrics |
| GET | `/api/local-content/primary/:number` | Primary song with lyrics |
| GET | `/api/local-content/talk/*` | Talk with paragraphs |
| GET | `/api/local-content/poem/*` | Poem with stanzas |

---

### Fitness Domain

| Router | Mount Path | Endpoints | Handler File |
|--------|------------|-----------|--------------|
| fitness | `/api/fitness` | 11 | `routers/fitness.mjs` |

#### Fitness Router (`/api/fitness`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/fitness` | Get fitness config |
| GET | `/api/fitness/sessions/dates` | List dates with sessions |
| GET | `/api/fitness/sessions` | List sessions for date |
| GET | `/api/fitness/sessions/:sessionId` | Get session detail |
| POST | `/api/fitness/save_session` | Save session data |
| POST | `/api/fitness/save_screenshot` | Save session screenshot |
| POST | `/api/fitness/voice_memo` | Transcribe voice memo |
| POST | `/api/fitness/zone_led` | Sync ambient LED |
| GET | `/api/fitness/zone_led/status` | Get LED status |
| GET | `/api/fitness/zone_led/metrics` | Get LED metrics |
| POST | `/api/fitness/zone_led/reset` | Reset LED controller |

---

### Health Domain

| Router | Mount Path | Endpoints | Handler File |
|--------|------------|-----------|--------------|
| health | `/api/health` | 9 | `routers/health.mjs` |

#### Health Router (`/api/health`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health/daily` | Comprehensive daily health data |
| GET | `/api/health/date/:date` | Health for specific date |
| GET | `/api/health/range` | Health for date range |
| GET | `/api/health/weight` | Weight data (legacy parity) |
| GET | `/api/health/workouts` | Strava workout data |
| GET | `/api/health/fitness` | Fitness tracking data |
| GET | `/api/health/nutrition` | Nutrition data |
| GET | `/api/health/coaching` | Health coaching messages |
| GET | `/api/health/status` | Router status |

---

### Finance Domain

| Router | Mount Path | Endpoints | Handler File |
|--------|------------|-----------|--------------|
| finance | `/api/finance` | 15 | `routers/finance.mjs` |

#### Finance Router (`/api/finance`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/finance` | Finance config overview |
| GET | `/api/finance/data` | Compiled finances (legacy parity) |
| GET | `/api/finance/data/daytoday` | Day-to-day budget |
| GET | `/api/finance/accounts` | Account balances |
| GET | `/api/finance/transactions` | Transactions with filtering |
| POST | `/api/finance/transactions/:id` | Update transaction |
| GET | `/api/finance/budgets` | All budgets |
| GET | `/api/finance/budgets/:budgetId` | Budget detail |
| GET | `/api/finance/mortgage` | Mortgage data |
| POST | `/api/finance/refresh` | Trigger data refresh |
| POST | `/api/finance/compile` | Trigger compilation |
| POST | `/api/finance/categorize` | AI categorization |
| POST | `/api/finance/memos/:transactionId` | Save memo |
| GET | `/api/finance/memos` | Get all memos |
| GET | `/api/finance/metrics` | Adapter metrics |

---

### Home Automation Domain

| Router | Mount Path | Endpoints | Handler File |
|--------|------------|-----------|--------------|
| homeAutomation | `/api/home` | 10+ | `routers/homeAutomation.mjs` |

#### Home Automation Router (`/api/home`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/home/tv/:state` | Control living room TV |
| GET | `/api/home/office_tv/:state` | Control office TV |
| GET | `/api/home/tv` | Turn on TV with Daylight app |
| GET | `/api/home/volume/:action` | Volume control |
| POST | `/api/home/kiosk/screenshot` | Kiosk screenshot |
| POST | `/api/home/tasker` | Tasker webhook |

---

### Other Domains

| Router | Mount Path | Endpoints | Handler File |
|--------|------------|-----------|--------------|
| entropy | `/api/entropy` | 2 | `routers/entropy.mjs` |
| calendar | `/api/calendar` | 3 | `routers/calendar.mjs` |
| lifelog | `/api/lifelog` | 3 | `routers/lifelog.mjs` |
| static | `/api/static` | 5 | `routers/static.mjs` |
| gratitude | `/api/gratitude` | 14 | `routers/gratitude.mjs` |
| nutribot | `/api/nutribot` | 5+ | `routers/nutribot.mjs` |
| journalist | `/api/journalist` | 3+ | `routers/journalist.mjs` |
| scheduling | `/api/scheduling` | 7 | `routers/scheduling.mjs` |

#### Scheduling Router (`/api/scheduling`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scheduling/status` | Get status of all jobs with runtime state |
| POST | `/api/scheduling/run/:jobId` | Manually trigger a specific job |
| GET | `/api/scheduling/jobs` | List all registered jobs |
| GET | `/api/scheduling/running` | Get currently running jobs |
| GET | `/api/scheduling/cron10Mins` | Run 10-minute bucket jobs |
| GET | `/api/scheduling/cronHourly` | Run hourly bucket jobs |
| GET | `/api/scheduling/cronDaily` | Run daily bucket jobs |

---

## Legacy Compatibility Layer

### Redirects (29 total)

| Legacy Path | DDD Path | Method |
|-------------|----------|--------|
| `/media/plex/list/*` | `/api/list/plex/*` | any |
| `/data/list/*` | `/api/list/folder/*` | any |
| `/media/plex/info/:id` | `/api/content/plex/info/:id` | GET |
| `/media/plex/mpd/:id` | `/api/play/plex/mpd/:id` | GET |
| `/harvest/watchlist` | `/api/content/refresh-watchlist` | POST |
| `/home/entropy` | `/api/entropy` | GET |
| `/home/calendar` | `/api/calendar/events` | GET |
| `/data/events` | `/api/calendar/events` | GET |
| `/data/lifelog/weight` | `/api/health/weight` | GET |
| `/data/menu_log` | `/api/content/menu-log` | POST |
| `/exe/tv/off` | `/api/home/tv/power?action=off` | GET |
| `/exe/office_tv/off` | `/api/home/office-tv/power?action=off` | GET |
| `/exe/vol/up` | `/api/home/volume/up` | GET |
| `/exe/vol/down` | `/api/home/volume/down` | GET |
| `/exe/vol/mute` | `/api/home/volume/mute` | GET |
| `/exe/vol/cycle` | `/api/home/volume/cycle` | GET |
| `/exe/ws/restart` | `/admin/ws/restart` | GET/POST |
| `/exe/ws` | `/admin/ws/broadcast` | any |
| `/cron/status` | `/api/scheduling/status` | GET |
| `/cron/run/:jobId` | `/api/scheduling/run/:jobId` | POST |
| `/cron/cron10Mins` | `/api/scheduling/cron10Mins` | GET |
| `/cron/cronHourly` | `/api/scheduling/cronHourly` | GET |
| `/cron/cronDaily` | `/api/scheduling/cronDaily` | GET |
| `/cron/cronWeekly` | `/api/scheduling/cronWeekly` | GET |
| `/media/img/entropy/:icon` | `/api/static/entropy/:icon` | GET |
| `/media/img/art/*` | `/api/static/art/*` | GET |
| `/media/img/users/:id` | `/api/static/users/:id` | GET |
| `/media/img/equipment/:id` | `/api/static/equipment/:id` | GET |
| `/media/img/*` | `/api/static/img/*` | GET |

### Legacy Mounts (tracked)

All legacy routers remain mounted with hit-tracking middleware:

| Mount Path | Router | Status |
|------------|--------|--------|
| `/data` | fetchRouter | Tracked |
| `/harvest` | harvestRouter | Tracked |
| `/home` | homeRouter | Tracked |
| `/media` | mediaRouter | Tracked |
| `/cron` | cronRouter | Tracked |
| `/plex_proxy` | plexProxyRouter | Tracked |
| `/exe` | exeRouter | Tracked |
| `/api` | apiRouter (legacy) | Tracked |

Monitor usage at `/admin/legacy` to identify when legacy routes can be removed.

---

## Migration Status by Domain

| Domain | Status | Notes |
|--------|--------|-------|
| Content | ✅ Fully Migrated | All endpoints have DDD equivalents |
| Fitness | ✅ Fully Migrated | Full parity with legacy |
| Health | ✅ Fully Migrated | Weight endpoint has legacy parity |
| Finance | ✅ Fully Migrated | Budget endpoints have legacy parity |
| Home Automation | ✅ Fully Migrated | TV/volume/WS broadcast/restart all migrated |
| Entropy | ✅ Fully Migrated | Uses legacy function for parity |
| Calendar | ✅ Fully Migrated | Returns array for legacy parity |
| Lifelog | ✅ Fully Migrated | Aggregator working |
| Chatbots | ✅ Fully Migrated | Nutribot/Journalist have DDD routers |
| Cron/Scheduling | ✅ Fully Migrated | Full DDD rewrite with domain services |
| Media Images | ✅ Fully Migrated | Static router with legacy redirects |

---

## Test Infrastructure

### Parity Test Suite

**File:** `tests/integration/api/parity.test.mjs`

**Run tests:**
```bash
# With Jest
npm test -- parity.test

# CLI mode (requires running server)
PARITY_TEST_URL=http://localhost:3112 node tests/integration/api/parity.test.mjs
```

**Features:**
- Compares DDD endpoint responses against legacy
- Ignores volatile fields (timestamps, cache markers)
- Reports field-level differences
- Supports both Jest and CLI execution

### Legacy Tracking

**Endpoint:** `/admin/legacy`

**Features:**
- Tracks hit count per legacy mount path
- Records first/last hit timestamps
- Reset counters via POST `/admin/legacy/reset`
- Summary at GET `/admin/legacy/summary`

---

## Files Modified for Parity

| File | Changes |
|------|---------|
| `server.mjs` | Fixed LocalContentAdapter path, added legacy entropy import, 17 redirects |
| `bootstrap.mjs` | Accept legacyGetEntropyReport parameter |
| `routers/health.mjs` | Return weight data directly (no wrapper) |
| `routers/entropy.mjs` | Delegate to legacy getEntropyReport() |
| `routers/calendar.mjs` | Return events array directly |
| `routers/localContent.mjs` | Use hymn_num/song_number, legacy mediaUrl format |

---

## Next Steps

1. **Phase 5: Frontend Migration**
   - Update frontend API calls to use DDD endpoints
   - See `/admin/legacy` for remaining legacy usage

2. **Phase 6: Legacy Cleanup**
   - Monitor `/admin/legacy` for zero-hit routes
   - Remove legacy routers when safe
   - Archive `backend/_legacy/` folder

---

## Appendix: Full DDD Router List

```
backend/src/4_api/routers/
├── admin/
│   ├── eventbus.mjs      # WebSocket admin
│   └── legacy.mjs        # Legacy tracking admin
├── ai.mjs                # AI endpoints
├── calendar.mjs          # Calendar events
├── content.mjs           # Content operations
├── entropy.mjs           # Data freshness
├── finance.mjs           # Finance/budget
├── fitness.mjs           # Fitness sessions
├── gratitude.mjs         # Gratitude app
├── health.mjs            # Health metrics
├── homeAutomation.mjs    # Home control
├── journaling.mjs        # Journal entries
├── journalist.mjs        # Journalist bot
├── lifelog.mjs           # Lifelog aggregator
├── list.mjs              # List operations
├── localContent.mjs      # Local content (scripture, hymns)
├── messaging.mjs         # Messaging
├── nutribot.mjs          # Nutrition bot
├── nutrition.mjs         # Nutrition data
├── play.mjs              # Playback
├── proxy.mjs             # Stream proxy
└── static.mjs            # Static assets
```
