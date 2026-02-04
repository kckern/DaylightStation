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
// Test Execution
// ============================================================================

async function runTestFile(testFile, env, timeout) {
  const { spawn } = await import('child_process');

  const startTime = Date.now();

  return new Promise((resolve) => {
    // Run Jest as subprocess with ESM support and proper env
    const child = spawn('npx', [
      'jest',
      testFile.replace(/\\/g, '/'),
      '--runInBand',
      '--testTimeout', String(timeout),
      '--passWithNoTests=false',
      '--json',
    ], {
      env: {
        ...env,
        NODE_OPTIONS: '--experimental-vm-modules',
      },
      cwd: path.resolve(__dirname, '../..'),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      const duration = Date.now() - startTime;

      // Try to parse JSON output
      let jestResults = null;
      try {
        // Jest JSON output may have non-JSON prefix (validation warnings)
        const jsonStart = stdout.indexOf('{');
        if (jsonStart >= 0) {
          jestResults = JSON.parse(stdout.slice(jsonStart));
        }
      } catch {
        // JSON parse failed - will fall back to text parsing
      }

      // If we got valid Jest results, analyze them
      if (jestResults) {
        const testResult = jestResults.testResults?.[0];

        // No test file results = module failed to load
        if (!testResult) {
          return resolve({
            success: false,
            error: 'No test results - module may have failed to load',
            duration,
          });
        }

        // Zero tests ran = module import failure or empty file
        const totalTests = (testResult.numPassingTests || 0) +
                          (testResult.numFailingTests || 0) +
                          (testResult.numPendingTests || 0);

        if (totalTests === 0) {
          // JSON might be incomplete due to circular references - check stderr first
          const stderrPassMatch = stderr.match(/(\d+)\s+passed/);
          const stderrFailMatch = stderr.match(/(\d+)\s+failed/);

          if (stderrPassMatch || stderrFailMatch) {
            // stderr has real results - JSON was corrupted, skip to stderr parsing below
          } else {
            // Check if the test suite itself failed (module import error)
            const suiteError = testResult.message || jestResults.testResults?.[0]?.failureMessage;
            return resolve({
              success: false,
              error: suiteError || 'No tests ran - check module imports',
              duration,
            });
          }
        } else {
          // JSON has valid test counts - use them
          if (testResult.numFailingTests > 0) {
            const failedTest = testResult.assertionResults?.find(t => t.status === 'failed');
            const error = failedTest?.failureMessages?.join('\n') || testResult.message || 'Test failed';
            return resolve({ success: false, error, duration });
          }

          if (testResult.numPendingTests > 0 && testResult.numPassingTests === 0) {
            return resolve({
              success: true,
              skipped: true,
              reason: 'tests skipped',
              duration,
            });
          }

          // Success
          return resolve({ success: true, duration });
        }
      }

      // No valid JSON - parse stdout/stderr for test results (Jest text output)
      // Jest format: "Tests:       2 failed, 1 passed, 3 total" - numbers can appear in any order
      const passMatch = stderr.match(/(\d+)\s+passed/);
      const failMatch = stderr.match(/(\d+)\s+failed/);
      const totalMatch = stderr.match(/(\d+)\s+total/);

      if (passMatch || failMatch || totalMatch) {
        const passed = parseInt(passMatch?.[1] || '0');
        const failed = parseInt(failMatch?.[1] || '0');

        if (failed > 0) {
          // Extract error message from stderr
          const errorLines = stderr.split('\n').filter(l =>
            l.includes('●') || l.includes('Error') || l.includes('FAIL')
          );
          const error = errorLines.slice(0, 5).join('\n') || 'Test failed';
          return resolve({ success: false, error, duration });
        }

        if (passed > 0) {
          return resolve({ success: true, duration });
        }
      }

      // Check for module import errors in stderr
      if (stderr.includes('Could not locate module') || stderr.includes('Cannot find module')) {
        const errorLines = stderr.split('\n').filter(l =>
          l.includes('Could not locate') || l.includes('Cannot find')
        );
        return resolve({
          success: false,
          error: errorLines.slice(0, 3).join('\n') || 'Module import failed',
          duration,
        });
      }

      // Check exit code
      if (code !== 0) {
        const errorLines = stderr.split('\n').filter(l =>
          l.includes('Error') || l.includes('FAIL')
        );
        const error = errorLines.length > 0
          ? errorLines.slice(0, 3).join('\n')
          : stderr.slice(0, 500) || `Jest exited with code ${code}`;

        return resolve({ success: false, error, duration });
      }

      // Exit 0 - treat as success
      resolve({ success: true, duration });
    });

    child.on('error', (err) => {
      const duration = Date.now() - startTime;
      resolve({ success: false, error: err.message, duration });
    });
  });
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

    if (services.indexOf(service) < services.length - 1) {
      await sleep(service.config.delayBetweenServices);
    }
  }

  const exitCode = logSummary(results);
  process.exit(exitCode);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('Harness error:', err);
    process.exit(1);
  });
}

// ============================================================================
// Exports for testing
// ============================================================================

export { parseArgs, discoverServices, logSummary, SYMBOLS };
export { log, logService, logPass, logFail, logSkip };
