# Documentation Update Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Comprehensive update to reference docs and runbooks reflecting past 7 days of changes.

**Scope:** TV/Player refactoring, frontend logging infrastructure, Garmin removal, new runbooks.

---

## Task 1: Remove Garmin from Fitness Docs

**Files:**
- Modify: `docs/reference/fitness/2-architecture.md`
- Modify: `docs/reference/fitness/4-codebase.md`
- Check: `docs/reference/fitness/features/*`

**Steps:**
1. Grep for "garmin" (case-insensitive) in fitness docs
2. Remove all Garmin references
3. Update to show Strava as sole activity source
4. Verify no orphaned references remain

---

## Task 2: Create Runtime Testing Runbook

**Files:**
- Create: `docs/runbooks/runtime-testing.md`

**Content Structure:**
```markdown
# Runtime Testing

## Overview
Runtime tests use Playwright to test the frontend in a real browser against a running dev server.

## Running Tests
- All player tests: `npx playwright test tests/runtime/player/`
- Specific test: `npx playwright test tests/runtime/player/<file>.mjs`
- With UI: `npx playwright test --ui`

## Configuration
Key settings in `playwright.config.js`:
- `--autoplay-policy=no-user-gesture-required` - Allows video autoplay without user interaction
- `waitForLoadState('domcontentloaded')` - Use instead of 'networkidle' for streaming pages
- `timeout: 90000` - 90 second test timeout

## Debugging Failures
1. Check screenshot in `test-results/` folder
2. Check `dev.log` for errors: `grep '"level":"error"' dev.log`
3. Common issues:
   - Autoplay blocked: Verify launchOptions has autoplay flag
   - networkidle timeout: Page has active streaming, use domcontentloaded
   - Video not loading: Check Plex server availability

## Writing New Tests
- Use `testInfo.attach()` for artifacts (not console.log)
- Use `test.skip(condition, reason)` for conditional skips
- Prefer `domcontentloaded` over `networkidle` for media pages
```

---

## Task 3: Create Frontend Logging Debugging Runbook

**Files:**
- Create: `docs/runbooks/frontend-logging-debugging.md`

**Content Structure:**
```markdown
# Frontend Logging & Debugging

## Overview
Frontend logs are relayed to the backend via WebSocket and written to different destinations based on environment.

## Log Destinations

| Environment | Destination | Access |
|-------------|-------------|--------|
| Development | `dev.log` file | `tail -f dev.log` or `grep` |
| Production | Docker stdout/stderr | `docker logs <container>` |

## Log Sources
Frontend logging captures three types of events:

1. **Explicit logger calls** - `logger.info('event.name', { data })`
2. **Console interception** - All `console.log/warn/error` calls (rate-limited)
3. **Error handlers** - `window.onerror`, `unhandledrejection`

## Checking Logs

### Development
```bash
# All frontend logs
grep '"source":"frontend"' dev.log

# Errors only
grep '"level":"error"' dev.log | grep '"source":"frontend"'

# Specific event
grep '"event":"blackout.dimensions"' dev.log

# Real-time tail
tail -f dev.log | grep --line-buffered '"source":"frontend"'
```

### Production (Docker)
```bash
# Recent logs
docker logs daylight --tail 100 | grep '"source":"frontend"'

# Follow logs
docker logs daylight -f | grep --line-buffered '"source":"frontend"'
```

## Common Events

| Event | Source | Purpose |
|-------|--------|---------|
| `frontend-start` | Logger | App initialization |
| `blackout.dimensions` | Logger | Shader coverage debugging |
| `console.error` | Interceptor | Captured console.error calls |
| `console.warn` | Interceptor | Captured console.warn calls |
| `window.onerror` | Error handler | Uncaught JavaScript errors |
| `unhandledrejection` | Error handler | Unhandled Promise rejections |

## Troubleshooting

### Logs not appearing
1. Check WebSocket connection in browser devtools (Network → WS)
2. Verify backend is running and WebSocket endpoint is accessible
3. Check for errors in browser console about WebSocketService

### Rate limiting
Console interception has rate limits (50-200/sec per level). If logs seem missing, they may be rate-limited. Check `console-interceptor.initialized` event for configured limits.
```

