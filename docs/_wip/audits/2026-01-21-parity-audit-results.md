# Parity Audit Results

**Date:** 2026-01-21
**Backend:** Docker container `daylight-station` on port 3111
**Routing:** `/api/v1/*` → new DDD backend, everything else → legacy

---

## Executive Summary

| Category | Count |
|----------|-------|
| **Endpoints Tested** | 28 |
| **Full Parity (OK)** | 18 |
| **Structure Match (minor diffs)** | 4 |
| **Gaps (need backend work)** | 4 |
| **Config Issues** | 2 |

### Critical Finding

**`POST /media/log` (playback tracking) is broken in new backend:**
```
Error: "EACCES: permission denied, mkdir '/data/media_memory'"
```
The new backend cannot write watch state due to Docker volume permissions. This MUST be fixed before any frontend migration.

---

## Detailed Results

### P0: Foundation Endpoints

| Endpoint | Legacy | New | Parity | Notes |
|----------|--------|-----|--------|-------|
| `GET /api/status` | 200 | 200 | **STRUCT** | New missing `serverdata` field (OK) |
| `GET /api/ping` | 200 | 200 | **OK** | |
| `GET /media/plex/list/{id}` | 200 | 200 | **OK** | |
| `GET /media/plex/info/{id}` | 200 | 200 | **OK** | |
| `GET /data/list/{key}` | 200 | 404 | **GAP** | New needs `local` source adapter |
| `GET /media/img/users/{id}` | 200 | 200 | **OK** | Static asset serving works |
| `GET /media/img/equipment/{id}` | 200 | 200 | **OK** | |
| **`POST /media/log`** | 200 | 500 | **BROKEN** | Permission denied on `/data/media_memory` |

### P1: Fitness Endpoints

| Endpoint | Legacy | New | Parity | Notes |
|----------|--------|-----|--------|-------|
| `GET /api/fitness` | 200 | 200 | **OK** | Full key match |
| `GET /api/fitness/sessions/dates` | 200 | 200 | **OK** | |
| `GET /api/fitness/sessions?date=` | 200 | 200 | **OK** | |
| `POST /api/fitness/save_session` | 400 | 400 | **OK** | Both validate correctly |
| `POST /api/fitness/zone_led` | 200 | 500 | **CONFIG** | New needs HA config |
| `POST /api/fitness/voice_memo` | - | - | untested | |

### P1: Office/Home Endpoints

| Endpoint | Legacy | New | Parity | Notes |
|----------|--------|-----|--------|-------|
| `GET /home/entropy` | 200 | 200 | **OK** | |
| `GET /home/calendar` | 200 | 200 | **OK** | |
| `GET /data/keyboard/{id}` | 200 | 200 | **OK** | |
| `GET /data/events` | 200 | 200 | **OK** | Legacy redirects, new direct |

### P1: Content Endpoints

| Endpoint | Legacy | New | Parity | Notes |
|----------|--------|-----|--------|-------|
| `GET /data/scripture/{id}` | 200 | 404 | **GAP** | LocalContent adapter not finding data |
| `GET /data/talk/{id}` | - | - | **GAP** | Data not found in legacy either |
| `GET /data/poetry/{id}` | 404 | 404 | **OK** | Both return not found (no test data) |

### P2: Finance Endpoints

| Endpoint | Legacy | New | Parity | Notes |
|----------|--------|-----|--------|-------|
| `GET /data/budget` | 200 | 200 | **OK** | Legacy redirects, new direct |
| `GET /data/budget/daytoday` | 200 | 200 | **OK** | |

### P2: Health Endpoints

| Endpoint | Legacy | New | Parity | Notes |
|----------|--------|-----|--------|-------|
| `GET /api/health/status` | 200 | 200 | **STRUCT** | New missing `architecture` field |
| `GET /api/health/weight` | 200 | 200 | **OK** | |
| `GET /api/health/nutrilist/{date}` | 500 | 200 | **DIFF** | Legacy errors, new works |

### P2: Lifelog/Gratitude Endpoints

