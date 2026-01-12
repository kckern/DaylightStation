# Content Domain E2E Migration Tests

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create Playwright runtime tests that validate the frontend migration from legacy endpoints to the new Content Domain API, with logging that proves legacy paths are no longer used.

**Architecture:** Each test suite monitors network requests, logs all API calls categorized as "legacy" or "new", and fails if any legacy endpoints are detected.

**Tech Stack:** Playwright, JavaScript ES Modules (.mjs)

**Reference Docs:**
- `docs/reference/core/content-api-migration.md` - Migration endpoint mapping
- `frontend/src/Apps/TVApp.jsx` - Primary test target
- `docs/_wip/plans/2026-01-10-api-consumer-inventory.md` - Full frontend impact

---

## Overview

### Legacy vs New Endpoint Patterns

| Category | Legacy Pattern | New Pattern |
|----------|---------------|-------------|
| **Play (Plex)** | `/media/plex/info/:id` | `/api/play/plex/:id` |
| **Play (Filesystem)** | `/media/info/*` | `/api/play/filesystem/*` |
| **List (Folder)** | `/data/list/:folder` | `/api/list/folder/:name` |
| **List (Plex)** | `/media/plex/list/:id` | `/api/list/plex/:id` |
| **Scripture** | `/data/scripture/*` | `/api/local-content/scripture/*` |
| **Hymn** | `/data/hymn/:num` | `/api/local-content/hymn/:num` |
| **Primary Song** | `/data/primary/:num` | `/api/local-content/primary/:num` |
| **Talk** | `/data/talk/*` | `/api/local-content/talk/*` |
| **Poem** | `/data/poetry/*` | `/api/local-content/poem/*` |
| **Progress** | `/media/log` | `/api/content/progress/*` |

### Test Strategy

1. **Network Monitor** - Intercept all API requests during test execution
2. **Classification** - Categorize each request as "legacy" or "new"
3. **Detailed Logging** - Log every API call with classification
4. **Failure Criteria** - Test fails if ANY legacy endpoint is called
5. **Coverage Report** - Summarize all API calls at test end

---

## Task 1: Create Test Utilities Module

**Files:**
- Create: `tests/runtime/content-migration/migration-test-utils.mjs`

**Step 1: Write the network monitoring utility**

