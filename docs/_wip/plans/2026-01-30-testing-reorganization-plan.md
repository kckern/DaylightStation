# Testing Reorganization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize tests/ directory according to the testing strategy design (isolated/integrated/live × domain/adapter/flow/contract/assembly/api), with reliable dev server management and test environment infrastructure.

**Architecture:** Three-tier test isolation (isolated/integrated/live) with six test targets. Reliable port management via lock files and process tracking. Secondary Docker deployment for isolated test environment.

**Tech Stack:** Jest, Playwright, Node.js test harnesses, Docker Compose, shell scripts for port management

---

## Phase 0: Dev Server & Port Management (CRITICAL)

### Task 0.1: Create Port Lock Manager

**Files:**
- Create: `scripts/port-manager.mjs`
- Create: `scripts/dev-server.sh`

**Step 1: Create port lock manager**

```javascript
// scripts/port-manager.mjs
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const LOCK_DIR = '/tmp/daylight-locks';
const PORTS = {
  dev: 3112,
  test: 3113,
  docker: 3111
};

export function ensureLockDir() {
  if (!fs.existsSync(LOCK_DIR)) {
    fs.mkdirSync(LOCK_DIR, { recursive: true });
  }
}

export function getLockFile(port) {
  return path.join(LOCK_DIR, `port-${port}.lock`);
}

export function isPortInUse(port) {
  try {
    const result = execSync(`lsof -i :${port} -t 2>/dev/null || true`, { encoding: 'utf8' });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

export function getPortOwner(port) {
  const lockFile = getLockFile(port);
  if (fs.existsSync(lockFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      // Check if process still exists
      try {
        process.kill(data.pid, 0);
        return data;
      } catch {
        // Process dead, clean up stale lock
        fs.unlinkSync(lockFile);
        return null;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function acquirePort(port, purpose) {
  ensureLockDir();
  const lockFile = getLockFile(port);

  // Check for existing lock
  const owner = getPortOwner(port);
  if (owner) {
    throw new Error(`Port ${port} locked by PID ${owner.pid} (${owner.purpose}) since ${owner.timestamp}`);
  }

  // Check if port is actually in use (orphaned process)
  if (isPortInUse(port)) {
    throw new Error(`Port ${port} in use by unknown process. Run: lsof -i :${port}`);
  }

  // Acquire lock
  const lockData = {
    pid: process.pid,
    purpose,
    timestamp: new Date().toISOString(),
    port
  };
  fs.writeFileSync(lockFile, JSON.stringify(lockData, null, 2));

  // Register cleanup
  const cleanup = () => {
    try { fs.unlinkSync(lockFile); } catch {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  return lockData;
}

export function releasePort(port) {
  const lockFile = getLockFile(port);
  try {
    fs.unlinkSync(lockFile);
    return true;
  } catch {
    return false;
  }
}

export function killPortProcess(port) {
  try {
    const pids = execSync(`lsof -i :${port} -t 2>/dev/null || true`, { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);

    for (const pid of pids) {
      try {
        process.kill(parseInt(pid), 'SIGTERM');
        console.log(`Killed PID ${pid} on port ${port}`);
      } catch {}
    }

    releasePort(port);
    return pids.length > 0;
  } catch {
    return false;
  }
}

export function forceCleanPort(port) {
  killPortProcess(port);
  releasePort(port);

  // Wait for port to be free
  let attempts = 0;
  while (isPortInUse(port) && attempts < 10) {
    execSync('sleep 0.5');
    attempts++;
  }

  return !isPortInUse(port);
}

// CLI interface
if (process.argv[1].endsWith('port-manager.mjs')) {
  const [,, command, portArg] = process.argv;
  const port = parseInt(portArg) || PORTS.dev;

  switch (command) {
    case 'status':
      console.log(`Port ${port}: ${isPortInUse(port) ? 'IN USE' : 'FREE'}`);
      const owner = getPortOwner(port);
      if (owner) console.log(`  Locked by: PID ${owner.pid} (${owner.purpose})`);
      break;
    case 'kill':
      forceCleanPort(port);
      console.log(`Port ${port} cleaned`);
      break;
    case 'clean-all':
      Object.values(PORTS).forEach(p => {
        if (p !== PORTS.docker) forceCleanPort(p);
      });
      console.log('All dev/test ports cleaned');
      break;
    default:
      console.log('Usage: node port-manager.mjs [status|kill|clean-all] [port]');
  }
}
```

**Step 2: Create dev server wrapper script**

```bash
#!/bin/bash
# scripts/dev-server.sh
# Reliable dev server with proper cleanup

set -e

PORT=${1:-3112}
LOCK_FILE="/tmp/daylight-locks/port-${PORT}.lock"

# Cleanup function
cleanup() {
    echo "Cleaning up..."
    rm -f "$LOCK_FILE"
    # Kill any child processes
    jobs -p | xargs -r kill 2>/dev/null || true
    exit 0
}

trap cleanup EXIT INT TERM

# Check if port is in use
if lsof -i :$PORT -t >/dev/null 2>&1; then
    echo "ERROR: Port $PORT already in use"
    echo "Run: node scripts/port-manager.mjs kill $PORT"
    exit 1
fi

# Acquire lock
mkdir -p /tmp/daylight-locks
echo "{\"pid\": $$, \"purpose\": \"dev-server\", \"timestamp\": \"$(date -Iseconds)\", \"port\": $PORT}" > "$LOCK_FILE"

echo "Starting dev server on port $PORT (PID $$)"
echo "Lock file: $LOCK_FILE"

# Start the server
PORT=$PORT npm run dev

# Cleanup happens via trap
```

**Step 3: Update package.json scripts**

```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:backend\" \"npm run dev:frontend\"",
    "dev:backend": "nodemon backend/index.js",
    "dev:clean": "node scripts/port-manager.mjs clean-all && npm run dev",
    "dev:kill": "node scripts/port-manager.mjs kill 3112",
    "test:clean-ports": "node scripts/port-manager.mjs clean-all",
    "pretest": "npm run test:clean-ports"
  }
}
```

**Step 4: Verify port manager works**

```bash
node scripts/port-manager.mjs status 3112
# Expected: Port 3112: FREE
```

**Step 5: Commit**