| Endpoint | Legacy | New | Parity | Notes |
|----------|--------|-----|--------|-------|
| `GET /api/lifelog` | 200 | 200 | **OK** | |
| `GET /api/gratitude/bootstrap` | 200 | 200 | **OK** | Full key match |
| `GET /api/gratitude/users` | 200 | 200 | **OK** | |
| `GET /api/gratitude/selections/{cat}` | 400 | 400 | **OK** | Both validate |

### Infrastructure

| Endpoint | Legacy | New | Parity | Notes |
|----------|--------|-----|--------|-------|
| `GET /cron/status` | 200 | 200 | **OK** | Legacy disabled, new has full status |
| `WebSocket /ws` | - | - | **OK** | Owned by new backend already |

---

## Blockers for Frontend Migration

### 1. CRITICAL: `/media/log` Permission Error

**Symptom:** New backend returns `{"error":"Failed to process log"}`

**Root Cause:** Docker permission issue
```
EACCES: permission denied, mkdir '/data/media_memory'
```

**Impact:** All playback progress tracking will fail if frontend migrates to `/api/v1/api/play/log`

**Fix Required:**
- Ensure `/data/media_memory` is writable in Docker container
- Or configure new backend to use correct data path

### 2. `/data/list/{key}` - Missing Local Source

**Symptom:** New backend returns `{"error":"Unknown source: local"}`

**Impact:** Cannot migrate TVApp menu, queue controllers

**Fix Required:** Register `local` content source adapter in ContentSourceRegistry

### 3. `/data/scripture/{id}` - LocalContent Adapter

**Symptom:** New backend returns `{"error":"Scripture not found"}`

**Impact:** ContentScroller scripture mode

**Fix Required:** Configure LocalContent adapter with correct data paths

### 4. `/api/fitness/zone_led` - Config Issue

**Symptom:** New backend returns HA not configured error

**Impact:** Zone LED sync during fitness sessions

**Fix Required:** Home Assistant configuration in new backend

---

## Ready for Migration (No Blockers)

These endpoints have full parity and can be migrated:

| Priority | Endpoint | Frontend Files |
|----------|----------|----------------|
| P1 | `/api/fitness` (GET) | FitnessMenu, FitnessApp |
| P1 | `/api/fitness/sessions/*` | SessionBrowserApp |
| P1 | `/home/entropy` | EntropyPanel |
| P1 | `/home/calendar` | Calendar |
| P1 | `/data/keyboard/*` | OfficeApp |
| P2 | `/data/budget/*` | Finance, FinanceApp |
| P2 | `/api/health/status` | HealthApp |
| P2 | `/api/health/weight` | Health |
| P2 | `/api/lifelog` | LifelogApp |
| P2 | `/api/gratitude/*` | Gratitude, FamilySelector |

---

## Recommended Action Plan

### Phase 0: Fix Blockers (Before Any Migration)

1. **Fix `/data/media_memory` permissions in Docker**
   - Critical for playback tracking
   - Test `POST /api/v1/api/play/log` works after fix

2. **Register local content source adapter**
   - Required for `/data/list/*` endpoints
   - Required for ContentScroller

### Phase 1: Migrate Low-Risk Endpoints

Start with endpoints that have full parity:
- `/api/gratitude/*`
- `/data/budget/*`
- `/api/health/status`

### Phase 2: Migrate Fitness Endpoints

After Phase 0 blockers fixed:
- `/api/fitness/*` (config, sessions)
- `/media/log` (after permission fix)

### Phase 3: Migrate Content/Media Endpoints

After local adapter registered:
- `/data/list/*`
- `/media/plex/*`

---

## Test Commands

```bash
# Test media/log parity (after fix)
curl -X POST localhost:3111/media/log \
  -H "Content-Type: application/json" \
  -d '{"type":"plex","media_key":"12345","percent":50,"seconds":300}'

curl -X POST localhost:3111/api/v1/api/play/log \
  -H "Content-Type: application/json" \
  -d '{"type":"plex","media_key":"12345","percent":50,"seconds":300}'

# Test list parity (after local adapter fix)
diff <(curl -s localhost:3111/data/list/TVApp | jq -S .) \
     <(curl -s localhost:3111/api/v1/api/list/local/TVApp | jq -S .)
```
