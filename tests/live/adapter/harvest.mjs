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
import { configService, initConfigService, userDataService, dataService } from '#backend/src/0_system/config/index.mjs';
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
    // Shopping uses days parameter
    shopping: { days: daysBack },
    // Snapshot-based harvesters ignore --since
    letterboxd: {},
    goodreads: {},
    foursquare: {},
    reddit: {},
    gmail: {},
    withings: {},
    weather: {},
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
      userDataService,
      dataService,
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
