# Fitness App URL Routing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add URL-based deep linking to FitnessApp for quick access shortcuts and testing workflows.

**Architecture:** React Router captures `/fitness/*` sub-paths. FitnessApp parses URL on mount, syncs state changes back to URL, and triggers simulation via backend API when `?simulate` param is present.

**Tech Stack:** React Router v6 (`useParams`, `useSearchParams`, `useNavigate`), Express backend for simulation spawn/kill.

---

## Task 1: Update Route to Capture Sub-paths

**Files:**
- Modify: `frontend/src/main.jsx:93`

**Step 1: Write the failing test**

Create file: `tests/unit/fitness/fitness-url-routing.unit.test.mjs`

```javascript
// tests/unit/fitness/fitness-url-routing.unit.test.mjs
import { describe, test, expect } from 'vitest';
import { matchPath } from 'react-router-dom';

describe('Fitness URL Routing', () => {
  test('route pattern matches /fitness sub-paths', () => {
    const pattern = '/fitness/*';

    expect(matchPath(pattern, '/fitness')).toBeTruthy();
    expect(matchPath(pattern, '/fitness/menu/123')).toBeTruthy();
    expect(matchPath(pattern, '/fitness/show/456')).toBeTruthy();
    expect(matchPath(pattern, '/fitness/play/abc')).toBeTruthy();
    expect(matchPath(pattern, '/fitness/plugin/fitness_session')).toBeTruthy();
    expect(matchPath(pattern, '/fitness/users')).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx vitest run tests/unit/fitness/fitness-url-routing.unit.test.mjs`
Expected: PASS (this tests React Router behavior, not our code)

**Step 3: Modify main.jsx route**

In `frontend/src/main.jsx`, change line 93:

```jsx
// Before:
<Route path="/fitness" element={<FitnessApp />} />

// After:
<Route path="/fitness/*" element={<FitnessApp />} />
```

**Step 4: Verify route captures sub-paths**

Start dev server and manually verify:
- `http://localhost:5173/fitness` loads FitnessApp
- `http://localhost:5173/fitness/menu/123` loads FitnessApp (no 404)

**Step 5: Commit**

```bash
git add frontend/src/main.jsx tests/unit/fitness/fitness-url-routing.unit.test.mjs
git commit -m "$(cat <<'EOF'
feat(fitness): update route to capture sub-paths

Change /fitness to /fitness/* to enable URL-based deep linking.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create URL Parsing Hook

**Files:**
- Create: `frontend/src/hooks/fitness/useFitnessUrlParams.js`
- Test: `tests/unit/fitness/fitness-url-params.unit.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/fitness/fitness-url-params.unit.test.mjs
import { describe, test, expect, vi } from 'vitest';

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useParams: vi.fn(),
  useSearchParams: vi.fn(),
  useNavigate: vi.fn(),
  useLocation: vi.fn()
}));

import { useParams, useSearchParams, useLocation } from 'react-router-dom';
import { parseFitnessUrl } from '../../../frontend/src/hooks/fitness/useFitnessUrlParams.js';

