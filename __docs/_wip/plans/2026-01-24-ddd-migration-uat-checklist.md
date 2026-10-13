# DDD Migration UAT Checklist

**Branch:** `refactor/ddd-migration`
**Date:** 2026-01-24

This checklist covers all changes from the DDD migration. Test in production environment after deploy.

---

## Pre-Deployment Checks

- [ ] Build completes without errors (`npm run build`)
- [ ] Docker container starts without crashes
- [ ] Server logs show successful initialization (no FATAL errors)
- [ ] All 14 harvesters register on startup
- [ ] MediaJobExecutor registers YouTube handler
- [ ] Scheduler loads 19 jobs from `system/jobs.yml`
- [ ] WebSocket/EventBus starts successfully
- [ ] No legacy import warnings in startup logs (except expected deprecation shims)

---

## 1. MAIN USE CASES (Critical Path)

### 1.1 Scheduler & Cron Jobs

**New DDD Scheduler (replaces legacy cron):**
- [ ] `/api/v1/scheduling/status` returns job list with next run times
- [ ] Jobs show correct `enabled`, `lastRun`, `nextRun`, `status`
- [ ] Manual trigger works: `POST /api/v1/scheduling/run/{jobId}`
- [ ] YouTube job executes via MediaJobExecutor (check logs for `mediaExecutor.registered`)
- [ ] Legacy cron does NOT run (check logs - should say "Scheduler owned by new backend")

**Harvester Jobs (verify each runs on schedule or manual trigger):**
- [ ] `weather` - Weather data updates
- [ ] `gcal` - Google Calendar syncs
- [ ] `todoist` - Todoist tasks sync
- [ ] `gmail` - Gmail inbox fetches
- [ ] `withings` - Scale data syncs
- [ ] `strava` - Activities sync
- [ ] `lastfm` - Scrobbles sync
- [ ] `clickup` - ClickUp tasks sync
- [ ] `foursquare` - Check-ins sync
- [ ] `buxfer` - Budget/finance syncs
- [ ] `letterboxd` - Movie diary syncs
- [ ] `goodreads` - Reading list syncs
- [ ] `github` - Commit history syncs
- [ ] `reddit` - Activity syncs
- [ ] `shopping` - Receipt extraction

**Legacy Jobs (still use module import):**
- [ ] `youtube` - Downloads work (now via MediaJobExecutor)
- [ ] `fitsync` - FitnessSyncer aggregation runs
- [ ] `archive-rotation` - Lifelog archives rotate
- [ ] `media-memory-validator` - Media memory integrity check runs

### 1.2 TV App / Media Playback

**Content Browsing:**
- [ ] Plex libraries load in menu
- [ ] Show/Season/Episode navigation works
- [ ] Local content (folders) appears in menu
- [ ] Audio content (music, podcasts) appears correctly
- [ ] Scripture content loads and displays

**Playback:**
- [ ] Video playback starts correctly
- [ ] Audio playback starts correctly
- [ ] Queue management works (add, remove, reorder)
- [ ] Progress tracking saves (watch state persists)
- [ ] Resume from last position works
- [ ] Media memory updates on play

**Player Controls:**
- [ ] Play/Pause works
- [ ] Seek works
- [ ] Volume control works
- [ ] Next/Previous in queue works

### 1.3 Fitness App

**Session Management:**
- [ ] Start new fitness session
- [ ] End fitness session (saves correctly)
- [ ] Session history loads
- [ ] Session browser shows past sessions

**Governance:**
- [ ] Multi-user governance works
- [ ] Roster sync functions
- [ ] Session ownership transfers correctly

**Hardware Integrations:**
- [ ] Ambient LED responds during workout (color changes)
- [ ] MQTT messages received for vibration sensors
- [ ] Camera view works (if configured)

**Music During Workout:**
- [ ] Fitness music player works
- [ ] Music queue persists during session

### 1.4 Finance App

**Budget Display:**
- [ ] `/api/v1/finance/data` returns budget data
- [ ] Day-to-day spending displays
- [ ] Category breakdowns work
- [ ] Payroll sync works

**Data Refresh:**
- [ ] `/api/v1/finance/refresh` triggers Buxfer sync
- [ ] New transactions appear after sync

### 1.5 Chatbots (Telegram)

**Telegram Webhook Configuration:**
- [ ] Webhooks registered with Telegram API for all 3 bots
- [ ] Webhook URLs point to new DDD paths (`/api/v1/{bot}/webhook`)
- [ ] Secret tokens configured and validated
- [ ] Webhook health endpoints respond (`/api/v1/{bot}/health`)

**Dev Proxy Toggle (for webhook debugging):**
- [ ] `/dev/proxy_toggle` endpoint accessible
- [ ] Enable proxy redirects requests to dev machine
- [ ] Disable proxy restores normal routing
- [ ] Webhook messages route correctly when proxy enabled

**NutriBot:**
- [ ] Webhook receives messages (`/api/v1/nutribot/webhook`)
- [ ] Food logging works (text input)
- [ ] Photo food recognition works
- [ ] Nutrition totals calculate correctly
- [ ] Daily reports generate
- [ ] Goals display correctly per user

**Journalist:**
- [ ] Webhook receives messages (`/api/v1/journalist/webhook`)
- [ ] Journal entry logging works
- [ ] Lifelog entries save correctly

