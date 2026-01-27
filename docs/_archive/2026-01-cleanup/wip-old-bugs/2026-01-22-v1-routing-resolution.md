# V1 Routing Issue Resolution

**Date**: 2026-01-22
**Status**: RESOLVED
**Related**: `docs/_wip/audits/2026-01-21-zoom-seek-offset-runtime-test-audit.md`

## Summary

Investigation into why `/api/v1/*` endpoints return HTML instead of JSON revealed two separate issues:

1. **ConfigService initialization error** - Fixed
2. **Route mismatch in Docker** - Stale code, needs rebuild

## Issue 1: ConfigService Initialization (FIXED)

**Problem**: Running `server.mjs` directly crashed with:
```
ConfigService not initialized. Call initConfigService(dataDir) at startup.
```

**Root Cause**: `app.mjs` imported `configService` from the legacy module, but `server.mjs` only initialized the new ConfigService.

**Fix**: Changed `app.mjs` line 17:
```javascript
// Before:
import { ConfigValidationError, configService } from '../_legacy/lib/config/index.mjs';

// After:
import { ConfigValidationError, configService } from './0_infrastructure/config/index.mjs';
```

**Verification**: `server.mjs` now boots successfully without crash.

## Issue 2: Docker Route Mismatch (STALE CODE)

**Problem**: Docker returns HTML for `/api/v1/list/plex/671468` even though `X-Backend: new` header confirms request reaches new backend.

**Root Cause**: Docker was built at commit `f196e2e1` (2026-01-21), which predates the route consolidation refactor (`55ecd802`).

### Route Evolution

| Commit | Routes in app.mjs | index.js strips | Result |
|--------|-------------------|-----------------|--------|
| f196e2e1 (Docker) | `/api/list/*`, `/api/content/*` | `/api/v1` | `/list/*` → No match → HTML |
| 55ecd802+ (Current) | `/list/*`, `/content/*` via apiV1Router | `/api/v1` | `/list/*` → Match → JSON |

### Request Flow (Docker - Broken)

```
1. Request: /api/v1/list/plex/671468
2. index.js strips /api/v1 → /list/plex/671468
3. newApp receives /list/plex/671468
4. Old routes expect /api/list/* → No match
5. Falls through to express.static() → index.html
```

### Request Flow (Current Code - Working)

```
1. Request: /api/v1/list/plex/671468
2. index.js strips /api/v1 → /list/plex/671468
3. newApp receives /list/plex/671468
4. apiV1Router at / has /list router
5. list router matches /:source/* → JSON
```

**Fix**: Rebuild Docker with current code.

## Dev Server Endpoints

When running `server.mjs` directly (dev mode), there's no `/api/v1` prefix stripping. Routes are at root:

| Endpoint | Dev (server.mjs:3112) | Prod (index.js:3111) |
|----------|----------------------|----------------------|
| List | `/list/plex/671468` | `/api/v1/list/plex/671468` |
| Content | `/content/plex/item/123` | `/api/v1/content/plex/item/123` |
| Proxy | `/proxy/plex/...` | `/api/v1/proxy/plex/...` |

## Verification

```bash
# Dev server (server.mjs) - routes at root
curl -s http://localhost:3112/list/plex/671468 | jq '.title'
# Returns: "Top"

# Prod server (index.js) - after Docker rebuild
curl -s http://localhost:3111/api/v1/list/plex/671468 | jq '.title'
# Should return: "Top" (currently returns HTML until rebuild)
```

## Files Modified

- `backend/src/app.mjs` - Changed ConfigService import to new infrastructure module

## Next Steps

1. Rebuild Docker to pick up route changes
2. Run fitness runtime tests against dev server
3. Continue with v1-plex-parity plan tasks