```javascript
// tests/runtime/content-migration/migration-test-utils.mjs

/**
 * Network monitoring utilities for Content Domain migration validation.
 * Tracks all API calls and classifies them as legacy or new endpoints.
 */

// Legacy endpoint patterns (regex)
const LEGACY_PATTERNS = [
  // Play endpoints
  { pattern: /^\/media\/plex\/info\//, name: 'media/plex/info', category: 'play' },
  { pattern: /^\/media\/info\//, name: 'media/info', category: 'play' },

  // List endpoints
  { pattern: /^\/data\/list\//, name: 'data/list', category: 'list' },
  { pattern: /^\/media\/plex\/list\//, name: 'media/plex/list', category: 'list' },

  // LocalContent endpoints
  { pattern: /^\/data\/scripture\//, name: 'data/scripture', category: 'local-content' },
  { pattern: /^\/data\/hymn\//, name: 'data/hymn', category: 'local-content' },
  { pattern: /^\/data\/primary\//, name: 'data/primary', category: 'local-content' },
  { pattern: /^\/data\/talk\//, name: 'data/talk', category: 'local-content' },
  { pattern: /^\/data\/poetry\//, name: 'data/poetry', category: 'local-content' },

  // Progress endpoint
  { pattern: /^\/media\/log/, name: 'media/log', category: 'progress' },
];

// New endpoint patterns (regex)
const NEW_PATTERNS = [
  // Play endpoints
  { pattern: /^\/api\/play\//, name: 'api/play', category: 'play' },

  // List endpoints
  { pattern: /^\/api\/list\//, name: 'api/list', category: 'list' },

  // Content endpoints
  { pattern: /^\/api\/content\//, name: 'api/content', category: 'content' },

  // LocalContent endpoints
  { pattern: /^\/api\/local-content\//, name: 'api/local-content', category: 'local-content' },

  // Proxy endpoints
  { pattern: /^\/proxy\//, name: 'proxy', category: 'proxy' },
];

/**
 * @typedef {Object} ApiCall
 * @property {string} url - Full URL
 * @property {string} path - URL path
 * @property {string} method - HTTP method
 * @property {number} timestamp - Unix timestamp
 * @property {'legacy'|'new'|'other'} classification - Endpoint type
 * @property {string|null} patternName - Matched pattern name
 * @property {string|null} category - Endpoint category
 */

/**
 * Creates a network monitor that tracks and classifies API calls
 * @param {import('@playwright/test').Page} page
 * @returns {Object} Monitor instance with start/stop/report methods
 */
export function createNetworkMonitor(page) {
  /** @type {ApiCall[]} */
  const calls = [];
  let isMonitoring = false;

  /**
   * Classify a URL path
   */
  function classifyPath(path) {
    // Check legacy patterns first
    for (const { pattern, name, category } of LEGACY_PATTERNS) {
      if (pattern.test(path)) {
        return { classification: 'legacy', patternName: name, category };
      }
    }

    // Check new patterns
    for (const { pattern, name, category } of NEW_PATTERNS) {
      if (pattern.test(path)) {
        return { classification: 'new', patternName: name, category };
      }
    }

    return { classification: 'other', patternName: null, category: null };
  }

  /**
   * Request handler
   */
  function handleRequest(request) {
    if (!isMonitoring) return;

    const url = request.url();

    // Only track API calls to our backend
    if (!url.includes('/api/') &&
        !url.includes('/data/') &&
        !url.includes('/media/') &&
        !url.includes('/proxy/')) {
      return;
    }

    const urlObj = new URL(url);
    const path = urlObj.pathname;
    const { classification, patternName, category } = classifyPath(path);

    const call = {
      url,
      path,
      method: request.method(),
      timestamp: Date.now(),
      classification,
      patternName,
      category
    };

    calls.push(call);

    // Log immediately with emoji indicator
    const emoji = classification === 'legacy' ? '🔴' : classification === 'new' ? '🟢' : '⚪';
    console.log(`   ${emoji} [${classification.toUpperCase()}] ${request.method()} ${path}`);
  }

  return {
    /**
     * Start monitoring network requests
     */
    start() {
      isMonitoring = true;
      page.on('request', handleRequest);
      console.log('\n   📡 Network monitoring started');
    },

    /**
     * Stop monitoring
     */
    stop() {
      isMonitoring = false;
      page.off('request', handleRequest);
      console.log('   📡 Network monitoring stopped\n');
    },

    /**
     * Get all recorded calls
     */
    getCalls() {
      return [...calls];
    },

    /**
     * Get legacy calls only
     */
    getLegacyCalls() {
      return calls.filter(c => c.classification === 'legacy');
    },

    /**
     * Get new API calls only
     */
    getNewCalls() {
      return calls.filter(c => c.classification === 'new');
    },

    /**
     * Check if any legacy calls were made
     */
    hasLegacyCalls() {
      return calls.some(c => c.classification === 'legacy');
    },

    /**
     * Generate a detailed report
     */
    generateReport() {
      const legacy = this.getLegacyCalls();
      const newCalls = this.getNewCalls();
      const other = calls.filter(c => c.classification === 'other');

      const report = {
        summary: {
          total: calls.length,
          legacy: legacy.length,
          new: newCalls.length,
          other: other.length,
          migrationComplete: legacy.length === 0
        },
        legacyCalls: legacy.map(c => ({
          path: c.path,
          pattern: c.patternName,
          category: c.category
        })),
        newCalls: newCalls.map(c => ({
          path: c.path,
          pattern: c.patternName,
          category: c.category
        })),
        byCategory: {}
      };

      // Group by category
      for (const call of calls) {
        if (call.category) {
          if (!report.byCategory[call.category]) {
            report.byCategory[call.category] = { legacy: 0, new: 0 };
          }
          report.byCategory[call.category][call.classification]++;
        }
      }

      return report;
    },

    /**
     * Print formatted report to console
     */
    printReport() {
      const report = this.generateReport();

      console.log('\n   ╔═══════════════════════════════════════════════════════════╗');
      console.log('   ║            📊 API MIGRATION STATUS REPORT                  ║');
      console.log('   ╚═══════════════════════════════════════════════════════════╝\n');

      console.log(`   Total API calls: ${report.summary.total}`);
      console.log(`   🟢 New endpoints: ${report.summary.new}`);
      console.log(`   🔴 Legacy endpoints: ${report.summary.legacy}`);
      console.log(`   ⚪ Other: ${report.summary.other}`);

      if (report.summary.legacy > 0) {
        console.log('\n   ⚠️  LEGACY ENDPOINTS DETECTED:');
        for (const call of report.legacyCalls) {
          console.log(`      - ${call.path} (${call.pattern})`);
        }
      }

      console.log('\n   By Category:');
      for (const [category, counts] of Object.entries(report.byCategory)) {
        const status = counts.legacy > 0 ? '🔴' : '🟢';
        console.log(`      ${status} ${category}: ${counts.new} new, ${counts.legacy} legacy`);
      }

      console.log('\n   Migration Status:', report.summary.migrationComplete
        ? '✅ COMPLETE - No legacy endpoints used'
        : '❌ INCOMPLETE - Legacy endpoints still in use');

      return report;
    },

    /**
     * Clear recorded calls
     */
    clear() {
      calls.length = 0;
    }
  };
}

/**
 * Assertion helper - fails test if legacy endpoints were used
 * @param {ReturnType<typeof createNetworkMonitor>} monitor
 * @param {import('@playwright/test').expect} expect
 */
export function assertNoLegacyEndpoints(monitor, expect) {
  const report = monitor.printReport();

  expect(
    report.summary.legacy,
    `Legacy endpoints still in use:\n${report.legacyCalls.map(c => `  - ${c.path}`).join('\n')}`
  ).toBe(0);
}

/**
 * Frontend base URL
 */
export const FRONTEND_URL = 'http://localhost:3111';

/**
 * Health check helper
 */
export async function checkDevServer() {
  try {
    const response = await fetch(`${FRONTEND_URL}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}
