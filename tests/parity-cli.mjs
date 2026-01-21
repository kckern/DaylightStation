#!/usr/bin/env node
// tests/parity-cli.mjs
/**
 * Parity Test CLI
 *
 * Usage:
 *   node tests/parity-cli.mjs --update              # Capture baselines from legacy
 *   node tests/parity-cli.mjs --update --type=plex  # Capture single type
 *   node tests/parity-cli.mjs --snapshot            # Test DDD against baselines
 *   node tests/parity-cli.mjs --live                # Compare legacy vs DDD live
 *   node tests/parity-cli.mjs --list                # List all baselines
 *   node tests/parity-cli.mjs --show plex/663035    # Show single baseline
 */

import { fileURLToPath } from 'url';
import { loadFixtures, dedupeFixtures, groupByType } from './lib/fixture-loader.mjs';
import { buildUrl, getSupportedTypes } from './lib/endpoint-map.mjs';
import {
  loadConfig,
  normalizeResponse,
  compareResponses,
  loadBaseline,
  saveBaseline
} from './lib/parity-runner.mjs';

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(argv) {
  const args = {
    mode: null,
    type: null,
    id: null,
    bail: false,
    verbose: false,
    show: null
  };

  for (const arg of argv.slice(2)) {
    if (arg === '--update') args.mode = 'update';
    else if (arg === '--snapshot') args.mode = 'snapshot';
    else if (arg === '--live') args.mode = 'live';
    else if (arg === '--list') args.mode = 'list';
    else if (arg.startsWith('--type=')) args.type = arg.split('=')[1];
    else if (arg.startsWith('--id=')) args.id = arg.split('=')[1];
    else if (arg === '--bail') args.bail = true;
    else if (arg === '--verbose') args.verbose = true;
    else if (arg.startsWith('--show')) {
      args.mode = 'show';
      args.show = argv[argv.indexOf(arg) + 1];
    }
  }

  return args;
}

// ============================================================================
// HTTP Fetching
// ============================================================================

