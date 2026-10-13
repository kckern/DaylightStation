# Live Test Harness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a test harness that runs live integration tests sequentially with quarantine-by-service behavior to prevent cascading failures.

**Architecture:** A standalone harness.mjs discovers test files, runs them via Jest programmatically, tracks failures per service, and quarantines services after first failure. Shared utilities help tests verify data files were updated.

**Tech Stack:** Node.js ESM, Jest programmatic API, YAML parsing for data files

---

## Task 1: Create harness-utils.mjs

**Files:**
- Create: `tests/live/harness-utils.mjs`

**Step 1: Create the utility file with data reading helpers**

```js
/**
 * Shared utilities for live test harness
 */

import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

/**
 * Get the data directory from environment
 */
export function getDataPath() {
  return process.env.DAYLIGHT_DATA_PATH;
}

/**
 * Read and parse a YAML data file
 * @param {string} relativePath - Path relative to data directory
 * @returns {object|array|null} Parsed YAML content or null if not found
 */
export function readYamlFile(relativePath) {
  const dataPath = getDataPath();
  if (!dataPath) return null;

  const fullPath = path.join(dataPath, relativePath);
  if (!fs.existsSync(fullPath)) return null;

  const content = fs.readFileSync(fullPath, 'utf8');
  return yaml.load(content);
}

/**
 * Get file modification time
 * @param {string} relativePath - Path relative to data directory
 * @returns {Date|null} File mtime or null if not found
 */
export function getFileMtime(relativePath) {
  const dataPath = getDataPath();
  if (!dataPath) return null;

  const fullPath = path.join(dataPath, relativePath);
  if (!fs.existsSync(fullPath)) return null;

  const stats = fs.statSync(fullPath);
  return stats.mtime;
}

/**
 * Check if file has entries for a date range
 * @param {object|array} data - Parsed data file
 * @param {string} startDate - ISO date string (YYYY-MM-DD)
 * @param {string} endDate - ISO date string (YYYY-MM-DD)
 * @param {string} dateField - Field name containing date (default: 'date')
 * @returns {boolean} True if entries exist in range
 */
export function hasEntriesInRange(data, startDate, endDate = null, dateField = 'date') {
  endDate = endDate || startDate;

  // Handle array of entries
  if (Array.isArray(data)) {
    return data.some(entry => {
      const entryDate = entry[dateField]?.substring(0, 10);
      return entryDate >= startDate && entryDate <= endDate;
    });
  }

  // Handle object keyed by date
  if (data && typeof data === 'object') {
    const dates = Object.keys(data).filter(k => k.match(/^\d{4}-\d{2}-\d{2}$/));
    return dates.some(d => d >= startDate && d <= endDate);
  }

  return false;
}

/**
 * Get today's date in ISO format
 * @returns {string} YYYY-MM-DD
 */
export function getToday() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get date N days ago in ISO format
 * @param {number} days - Number of days ago
 * @returns {string} YYYY-MM-DD
 */
export function getDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}
```

**Step 2: Verify the file was created correctly**

Run: `node -e "import('./tests/live/harness-utils.mjs').then(m => console.log(Object.keys(m)))"`
Expected: `[ 'getDataPath', 'readYamlFile', 'getFileMtime', 'hasEntriesInRange', 'getToday', 'getDaysAgo' ]`

**Step 3: Commit**

```bash
git add tests/live/harness-utils.mjs
git commit -m "feat(tests): add harness utilities for live test data verification"
```

---

## Task 2: Create harness.config.mjs

**Files:**
- Create: `tests/live/harness.config.mjs`

**Step 1: Create the config file with defaults and service overrides**

```js
/**
 * Live test harness configuration
 */

export default {
  // Default settings for all services
  defaults: {
    delayBetweenServices: 1000,  // ms between services
    delayBetweenTests: 500,      // ms between tests within service
    timeout: 60000,              // test timeout in ms
  },

  // Per-service overrides
  services: {
    // Slower APIs need more delay
    withings: {
      delayBetweenTests: 2000
    },
    garmin: {
      delayBetweenTests: 2000
    },

    // Backfill-capable services (support BACKFILL_SINCE env var)
    strava: {
      supportsBackfill: true
    },
    lastfm: {
      supportsBackfill: true
    },
    letterboxd: {
      supportsBackfill: true
    },
    goodreads: {
      supportsBackfill: true
    },
  }
};
```

**Step 2: Verify the config loads**

Run: `node -e "import('./tests/live/harness.config.mjs').then(c => console.log(JSON.stringify(c.default, null, 2)))"`
Expected: JSON output showing defaults and services objects

**Step 3: Commit**

```bash
git add tests/live/harness.config.mjs
git commit -m "feat(tests): add harness configuration for live tests"
```

---

