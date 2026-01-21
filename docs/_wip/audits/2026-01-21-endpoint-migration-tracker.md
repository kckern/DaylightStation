# Endpoint Migration Tracker

**Date:** 2026-01-21
**Status:** Phase 2 Complete - Parity Audit Done
**Related:**
- `docs/plans/2026-01-21-frontend-api-cutover-design.md`
- `docs/_wip/audits/2026-01-21-parity-audit-results.md`

---

## Summary

**Total Legacy Endpoints Called by Frontend:** 47
**New Backend Equivalents Exist:** 38
**Parity Tested:** 28
**Full Parity (Ready):** 18
**Blockers Found:** 4

### Critical Blockers

1. **`POST /media/log`** - Permission denied on `/data/media_memory` in Docker
2. **`/data/list/{key}`** - Missing `local` source adapter
3. **`/data/scripture/{id}`** - LocalContent adapter not finding data
4. **`/api/fitness/zone_led`** - Home Assistant not configured

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
| [ ] | `media/plex/url/{id}` | `/api/v1/play/plex/{id}` | FitnessApp, FitnessShow | **needs-test** |
| [ ] | `media/plex/img/{id}` | `/api/v1/content/plex/image/{id}` | FitnessApp, FitnessShow, Menu | **needs-test** |
| [ ] | `media/plex/mpd/{id}` | `/api/v1/play/plex/mpd/{id}` | DebugInfo | **needs-test** |
| [ ] | `media/plex/info/{id}` | `/api/v1/content/plex/info/{id}` | FitnessApp, DebugInfo | **needs-test** |
| [x] | `media/plex/list/{id}` | `/api/v1/api/list/plex/{id}` | FitnessShow, FitnessMenu, FitnessMusicPlayer, useFetchPlexData | **OK** |
| [x] | `media/plex/list/{id}/playable` | `/api/v1/api/list/plex/{id}/playable` | FitnessShow, useQueueController, api.js | **OK** |
| [ ] | **`media/log` (POST)** | `/api/v1/play/log` | useCommonMediaController, useMediaKeyboardHandler, ContentScroller, FitnessPlayer | **BLOCKED** - Permission error |

### Media Static Assets

| Status | Legacy Route | New Route | Frontend Callers | Parity |
|--------|--------------|-----------|------------------|--------|
| [x] | `/media/img/users/{id}` | `/api/v1/static/users/{id}` | FitnessSidebarMenu, FitnessUsers, SidebarFooter, PersonCard, Gratitude, FamilySelector, etc. | **OK** |
| [x] | `/media/img/equipment/{id}` | `/api/v1/static/equipment/{id}` | FitnessUsers, RpmDeviceAvatar, VibrationCard, FullscreenVitalsOverlay | **OK** |
| [ ] | `/media/img/art/{path}` | `/api/v1/static/art/{path}` | Art.jsx | **needs-test** |
| [ ] | `/media/img/icons/{icon}.svg` | `/api/v1/static/img/icons/{icon}.svg` | FitnessNavbar | **needs-test** |
| [ ] | `/media/{audio}.mp3` | **MISSING** | GovernanceAudioPlayer | **GAP** |
| [ ] | `media/audio/ambient/{id}` | **MISSING** | ContentScroller | **GAP** |
| [ ] | `media/audio/poetry/{id}` | **MISSING** | ContentScroller | **GAP** |

### Data Fetch (Config/Lists)