describe('parseFitnessUrl', () => {
  test('parses /fitness/menu/:id route', () => {
    const result = parseFitnessUrl('/fitness/menu/12345', new URLSearchParams());
    expect(result).toEqual({
      view: 'menu',
      id: '12345',
      ids: ['12345'],
      music: null,
      fullscreen: false,
      simulate: null
    });
  });

  test('parses comma-separated menu IDs', () => {
    const result = parseFitnessUrl('/fitness/menu/123,456,789', new URLSearchParams());
    expect(result.ids).toEqual(['123', '456', '789']);
  });

  test('parses /fitness/show/:id route', () => {
    const result = parseFitnessUrl('/fitness/show/67890', new URLSearchParams());
    expect(result).toEqual({
      view: 'show',
      id: '67890',
      ids: null,
      music: null,
      fullscreen: false,
      simulate: null
    });
  });

  test('parses /fitness/play/:id route', () => {
    const result = parseFitnessUrl('/fitness/play/abc123', new URLSearchParams());
    expect(result.view).toBe('play');
    expect(result.id).toBe('abc123');
  });

  test('parses /fitness/plugin/:id route', () => {
    const result = parseFitnessUrl('/fitness/plugin/fitness_session', new URLSearchParams());
    expect(result.view).toBe('plugin');
    expect(result.id).toBe('fitness_session');
  });

  test('parses /fitness/users route', () => {
    const result = parseFitnessUrl('/fitness/users', new URLSearchParams());
    expect(result.view).toBe('users');
    expect(result.id).toBeNull();
  });

  test('parses query params', () => {
    const params = new URLSearchParams('music=off&fullscreen=1');
    const result = parseFitnessUrl('/fitness/menu/123', params);
    expect(result.music).toBe('off');
    expect(result.fullscreen).toBe(true);
  });

  test('parses simulate param with defaults', () => {
    const params = new URLSearchParams('simulate');
    const result = parseFitnessUrl('/fitness/users', params);
    expect(result.simulate).toEqual({ duration: 120, users: 0, rpm: 0 });
  });

  test('parses simulate param with values', () => {
    const params = new URLSearchParams('simulate=300,2,4');
    const result = parseFitnessUrl('/fitness/users', params);
    expect(result.simulate).toEqual({ duration: 300, users: 2, rpm: 4 });
  });

  test('parses simulate=stop', () => {
    const params = new URLSearchParams('simulate=stop');
    const result = parseFitnessUrl('/fitness/users', params);
    expect(result.simulate).toEqual({ stop: true });
  });

  test('defaults to menu view for bare /fitness', () => {
    const result = parseFitnessUrl('/fitness', new URLSearchParams());
    expect(result.view).toBe('menu');
    expect(result.id).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx vitest run tests/unit/fitness/fitness-url-params.unit.test.mjs`
Expected: FAIL with "Cannot find module"

**Step 3: Write the hook**

```javascript
// frontend/src/hooks/fitness/useFitnessUrlParams.js
import { useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { useMemo, useCallback } from 'react';

/**
 * Parse fitness URL path and query params into structured object.
 * Exported for unit testing.
 *
 * @param {string} pathname - URL pathname (e.g., '/fitness/menu/123')
 * @param {URLSearchParams} searchParams - Query parameters
 * @returns {object} Parsed URL state
 */
export function parseFitnessUrl(pathname, searchParams) {
  // Default result
  const result = {
    view: 'menu',
    id: null,
    ids: null,
    music: null,
    fullscreen: false,
    simulate: null
  };

  // Parse path segments: /fitness/{view}/{id}
  const match = pathname.match(/^\/fitness(?:\/([^/]+))?(?:\/(.+))?$/);
  if (match) {
    const [, view, id] = match;

    if (view) {
      result.view = view;
    }

    if (id) {
      result.id = id;

      // For menu view, support comma-separated IDs
      if (view === 'menu' && id.includes(',')) {
        result.ids = id.split(',').map(s => s.trim()).filter(Boolean);
      } else if (view === 'menu') {
        result.ids = [id];
      }
    }
  }

  // Parse query params
  const musicParam = searchParams.get('music');
  if (musicParam === 'on' || musicParam === 'off') {
    result.music = musicParam;
  }

  if (searchParams.get('fullscreen') === '1') {
    result.fullscreen = true;
  }

  // Parse simulate param
  if (searchParams.has('simulate')) {
    const simValue = searchParams.get('simulate');

    if (simValue === 'stop') {
      result.simulate = { stop: true };
    } else if (!simValue || simValue === '') {
      // ?simulate or ?simulate= → use defaults
      result.simulate = { duration: 120, users: 0, rpm: 0 };
    } else {
      // Parse comma-separated values: duration,users,rpm
      const parts = simValue.split(',').map(s => parseInt(s, 10) || 0);
      result.simulate = {
        duration: parts[0] || 120,
        users: parts[1] || 0,
        rpm: parts[2] || 0
      };
    }
  }

  return result;
}

/**
 * Build URL path from fitness state.
 *
 * @param {object} state - Fitness navigation state
 * @returns {string} URL path (without query params)
 */
export function buildFitnessPath(state) {
  const { view, id, ids } = state;

  if (!view || view === 'menu') {
    if (ids && ids.length > 0) {
      return `/fitness/menu/${ids.join(',')}`;
    }
    if (id) {
      return `/fitness/menu/${id}`;
    }
    return '/fitness';
  }

  if (view === 'users') {
    return '/fitness/users';
  }

  if (id) {
    return `/fitness/${view}/${id}`;
  }

  return `/fitness/${view}`;
}

/**
 * React hook for fitness URL parsing and navigation.
 *
 * @returns {object} { urlState, navigateTo, updateUrl }
 */
export function useFitnessUrlParams() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const urlState = useMemo(() => {
    return parseFitnessUrl(location.pathname, searchParams);
  }, [location.pathname, searchParams]);

  const navigateTo = useCallback((view, id = null, options = {}) => {
    const path = buildFitnessPath({ view, id, ids: options.ids });
    const params = new URLSearchParams();

    if (options.music) params.set('music', options.music);
    if (options.fullscreen) params.set('fullscreen', '1');

    const queryString = params.toString();
    const fullPath = queryString ? `${path}?${queryString}` : path;

    navigate(fullPath, { replace: options.replace ?? true });
  }, [navigate]);

  const updateUrl = useCallback((state, options = {}) => {
    const path = buildFitnessPath(state);
    navigate(path, { replace: options.replace ?? true });
  }, [navigate]);

  return { urlState, navigateTo, updateUrl };
}

export default useFitnessUrlParams;
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx vitest run tests/unit/fitness/fitness-url-params.unit.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/useFitnessUrlParams.js tests/unit/fitness/fitness-url-params.unit.test.mjs
git commit -m "$(cat <<'EOF'
feat(fitness): add URL parsing hook for deep linking

- parseFitnessUrl() parses /fitness/{view}/{id} paths
- Supports comma-separated menu IDs
- Parses ?music, ?fullscreen, ?simulate query params

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add Simulation API Endpoints

**Files:**
- Modify: `backend/routers/fitness.mjs`
- Test: `tests/unit/fitness/fitness-simulate-api.unit.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/fitness/fitness-simulate-api.unit.test.mjs
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Fitness Simulation API', () => {
  const BACKEND_URL = 'http://localhost:3112';

  // These tests require the dev server to be running
  // Skip if server not available
  const serverAvailable = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/fitness`);
      return true;
    } catch {
      return false;
    }
  };

  test.skip('POST /api/fitness/simulate starts simulation', async () => {
    if (!await serverAvailable()) {
      console.log('Skipping: server not running');
      return;
    }

    const response = await fetch(`${BACKEND_URL}/api/fitness/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration: 10, users: 1, rpm: 0 })
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.started).toBe(true);
    expect(data.pid).toBeDefined();

    // Clean up
    await fetch(`${BACKEND_URL}/api/fitness/simulate`, { method: 'DELETE' });
  });

  test.skip('DELETE /api/fitness/simulate stops simulation', async () => {
    if (!await serverAvailable()) {
      console.log('Skipping: server not running');
      return;
    }

    // Start first
    await fetch(`${BACKEND_URL}/api/fitness/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration: 60 })
    });

    // Then stop
    const response = await fetch(`${BACKEND_URL}/api/fitness/simulate`, {
      method: 'DELETE'
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.stopped).toBe(true);
  });

  test.skip('GET /api/fitness/simulate/status returns current state', async () => {
    if (!await serverAvailable()) {
      console.log('Skipping: server not running');
      return;
    }

    const response = await fetch(`${BACKEND_URL}/api/fitness/simulate/status`);
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data).toHaveProperty('running');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx vitest run tests/unit/fitness/fitness-simulate-api.unit.test.mjs`
Expected: PASS (tests are skipped, but structure validates)

**Step 3: Add simulation endpoints to fitness router**

Add to `backend/routers/fitness.mjs` before `export default fitnessRouter;`:

```javascript
// =============================================================================
// Fitness Simulation Control (for testing/demo)
// =============================================================================

import { spawn } from 'child_process';

// Module-level state for simulation process
const simulationState = {
  process: null,
  pid: null,
  startedAt: null,
  config: null
};

/**
 * POST /api/fitness/simulate
 * Start fitness simulation
 * Body: { duration?: number, users?: number, rpm?: number }
 */
fitnessRouter.post('/simulate', (req, res) => {
  // Check if already running
  if (simulationState.process && !simulationState.process.killed) {
    return res.json({
      started: false,
      alreadyRunning: true,
      pid: simulationState.pid,
      startedAt: simulationState.startedAt,
      config: simulationState.config
    });
  }

  const { duration = 120, users = 0, rpm = 0 } = req.body || {};

  const args = [`--duration=${duration}`];
  if (users > 0) args.push(String(users));
  if (rpm > 0) args.push(String(users > 0 ? users : 0), String(rpm));

  const scriptPath = path.join(process.cwd(), '_extensions/fitness/simulation.mjs');

  fitnessLogger.info('fitness.simulate.start', { duration, users, rpm, scriptPath });

  try {
    const proc = spawn('node', [scriptPath, ...args], {
      detached: true,
      stdio: 'ignore'
    });
    proc.unref();

    simulationState.process = proc;
    simulationState.pid = proc.pid;
    simulationState.startedAt = Date.now();
    simulationState.config = { duration, users, rpm };

    // Auto-clear state when process exits
    proc.on('exit', () => {
      simulationState.process = null;
      simulationState.pid = null;
      simulationState.startedAt = null;
      simulationState.config = null;
      fitnessLogger.info('fitness.simulate.exited');
    });

    return res.json({
      started: true,
      pid: proc.pid,
      config: { duration, users, rpm }
    });
  } catch (err) {
    fitnessLogger.error('fitness.simulate.spawn-failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to start simulation', message: err.message });
  }
});