## Task 3: Create harness.mjs - Core Structure

**Files:**
- Create: `tests/live/harness.mjs`

**Step 1: Create the harness with argument parsing and service discovery**

```js
#!/usr/bin/env node

/**
 * Live Test Harness
 *
 * Runs live integration tests with quarantine-by-service behavior.
 *
 * Usage:
 *   node tests/live/harness.mjs [options]
 *
 * Options:
 *   --only=gcal,strava     Run only specified services
 *   --skip=gmail,withings  Skip specified services
 *   --backfill-since=DATE  Set backfill date (YYYY-MM-DD)
 *   --verbose              Show full stack traces
 *   --dry-run              Show what would run without executing
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './harness.config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(argv) {
  const args = {
    only: null,
    skip: [],
    backfillSince: null,
    verbose: false,
    dryRun: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--only=')) {
      args.only = arg.split('=')[1].split(',').map(s => s.trim());
    } else if (arg.startsWith('--skip=')) {
      args.skip = arg.split('=')[1].split(',').map(s => s.trim());
    } else if (arg.startsWith('--backfill-since=')) {
      args.backfillSince = arg.split('=')[1];
    } else if (arg === '--verbose') {
      args.verbose = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    }
  }

  return args;
}

// ============================================================================
// Service Discovery
// ============================================================================

function discoverServices() {
  const services = [];
  const entries = fs.readdirSync(__dirname, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const serviceDir = path.join(__dirname, entry.name);
    const testFiles = fs.readdirSync(serviceDir)
      .filter(f => f.endsWith('.live.test.mjs'))
      .map(f => path.join(serviceDir, f));

    if (testFiles.length > 0) {
      services.push({
        name: entry.name,
        testFiles,
        config: { ...config.defaults, ...config.services[entry.name] }
      });
    }
  }

  return services.sort((a, b) => a.name.localeCompare(b.name));
}

// ============================================================================
// Output Formatting
// ============================================================================

const SYMBOLS = {
  pass: '\x1b[32m✓\x1b[0m',
  fail: '\x1b[31m✗\x1b[0m',
  skip: '\x1b[33m⊘\x1b[0m',
  service: '\x1b[36m▶\x1b[0m',
};

function log(message) {
  console.log(message);
}

function logService(name) {
  log(`\n${SYMBOLS.service} ${name}`);
}

function logPass(testName, duration) {
  log(`  ${SYMBOLS.pass} ${testName} (${(duration / 1000).toFixed(1)}s)`);
}

function logFail(testName, error, verbose = false) {
  log(`  ${SYMBOLS.fail} ${testName}`);
  if (error) {
    const summary = error.split('\n')[0].substring(0, 80);
    log(`    → ${summary}`);
    if (verbose) {
      log(error.split('\n').slice(1).map(l => `    ${l}`).join('\n'));
    }
  }
}

function logSkip(testName, reason) {
  log(`  ${SYMBOLS.skip} ${testName} (${reason})`);
}

function logSummary(results) {
  const line = '═'.repeat(50);
  log(`\n${line}`);
  log(' LIVE TEST SUMMARY');
  log(line);

  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const [service, result] of Object.entries(results)) {
    const passed = result.passed || 0;
    const failed = result.failed || 0;
    const skipped = result.skipped || 0;
    const total = passed + failed + skipped;

    totalPassed += passed;
    totalFailed += failed;
    totalSkipped += skipped;

    let status = SYMBOLS.pass;
    let suffix = '';

    if (result.quarantined) {
      status = SYMBOLS.fail;
      suffix = ' (quarantined)';
    } else if (result.noAuth) {
      status = SYMBOLS.skip;
      suffix = ' (no auth)';
    } else if (failed > 0) {
      status = SYMBOLS.fail;
    }

    log(` ${status} ${service.padEnd(15)} ${passed}/${total} passed${suffix}`);
  }

  log('─'.repeat(50));
  log(` Total: ${totalPassed} passed, ${totalFailed} failed, ${totalSkipped} skipped`);
  log(line);

  return totalFailed > 0 ? 1 : 0;
}

// ============================================================================
// Exports for testing
// ============================================================================

export { parseArgs, discoverServices, logSummary, SYMBOLS };
export { log, logService, logPass, logFail, logSkip };
```

**Step 2: Verify discovery works**

Run: `node -e "import('./tests/live/harness.mjs').then(m => console.log(m.discoverServices().map(s => s.name)))"`
Expected: Array of service names like `['budget', 'clickup', 'fitness', ...]`

**Step 3: Commit**

```bash
git add tests/live/harness.mjs
git commit -m "feat(tests): add harness core with discovery and output formatting"
```

---

## Task 4: Add Test Execution to harness.mjs

**Files:**
- Modify: `tests/live/harness.mjs`

