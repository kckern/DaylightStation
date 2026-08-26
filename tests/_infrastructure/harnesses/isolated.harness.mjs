// tests/_infrastructure/harnesses/isolated.harness.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import {
  parseArgs,
  findTestFiles,
  findColocatedTestFiles,
  runJest,
  printSummary,
  COLORS,
} from './base.harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ISOLATED_DIR = path.resolve(__dirname, '../../isolated');
const ROOT_DIR = path.resolve(__dirname, '../../..');
const FRONTEND_SRC_DIR = path.resolve(ROOT_DIR, 'frontend/src');
// Every directory under tests/isolated/ MUST appear in one of these lists.
// A directory in neither is silently never run by `npm run test:isolated` —
// which is exactly how tests/isolated/e2e/ (the School lifecycle proof) rotted
// to 16-of-25 red over three months without anyone noticing, and how a live
// product bug shipped behind it.
//
// Two traps worth knowing about when adding a directory:
//   - Near-duplicate names. `adapter`/`adapters` and `application`/`applications`
//     both exist. A test dropped in the wrong one runs only if BOTH are listed.
//   - Runner choice is not cosmetic. A file importing `@jest/globals` throws
//     under vitest ("Do not import `@jest/globals` outside of the Jest test
//     environment") and a file importing from 'vitest' will not run under Jest.
//     Put the directory where its files' imports say it belongs.
//
// If you add a directory under tests/isolated/, add it here in the same commit.
const JEST_TARGETS = [
  'domain', 'adapter', 'flow', 'contract', 'assembly', 'application', 'api',
  'nutribot',
];
const VITEST_TARGETS = [
  'modules',
  'adapters', 'agents', 'applications', 'composition', 'e2e', 'hardware',
  'hooks', 'lifeplan', 'notification', 'observability', 'rendering', 'screen-framework',
  'services', 'system', 'tooling', 'ui',
];
// Pseudo-target for the frontend/src/ colocated tree. Allows --only=frontend
// to scope a run to just the colocated specs.
const VITEST_COLOCATED_TARGET = 'frontend';
const TARGETS = [...JEST_TARGETS, ...VITEST_TARGETS, VITEST_COLOCATED_TARGET];

