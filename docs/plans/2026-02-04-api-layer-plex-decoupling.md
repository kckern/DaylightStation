# API Layer Plex Decoupling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove all DDD violations from the API layer by eliminating forbidden imports, hardcoded adapter selection, and protocol knowledge.

**Architecture:** Dependency inversion via factory injection. Bootstrap resolves adapter selection from config and passes resolved adapters/services to routers. The API layer becomes a pure translation layer with zero knowledge of Plex (or any adapter) internals.

**Tech Stack:** Express routers, DDD factory injection pattern, existing ContentRegistry and ProxyService abstractions.

---

## Summary of Violations

| Severity | Count | Description |
|----------|-------|-------------|
| Critical | 2 | Forbidden imports (adapter, domain) |
| High | 6 | Hardcoded `registry.get('plex')` calls |
| High | 3 | Protocol knowledge (token handling, URL construction, metadata parsing) |
| Low | 2 | Config structure knowledge |

---

## Task 1: Inject Plex Shutoff Controls into Test Router

**Files:**
- Modify: `backend/src/4_api/v1/routers/test.mjs:11-15` (remove import)
- Modify: `backend/src/4_api/v1/routers/test.mjs:23-26` (factory params)
- Modify: `backend/src/app.mjs:1104-1106` (bootstrap wiring)
- Test: Manual verification - call `/api/v1/test/plex/shutoff/status`

**Step 1: Update test router factory to receive shutoff controls**

In `backend/src/4_api/v1/routers/test.mjs`, replace lines 1-26:

```javascript
// backend/src/4_api/v1/routers/test.mjs
/**
 * Test Infrastructure API
 *
 * Endpoints for controlling test infrastructure (shutoff valves, simulators, etc.)
 * Only available in development/test environments.
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Create test infrastructure router
 * @param {Object} config
 * @param {Object} [config.plexShutoffControls] - Plex shutoff valve controls (injected)
 * @param {Function} [config.plexShutoffControls.enable] - Enable shutoff
 * @param {Function} [config.plexShutoffControls.disable] - Disable shutoff
 * @param {Function} [config.plexShutoffControls.getStatus] - Get shutoff status
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createTestRouter(config = {}) {
  const router = express.Router();
  const { plexShutoffControls, logger = console } = config;
```

**Step 2: Update route handlers to use injected controls**

Replace the route handlers (lines 42-71) to use `plexShutoffControls`:

```javascript
  // Only enable in dev/test
  const isDev = process.env.NODE_ENV !== 'production';

  if (!isDev) {
    router.all('*', (req, res) => {
      res.status(403).json({ error: 'Test endpoints disabled in production' });
    });
    return router;
  }

  // Guard: If shutoff controls not provided, disable plex shutoff endpoints
  if (!plexShutoffControls) {
    router.all('/plex/shutoff/*', (req, res) => {
      res.status(503).json({ error: 'Plex shutoff controls not configured' });
    });
    return router;
  }

  const { enable, disable, getStatus } = plexShutoffControls;

  /**
   * POST /test/plex/shutoff/enable
   * Enable the Plex proxy shutoff valve (simulates network stall)
   * Body: { mode: 'block' | 'delay', delayMs?: number }
   */
  router.post('/plex/shutoff/enable', asyncHandler(async (req, res) => {
    const { mode = 'block', delayMs = 30000 } = req.body || {};
    enable({ mode, delayMs });
    logger.info?.('[test] Plex shutoff enabled', { mode, delayMs });
    res.json({
      success: true,
      status: getStatus()
    });
  }));

  /**
   * POST /test/plex/shutoff/disable
   * Disable the Plex proxy shutoff valve
   */
  router.post('/plex/shutoff/disable', asyncHandler(async (req, res) => {
    disable();
    logger.info?.('[test] Plex shutoff disabled');
    res.json({
      success: true,
      status: getStatus()
    });
  }));

  /**
   * GET /test/plex/shutoff/status
   * Get current shutoff valve status
   */
  router.get('/plex/shutoff/status', asyncHandler(async (req, res) => {
    res.json(getStatus());
  }));

  return router;
}

export default createTestRouter;
```

**Step 3: Update bootstrap wiring in app.mjs**