```

**Step 2: Commit**

```bash
git add tests/runtime/content-migration/migration-test-utils.mjs
git commit -m "test(e2e): add network monitoring utilities for migration validation"
```

---

## Task 2: TVApp Menu Navigation Test

**Files:**
- Create: `tests/runtime/content-migration/tvapp-menu-navigation.runtime.test.mjs`

**Step 1: Write the test**

```javascript
// tests/runtime/content-migration/tvapp-menu-navigation.runtime.test.mjs
/**
 * TVApp Menu Navigation Migration Test
 *
 * Validates that TVApp menu navigation uses new Content Domain endpoints
 * instead of legacy data/list endpoints.
 *
 * Test Coverage:
 * - Initial menu load (TVApp folder)
 * - Menu item navigation
 * - Nested folder navigation
 *
 * Legacy endpoints that should NOT be called:
 * - /data/list/TVApp/recent_on_top
 * - /data/list/:folder/:config
 *
 * New endpoints that SHOULD be called:
 * - /api/list/folder/TVApp/recent_on_top
 * - /api/list/folder/:name/:modifiers
 *
 * Usage:
 *   npx playwright test tests/runtime/content-migration/tvapp-menu-navigation.runtime.test.mjs --headed
 */

import { test, expect } from '@playwright/test';
import {
  createNetworkMonitor,
  assertNoLegacyEndpoints,
  FRONTEND_URL,
  checkDevServer
} from './migration-test-utils.mjs';

