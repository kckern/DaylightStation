#!/usr/bin/env node

/**
 * Unit Test Harness
 *
 * Runs unit tests and writes results to tests/output/results.unit.yml
 *
 * Usage:
 *   node tests/unit/harness.mjs [options]
 *
 * Options:
 *   --only=adapters,domains   Run only specified folders
 *   --skip=voice-memo         Skip specified folders
 *   --pattern=Plex            Only run tests matching pattern
 *   --verbose                 Show full output
 *   --dry-run                 Show what would run
 *   --watch                   Watch mode
 *   --coverage                Generate coverage report
 */

import { spawn } from 'child_process';
import { readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../..');
const outputDir = join(__dirname, '../output');
const outputFile = join(outputDir, 'results.unit.yml');

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(argv) {
  const args = {
    only: null,
    skip: [],
    pattern: null,
    verbose: false,
    dryRun: false,
    watch: false,
    coverage: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--only=')) {
      args.only = arg.split('=')[1].split(',').map(s => s.trim());
    } else if (arg.startsWith('--skip=')) {
      args.skip = arg.split('=')[1].split(',').map(s => s.trim());
    } else if (arg.startsWith('--pattern=')) {
      args.pattern = arg.split('=')[1];
    } else if (arg === '--verbose' || arg === '-v') {
      args.verbose = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--watch' || arg === '-w') {
      args.watch = true;
    } else if (arg === '--coverage') {
      args.coverage = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  return args;
}

function printUsage() {
  console.log(`
Unit Test Harness

Usage:
  node tests/unit/harness.mjs [options]

Options:
  --only=folders    Run only specified folders (comma-separated)
  --skip=folders    Skip specified folders (comma-separated)
  --pattern=text    Only run tests matching pattern
  --verbose, -v     Show full output
  --dry-run         Show what would run
  --watch, -w       Watch mode
  --coverage        Generate coverage report
  --help, -h        Show this help

Output:
  Results written to tests/output/results.unit.yml

Examples:
  node tests/unit/harness.mjs
  node tests/unit/harness.mjs --only=adapters,domains
  node tests/unit/harness.mjs --pattern=PlexAdapter
`);
}

// ============================================================================
// Test Discovery
// ============================================================================

function discoverFolders() {
  const suiteDir = join(__dirname, 'suite');
  try {
    return readdirSync(suiteDir)
      .filter(name => {
        const fullPath = join(suiteDir, name);
        return statSync(fullPath).isDirectory() && !name.startsWith('.');
      });
  } catch {
    return [];
  }
}

function filterFolders(folders, args) {
  let result = folders;

  if (args.only) {
    result = result.filter(f => args.only.includes(f));
  }

  if (args.skip.length > 0) {
    result = result.filter(f => !args.skip.includes(f));
  }

  return result;
}

// ============================================================================
// Results Writer
// ============================================================================

function writeResults(results) {
  mkdirSync(outputDir, { recursive: true });

  const yaml = `# Unit Test Results
# Generated: ${new Date().toISOString()}
# Harness: tests/unit/harness.mjs

run:
  timestamp: "${new Date().toISOString()}"
  type: unit
  duration_ms: ${results.duration}
  exit_code: ${results.exitCode}

summary:
  suites_total: ${results.suitesTotal}
  suites_passed: ${results.suitesPassed}
  suites_failed: ${results.suitesFailed}
  tests_total: ${results.testsTotal}
  tests_passed: ${results.testsPassed}
  tests_failed: ${results.testsFailed}
  tests_skipped: ${results.testsSkipped}

folders:
${results.folders.map(f => `  - ${f}`).join('\n')}

${results.pattern ? `pattern: "${results.pattern}"` : ''}
`;

  writeFileSync(outputFile, yaml);
  console.log(`\nResults written to: ${outputFile}`);
}

function parseJestOutput(output) {
  const results = {
    suitesTotal: 0,
    suitesPassed: 0,
    suitesFailed: 0,
    testsTotal: 0,
    testsPassed: 0,
    testsFailed: 0,
    testsSkipped: 0,
  };

  // Parse Test Suites - try multiple formats
  // Format: "Test Suites: X failed, Y skipped, Z passed, W of N total" or "W total"
  let suitesMatch = output.match(/Test Suites:\s*(\d+)\s*failed,\s*(\d+)\s*skipped,\s*(\d+)\s*passed,\s*(\d+)(?:\s*of\s*\d+)?\s*total/i);
  if (suitesMatch) {
    results.suitesFailed = parseInt(suitesMatch[1]) || 0;
    results.suitesPassed = parseInt(suitesMatch[3]) || 0;
    results.suitesTotal = parseInt(suitesMatch[4]) || 0;
  } else {
    // Format: "Test Suites: X failed, Y passed, Z total" (no skipped)
    suitesMatch = output.match(/Test Suites:\s*(\d+)\s*failed,\s*(\d+)\s*passed,\s*(\d+)(?:\s*of\s*\d+)?\s*total/i);
    if (suitesMatch) {
      results.suitesFailed = parseInt(suitesMatch[1]) || 0;
      results.suitesPassed = parseInt(suitesMatch[2]) || 0;
      results.suitesTotal = parseInt(suitesMatch[3]) || 0;
    } else {
      // Format: "Test Suites: X passed, Y total" (all passing)
      suitesMatch = output.match(/Test Suites:\s*(\d+)\s*passed,\s*(\d+)(?:\s*of\s*\d+)?\s*total/i);
      if (suitesMatch) {
        results.suitesPassed = parseInt(suitesMatch[1]) || 0;
        results.suitesTotal = parseInt(suitesMatch[2]) || 0;
      }
    }
  }

  // Parse Tests - try multiple formats
  // Format: "Tests: X failed, Y skipped, Z passed, W total" or "W of N total"
  let testsMatch = output.match(/Tests:\s*(\d+)\s*failed,\s*(\d+)\s*skipped,\s*(\d+)\s*passed,\s*(\d+)(?:\s*of\s*\d+)?\s*total/i);
  if (testsMatch) {
    results.testsFailed = parseInt(testsMatch[1]) || 0;
    results.testsSkipped = parseInt(testsMatch[2]) || 0;
    results.testsPassed = parseInt(testsMatch[3]) || 0;
    results.testsTotal = parseInt(testsMatch[4]) || 0;
  } else {
    // Format: "Tests: X failed, Y passed, Z total" (no skipped)
    testsMatch = output.match(/Tests:\s*(\d+)\s*failed,\s*(\d+)\s*passed,\s*(\d+)(?:\s*of\s*\d+)?\s*total/i);
    if (testsMatch) {
      results.testsFailed = parseInt(testsMatch[1]) || 0;
      results.testsPassed = parseInt(testsMatch[2]) || 0;
      results.testsTotal = parseInt(testsMatch[3]) || 0;
    } else {
      // Format: "Tests: X passed, Y total" (all passing)
      testsMatch = output.match(/Tests:\s*(\d+)\s*passed,\s*(\d+)(?:\s*of\s*\d+)?\s*total/i);
      if (testsMatch) {
        results.testsPassed = parseInt(testsMatch[1]) || 0;
        results.testsTotal = parseInt(testsMatch[2]) || 0;
      }
    }
  }

  return results;
}

// ============================================================================
// Test Runner
// ============================================================================

function buildJestArgs(args, folders) {
  const jestArgs = [
    '--testPathPattern=tests/unit/suite',
    '--passWithNoTests',
  ];

  // Add folder filters
  if (folders.length > 0 && folders.length < discoverFolders().length) {
    const pattern = folders.map(f => `tests/unit/suite/${f}`).join('|');
    jestArgs[0] = `--testPathPattern=${pattern}`;
  }

  // Add pattern filter
  if (args.pattern) {
    jestArgs.push(`--testNamePattern=${args.pattern}`);
  }

  // Add options
  if (args.verbose) {
    jestArgs.push('--verbose');
  }

  if (args.watch) {
    jestArgs.push('--watch');
  }

  if (args.coverage) {
    jestArgs.push('--coverage');
  }

  return jestArgs;
}

async function runTests(args) {
  const allFolders = discoverFolders();
  const folders = filterFolders(allFolders, args);

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                    UNIT TEST HARNESS                       ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();

  if (folders.length === 0) {
    console.log('No test folders to run.');
    return 0;
  }

  console.log(`Folders: ${folders.join(', ')}`);
  if (args.pattern) {
    console.log(`Pattern: ${args.pattern}`);
  }
  console.log();

  const jestArgs = buildJestArgs(args, folders);

  if (args.dryRun) {
    console.log('[DRY RUN] Would run:');
    console.log(`  npx jest ${jestArgs.join(' ')}`);
    return 0;
  }

  const startTime = Date.now();
  let output = '';

  return new Promise((resolve) => {
    const child = spawn('npx', ['jest', ...jestArgs], {
      cwd: rootDir,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
    });

    child.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stderr.write(text);
    });

    child.on('close', (code) => {
      const duration = Date.now() - startTime;
      const parsed = parseJestOutput(output);

      writeResults({
        ...parsed,
        duration,
        exitCode: code || 0,
        folders,
        pattern: args.pattern,
      });

      resolve(code);
    });
  });
}

// ============================================================================
// Main
// ============================================================================

const args = parseArgs(process.argv);
runTests(args).then(code => {
  process.exit(code || 0);
});
