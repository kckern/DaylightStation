# Legacy Routing & Cutover Audit - 2026-01-21

## Executive Summary

**Critical bug found:** The `/media/log` endpoint was intercepted by broken middleware (`legacyMediaLogMiddleware`) that expected different field names than what the frontend sends. This caused HTTP 500 errors and **complete loss of media_memory data**.

**Impact:** All playback progress tracking has been broken since the middleware was added.

## Architecture Overview

```
backend/index.js (entry point)
├── src/app.mjs (new backend) - receives /api/v1/* requests
└── _legacy/app.mjs (legacy backend) - receives EVERYTHING else
```

Routing logic (backend/index.js:147-168):
- `/api/v1/*` → new backend (src/app.mjs)
- Everything else → legacy backend (_legacy/app.mjs)

**Current Status:** Full cutover has NOT happened. Frontend still calls legacy endpoints.

---

## Bug #1: /media/log Middleware (FIXED)

### Location
`_legacy/app.mjs` lines 338-340 (now removed)

### Problem
```javascript
// Was intercepting before mediaRouter got the request
app.post('/media/log', legacyMediaLogMiddleware(watchStore));
app.use("/media", mediaRouter);  // Real handler never reached
```

The middleware expected `library` field but frontend sends `media_key`:
```javascript
// Middleware expected:
{ type, library, playhead, mediaDuration }

// Frontend actually sends:
{ type, media_key, percent, seconds, title, watched_duration }
```

### Impact
- All playback progress lost (no media_memory files written)
- HTTP 500 errors every 10 seconds during playback
- Plex watch history not tracked

### Fix Applied
Removed the middleware. Legacy `mediaRouter.post('/log')` now handles requests correctly.

---

## Audit: Other Potential Routing Issues

### _legacy/app.mjs Route Intercepts

| Line | Route | Handler | Status |
|------|-------|---------|--------|
| 209 | POST /api/logs | Inline handler | OK - New endpoint for frontend logging |
| 288-307 | GET /data/* | Redirect handlers | OK - Explicit redirects |
| 309-312 | GET /data/budget, /harvest/budget | Redirect to /api/finance | OK |
| 420-428 | /foodlog, /journalist | Webhook passthrough | OK |

### New Backend (src/app.mjs) Conflicting Routes

These routes are defined in new backend but **not reached** unless URL starts with `/api/v1/`:

| Line | Route | Risk |
|------|-------|------|
| 329 | POST /media/log | Dead code - legacy handles this |
| 324-328 | /api/content, /proxy, /api/list, /api/play | Only via /api/v1 prefix |
| 333 | /api/health | Conflict with legacy /api/health |
| 363 | /api/lifelog | Conflict with legacy /api/lifelog |
| 447 | /api/gratitude | Conflict with legacy /api/gratitude |
| 458 | /api/fitness | Conflict with legacy /api/fitness |

**Note:** These conflicts only matter if someone calls `/api/v1/api/health` etc. Normal `/api/health` goes to legacy.

### Frontend Endpoint Calls (Sample)

| Component | Endpoint Called | Expected Handler |
|-----------|-----------------|------------------|
| FitnessPlayer.jsx | `media/log` | _legacy/routers/media.mjs |
| ContentScroller.jsx | `media/log` | _legacy/routers/media.mjs |
| useMediaKeyboardHandler.js | `media/log` | _legacy/routers/media.mjs |
| PersistenceManager.js | `api/fitness/save_session` | _legacy/routers/fitness.mjs |
| Menu.jsx | `data/menu_log` | _legacy/routers/fetch.mjs |

---

## Cutover Checklist

Before enabling new backend for non-/api/v1 routes:

### Pre-Cutover Requirements

- [x] **Field mapping audit:** Verified /media/log middleware was broken, removed
- [x] **Legacy route tracking:** Wired legacyTracker to all legacy routes
- [x] **Parity tests:** Added for /media/log and /api/fitness/save_session
- [x] **Feature flags:** Created cutoverFlags.mjs infrastructure
- [x] **Admin dashboard:** /admin/cutover-status endpoint

### Cutover Process (Per-Endpoint)

1. Run parity tests for the endpoint
2. Edit `cutover-flags.yml` to set route to 'new'
3. Deploy and monitor /admin/cutover-status
4. Check /admin/legacy-hits to confirm traffic moved
5. If issues, set flag back to 'legacy'

### High-Risk Endpoints for Cutover

1. **POST /media/log** - Playback progress (CRITICAL)
2. **POST /api/fitness/save_session** - Workout data
3. **Anything touching YAML files** - media_memory, sessions, lifelog

### Safe to Cutover

- GET endpoints for static data
- Endpoints with no frontend callers
- /api/v1/* (already routed to new)

---

## Recommendations

1. **Remove all premature middleware intercepts** from _legacy/app.mjs
2. **Add logging to legacy endpoints** to track which are still in use
3. **Build cutover dashboard** showing endpoint call counts
4. **Write integration tests** for each endpoint before cutover
5. **Per-endpoint feature flags** for gradual migration

---

## Files Changed

- `_legacy/app.mjs` - Removed broken legacyMediaLogMiddleware
- `frontend/src/hooks/fitness/PersistenceManager.js` - Fixed version: 2 → 3

---

## Related Issues Found

1. **Session persistence bug:** Frontend sent `version: 2` but used v3 format (`session.id`). Backend expected root `sessionId` for v2. Fixed by changing to `version: 3`.

2. **Recursive endSession loop:** Memory leak in FitnessSession.js caused by `endSession()` → `_collectTimelineTick()` → `_checkEmptyRosterTimeout()` → `endSession()` infinite loop. Fixed with `_isEndingSession` guard.
