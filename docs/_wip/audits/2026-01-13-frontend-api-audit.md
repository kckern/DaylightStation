# Frontend API Audit

**Date:** 2026-01-13
**Purpose:** Comprehensive audit of all APIs expected by frontend, gap analysis, and migration workplan

---

## Executive Summary

The frontend expects **47 unique API endpoints** across 8 categories. Currently:
- **12 endpoints** are served by DDD routers (mounted)
- **12 endpoints** have DDD routers but are **NOT MOUNTED** (gap!)
- **23 endpoints** are legacy-only with no DDD equivalent

**Critical Issue:** The `/api/fitness/*` endpoints are actively used by frontend but the DDD router exists and is NOT mounted, causing requests to fall through to legacy.

---

## 1. API Endpoints By Category

### 1.1 Content Domain (DDD - Fully Migrated)

| Endpoint | Frontend Usage | DDD Router | Mounted | Status |
|----------|---------------|------------|---------|--------|
| `GET /api/list/plex/{id}` | Menu, Fitness, Player | list.mjs | Yes | OK |
| `GET /api/list/plex/{id}/playable` | FitnessShow, MusicPlayer | list.mjs | Yes | OK |
| `GET /api/list/plex/{id}/playable,shuffle` | MusicPlayer, Player | list.mjs | Yes | OK |
| `GET /api/list/folder/{id}` | PlexMenuRouter | list.mjs | Yes | OK |
| `GET /api/list/folder/{id}/playable` | Player, useQueueController | list.mjs | Yes | OK |
| `GET /api/list/folder/TVApp/recent_on_top` | TVApp | list.mjs | Yes | OK |
| `GET /api/content/*` | Menu browsing | content.mjs | Yes | OK |
| `GET /api/play/*` | Playback control | play.mjs | Yes | OK |
| `GET /api/local-content/scripture/{id}` | ContentScroller | localContent.mjs | Yes | OK |
| `GET /api/local-content/talk/{id}` | ContentScroller | localContent.mjs | Yes | OK |
| `GET /api/local-content/poem/{id}` | ContentScroller | localContent.mjs | Yes | OK |
| `GET /proxy/*` | Plex image proxy | proxy.mjs | Yes | OK |

### 1.2 Health Domain (DDD - Fully Migrated)

| Endpoint | Frontend Usage | DDD Router | Mounted | Status |
|----------|---------------|------------|---------|--------|
| `GET /api/health/status` | HealthApp | health.mjs | Yes | OK |
| `GET /api/health/nutrilist/{date}` | Nutrition | health.mjs | Yes | OK |
| `PUT /api/health/nutrilist/{uuid}` | NutritionDay | health.mjs | Yes | OK |
| `DELETE /api/health/nutrilist/{uuid}` | NutritionDay | health.mjs | Yes | OK |

### 1.3 Finance Domain (DDD - Fully Migrated)

| Endpoint | Frontend Usage | DDD Router | Mounted | Status |
|----------|---------------|------------|---------|--------|
| `GET /api/finance/data` | Redirected from /data/budget | finance.mjs | Yes | OK |
| `GET /api/finance/data/daytoday` | Finance component | finance.mjs | Yes | OK |
| `POST /api/finance/refresh` | Redirected from /harvest/budget | finance.mjs | Yes | OK |

### 1.4 Gratitude Domain (DDD - Fully Migrated)

| Endpoint | Frontend Usage | DDD Router | Mounted | Status |
|----------|---------------|------------|---------|--------|
| `GET /api/gratitude/bootstrap` | Gratitude, FamilySelector | gratitude.mjs | Yes | OK |
| `GET /api/gratitude/selections/{category}` | Gratitude | gratitude.mjs | Yes | OK |
| `POST /api/gratitude/selections/{category}` | Gratitude | gratitude.mjs | Yes | OK |
| `DELETE /api/gratitude/selections/{category}/{id}` | Gratitude | gratitude.mjs | Yes | OK |
| `POST /api/gratitude/discarded/{category}` | Gratitude | gratitude.mjs | Yes | OK |

### 1.5 Entropy Domain (DDD - Fully Migrated)

| Endpoint | Frontend Usage | DDD Router | Mounted | Status |
|----------|---------------|------------|---------|--------|
| `GET /api/entropy` | EntropyPanel | entropy.mjs | Yes | OK |

