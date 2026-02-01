# Webhook Port Teardown Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the separate webhook server (port 3119) and unify all webhooks on the main API port.

**Architecture:** Webhooks will be served on the main Express server. DevProxy will only intercept webhook routes, not all traffic.

**Tech Stack:** Express.js, existing devProxy middleware

---

## Task 1: Delete dead webhook-server.mjs

**Files:**
- Delete: `backend/src/4_api/webhook-server.mjs`

**Step 1: Delete the file**

```bash
rm backend/src/4_api/webhook-server.mjs
```

**Step 2: Verify no imports reference it**

```bash
grep -r "webhook-server" backend/src/ --include="*.mjs"
```
Expected: No output

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete unused webhook-server.mjs"
```

---

## Task 2: Remove webhook server from index.js

**Files:**
- Modify: `backend/index.js`

**Step 1: Read current index.js to find exact lines**

The webhook server section is approximately lines 211-277, starting with:
```javascript
// Secondary Webhook Server (port 3119)
```

**Step 2: Remove the entire section**

Delete from the comment `// Secondary Webhook Server` through the `secondaryServer.listen()` call and its callback.

This removes:
- `secondaryPort` variable
- `createDevProxy` import and `devProxy` creation
- `webhookApp` Express app
- Health check routes on webhook app
- DevProxy router mount
- DevProxy middleware application
- Request routing logic
- `secondaryServer` creation and listen

**Step 3: Verify index.js still works**

```bash
node --check backend/index.js
```

**Step 4: Commit**

```bash
git add backend/index.js
git commit -m "refactor: remove separate webhook server (port 3119)"
```

---

## Task 3: Add devProxy to main server for webhook routes

**Files:**
- Modify: `backend/src/app.mjs`

**Step 1: Import createDevProxy**

Near the top of app.mjs, add:
```javascript
import { createDevProxy } from './0_system/http/middleware/devProxy.mjs';
```

**Step 2: Create devProxy instance**

After configService is available:
```javascript
const devHost = configService.get('LOCAL_DEV_HOST') || configService.getSecret('LOCAL_DEV_HOST');
const devProxy = createDevProxy({ logger: rootLogger, devHost });
```

**Step 3: Mount devProxy control routes**

```javascript
// DevProxy control routes (toggle proxy on/off)
newApp.use('/dev', devProxy.router);
```

**Step 4: Apply devProxy middleware to webhook routes only**

Before mounting the bot routers, add middleware for webhook paths:
```javascript
// DevProxy middleware - only for webhook routes
newApp.use('/nutribot/webhook', devProxy.middleware);
newApp.use('/journalist/webhook', devProxy.middleware);
newApp.use('/homebot/webhook', devProxy.middleware);
```

**Step 5: Verify syntax**

```bash
cd backend && node --check src/app.mjs
```

**Step 6: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat: add devProxy to main server for webhook routes only"
```

---

## Task 4: Remove getWebhookPort from ConfigService

**Files:**
- Modify: `backend/src/0_system/config/ConfigService.mjs`

**Step 1: Find and remove getWebhookPort method**

Remove:
```javascript
getWebhookPort() {
  return this.#config.system?.webhook?.port ?? 3119;
}
```

**Step 2: Verify no callers remain**

```bash
grep -r "getWebhookPort" backend/src/ --include="*.mjs"
```
Expected: No output

**Step 3: Commit**

```bash
git add backend/src/0_system/config/ConfigService.mjs
git commit -m "chore: remove unused getWebhookPort method"
```

---

## Task 5: Verify and test

**Step 1: Check no references to port 3119 or webhook port remain**

```bash
grep -r "3119\|webhookPort\|webhook.*port" backend/ --include="*.js" --include="*.mjs" | grep -v node_modules | grep -v "_legacy"
```
Expected: No output (or only comments/docs)

**Step 2: Run tests**

```bash
cd backend && npm test
```
Expected: All tests pass

**Step 3: Verify main server starts**

```bash
cd backend && timeout 5 node index.js 2>&1 || true
```
Expected: Server starts on main port only, no secondary webhook server message

---

## Summary

| Before | After |
|--------|-------|
| Main API on port 3111/3112 | Main API on port 3111/3112 |
| Webhook server on port 3119 | **Removed** |
| DevProxy on all webhook traffic | DevProxy on `/*/webhook` routes only |
| `webhook-server.mjs` (unused) | **Deleted** |
| `getWebhookPort()` method | **Deleted** |

Total: 5 tasks