| Status | Legacy Route | New Route | Frontend Callers | Parity |
|--------|--------------|-----------|------------------|--------|
| [ ] | `data/list/{key}` | `/api/v1/list/{source}/{key}` | useQueueController, api.js, PlexMenuRouter | **BLOCKED** - Missing local adapter |
| [ ] | `data/list/{key}/playable` | `/api/v1/list/{source}/{key}/playable` | useQueueController, api.js | **BLOCKED** - Missing local adapter |
| [ ] | `data/list/TVApp/recent_on_top` | `/api/v1/list/local/TVApp/recent_on_top` | TVApp.jsx | **BLOCKED** - Missing local adapter |
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
| [x] | `/api/fitness` | `/api/v1/fitness` | FitnessMenu, FitnessPluginMenu, FitnessApp | **OK** - Full match |
| [x] | **`api/fitness/save_session` (POST)** | `/api/v1/fitness/save_session` | PersistenceManager.js | **OK** - Validation works |
| [x] | `/api/fitness/sessions/dates` | `/api/v1/fitness/sessions/dates` | SessionBrowserApp | **OK** |
| [x] | `/api/fitness/sessions?date={date}` | `/api/v1/fitness/sessions?date={date}` | SessionBrowserApp | **OK** |
| [x] | `/api/fitness/sessions/{id}` | `/api/v1/fitness/sessions/{id}` | SessionBrowserApp | **OK** |
| [ ] | `api/fitness/zone_led` (POST) | `/api/v1/fitness/zone_led` | useZoneLedSync | **BLOCKED** - HA config |
| [ ] | `api/fitness/voice_memo` (POST) | `/api/v1/fitness/voice_memo` | useVoiceMemoRecorder | untested |
| [ ] | `/api/fitness/simulate` (POST/DELETE) | **MISSING** | FitnessApp (dev only) | **GAP-OK** |

---

## P1: Office App Endpoints

| Status | Legacy Route | New Route | Frontend Callers | Parity |
|--------|--------------|-----------|------------------|--------|
| [x] | `/home/entropy` | `/api/v1/entropy` | EntropyPanel.jsx | **OK** |
| [x] | `/home/calendar` | `/api/v1/calendar/events` | Calendar.jsx | **OK** |
| [ ] | `exe/ha/script/{script}` (POST) | `/api/v1/home/cmd` | PianoVisualizer | untested |
| [ ] | `exe/office_tv/off` | `/api/v1/home/office_tv/off` | OfficeOff.jsx | untested |
| [ ] | `exe/tv/off` | `/api/v1/home/tv/off` | WrapUp.jsx | untested |
| [ ] | `/exe/ws/restart` | `/api/v1/admin/eventbus/restart` | WebSocketContext | untested |

---

## P2: Finance App Endpoints

| Status | Legacy Route | New Route | Frontend Callers | Parity |
|--------|--------------|-----------|------------------|--------|
| [x] | `/data/budget` | `/api/v1/finance/data` | FinanceApp.jsx | **OK** |
| [x] | `/data/budget/daytoday` | `/api/v1/finance/data/daytoday` | Finance.jsx | **OK** |
| [ ] | `/harvest/budget` | `/api/v1/finance/refresh` | FinanceApp.jsx | untested |
| [ ] | `harvest/watchlist` | **MISSING** | useMediaKeyboardHandler | **GAP** |

---

## P2: Health App Endpoints

| Status | Legacy Route | New Route | Frontend Callers | Parity |
|--------|--------------|-----------|------------------|--------|
| [x] | `/api/health/status` | `/api/v1/health/status` | HealthApp.jsx | **OK** - struct match |
| [x] | `api/health/nutrilist/{date}` | `/api/v1/health/nutrilist/{date}` | Nutrition.jsx | **OK** - new works better |
| [ ] | `health/nutrilist/{uuid}` (DELETE) | `/api/v1/health/nutrilist/{uuid}` | NutritionDay.jsx | untested |
| [ ] | `health/nutrilist/{uuid}` (PUT) | `/api/v1/health/nutrilist/{uuid}` | NutritionDay.jsx | untested |

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
# Template: Compare legacy vs new response
diff <(curl -s localhost:3112/{legacy_path} | jq -S .) \
     <(curl -s localhost:3112/api/v1/{new_path} | jq -S .)

# Example: Test fitness config
diff <(curl -s localhost:3112/api/fitness | jq -S .) \
     <(curl -s localhost:3112/api/v1/fitness | jq -S .)

# Example: Test media/log POST
curl -X POST localhost:3112/media/log \
  -H "Content-Type: application/json" \
  -d '{"type":"plex","media_key":"12345","percent":50,"seconds":300}'

curl -X POST localhost:3112/api/v1/play/log \
  -H "Content-Type: application/json" \
  -d '{"type":"plex","media_key":"12345","percent":50,"seconds":300}'
```

---

## Next Steps

1. **Run parity tests** for all "needs-test" endpoints
2. **Add missing endpoints** for identified gaps
3. **Begin P0 frontend migration** once parity confirmed
4. **Update this tracker** as endpoints are migrated (change [ ] to [x])
