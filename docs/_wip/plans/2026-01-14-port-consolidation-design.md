# Port Consolidation Design

**Date:** 2026-01-14
**Status:** Approved
**Goal:** Consolidate to a single canonical port (3111) for dev and prod

## Problem

Currently using two ports (3111 frontend, 3112 backend) which creates confusion:
- Hard to remember which port does what
- External access issues with `daylightlocal.kckern.net` routing
- Unnecessary complexity in Docker port exposure

## Solution

Single canonical port **3111** for all primary access. Backend uses an internal port (3112) only in dev mode, hidden behind Vite's proxy.

## Port Architecture

| Port | Purpose | Exposed Externally |
|------|---------|-------------------|
| 3111 | Main app (frontend + API) | Yes - primary access |
| 3112 | Backend internal (dev only) | No - Vite proxies to it |
| 3119 | Webhook API | Yes - external integrations |

## Request Flow

**Development:**
```
User → localhost:3111 (Vite) → proxy → localhost:3112 (Backend)
```

**Production:**
```
User → :3111 (Backend serves built frontend + API)
External webhook → :3119 (Secondary API server)
```

## Files to Change

| File | Change |
|------|--------|
| `backend/index.js` | Port logic: `isDocker ? 3111 : 3112` |
| `docker/Dockerfile` | `EXPOSE 3112` → `EXPOSE 3111` |
| `docker/docker-compose.yml` | `3113:3112` → `3111:3111` |
| `docker/docker-compose.remote.yml` | `3112:3112` → `3111:3111` |

## Files Unchanged

| File | Reason |
|------|--------|
| `frontend/package.json` | Already uses `--port 3111` |
| `frontend/src/lib/api.mjs` | Uses `window.location.origin` (port-agnostic) |
| `frontend/vite.config.js` | Proxies to 3112 - correct for dev |

## Implementation

### backend/index.js (line ~374)

```javascript
// Use 3111 in prod (Docker), 3112 in dev (Vite proxies)
const port = process.env.PORT || (isDocker ? 3111 : 3112);
```

### docker/Dockerfile (line ~69)

```dockerfile
EXPOSE 3111
EXPOSE 3119
```

### docker/docker-compose.yml (line ~10)

```yaml
ports:
  - 3111:3111
```

### docker/docker-compose.remote.yml (line ~9)

```yaml
ports:
  - 3111:3111
  - 3119:3119
```

## External Configuration

Update `daylightlocal.kckern.net` reverse proxy to point to port 3111 instead of 3112.

## Verification

After implementation:
- `curl http://localhost:3111/harvest/weather` should work in both dev and prod
- `curl https://daylightlocal.kckern.net/harvest/weather` should work after proxy update