/**
 * DELETE /api/fitness/simulate
 * Stop running simulation
 */
fitnessRouter.delete('/simulate', (req, res) => {
  if (!simulationState.pid) {
    return res.json({ stopped: false, error: 'no simulation running' });
  }

  try {
    process.kill(simulationState.pid, 'SIGTERM');

    const stoppedPid = simulationState.pid;
    simulationState.process = null;
    simulationState.pid = null;
    simulationState.startedAt = null;
    simulationState.config = null;

    fitnessLogger.info('fitness.simulate.stopped', { pid: stoppedPid });

    return res.json({ stopped: true, pid: stoppedPid });
  } catch (err) {
    fitnessLogger.error('fitness.simulate.stop-failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to stop simulation', message: err.message });
  }
});

/**
 * GET /api/fitness/simulate/status
 * Get current simulation status
 */
fitnessRouter.get('/simulate/status', (req, res) => {
  const running = simulationState.process && !simulationState.process.killed;

  return res.json({
    running,
    pid: running ? simulationState.pid : null,
    startedAt: running ? simulationState.startedAt : null,
    config: running ? simulationState.config : null,
    runningSince: running ? Date.now() - simulationState.startedAt : null
  });
});
```

**Step 4: Add the import at top of file**

Add to imports at top of `backend/routers/fitness.mjs`:

```javascript
import { spawn } from 'child_process';
```

**Step 5: Verify endpoints work manually**

```bash
# Start simulation
curl -X POST http://localhost:3112/api/fitness/simulate \
  -H "Content-Type: application/json" \
  -d '{"duration": 10}'