**HomeBot:**
- [ ] Webhook receives messages (`/api/v1/homebot/webhook`)
- [ ] Gratitude card requests work
- [ ] Home automation commands work

### 1.6 WebSocket / Real-time Updates

- [ ] WebSocket connects on page load
- [ ] `/api/v1/admin/ws/restart` restarts WebSocket
- [ ] Real-time updates propagate to clients
- [ ] EventBus events fire correctly

---

## 2. SECONDARY USE CASES

### 2.1 Frontend API Path Changes

**Migrated from /exe/* to /api/v1/*:**
- [ ] `WebSocketContext.jsx` - WS restart uses `/api/v1/admin/ws/restart`
- [ ] `WrapUp.jsx` - TV off uses `api/v1/home/tv/off`
- [ ] `OfficeOff.jsx` - Office TV off uses `api/v1/home/office_tv/off`
- [ ] `keyboardHandler.js` - Volume controls use `api/v1/home/vol/*`

### 2.2 Home Automation

- [ ] TV power on/off works
- [ ] Office TV power on/off works
- [ ] Volume up/down/mute works
- [ ] Home Assistant integration works (if configured)

### 2.3 Gratitude / Prayer Cards

- [ ] Gratitude entry submission works
- [ ] Prayer card thermal print triggers
- [ ] Card renders correctly
- [ ] Print queue processes

### 2.4 Entropy / Random Content

- [ ] Entropy panel loads random entries
- [ ] Different entropy sources work (lifelog, quotes, etc.)
- [ ] Refresh fetches new random content

### 2.5 Calendar / Events

- [ ] Calendar data loads
- [ ] Events display correctly
- [ ] Google Calendar sync works

### 2.6 Health Metrics

- [ ] Health dashboard loads
- [ ] Withings data displays
- [ ] Weight trends show correctly

### 2.7 Lifelog

- [ ] Lifelog API returns entries
- [ ] Archive rotation works (entries move to yearly archives)
- [ ] Multiple lifelog sources aggregate correctly

---

## 3. EDGE CASES & HARDWARE

### 3.1 Hardware Integrations

**Thermal Printer:**
- [ ] Printer status check works
- [ ] Gratitude card prints
- [ ] Print formatting correct

**MQTT/Sensors:**
- [ ] MQTT subscriber connects
- [ ] Vibration sensor messages received
- [ ] Equipment state updates in fitness app

**Piano:**
- [ ] Piano app loads
- [ ] Key presses register
- [ ] Audio plays correctly

**Ambient LED:**
- [ ] LED controller responds
- [ ] Workout colors change based on zone
- [ ] LED turns off when session ends

**Text-to-Speech:**
- [ ] TTS endpoint works
- [ ] Audio generates correctly
- [ ] Volume/speed parameters work

### 3.2 Multi-User Scenarios

- [ ] Different users have correct goals (NutriBot)
- [ ] User timezone handling works
- [ ] Household-level vs user-level config works
- [ ] Identity mappings resolve correctly

### 3.3 Error Handling

- [ ] 404 for unknown routes returns proper JSON
- [ ] 500 errors log correctly
- [ ] Circuit breakers work (e.g., FitnessSyncer rate limiting)
- [ ] Timeout handling for long-running jobs

### 3.4 Persistence & State

- [ ] Cron state persists across restarts (`system/state/cron-runtime.yml`)
- [ ] Watch state saves and loads correctly
- [ ] NutriLog entries persist
- [ ] Session data saves correctly

### 3.5 Legacy Compatibility

- [ ] Legacy `/data/*` endpoints still work
- [ ] Legacy `/harvest/*` endpoints still work
- [ ] Legacy `/media/*` endpoints still work
- [ ] Finance shims redirect correctly (`/data/budget` -> `/api/finance/data`)

### 3.6 Dev vs Prod Behavior

- [ ] Scheduler only runs in Docker (or with ENABLE_CRON=true)
- [ ] Frontend serves correctly in Docker
- [ ] Static files serve in production
- [ ] Vite proxy works in dev

---

## 4. LOGS & MONITORING

### 4.1 Startup Logs

- [ ] No uncaught exceptions
- [ ] All routers mount successfully
- [ ] `apiV1.mounted` shows all 19 routers
- [ ] `harvester.bootstrap.complete` shows 14 harvesters

### 4.2 Runtime Logs

- [ ] Job execution logs appear
- [ ] Error logs include stack traces
- [ ] No excessive debug logging in prod

### 4.3 Admin Endpoints

- [ ] `/admin/legacy-hits` shows legacy route usage
- [ ] `/admin/cutover-status` shows migration status
- [ ] `/api/logging/health` shows log transport status

---

## 5. ROLLBACK PLAN

If critical issues found:

1. [ ] Revert to previous Docker image
2. [ ] Check if data corruption occurred
3. [ ] Restore cron-runtime.yml from backup if needed
4. [ ] Document issues for fix

---

## Sign-off

| Area | Tested By | Date | Pass/Fail |
|------|-----------|------|-----------|
| Scheduler | | | |
| TV/Media | | | |
| Fitness | | | |
| Finance | | | |
| Chatbots | | | |
| Hardware | | | |
| Edge Cases | | | |

---

**Notes:**
