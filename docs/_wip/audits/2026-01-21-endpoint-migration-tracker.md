# Endpoint Migration Tracker

**Date:** 2026-01-21 (Updated with dev server testing)
**Status:** Phase 2 Complete - Dev Server Parity Audit Done
**Related:**
- `docs/plans/2026-01-21-frontend-api-cutover-design.md`
- `docs/_wip/audits/2026-01-21-parity-audit-results.md`

---

## Summary

**Total Legacy Endpoints Called by Frontend:** 47
**New Backend Equivalents Exist:** 38
**Parity Tested:** 35
**Full Parity (Ready):** 26
**Blockers Found:** 1 (on dev server), 4 (on Docker)

### Critical Blockers (Updated)

| Blocker | Docker | Dev Server | Notes |
|---------|--------|------------|-------|
| `POST /media/log` | ❌ Permission denied | ✅ **WORKS** | Docker volume issue only |
| `/data/list/{key}` | ✅ **FIXED** | ✅ **FIXED** | Added `local` alias for FolderAdapter |
| `/data/scripture/{id}` | ❌ Data not found | ❌ Data not found | Data files missing (not code issue) |
| `/api/fitness/zone_led` | ❌ HA config | ✅ **WORKS** | New backend works better |

---

## P0: Foundation Endpoints (Shared Across Apps)

### Plex Proxy

| Status | Legacy Route | New Route | Frontend Callers | Parity |
|--------|--------------|-----------|------------------|--------|
| [ ] | `/plex_proxy/photo/...` | `/api/v1/proxy/plex/photo/...` | FitnessPlayer.jsx | **needs-test** |

**Notes:** Used for thumbnail transcoding. New backend has `/proxy/plex/*` but needs parity testing.

### Media Playback

| Status | Legacy Route | New Route | Frontend Callers | Parity |
|--------|--------------|-----------|------------------|--------|
| [x] | `media/plex/url/{id}` | `/api/v1/api/play/plex/{id}` | FitnessApp, FitnessShow | **STRUCT** - New returns JSON with URL |
| [x] | `media/plex/img/{id}` | `/api/v1/api/content/plex/image/{id}` | FitnessApp, FitnessShow, Menu | **OK** |
| [x] | `media/plex/mpd/{id}` | `/api/v1/api/play/plex/mpd/{id}` | DebugInfo | **OK** |
| [x] | `media/plex/info/{id}` | `/api/v1/api/content/plex/info/{id}` | FitnessApp, DebugInfo | **STRUCT** - Different response format |
| [x] | `media/plex/list/{id}` | `/api/v1/api/list/plex/{id}` | FitnessShow, FitnessMenu, FitnessMusicPlayer, useFetchPlexData | **OK** |
| [x] | `media/plex/list/{id}/playable` | `/api/v1/api/list/plex/{id}/playable` | FitnessShow, useQueueController, api.js | **OK** |
| [x] | **`media/log` (POST)** | `/api/v1/api/play/log` | useCommonMediaController, useMediaKeyboardHandler, ContentScroller, FitnessPlayer | **OK** (dev server) / **BLOCKED** (Docker) |

### Media Static Assets

| Status | Legacy Route | New Route | Frontend Callers | Parity |
|--------|--------------|-----------|------------------|--------|
| [x] | `/media/img/users/{id}` | `/api/v1/api/static/users/{id}` | FitnessSidebarMenu, FitnessUsers, SidebarFooter, PersonCard, Gratitude, FamilySelector, etc. | **OK** |
| [x] | `/media/img/equipment/{id}` | `/api/v1/api/static/equipment/{id}` | FitnessUsers, RpmDeviceAvatar, VibrationCard, FullscreenVitalsOverlay | **OK** |
| [x] | `/media/img/art/{path}` | `/api/v1/api/static/art/{path}` | Art.jsx | **OK** |
| [x] | `/media/img/icons/{icon}.svg` | `/api/v1/api/static/img/icons/{icon}.svg` | FitnessNavbar | **OK** |
| [ ] | `/media/{audio}.mp3` | **MISSING** | GovernanceAudioPlayer | **GAP** |
| [ ] | `media/audio/ambient/{id}` | **MISSING** | ContentScroller | **GAP** |
| [ ] | `media/audio/poetry/{id}` | **MISSING** | ContentScroller | **GAP** |

**Note:** Static router is mounted at `/api/static`, so paths need `/api/v1/api/static/*` (not `/api/v1/static/*`).

### Data Fetch (Config/Lists)

