// tests/_infrastructure/harnesses/integrated.harness.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { parseArgs, findTestFiles, runJest, printSummary, COLORS } from './base.harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INTEGRATED_DIR = path.resolve(__dirname, '../../integrated');
const HOUSEHOLD_DEMO = path.resolve(__dirname, '../household-demo');
const TARGETS = ['domain', 'adapter', 'flow', 'contract', 'assembly'];

async function ensureHouseholdDemo() {
  if (!fs.existsSync(HOUSEHOLD_DEMO) || !fs.existsSync(path.join(HOUSEHOLD_DEMO, 'config', 'household.yml'))) {
    console.log(`${COLORS.yellow}household-demo not found. Generating...${COLORS.reset}`);
    const { execSync } = await import('child_process');
    execSync('node tests/_infrastructure/generators/setup-household-demo.mjs', { stdio: 'inherit' });
  }
}

async function main() {
  const args = parseArgs(process.argv);

  // Ensure household-demo exists
  await ensureHouseholdDemo();

  const files = findTestFiles(INTEGRATED_DIR, TARGETS, args);

  if (files.length === 0) {
    console.log(`${COLORS.yellow}No test files found${COLORS.reset}`);
    process.exit(0);
  }

  printSummary('Integrated', files, args);

  if (args.dryRun) {
    console.log('Files that would run:');
    files.forEach(f => console.log(`  ${f}`));
    process.exit(0);
  }

  // Set environment for household-demo
  process.env.DAYLIGHT_DATA_PATH = HOUSEHOLD_DEMO;

  try {
    await runJest(files, {
      coverage: args.coverage,
      watch: args.watch,
      verbose: args.verbose,
      runInBand: true, // Integrated tests may share state
    });
    console.log(`\n${COLORS.green}✓ All integrated tests passed${COLORS.reset}`);
  } catch (error) {
    console.log(`\n${COLORS.red}✗ Some tests failed${COLORS.reset}`);
    process.exit(1);
  }
}

main();
