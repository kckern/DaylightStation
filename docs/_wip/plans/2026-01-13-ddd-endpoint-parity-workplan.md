# DDD Endpoint Parity Workplan

**Date:** 2026-01-13
**Goal:** Achieve full DDD endpoint parity so frontend can migrate off legacy endpoints
**Strategy:** Build DDD endpoints first, keep legacy working, then migrate frontend incrementally

---

## Current State

| Category | Count |
|----------|-------|
| ✅ DDD working | 15 |
| ❌ DDD missing | 22 |
| 📦 Deprecated (FE migrated) | 8 |

---

## Phase 1: Mount Existing DDD Routers

**Priority:** P0 - These routers are already written, just need wiring up.

### 1.1 Mount Fitness Router

The fitness.mjs router exists with full implementation. Needs services wired up in server.mjs.

**Files:**
- `backend/src/server.mjs` - Add service creation and router mounting
- `backend/src/0_infrastructure/bootstrap.mjs` - Verify createFitnessServices exists

**Endpoints unlocked:**
- `GET /api/fitness`
- `GET /api/fitness/sessions/dates`
- `GET /api/fitness/sessions`
- `GET /api/fitness/sessions/:id`
- `POST /api/fitness/save_session`
- `POST /api/fitness/save_screenshot`
- `POST /api/fitness/voice_memo`
- `POST /api/fitness/zone_led`
- `GET /api/fitness/zone_led/status`

**Dependencies:**
- SessionService
- ZoneLedController (AmbientLedAdapter)
- UserService
- UserDataService
- ConfigService
- TranscriptionService (OpenAI)

### 1.2 Mount HomeAutomation Router

**Files:**
- `backend/src/server.mjs`
- `backend/src/4_api/routers/homeAutomation.mjs` - Verify/extend

**Endpoints unlocked:**
- `GET /api/home/keyboard/:id`
- `GET /api/home/weather`
- `POST /api/home/tv/power`
- `POST /api/home/office-tv/power`
- `POST /api/home/volume/up`
- `POST /api/home/volume/down`
- `POST /api/home/volume/mute`
- `POST /api/home/volume/cycle`

**Dependencies:**
- HomeAssistantAdapter
- ConfigService

### 1.3 Mount Nutribot Router

**Files:**
- `backend/src/server.mjs`
- `backend/src/4_api/routers/nutribot.mjs`

**Endpoints unlocked:**
- `POST /api/nutribot/webhook` (Telegram webhook)
- `GET /api/nutribot/report`
- `GET /api/nutribot/images/*`

**Dependencies:**
- NutribotServices (from bootstrap.mjs)
- TelegramAdapter

### 1.4 Mount Journalist Router

**Files:**
- `backend/src/server.mjs`
- `backend/src/4_api/routers/journalist.mjs`

**Endpoints unlocked:**
- `POST /api/journalist/webhook` (Telegram webhook)

**Dependencies:**
- JournalistServices (from bootstrap.mjs)
- TelegramAdapter

---

## Phase 2: Add Missing Endpoints to Mounted Routers

**Priority:** P1 - Routers are mounted, just need additional endpoints.

### 2.1 Extend play.mjs

**Current:** Mounted at `/api/play`

**Add:**
| Endpoint | Purpose | Legacy Equivalent |
|----------|---------|-------------------|
| `POST /api/play/log` | Log media playback | `/media/log` |
| `GET /api/play/plex/mpd/:id` | Get MPD manifest | `/media/plex/mpd/:id` |

**Files:**
- `backend/src/4_api/routers/play.mjs`

### 2.2 Extend content.mjs

**Current:** Mounted at `/api/content`

**Add:**
| Endpoint | Purpose | Legacy Equivalent |
|----------|---------|-------------------|
| `GET /api/content/plex/image/:id` | Plex image proxy | `/media/plex/img/:id` |
| `GET /api/content/plex/info/:id` | Plex item info | `/media/plex/info/:id` |
| `POST /api/content/menu-log` | Log menu navigation | `/data/menu_log` |
| `POST /api/content/refresh-watchlist` | Refresh watchlist | `/harvest/watchlist` |

