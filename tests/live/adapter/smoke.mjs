#!/usr/bin/env node

/**
 * Harvester Smoke Test
 *
 * Minimal credential and connectivity test for all harvesters.
 * Does NOT do full harvests - just verifies auth and API access.
 *
 * Usage:
 *   node tests/integration/external/smoke.mjs [options]
 *
 * Options:
 *   --only=strava,github    Run only specified harvesters
 *   --skip=gmail,withings   Skip specified harvesters
 *   --verbose               Show detailed output
 *   --json                  Output results as JSON
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import { createHarvesterServices } from '#backend/src/0_system/bootstrap.mjs';
import { loadYaml, saveYaml } from '#backend/src/0_system/utils/FileIO.mjs';
import axios from 'axios';
import { getDataPath } from '../../_lib/configHelper.mjs';

/**
 * Create io object compatible with createHarvesterServices
 * Uses DDD FileIO utilities instead of legacy io.mjs
 */
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
      // Use default household for now (matches legacy behavior)
      const filePath = path.join(dataDir, 'households', 'default', relativePath);
      saveYaml(filePath, content);
    },
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Configuration
// ============================================================================

/**
 * Minimal harvest options per service (1 day, 1 page, etc.)
 */
const SMOKE_OPTIONS = {
  strava: { daysBack: 1 },
  github: { daysBack: 1, maxRepos: 1 },
  clickup: { daysBack: 1 },
  todoist: { daysBack: 1 },
  gcal: { weeksAhead: 1, weeksBack: 1 },
  lastfm: { maxPages: 1 },
  foursquare: {},
  reddit: { limit: 5 },
  letterboxd: {},
  goodreads: {},
  gmail: {},
  withings: {},
  weather: {},
  shopping: {},
  buxfer: { daysBack: 1 },
};

/**
 * Timeout per harvester (ms)
 */
const TIMEOUTS = {
  default: 30000,
  strava: 45000,
  gmail: 45000,
  gcal: 45000,
  shopping: 60000,
};

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(argv) {
  const args = {
    only: null,
    skip: [],
    verbose: false,
    json: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--only=')) {
      args.only = arg.split('=')[1].split(',').map(s => s.trim());
    } else if (arg.startsWith('--skip=')) {
      args.skip = arg.split('=')[1].split(',').map(s => s.trim());
    } else if (arg === '--verbose') {
      args.verbose = true;
    } else if (arg === '--json') {
      args.json = true;
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
// Smoke Test Runner
// ============================================================================

async function runSmokeTest(harvesterService, serviceId, username, args) {
  const startTime = Date.now();
  const options = SMOKE_OPTIONS[serviceId] || {};
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
    const status = harvesterService.getStatus(serviceId);
    if (status.state === 'open') {
      result.status = 'cooldown';
      result.error = `Circuit breaker open - ${status.remainingMins || '?'} mins remaining`;
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
      if (harvestResult.reason === 'cooldown') {
        result.status = 'cooldown';
      } else {
        result.status = 'skipped';
      }
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

    // Clean up error message
    result.error = result.error
      .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
      .replace(/token[=:]\s*[^\s&]+/gi, 'token=[REDACTED]')
      .substring(0, 200);
  }

  return result;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs(process.argv);

  // Initialize config
  const dataPath = getDataPath();
  if (!dataPath) {
    console.error('Error: Could not determine data path from .env');
    process.exit(1);
  }

  if (!configService.isReady()) {
    initConfigService(dataPath);
  }

  const username = configService.getHeadOfHousehold();

  log('', args);
  log('═'.repeat(60), args);
  log(' HARVESTER SMOKE TEST', args);
  log('═'.repeat(60), args);
  log(` User: ${username}`, args);
  log(` Data: ${dataPath}`, args);
  log('', args);

  // Create harvester services
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

  // Get list of harvesters to test
  let harvesters = harvesterService.listHarvesters().map(h => h.serviceId);

  if (args.only) {
    harvesters = harvesters.filter(id => args.only.includes(id));
  }
  if (args.skip.length > 0) {
    harvesters = harvesters.filter(id => !args.skip.includes(id));
  }

  log(` Testing: ${harvesters.length} harvesters`, args);
  log('─'.repeat(60), args);

  // Run smoke tests
  const results = [];

  for (const serviceId of harvesters) {
    if (!args.json) {
      process.stdout.write(` ${serviceId.padEnd(15)} `);
    }

    const result = await runSmokeTest(harvesterService, serviceId, username, args);
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

    // Small delay between tests to avoid rate limiting
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
  log(' SUMMARY', args);
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

// Run
main().catch(err => {
  console.error('Smoke test error:', err);
  process.exit(1);
});