```bash
git add scripts/port-manager.mjs scripts/dev-server.sh
git commit -m "feat(dev): add port lock manager for reliable dev server cleanup"
```

---

### Task 0.2: Create Test Environment Docker Compose

**Files:**
- Create: `docker-compose.test.yml`
- Create: `scripts/test-env.sh`

**Step 1: Create test environment Docker Compose**

```yaml
# docker-compose.test.yml
# Secondary deployment for isolated test environment

version: '3.8'

services:
  daylight-test:
    build: .
    container_name: daylight-test
    ports:
      - "3113:3111"  # Map test port to internal port
    environment:
      - NODE_ENV=test
      - DAYLIGHT_DATA_PATH=/data
      - DAYLIGHT_MEDIA_PATH=/media
    volumes:
      - ${TEST_DATA_PATH:-./tests/_infrastructure/household-demo}:/data:ro
      - ${TEST_MEDIA_PATH:-./tests/_fixtures/media}:/media:ro
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3111/api/v1/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    networks:
      - daylight-test-network

networks:
  daylight-test-network:
    driver: bridge
```

**Step 2: Create test environment management script**

```bash
#!/bin/bash
# scripts/test-env.sh
# Manage test Docker environment

set -e

COMPOSE_FILE="docker-compose.test.yml"
CONTAINER_NAME="daylight-test"

case "$1" in
  start)
    echo "Starting test environment..."
    docker-compose -f $COMPOSE_FILE up -d
    echo "Waiting for health check..."
    timeout 60 bash -c 'until curl -sf http://localhost:3113/api/v1/health; do sleep 2; done'
    echo "Test environment ready at http://localhost:3113"
    ;;
  stop)
    echo "Stopping test environment..."
    docker-compose -f $COMPOSE_FILE down
    ;;
  restart)
    $0 stop
    $0 start
    ;;
  status)
    docker-compose -f $COMPOSE_FILE ps
    ;;
  logs)
    docker-compose -f $COMPOSE_FILE logs -f
    ;;
  reset)
    echo "Resetting test data..."
    docker-compose -f $COMPOSE_FILE down -v
    npm run test:reset-data
    $0 start
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs|reset}"
    exit 1
    ;;
esac
```

**Step 3: Commit**

```bash
git add docker-compose.test.yml scripts/test-env.sh
git commit -m "feat(test): add Docker test environment with isolated data"
```

---

## Phase 1: Create New Directory Structure

### Task 1.1: Create Directory Skeleton

**Step 1: Create all directories**

```bash
# Create new structure
mkdir -p tests/isolated/{domain,adapter,flow,contract,assembly}
mkdir -p tests/integrated/{domain,adapter,flow,contract,assembly}
mkdir -p tests/live/{api,adapter,flow}
mkdir -p tests/_infrastructure/{generators/harvesters,generators/realtime,household-demo,harnesses,baselines}
mkdir -p tests/_lib

# Create subdirectories for domains
for domain in finance fitness content messaging journaling nutrition core media cost; do
  mkdir -p tests/isolated/domain/$domain/{entities,services,ports}
  mkdir -p tests/integrated/domain/$domain
done

# Create subdirectories for adapters
for adapter in content ai finance fitness harvester messaging persistence proxy telegram home-automation nutribot withings filesystem; do
  mkdir -p tests/isolated/adapter/$adapter
done

# Create subdirectories for live/adapter (by category)
for category in fitness finance calendar email social productivity media movies music reading weather location development health content nutrition; do
  mkdir -p tests/live/adapter/$category
done

# Create subdirectories for flows
for flow in journalist homebot finance fitness content player music tv ui; do
  mkdir -p tests/isolated/flow/$flow
  mkdir -p tests/integrated/flow/$flow
  mkdir -p tests/live/flow/$flow
done

# Create subdirectories for assembly
for assembly in infrastructure system config layout logging player voice-memo bootstrap routing scheduling; do
  mkdir -p tests/isolated/assembly/$assembly
  mkdir -p tests/integrated/assembly/$assembly
done

# Create api subdirectories
mkdir -p tests/live/api/{content,finance,fitness,proxy,lifelog,parity}
mkdir -p tests/integrated/contract/{applications/ports,content/ports,adapters}
```

**Step 2: Create placeholder README files**

```bash
# Root README
cat > tests/README.md << 'EOF'
# DaylightStation Test Suite

## Structure

```
tests/
├── isolated/      # No I/O, pure logic (fast)
├── integrated/    # Real I/O, household-demo data
├── live/          # Full stack, real services
├── _infrastructure/  # Generators, harnesses, baselines
├── _lib/          # Shared utilities
└── _fixtures/     # Test data files
```

## Running Tests

```bash
# All isolated tests (fast)
npm run test:isolated

# All integrated tests (requires household-demo)
npm run test:integrated

# All live tests (requires running backend)
npm run test:live

# Specific target
npm run test:isolated -- --only=domain
npm run test:live -- --only=api
```

## Environments

```bash
# Dev server (default)
npm run test:live

# Test Docker environment
npm run test:live -- --env=test

# Production (read-only)
npm run test:live -- --env=prod
```
EOF
```

**Step 3: Verify structure**

```bash
find tests -type d | head -50
# Should show new structure
```

**Step 4: Commit**

```bash
git add tests/
git commit -m "feat(tests): create new directory structure skeleton"
```

---

### Task 1.2: Create Harnesses

**Files:**
- Create: `tests/_infrastructure/harnesses/isolated.harness.mjs`
- Create: `tests/_infrastructure/harnesses/integrated.harness.mjs`
- Create: `tests/_infrastructure/harnesses/live.harness.mjs`
- Create: `tests/_infrastructure/harnesses/base.harness.mjs`

**Step 1: Create base harness with shared functionality**

