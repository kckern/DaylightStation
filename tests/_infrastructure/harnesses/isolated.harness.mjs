// tests/_infrastructure/harnesses/isolated.harness.mjs
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
const JEST_TARGETS = ['domain', 'adapter', 'flow', 'contract', 'assembly', 'application', 'api'];
const VITEST_TARGETS = ['modules'];
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
  const allVitestFiles = [...vitestFiles, ...colocatedFiles];
  const allFiles = [...jestFiles, ...allVitestFiles];

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

  if (jestFiles.length > 0) {
    try {
      await runJest(jestFiles, {
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
