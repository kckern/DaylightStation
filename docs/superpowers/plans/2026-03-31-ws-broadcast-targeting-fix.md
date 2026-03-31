# WS Broadcast Targeting Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent barcode scans targeted at one screen from playing content on all screens.

**Architecture:** BarcodeScanService includes `targetScreen` in its broadcast payload. `useScreenCommands` rejects messages where `targetScreen` doesn't match the screen's own `screenId`. Defense-in-depth: two independent guards (existing `targetDevice` check + new `targetScreen` check).

**Tech Stack:** Node.js backend, React frontend

**Root Cause:** See `docs/_wip/audits/2026-03-31-ws-broadcast-targeting-audit.md`

---

### Task 1: Add `targetScreen` to barcode broadcasts

**Files:**
- Modify: `backend/src/3_applications/barcode/BarcodeScanService.mjs`

Both broadcast paths (`#handleCommand` and `#handleContent`) send to the correct WS topic but don't include targeting info in the payload. Wildcard subscribers receive the message and have no way to reject it.

- [ ] **Step 1: Add `targetScreen` to content broadcast**

In `backend/src/3_applications/barcode/BarcodeScanService.mjs`, find `#handleContent` (line 122):

```javascript
    this.#broadcastEvent(targetScreen, {
      action,
      contentId: payload.contentId,
      ...(payload.options || {}),
      source: 'barcode',
      device: payload.device,
    });
```

Replace with:

```javascript
    this.#broadcastEvent(targetScreen, {
      action,
      contentId: payload.contentId,
      ...(payload.options || {}),
      source: 'barcode',
      device: payload.device,
      targetScreen,
    });
```

- [ ] **Step 2: Add `targetScreen` to command broadcast**

In the same file, find `#handleCommand` (line 78):

```javascript
    this.#broadcastEvent(targetScreen, {
      ...wsPayload,
      source: 'barcode',
      device: payload.device,
    });
```

Replace with:

```javascript
    this.#broadcastEvent(targetScreen, {
      ...wsPayload,
      source: 'barcode',
      device: payload.device,
      targetScreen,
    });
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/3_applications/barcode/BarcodeScanService.mjs
git commit -m "fix(barcode): include targetScreen in broadcast payload for screen filtering"
```

---

### Task 2: Add `targetScreen` guard in `useScreenCommands`

**Files:**
- Modify: `frontend/src/screen-framework/commands/useScreenCommands.js`

The hook already has `screenIdRef.current` (added in the WS-first content delivery work). Add a guard that rejects messages where `targetScreen` doesn't match.

- [ ] **Step 1: Add the guard**

In `frontend/src/screen-framework/commands/useScreenCommands.js`, find the `targetDevice` guard (line 42):

```javascript
    // Device targeting — ignore commands meant for a different device
    if (data.targetDevice && g.device && data.targetDevice !== g.device) {
      logger().debug('commands.ignored-target', { targetDevice: data.targetDevice, myDevice: g.device });
      return;
    }
```

Add immediately after it:

```javascript
    // Screen targeting — ignore commands meant for a different screen
    if (data.targetScreen && screenIdRef.current && data.targetScreen !== screenIdRef.current) {
      logger().debug('commands.ignored-screen', { targetScreen: data.targetScreen, myScreen: screenIdRef.current });
      return;
    }
```

- [ ] **Step 2: Verify frontend builds**

```bash
cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -3
```

Expected: `✓ built in ...`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/screen-framework/commands/useScreenCommands.js
git commit -m "fix(screen-commands): reject barcode messages targeted at a different screen"
```

---

### Task 3: Build, deploy, verify

**Files:** None

- [ ] **Step 1: Push, build, deploy**

```bash
git push
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

- [ ] **Step 2: Clear FKB cache and reload**

```bash
sudo docker exec daylight-station node -e "
const yaml = require('js-yaml');
const auth = yaml.load(require('fs').readFileSync('data/household/auth/fullykiosk.yml','utf8'));
const qs = new URLSearchParams({cmd:'clearCache',password:auth.password,type:'json'}).toString();
fetch('http://10.0.0.11:2323/?' + qs).then(r=>r.text()).then(console.log);
"
# Wait for cache clear
sleep 2
sudo docker exec daylight-station node -e "
const yaml = require('js-yaml');
const auth = yaml.load(require('fs').readFileSync('data/household/auth/fullykiosk.yml','utf8'));
const qs = new URLSearchParams({cmd:'loadStartURL',password:auth.password,type:'json'}).toString();
fetch('http://10.0.0.11:2323/?' + qs).then(r=>r.text()).then(console.log);
"
```

- [ ] **Step 3: Verify with barcode scan**

Scan a barcode targeted at office. Check logs:

```bash
sudo docker logs daylight-station --since 1m 2>&1 | grep -E "commands\.(barcode|ignored-screen|content)"
```

Expected:
- Office screen: `commands.barcode` log (processes the content) ✓
- Living room screen: `commands.ignored-screen` log (rejects the content) ✓
- Living room should NOT show `commands.barcode` or `commands.content` for this scan
