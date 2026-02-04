# Harvester Live Test Suite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unified CLI tool and Jest test suite for all 15 external data harvesters.

**Architecture:** Single `harvest.mjs` CLI that uses `createHarvesterServices()` from bootstrap (identical to prod). Jest test files are thin wrappers that invoke the CLI and assert on JSON output.

**Tech Stack:** Node.js ESM, Jest, createHarvesterServices from bootstrap.mjs

**Note:** FitnessSyncer (fitsync) is a legacy module job, not a registered harvester. The 15 harvesters are: todoist, clickup, github, lastfm, reddit, letterboxd, goodreads, foursquare, gmail, gcal, shopping, buxfer, strava, withings, weather.

---

## Task 1: Cleanup - Remove Old Files

**Files:**
- Delete: `tests/live/adapter/smoke.mjs`
- Delete: `tests/live/adapter/harness-utils.mjs`
- Delete: `tests/live/adapter/finance/` (entire directory)

**Step 1: Delete obsolete files**

```bash
rm tests/live/adapter/smoke.mjs
rm tests/live/adapter/harness-utils.mjs
rm -rf tests/live/adapter/finance/
```

**Step 2: Verify deletion**

```bash
ls tests/live/adapter/
```

Expected: Only `harness.mjs`, `harness.config.mjs`, `test-preconditions.mjs`, `README.md` remain.

**Step 3: Commit**

```bash
git add -A tests/live/adapter/
git commit -m "chore: remove obsolete live test files

Delete smoke.mjs (replaced by harvest.mjs), harness-utils.mjs (unused),
and finance/ directory (buxfer-categorization was AI test, not harvester).

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Create harvest.mjs CLI - Core Structure

**Files:**
- Create: `tests/live/adapter/harvest.mjs`

**Step 1: Create CLI with argument parsing and core structure**

```javascript
#!/usr/bin/env node

/**
 * Harvester CLI Tool
 *
 * Runs harvester operations using the same code path as production cron jobs.
 * Doubles as both operational tool and test harness entry point.
 *
 * Usage:
 *   node tests/live/adapter/harvest.mjs [options]
 *
 * Options:
 *   --only=strava,github    Run only specified harvesters
 *   --skip=gmail,withings   Skip specified harvesters
 *   --since=YYYY-MM-DD      Backfill from date
 *   --verbose               Show detailed output
 *   --json                  Output results as JSON
 *   --dry-run               Show what would run without executing
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import { createHarvesterServices } from '#backend/src/0_system/bootstrap.mjs';
import { loadYaml, saveYaml } from '#backend/src/0_system/utils/FileIO.mjs';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Configuration
// ============================================================================

/**
 * Timeouts per harvester (ms)
 */
const TIMEOUTS = {
  default: 60000,
  shopping: 120000,
  gmail: 90000,
  gcal: 90000,
  strava: 90000,
  github: 90000,
};

/**
 * Convert --since date to harvester-specific options
 */
function convertSinceToOptions(serviceId, sinceDate) {
  if (!sinceDate) return {};

  const since = new Date(sinceDate);
  const now = new Date();
  const daysBack = Math.ceil((now - since) / (1000 * 60 * 60 * 24));
  const weeksBack = Math.ceil(daysBack / 7);

  const converters = {
    strava: { daysBack },
    github: { daysBack, maxRepos: 20 },
    clickup: { daysBack },
    todoist: { daysBack },
    gcal: { weeksBack, weeksAhead: 2 },
    lastfm: { since: sinceDate },
    buxfer: { startDate: sinceDate },
    // Snapshot-based harvesters ignore --since
    letterboxd: {},
    goodreads: {},
    foursquare: {},
    reddit: {},
    gmail: {},
    withings: {},
    weather: {},
    shopping: {},
  };

  return converters[serviceId] || {};
}

/**
 * Minimal options for smoke test (no --since)
 */
const SMOKE_OPTIONS = {
  strava: { daysBack: 1 },
  github: { daysBack: 1, maxRepos: 1 },
  clickup: { daysBack: 1 },
  todoist: { daysBack: 1 },
  gcal: { weeksAhead: 1, weeksBack: 1 },
  lastfm: { maxPages: 1 },
  buxfer: { daysBack: 1 },
  foursquare: {},
  reddit: { limit: 5 },
  letterboxd: {},
  goodreads: {},
  gmail: {},
  withings: {},
  weather: {},
  shopping: {},
};