**Note:** Frontend also calls `/home/entropy` which is legacy. Should migrate to `/api/entropy`.

### 1.6 Fitness Domain (DDD EXISTS - NOT MOUNTED!)

| Endpoint | Frontend Usage | DDD Router | Mounted | Status |
|----------|---------------|------------|---------|--------|
| `GET /api/fitness` | FitnessApp, FitnessMenu, FitnessPluginMenu | fitness.mjs | **NO** | **GAP** |
| `GET /api/fitness/sessions/dates` | SessionBrowserApp | fitness.mjs | **NO** | **GAP** |
| `GET /api/fitness/sessions?date={date}` | SessionBrowserApp | fitness.mjs | **NO** | **GAP** |
| `GET /api/fitness/sessions/{id}` | SessionBrowserApp | fitness.mjs | **NO** | **GAP** |
| `POST /api/fitness/session` | SessionLifecycle | fitness.mjs | **NO** | **GAP** |
| `POST /api/fitness/session/snapshot` | CameraViewApp | fitness.mjs | **NO** | **GAP** |
| `POST /api/fitness/zone_led` | useZoneLedSync | fitness.mjs | **NO** | **GAP** |
| `POST /api/fitness/voice_memo` | useVoiceMemoRecorder | fitness.mjs | **NO** | **GAP** |

### 1.7 Chatbot Webhooks (DDD EXISTS - NOT MOUNTED)

| Endpoint | Frontend Usage | DDD Router | Mounted | Status |
|----------|---------------|------------|---------|--------|
| `POST /api/foodlog` | Telegram webhook (external) | nutribot.mjs | **NO** | **GAP** |
| `GET /api/foodreport` | External | nutribot.mjs | **NO** | **GAP** |
| `GET /api/nutribot/images/*` | External | nutribot.mjs | **NO** | **GAP** |
| `POST /api/journalist` | Telegram webhook (external) | journalist.mjs | **NO** | **GAP** |

### 1.8 Lifelog Domain (DDD Domain Exists - NO Router)

| Endpoint | Frontend Usage | DDD Router | Mounted | Status |
|----------|---------------|------------|---------|--------|
| `GET /api/lifelog` | LifelogApp | **NONE** | N/A | **GAP** |

**Note:** Domain exists at `1_domains/lifelog/` with `LifelogAggregator` service and 15 extractors, but no API router was created.

### 1.9 Legacy Endpoints → DDD Target Mapping

Every frontend endpoint must have a defined DDD target.

#### Media Endpoints (`/media/*` → `/api/media/*`)

| Current Path | Frontend Usage | Target DDD Path | DDD Router | Action |
|--------------|---------------|-----------------|------------|--------|
| `POST /media/log` | Player, ContentScroller | `POST /api/play/log` | play.mjs | Move to play router |
| `GET /media/plex/img/{id}` | Menu, ShowView | `GET /api/content/plex/image/{id}` | content.mjs | Add to content router |
| `GET /media/plex/info/{id}` | DebugInfo | `GET /api/content/plex/info/{id}` | content.mjs | Add to content router |
| `GET /media/plex/mpd/{id}` | DebugInfo | `GET /api/play/plex/mpd/{id}` | play.mjs | Add to play router |
| `GET /media/img/entropy/{icon}` | EntropyPanel | `GET /api/static/entropy/{icon}` | static.mjs | Create static router |
| `GET /media/img/art/{path}` | Art | `GET /api/static/art/{path}` | static.mjs | Create static router |
| `GET /media/img/users/{id}` | Fitness, Gratitude | `GET /api/static/users/{id}` | static.mjs | Create static router |
| `GET /media/img/equipment/{id}` | Fitness | `GET /api/static/equipment/{id}` | static.mjs | Create static router |

#### Data Endpoints (`/data/*` → Various)

