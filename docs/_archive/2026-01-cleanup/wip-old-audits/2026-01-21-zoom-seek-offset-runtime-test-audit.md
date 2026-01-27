# Runtime Test Audit: Zoom-Seek Offset Bug
**Date**: 2026-01-21  
**Status**: BLOCKED - Backend Routing Issue  
**Test**: `tests/runtime/fitness-session/zoom-seek-offset.runtime.test.mjs`

## Objective
Run the zoom-seek-offset runtime test to verify the fix for the bug where seeking after zoom operations causes offset issues in the fitness player.

## Progress Summary

### Phase 1: Port Configuration (RESOLVED ✅)
**Problem**: Backend and Vite both trying to use port 3111, causing conflicts.

**Root Cause**:
- Dev environment needs backend on 3112, frontend (Vite) on 3111
- Vite proxies `/api/*` and `/plex_proxy/*` to backend
- Config system wasn't using `BACKEND_PORT` in dev mode

**Solution Implemented**:
1. Updated `/data/system/system-local.kckern-macbook.yml`:
   ```yaml
   PORT: 3111          # Frontend/Vite port
   BACKEND_PORT: 3112  # Backend port
   SECONDARY_PORT: 3119 # Webhook port
   ```

2. Updated `backend/index.js` to check `BACKEND_PORT` first:
   ```javascript
   const port = process.env.BACKEND_PORT || process.env.PORT || 3111;
   ```

3. Updated `package.json` and `nodemon.json` to set `DAYLIGHT_ENV=kckern-macbook` so config loader finds the machine-specific config file.

**Result**: Backend now runs on 3112, Vite on 3111. Port conflict resolved.

---

### Phase 2: Plex Authentication (VERIFIED ✅)
**Investigation**: Checked if plex token is being loaded correctly.

**Findings**:
- Token correctly stored in `/data/households/default/auth/plex.yml`: `token: SZMcgR9vv5ntHSaezzBE`
- ConfigService correctly loads via `getHouseholdAuth('plex')`
- Backend logs confirm: `[INFO] plex-proxy.initialized {"host":"http://10.0.0.10:32400","hasToken":true}`
- Direct Plex API calls with token work: `curl "http://10.0.0.10:32400/library/collections/671468/children?X-Plex-Token=..."` returns valid XML

**Result**: Plex authentication working correctly.

---

### Phase 3: Plex Library Configuration (RESOLVED ✅)
**Problem**: Test looks for "Favorites" collection but API returns 404.

**Root Cause**: 
- Fitness config had wrong library_id: `library_id: 6` (Movies library)
- Fitness content is in library section 14, not 6
- Collection 671468 ("Top", displayed as "Favorites") exists in section 14

**Solution**:
Updated `/data/households/default/apps/fitness/config.yml`:
```yaml
plex:
  library_id: 14  # Changed from 6
```

**Verification**:
- `curl "http://10.0.0.10:32400/library/sections/14/collections?X-Plex-Token=..."` shows collection 671468 exists
- Collection title is "Top" (nav config displays as "Favorites")

---

### Phase 4: Backend Routing Issue (CURRENT BLOCKER ❌)
**Problem**: Backend API endpoint returns HTML instead of JSON.

**Symptom**:
```bash
$ curl "http://localhost:3112/api/v1/content/plex/list/671468"
<!doctype html>
<html lang="en">
  <head>
    <title>Daylight Station</title>
    ...
```

**Analysis**:
1. Request: `GET http://localhost:3112/api/v1/content/plex/list/671468`
2. Expected: JSON response with `{source: "plex", items: [...]}`
3. Actual: Vite frontend HTML

**Route Flow (Expected)**:
```
frontend → http://localhost:3111/api/v1/content/plex/list/671468
        ↓ (Vite proxy)
backend → http://localhost:3112/api/v1/content/plex/list/671468
        ↓ (backend/index.js path routing)
new backend → /api/v1/* routes handled by src/app.mjs
        ↓
apiV1Router → /content/* → contentRouter
        ↓
contentRouter → GET /list/:source/* → adapter.getList(localId)
```