// ============================================================================
// IO Functions for createHarvesterServices
// ============================================================================

function createIo(dataDir) {
  return {
    userLoadFile(username, relativePath) {
      const filePath = path.join(dataDir, 'users', username, 'lifelog', relativePath);
      return loadYaml(filePath);
    },
    userSaveFile(username, relativePath, content) {
      const filePath = path.join(dataDir, 'users', username, 'lifelog', relativePath);
      saveYaml(filePath, content);
    },
    householdSaveFile(relativePath, content) {
      const filePath = path.join(dataDir, 'households', 'default', relativePath);
      saveYaml(filePath, content);
    },
  };
}

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(argv) {
  const args = {
    only: null,
    skip: [],
    since: null,
    verbose: false,
    json: false,
    dryRun: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--only=')) {
      args.only = arg.split('=')[1].split(',').map(s => s.trim());
    } else if (arg.startsWith('--skip=')) {
      args.skip = arg.split('=')[1].split(',').map(s => s.trim());
    } else if (arg.startsWith('--since=')) {
      args.since = arg.split('=')[1];
    } else if (arg === '--verbose') {
      args.verbose = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    }
  }

  return args;
}

// ============================================================================
// Output Formatting
// ============================================================================

const SYMBOLS = {
  pass: '\x1b[32m✓\x1b[0m',
  fail: '\x1b[31m✗\x1b[0m',
  skip: '\x1b[33m⊘\x1b[0m',
  auth: '\x1b[31m🔑\x1b[0m',
  timeout: '\x1b[33m⏱\x1b[0m',
  cooldown: '\x1b[36m❄\x1b[0m',
};

function log(message, args) {
  if (!args.json) {
    console.log(message);
  }
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ============================================================================
// Harvest Runner
// ============================================================================

async function runHarvest(harvesterService, serviceId, username, options, args) {
  const startTime = Date.now();
  const timeout = TIMEOUTS[serviceId] || TIMEOUTS.default;

  const result = {
    serviceId,
    status: 'unknown',
    duration: 0,
    error: null,
    data: null,
  };

  try {
    // Check if harvester exists
    if (!harvesterService.has(serviceId)) {
      result.status = 'not_registered';
      result.error = 'Harvester not registered';
      return result;
    }

    // Check circuit breaker status
    const cbStatus = harvesterService.getStatus(serviceId);
    if (cbStatus.state === 'open') {
      result.status = 'cooldown';
      result.error = `Circuit breaker open - ${cbStatus.remainingMins || '?'} mins remaining`;
      result.duration = Date.now() - startTime;
      return result;
    }

    // Run harvest with timeout
    const harvestPromise = harvesterService.harvest(serviceId, username, options);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), timeout)
    );

    const harvestResult = await Promise.race([harvestPromise, timeoutPromise]);

    result.duration = Date.now() - startTime;
    result.data = harvestResult;

    // Interpret result
    if (harvestResult.status === 'success') {
      result.status = 'pass';
    } else if (harvestResult.status === 'skipped') {
      result.status = harvestResult.reason === 'cooldown' ? 'cooldown' : 'skipped';
      result.error = harvestResult.reason;
    } else {
      result.status = 'fail';
      result.error = harvestResult.reason || 'Unknown failure';
    }

  } catch (error) {
    result.duration = Date.now() - startTime;
    result.error = error.message;

    // Categorize error
    if (error.message === 'Timeout') {
      result.status = 'timeout';
    } else if (
      error.message.includes('not configured') ||
      error.message.includes('not found') ||
      error.message.includes('auth') ||
      error.message.includes('token') ||
      error.message.includes('credentials') ||
      error.response?.status === 401 ||
      error.response?.status === 403
    ) {
      result.status = 'auth_error';
    } else if (error.response?.status === 429) {
      result.status = 'rate_limited';
    } else {
      result.status = 'error';
    }

    // Redact sensitive data
    result.error = result.error
      .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
      .replace(/token[=:]\s*[^\s&]+/gi, 'token=[REDACTED]')
      .substring(0, 200);
  }

  return result;
}

// ============================================================================
// Summary
// ============================================================================

function summarize(results) {
  return {
    total: results.length,
    pass: results.filter(r => r.status === 'pass').length,
    fail: results.filter(r => r.status === 'fail' || r.status === 'error').length,
    auth_error: results.filter(r => r.status === 'auth_error').length,
    timeout: results.filter(r => r.status === 'timeout').length,
    cooldown: results.filter(r => r.status === 'cooldown' || r.status === 'rate_limited').length,
    skipped: results.filter(r => r.status === 'skipped' || r.status === 'not_registered').length,
  };
}