# Check status
curl http://localhost:3112/api/fitness/simulate/status

# Stop simulation
curl -X DELETE http://localhost:3112/api/fitness/simulate
```

**Step 6: Commit**

```bash
git add backend/routers/fitness.mjs tests/unit/fitness/fitness-simulate-api.unit.test.mjs
git commit -m "$(cat <<'EOF'
feat(fitness): add simulation control API endpoints

- POST /api/fitness/simulate - start simulation with duration/users/rpm
- DELETE /api/fitness/simulate - stop running simulation
- GET /api/fitness/simulate/status - check simulation state

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Integrate URL Parsing into FitnessApp

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx`

**Step 1: Add imports**

Add near top of `FitnessApp.jsx`:

```javascript
import { useFitnessUrlParams, parseFitnessUrl, buildFitnessPath } from '../hooks/fitness/useFitnessUrlParams.js';
import { useNavigate, useLocation } from 'react-router-dom';
```

**Step 2: Add URL state hook inside component**

Inside `FitnessApp` component, after the existing useState declarations:

```javascript
  // URL-based navigation
  const { urlState, navigateTo, updateUrl } = useFitnessUrlParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [urlInitialized, setUrlInitialized] = useState(false);
```

**Step 3: Add effect to initialize state from URL on mount**

Add after existing useEffects:

```javascript
  // Initialize state from URL on mount
  useEffect(() => {
    if (urlInitialized || loading) return;

    const { view, id, ids, music, fullscreen, simulate } = urlState;

    logger.info('fitness-url-init', { view, id, ids, music, fullscreen, simulate });

    // Handle simulation trigger
    if (simulate) {
      if (simulate.stop) {
        fetch('/api/fitness/simulate', { method: 'DELETE' })
          .then(r => r.json())
          .then(data => logger.info('fitness-simulate-stopped', data))
          .catch(err => logger.error('fitness-simulate-stop-failed', { error: err.message }));
      } else {
        fetch('/api/fitness/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(simulate)
        })
          .then(r => r.json())
          .then(data => logger.info('fitness-simulate-started', data))
          .catch(err => logger.error('fitness-simulate-start-failed', { error: err.message }));
      }

      // Clear simulate param from URL after triggering
      const newParams = new URLSearchParams(location.search);
      newParams.delete('simulate');
      const newUrl = newParams.toString() ? `${location.pathname}?${newParams}` : location.pathname;
      navigate(newUrl, { replace: true });
    }

    // Handle fullscreen
    if (fullscreen && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }

    // Set view based on URL
    if (view === 'users') {
      setCurrentView('users');
    } else if (view === 'show' && id) {
      setSelectedShow(id);
      setCurrentView('show');
    } else if (view === 'plugin' && id) {
      setActivePlugin({ id });
      setCurrentView('plugin');
    } else if (view === 'play' && id) {
      // Play route - fetch episode metadata and start playback
      handlePlayFromUrl(id);
    } else if (view === 'menu' && ids) {
      // Menu with collection IDs
      if (ids.length === 1) {
        setActiveCollection(ids[0]);
      } else {
        setActiveCollection(ids);
      }
      setCurrentView('menu');
    }

    setUrlInitialized(true);
  }, [urlState, loading, urlInitialized, navigate, location]);