| Current Path | Frontend Usage | Target DDD Path | DDD Router | Action |
|--------------|---------------|-----------------|------------|--------|
| `GET /data/budget` | FinanceApp | `GET /api/finance/data` | finance.mjs | Redirect exists |
| `GET /data/budget/daytoday` | Finance | `GET /api/finance/data/daytoday` | finance.mjs | Redirect exists |
| `GET /data/events` | Upcoming | `GET /api/calendar/events` | calendar.mjs | Create calendar router |
| `GET /data/lifelog/weight` | Health | `GET /api/health/weight` | health.mjs | Add to health router |
| `POST /data/menu_log` | Menu | `POST /api/content/menu-log` | content.mjs | Add to content router |
| `GET /data/keyboard/officekeypad` | OfficeApp | `GET /api/home/keyboard/{id}` | homeAutomation.mjs | Mount existing router |
| `GET /data/weather` | OfficeApp | `GET /api/home/weather` | homeAutomation.mjs | Mount existing router |

#### Home Automation (`/home/*` → `/api/home/*`)

| Current Path | Frontend Usage | Target DDD Path | DDD Router | Action |
|--------------|---------------|-----------------|------------|--------|
| `GET /home/calendar` | Calendar | `GET /api/calendar/events` | calendar.mjs | Create calendar router |
| `GET /home/entropy` | EntropyPanel | `GET /api/entropy` | entropy.mjs | **Already exists** - update frontend |

#### Harvest Endpoints (`/harvest/*` → Various)

| Current Path | Frontend Usage | Target DDD Path | DDD Router | Action |
|--------------|---------------|-----------------|------------|--------|
| `POST /harvest/watchlist` | useMediaKeyboardHandler | `POST /api/content/refresh-watchlist` | content.mjs | Add to content router |
| `POST /harvest/budget` | FinanceApp | `POST /api/finance/refresh` | finance.mjs | Redirect exists |

#### Remote Execution (`/exe/*` → `/api/home/*`)

| Current Path | Frontend Usage | Target DDD Path | DDD Router | Action |
|--------------|---------------|-----------------|------------|--------|
| `POST /exe/tv/off` | WrapUp | `POST /api/home/tv/power` | homeAutomation.mjs | Mount existing router |
| `POST /exe/office_tv/off` | OfficeOff | `POST /api/home/office-tv/power` | homeAutomation.mjs | Mount existing router |
| `POST /exe/ws/restart` | WebSocketContext | `POST /api/admin/ws/restart` | admin.mjs | Add to admin router |

#### System Endpoints (Already DDD)

| Current Path | Frontend Usage | Status |
|--------------|---------------|--------|
| `GET /api/ping` | DebugInfo | OK - DDD |
| `GET /api/status` | DebugInfo | OK - DDD |

---

## 2. WebSocket Endpoints

| Endpoint | Usage | Handler | Status |
|----------|-------|---------|--------|
| `/ws` | All real-time communication | DDD WebSocketEventBus | OK |
| `/ws/fitness` | Fitness real-time data | Via topic subscription | OK |
| `/ws/midi` | MIDI events (Piano, Office) | Via topic subscription | OK |
| `/ws/logging` | Frontend log transport | Via topic subscription | OK |
| `/ws/gratitude` | Gratitude updates | Via topic subscription | OK |
| `/ws/office` | Office app events | Via topic subscription | OK |

**WebSocket Topics Used:**
- `fitness` - Heart rate, RPM, vibration, governance
- `midi` - Piano/keyboard MIDI events
- `logging` - Frontend log batches
- `gratitude` - Real-time gratitude selections
- `office` - Office automation events

---

## 3. Gap Analysis

### 3.1 Critical Gaps (Frontend Broken)

| Gap | Impact | Priority |
|-----|--------|----------|
| Fitness router not mounted | FitnessApp, sessions, zone LED all broken | **P0** |

### 3.2 High Priority Gaps (DDD Exists, Not Mounted)

| Gap | Impact | Priority |
|-----|--------|----------|
| Lifelog router missing | LifelogApp broken, domain exists but no router | P1 |
| Nutribot router not mounted | Telegram webhooks go to legacy | P1 |
| Journalist router not mounted | Telegram webhooks go to legacy | P1 |

### 3.3 Medium Priority Gaps (Need DDD Routers/Endpoints)

