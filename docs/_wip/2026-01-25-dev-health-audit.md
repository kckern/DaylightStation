# Dev Server Health Audit
**Date:** 2026-01-25

## Summary

| Port | Server | Endpoint | Status | Response |
|------|--------|----------|--------|----------|
| 3111 | Vite Frontend | `/` | ✅ 200 | HTML (Vite dev) |
| 3111 | Vite Frontend | `/api/v1/health` | ❌ TIMEOUT | No response (3s) |
| 3112 | Backend Main | `/` | ✅ 200 | HTML (redirected to Vite?) |
| 3112 | Backend Main | `/api/v1/health` | ❌ TIMEOUT | No response (3s) |
| 3112 | Backend Main | `/api/v1/dev/proxy_status` | ❌ TIMEOUT | No response (3s) |
| 3119 | Webhook Server | `/` | ✅ 200 | JSON error (expected in dev) |
| 3119 | Webhook Server | `/api/v1/health` | ❌ 404 | "Cannot GET /api/v1/health" |
| 3119 | Webhook Server | `/api/v1/dev/proxy_status` | ✅ 200 | `{"proxyEnabled":false,...}` |
| 3119 | Webhook Server | `/api/v1/nutribot/webhook` | ❌ 404 | "Cannot GET" |

## Critical Issues

### 1. Main Server (3112) - ALL `/api/v1/*` routes TIMEOUT
- `/api/v1/health` times out after 3 seconds
- `/api/v1/dev/proxy_status` times out after 3 seconds
- This is the **primary backend server** - this is catastrophic

### 2. Webhook Server (3119) - Missing API routes
- `/api/v1/health` returns 404
- Bot webhook endpoints return 404
- Only `/api/v1/dev/proxy_status` works (devProxy router is mounted)
- **Webhook server has NO actual API routes mounted, only devProxy**

### 3. Vite Proxy (3111) - Inherits backend issues
- Proxies to 3112, which times out
- Same timeout behavior as direct backend access

## Root Cause Analysis

### Main Server (3112) Timeout
The `/api/v1/*` routes exist (logs show `apiV1.mounted` with 18 routes) but requests hang infinitely. Possible causes:
1. Route handler has blocking/infinite loop
2. Middleware before routes never calls `next()`
3. Route mounted incorrectly

### Webhook Server (3119) Missing Routes
Looking at `backend/index.js`, the webhook server only mounts:
- `devProxy.router` at `/api/v1/dev`
- `devProxy.middleware`
- A routing handler for `/api/v1` that delegates to `newApp` or `legacyApp`

**Problem:** The routing handler strips `/api/v1` and delegates to `newApp`, but `newApp` is the Express app instance, not a router. The API routes are mounted on `newApp` at `/`, but the delegation may not be working correctly.

## Recommendations

1. **Investigate main server timeout** - Check if middleware or route handler is blocking
2. **Fix webhook server routing** - Ensure `newApp` and `legacyApp` are properly handling delegated requests
3. **Add health check to webhook server** - Mount a simple health endpoint directly on webhookApp
4. **Test in isolation** - Verify each backend component works before combining

## Test Commands Used

```bash
# Port 3111 (Vite)
curl --max-time 3 -s http://127.0.0.1:3111/
curl --max-time 3 -s http://127.0.0.1:3111/api/v1/health

# Port 3112 (Main Backend)
curl --max-time 3 -s http://127.0.0.1:3112/
curl --max-time 3 -s http://127.0.0.1:3112/api/v1/health
curl --max-time 3 -s http://127.0.0.1:3112/api/v1/dev/proxy_status

# Port 3119 (Webhook Server)
curl --max-time 3 -s http://127.0.0.1:3119/
curl --max-time 3 -s http://127.0.0.1:3119/api/v1/health
curl --max-time 3 -s http://127.0.0.1:3119/api/v1/dev/proxy_status
curl --max-time 3 -s http://127.0.0.1:3119/api/v1/nutribot/webhook
```