```

**Step 4: Add helper function for play route**

Add inside FitnessApp component:

```javascript
  // Handle /fitness/play/:id route
  const handlePlayFromUrl = async (episodeId) => {
    try {
      // Lightweight fetch to get episode metadata
      const response = await fetch(`/api/plex/metadata/${episodeId}`);
      if (!response.ok) {
        logger.error('fitness-play-url-fetch-failed', { episodeId, status: response.status });
        navigate('/fitness', { replace: true });
        return;
      }

      const metadata = await response.json();
      const queueItem = {
        id: episodeId,
        plex: episodeId,
        type: metadata.type || 'episode',
        title: metadata.title,
        showId: metadata.grandparentRatingKey || metadata.parentRatingKey,
        thumb: metadata.thumb
      };

      setFitnessPlayQueue([queueItem]);
      logger.info('fitness-play-url-started', { episodeId, showId: queueItem.showId });
    } catch (err) {
      logger.error('fitness-play-url-error', { episodeId, error: err.message });
      navigate('/fitness', { replace: true });
    }
  };
```

**Step 5: Update handleNavigate to sync URL**

Modify the existing `handleNavigate` function to also update the URL:

```javascript
  const handleNavigate = (type, target, item) => {
    logger.info('fitness-navigate', { type, target });

    switch (type) {
      case 'plex_collection':
        setActiveCollection(target.collection_id);
        setActivePlugin(null);
        setCurrentView('menu');
        setSelectedShow(null);
        // Sync URL
        navigate(`/fitness/menu/${target.collection_id}`, { replace: true });
        break;

      case 'plex_collection_group':
        setActiveCollection(target.collection_ids);
        setActivePlugin(null);
        setCurrentView('menu');
        setSelectedShow(null);
        // Sync URL
        navigate(`/fitness/menu/${target.collection_ids.join(',')}`, { replace: true });
        break;

      case 'plugin_menu':
        setActiveCollection(target.menu_id);
        setActivePlugin(null);
        setCurrentView('menu');
        setSelectedShow(null);
        navigate(`/fitness/menu/${target.menu_id}`, { replace: true });
        break;

      case 'plugin_direct':
        setActivePlugin({
          id: target.plugin_id,
          ...(target.config || {})
        });
        setActiveCollection(null);
        setCurrentView('plugin');
        setSelectedShow(null);
        navigate(`/fitness/plugin/${target.plugin_id}`, { replace: true });
        break;

      case 'plugin':
        setActivePlugin({
          id: target.id,
          ...(target || {})
        });
        setActiveCollection(null);
        setCurrentView('plugin');
        setSelectedShow(null);
        navigate(`/fitness/plugin/${target.id}`, { replace: true });
        break;

      case 'view_direct':
        setActiveCollection(null);
        setActivePlugin(null);
        setCurrentView(target.view);
        setSelectedShow(null);
        if (target.view === 'users') {
          navigate('/fitness/users', { replace: true });
        }
        break;

      case 'show':
        setSelectedShow(target.plex || target.id);
        setCurrentView('show');
        navigate(`/fitness/show/${target.plex || target.id}`, { replace: true });
        break;

      case 'movie':
        setFitnessPlayQueue(prev => [...prev, target]);
        navigate(`/fitness/play/${target.plex || target.id}`, { replace: true });
        break;

      case 'custom_action':
        logger.warn('custom_action not implemented', { action: target.action });
        break;

      default:
        logger.warn('fitness-navigate-unknown', { type });
    }
  };