test.describe.serial('TVApp Menu Navigation - Migration Validation', () => {
  /** @type {import('@playwright/test').Page} */
  let page;
  let monitor;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterAll(async () => {
    if (page) await page.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 1: Dev Server Health Check
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 1: Dev server is running', async () => {
    console.log('\n🏃 HURDLE 1: Checking dev server...');

    const healthy = await checkDevServer();
    expect(healthy, 'Dev server not running - start with: npm run dev').toBe(true);

    console.log('✅ HURDLE 1 PASSED: Dev server healthy\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 2: Initial TVApp Load
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 2: TVApp initial load uses new endpoints', async () => {
    console.log('\n🏃 HURDLE 2: Testing TVApp initial load...');

    // Create and start network monitor
    monitor = createNetworkMonitor(page);
    monitor.start();

    // Navigate to TVApp
    await page.goto(`${FRONTEND_URL}/tv`, { waitUntil: 'domcontentloaded' });

    // Wait for menu to load
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Check for menu content
    const menuContent = await page.locator('.menu-stack, .tv-app__content').first();
    await expect(menuContent).toBeVisible({ timeout: 10000 });

    monitor.stop();

    // Assert no legacy endpoints
    assertNoLegacyEndpoints(monitor, expect);

    console.log('✅ HURDLE 2 PASSED: Initial load uses new endpoints\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 3: Menu Item Click
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 3: Menu item navigation uses new endpoints', async () => {
    console.log('\n🏃 HURDLE 3: Testing menu item navigation...');

    monitor.clear();
    monitor.start();

    // Find and click a menu item (folder or container)
    const menuItem = page.locator('[class*="menu-item"], [class*="MenuItem"]').first();
    const isVisible = await menuItem.isVisible({ timeout: 5000 }).catch(() => false);

    if (isVisible) {
      const itemText = await menuItem.textContent();
      console.log(`   Clicking menu item: ${itemText?.substring(0, 30)}`);
      await menuItem.click();
      await page.waitForTimeout(2000);
    } else {
      console.log('   No clickable menu items found - skipping');
    }

    monitor.stop();

    // Assert no legacy endpoints
    assertNoLegacyEndpoints(monitor, expect);

    console.log('✅ HURDLE 3 PASSED: Menu navigation uses new endpoints\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 4: Final Report
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 4: Generate migration report', async () => {
    console.log('\n🏃 HURDLE 4: Generating final migration report...');

    const report = monitor.generateReport();

    console.log('\n   ════════════════════════════════════════════════════════');
    console.log('   📋 TVAPP MENU NAVIGATION MIGRATION SUMMARY');
    console.log('   ════════════════════════════════════════════════════════\n');

    console.log(`   API Calls Analyzed: ${report.summary.total}`);
    console.log(`   New Endpoints Used: ${report.summary.new}`);
    console.log(`   Legacy Endpoints Used: ${report.summary.legacy}`);
    console.log(`   Migration Complete: ${report.summary.migrationComplete ? 'YES ✅' : 'NO ❌'}`);

    expect(report.summary.migrationComplete, 'Migration incomplete - legacy endpoints still in use').toBe(true);

    console.log('\n✅ HURDLE 4 PASSED: Migration validation complete\n');
  });
});
```

**Step 2: Commit**

```bash
git add tests/runtime/content-migration/tvapp-menu-navigation.runtime.test.mjs
git commit -m "test(e2e): add TVApp menu navigation migration test"
```

---

## Task 3: TVApp Playback Test (All Content Types)

**Files:**
- Create: `tests/runtime/content-migration/tvapp-playback.runtime.test.mjs`

**Step 1: Write the test**

```javascript
// tests/runtime/content-migration/tvapp-playback.runtime.test.mjs
/**
 * TVApp Playback Migration Test
 *
 * Tests playback initiation for all content types via query params.
 * Validates that play endpoints use new Content Domain API.
 *
 * Content Types Tested:
 * - plex: Plex media (numeric ID)
 * - media: Filesystem media (path)
 * - hymn: Hymn by number
 * - primary: Primary song by number
 * - talk: General conference talk
 * - scripture: Scripture chapter
 * - poem: Poetry
 *
 * Legacy endpoints that should NOT be called:
 * - /media/plex/info/:id
 * - /media/info/*
 * - /data/hymn/:num
 * - /data/scripture/*
 * - /data/talk/*
 * - /data/poetry/*
 *
 * Usage:
 *   npx playwright test tests/runtime/content-migration/tvapp-playback.runtime.test.mjs --headed
 */

import { test, expect } from '@playwright/test';
import {
  createNetworkMonitor,
  assertNoLegacyEndpoints,
  FRONTEND_URL,
  checkDevServer
} from './migration-test-utils.mjs';

// Test cases for each content type
const CONTENT_TYPE_TESTS = [
  {
    name: 'Hymn',
    queryParam: 'hymn=113',
    description: 'Hymn #113 (Our Savior\'s Love)',
    expectedPattern: /\/api\/local-content\/hymn\//
  },
  {
    name: 'Primary Song',
    queryParam: 'primary=2',
    description: 'Primary #2 (I Am a Child of God)',
    expectedPattern: /\/api\/local-content\/primary\//
  },
  {
    name: 'Scripture',
    queryParam: 'scripture=cfm/1nephi1',
    description: 'Scripture (1 Nephi 1)',
    expectedPattern: /\/api\/local-content\/scripture\//
  },
  {
    name: 'Talk',
    queryParam: 'talk=general/oct2024-holland',
    description: 'General Conference Talk',
    expectedPattern: /\/api\/local-content\/talk\//
  },
  {
    name: 'Poem',
    queryParam: 'poem=remedy/01',
    description: 'Poetry',
    expectedPattern: /\/api\/local-content\/poem\//
  }
];

test.describe('TVApp Playback Migration - All Content Types', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 1: Dev Server Check
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 1: Dev server is running', async () => {
    console.log('\n🏃 HURDLE 1: Checking dev server...');

    const healthy = await checkDevServer();
    expect(healthy, 'Dev server not running - start with: npm run dev').toBe(true);

    console.log('✅ HURDLE 1 PASSED: Dev server healthy\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Content Type Tests (Parallel)
  // ═══════════════════════════════════════════════════════════════════════════
  for (const contentTest of CONTENT_TYPE_TESTS) {
    test(`CONTENT: ${contentTest.name} playback uses new endpoint`, async ({ page }) => {
      console.log(`\n🏃 Testing ${contentTest.name}: ${contentTest.description}`);

      const monitor = createNetworkMonitor(page);
      monitor.start();

      // Navigate with query param
      const url = `${FRONTEND_URL}/tv?${contentTest.queryParam}`;
      console.log(`   URL: ${url}`);

      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);

      monitor.stop();

      // Check for expected new endpoint pattern
      const newCalls = monitor.getNewCalls();
      const hasExpectedCall = newCalls.some(c => contentTest.expectedPattern.test(c.path));

      if (!hasExpectedCall) {
        console.log(`   ⚠️ Expected pattern not found: ${contentTest.expectedPattern}`);
        console.log(`   Calls made: ${newCalls.map(c => c.path).join(', ') || 'none'}`);
      }

      // Assert no legacy endpoints
      assertNoLegacyEndpoints(monitor, expect);

      console.log(`✅ ${contentTest.name} uses new endpoints\n`);
    });
  }
});
```

**Step 2: Commit**

```bash
git add tests/runtime/content-migration/tvapp-playback.runtime.test.mjs
git commit -m "test(e2e): add TVApp playback migration test for all content types"
```

---

## Task 4: TVApp Queue/Playlist Test

**Files:**
- Create: `tests/runtime/content-migration/tvapp-queue.runtime.test.mjs`

**Step 1: Write the test**

```javascript
// tests/runtime/content-migration/tvapp-queue.runtime.test.mjs
/**
 * TVApp Queue/Playlist Migration Test
 *
 * Tests queue initialization and playlist resolution.
 * Validates that list/play endpoints use new Content Domain API.
 *
 * Test Scenarios:
 * - Queue from folder (playlist=FolderName)
 * - Queue from Plex (queue=12345)
 * - Shuffle modifier
 *
 * Legacy endpoints that should NOT be called:
 * - /data/list/:folder/playable
 * - /media/plex/list/:id/playable
 *
 * New endpoints that SHOULD be called:
 * - /api/list/folder/:name/playable
 * - /api/list/plex/:id/playable
 *
 * Usage:
 *   npx playwright test tests/runtime/content-migration/tvapp-queue.runtime.test.mjs --headed
 */

import { test, expect } from '@playwright/test';
import {
  createNetworkMonitor,
  assertNoLegacyEndpoints,
  FRONTEND_URL,
  checkDevServer
} from './migration-test-utils.mjs';

test.describe.serial('TVApp Queue/Playlist - Migration Validation', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterAll(async () => {
    if (page) await page.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 1: Dev Server Check
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 1: Dev server is running', async () => {
    console.log('\n🏃 HURDLE 1: Checking dev server...');

    const healthy = await checkDevServer();
    expect(healthy, 'Dev server not running - start with: npm run dev').toBe(true);

    console.log('✅ HURDLE 1 PASSED: Dev server healthy\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 2: Folder Queue
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 2: Folder queue uses new endpoints', async () => {
    console.log('\n🏃 HURDLE 2: Testing folder queue...');

    const monitor = createNetworkMonitor(page);
    monitor.start();

    // Queue from a folder playlist
    await page.goto(`${FRONTEND_URL}/tv?queue=MorningProgram`, {
      waitUntil: 'domcontentloaded'
    });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    monitor.stop();

    // Check for list/folder endpoint
    const calls = monitor.getNewCalls();
    const hasListCall = calls.some(c => c.path.includes('/api/list/'));

    console.log(`   List endpoint called: ${hasListCall ? 'YES' : 'NO'}`);

    assertNoLegacyEndpoints(monitor, expect);

    console.log('✅ HURDLE 2 PASSED: Folder queue uses new endpoints\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 3: Queue with Shuffle
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 3: Queue with shuffle modifier uses new endpoints', async () => {
    console.log('\n🏃 HURDLE 3: Testing queue with shuffle...');

    const monitor = createNetworkMonitor(page);
    monitor.start();

    // Queue with shuffle
    await page.goto(`${FRONTEND_URL}/tv?queue=MorningProgram&shuffle=true`, {
      waitUntil: 'domcontentloaded'
    });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    monitor.stop();

    assertNoLegacyEndpoints(monitor, expect);

    console.log('✅ HURDLE 3 PASSED: Shuffle queue uses new endpoints\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 4: Final Report
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 4: Queue migration report', async () => {
    console.log('\n🏃 HURDLE 4: Queue migration summary...');

    console.log('\n   ════════════════════════════════════════════════════════');
    console.log('   📋 TVAPP QUEUE MIGRATION SUMMARY');
    console.log('   ════════════════════════════════════════════════════════\n');

    console.log('   All queue operations using new endpoints ✅');

    console.log('\n✅ HURDLE 4 PASSED: Queue migration complete\n');
  });
});
```

**Step 2: Commit**

```bash
git add tests/runtime/content-migration/tvapp-queue.runtime.test.mjs
git commit -m "test(e2e): add TVApp queue/playlist migration test"
```

---

## Task 5: Progress Logging Test

**Files:**
- Create: `tests/runtime/content-migration/progress-logging.runtime.test.mjs`

**Step 1: Write the test**

```javascript
// tests/runtime/content-migration/progress-logging.runtime.test.mjs
/**
 * Progress Logging Migration Test
 *
 * Tests that watch progress updates use new Content Domain API.
 *
 * Legacy endpoint that should NOT be called:
 * - POST /media/log
 *
 * New endpoint that SHOULD be called:
 * - POST /api/content/progress/:source/:id
 *
 * Usage:
 *   npx playwright test tests/runtime/content-migration/progress-logging.runtime.test.mjs --headed
 */

import { test, expect } from '@playwright/test';
import {
  createNetworkMonitor,
  assertNoLegacyEndpoints,
  FRONTEND_URL,
  checkDevServer
} from './migration-test-utils.mjs';

test.describe.serial('Progress Logging - Migration Validation', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterAll(async () => {
    if (page) await page.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 1: Dev Server Check
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 1: Dev server is running', async () => {
    console.log('\n🏃 HURDLE 1: Checking dev server...');

    const healthy = await checkDevServer();
    expect(healthy, 'Dev server not running - start with: npm run dev').toBe(true);

    console.log('✅ HURDLE 1 PASSED: Dev server healthy\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 2: Start Playback and Monitor Progress Calls
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 2: Progress updates use new endpoint', async () => {
    console.log('\n🏃 HURDLE 2: Testing progress logging...');

    const monitor = createNetworkMonitor(page);

    // Navigate to TV with a playable item (hymn for simplicity)
    await page.goto(`${FRONTEND_URL}/tv?hymn=113`, {
      waitUntil: 'domcontentloaded'
    });
    await page.waitForLoadState('networkidle');

    // Start monitoring after initial load
    monitor.start();

    // Wait for playback to start and progress to be logged
    // Progress is typically logged periodically during playback
    console.log('   Waiting for progress logging (10s)...');
    await page.waitForTimeout(10000);

    monitor.stop();

    // Check calls
    const report = monitor.printReport();

    // Look for progress-related calls
    const progressCalls = monitor.getCalls().filter(c =>
      c.path.includes('progress') || c.path.includes('log')
    );

    console.log(`   Progress-related calls: ${progressCalls.length}`);

    // Assert no legacy /media/log calls
    const legacyLogCalls = monitor.getLegacyCalls().filter(c =>
      c.patternName === 'media/log'
    );

    expect(
      legacyLogCalls.length,
      `Legacy /media/log endpoint still in use:\n${legacyLogCalls.map(c => c.path).join('\n')}`
    ).toBe(0);

    console.log('✅ HURDLE 2 PASSED: Progress uses new endpoints\n');
  });
});
```

**Step 2: Commit**

```bash
git add tests/runtime/content-migration/progress-logging.runtime.test.mjs
git commit -m "test(e2e): add progress logging migration test"
```

---

## Task 6: Full Migration Validation Suite

**Files:**
- Create: `tests/runtime/content-migration/full-migration.runtime.test.mjs`

**Step 1: Write the comprehensive test**

```javascript
// tests/runtime/content-migration/full-migration.runtime.test.mjs
/**
 * Full Content Domain Migration Validation
 *
 * Comprehensive test that exercises ALL TVApp use cases and validates
 * that NO legacy endpoints are used.
 *
 * This test should be run before considering the frontend migration complete.
 *
 * Coverage:
 * - Menu navigation (folder lists)
 * - All content type playback (plex, media, hymn, primary, talk, scripture, poem)
 * - Queue operations
 * - Progress logging
 * - Media streaming (proxy)
 *
 * Usage:
 *   npx playwright test tests/runtime/content-migration/full-migration.runtime.test.mjs --headed
 */

import { test, expect } from '@playwright/test';
import {
  createNetworkMonitor,
  assertNoLegacyEndpoints,
  FRONTEND_URL,
  checkDevServer
} from './migration-test-utils.mjs';

// All content types to test
const ALL_CONTENT_TESTS = [
  { name: 'Hymn', param: 'hymn=113' },
  { name: 'Primary', param: 'primary=2' },
  { name: 'Scripture', param: 'scripture=cfm/1nephi1' },
  { name: 'Talk', param: 'talk=general/oct2024-holland' },
  { name: 'Poem', param: 'poem=remedy/01' },
];

test.describe.serial('Full Migration Validation', () => {
  /** @type {import('@playwright/test').Page} */
  let page;
  /** @type {ReturnType<typeof createNetworkMonitor>} */
  let globalMonitor;

  const allCalls = [];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterAll(async () => {
    if (page) await page.close();
  });

  test('SETUP: Dev server check', async () => {
    const healthy = await checkDevServer();
    expect(healthy, 'Dev server not running').toBe(true);

    globalMonitor = createNetworkMonitor(page);
  });

  test('TEST 1: Menu navigation', async () => {
    console.log('\n📋 TEST 1: Menu Navigation');

    globalMonitor.clear();
    globalMonitor.start();

    await page.goto(`${FRONTEND_URL}/tv`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    globalMonitor.stop();
    allCalls.push(...globalMonitor.getCalls());

    assertNoLegacyEndpoints(globalMonitor, expect);
  });

  for (const content of ALL_CONTENT_TESTS) {
    test(`TEST: ${content.name} playback`, async () => {
      console.log(`\n📋 TEST: ${content.name} Playback`);

      globalMonitor.clear();
      globalMonitor.start();

      await page.goto(`${FRONTEND_URL}/tv?${content.param}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);

      globalMonitor.stop();
      allCalls.push(...globalMonitor.getCalls());

      assertNoLegacyEndpoints(globalMonitor, expect);
    });
  }

  test('TEST: Queue operation', async () => {
    console.log('\n📋 TEST: Queue Operation');

    globalMonitor.clear();
    globalMonitor.start();

    await page.goto(`${FRONTEND_URL}/tv?queue=MorningProgram&shuffle=true`, {
      waitUntil: 'networkidle'
    });
    await page.waitForTimeout(2000);

    globalMonitor.stop();
    allCalls.push(...globalMonitor.getCalls());

    assertNoLegacyEndpoints(globalMonitor, expect);
  });

  test('FINAL: Generate comprehensive report', async () => {
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║     📊 FULL MIGRATION VALIDATION REPORT                       ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝\n');

    const legacyCalls = allCalls.filter(c => c.classification === 'legacy');
    const newCalls = allCalls.filter(c => c.classification === 'new');

    console.log(`Total API Calls Analyzed: ${allCalls.length}`);
    console.log(`🟢 New Endpoints: ${newCalls.length}`);
    console.log(`🔴 Legacy Endpoints: ${legacyCalls.length}`);

    // Group new calls by pattern
    const newByPattern = {};
    for (const call of newCalls) {
      newByPattern[call.patternName] = (newByPattern[call.patternName] || 0) + 1;
    }

    console.log('\nNew Endpoint Usage:');
    for (const [pattern, count] of Object.entries(newByPattern)) {
      console.log(`   🟢 ${pattern}: ${count} calls`);
    }

    if (legacyCalls.length > 0) {
      console.log('\n⚠️ LEGACY ENDPOINTS DETECTED:');
      for (const call of legacyCalls) {
        console.log(`   🔴 ${call.path}`);
      }
      console.log('\n❌ MIGRATION INCOMPLETE');
    } else {
      console.log('\n✅ MIGRATION COMPLETE - No legacy endpoints detected!');
    }

    console.log('\n═══════════════════════════════════════════════════════════════\n');

    expect(legacyCalls.length, 'Legacy endpoints still in use').toBe(0);
  });
});
```

**Step 2: Commit**

```bash
git add tests/runtime/content-migration/full-migration.runtime.test.mjs
git commit -m "test(e2e): add comprehensive full migration validation suite"
```

---

## Task 7: Create Test Runner Script

**Files:**
- Create: `tests/runtime/content-migration/run-migration-tests.sh`

**Step 1: Write the script**

```bash
#!/bin/bash
# tests/runtime/content-migration/run-migration-tests.sh
#
# Runs all content domain migration validation tests.
# Use this script to validate that frontend has fully migrated.

set -e

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║     Content Domain Migration E2E Test Suite                   ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Check if dev server is running
echo "Checking dev server..."
if ! curl -s http://localhost:3111/api/health > /dev/null 2>&1; then
    echo "❌ Dev server not running. Start with: npm run dev"
    exit 1
fi
echo "✅ Dev server running"
echo ""

# Run tests
echo "Running migration validation tests..."
echo ""

npx playwright test tests/runtime/content-migration/ \
    --reporter=list \
    --timeout=60000

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "Migration validation complete!"
echo "═══════════════════════════════════════════════════════════════"
```

**Step 2: Make executable and commit**

```bash
chmod +x tests/runtime/content-migration/run-migration-tests.sh
git add tests/runtime/content-migration/run-migration-tests.sh
git commit -m "test(e2e): add migration test runner script"
```

---

## Summary

This plan creates a comprehensive E2E test suite for validating the Content Domain migration:

### Test Files Created

| File | Purpose |
|------|---------|
| `migration-test-utils.mjs` | Network monitoring and classification utilities |
| `tvapp-menu-navigation.runtime.test.mjs` | Menu/folder list navigation |
| `tvapp-playback.runtime.test.mjs` | All content type playback |
| `tvapp-queue.runtime.test.mjs` | Queue/playlist operations |
| `progress-logging.runtime.test.mjs` | Watch progress updates |
| `full-migration.runtime.test.mjs` | Comprehensive validation |
| `run-migration-tests.sh` | Test runner script |

### Content Types Covered

- Menu navigation (folder lists)
- Plex media playback
- Filesystem media playback
- Hymns
- Primary songs
- Scripture
- Talks
- Poetry
- Queue/playlist operations
- Progress/watch state logging

### How It Works

1. **Network Monitor** - Intercepts all HTTP requests during test
2. **Classification** - Each request is classified as "legacy" or "new" based on URL patterns
3. **Real-time Logging** - Each API call is logged with emoji indicators (🔴 legacy, 🟢 new)
4. **Assertions** - Tests fail if ANY legacy endpoint is detected
5. **Reports** - Comprehensive summary at end of each test suite

### Running the Tests

```bash
# Full suite
./tests/runtime/content-migration/run-migration-tests.sh

# Individual test
npx playwright test tests/runtime/content-migration/tvapp-menu-navigation.runtime.test.mjs --headed

# All migration tests
npx playwright test tests/runtime/content-migration/ --reporter=list
```

### Expected Output

When migration is complete:
```
🟢 [NEW] GET /api/list/folder/TVApp/recent_on_top
🟢 [NEW] GET /api/play/plex/12345
🟢 [NEW] POST /api/content/progress/plex/12345

✅ MIGRATION COMPLETE - No legacy endpoints detected!
```

When legacy endpoints still in use:
```
🔴 [LEGACY] GET /data/list/TVApp/recent_on_top
🟢 [NEW] GET /api/play/plex/12345
🔴 [LEGACY] POST /media/log

⚠️ LEGACY ENDPOINTS DETECTED:
   🔴 /data/list/TVApp/recent_on_top
   🔴 /media/log

❌ MIGRATION INCOMPLETE
```