```javascript
// tests/_infrastructure/harnesses/base.harness.mjs
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

export function parseArgs(argv) {
  const args = {
    only: null,
    skip: null,
    pattern: null,
    verbose: false,
    dryRun: false,
    watch: false,
    coverage: false,
    env: 'dev',
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--only=')) args.only = arg.split('=')[1].split(',');
    else if (arg.startsWith('--skip=')) args.skip = arg.split('=')[1].split(',');
    else if (arg.startsWith('--pattern=')) args.pattern = arg.split('=')[1];
    else if (arg.startsWith('--env=')) args.env = arg.split('=')[1];
    else if (arg === '-v' || arg === '--verbose') args.verbose = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '-w' || arg === '--watch') args.watch = true;
    else if (arg === '--coverage') args.coverage = true;
  }

  return args;
}

export function findTestFiles(baseDir, targets, args) {
  const files = [];

  const searchDirs = args.only || targets;
  const skipDirs = new Set(args.skip || []);

  for (const target of searchDirs) {
    if (skipDirs.has(target)) continue;

    const targetDir = path.join(baseDir, target);
    if (!fs.existsSync(targetDir)) continue;

    const walk = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.name.endsWith('.test.mjs')) {
          if (!args.pattern || fullPath.includes(args.pattern)) {
            files.push(fullPath);
          }
        }
      }
    };
    walk(targetDir);
  }

  return files;
}

export function runJest(files, options = {}) {
  return new Promise((resolve, reject) => {
    const jestArgs = [
      '--experimental-vm-modules',
      'npx', 'jest',
      ...files,
      '--colors',
    ];

    if (options.coverage) jestArgs.push('--coverage');
    if (options.watch) jestArgs.push('--watch');
    if (options.verbose) jestArgs.push('--verbose');
    if (options.runInBand) jestArgs.push('--runInBand');

    const child = spawn('node', jestArgs, {
      stdio: 'inherit',
      env: { ...process.env, NODE_OPTIONS: '--experimental-vm-modules' },
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Jest exited with code ${code}`));
    });
  });
}

export function printSummary(label, files, args) {
  console.log(`\n${COLORS.cyan}═══════════════════════════════════════════════════${COLORS.reset}`);
  console.log(`${COLORS.cyan}  ${label} Test Suite${COLORS.reset}`);
  console.log(`${COLORS.cyan}═══════════════════════════════════════════════════${COLORS.reset}`);
  console.log(`  Files: ${files.length}`);
  if (args.only) console.log(`  Only: ${args.only.join(', ')}`);
  if (args.skip) console.log(`  Skip: ${args.skip.join(', ')}`);
  if (args.pattern) console.log(`  Pattern: ${args.pattern}`);
  console.log(`${COLORS.cyan}═══════════════════════════════════════════════════${COLORS.reset}\n`);
}
```

**Step 2: Create isolated harness**

```javascript
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
```

**Step 3: Create integrated harness**

```javascript
// tests/_infrastructure/harnesses/integrated.harness.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { parseArgs, findTestFiles, runJest, printSummary, COLORS } from './base.harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INTEGRATED_DIR = path.resolve(__dirname, '../../integrated');
const HOUSEHOLD_DEMO = path.resolve(__dirname, '../household-demo');
const TARGETS = ['domain', 'adapter', 'flow', 'contract', 'assembly'];

function ensureHouseholdDemo() {
  if (!fs.existsSync(HOUSEHOLD_DEMO) || !fs.existsSync(path.join(HOUSEHOLD_DEMO, 'household.yml'))) {
    console.log(`${COLORS.yellow}household-demo not found. Generating...${COLORS.reset}`);
    const { execSync } = await import('child_process');
    execSync('node tests/_infrastructure/generators/setup-household-demo.mjs', { stdio: 'inherit' });
  }
}