function printSummary(results, args) {
  const summary = summarize(results);

  log('', args);
  log('═'.repeat(60), args);
  log(' HARVEST SUMMARY', args);
  log('═'.repeat(60), args);

  const lines = [
    [`${SYMBOLS.pass} Pass`, summary.pass],
    [`${SYMBOLS.fail} Fail`, summary.fail],
    [`${SYMBOLS.auth} Auth Error`, summary.auth_error],
    [`${SYMBOLS.timeout} Timeout`, summary.timeout],
    [`${SYMBOLS.cooldown} Cooldown/Rate Limited`, summary.cooldown],
    [`${SYMBOLS.skip} Skipped`, summary.skipped],
  ];

  for (const [label, count] of lines) {
    if (count > 0) {
      log(` ${label.padEnd(30)} ${count}`, args);
    }
  }

  log('─'.repeat(60), args);
  log(` Total: ${summary.total}`, args);
  log('═'.repeat(60), args);

  // List auth errors for easy fixing
  const authErrors = results.filter(r => r.status === 'auth_error');
  if (authErrors.length > 0) {
    log('', args);
    log('\x1b[33mCredentials to fix:\x1b[0m', args);
    for (const r of authErrors) {
      log(`  - ${r.serviceId}: ${r.error}`, args);
    }
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs(process.argv);

  // Get data path from environment
  const dataPath = process.env.DAYLIGHT_DATA_PATH;
  if (!dataPath) {
    console.error('Error: DAYLIGHT_DATA_PATH environment variable required');
    process.exit(1);
  }

  // Initialize config
  if (!configService.isReady()) {
    initConfigService(dataPath);
  }

  const username = configService.getHeadOfHousehold();

  log('', args);
  log('═'.repeat(60), args);
  log(' HARVESTER CLI', args);
  log('═'.repeat(60), args);
  log(` User: ${username}`, args);
  log(` Data: ${dataPath}`, args);
  if (args.since) {
    log(` Since: ${args.since}`, args);
  }
  if (args.dryRun) {
    log(' Mode: DRY RUN', args);
  }
  log('', args);

  // Create harvester services using bootstrap (same as prod)
  const io = createIo(dataPath);
  let harvesterServices;
  try {
    harvesterServices = createHarvesterServices({
      io,
      httpClient: axios,
      configService,
      dataRoot: dataPath,
      logger: args.verbose ? console : { info: () => {}, debug: () => {}, warn: () => {}, error: console.error },
    });
  } catch (error) {
    console.error('Failed to create harvester services:', error.message);
    process.exit(1);
  }

  const { harvesterService } = harvesterServices;

  // Get list of harvesters to run
  let harvesters = harvesterService.listHarvesters().map(h => h.serviceId);

  if (args.only) {
    harvesters = harvesters.filter(id => args.only.includes(id));
  }
  if (args.skip.length > 0) {
    harvesters = harvesters.filter(id => !args.skip.includes(id));
  }

  log(` Harvesters: ${harvesters.length}`, args);
  log('─'.repeat(60), args);

  // Dry run - just show what would run
  if (args.dryRun) {
    for (const serviceId of harvesters) {
      const options = args.since
        ? convertSinceToOptions(serviceId, args.since)
        : SMOKE_OPTIONS[serviceId] || {};
      log(` [dry-run] ${serviceId}: ${JSON.stringify(options)}`, args);
    }
    process.exit(0);
  }

  // Run harvests
  const results = [];

  for (const serviceId of harvesters) {
    if (!args.json) {
      process.stdout.write(` ${serviceId.padEnd(15)} `);
    }

    const options = args.since
      ? convertSinceToOptions(serviceId, args.since)
      : SMOKE_OPTIONS[serviceId] || {};

    const result = await runHarvest(harvesterService, serviceId, username, options, args);
    results.push(result);

    if (!args.json) {
      const symbol = {
        pass: SYMBOLS.pass,
        fail: SYMBOLS.fail,
        auth_error: SYMBOLS.auth,
        timeout: SYMBOLS.timeout,
        cooldown: SYMBOLS.cooldown,
        rate_limited: SYMBOLS.cooldown,
        skipped: SYMBOLS.skip,
        not_registered: SYMBOLS.skip,
        error: SYMBOLS.fail,
      }[result.status] || SYMBOLS.fail;

      const statusText = result.status.padEnd(12);
      const duration = formatDuration(result.duration).padStart(8);

      console.log(`${symbol} ${statusText} ${duration}`);

      if (args.verbose && result.error) {
        console.log(`    └─ ${result.error}`);
      }
    }

    // Small delay between harvesters to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  // Output results
  if (args.json) {
    console.log(JSON.stringify({ results, summary: summarize(results) }, null, 2));
  } else {
    printSummary(results, args);
  }

  // Exit code
  const failures = results.filter(r => r.status === 'fail' || r.status === 'error');
  process.exit(failures.length > 0 ? 1 : 0);
}

// Run
main().catch(err => {
  console.error('Harvest error:', err);
  process.exit(1);
});
```

**Step 2: Make executable**

```bash
chmod +x tests/live/adapter/harvest.mjs
```

**Step 3: Test CLI runs**

```bash
export DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data
node tests/live/adapter/harvest.mjs --dry-run
```

Expected: Lists all harvesters with their options, no actual execution.

**Step 4: Commit**

```bash
git add tests/live/adapter/harvest.mjs
git commit -m "feat: add harvest.mjs CLI tool

Unified CLI for harvester operations using createHarvesterServices from
bootstrap (same code path as prod cron). Supports:
- --only, --skip for harvester selection
- --since for backfill date
- --json for programmatic output
- --dry-run for preview
- --verbose for detailed logging

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Create harvesters/ Directory and Test Helper

**Files:**
- Create: `tests/live/adapter/harvesters/`
- Create: `tests/live/adapter/harvesters/_test-helper.mjs`

**Step 1: Create directory**

```bash
mkdir -p tests/live/adapter/harvesters
```

**Step 2: Create test helper**

```javascript
// tests/live/adapter/harvesters/_test-helper.mjs

/**
 * Shared test helper for harvester live tests.
 * Invokes harvest.mjs CLI and parses JSON output.
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARVEST_CLI = path.join(__dirname, '..', 'harvest.mjs');

/**
 * Run harvest CLI for a specific harvester
 * @param {string} serviceId - Harvester to run
 * @param {Object} opts - Options
 * @param {string} [opts.since] - Backfill date (YYYY-MM-DD)
 * @returns {Promise<Object>} - Result object with status, error, duration
 */
export async function runHarvest(serviceId, opts = {}) {
  const dataPath = process.env.DAYLIGHT_DATA_PATH;
  if (!dataPath) {
    throw new Error('DAYLIGHT_DATA_PATH environment variable required');
  }

  const args = ['--only=' + serviceId, '--json'];
  if (opts.since) args.push('--since=' + opts.since);

  return new Promise((resolve, reject) => {
    const child = spawn('node', [HARVEST_CLI, ...args], {
      env: { ...process.env, DAYLIGHT_DATA_PATH: dataPath },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      try {
        const output = JSON.parse(stdout);
        const result = output.results?.find(r => r.serviceId === serviceId);
        if (result) {
          resolve(result);
        } else {
          reject(new Error(`No result for ${serviceId} in output`));
        }
      } catch (err) {
        reject(new Error(`Failed to parse CLI output: ${err.message}\nstdout: ${stdout}\nstderr: ${stderr}`));
      }
    });

    child.on('error', reject);
  });
}

/**
 * Get date N days ago in YYYY-MM-DD format
 */
export function daysAgo(n) {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return date.toISOString().split('T')[0];
}

/**
 * Acceptable statuses for a passing test
 * (cooldown is acceptable - circuit breaker doing its job)
 */
export const ACCEPTABLE_STATUSES = ['pass', 'cooldown', 'rate_limited'];
```

**Step 3: Commit**

```bash
git add tests/live/adapter/harvesters/
git commit -m "feat: add harvester test helper

Shared helper for live tests that invokes harvest.mjs CLI and parses
JSON output. Includes daysAgo() utility and ACCEPTABLE_STATUSES.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Create Harvester Test Files (Batch 1: Productivity)

**Files:**
- Create: `tests/live/adapter/harvesters/todoist.live.test.mjs`
- Create: `tests/live/adapter/harvesters/clickup.live.test.mjs`
- Create: `tests/live/adapter/harvesters/github.live.test.mjs`

**Step 1: Create todoist test**

```javascript
// tests/live/adapter/harvesters/todoist.live.test.mjs

import { runHarvest, daysAgo, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Todoist Harvester Live', () => {
  it('harvests recent tasks', async () => {
    const result = await runHarvest('todoist');

    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 60000);

  it('backfills from date when --since provided', async () => {
    const result = await runHarvest('todoist', { since: daysAgo(7) });

    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect(ACCEPTABLE_STATUSES).toContain(result.status);
  }, 90000);
});
```

**Step 2: Create clickup test**

```javascript
// tests/live/adapter/harvesters/clickup.live.test.mjs

import { runHarvest, daysAgo, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('ClickUp Harvester Live', () => {
  it('harvests recent tasks', async () => {
    const result = await runHarvest('clickup');

    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 60000);

  it('backfills from date when --since provided', async () => {
    const result = await runHarvest('clickup', { since: daysAgo(7) });

    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect(ACCEPTABLE_STATUSES).toContain(result.status);
  }, 90000);
});
```

**Step 3: Create github test**

```javascript
// tests/live/adapter/harvesters/github.live.test.mjs

import { runHarvest, daysAgo, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('GitHub Harvester Live', () => {
  it('harvests recent commits', async () => {
    const result = await runHarvest('github');

    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 90000);

  it('backfills from date when --since provided', async () => {
    const result = await runHarvest('github', { since: daysAgo(7) });

    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect(ACCEPTABLE_STATUSES).toContain(result.status);
  }, 120000);
});
```

**Step 4: Commit**

```bash
git add tests/live/adapter/harvesters/todoist.live.test.mjs \
        tests/live/adapter/harvesters/clickup.live.test.mjs \
        tests/live/adapter/harvesters/github.live.test.mjs
git commit -m "test: add productivity harvester live tests

Add todoist, clickup, github live tests using shared test helper.
Each test verifies smoke harvest and backfill with --since.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Create Harvester Test Files (Batch 2: Social)

**Files:**
- Create: `tests/live/adapter/harvesters/lastfm.live.test.mjs`
- Create: `tests/live/adapter/harvesters/reddit.live.test.mjs`
- Create: `tests/live/adapter/harvesters/letterboxd.live.test.mjs`
- Create: `tests/live/adapter/harvesters/goodreads.live.test.mjs`
- Create: `tests/live/adapter/harvesters/foursquare.live.test.mjs`

**Step 1: Create all social harvester tests**

All follow same pattern - create each file:

```javascript
// tests/live/adapter/harvesters/lastfm.live.test.mjs
import { runHarvest, daysAgo, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Last.fm Harvester Live', () => {
  it('harvests recent scrobbles', async () => {
    const result = await runHarvest('lastfm');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 60000);

  it('backfills from date when --since provided', async () => {
    const result = await runHarvest('lastfm', { since: daysAgo(7) });
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect(ACCEPTABLE_STATUSES).toContain(result.status);
  }, 90000);
});
```

```javascript
// tests/live/adapter/harvesters/reddit.live.test.mjs
import { runHarvest, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Reddit Harvester Live', () => {
  it('harvests recent activity', async () => {
    const result = await runHarvest('reddit');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 60000);
});
```

```javascript
// tests/live/adapter/harvesters/letterboxd.live.test.mjs
import { runHarvest, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Letterboxd Harvester Live', () => {
  it('harvests movie diary', async () => {
    const result = await runHarvest('letterboxd');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 60000);
});
```

```javascript
// tests/live/adapter/harvesters/goodreads.live.test.mjs
import { runHarvest, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Goodreads Harvester Live', () => {
  it('harvests reading list', async () => {
    const result = await runHarvest('goodreads');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 60000);
});
```

```javascript
// tests/live/adapter/harvesters/foursquare.live.test.mjs
import { runHarvest, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Foursquare Harvester Live', () => {
  it('harvests check-ins', async () => {
    const result = await runHarvest('foursquare');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 60000);
});
```

**Step 2: Commit**

```bash
git add tests/live/adapter/harvesters/lastfm.live.test.mjs \
        tests/live/adapter/harvesters/reddit.live.test.mjs \
        tests/live/adapter/harvesters/letterboxd.live.test.mjs \
        tests/live/adapter/harvesters/goodreads.live.test.mjs \
        tests/live/adapter/harvesters/foursquare.live.test.mjs
git commit -m "test: add social harvester live tests

Add lastfm, reddit, letterboxd, goodreads, foursquare live tests.
Snapshot-based harvesters only have smoke test (no --since backfill).

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Create Harvester Test Files (Batch 3: Communication)

**Files:**
- Create: `tests/live/adapter/harvesters/gmail.live.test.mjs`
- Create: `tests/live/adapter/harvesters/gcal.live.test.mjs`

**Step 1: Create gmail test**

```javascript
// tests/live/adapter/harvesters/gmail.live.test.mjs
import { runHarvest, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Gmail Harvester Live', () => {
  it('harvests inbox', async () => {
    const result = await runHarvest('gmail');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 90000);
});
```

**Step 2: Create gcal test**

```javascript
// tests/live/adapter/harvesters/gcal.live.test.mjs
import { runHarvest, daysAgo, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Google Calendar Harvester Live', () => {
  it('harvests calendar events', async () => {
    const result = await runHarvest('gcal');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 90000);

  it('backfills from date when --since provided', async () => {
    const result = await runHarvest('gcal', { since: daysAgo(14) });
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect(ACCEPTABLE_STATUSES).toContain(result.status);
  }, 120000);
});
```

**Step 3: Commit**

```bash
git add tests/live/adapter/harvesters/gmail.live.test.mjs \
        tests/live/adapter/harvesters/gcal.live.test.mjs
git commit -m "test: add communication harvester live tests

Add gmail, gcal live tests. Gmail is snapshot-based (no backfill),
gcal supports --since for backfill.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Create Harvester Test Files (Batch 4: Finance)

**Files:**
- Create: `tests/live/adapter/harvesters/buxfer.live.test.mjs`
- Create: `tests/live/adapter/harvesters/shopping.live.test.mjs`

**Step 1: Create buxfer test**

```javascript
// tests/live/adapter/harvesters/buxfer.live.test.mjs
import { runHarvest, daysAgo, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Buxfer Harvester Live', () => {
  it('harvests recent transactions', async () => {
    const result = await runHarvest('buxfer');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 60000);

  it('backfills from date when --since provided', async () => {
    const result = await runHarvest('buxfer', { since: daysAgo(30) });
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect(ACCEPTABLE_STATUSES).toContain(result.status);
  }, 90000);
});
```

**Step 2: Create shopping test**

```javascript
// tests/live/adapter/harvesters/shopping.live.test.mjs
import { runHarvest, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Shopping Harvester Live', () => {
  it('harvests receipt emails', async () => {
    const result = await runHarvest('shopping');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 120000);
});
```

**Step 3: Commit**

```bash
git add tests/live/adapter/harvesters/buxfer.live.test.mjs \
        tests/live/adapter/harvesters/shopping.live.test.mjs
git commit -m "test: add finance harvester live tests

Add buxfer, shopping live tests. Buxfer supports --since backfill,
shopping is email-based (no backfill).

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Create Harvester Test Files (Batch 5: Fitness + Other)

**Files:**
- Create: `tests/live/adapter/harvesters/strava.live.test.mjs`
- Create: `tests/live/adapter/harvesters/withings.live.test.mjs`
- Create: `tests/live/adapter/harvesters/weather.live.test.mjs`

**Step 1: Create strava test**

```javascript
// tests/live/adapter/harvesters/strava.live.test.mjs
import { runHarvest, daysAgo, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Strava Harvester Live', () => {
  it('harvests recent activities', async () => {
    const result = await runHarvest('strava');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 90000);

  it('backfills from date when --since provided', async () => {
    const result = await runHarvest('strava', { since: daysAgo(30) });
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect(ACCEPTABLE_STATUSES).toContain(result.status);
  }, 120000);
});
```

**Step 2: Create withings test**

```javascript
// tests/live/adapter/harvesters/withings.live.test.mjs
import { runHarvest, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Withings Harvester Live', () => {
  it('harvests scale measurements', async () => {
    const result = await runHarvest('withings');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 60000);
});
```

**Step 3: Create weather test**

```javascript
// tests/live/adapter/harvesters/weather.live.test.mjs
import { runHarvest, ACCEPTABLE_STATUSES } from './_test-helper.mjs';

describe('Weather Harvester Live', () => {
  it('harvests current weather', async () => {
    const result = await runHarvest('weather');
    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect([...ACCEPTABLE_STATUSES, 'skipped']).toContain(result.status);
  }, 60000);
});
```

**Step 4: Commit**

```bash
git add tests/live/adapter/harvesters/strava.live.test.mjs \
        tests/live/adapter/harvesters/withings.live.test.mjs \
        tests/live/adapter/harvesters/weather.live.test.mjs
git commit -m "test: add fitness and other harvester live tests

Add strava, withings, weather live tests. Strava supports --since
backfill, withings and weather are snapshot-based.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Create Jobs Config Validation Test

**Files:**
- Create: `tests/live/adapter/harvesters/_jobs-config.live.test.mjs`

**Step 1: Create validation test**

```javascript
// tests/live/adapter/harvesters/_jobs-config.live.test.mjs

/**
 * Validates jobs.yml configuration matches registered harvesters.
 */

import path from 'path';
import { configService, initConfigService, dataService } from '#backend/src/0_system/config/index.mjs';
import { createHarvesterServices } from '#backend/src/0_system/bootstrap.mjs';
import { loadYaml, saveYaml } from '#backend/src/0_system/utils/FileIO.mjs';
import axios from 'axios';

const EXPECTED_HARVESTERS = [
  'todoist', 'clickup', 'github',
  'lastfm', 'reddit', 'letterboxd', 'goodreads', 'foursquare',
  'gmail', 'gcal',
  'buxfer', 'shopping',
  'strava', 'withings', 'weather'
];

describe('Cron Jobs Configuration', () => {
  let jobs;
  let registeredHarvesters;

  beforeAll(() => {
    const dataPath = process.env.DAYLIGHT_DATA_PATH;
    if (!dataPath) {
      throw new Error('DAYLIGHT_DATA_PATH required');
    }

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    // Load jobs.yml
    jobs = dataService.system.read('config/jobs') || [];

    // Get registered harvesters
    const io = {
      userLoadFile(username, relativePath) {
        return loadYaml(path.join(dataPath, 'users', username, 'lifelog', relativePath));
      },
      userSaveFile(username, relativePath, content) {
        saveYaml(path.join(dataPath, 'users', username, 'lifelog', relativePath), content);
      },
      householdSaveFile(relativePath, content) {
        saveYaml(path.join(dataPath, 'households', 'default', relativePath), content);
      },
    };

    const { harvesterService } = createHarvesterServices({
      io,
      httpClient: axios,
      configService,
      dataRoot: dataPath,
      logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
    });

    registeredHarvesters = harvesterService.listHarvesters().map(h => h.serviceId);
  });

  it('has a cron job for every expected harvester', () => {
    const jobIds = jobs.map(j => j.id);

    for (const harvester of EXPECTED_HARVESTERS) {
      expect(jobIds).toContain(harvester);
    }
  });

  it('all expected harvesters are registered in bootstrap', () => {
    for (const harvester of EXPECTED_HARVESTERS) {
      expect(registeredHarvesters).toContain(harvester);
    }
  });

  it('all harvester jobs are enabled (not explicitly disabled)', () => {
    for (const harvester of EXPECTED_HARVESTERS) {
      const job = jobs.find(j => j.id === harvester);
      expect(job).toBeDefined();
      expect(job.enabled).not.toBe(false);
    }
  });

  it('all harvester jobs have valid cron schedule', () => {
    for (const harvester of EXPECTED_HARVESTERS) {
      const job = jobs.find(j => j.id === harvester);
      expect(job).toBeDefined();
      expect(job.schedule).toBeDefined();
      expect(job.schedule).toMatch(/^[\d\*\/\-\,\s]+$/);
    }
  });
});
```

**Step 2: Commit**

```bash
git add tests/live/adapter/harvesters/_jobs-config.live.test.mjs
git commit -m "test: add cron jobs.yml validation test

Verifies jobs.yml has entries for all 15 harvesters, all are enabled,
and all are registered in bootstrap.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Update harness.config.mjs

**Files:**
- Modify: `tests/live/adapter/harness.config.mjs`

**Step 1: Update with all 15 harvesters**

```javascript
/**
 * Live test harness configuration
 */

export default {
  defaults: {
    delayBetweenServices: 1000,
    delayBetweenTests: 500,
    timeout: 60000,
  },

  services: {
    // Productivity
    todoist: { timeout: 60000 },
    clickup: { timeout: 60000 },
    github: { timeout: 90000 },

    // Social
    lastfm: { timeout: 60000 },
    reddit: { timeout: 60000 },
    letterboxd: { timeout: 60000 },
    goodreads: { timeout: 60000 },
    foursquare: { timeout: 60000 },

    // Communication
    gmail: { timeout: 90000 },
    gcal: { timeout: 90000 },

    // Finance
    buxfer: { timeout: 60000 },
    shopping: { timeout: 120000 },

    // Fitness
    strava: { timeout: 90000 },
    withings: { timeout: 60000, delayBetweenTests: 2000 },

    // Other
    weather: { timeout: 60000 },
  }
};
```

**Step 2: Commit**

```bash
git add tests/live/adapter/harness.config.mjs
git commit -m "chore: update harness.config.mjs for all 15 harvesters

Remove deprecated infinity/garmin, add all current harvesters with
appropriate timeouts.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 11: Update README.md

**Files:**
- Modify: `tests/live/adapter/README.md`

**Step 1: Rewrite README**

```markdown
# Live Adapter Tests

Live tests for external API harvesters. Uses the same code path as production cron jobs.

## Quick Start

```bash
export DAYLIGHT_DATA_PATH=/path/to/data

# CLI: Run all harvesters (smoke test)
node tests/live/adapter/harvest.mjs

# CLI: Backfill from date
node tests/live/adapter/harvest.mjs --since=2025-01-01

# CLI: Specific harvesters
node tests/live/adapter/harvest.mjs --only=strava,withings

# Jest: Run all tests via harness
node tests/live/adapter/harness.mjs

# Jest: Single harvester
NODE_OPTIONS=--experimental-vm-modules npx jest tests/live/adapter/harvesters/strava.live.test.mjs
```

## Harvesters (15)

| Category | Harvesters | Backfill Support |
|----------|------------|------------------|
| Productivity | todoist, clickup, github | Yes (daysBack) |
| Social | lastfm, reddit, letterboxd, goodreads, foursquare | lastfm only |
| Communication | gmail, gcal | gcal only |
| Finance | buxfer, shopping | buxfer only |
| Fitness | strava, withings | strava only |
| Other | weather | No |

## CLI Options

| Option | Description |
|--------|-------------|
| `--only=a,b` | Run only specified harvesters |
| `--skip=a,b` | Skip specified harvesters |
| `--since=YYYY-MM-DD` | Backfill from date |
| `--dry-run` | Show what would run |
| `--json` | Output JSON for programmatic use |
| `--verbose` | Detailed logging |

## Test Discipline

- **auth_error** = credentials missing or expired → FIX REQUIRED
- **error** = API failure → triggers circuit breaker
- **cooldown** = circuit breaker open → ACCEPTABLE (will retry)
- **pass** = harvest succeeded

Tests fail on `auth_error` or `error`. Tests pass on `pass`, `cooldown`, `rate_limited`.

## Directory Structure

```
tests/live/adapter/
├── harvest.mjs              # CLI tool
├── harness.mjs              # Jest orchestrator
├── harness.config.mjs       # Timeouts
├── test-preconditions.mjs   # Helpers
├── README.md
└── harvesters/
    ├── _test-helper.mjs     # Shared test utilities
    ├── _jobs-config.live.test.mjs  # Cron validation
    ├── todoist.live.test.mjs
    ├── clickup.live.test.mjs
    ├── github.live.test.mjs
    ├── lastfm.live.test.mjs
    ├── reddit.live.test.mjs
    ├── letterboxd.live.test.mjs
    ├── goodreads.live.test.mjs
    ├── foursquare.live.test.mjs
    ├── gmail.live.test.mjs
    ├── gcal.live.test.mjs
    ├── buxfer.live.test.mjs
    ├── shopping.live.test.mjs
    ├── strava.live.test.mjs
    ├── withings.live.test.mjs
    └── weather.live.test.mjs
```
```

**Step 2: Commit**

```bash
git add tests/live/adapter/README.md
git commit -m "docs: update live adapter test README

Complete rewrite with CLI usage, harvester list, test discipline,
and directory structure.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 12: Final Verification

**Step 1: Run CLI dry-run**

```bash
export DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data
node tests/live/adapter/harvest.mjs --dry-run
```

Expected: Lists all 15 harvesters with options.

**Step 2: Run CLI smoke test**

```bash
node tests/live/adapter/harvest.mjs --only=weather
```

Expected: Weather harvester runs and reports pass/fail.

**Step 3: Run Jest harness**

```bash
node tests/live/adapter/harness.mjs --only=harvesters
```

Expected: All 16 test files run (15 harvesters + 1 config validation).

**Step 4: Final commit if any fixes needed**

```bash
git status
# If clean, done. If fixes needed, commit them.
```