**Files:**
- `backend/src/4_api/routers/content.mjs`

### 2.3 Extend health.mjs

**Current:** Mounted at `/api/health`

**Add:**
| Endpoint | Purpose | Legacy Equivalent |
|----------|---------|-------------------|
| `GET /api/health/weight` | Get weight history | `/data/lifelog/weight` |

**Files:**
- `backend/src/4_api/routers/health.mjs`

### 2.4 Add Admin Endpoints

**Current:** Admin router exists at `/admin`

**Add:**
| Endpoint | Purpose | Legacy Equivalent |
|----------|---------|-------------------|
| `POST /api/admin/ws/restart` | Restart WebSocket | `/exe/ws/restart` |

**Files:**
- `backend/src/4_api/routers/admin/` - Create or extend

---

## Phase 3: Create New DDD Routers

**Priority:** P2 - Need to create routers from scratch.

### 3.1 Create lifelog.mjs

**Mount at:** `/api/lifelog`

**Endpoints:**
| Endpoint | Purpose | Legacy Equivalent |
|----------|---------|-------------------|
| `GET /api/lifelog` | Get aggregated lifelog | `/api/lifelog` |

**Notes:**
- Domain exists at `1_domains/lifelog/` with LifelogAggregator
- Has 15 extractors already implemented
- Just needs API router wrapper

**Files:**
- `backend/src/4_api/routers/lifelog.mjs` (create)
- `backend/src/0_infrastructure/bootstrap.mjs` (add createLifelogApiRouter)
- `backend/src/server.mjs` (mount)

### 3.2 Create static.mjs

**Mount at:** `/api/static`

**Endpoints:**
| Endpoint | Purpose | Legacy Equivalent |
|----------|---------|-------------------|
| `GET /api/static/entropy/:icon` | Entropy status icons | `/media/img/entropy/:icon` |
| `GET /api/static/art/:path` | Art images | `/media/img/art/:path` |
| `GET /api/static/users/:id` | User avatars | `/media/img/users/:id` |
| `GET /api/static/equipment/:id` | Fitness equipment images | `/media/img/equipment/:id` |

**Notes:**
- Simple static file serving
- Resolve paths from config

**Files:**
- `backend/src/4_api/routers/static.mjs` (create)
- `backend/src/server.mjs` (mount)

### 3.3 Create calendar.mjs

**Mount at:** `/api/calendar`

**Endpoints:**
| Endpoint | Purpose | Legacy Equivalent |
|----------|---------|-------------------|
| `GET /api/calendar/events` | Get calendar events | `/data/events`, `/home/calendar` |

**Notes:**
- Consolidates two legacy endpoints
- May need to aggregate from multiple sources (Google Calendar, etc.)

**Files:**
- `backend/src/4_api/routers/calendar.mjs` (create)
- `backend/src/0_infrastructure/bootstrap.mjs` (add createCalendarApiRouter)
- `backend/src/server.mjs` (mount)

---

## Phase 4: Legacy Compatibility Layer

**Priority:** P1 - Run in parallel with Phases 1-3.

### 4.1 Add Redirects for Deprecated Paths

For paths where frontend has already migrated but legacy endpoints should still work:

```javascript
// In server.mjs after DDD routers are mounted
app.use('/media/plex/list', (req, res) => res.redirect(307, `/api/list/plex${req.path}`));
app.use('/data/list', (req, res) => res.redirect(307, `/api/list/folder${req.path}`));
```

### 4.2 Keep Legacy Routers Mounted

Legacy routers stay mounted with tracking middleware:
```javascript
app.use('/media', legacyTracker.middleware, mediaRouter);
app.use('/data', legacyTracker.middleware, fetchRouter);
// etc.
```