async function main() {
  const args = parseArgs(process.argv);

  // Ensure household-demo exists
  ensureHouseholdDemo();

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
```

**Step 4: Create live harness**

```javascript
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
  try {
    const response = await fetch(`${url}/api/v1/health`, { timeout: 5000 });
    return response.ok;
  } catch {
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
```

**Step 5: Commit**

```bash
git add tests/_infrastructure/harnesses/
git commit -m "feat(tests): add harnesses for isolated/integrated/live test tiers"
```

---

### Task 1.3: Create Environment Configuration

**Files:**
- Create: `tests/_infrastructure/environments.yml`

**Step 1: Create environments config**

```yaml
# tests/_infrastructure/environments.yml
# Test environment configuration

dev:
  url: http://localhost:3112
  data: household-demo
  description: Local development server

test:
  url: http://localhost:3113
  data: household-demo
  docker: daylight-test
  description: Isolated Docker test environment

prod:
  url: http://daylight.local:3111
  data: real
  readonly: true
  description: Production server (read-only tests only)
```

**Step 2: Commit**

```bash
git add tests/_infrastructure/environments.yml
git commit -m "feat(tests): add environment configuration"
```

---

## Phase 2: Migrate Existing Tests

### Task 2.1: Move Shared Utilities to _lib

**Step 1: Move library files**

```bash
# Move test utilities
mv tests/lib/testDataService.mjs tests/_lib/
mv tests/lib/testDataMatchers.mjs tests/_lib/
mv tests/lib/configHelper.mjs tests/_lib/
mv tests/lib/parity-runner.mjs tests/_lib/
mv tests/lib/fixture-loader.mjs tests/_lib/
mv tests/lib/endpoint-map.mjs tests/_lib/

# Move API test utilities
mv tests/integration/suite/api/_utils/* tests/_lib/api-test-utils/

# Move other utilities
mv tests/unit/suite/layout/testUtils.mjs tests/_lib/layout-test-utils.mjs
mv tests/runtime/suite/fitness-session/fitness-test-utils.mjs tests/_lib/fitness-test-utils.mjs

# Create index
cat > tests/_lib/index.mjs << 'EOF'
export * from './testDataService.mjs';
export * from './testDataMatchers.mjs';
export * from './configHelper.mjs';
EOF
```

**Step 2: Commit**

```bash
git add tests/_lib/ tests/lib/
git commit -m "refactor(tests): move shared utilities to _lib"
```

---

### Task 2.2: Migrate Domain Tests (Isolated)

**Step 1: Move finance domain tests**

```bash
mkdir -p tests/isolated/domain/finance/{entities,services}
mv tests/unit/suite/domains/finance/entities/*.test.mjs tests/isolated/domain/finance/entities/
mv tests/unit/suite/domains/finance/services/*.test.mjs tests/isolated/domain/finance/services/
```

**Step 2: Move fitness domain tests**

```bash
mkdir -p tests/isolated/domain/fitness/{entities,services,ports}
mv tests/unit/suite/domains/fitness/entities/*.test.mjs tests/isolated/domain/fitness/entities/
mv tests/unit/suite/domains/fitness/services/*.test.mjs tests/isolated/domain/fitness/services/
mv tests/unit/suite/domains/fitness/ports/*.test.mjs tests/isolated/domain/fitness/ports/
```

**Step 3: Move other domain tests**

```bash
# Messaging
mkdir -p tests/isolated/domain/messaging/{entities,services,ports}
mv tests/unit/suite/domains/messaging/entities/*.test.mjs tests/isolated/domain/messaging/entities/
mv tests/unit/suite/domains/messaging/services/*.test.mjs tests/isolated/domain/messaging/services/
mv tests/unit/suite/domains/messaging/ports/*.test.mjs tests/isolated/domain/messaging/ports/

# Journaling
mkdir -p tests/isolated/domain/journaling/{entities,services}
mv tests/unit/suite/domains/journaling/entities/*.test.mjs tests/isolated/domain/journaling/entities/
mv tests/unit/suite/domains/journaling/services/*.test.mjs tests/isolated/domain/journaling/services/

# Nutrition
mkdir -p tests/isolated/domain/nutrition/services
mv tests/unit/suite/domains/nutrition/services/*.test.mjs tests/isolated/domain/nutrition/services/

# Content
mkdir -p tests/isolated/domain/content/{entities,services,capabilities}
mv tests/unit/suite/content/entities/*.test.mjs tests/isolated/domain/content/entities/
mv tests/unit/suite/content/services/*.test.mjs tests/isolated/domain/content/services/
mv tests/unit/suite/content/capabilities/*.test.mjs tests/isolated/domain/content/capabilities/
mv tests/unit/suite/domains/content/services/*.test.mjs tests/isolated/domain/content/services/ 2>/dev/null || true

# Core
mkdir -p tests/isolated/domain/core
mv tests/unit/suite/domains/core/*.test.mjs tests/isolated/domain/core/
```

**Step 4: Commit**

```bash
git add tests/isolated/domain/ tests/unit/suite/domains/ tests/unit/suite/content/
git commit -m "refactor(tests): migrate domain tests to isolated/domain"
```

---

### Task 2.3: Migrate Adapter Tests (Isolated)

**Step 1: Move adapter tests**

```bash
# Content adapters
mkdir -p tests/isolated/adapter/content/{folder,local-content,media/plex,media/filesystem}
mv tests/unit/suite/adapters/content/PlexAdapter.test.mjs tests/isolated/adapter/content/
mv tests/unit/suite/adapters/content/FilesystemAdapter.test.mjs tests/isolated/adapter/content/
mv tests/unit/suite/adapters/content/folder/*.test.mjs tests/isolated/adapter/content/folder/
mv tests/unit/suite/adapters/content/local-content/*.test.mjs tests/isolated/adapter/content/local-content/
mv tests/unit/suite/adapters/content/media/plex/*.test.mjs tests/isolated/adapter/content/media/plex/
mv tests/unit/suite/adapters/content/media/filesystem/*.test.mjs tests/isolated/adapter/content/media/filesystem/

# AI adapters
mkdir -p tests/isolated/adapter/ai
mv tests/unit/suite/adapters/ai/*.test.mjs tests/isolated/adapter/ai/

# Harvester adapters
mkdir -p tests/isolated/adapter/harvester/{finance,fitness}
mv tests/unit/suite/adapters/harvester/finance/*.test.mjs tests/isolated/adapter/harvester/finance/
mv tests/unit/suite/adapters/harvester/fitness/*.test.mjs tests/isolated/adapter/harvester/fitness/

# Persistence adapters
mkdir -p tests/isolated/adapter/persistence/yaml
mv tests/unit/suite/adapters/persistence/*.test.mjs tests/isolated/adapter/persistence/
mv tests/unit/suite/adapters/persistence/yaml/*.test.mjs tests/isolated/adapter/persistence/yaml/

# Other adapters
mkdir -p tests/isolated/adapter/{finance,fitness,messaging,proxy,telegram,home-automation,filesystem,nutribot}
mv tests/unit/suite/adapters/finance/*.test.mjs tests/isolated/adapter/finance/
mv tests/unit/suite/adapters/fitness/*.test.mjs tests/isolated/adapter/fitness/
mv tests/unit/suite/adapters/messaging/*.test.mjs tests/isolated/adapter/messaging/
mv tests/unit/suite/adapters/proxy/*.test.mjs tests/isolated/adapter/proxy/
mv tests/unit/suite/adapters/telegram/*.test.mjs tests/isolated/adapter/telegram/
mv tests/unit/suite/adapters/home-automation/**/*.test.mjs tests/isolated/adapter/home-automation/
mv tests/unit/suite/adapters/filesystem-cover-art.test.mjs tests/isolated/adapter/filesystem/cover-art.test.mjs
mv tests/unit/suite/nutribot/*.test.mjs tests/isolated/adapter/nutribot/
```

**Step 2: Commit**

```bash
git add tests/isolated/adapter/ tests/unit/suite/adapters/ tests/unit/suite/nutribot/
git commit -m "refactor(tests): migrate adapter tests to isolated/adapter"
```

---

### Task 2.4: Migrate Flow Tests (Isolated)

**Step 1: Move application flow tests**

```bash
# Journalist flows
mkdir -p tests/isolated/flow/journalist/usecases
mv tests/unit/suite/applications/journalist/*.test.mjs tests/isolated/flow/journalist/
mv tests/unit/suite/applications/journalist/usecases/*.test.mjs tests/isolated/flow/journalist/usecases/
mv tests/unit/suite/applications/journalist/constants/*.test.mjs tests/isolated/flow/journalist/

# Homebot flows
mkdir -p tests/isolated/flow/homebot
mv tests/unit/suite/applications/homebot/*.test.mjs tests/isolated/flow/homebot/

# Finance flows
mkdir -p tests/isolated/flow/finance
mv tests/unit/suite/applications/finance/*.test.mjs tests/isolated/flow/finance/
```

**Step 2: Commit**

```bash
git add tests/isolated/flow/ tests/unit/suite/applications/
git commit -m "refactor(tests): migrate application tests to isolated/flow"
```

---

### Task 2.5: Migrate Contract Tests (Isolated)

**Step 1: Move port/interface tests**

```bash
# Application ports
mkdir -p tests/isolated/contract/applications/ports
mv tests/unit/suite/applications/shared/ports/*.test.mjs tests/isolated/contract/applications/ports/

# Content ports
mkdir -p tests/isolated/contract/content/ports
mv tests/unit/suite/content/ports/*.test.mjs tests/isolated/contract/content/ports/
```

**Step 2: Commit**

```bash
git add tests/isolated/contract/
git commit -m "refactor(tests): migrate contract tests to isolated/contract"
```

---

### Task 2.6: Migrate Assembly Tests (Isolated)

**Step 1: Move infrastructure and system tests**

```bash
# Infrastructure
mkdir -p tests/isolated/assembly/infrastructure/{eventbus/adapters,logging,routing,config,proxy,scheduling,services,users}
mv tests/unit/suite/infrastructure/eventbus/*.test.mjs tests/isolated/assembly/infrastructure/eventbus/
mv tests/unit/suite/infrastructure/eventbus/adapters/*.test.mjs tests/isolated/assembly/infrastructure/eventbus/adapters/
mv tests/unit/suite/infrastructure/logging/*.test.mjs tests/isolated/assembly/infrastructure/logging/
mv tests/unit/suite/infrastructure/routing/*.test.mjs tests/isolated/assembly/infrastructure/routing/
mv tests/unit/suite/infrastructure/config/*.test.mjs tests/isolated/assembly/infrastructure/config/
mv tests/unit/suite/infrastructure/proxy/*.test.mjs tests/isolated/assembly/infrastructure/proxy/
mv tests/unit/suite/infrastructure/scheduling/*.test.mjs tests/isolated/assembly/infrastructure/scheduling/
mv tests/unit/suite/infrastructure/services/*.test.mjs tests/isolated/assembly/infrastructure/services/
mv tests/unit/suite/infrastructure/users/*.test.mjs tests/isolated/assembly/infrastructure/users/
mv tests/unit/suite/infrastructure/*.test.mjs tests/isolated/assembly/infrastructure/

# System
mkdir -p tests/isolated/assembly/system/{registries,config}
mv tests/unit/suite/system/registries/*.test.mjs tests/isolated/assembly/system/registries/
mv tests/unit/suite/system/config/*.test.mjs tests/isolated/assembly/system/config/

# Config
mkdir -p tests/isolated/assembly/config
mv tests/unit/suite/config/*.test.mjs tests/isolated/assembly/config/

# Named assembly tests
mv tests/unit/suite/*.assembly.test.mjs tests/isolated/assembly/

# Other assembly-like tests
mkdir -p tests/isolated/assembly/{layout,logging,player,voice-memo}
mv tests/unit/suite/layout/*.test.mjs tests/isolated/assembly/layout/
mv tests/unit/suite/logging/*.test.mjs tests/isolated/assembly/logging/
mv tests/unit/suite/player/*.test.mjs tests/isolated/assembly/player/
mv tests/unit/suite/voice-memo/*.test.mjs tests/isolated/assembly/voice-memo/
```

**Step 2: Commit**

```bash
git add tests/isolated/assembly/ tests/unit/suite/
git commit -m "refactor(tests): migrate assembly tests to isolated/assembly"
```

---

### Task 2.7: Migrate API Tests (Isolated)

**Step 1: Move API unit tests**

```bash
mkdir -p tests/isolated/api/{routers,middleware,shims}
mv tests/unit/suite/api/routers/*.test.mjs tests/isolated/api/routers/
mv tests/unit/suite/api/middleware/*.test.mjs tests/isolated/api/middleware/
mv tests/unit/suite/api/shims/*.test.mjs tests/isolated/api/shims/
```

**Step 2: Commit**

```bash
git add tests/isolated/api/ tests/unit/suite/api/
git commit -m "refactor(tests): migrate API unit tests to isolated/api"
```

---

### Task 2.8: Migrate Integration Suite (Integrated)

**Step 1: Move integration API tests**

```bash
mkdir -p tests/integrated/api/{content,finance,fitness,proxy,lifelog,parity}

# Content API tests
mv tests/integration/suite/api/content-router.api.test.mjs tests/integrated/api/content/router.test.mjs
mv tests/integration/suite/api/content.test.mjs tests/integrated/api/content/
mv tests/integration/suite/api/plex.api.test.mjs tests/integrated/api/content/plex.test.mjs
mv tests/integration/suite/api/filesystem.api.test.mjs tests/integrated/api/content/filesystem.test.mjs
mv tests/integration/suite/api/folder.api.test.mjs tests/integrated/api/content/folder.test.mjs
mv tests/integration/suite/api/local-content.api.test.mjs tests/integrated/api/content/local-content.test.mjs
mv tests/integration/suite/api/list-router.api.test.mjs tests/integrated/api/content/list-router.test.mjs
mv tests/integration/suite/api/play-router.api.test.mjs tests/integrated/api/content/play-router.test.mjs
mv tests/integration/suite/api/_smoke.plex.test.mjs tests/integrated/api/content/smoke-plex.test.mjs

# Proxy API tests
mv tests/integration/suite/api/proxy-router.api.test.mjs tests/integrated/api/proxy/router.test.mjs
mv tests/integration/suite/api/proxy.test.mjs tests/integrated/api/proxy/

# Finance/Fitness API tests
mv tests/integration/suite/api/finance-parity.test.mjs tests/integrated/api/finance/parity.test.mjs
mv tests/integration/suite/api/fitness-parity.test.mjs tests/integrated/api/fitness/parity.test.mjs
mv tests/integration/suite/api/fitness-plex-parity.test.mjs tests/integrated/api/fitness/plex-parity.test.mjs

# Lifelog
mv tests/integration/suite/api/lifelog.test.mjs tests/integrated/api/lifelog/

# Parity tests
mv tests/integration/suite/api/parity.test.mjs tests/integrated/api/parity/
mv tests/integration/suite/api/parity-data-driven.test.mjs tests/integrated/api/parity/data-driven.test.mjs
mv tests/integration/suite/api/prod-v1-parity.test.mjs tests/integrated/api/parity/prod-v1.test.mjs
mv tests/integration/suite/api/v1-regression.test.mjs tests/integrated/api/parity/v1-regression.test.mjs
mv tests/integration/suite/api/testDataService.integration.test.mjs tests/integrated/assembly/testDataService.test.mjs
```

**Step 2: Move other integration suite tests**

```bash
# Assembly tests
mkdir -p tests/integrated/assembly/{bootstrap,routing}
mv tests/integration/suite/bootstrap/*.test.mjs tests/integrated/assembly/bootstrap/
mv tests/integration/suite/routing/*.test.mjs tests/integrated/assembly/routing/
mv tests/integration/suite/scheduling.test.mjs tests/integrated/assembly/

# Flow tests
mkdir -p tests/integrated/flow/{content,journalist}
mv tests/integration/suite/content-domain/*.test.mjs tests/integrated/flow/content/
mv tests/integration/suite/journalist-flows.test.mjs tests/integrated/flow/journalist/flows.test.mjs
```

**Step 3: Commit**

```bash
git add tests/integrated/ tests/integration/suite/
git commit -m "refactor(tests): migrate integration suite to integrated/"
```

---

### Task 2.9: Migrate External Live Tests (Live/Adapter)

**Step 1: Move external service tests**

```bash
# By category
mv tests/integration/external/strava/*.test.mjs tests/live/adapter/fitness/strava.test.mjs
mv tests/integration/external/withings/*.test.mjs tests/live/adapter/fitness/withings.test.mjs
mv tests/integration/external/fitness/*.test.mjs tests/live/adapter/fitness/

mv tests/integration/external/budget/*.test.mjs tests/live/adapter/finance/budget.test.mjs
mv tests/integration/external/shopping/*.test.mjs tests/live/adapter/finance/shopping.test.mjs
mv tests/integration/external/infinity/*.test.mjs tests/live/adapter/finance/infinity.test.mjs

mv tests/integration/external/gcal/*.test.mjs tests/live/adapter/calendar/gcal.test.mjs
mv tests/integration/external/gmail/*.test.mjs tests/live/adapter/email/gmail.test.mjs
mv tests/integration/external/github/*.test.mjs tests/live/adapter/development/github.test.mjs
mv tests/integration/external/reddit/*.test.mjs tests/live/adapter/social/reddit.test.mjs

mv tests/integration/external/clickup/*.test.mjs tests/live/adapter/productivity/clickup.test.mjs
mv tests/integration/external/todoist/*.test.mjs tests/live/adapter/productivity/todoist.test.mjs

mv tests/integration/external/lastfm/*.test.mjs tests/live/adapter/music/lastfm.test.mjs
mv tests/integration/external/youtube/*.test.mjs tests/live/adapter/media/youtube.test.mjs
mv tests/integration/external/letterboxd/*.test.mjs tests/live/adapter/movies/letterboxd.test.mjs
mv tests/integration/external/goodreads/*.test.mjs tests/live/adapter/reading/goodreads.test.mjs

mv tests/integration/external/weather/*.test.mjs tests/live/adapter/weather/
mv tests/integration/external/foursquare/*.test.mjs tests/live/adapter/location/foursquare.test.mjs
mv tests/integration/external/health/*.test.mjs tests/live/adapter/health/

mv tests/integration/external/ldsgc/*.test.mjs tests/live/adapter/content/ldsgc.test.mjs
mv tests/integration/external/nutribot/*.test.mjs tests/live/adapter/nutrition/

# Move harness
mv tests/integration/external/harness*.mjs tests/_infrastructure/harnesses/external-adapter.harness.mjs
mv tests/integration/external/smoke.mjs tests/_infrastructure/harnesses/external-smoke.mjs
```

**Step 2: Commit**

```bash
git add tests/live/adapter/ tests/integration/external/ tests/_infrastructure/harnesses/
git commit -m "refactor(tests): migrate external live tests to live/adapter"
```

---

### Task 2.10: Migrate Runtime Tests (Live/Flow)

**Step 1: Move runtime flow tests**

```bash
mkdir -p tests/live/flow/{fitness,finance,player,music,tv,ui}

# Fitness flows
mv tests/runtime/suite/fitness-direct-play/*.runtime.test.mjs tests/live/flow/fitness/direct-play.test.mjs
mv tests/runtime/suite/fitness-happy-path/*.runtime.test.mjs tests/live/flow/fitness/happy-path.test.mjs
mv tests/runtime/suite/fitness-multiuser/*.runtime.test.mjs tests/live/flow/fitness/multiuser/
mv tests/runtime/suite/fitness-session/*.runtime.test.mjs tests/live/flow/fitness/session/
mv tests/runtime/suite/fitness-url-routing/*.runtime.test.mjs tests/live/flow/fitness/url-routing.test.mjs
mv tests/runtime/suite/governance/*.runtime.test.mjs tests/live/flow/fitness/governance/
mv tests/runtime/suite/chart/*.runtime.test.mjs tests/live/flow/fitness/chart/

# Finance
mv tests/runtime/suite/finance/*.runtime.test.mjs tests/live/flow/finance/

# Player
mv tests/runtime/suite/player/*.runtime.test.mjs tests/live/flow/player/

# Music
mv tests/runtime/suite/music-player/*.runtime.test.mjs tests/live/flow/music/

# TV
mv tests/runtime/suite/tv-app/*.runtime.test.mjs tests/live/flow/tv/
mv tests/runtime/tv-app/*.runtime.test.mjs tests/live/flow/tv/

# UI
mv tests/runtime/suite/skeleton/*.runtime.test.mjs tests/live/flow/ui/
```

**Step 2: Move investigations to separate folder**

```bash
mkdir -p tests/_investigations/tv-app
mv tests/runtime/tv-app/*investigation*.mjs tests/_investigations/tv-app/
mv tests/runtime/tv-app/debug-*.mjs tests/_investigations/tv-app/
mv tests/runtime/tv-app/fhe-menu-comparison.mjs tests/_investigations/tv-app/
```

**Step 3: Commit**

```bash
git add tests/live/flow/ tests/runtime/ tests/_investigations/
git commit -m "refactor(tests): migrate runtime tests to live/flow"
```

---

### Task 2.11: Migrate Legacy Fitness Tests

**Step 1: Categorize and move legacy fitness tests**

```bash
# These need manual review - most are domain/assembly tests
mkdir -p tests/isolated/domain/fitness/legacy

# Move all legacy fitness tests to a holding area for review
mv tests/unit/suite/fitness/*.test.mjs tests/isolated/domain/fitness/legacy/
```

**Step 2: Commit**

```bash
git add tests/isolated/domain/fitness/legacy/ tests/unit/suite/fitness/
git commit -m "refactor(tests): move legacy fitness tests for review

These tests need categorization into domain/flow/assembly."
```

---

### Task 2.12: Update Import Paths

**Step 1: Create import path update script**

```javascript
// scripts/update-test-imports.mjs
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

const IMPORT_REWRITES = [
  // Old lib paths
  [/@testlib\/testDataService\.mjs/g, '#testlib/testDataService.mjs'],
  [/['"]\.\.\/\.\.\/lib\/testDataService\.mjs['"]/g, "'#testlib/testDataService.mjs'"],
  [/['"]\.\.\/\.\.\/\.\.\/lib\/testDataService\.mjs['"]/g, "'#testlib/testDataService.mjs'"],

  // Fixtures
  [/@fixtures\//g, '#fixtures/'],
  [/['"]\.\.\/\.\.\/_fixtures\//g, "'#fixtures/"],
  [/['"]\.\.\/\.\.\/\.\.\/_fixtures\//g, "'#fixtures/"],

  // Backend aliases (preserve existing)
  [/#system\//g, '#system/'],
  [/#domains\//g, '#domains/'],
  [/#adapters\//g, '#adapters/'],
  [/#apps\//g, '#apps/'],
  [/#api\//g, '#api/'],
];

async function updateImports() {
  const testFiles = await glob('tests/**/*.test.mjs');

  for (const file of testFiles) {
    let content = fs.readFileSync(file, 'utf8');
    let modified = false;

    for (const [pattern, replacement] of IMPORT_REWRITES) {
      if (pattern.test(content)) {
        content = content.replace(pattern, replacement);
        modified = true;
      }
    }

    if (modified) {
      fs.writeFileSync(file, content);
      console.log(`Updated: ${file}`);
    }
  }
}

updateImports();
```

**Step 2: Run import updates**

```bash
node scripts/update-test-imports.mjs
```

**Step 3: Update jest.config.js with new paths**

```javascript
// Add to jest.config.js moduleNameMapper
{
  '#testlib/(.*)': '<rootDir>/tests/_lib/$1',
  '#fixtures/(.*)': '<rootDir>/tests/_fixtures/$1',
  '#harnesses/(.*)': '<rootDir>/tests/_infrastructure/harnesses/$1',
}
```

**Step 4: Commit**

```bash
git add tests/ jest.config.js scripts/update-test-imports.mjs
git commit -m "refactor(tests): update import paths for new structure"
```

---

### Task 2.13: Update package.json Scripts

**Step 1: Update test scripts**

```json
{
  "scripts": {
    "test": "npm run test:isolated && npm run test:integrated",
    "test:isolated": "node tests/_infrastructure/harnesses/isolated.harness.mjs",
    "test:integrated": "node tests/_infrastructure/harnesses/integrated.harness.mjs",
    "test:live": "node tests/_infrastructure/harnesses/live.harness.mjs",
    "test:live:api": "node tests/_infrastructure/harnesses/live.harness.mjs --only=api",
    "test:live:flow": "node tests/_infrastructure/harnesses/live.harness.mjs --only=flow",
    "test:live:adapter": "node tests/_infrastructure/harnesses/live.harness.mjs --only=adapter",
    "test:all": "npm run test && npm run test:live",
    "test:reset-data": "node tests/_infrastructure/generators/setup-household-demo.mjs",
    "test:clean-ports": "node scripts/port-manager.mjs clean-all",
    "test:env:start": "scripts/test-env.sh start",
    "test:env:stop": "scripts/test-env.sh stop",
    "test:env:reset": "scripts/test-env.sh reset"
  }
}
```

**Step 2: Commit**

```bash
git add package.json
git commit -m "feat(tests): update package.json with new test scripts"
```

---

## Phase 3: Create Placeholders & Skeletons

### Task 3.1: Create Placeholder Tests for New Categories

**Step 1: Create contract test placeholder**

```javascript
// tests/isolated/contract/_placeholder.test.mjs
describe('Contract Tests Placeholder', () => {
  it.todo('Add adapter interface compliance tests');
  it.todo('Add API response shape validation tests');
  it.todo('Add port interface tests');
});
```

**Step 2: Create assembly test placeholder**

```javascript
// tests/integrated/assembly/_placeholder.test.mjs
describe('Assembly Tests Placeholder', () => {
  it.todo('Add API → Application wiring tests');
  it.todo('Add Application → Domain wiring tests');
  it.todo('Add Domain → Adapter wiring tests');
  it.todo('Add full vertical slice tests');
});
```

**Step 3: Create live/api placeholder**

```javascript
// tests/live/api/_placeholder.test.mjs
describe('Live API Tests Placeholder', () => {
  it.todo('Add endpoint smoke tests');
  it.todo('Add response baseline tests');
  it.todo('Add error handling tests');
});
```

**Step 4: Commit**

```bash
git add tests/*/
git commit -m "feat(tests): add placeholder tests for new categories"
```

---

### Task 3.2: Create Generator Skeletons

**Step 1: Create setup-household-demo skeleton**

```javascript
// tests/_infrastructure/generators/setup-household-demo.mjs
/**
 * Generates household-demo test data
 *
 * Usage: node tests/_infrastructure/generators/setup-household-demo.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '../household-demo');

// Public domain characters
const USERS = [
  { id: 'popeye', name: 'Popeye', persona: 'fitness' },
  { id: 'olive', name: 'Olive Oyl', persona: 'planner' },
  { id: 'mickey', name: 'Mickey Mouse', persona: 'media' },
  { id: 'betty', name: 'Betty Boop', persona: 'music' },
  { id: 'tintin', name: 'Tintin', persona: 'guest' },
];

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function generateHouseholdConfig() {
  return {
    id: 'demo',
    name: 'Demo Household',
    timezone: 'America/Los_Angeles',
    head_of_household: 'popeye',
    members: USERS.map(u => u.id),
  };
}

function generateUserData(user) {
  const today = new Date();

  return {
    profile: {
      id: user.id,
      name: user.name,
      persona: user.persona,
    },
    // Add more user-specific data based on persona
  };
}

async function main() {
  console.log('Generating household-demo...');

  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Generate household config
  const householdConfig = generateHouseholdConfig();
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'household.yml'),
    JSON.stringify(householdConfig, null, 2) // TODO: Use yaml
  );

  // Generate user data
  fs.mkdirSync(path.join(OUTPUT_DIR, 'users'), { recursive: true });
  for (const user of USERS) {
    const userData = generateUserData(user);
    fs.mkdirSync(path.join(OUTPUT_DIR, 'users', user.id), { recursive: true });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'users', user.id, 'profile.yml'),
      JSON.stringify(userData.profile, null, 2) // TODO: Use yaml
    );
  }

  console.log(`Generated household-demo at ${OUTPUT_DIR}`);
  console.log(`Users: ${USERS.map(u => u.name).join(', ')}`);
}

main().catch(console.error);
```

**Step 2: Create harvester generator skeleton**

```javascript
// tests/_infrastructure/generators/harvesters/strava.generator.mjs
/**
 * Generates fake Strava activity data
 */

export function generateStravaActivities(user, options = {}) {
  const { count = 10, startDate = new Date() } = options;
  const activities = [];

  for (let i = 0; i < count; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() - i);

    activities.push({
      id: `strava-${user}-${i}`,
      user,
      type: ['Run', 'Ride', 'Swim'][i % 3],
      name: `${user}'s ${['Morning', 'Afternoon', 'Evening'][i % 3]} Workout`,
      start_date: date.toISOString(),
      elapsed_time: 1800 + Math.random() * 3600,
      distance: 5000 + Math.random() * 10000,
      average_heartrate: 120 + Math.random() * 40,
      max_heartrate: 160 + Math.random() * 30,
    });
  }

  return activities;
}
```

**Step 3: Create realtime simulator skeleton**

```javascript
// tests/_infrastructure/generators/realtime/fitness.simulator.mjs
/**
 * Simulates real-time fitness data (HR, cadence) for testing
 *
 * Based on pattern from _extensions/fitness/simulation.mjs
 */

