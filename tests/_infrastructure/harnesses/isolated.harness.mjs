// tests/_infrastructure/harnesses/isolated.harness.mjs
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { parseArgs, findTestFiles, runJest, printSummary, COLORS } from './base.harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ISOLATED_DIR = path.resolve(__dirname, '../../isolated');
const ROOT_DIR = path.resolve(__dirname, '../../..');
const JEST_TARGETS = ['domain', 'adapter', 'flow', 'contract', 'assembly'];
const VITEST_TARGETS = ['modules'];
const TARGETS = [...JEST_TARGETS, ...VITEST_TARGETS];

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

  const jestFiles = findTestFiles(ISOLATED_DIR, JEST_TARGETS, args);
  const vitestFiles = findTestFiles(ISOLATED_DIR, VITEST_TARGETS, args);
  const allFiles = [...jestFiles, ...vitestFiles];

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

  if (vitestFiles.length > 0) {
    try {
      await runVitest(vitestFiles);
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