| Gap | Target DDD | Action | Priority |
|-----|------------|--------|----------|
| Static images `/media/img/*` | `/api/static/*` | Create static.mjs router | P2 |
| Calendar `/home/calendar`, `/data/events` | `/api/calendar/*` | Create calendar.mjs router | P2 |
| Home automation not mounted | `/api/home/*` | Mount homeAutomation.mjs | P2 |
| Media log `/media/log` | `/api/play/log` | Add to play.mjs | P2 |
| Plex images/info `/media/plex/*` | `/api/content/plex/*` | Add to content.mjs | P2 |
| Weight data `/data/lifelog/weight` | `/api/health/weight` | Add to health.mjs | P2 |
| Menu log `/data/menu_log` | `/api/content/menu-log` | Add to content.mjs | P2 |
| Watchlist refresh `/harvest/watchlist` | `/api/content/refresh-watchlist` | Add to content.mjs | P2 |

### 3.4 Low Priority Gaps (Infrequent Use)

| Gap | Target DDD | Action | Priority |
|-----|------------|--------|----------|
| TV power `/exe/tv/*` | `/api/home/tv/power` | Add to homeAutomation.mjs | P3 |
| WS restart `/exe/ws/restart` | `/api/admin/ws/restart` | Add to admin router | P3 |

---

## 4. Frontend Code Patterns

### 4.1 DaylightAPI Usage
```javascript
// Most common pattern
const data = await DaylightAPI('/api/endpoint');

// With payload
await DaylightAPI('/api/endpoint', payload, 'POST');

// POST helper
await DaylightAPI.post('/api/endpoint', payload);
```

### 4.2 Direct Fetch (Legacy)
```javascript
// Some components bypass DaylightAPI
const res = await fetch('/api/fitness/sessions/dates');
const response = await fetch(`${baseUrl}/data/budget`);
```

### 4.3 WebSocket Pattern
```javascript
// Subscription
useWebSocketSubscription('fitness', handleMessage);

// Via context
const { registerPayloadCallback } = useWebSocket();
```

---

## 5. Migration Workplan

### Phase 1: Mount Critical Missing Routers (P0)

**Goal:** Fix broken frontend functionality

| Task | Files | Effort |
|------|-------|--------|
| 1.1 Mount fitness router in server.mjs | server.mjs | 30 min |
| 1.2 Create fitnessServices in server.mjs | server.mjs, bootstrap.mjs | 1 hr |
| 1.3 Test all fitness endpoints | Manual + integration | 1 hr |

### Phase 2: Create Lifelog Router & Mount Chatbots (P1)

**Goal:** Fix LifelogApp and migrate Telegram webhooks to DDD

| Task | Files | Effort |
|------|-------|--------|
| 2.1 Create lifelog API router | routers/lifelog.mjs | 2 hr |
| 2.2 Add createLifelogApiRouter to bootstrap | bootstrap.mjs | 1 hr |
| 2.3 Mount lifelog router in server.mjs | server.mjs | 30 min |
| 2.4 Create nutribotServices in server.mjs | server.mjs | 2 hr |
| 2.5 Mount nutribot router | server.mjs | 30 min |
| 2.6 Create journalistServices in server.mjs | server.mjs | 2 hr |
| 2.7 Mount journalist router | server.mjs | 30 min |
| 2.8 Test all endpoints end-to-end | Manual | 1 hr |

### Phase 3: Add Missing Endpoints to Existing Routers (P2)

**Goal:** Add missing endpoints to already-mounted DDD routers

| Task | Router | Endpoints to Add | Effort |
|------|--------|------------------|--------|
| 3.1 Add to play.mjs | play.mjs | `POST /log`, `GET /plex/mpd/{id}` | 1 hr |
| 3.2 Add to content.mjs | content.mjs | `GET /plex/image/{id}`, `GET /plex/info/{id}`, `POST /menu-log`, `POST /refresh-watchlist` | 2 hr |
| 3.3 Add to health.mjs | health.mjs | `GET /weight` (from lifelog) | 30 min |

### Phase 4: Create New DDD Routers (P2)

**Goal:** Create routers that don't exist yet

| Task | Router | Endpoints | Effort |
|------|--------|-----------|--------|
| 4.1 Create static.mjs | static.mjs | `GET /entropy/{icon}`, `GET /art/{path}`, `GET /users/{id}`, `GET /equipment/{id}` | 2 hr |
| 4.2 Create calendar.mjs | calendar.mjs | `GET /events` | 2 hr |
| 4.3 Create lifelog.mjs | lifelog.mjs | `GET /` (aggregated lifelog) | 2 hr |

### Phase 5: Mount Existing Unmounted Routers (P2)

**Goal:** Mount DDD routers that exist but aren't wired up