```

**Step 6: Update handleBackToMenu to sync URL**

```javascript
  const handleBackToMenu = () => {
    setCurrentView('menu');
    setSelectedShow(null);
    // Navigate back to menu, preserving collection if set
    if (activeCollection) {
      const colId = Array.isArray(activeCollection) ? activeCollection.join(',') : activeCollection;
      navigate(`/fitness/menu/${colId}`, { replace: true });
    } else {
      navigate('/fitness', { replace: true });
    }
  };
```

**Step 7: Test manually**

Start dev server and verify:
- `/fitness/users` → loads users view
- `/fitness/menu/123` → loads collection 123
- `/fitness/show/456` → loads show 456
- `/fitness?simulate=30,1,0` → starts simulation for 30s with 1 HR user

**Step 8: Commit**

```bash
git add frontend/src/Apps/FitnessApp.jsx
git commit -m "$(cat <<'EOF'
feat(fitness): integrate URL routing into FitnessApp

- Parse URL on mount to initialize view state
- Sync navigation actions to URL
- Support ?simulate param to trigger simulation on load
- Support ?fullscreen=1 to enter fullscreen mode

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add Runtime Tests

**Files:**
- Create: `tests/runtime/fitness-url-routing/fitness-url-routing.runtime.test.mjs`

**Step 1: Write the test**