| Status | Legacy Route | New Route | Frontend Callers | Parity |
|--------|--------------|-----------|------------------|--------|
| [x] | `data/list/{key}` | `/api/v1/list/local/{key}` | useQueueController, api.js, PlexMenuRouter | **STRUCT** - Different item format |
| [x] | `data/list/{key}/playable` | `/api/v1/list/local/{key}/playable` | useQueueController, api.js | **OK** |
| [x] | `data/list/TVApp/recent_on_top` | `/api/v1/list/local/TVApp/recent_on_top` | TVApp.jsx | **OK** |
| [ ] | `data/households/default/apps/piano/config` | `/api/v1/content/config/piano` | PianoVisualizer | **needs-mapping** |
| [ ] | `data/menu_log` (POST) | `/api/v1/content/menu-log` | Menu.jsx | **ready** |
| [ ] | `/data/events` | `/api/v1/calendar/events` | Upcoming.jsx | **ready** |
| [ ] | `/data/weather` | **MISSING** | OfficeApp.jsx | **GAP** |
| [ ] | `/data/keyboard/officekeypad` | `/api/v1/home/keyboard/officekeypad` | OfficeApp.jsx | **needs-test** |
| [ ] | `/data/lifelog/weight` | `/api/v1/health/weight` | Health.jsx | **ready** |
| [ ] | `data/scripture/{id}` | `/api/v1/local-content/scripture/{id}` | ContentScroller | **ready** |
| [ ] | `data/talk/{id}` | `/api/v1/local-content/talk/{id}` | ContentScroller | **ready** |
| [ ] | `data/poetry/{id}` | `/api/v1/local-content/poem/{id}` | ContentScroller | **ready** |

---

## P1: TV App Endpoints

| Status | Legacy Route | New Route | Frontend Callers | Parity |
|--------|--------------|-----------|------------------|--------|
| [ ] | See `media/plex/*` above | - | Menu, PlexMenuRouter, useFetchPlexData | - |

---

## P1: Fitness App Endpoints

| Status | Legacy Route | New Route | Frontend Callers | Parity |
|--------|--------------|-----------|------------------|--------|
| [x] | `/api/fitness` | `/api/v1/api/fitness` | FitnessMenu, FitnessPluginMenu, FitnessApp | **OK** - Full match |
| [x] | **`api/fitness/save_session` (POST)** | `/api/v1/api/fitness/save_session` | PersistenceManager.js | **OK** - Validation works |
| [x] | `/api/fitness/sessions/dates` | `/api/v1/api/fitness/sessions/dates` | SessionBrowserApp | **OK** |
| [x] | `/api/fitness/sessions?date={date}` | `/api/v1/api/fitness/sessions?date={date}` | SessionBrowserApp | **OK** |
| [x] | `/api/fitness/sessions/{id}` | `/api/v1/api/fitness/sessions/{id}` | SessionBrowserApp | **OK** |
| [x] | `api/fitness/zone_led` (POST) | `/api/v1/api/fitness/zone_led` | useZoneLedSync | **OK** (dev server) / **BLOCKED** (Docker) - New works better |
| [ ] | `api/fitness/voice_memo` (POST) | `/api/v1/api/fitness/voice_memo` | useVoiceMemoRecorder | untested |
| [ ] | `/api/fitness/simulate` (POST/DELETE) | **MISSING** | FitnessApp (dev only) | **GAP-OK** |

---

## P1: Office App Endpoints

| Status | Legacy Route | New Route | Frontend Callers | Parity |
|--------|--------------|-----------|------------------|--------|
| [x] | `/home/entropy` | `/api/v1/api/entropy` | EntropyPanel.jsx | **OK** |
| [x] | `/home/calendar` | `/api/v1/api/calendar/events` | Calendar.jsx | **OK** |
| [ ] | `exe/ha/script/{script}` (POST) | `/api/v1/api/home/cmd` | PianoVisualizer | untested |
| [x] | `exe/office_tv/off` | `/api/v1/api/home/office_tv/off` | OfficeOff.jsx | **OK** (new works, legacy broken) |
| [x] | `exe/tv/off` | `/api/v1/api/home/tv/off` | WrapUp.jsx | **OK** (new works, legacy broken) |
| [ ] | `/exe/ws/restart` | `/api/v1/admin/ws/restart` | WebSocketContext | untested |

---

## P2: Finance App Endpoints

| Status | Legacy Route | New Route | Frontend Callers | Parity |
|--------|--------------|-----------|------------------|--------|
| [x] | `/data/budget` | `/api/v1/api/finance/data` | FinanceApp.jsx | **OK** |
| [x] | `/data/budget/daytoday` | `/api/v1/api/finance/data/daytoday` | Finance.jsx | **OK** |
| [x] | `/harvest/budget` | `/api/v1/api/finance/refresh` | FinanceApp.jsx | **CONFIG** - New needs FinanceHarvestService init |
| [ ] | `harvest/watchlist` | **MISSING** | useMediaKeyboardHandler | **GAP** |

---

## P2: Health App Endpoints