### 4.3 Monitor Legacy Usage

- Check `/admin/legacy` endpoint for hit counts
- Track which legacy paths are still being called
- Identify any missed frontend migrations

---

## Phase 5: Frontend Migration

**Priority:** P3 - Only after DDD parity achieved and stable.

### 5.1 Update Frontend API Calls

For each legacy path still in frontend, update to DDD equivalent:

| Frontend File | Current Path | New Path |
|---------------|--------------|----------|
| EntropyPanel.jsx | `/home/entropy` | `/api/entropy` |
| Calendar.jsx | `/home/calendar` | `/api/calendar/events` |
| Health.jsx | `/data/lifelog/weight` | `/api/health/weight` |
| Upcoming.jsx | `/data/events` | `/api/calendar/events` |
| Menu.jsx | `/data/menu_log` | `/api/content/menu-log` |
| WrapUp.jsx | `/exe/tv/off` | `/api/home/tv/power` |
| OfficeOff.jsx | `/exe/office_tv/off` | `/api/home/office-tv/power` |
| keyboardHandler.js | `/exe/vol/*` | `/api/home/volume/*` |
| useMediaKeyboardHandler.js | `/media/log` | `/api/play/log` |
| useMediaKeyboardHandler.js | `/harvest/watchlist` | `/api/content/refresh-watchlist` |
| ContentScroller.jsx | `/media/log` | `/api/play/log` |
| DebugInfo.jsx | `/media/plex/info/*` | `/api/content/plex/info/*` |
| DebugInfo.jsx | `/media/plex/mpd/*` | `/api/play/plex/mpd/*` |

### 5.2 Update DaylightAPI Base Paths

Consider updating `DaylightAPI` helper to normalize paths.

---

## Phase 6: Legacy Cleanup

**Priority:** P4 - Only after frontend fully migrated and stable.

### 6.1 Monitor for Zero Hits

Run for 1-2 weeks with legacy tracking enabled:
```bash
curl http://localhost:3112/admin/legacy
```

### 6.2 Remove Legacy Routers

Once hit count reaches 0 for a legacy router:
1. Remove from server.mjs
2. Delete legacy router file
3. Update tests

### 6.3 Archive Legacy Code

Move remaining `_legacy/` code to archive or delete.

---

## Implementation Order

```
Week 1: Phase 1 (Mount existing routers)
        ├── 1.1 Fitness router
        ├── 1.2 HomeAutomation router
        ├── 1.3 Nutribot router
        └── 1.4 Journalist router

Week 2: Phase 2 (Extend mounted routers)
        ├── 2.1 play.mjs endpoints
        ├── 2.2 content.mjs endpoints
        ├── 2.3 health.mjs endpoints
        └── 2.4 admin endpoints

Week 3: Phase 3 (Create new routers)
        ├── 3.1 lifelog.mjs
        ├── 3.2 static.mjs
        └── 3.3 calendar.mjs

Week 4: Phase 4 (Legacy compat) + Phase 5 start (Frontend migration)

Ongoing: Phase 6 (Cleanup after monitoring)
```

---

## Success Criteria

1. All 37 frontend endpoints have working DDD equivalents
2. Legacy endpoints continue to work (no regressions)
3. `/admin/legacy` shows decreasing hit counts over time
4. Frontend can be migrated incrementally without downtime
5. Eventually: Legacy routers removed, `_legacy/` folder deleted

---

## Testing Strategy

### Unit Tests
- Each new endpoint gets unit tests
- Mock dependencies (ConfigService, adapters, etc.)

### Integration Tests
- Test DDD endpoints return same data as legacy
- Regression tests for legacy endpoints

### Smoke Tests
- Hit each endpoint after deployment
- Verify frontend still works

### Monitoring
- Track `/admin/legacy` hit counts
- Log errors from both DDD and legacy paths