---

## Task 4: Update Core Logging Architecture

**Files:**
- Modify: `docs/reference/core/2-architecture.md`

**Add Section: Frontend Logging Infrastructure**

Cover:
- Logger framework (`frontend/src/lib/logging/`)
  - `createLogger` factory
  - Transports: console, WebSocket buffered
- WebSocket relay flow
  - Frontend → WebSocketService → Backend → stdout/dev.log
  - Buffering strategy (batch 20, flush every 1s)
- Error handlers (`errorHandlers.js`)
  - `window.onerror`, `unhandledrejection`, error events
- Console interceptor (`consoleInterceptor.js`)
  - Intercepts console.log/warn/error
  - Rate limiting configuration
- Environment-specific destinations
  - Dev: `dev.log` file
  - Prod: Docker stdout/stderr

---

## Task 5: Update TV/Player Architecture

**Files:**
- Modify: `docs/reference/tv/2-architecture.md`

**Add/Update Sections:**

### 5.1 Overlay System
- `PlayerOverlayLoading` - Unified overlay component
- Visibility states: loading, paused, stalled
- CSS-driven visibility (no JS timers)
- Props: `shouldRender`, `isVisible`, `isPaused`, `stalled`, `waitingToPlay`

### 5.2 ResilienceBridge Pattern
- Purpose: Cross-component communication without prop drilling
- Flow: Player → SinglePlayer → AudioPlayer/VideoPlayer
- Key callbacks:
  - `onPlaybackMetrics` - Report seconds, paused state, stall state
  - `onRegisterMediaAccess` - Register getMediaEl, hardReset, fetchVideoInfo
  - `seekToIntentSeconds` / `onSeekRequestConsumed` - Seek coordination
  - `onStartupSignal` - Playback started notification
- Stability requirement: All callbacks must be memoized to prevent re-render loops

### 5.3 Media Element Access
- Problem: Parent needs access to child's media element
- Solution: Accessor registration pattern
- `useCommonMediaController` returns `getMediaEl`, `getContainerEl`
- Child registers via `resilienceBridge.registerAccessors()`
- Parent accesses via `resilienceBridge.getMediaEl()`

### 5.4 Shader Diagnostics
- `useShaderDiagnostics` hook - Logs dimension data for debugging
- `blackout.dimensions` event - Viewport, layers, gaps
- Used for debugging production blackout coverage issues

---

## Task 6: Update TV/Player Codebase Reference

**Files:**
- Modify: `docs/reference/tv/4-codebase.md`

**Document Key Files:**

| File | Purpose |
|------|---------|
| `hooks/useCommonMediaController.js` | Shared media control (play/pause/seek), accessor registration |
| `hooks/useMediaResilience.js` | Simplified stall recovery, overlay state |
| `hooks/useShaderDiagnostics.js` | Dimension logging for shader debugging |
| `hooks/useImageUpscaleBlur.js` | Blur filter for upscaled images |
| `components/PlayerOverlayLoading.jsx` | Unified loading/pause/stall overlay |
| `components/SinglePlayer.jsx` | Media type router, resilienceBridge creation |
| `components/AudioPlayer.jsx` | Audio playback, blackout diagnostics |
| `components/VideoPlayer.jsx` | Video/DASH playback |
| `lib/mediaDiagnostics.js` | Shared diagnostic utilities |

---

## Execution Order

1. Task 1: Fitness cleanup (quick, surgical)
2. Task 2: Runtime testing runbook (standalone)
3. Task 3: Frontend logging runbook (standalone)
4. Task 4: Core logging architecture (foundational)
5. Task 5: TV/Player architecture (largest)
6. Task 6: TV/Player codebase (references Task 5)

---

## Success Criteria

- [ ] No "garmin" references in fitness docs
- [ ] Runtime testing runbook covers running, debugging, writing tests
- [ ] Frontend logging runbook covers dev and prod environments
- [ ] Core architecture explains frontend → backend log flow
- [ ] TV/Player architecture documents overlay, resilienceBridge, accessor pattern
- [ ] TV/Player codebase lists all key files with purposes
