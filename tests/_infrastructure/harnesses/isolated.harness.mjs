// tests/_infrastructure/harnesses/isolated.harness.mjs
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, findTestFiles, runJest, printSummary, COLORS } from './base.harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ISOLATED_DIR = path.resolve(__dirname, '../../isolated');
const TARGETS = ['domain', 'adapter', 'flow', 'contract', 'assembly'];

async function main() {
  const args = parseArgs(process.argv);
  const files = findTestFiles(ISOLATED_DIR, TARGETS, args);

  if (files.length === 0) {
    console.log(`${COLORS.yellow}No test files found${COLORS.reset}`);
    process.exit(0);
  }

  printSummary('Isolated', files, args);

  if (args.dryRun) {
    console.log('Files that would run:');
    files.forEach(f => console.log(`  ${f}`));
    process.exit(0);
  }

  try {
    await runJest(files, {
      coverage: args.coverage,
      watch: args.watch,
      verbose: args.verbose,
    });
    console.log(`\n${COLORS.green}✓ All isolated tests passed${COLORS.reset}`);
  } catch (error) {
    console.log(`\n${COLORS.red}✗ Some tests failed${COLORS.reset}`);
    process.exit(1);
  }
}

main();