| Status | Legacy Route | New Route | Frontend Callers | Parity |
|--------|--------------|-----------|------------------|--------|
| [x] | `/api/health/status` | `/api/v1/api/health/status` | HealthApp.jsx | **OK** - struct match |
| [x] | `api/health/nutrilist/{date}` | `/api/v1/api/health/nutrilist/{date}` | Nutrition.jsx | **OK** - new works better (legacy errors) |
| [ ] | `health/nutrilist/{uuid}` (DELETE) | `/api/v1/api/health/nutrilist/{uuid}` | NutritionDay.jsx | untested |
| [ ] | `health/nutrilist/{uuid}` (PUT) | `/api/v1/api/health/nutrilist/{uuid}` | NutritionDay.jsx | untested |

---

## P2: Lifelog App Endpoints

| Status | Legacy Route | New Route | Frontend Callers | Parity |
|--------|--------------|-----------|------------------|--------|
| [x] | `/api/lifelog` | `/api/v1/lifelog` | LifelogApp.jsx | **OK** |

---

## P2: Gratitude App Endpoints

| Status | Legacy Route | New Route | Frontend Callers | Parity |
|--------|--------------|-----------|------------------|--------|
| [x] | `/api/gratitude/bootstrap` | `/api/v1/gratitude/bootstrap` | Gratitude.jsx, FamilySelector.jsx | **OK** - Full match |
| [x] | `/api/gratitude/selections/{cat}` (GET) | `/api/v1/gratitude/selections/{cat}` | Gratitude.jsx | **OK** |
| [ ] | `/api/gratitude/selections/{cat}` (POST) | `/api/v1/gratitude/selections/{cat}` | Gratitude.jsx | untested |
| [ ] | `/api/gratitude/selections/{cat}/{id}` (DELETE) | `/api/v1/gratitude/selections/{cat}/{id}` | Gratitude.jsx | untested |
| [ ] | `/api/gratitude/discarded/{cat}` (POST) | `/api/v1/gratitude/discarded/{cat}` | Gratitude.jsx | untested |

---

## WebSocket

| Status | Legacy Route | New Route | Frontend Callers | Parity |
|--------|--------------|-----------|------------------|--------|
| [x] | `/ws` | `/ws` (same) | WebSocketService.js | **no-change** |

**Notes:** WebSocket is already owned by new backend. No frontend changes needed.

---

## Gaps Summary (Backend Work Required)

| Legacy Route | Issue | Recommended Action |
|--------------|-------|-------------------|
| `/media/{audio}.mp3` | Audio file serving not in new backend | Add to `/api/v1/static` or `/api/v1/play` |
| `media/audio/ambient/{id}` | Ambient audio serving | Add to `/api/v1/play/audio/ambient/{id}` |
| `media/audio/poetry/{id}` | Poetry audio serving | Add to `/api/v1/play/audio/poetry/{id}` |
| `/data/weather` | Weather data endpoint | Add to `/api/v1/home/weather` or `/api/v1/calendar` |
| `harvest/watchlist` | Triggers Plex watchlist harvest | Add to `/api/v1/content/harvest/watchlist` |
| `/api/fitness/simulate` | Dev-only simulation | Low priority, keep in legacy |

---

## Parity Testing Commands

```bash
# Template: Compare legacy vs new response (note: /api/v1/api/ prefix)
diff <(curl -s localhost:3112/{legacy_path} | jq -S .) \
     <(curl -s localhost:3112/api/v1/api/{new_path} | jq -S .)

# Example: Test fitness config
diff <(curl -s localhost:3112/api/fitness | jq -S .) \
     <(curl -s localhost:3112/api/v1/api/fitness | jq -S .)

# Example: Test media/log POST (WORKS on dev server!)
curl -X POST localhost:3112/media/log \
  -H "Content-Type: application/json" \
  -d '{"type":"plex","media_key":"6880","percent":50,"seconds":300}'

curl -X POST localhost:3112/api/v1/api/play/log \
  -H "Content-Type: application/json" \
  -d '{"type":"plex","media_key":"6880","percent":50,"seconds":300}'

# Test plex info (different structures - STRUCT diff)
curl -s localhost:3112/media/plex/info/6880 | jq -S .
curl -s localhost:3112/api/v1/api/content/plex/info/6880 | jq -S .

# Test static files
curl -sI localhost:3112/media/img/art/nativity.jpg
curl -sI localhost:3112/api/v1/api/static/art/nativity.jpg

# Test home automation (new works, legacy broken)
curl -s localhost:3112/api/v1/api/home/office_tv/off
```

---

## Next Steps

1. **Run parity tests** for all "needs-test" endpoints
2. **Add missing endpoints** for identified gaps
3. **Begin P0 frontend migration** once parity confirmed
4. **Update this tracker** as endpoints are migrated (change [ ] to [x])