async function fetchEndpoint(url, baseUrl) {
  const config = loadConfig();
  const fullUrl = `${baseUrl}${url}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.server.timeout_ms);

  try {
    const response = await fetch(fullUrl, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });

    clearTimeout(timeoutId);

    const data = await response.json().catch(() => null);
    return {
      success: response.ok,
      status: response.status,
      data,
      error: response.ok ? null : `HTTP ${response.status}`
    };
  } catch (err) {
    clearTimeout(timeoutId);
    return {
      success: false,
      status: 0,
      error: err.name === 'AbortError' ? 'Timeout' : err.message
    };
  }
}

// ============================================================================
// Output Formatting
// ============================================================================

const SYMBOLS = {
  pass: '\x1b[32m✓\x1b[0m',
  fail: '\x1b[31m✗\x1b[0m',
  skip: '\x1b[33m⊘\x1b[0m',
  type: '\x1b[36m▶\x1b[0m',
};

function log(msg) { console.log(msg); }
function logType(name, count) { log(`\n${SYMBOLS.type} ${name} (${count} items)`); }
function logPass(label) { log(`  ${SYMBOLS.pass} ${label}`); }
function logFail(label, reason) { log(`  ${SYMBOLS.fail} ${label} - ${reason}`); }
function logSkip(label, reason) { log(`  ${SYMBOLS.skip} ${label} - ${reason}`); }

// ============================================================================
// Commands
// ============================================================================

async function runUpdate(args) {
  const config = loadConfig();
  const baseUrl = config.server.default_url;

  log('\n═══════════════════════════════════════════════════');
  log('  PARITY BASELINE CAPTURE');
  log('═══════════════════════════════════════════════════');
  log(`  Server: ${baseUrl}`);
  log(`  Mode: Capture from LEGACY endpoints\n`);

  const types = args.type ? [args.type] : getSupportedTypes();
  const fixtures = await loadFixtures({ types });
  const unique = dedupeFixtures(fixtures);
  const grouped = groupByType(unique);

  let captured = 0, failed = 0, skipped = 0;

  for (const [type, items] of Object.entries(grouped)) {
    logType(type, items.length);

    for (const item of items) {
      const url = buildUrl(type, item.value, 'legacy');
      const result = await fetchEndpoint(url, baseUrl);

      if (!result.success) {
        logFail(item.label, result.error);
        failed++;
        continue;
      }

      const normalized = normalizeResponse(result.data);
      saveBaseline(type, item.value, normalized, {
        legacy_endpoint: url,
        source_label: item.label,
        source_uid: item.uid
      });

      logPass(item.label);
      captured++;
    }
  }

  log('\n───────────────────────────────────────────────────');
  log(`  Captured: ${captured}  Failed: ${failed}  Skipped: ${skipped}`);
  log('═══════════════════════════════════════════════════\n');

  return failed > 0 ? 1 : 0;
}

async function runSnapshot(args) {
  const config = loadConfig();
  const baseUrl = config.server.default_url;

  log('\n═══════════════════════════════════════════════════');
  log('  PARITY SNAPSHOT TEST');
  log('═══════════════════════════════════════════════════');
  log(`  Server: ${baseUrl}`);
  log(`  Mode: Test DDD against baselines\n`);

  const types = args.type ? [args.type] : getSupportedTypes();
  const fixtures = await loadFixtures({ types });
  const unique = dedupeFixtures(fixtures);
  const grouped = groupByType(unique);

  let passed = 0, failed = 0, skipped = 0;
  const failures = [];

  for (const [type, items] of Object.entries(grouped)) {
    logType(type, items.length);

    for (const item of items) {
      const baseline = loadBaseline(type, item.value);
      if (!baseline) {
        logSkip(item.label, 'no baseline');
        skipped++;
        continue;
      }

      const url = buildUrl(type, item.value, 'ddd');
      const result = await fetchEndpoint(url, baseUrl);

      if (!result.success) {
        logFail(item.label, result.error);
        failed++;
        failures.push({ type, item, error: result.error });
        if (args.bail) break;
        continue;
      }

      const comparison = compareResponses(
        baseline.response.body,
        result.data,
        baseline
      );

      if (comparison.match) {
        logPass(item.label);
        passed++;
      } else {
        const diffSummary = comparison.differences.slice(0, 3)
          .map(d => d.path).join(', ');
        logFail(item.label, `differs: ${diffSummary}`);
        failed++;
        failures.push({ type, item, differences: comparison.differences });
        if (args.bail) break;
      }
    }

    if (args.bail && failed > 0) break;
  }

  log('\n───────────────────────────────────────────────────');
  log(`  Passed: ${passed}  Failed: ${failed}  Skipped: ${skipped}`);
  log('═══════════════════════════════════════════════════\n');

  if (args.verbose && failures.length > 0) {
    log('FAILURES:\n');
    for (const f of failures) {
      log(`  ${f.type}/${f.item.value}:`);
      if (f.error) {
        log(`    Error: ${f.error}`);
      } else if (f.differences) {
        for (const d of f.differences.slice(0, 5)) {
          log(`    ${d.path}: expected=${JSON.stringify(d.baseline)?.slice(0, 40)} got=${JSON.stringify(d.current)?.slice(0, 40)}`);
        }
      }
      log('');
    }
  }

  return failed > 0 ? 1 : 0;
}

async function runLive(args) {
  const config = loadConfig();
  const baseUrl = config.server.default_url;

  log('\n═══════════════════════════════════════════════════');
  log('  PARITY LIVE COMPARISON');
  log('═══════════════════════════════════════════════════');
  log(`  Server: ${baseUrl}`);
  log(`  Mode: Compare LEGACY vs DDD live\n`);

  const types = args.type ? [args.type] : getSupportedTypes();
  const fixtures = await loadFixtures({ types });
  const unique = dedupeFixtures(fixtures);
  const grouped = groupByType(unique);

  let passed = 0, failed = 0, skipped = 0;

  for (const [type, items] of Object.entries(grouped)) {
    logType(type, items.length);

    for (const item of items) {
      const legacyUrl = buildUrl(type, item.value, 'legacy');
      const dddUrl = buildUrl(type, item.value, 'ddd');

      const [legacyResult, dddResult] = await Promise.all([
        fetchEndpoint(legacyUrl, baseUrl),
        fetchEndpoint(dddUrl, baseUrl)
      ]);

      if (!legacyResult.success && !dddResult.success) {
        logSkip(item.label, 'both failed');
        skipped++;
        continue;
      }

      if (!legacyResult.success) {
        logFail(item.label, `legacy: ${legacyResult.error}`);
        failed++;
        continue;
      }

      if (!dddResult.success) {
        logFail(item.label, `ddd: ${dddResult.error}`);
        failed++;
        continue;
      }

      const comparison = compareResponses(legacyResult.data, dddResult.data);

      if (comparison.match) {
        logPass(item.label);
        passed++;
      } else {
        const diffCount = comparison.differences.length;
        logFail(item.label, `${diffCount} differences`);
        failed++;
        if (args.bail) break;
      }
    }

    if (args.bail && failed > 0) break;
  }

  log('\n───────────────────────────────────────────────────');
  log(`  Passed: ${passed}  Failed: ${failed}  Skipped: ${skipped}`);
  log('═══════════════════════════════════════════════════\n');

  return failed > 0 ? 1 : 0;
}

async function runList() {
  const types = getSupportedTypes();
  const fixtures = await loadFixtures();
  const unique = dedupeFixtures(fixtures);
  const grouped = groupByType(unique);

  log('\n═══════════════════════════════════════════════════');
  log('  PARITY BASELINES');
  log('═══════════════════════════════════════════════════\n');

  for (const type of types) {
    const items = grouped[type] || [];
    const withBaseline = items.filter(i => loadBaseline(type, i.value));
    log(`  ${type.padEnd(12)} ${withBaseline.length}/${items.length} baselines`);
  }

  log('\n═══════════════════════════════════════════════════\n');
  return 0;
}

async function runShow(args) {
  if (!args.show) {
    log('Usage: --show <type>/<id>');
    return 1;
  }

  const [type, ...idParts] = args.show.split('/');
  const id = idParts.join('/');
  const baseline = loadBaseline(type, id);

  if (!baseline) {
    log(`No baseline found for ${type}/${id}`);
    return 1;
  }

  console.log(JSON.stringify(baseline, null, 2));
  return 0;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs(process.argv);

  if (!args.mode) {
    log(`
Parity Test CLI

Usage:
  node tests/parity-cli.mjs --update              Capture baselines from legacy
  node tests/parity-cli.mjs --update --type=plex  Capture single type
  node tests/parity-cli.mjs --snapshot            Test DDD against baselines
  node tests/parity-cli.mjs --snapshot --bail     Stop on first failure
  node tests/parity-cli.mjs --live                Compare legacy vs DDD live
  node tests/parity-cli.mjs --list                List all baselines
  node tests/parity-cli.mjs --show plex/663035    Show single baseline

Options:
  --type=TYPE    Filter to single input type
  --bail         Stop on first failure
  --verbose      Show detailed failure info
`);
    return 0;
  }

  switch (args.mode) {
    case 'update': return runUpdate(args);
    case 'snapshot': return runSnapshot(args);
    case 'live': return runLive(args);
    case 'list': return runList();
    case 'show': return runShow(args);
    default:
      log(`Unknown mode: ${args.mode}`);
      return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(code => process.exit(code)).catch(err => {
    console.error('CLI error:', err);
    process.exit(1);
  });
}

export { parseArgs, runUpdate, runSnapshot, runLive, runList };