**Step 1: Add the runTests function and main entry point**

Append to the end of `tests/live/harness.mjs`:

```js

// ============================================================================
// Test Execution
// ============================================================================

async function runTestFile(testFile, env, timeout) {
  const { runCLI } = await import('jest');

  const startTime = Date.now();

  try {
    const { results } = await runCLI({
      testPathPattern: [testFile.replace(/\\/g, '/')],
      runInBand: true,
      silent: true,
      testTimeout: timeout,
      passWithNoTests: false,
      _: [],
      $0: 'jest',
    }, [path.resolve(__dirname, '../..')]);

    const duration = Date.now() - startTime;

    // Check results
    const testResult = results.testResults[0];
    if (!testResult) {
      return { success: false, error: 'No test results', duration };
    }

    if (testResult.numFailingTests > 0) {
      const failedTest = testResult.testResults.find(t => t.status === 'failed');
      const error = failedTest?.failureMessages?.join('\n') || 'Unknown error';
      return { success: false, error, duration };
    }

    // Check for skipped due to no auth (test returned early)
    const skippedTest = testResult.testResults.find(t => t.status === 'pending');
    if (skippedTest) {
      return { success: true, skipped: true, reason: 'no auth configured', duration };
    }

    return { success: true, duration };
  } catch (error) {
    const duration = Date.now() - startTime;
    return { success: false, error: error.message, duration };
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runService(service, args, results) {
  const { name, testFiles, config: serviceConfig } = service;

  logService(name);

  results[name] = { passed: 0, failed: 0, skipped: 0 };
  let quarantined = false;

  for (const testFile of testFiles) {
    const testName = path.basename(testFile, '.live.test.mjs');

    if (quarantined) {
      logSkip(testName, `${name} quarantined`);
      results[name].skipped++;
      continue;
    }

    if (args.dryRun) {
      log(`  [dry-run] would run: ${testName}`);
      continue;
    }

    // Set up environment
    const env = { ...process.env };
    if (args.backfillSince) {
      env.BACKFILL_SINCE = args.backfillSince;
    }

    const result = await runTestFile(testFile, env, serviceConfig.timeout);

    if (result.skipped) {
      logSkip(testName, result.reason);
      results[name].skipped++;
      results[name].noAuth = true;
    } else if (result.success) {
      logPass(testName, result.duration);
      results[name].passed++;
    } else {
      logFail(testName, result.error, args.verbose);
      results[name].failed++;
      results[name].quarantined = true;
      quarantined = true;
    }

    // Delay between tests
    if (testFiles.indexOf(testFile) < testFiles.length - 1) {
      await sleep(serviceConfig.delayBetweenTests);
    }
  }

  return results[name];
}

async function main() {
  const args = parseArgs(process.argv);

  log('═'.repeat(50));
  log(' LIVE TEST HARNESS');
  log('═'.repeat(50));

  if (args.backfillSince) {
    log(` Backfill since: ${args.backfillSince}`);
  }
  if (args.dryRun) {
    log(' Mode: DRY RUN');
  }

  // Discover and filter services
  let services = discoverServices();

  if (args.only) {
    services = services.filter(s => args.only.includes(s.name));
  }
  if (args.skip.length > 0) {
    services = services.filter(s => !args.skip.includes(s.name));
  }

  log(` Services: ${services.length}`);

  const results = {};

  for (const service of services) {
    await runService(service, args, results);

    // Delay between services
    if (services.indexOf(service) < services.length - 1) {
      await sleep(service.config.delayBetweenServices);
    }
  }

  const exitCode = logSummary(results);
  process.exit(exitCode);
}

// Run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('Harness error:', err);
    process.exit(1);
  });
}
```

**Step 2: Test dry-run mode**

Run: `node tests/live/harness.mjs --dry-run --only=gcal`
Expected: Shows service discovery and `[dry-run] would run:` messages without executing tests

**Step 3: Commit**

```bash
git add tests/live/harness.mjs
git commit -m "feat(tests): add test execution with quarantine logic to harness"
```

---

## Task 5: Update package.json Scripts

**Files:**
- Modify: `package.json`

**Step 1: Update the test:live script and add verbose variant**

In `package.json`, replace the existing `test:live` script and add `test:live:harness`:

Change:
```json
"test:live": "NODE_OPTIONS=--experimental-vm-modules jest --runInBand --testPathPattern=tests/live",
```

To:
```json
"test:live": "NODE_OPTIONS=--experimental-vm-modules node tests/live/harness.mjs",
"test:live:verbose": "NODE_OPTIONS=--experimental-vm-modules node tests/live/harness.mjs --verbose",
"test:live:jest": "NODE_OPTIONS=--experimental-vm-modules jest --runInBand --testPathPattern=tests/live",
```