function runVitest(files) {
  return new Promise((resolve, reject) => {
    const vitestBin = path.join(ROOT_DIR, 'frontend/node_modules/.bin/vitest');
    const configPath = path.join(ROOT_DIR, 'vitest.config.mjs');
    const child = spawn(vitestBin, ['run', '--config', configPath, ...files], {
      stdio: 'inherit',
      cwd: ROOT_DIR,
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Vitest exited with code ${code}`));
    });
  });
}

/** Flatten the vitest-side inputs without losing the colocated walk. */
function allVitestFilesRaw(vitestFiles, colocatedFiles) {
  return [...vitestFiles, ...colocatedFiles];
}

/**
 * Decide each file's runner from its own imports.
 *
 * A file importing `@jest/globals` throws under vitest; a file importing from
 * 'vitest' never registers a test under Jest. Both failures are LOAD failures,
 * which read as a wall of red rather than as "this file is in the wrong list" —
 * so they get normalised as baseline instead of fixed.
 *
 * Files importing neither keep whichever list they were discovered in.
 */
function routeByImports(jestFiles, vitestFiles) {
  const JEST_IMPORT   = /from\s+['"]@jest\/globals['"]|require\(\s*['"]@jest\/globals['"]\s*\)/;
  const VITEST_IMPORT = /from\s+['"]vitest['"]|require\(\s*['"]vitest['"]\s*\)/;

  const jest = [];
  const vitest = [];
  const moved = [];

  const classify = (file, discoveredIn) => {
    let src = '';
    try {
      src = fs.readFileSync(file, 'utf8');
    } catch {
      // Unreadable is not this function's problem — let the runner report it.
      (discoveredIn === 'jest' ? jest : vitest).push(file);
      return;
    }
    const wantsJest = JEST_IMPORT.test(src);
    const wantsVitest = VITEST_IMPORT.test(src);

    // Importing BOTH is a genuine authoring error that no routing can resolve.
    // Say so loudly rather than silently picking one and half-running it.
    if (wantsJest && wantsVitest) {
      console.log(`${COLORS.yellow}WARNING: imports BOTH jest and vitest — ${path.relative(ROOT_DIR, file)}${COLORS.reset}`);
      (discoveredIn === 'jest' ? jest : vitest).push(file);
      return;
    }

    // Neither import: the file uses bare globals, so nothing in it demands a
    // runner. Default to vitest — the repo's actual standard. Measured
    // 2026-08-25 across tests/isolated/: 546 files import vitest and ZERO
    // import @jest/globals, so Jest owns nothing here by choice, only by an
    // accident of which directory list a file landed in. Five such files were
    // failing under Jest on ESM interop alone (`require is not defined` from
    // `import.meta.url` in the production code they cover) while passing
    // cleanly under vitest.
    //
    // Jest is still reachable, but only on an explicit `@jest/globals` import.
    const target = wantsJest ? 'jest' : wantsVitest ? 'vitest' : 'vitest';
    if (target !== discoveredIn) moved.push({ file, from: discoveredIn, to: target });
    (target === 'jest' ? jest : vitest).push(file);
  };

  jestFiles.forEach((f) => classify(f, 'jest'));
  vitestFiles.forEach((f) => classify(f, 'vitest'));
  return { jest, vitest, moved };
}

async function main() {
  const args = parseArgs(process.argv);

  const jestArgs   = args.only ? { ...args, only: args.only.filter(t => JEST_TARGETS.includes(t))   } : args;
  const vitestArgs = args.only ? { ...args, only: args.only.filter(t => VITEST_TARGETS.includes(t)) } : args;

  // Run the frontend colocated walk when no --only is supplied, or when the
  // user explicitly asks for `frontend`.
  const runColocated = !args.only || args.only.includes(VITEST_COLOCATED_TARGET);

  const jestFiles   = findTestFiles(ISOLATED_DIR, JEST_TARGETS,   jestArgs);
  // Vitest targets may include both `.test.mjs` and `.test.jsx` specs (the
  // existing tests/isolated/modules/Fitness/*.test.jsx files were never
  // matched by the old finder). Pass extensions explicitly here.
  const vitestFiles = findTestFiles(
    ISOLATED_DIR,
    VITEST_TARGETS,
    vitestArgs,
    { extensions: ['.test.mjs', '.test.jsx', '.test.js'] }
  );
  // Colocated frontend specs (live alongside the source they cover, e.g.
  // frontend/src/hooks/fitness/CycleStateMachine.test.js). These never lived
  // under tests/isolated/, so they need a separate walk.
  const colocatedFiles = runColocated
    ? findColocatedTestFiles(FRONTEND_SRC_DIR, args)
    : [];
  // ---- Re-route by what each file IMPORTS, not by which directory it sits in.
  //
  // The lists above are per-DIRECTORY; the runner mismatch is per-FILE. Every
  // file under `domain/` and `application/` imports from 'vitest' while both are
  // JEST targets, so ~550 suites failed to LOAD on every run. That mass of
  // load errors was treated as baseline noise, and real failures hid inside it:
  // a defect that made EVERY lesson card on EVERY agenda fail validateDocument()
  // sat there for months, caught by 14 tests that never got to run.
  //
  // A directory listing cannot notice that. The import can, so classify on it
  // and let the directory lists be the fallback for files that import neither.
  const { jest: reJest, vitest: reVitest, moved } = routeByImports(jestFiles, allVitestFilesRaw(vitestFiles, colocatedFiles));
  if (moved.length) {
    console.log(`${COLORS.yellow}Re-routed ${moved.length} file(s) to the runner their imports require:${COLORS.reset}`);
    for (const m of moved.slice(0, 10)) console.log(`  ${m.to.padEnd(6)} ← ${path.relative(ROOT_DIR, m.file)}`);
    if (moved.length > 10) console.log(`  …and ${moved.length - 10} more`);
  }
  const allVitestFiles = reVitest;
  const jestFilesRouted = reJest;
  const allFiles = [...jestFilesRouted, ...allVitestFiles];

  if (allFiles.length === 0) {
    console.log(`${COLORS.yellow}No test files found${COLORS.reset}`);
    process.exit(0);
  }

  printSummary('Isolated', allFiles, args);

  if (args.dryRun) {
    console.log('Files that would run:');
    allFiles.forEach(f => console.log(`  ${f}`));
    process.exit(0);
  }

  let jestPassed = true;
  let vitestPassed = true;

  if (jestFilesRouted.length > 0) {
    try {
      await runJest(jestFilesRouted, {
        coverage: args.coverage,
        watch: args.watch,
        verbose: args.verbose,
      });
    } catch {
      jestPassed = false;
    }
  }

  if (allVitestFiles.length > 0) {
    try {
      await runVitest(allVitestFiles);
    } catch {
      vitestPassed = false;
    }
  }

  if (jestPassed && vitestPassed) {
    console.log(`\n${COLORS.green}✓ All isolated tests passed${COLORS.reset}`);
  } else {
    console.log(`\n${COLORS.red}✗ Some tests failed${COLORS.reset}`);
    process.exit(1);
  }
}

main();
