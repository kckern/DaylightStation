// tests/_infrastructure/harnesses/live.harness.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { parseArgs, findTestFiles, runJest, printSummary, COLORS } from './base.harness.mjs';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIVE_DIR = path.resolve(__dirname, '../../live');
const ENV_CONFIG = path.resolve(__dirname, '../environments.yml');
const TARGETS = ['api', 'adapter', 'flow'];

function loadEnvironments() {
  if (fs.existsSync(ENV_CONFIG)) {
    return yaml.load(fs.readFileSync(ENV_CONFIG, 'utf8'));
  }
  return {
    dev: { url: 'http://localhost:3112', data: 'household-demo' },
    test: { url: 'http://localhost:3113', data: 'household-demo', docker: 'daylight-test' },
    prod: { url: 'http://daylight.local:3111', data: 'real', readonly: true },
  };
}

async function checkBackend(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${url}/api/v1/health`, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    clearTimeout(timeoutId);
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const envs = loadEnvironments();
  const env = envs[args.env];

  if (!env) {
    console.error(`${COLORS.red}Unknown environment: ${args.env}${COLORS.reset}`);
    console.log(`Available: ${Object.keys(envs).join(', ')}`);
    process.exit(1);
  }

  // Check backend is running
  console.log(`Checking backend at ${env.url}...`);
  const isUp = await checkBackend(env.url);
  if (!isUp) {
    console.error(`${COLORS.red}Backend not responding at ${env.url}${COLORS.reset}`);
    console.log(`Start with: npm run dev (for dev) or scripts/test-env.sh start (for test)`);
    process.exit(1);
  }
  console.log(`${COLORS.green}✓ Backend ready${COLORS.reset}`);

  const files = findTestFiles(LIVE_DIR, TARGETS, args);

  if (files.length === 0) {
    console.log(`${COLORS.yellow}No test files found${COLORS.reset}`);
    process.exit(0);
  }

  printSummary(`Live (${args.env})`, files, args);

  if (args.dryRun) {
    console.log('Files that would run:');
    files.forEach(f => console.log(`  ${f}`));
    process.exit(0);
  }

  // Set environment variables
  process.env.TEST_BASE_URL = env.url;
  process.env.TEST_ENV = args.env;
  process.env.TEST_READONLY = env.readonly ? 'true' : 'false';

  try {
    // Use Playwright for flow tests, Jest for api/adapter
    const flowFiles = files.filter(f => f.includes('/flow/'));
    const otherFiles = files.filter(f => !f.includes('/flow/'));

    if (otherFiles.length > 0) {
      await runJest(otherFiles, {
        coverage: args.coverage,
        verbose: args.verbose,
        runInBand: true,
      });
    }

    if (flowFiles.length > 0) {
      const { execSync } = await import('child_process');
      const playwrightArgs = flowFiles.join(' ');
      execSync(`npx playwright test ${playwrightArgs}`, { stdio: 'inherit' });
    }

    console.log(`\n${COLORS.green}✓ All live tests passed${COLORS.reset}`);
  } catch (error) {
    console.log(`\n${COLORS.red}✗ Some tests failed${COLORS.reset}`);
    process.exit(1);
  }
}

main();