In `backend/src/app.mjs`, update lines 1103-1107:

```javascript
  // Test infrastructure router (dev/test only)
  const { createTestRouter } = await import('./4_api/v1/routers/test.mjs');
  const {
    enablePlexShutoff,
    disablePlexShutoff,
    getPlexShutoffStatus
  } = await import('#adapters/proxy/PlexProxyAdapter.mjs');

  v1Routers.test = createTestRouter({
    plexShutoffControls: {
      enable: enablePlexShutoff,
      disable: disablePlexShutoff,
      getStatus: getPlexShutoffStatus
    },
    logger: rootLogger.child({ module: 'test-api' })
  });
```

**Step 4: Verify the fix**

Run: `curl -s http://localhost:3111/api/v1/test/plex/shutoff/status | jq .`
Expected: Returns current shutoff status without errors

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/test.mjs backend/src/app.mjs
git commit -m "$(cat <<'EOF'
fix(api): inject plex shutoff controls instead of importing adapter

Removes forbidden adapter import from test.mjs by injecting shutoff
controls through factory params per DDD guidelines.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Move FitnessProgressClassifier to Injected Service

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs:29` (remove import)
- Modify: `backend/src/4_api/v1/routers/fitness.mjs:54-65` (factory params)
- Modify: `backend/src/4_api/v1/routers/fitness.mjs:217-219` (use injected classifier factory)
- Modify: `backend/src/0_system/bootstrap.mjs:776-785` (wire classifier factory)
- Test: `npm run test:live:flow -- --grep fitness`

**Step 1: Update fitness router to receive classifier factory**

In `backend/src/4_api/v1/routers/fitness.mjs`, remove line 29:
```javascript
// DELETE THIS LINE:
import { FitnessProgressClassifier } from '#domains/fitness/index.mjs';
```

**Step 2: Update factory signature**

Update the JSDoc and destructuring (lines 39-65):

```javascript
/**
 * Create fitness API router
 *
 * @param {Object} config
 * @param {Object} config.sessionService - SessionService instance
 * @param {Object} config.zoneLedController - AmbientLedAdapter instance
 * @param {Object} config.userService - UserService for hydrating config
 * @param {Object} config.userDataService - UserDataService for reading household data
 * @param {Object} config.configService - ConfigService
 * @param {Object} config.contentRegistry - Content source registry (for show endpoint)
 * @param {Object} [config.contentQueryService] - ContentQueryService for watch state enrichment
 * @param {Object} config.transcriptionService - OpenAI transcription service (optional)
 * @param {Function} [config.createProgressClassifier] - Factory function to create progress classifier
 * @param {Object} config.logger - Logger instance
 * @returns {express.Router}
 */