import WebSocket from 'ws';

export class FitnessSimulator {
  constructor(wsUrl = 'ws://localhost:3112/ws') {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.running = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
    });
  }

  start(devices = []) {
    this.running = true;
    // Implementation based on _extensions/fitness/simulation.mjs
  }

  stop() {
    this.running = false;
    this.ws?.close();
  }

  sendHeartRate(deviceId, bpm) {
    if (!this.ws || !this.running) return;

    this.ws.send(JSON.stringify({
      topic: 'fitness',
      source: 'test-simulator',
      type: 'ant',
      profile: 'HR',
      deviceId,
      data: { ComputedHeartRate: bpm },
    }));
  }
}
```

**Step 4: Commit**

```bash
git add tests/_infrastructure/generators/
git commit -m "feat(tests): add generator skeletons for test data"
```

---

### Task 3.3: Clean Up Old Structure

**Step 1: Remove empty directories**

```bash
# Remove old directories that should now be empty
rmdir tests/unit/suite/domains/finance/entities 2>/dev/null || true
rmdir tests/unit/suite/domains/finance/services 2>/dev/null || true
rmdir tests/unit/suite/domains/finance 2>/dev/null || true
# ... repeat for all migrated directories

# Or use find to remove empty dirs
find tests/unit -type d -empty -delete
find tests/integration -type d -empty -delete
find tests/runtime -type d -empty -delete
```

**Step 2: Move old harnesses to archive**

```bash
mkdir -p tests/_archive/old-harnesses
mv tests/unit/harness.mjs tests/_archive/old-harnesses/
mv tests/integration/harness.mjs tests/_archive/old-harnesses/
```

**Step 3: Commit**

```bash
git add tests/
git commit -m "chore(tests): clean up old directory structure"
```

---

## Phase 4: Verification

### Task 4.1: Verify Isolated Tests Run

**Step 1: Run isolated tests**

```bash
npm run test:isolated -- --dry-run
# Should list all migrated isolated tests