| Task | Router | Path | Effort |
|------|--------|------|--------|
| 5.1 Mount homeAutomation.mjs | homeAutomation.mjs | `/api/home` | 1 hr |
| 5.2 Add endpoints to homeAutomation | homeAutomation.mjs | `GET /keyboard/{id}`, `GET /weather`, `POST /tv/power` | 2 hr |
| 5.3 Add WS restart to admin | admin/legacy.mjs | `POST /ws/restart` | 30 min |

### Phase 6: Frontend Migration (P2)

**Goal:** Update frontend to use canonical DDD endpoints

| Task | Current Path | New Path | Files | Effort |
|------|--------------|----------|-------|--------|
| 6.1 EntropyPanel | `/home/entropy` | `/api/entropy` | EntropyPanel.jsx | 15 min |
| 6.2 Finance | `/data/budget/*` | `/api/finance/*` | Finance.jsx, FinanceApp.jsx | 30 min |
| 6.3 Calendar | `/home/calendar` | `/api/calendar/events` | Calendar.jsx | 15 min |
| 6.4 Upcoming | `/data/events` | `/api/calendar/events` | Upcoming.jsx | 15 min |
| 6.5 Health weight | `/data/lifelog/weight` | `/api/health/weight` | Health.jsx | 15 min |
| 6.6 Media images | `/media/img/*` | `/api/static/*` | Multiple | 1 hr |
| 6.7 Plex images | `/media/plex/img/*` | `/api/content/plex/image/*` | Menu.jsx, ShowView.jsx | 30 min |
| 6.8 Media log | `/media/log` | `/api/play/log` | Player, ContentScroller | 30 min |
| 6.9 Office endpoints | `/data/keyboard/*`, `/data/weather` | `/api/home/*` | OfficeApp.jsx | 30 min |
| 6.10 Exe endpoints | `/exe/*` | `/api/home/*` | WrapUp.jsx, OfficeOff.jsx | 15 min |
| 6.11 Harvest | `/harvest/watchlist` | `/api/content/refresh-watchlist` | useMediaKeyboardHandler.js | 15 min |

### Phase 7: Cleanup Legacy Routes (P3)

**Goal:** Remove legacy routers when hit count reaches 0

| Task | Files | Effort |
|------|-------|--------|
| 7.1 Monitor /admin/legacy for 1 week | — | Ongoing |
| 7.2 Remove legacy routers with 0 hits | server.mjs | 1 hr |
| 7.3 Delete legacy code | _legacy/ | 1 hr |

---

## 6. Recommended Immediate Actions

1. **Today:** Mount fitness router (Phase 1) - Frontend is currently broken for fitness
2. **This Week:** Create lifelog router + mount chatbots (Phase 2)
3. **Next Week:** Add missing endpoints to existing routers (Phase 3)
4. **Following Week:** Create new routers (static, calendar, lifelog) + mount homeAutomation (Phases 4-5)
5. **Then:** Frontend migration to use DDD paths (Phase 6)
6. **Ongoing:** Monitor legacy hits and cleanup (Phase 7)

## 7. Complete Endpoint Mapping Table