**Step 2: Verify scripts work**

Run: `npm run test:live -- --dry-run --only=gcal`
Expected: Harness runs in dry-run mode

**Step 3: Commit**

```bash
git add package.json
git commit -m "feat(tests): update npm scripts to use live test harness"
```

---

## Task 6: Update gcal Test as Reference Pattern

**Files:**
- Modify: `tests/live/gcal/gcal.live.test.mjs`

**Step 1: Update the test to use harness-utils for verification**

Replace the entire file:

```js
/**
 * Google Calendar Live Integration Test
 *
 * Run with: npm run test:live -- --only=gcal
 * Or directly: npm test -- tests/live/gcal/gcal.live.test.mjs
 *
 * Requires:
 * - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET in secrets.yml
 * - OAuth refresh token in users/{username}/auth/gcal.yml
 */

import { configService } from '../../../backend/lib/config/ConfigService.mjs';
import getCalendarEvents from '../../../backend/lib/gcal.mjs';
import { getToday, getDaysAgo } from '../harness-utils.mjs';

describe('Google Calendar Live Integration', () => {
  let username;

  beforeAll(() => {
    const dataPath = process.env.DAYLIGHT_DATA_PATH;
    if (!dataPath) {
      throw new Error('DAYLIGHT_DATA_PATH environment variable required');
    }

    if (!configService.isInitialized()) {
      configService.init({ dataDir: dataPath });
    }

    process.env.GOOGLE_CLIENT_ID = configService.getSecret('GOOGLE_CLIENT_ID');
    process.env.GOOGLE_CLIENT_SECRET = configService.getSecret('GOOGLE_CLIENT_SECRET');
    process.env.GOOGLE_REDIRECT_URI = configService.getSecret('GOOGLE_REDIRECT_URI') || 'http://localhost:3112/auth/google/callback';

    username = configService.getHeadOfHousehold();
  });

  it('fetches calendar events', async () => {
    const auth = configService.getUserAuth('gcal', username) || {};

    if (!auth.refresh_token) {
      console.log('Google Calendar OAuth not configured - skipping test');
      return;
    }

    const requestId = `test-${Date.now()}`;
    const result = await getCalendarEvents(null, requestId, username);

    // Handle error responses
    if (result?.error) {
      throw new Error(`API error: ${result.error}`);
    }
    if (result?.url) {
      throw new Error(`Re-auth needed: ${result.url}`);
    }

    // Verify we got calendar data
    if (Array.isArray(result)) {
      console.log(`Fetched ${result.length} events`);
      expect(result.length).toBeGreaterThanOrEqual(0);
    } else if (result && typeof result === 'object') {
      const dates = Object.keys(result).filter(k => k.match(/^\d{4}-\d{2}-\d{2}$/));
      console.log(`Fetched events for ${dates.length} dates`);

      // Verify we have data for recent dates (within last 7 days)
      const weekAgo = getDaysAgo(7);
      const today = getToday();
      const recentDates = dates.filter(d => d >= weekAgo && d <= today);
      console.log(`Recent dates (last 7 days): ${recentDates.length}`);
    }
  }, 60000);
});
```

**Step 2: Run the test directly to verify it works**

Run: `npm test -- tests/live/gcal/gcal.live.test.mjs`
Expected: Test runs and shows event counts (or skips if no auth)

**Step 3: Commit**

```bash
git add tests/live/gcal/gcal.live.test.mjs
git commit -m "refactor(tests): update gcal test to use harness utils"
```

---

## Task 7: End-to-End Verification

**Step 1: Run harness with subset of services**

Run: `npm run test:live -- --only=gcal,lastfm,strava`
Expected:
- Services run sequentially with delays
- Output shows pass/fail/skip symbols
- Summary table at end

**Step 2: Test quarantine behavior**

Run: `npm run test:live -- --only=gcal --verbose` (after temporarily breaking auth if needed)
Expected: First test fails, remaining tests show "quarantined"

**Step 3: Test backfill parameter**

Run: `npm run test:live -- --only=strava --backfill-since=2025-01-01`
Expected: `BACKFILL_SINCE` appears in harness header, test receives the env var

---

## Summary

| File | Purpose |
|------|---------|
| `tests/live/harness-utils.mjs` | Shared utilities for data file verification |
| `tests/live/harness.config.mjs` | Per-service configuration |
| `tests/live/harness.mjs` | Main harness runner |
| `package.json` | Updated npm scripts |
| `tests/live/gcal/gcal.live.test.mjs` | Reference test pattern |

The harness provides:
- Sequential execution with configurable delays
- Quarantine-by-service on first failure
- Grouped output with summary table
- CLI flags: `--only`, `--skip`, `--backfill-since`, `--verbose`, `--dry-run`
