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

### 1.9 Legacy-Only Endpoints (No DDD Equivalent)

#### Media Endpoints (`/media/*`)
| Endpoint | Frontend Usage | Legacy Router | Notes |
|----------|---------------|---------------|-------|
| `POST /media/log` | Player, ContentScroller, FitnessPlayer | media.mjs | Shim exists in DDD |
| `GET /media/plex/img/{id}` | Menu, ShowView | media.mjs | Image proxy |
| `GET /media/plex/info/{id}` | DebugInfo | media.mjs | Media metadata |
| `GET /media/plex/mpd/{id}` | DebugInfo | media.mjs | DASH manifest |
| `GET /media/img/entropy/{icon}` | EntropyPanel | media.mjs | Static images |
| `GET /media/img/art/{path}` | Art | media.mjs | Static images |
| `GET /media/img/users/{id}` | Multiple fitness/gratitude | media.mjs | User avatars |
| `GET /media/img/equipment/{id}` | Fitness | media.mjs | Equipment icons |

#### Data Endpoints (`/data/*`)
| Endpoint | Frontend Usage | Legacy Router | Notes |
|----------|---------------|---------------|-------|
| `GET /data/budget` | FinanceApp | fetch.mjs | Redirect to /api/finance |
| `GET /data/budget/daytoday` | Finance | fetch.mjs | Redirect to /api/finance |
| `GET /data/events` | Upcoming | fetch.mjs | Calendar events |
| `GET /data/lifelog/weight` | Health | fetch.mjs | Weight data |
| `POST /data/menu_log` | Menu | fetch.mjs | Menu selection logging |
| `GET /data/keyboard/officekeypad` | OfficeApp | fetch.mjs | Keyboard config |
| `GET /data/weather` | OfficeApp | fetch.mjs | Weather data |

#### Home Automation (`/home/*`)
| Endpoint | Frontend Usage | Legacy Router | Notes |
|----------|---------------|---------------|-------|
| `GET /home/calendar` | Calendar | home.mjs | Calendar data |
| `GET /home/entropy` | EntropyPanel | home.mjs | Duplicate of /api/entropy |

#### Harvest Endpoints (`/harvest/*`)
| Endpoint | Frontend Usage | Legacy Router | Notes |
|----------|---------------|---------------|-------|
| `POST /harvest/watchlist` | useMediaKeyboardHandler | harvest.mjs | Refresh watchlist |
| `POST /harvest/budget` | FinanceApp | harvest.mjs | Redirect to /api/finance |

#### Remote Execution (`/exe/*`)
| Endpoint | Frontend Usage | Legacy Router | Notes |
|----------|---------------|---------------|-------|
| `POST /exe/tv/off` | WrapUp | exe.mjs | TV power control |
| `POST /exe/office_tv/off` | OfficeOff | exe.mjs | Office TV control |
| `POST /exe/ws/restart` | WebSocketContext | exe.mjs | WS server restart |

#### System Endpoints
| Endpoint | Frontend Usage | Legacy Router | Notes |
|----------|---------------|---------------|-------|
| `GET /api/ping` | DebugInfo | server.mjs | Health check (DDD) |
| `GET /api/status` | DebugInfo | server.mjs | Status check (DDD) |

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

### 3.3 Medium Priority Gaps (Legacy-Only, Frequently Used)

| Gap | Impact | Priority |
|-----|--------|----------|
| `/media/*` endpoints | No DDD equivalent, heavily used | P2 |
| `/data/*` endpoints | Some redirects exist, others legacy | P2 |
| `/home/*` endpoints | Calendar, entropy duplicate | P2 |

### 3.4 Low Priority Gaps (Legacy-Only, Infrequently Used)

| Gap | Impact | Priority |
|-----|--------|----------|
| `/exe/*` endpoints | Remote execution, occasional use | P3 |
| `/harvest/*` endpoints | Manual refresh triggers | P3 |

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

### Phase 3: Create DDD Routers for Legacy Endpoints (P2)

**Goal:** Create DDD equivalents for remaining legacy endpoints

| Task | Files | Effort |
|------|-------|--------|
| 3.1 Create media router (image proxy, plex) | routers/media.mjs | 4 hr |
| 3.2 Create data router (YAML serving) | routers/data.mjs | 4 hr |
| 3.3 Create home router (calendar, HA) | routers/home.mjs | 2 hr |
| 3.4 Mount all new routers | server.mjs | 1 hr |

### Phase 4: Frontend Migration (P2)

**Goal:** Update frontend to use canonical DDD endpoints

| Task | Files | Effort |
|------|-------|--------|
| 4.1 Update EntropyPanel: /home/entropy → /api/entropy | EntropyPanel.jsx | 15 min |
| 4.2 Update Finance: /data/budget → /api/finance | Finance.jsx, FinanceApp.jsx | 30 min |
| 4.3 Standardize all DaylightAPI calls | Multiple | 2 hr |

### Phase 5: Cleanup Legacy Routes (P3)

**Goal:** Remove legacy routers when hit count reaches 0

| Task | Files | Effort |
|------|-------|--------|
| 5.1 Monitor /admin/legacy for 1 week | — | Ongoing |
| 5.2 Remove legacy routers with 0 hits | server.mjs | 1 hr |
| 5.3 Delete legacy code | _legacy/ | 1 hr |

---

## 6. Recommended Immediate Actions

1. **Today:** Mount fitness router (Phase 1) - Frontend is currently broken for fitness
2. **This Week:** Mount chatbot routers (Phase 2) - Telegram webhooks work but use legacy
3. **Next Week:** Create media/data DDD routers (Phase 3) - Most remaining traffic

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