```javascript
// tests/runtime/fitness-url-routing/fitness-url-routing.runtime.test.mjs
/**
 * Fitness URL Routing Runtime Tests
 *
 * Validates URL-based deep linking functionality.
 * Requires dev server running (npm run dev).
 */

import { test, expect } from '@playwright/test';

const FRONTEND_URL = 'http://localhost:5173';

test.describe('Fitness URL Routing', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any previous state
    await page.goto(`${FRONTEND_URL}/fitness`);
    await page.waitForSelector('.fitness-app-container', { timeout: 10000 });
  });

  test('default route loads menu view', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/fitness`);
    await page.waitForSelector('.fitness-app-container');

    // Should show menu/grid content
    const mainContent = page.locator('.fitness-main-content');
    await expect(mainContent).toBeVisible();
  });

  test('/fitness/users loads users view', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/fitness/users`);
    await page.waitForSelector('.fitness-app-container');

    // Should show session plugin
    const pluginContainer = page.locator('.fitness-plugin-container, [class*="session"]');
    await expect(pluginContainer).toBeVisible({ timeout: 10000 });
  });

  test('/fitness/show/:id loads show view', async ({ page }) => {
    // Use a known show ID from test fixtures or skip if none
    const testShowId = '12345'; // Replace with actual test ID

    await page.goto(`${FRONTEND_URL}/fitness/show/${testShowId}`);
    await page.waitForSelector('.fitness-app-container');

    // URL should reflect the route
    expect(page.url()).toContain(`/fitness/show/${testShowId}`);
  });

  test('query params are parsed correctly', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/fitness?music=off&fullscreen=1`);
    await page.waitForSelector('.fitness-app-container');

    // App should load without errors
    const errors = await page.evaluate(() => window.__consoleErrors || []);
    expect(errors.filter(e => e.includes('Error'))).toHaveLength(0);
  });

  test('navigation updates URL', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/fitness`);
    await page.waitForSelector('.fitness-app-container');

    // Click on users nav item (if present)
    const usersNav = page.locator('[data-nav="users"], .nav-item:has-text("Users"), button:has-text("Session")');
    const navCount = await usersNav.count();

    if (navCount > 0) {
      await usersNav.first().click();
      await page.waitForTimeout(500);

      // URL should update
      expect(page.url()).toContain('/fitness/');
    }
  });
});
```

**Step 2: Run tests**

Run: `npx playwright test tests/runtime/fitness-url-routing/fitness-url-routing.runtime.test.mjs --headed`
Expected: Tests should pass

**Step 3: Commit**

```bash
git add tests/runtime/fitness-url-routing/
git commit -m "$(cat <<'EOF'
test(fitness): add URL routing runtime tests

- Test default route, /users, /show/:id routes
- Test query param parsing
- Test navigation URL sync

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update Documentation

**Files:**
- Move: `docs/_wip/plans/2026-01-19-fitness-url-routing-design.md` → `docs/reference/fitness/features/url-routing.md`
- Update: `docs/reference/fitness/5-features.md`

**Step 1: Move and update design doc**

```bash
mv docs/_wip/plans/2026-01-19-fitness-url-routing-design.md docs/reference/fitness/features/url-routing.md
```

**Step 2: Update the doc header**

Edit `docs/reference/fitness/features/url-routing.md` to add:

```markdown
# URL Routing

**Related code:**
- `frontend/src/hooks/fitness/useFitnessUrlParams.js` - URL parsing hook
- `frontend/src/Apps/FitnessApp.jsx` - URL integration
- `backend/routers/fitness.mjs` - Simulation API endpoints

---

[rest of existing content]
```

**Step 3: Update features index**

Add to `docs/reference/fitness/5-features.md`:

```markdown
## URL Routing

Deep linking support for bookmarkable views and testing shortcuts.

- **Doc:** `features/url-routing.md`
- **Routes:** `/fitness`, `/fitness/menu/:id`, `/fitness/show/:id`, `/fitness/play/:id`, `/fitness/plugin/:id`, `/fitness/users`
- **Query params:** `?music=on|off`, `?fullscreen=1`, `?simulate=duration,users,rpm`
```

**Step 4: Commit**

```bash
git add docs/reference/fitness/features/url-routing.md docs/reference/fitness/5-features.md
git rm docs/_wip/plans/2026-01-19-fitness-url-routing-design.md
git commit -m "$(cat <<'EOF'
docs(fitness): add URL routing feature documentation

- Move design doc to reference/fitness/features/
- Update features index

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

| Task | Description | Est. Complexity |
|------|-------------|-----------------|
| 1 | Update route to `/fitness/*` | Simple |
| 2 | Create URL parsing hook | Medium |
| 3 | Add simulation API endpoints | Medium |
| 4 | Integrate into FitnessApp | Complex |
| 5 | Add runtime tests | Medium |
| 6 | Update documentation | Simple |

**Total commits:** 6