npm run test:isolated -- --only=domain --pattern=Budget
# Should run Budget tests
```

**Step 2: Fix any import errors**

Check output for import failures and fix paths.

**Step 3: Commit fixes**

```bash
git add tests/
git commit -m "fix(tests): resolve import path issues in isolated tests"
```

---

### Task 4.2: Verify Integrated Tests Run

**Step 1: Generate test data**

```bash
npm run test:reset-data
```

**Step 2: Run integrated tests**

```bash
npm run test:integrated -- --dry-run
```

**Step 3: Fix any issues and commit**

```bash
git add tests/
git commit -m "fix(tests): resolve issues in integrated tests"
```

---

### Task 4.3: Verify Live Tests Run

**Step 1: Start dev server**

```bash
npm run dev:clean
```

**Step 2: Run live API tests**

```bash
npm run test:live -- --only=api --dry-run
```

**Step 3: Run live flow tests**

```bash
npm run test:live -- --only=flow --dry-run
```

**Step 4: Fix any issues and commit**

```bash
git add tests/
git commit -m "fix(tests): resolve issues in live tests"
```

---

## Summary

After completing all phases:

```
tests/
├── isolated/              # 163+ test files (migrated from unit/)
│   ├── domain/           # Entity, service, capability tests
│   ├── adapter/          # Adapter unit tests
│   ├── flow/             # Application flow tests
│   ├── contract/         # Interface compliance tests
│   └── assembly/         # Infrastructure wiring tests
├── integrated/           # 32+ test files (migrated from integration/suite/)
│   ├── domain/           # Cross-domain tests
│   ├── adapter/          # Real I/O adapter tests
│   ├── flow/             # User journey tests
│   ├── contract/         # Adapter compliance tests
│   ├── assembly/         # Full stack wiring tests
│   └── api/              # API integration tests
├── live/                 # 40+ test files (migrated from integration/external/ + runtime/)
│   ├── api/              # HTTP endpoint tests
│   ├── adapter/          # External service tests
│   └── flow/             # Playwright E2E tests
├── _infrastructure/
│   ├── generators/       # Test data generators
│   ├── household-demo/   # Generated test data
│   ├── harnesses/        # Test runners
│   ├── baselines/        # API response snapshots
│   └── environments.yml  # Environment config
├── _lib/                 # Shared utilities
├── _fixtures/            # Static test data
└── _archive/             # Old structure backup
```