**Route Flow (Actual)**:
```
backend → http://localhost:3112/api/v1/content/plex/list/671468
        ↓ (falling through to legacy backend)
legacy backend → Serves frontend HTML (catch-all)
```

**Root Cause**: Path-based routing in `backend/index.js` not correctly routing `/api/v1/*` to new backend.

---

## Current State

### Working ✅
- Port configuration (3111 frontend, 3112 backend)
- Config loading with `DAYLIGHT_ENV=kckern-macbook`
- Plex authentication token loaded
- Plex server reachable and responding
- Library ID corrected (section 14)

### Broken ❌
- Backend API routing: `/api/v1/*` requests returning HTML instead of JSON
- PlexAdapter cannot be tested because routing doesn't reach it
- Runtime test cannot proceed without working API

---

## Next Steps for Continuation Agent

### Immediate Action Required
1. **Debug backend routing in `backend/index.js`**:
   - Check path-based routing logic for `/api/v1/*` prefix
   - Verify new backend app is being mounted correctly
   - Check for middleware order issues causing fall-through

2. **Test the routing fix**:
   ```bash
   curl -v "http://localhost:3112/api/v1/content/plex/list/671468"
   # Should return JSON: {"source":"plex","path":"671468","items":[...]}
   ```

3. **Verify PlexAdapter collection handling**:
   - Ensure `PlexAdapter.getList()` correctly detects collection type
   - Verify it uses `/library/collections/{id}/items` endpoint
   - Check PlexClient makes correct API call to Plex server

4. **Run the runtime test**:
   ```bash
   npx playwright test tests/runtime/fitness-session/zoom-seek-offset.runtime.test.mjs --headed
   ```

### Investigation Areas
- **backend/index.js**: Path routing logic (lines ~150-200)
- **backend/src/app.mjs**: How new backend app is created and mounted
- **backend/src/4_api/routers/apiV1.mjs**: Route mounting
- **backend/src/4_api/routers/content.mjs**: Content router implementation

### Files Modified This Session
1. `/data/system/system-local.kckern-macbook.yml` - Added BACKEND_PORT: 3112
2. `backend/index.js` - Check BACKEND_PORT before PORT in dev mode
3. `package.json` - Added DAYLIGHT_ENV to frontend:dev script
4. `nodemon.json` - Added DAYLIGHT_ENV to backend exec command
5. `/data/households/default/apps/fitness/config.yml` - Changed library_id from 6 to 14

### Test Status
- **Target**: Verify zoom-seek offset fix works correctly
- **Blocked At**: Backend API routing (cannot reach PlexAdapter)
- **Test File**: `tests/runtime/fitness-session/zoom-seek-offset.runtime.test.mjs:44`
- **Error**: API returns HTML instead of JSON, test cannot load Favorites collection

---

## Technical Notes

### Plex API Endpoints (Verified Working)
- Collections list: `/library/sections/{libraryId}/collections` ✅
- Collection children: `/library/collections/{collectionId}/children` ✅
- **Note**: Do NOT use `/library/sections/{libraryId}/collections/{collectionId}/children` (returns 404)

### PlexAdapter Behavior
- Correctly checks item type via `getMetadata()` first
- Uses `/library/collections/${localId}/items` for collections
- Should work once routing issue is fixed

### Dev Server Architecture
```
User Browser → http://localhost:3111 (Vite)
                      ↓ (for /api/*, /plex_proxy/*)
              http://localhost:3112 (Backend)
                      ↓ (path routing in index.js)
              /api/v1/* → new backend (src/app.mjs)
              /*        → legacy backend (_legacy/app.mjs)
```
**Current Issue**: `/api/v1/*` falling through to legacy backend → returns HTML

---

## Recommendations
1. Add logging to `backend/index.js` path routing to see which backend handles requests
2. Check if new backend app is properly mounted before legacy app
3. Verify `/api/v1` prefix is being stripped/handled correctly
4. Consider adding health check endpoint to test routing: `GET /api/v1/health`