export function createFitnessRouter(config) {
  const {
    sessionService,
    zoneLedController,
    userService,
    userDataService,
    configService,
    contentRegistry,
    contentQueryService,
    transcriptionService,
    createProgressClassifier,
    logger = console
  } = config;
```

**Step 3: Use injected classifier factory**

Replace lines 216-219 where classifier is instantiated:

```javascript
    // Create fitness progress classifier with config thresholds
    // Use injected factory or fallback to default behavior
    const classifierConfig = config?.progressClassification || {};
    const classifier = createProgressClassifier
      ? createProgressClassifier(classifierConfig)
      : { classify: () => 'unknown' }; // Graceful fallback if not injected
```

**Step 4: Update bootstrap wiring**

In `backend/src/0_system/bootstrap.mjs`, update the fitness router creation (around line 776):

First, add import at top of file (near line 58):
```javascript
import { FitnessProgressClassifier } from '#domains/fitness/index.mjs';
```

Then update the router creation:
```javascript
  return createFitnessRouter({
    sessionService: fitnessServices.sessionService,
    zoneLedController: fitnessServices.ambientLedController,
    transcriptionService: fitnessServices.transcriptionService,
    userService,
    userDataService,
    configService,
    contentRegistry,
    contentQueryService,
    createProgressClassifier: (config) => new FitnessProgressClassifier(config),
    logger
  });
```

**Step 5: Run fitness tests**

Run: `npm run test:live:flow -- --grep fitness`
Expected: All fitness tests pass

**Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/fitness.mjs backend/src/0_system/bootstrap.mjs
git commit -m "$(cat <<'EOF'
fix(api): inject progress classifier factory instead of domain import

Moves FitnessProgressClassifier instantiation to bootstrap layer,
passing a factory function to the router per DDD guidelines.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Replace Hardcoded Plex Adapter Selection in Fitness Router

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs:167,206,306` (use injected adapter)
- Modify: `backend/src/4_api/v1/routers/fitness.mjs:54-65` (add fitnessContentAdapter param)
- Modify: `backend/src/0_system/bootstrap.mjs:776-785` (resolve adapter from config)
- Test: `npm run test:live:flow -- --grep fitness`

**Step 1: Update factory to receive resolved fitness content adapter**

Update the JSDoc and destructuring:

```javascript
/**
 * Create fitness API router
 *
 * @param {Object} config
 * @param {Object} config.sessionService - SessionService instance
 * @param {Object} config.zoneLedController - AmbientLedAdapter instance
 * @param {Object} config.userService - UserService for hydrating config
 * @param {Object} config.userDataService - UserDataService for reading household data
 * @param {Object} config.configService - ConfigService
 * @param {Object} config.contentRegistry - Content source registry (for playlist thumbnails)
 * @param {Object} [config.fitnessContentAdapter] - Pre-resolved content adapter for fitness (default: plex)
 * @param {Object} [config.contentQueryService] - ContentQueryService for watch state enrichment
 * @param {Object} config.transcriptionService - OpenAI transcription service (optional)
 * @param {Function} [config.createProgressClassifier] - Factory function to create progress classifier
 * @param {Object} config.logger - Logger instance
 * @returns {express.Router}
 */
export function createFitnessRouter(config) {
  const {
    sessionService,
    zoneLedController,
    userService,
    userDataService,
    configService,
    contentRegistry,
    fitnessContentAdapter,
    contentQueryService,
    transcriptionService,
    createProgressClassifier,
    logger = console
  } = config;
```

**Step 2: Replace hardcoded registry.get('plex') calls**

At line 167 (governed-content endpoint):
```javascript
    // Get content adapter (pre-resolved by bootstrap)
    const adapter = fitnessContentAdapter;
    if (!adapter) {
      return res.status(503).json({ error: 'Fitness content adapter not configured' });
    }
```

At line 206 (show/:id/playable endpoint):
```javascript
    // Fitness content adapter is pre-resolved
    const adapter = fitnessContentAdapter;
    if (!adapter) {
      return res.status(503).json({ error: 'Fitness content adapter not configured' });
    }
```

At line 306 (show/:id endpoint):
```javascript
    const adapter = fitnessContentAdapter;
    if (!adapter) {
      return res.status(503).json({ error: 'Fitness content adapter not configured' });
    }
```

**Step 3: Update bootstrap to resolve adapter from config**

```javascript
  // Resolve fitness content adapter from config (defaults to plex)
  const fitnessContentSource = fitnessConfig?.content_source || 'plex';
  const fitnessContentAdapter = contentRegistry.get(fitnessContentSource);

  return createFitnessRouter({
    sessionService: fitnessServices.sessionService,
    zoneLedController: fitnessServices.ambientLedController,
    transcriptionService: fitnessServices.transcriptionService,
    userService,
    userDataService,
    configService,
    contentRegistry,  // Still needed for playlist thumbnail enrichment
    fitnessContentAdapter,
    contentQueryService,
    createProgressClassifier: (config) => new FitnessProgressClassifier(config),
    logger
  });
```

**Step 4: Run fitness tests**

Run: `npm run test:live:flow -- --grep fitness`
Expected: All fitness tests pass

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/fitness.mjs backend/src/0_system/bootstrap.mjs
git commit -m "$(cat <<'EOF'
fix(api): inject pre-resolved fitness content adapter

Replaces hardcoded registry.get('plex') with injected adapter that
bootstrap resolves from config. Enables config-driven content source.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Move Plex Proxy Protocol Logic to ProxyService

**Files:**
- Modify: `backend/src/4_api/v1/routers/proxy.mjs:188-260` (delegate to proxyService)
- Modify: `backend/src/0_system/proxy/ProxyService.mjs` (ensure plex support)
- Test: Manual - load a Plex thumbnail through `/api/v1/proxy/plex/...`

**Step 1: Verify ProxyService already handles Plex**

The existing code at line 191-193 already uses ProxyService when available:
```javascript
if (proxyService?.isConfigured?.('plex')) {
  await proxyService.proxy('plex', req, res);
  return;
}
```

**Step 2: Ensure ProxyService is always configured for Plex in bootstrap**

Check that ProxyService is wired with Plex config. If not, this is where the fix goes - in bootstrap, not in the router.

**Step 3: Remove fallback direct proxy code**

The fallback code (lines 196-259) contains protocol knowledge. Once ProxyService is always available for Plex, this fallback can be simplified to an error:

```javascript
router.use('/plex', async (req, res) => {
  try {
    // Use ProxyService - required for Plex proxying
    if (proxyService?.isConfigured?.('plex')) {
      await proxyService.proxy('plex', req, res);
      return;
    }

    // No fallback - ProxyService is required
    return res.status(503).json({ error: 'Plex proxy not configured (ProxyService required)' });
  } catch (err) {
    console.error('[proxy] plex error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});
```

**Step 4: Commit**

```bash
git add backend/src/4_api/v1/routers/proxy.mjs
git commit -m "$(cat <<'EOF'
fix(api): remove Plex protocol knowledge from proxy router

Delegates all Plex proxying to ProxyService, removing direct protocol
handling (token injection, URL construction) from API layer.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Replace Hardcoded Plex Adapter Selection in Play Router

**Files:**
- Modify: `backend/src/4_api/v1/routers/play.mjs:143-162` (use adapter.getStoragePath)
- Modify: `backend/src/4_api/v1/routers/play.mjs:230-263` (standardize interface)
- Test: `npm run test:live:api -- --grep play`

**Step 1: Move storage path logic to adapter**

The code at lines 144-161 knows Plex metadata structure. Replace with:

```javascript
      // For plex items, get storage path from adapter
      if (type === 'plex') {
        const plexAdapter = registry.get('plex');
        if (plexAdapter && typeof plexAdapter.getStoragePath === 'function') {
          try {
            storagePath = await plexAdapter.getStoragePath(`plex:${assetId}`);
          } catch (e) {
            logger.warn?.('play.log.storage_path_failed', { assetId, error: e.message });
          }
        }
      }
```

This requires adding `getStoragePath(compoundId)` method to PlexAdapter if it doesn't exist.

**Step 2: Standardize media URL interface**

At lines 244-250, the code checks for multiple method names:

```javascript
if (typeof plexAdapter.getMediaUrl === 'function') {
  mediaUrl = await plexAdapter.getMediaUrl(id, 0, opts);
} else if (typeof plexAdapter.loadMediaUrl === 'function') {
  mediaUrl = await plexAdapter.loadMediaUrl(id, 0, opts);
}
```

Standardize to use only `getMediaUrl`:

```javascript
if (typeof plexAdapter.getMediaUrl !== 'function') {
  return res.status(501).json({ error: 'Plex adapter does not support media URL retrieval' });
}
mediaUrl = await plexAdapter.getMediaUrl(id, 0, opts);
```

**Step 3: Move URL transformation to adapter**

At line 257, the API layer transforms URLs:
```javascript
const proxyUrl = mediaUrl.replace(/https?:\/\/[^\/]+/, '/api/v1/proxy/plex');
```

Add `getProxiedMediaUrl` to PlexAdapter and use it:

```javascript
// In PlexAdapter:
getProxiedMediaUrl(id, opts) {
  const mediaUrl = await this.getMediaUrl(id, 0, opts);
  return mediaUrl.replace(/https?:\/\/[^\/]+/, '/api/v1/proxy/plex');
}

// In router:
const proxyUrl = await plexAdapter.getProxiedMediaUrl(id, opts);
res.redirect(proxyUrl);
```

**Step 4: Commit**

```bash
git add backend/src/4_api/v1/routers/play.mjs backend/src/2_adapters/content/plex/PlexAdapter.mjs
git commit -m "$(cat <<'EOF'
fix(api): move Plex-specific logic to adapter

Adds getStoragePath and getProxiedMediaUrl to PlexAdapter,
removing protocol knowledge from play router.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Normalize Config Structure Access in Fitness Router

**Files:**
- Create: `backend/src/3_applications/fitness/FitnessConfigService.mjs`
- Modify: `backend/src/4_api/v1/routers/fitness.mjs:103-156` (use normalized config)
- Modify: `backend/src/0_system/bootstrap.mjs` (wire FitnessConfigService)
- Test: `npm run test:live:flow -- --grep fitness`

**Step 1: Create FitnessConfigService**

```javascript
// backend/src/3_applications/fitness/FitnessConfigService.mjs
/**
 * FitnessConfigService - Normalizes fitness configuration access
 *
 * Encapsulates Plex-specific config structure knowledge, providing
 * a clean interface for API layer consumption.
 */
export class FitnessConfigService {
  constructor({ userDataService, configService }) {
    this.userDataService = userDataService;
    this.configService = configService;
  }

  /**
   * Load and normalize fitness config for a household
   * @param {string} [householdId] - Household ID (uses default if not provided)
   * @returns {Object|null} Normalized config or null if not found
   */
  getNormalizedConfig(householdId) {
    const hid = householdId || this.configService.getDefaultHouseholdId();
    const raw = this.userDataService.readHouseholdAppData(hid, 'fitness', 'config');

    if (!raw) return null;

    // Normalize: extract values from both governance and plex sections
    const governance = raw.governance || {};
    const plex = raw.plex || {};

    return {
      raw,
      householdId: hid,
      contentSource: raw.content_source || 'plex',
      musicPlaylists: plex.music_playlists || [],
      governedLabels: governance.governed_labels?.length
        ? governance.governed_labels
        : plex.governed_labels || [],
      governedTypes: governance.governed_types?.length
        ? governance.governed_types
        : plex.governed_types || ['show', 'movie'],
      progressClassification: raw.progressClassification || {},
      users: raw.users || {}
    };
  }
}
```

**Step 2: Wire in bootstrap**

```javascript
import { FitnessConfigService } from '#applications/fitness/FitnessConfigService.mjs';

// In the fitness router creation section:
const fitnessConfigService = new FitnessConfigService({
  userDataService,
  configService
});

return createFitnessRouter({
  // ... other params
  fitnessConfigService,
  // ...
});
```

**Step 3: Update router to use normalized config**

Replace direct config access with service calls. For example, at line 103:

```javascript
// Before:
const playlists = hydratedData?.plex?.music_playlists;
const contentSource = hydratedData?.content_source || 'plex';

// After:
const normalizedConfig = fitnessConfigService.getNormalizedConfig(householdId);
const { musicPlaylists, contentSource } = normalizedConfig;
```

**Step 4: Commit**

```bash
git add backend/src/3_applications/fitness/FitnessConfigService.mjs \
        backend/src/4_api/v1/routers/fitness.mjs \
        backend/src/0_system/bootstrap.mjs
git commit -m "$(cat <<'EOF'
feat(fitness): add FitnessConfigService to normalize config access

Encapsulates Plex-specific config structure knowledge in application
layer, providing clean normalized interface for API consumption.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Verification Checklist

After all tasks complete, verify:

1. **No forbidden imports in API layer:**
   ```bash
   grep -r "#adapters/" backend/src/4_api/
   grep -r "#domains/" backend/src/4_api/
   ```
   Expected: No matches

2. **No hardcoded 'plex' strings in routers:**
   ```bash
   grep -r "registry.get('plex')" backend/src/4_api/
   grep -r "contentRegistry.get('plex')" backend/src/4_api/
   ```
   Expected: No matches

3. **All tests pass:**
   ```bash
   npm run test:live
   ```

4. **Fitness flow works end-to-end:**
   - Load fitness app
   - View governed content
   - Play a video
   - Verify progress saves

---

## Rollback Plan

If issues arise:

1. Each task has independent commits - revert specific commits if needed
2. The changes are additive to bootstrap, not destructive to adapters
3. Fallback guards ensure graceful degradation if injection fails