| # | Frontend Path | Target DDD Path | Router | Status |
|---|--------------|-----------------|--------|--------|
| 1 | `/api/list/plex/*` | `/api/list/plex/*` | list.mjs | ✅ Mounted |
| 2 | `/api/list/folder/*` | `/api/list/folder/*` | list.mjs | ✅ Mounted |
| 3 | `/api/content/*` | `/api/content/*` | content.mjs | ✅ Mounted |
| 4 | `/api/play/*` | `/api/play/*` | play.mjs | ✅ Mounted |
| 5 | `/api/local-content/*` | `/api/local-content/*` | localContent.mjs | ✅ Mounted |
| 6 | `/api/health/*` | `/api/health/*` | health.mjs | ✅ Mounted |
| 7 | `/api/finance/*` | `/api/finance/*` | finance.mjs | ✅ Mounted |
| 8 | `/api/entropy` | `/api/entropy` | entropy.mjs | ✅ Mounted |
| 9 | `/api/gratitude/*` | `/api/gratitude/*` | gratitude.mjs | ✅ Mounted |
| 10 | `/proxy/*` | `/proxy/*` | proxy.mjs | ✅ Mounted |
| 11 | `/api/fitness/*` | `/api/fitness/*` | fitness.mjs | ❌ Not mounted |
| 12 | `/api/lifelog` | `/api/lifelog` | lifelog.mjs | ❌ Router missing |
| 13 | `/api/foodlog` | `/api/nutribot/webhook` | nutribot.mjs | ❌ Not mounted |
| 14 | `/api/journalist` | `/api/journalist/webhook` | journalist.mjs | ❌ Not mounted |
| 15 | `/media/log` | `/api/play/log` | play.mjs | ❌ Endpoint missing |
| 16 | `/media/plex/img/*` | `/api/content/plex/image/*` | content.mjs | ❌ Endpoint missing |
| 17 | `/media/plex/info/*` | `/api/content/plex/info/*` | content.mjs | ❌ Endpoint missing |
| 18 | `/media/plex/mpd/*` | `/api/play/plex/mpd/*` | play.mjs | ❌ Endpoint missing |
| 19 | `/media/img/*` | `/api/static/*` | static.mjs | ❌ Router missing |
| 20 | `/data/events` | `/api/calendar/events` | calendar.mjs | ❌ Router missing |
| 21 | `/home/calendar` | `/api/calendar/events` | calendar.mjs | ❌ Router missing |
| 22 | `/home/entropy` | `/api/entropy` | entropy.mjs | ⚠️ Frontend needs update |
| 23 | `/data/lifelog/weight` | `/api/health/weight` | health.mjs | ❌ Endpoint missing |
| 24 | `/data/menu_log` | `/api/content/menu-log` | content.mjs | ❌ Endpoint missing |
| 25 | `/data/keyboard/*` | `/api/home/keyboard/*` | homeAutomation.mjs | ❌ Not mounted |
| 26 | `/data/weather` | `/api/home/weather` | homeAutomation.mjs | ❌ Not mounted |
| 27 | `/harvest/watchlist` | `/api/content/refresh-watchlist` | content.mjs | ❌ Endpoint missing |
| 28 | `/exe/tv/off` | `/api/home/tv/power` | homeAutomation.mjs | ❌ Not mounted |
| 29 | `/exe/office_tv/off` | `/api/home/office-tv/power` | homeAutomation.mjs | ❌ Not mounted |
| 30 | `/exe/ws/restart` | `/api/admin/ws/restart` | admin.mjs | ❌ Endpoint missing |
| 31 | `/ws` | `/ws` | WebSocketEventBus | ✅ Working |
| 32 | `/api/ping` | `/api/ping` | server.mjs | ✅ Working |
| 33 | `/api/status` | `/api/status` | server.mjs | ✅ Working |

**Summary:** 12 working, 18 need work, 3 frontend-only updates

---

## 7. Appendix: Full Endpoint Inventory

### DDD Routers Available (20)
```
ai.mjs           fitness.mjs      journalist.mjs   nutrition.mjs
content.mjs      gratitude.mjs    list.mjs         play.mjs
entropy.mjs      health.mjs       localContent.mjs printer.mjs
externalProxy.mjs homeAutomation.mjs messaging.mjs  proxy.mjs
finance.mjs      journaling.mjs   nutribot.mjs     tts.mjs
```

### DDD Routers Mounted (8)
```
/api/content     → content.mjs
/api/list        → list.mjs
/api/play        → play.mjs
/api/local-content → localContent.mjs
/api/health      → health.mjs
/api/finance     → finance.mjs
/api/entropy     → entropy.mjs
/api/gratitude   → gratitude.mjs
/proxy           → proxy.mjs
```

### DDD Routers NOT Mounted (12)
```
fitness.mjs      ← CRITICAL (frontend uses)
nutribot.mjs     ← HIGH (webhook)
journalist.mjs   ← HIGH (webhook)
ai.mjs
externalProxy.mjs
homeAutomation.mjs
journaling.mjs
messaging.mjs
nutrition.mjs
printer.mjs
tts.mjs
```

### Legacy Routers Still Active (7)
```
/data/*          → fetch.mjs
/harvest/*       → harvest.mjs
/home/*          → home.mjs
/media/*         → media.mjs
/cron/*          → cron.mjs
/plex_proxy/*    → plexProxy.mjs (deprecated)
/exe/*           → exe.mjs
/api/*           → api.mjs (catch-all)
```
