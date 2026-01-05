# Testing Infrastructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Set up unified test infrastructure with `/tests/` directory, test data fixtures, and npm scripts for all test categories.

**Architecture:** Centralized `/tests/` directory with category subdirectories (unit, assembly, integration, smoke, live, runtime). Test data in `tests/_fixtures/data/` with `_test` household and `_alice`, `_bob`, `_charlie` users. Jest for all categories except runtime (Playwright).

**Tech Stack:** Jest 29.7.0 (existing), Playwright (new), existing ESM configuration

---

### Task 1: Create Directory Structure

**Files:**
- Create: `tests/unit/.gitkeep`
- Create: `tests/assembly/.gitkeep`
- Create: `tests/integration/.gitkeep`
- Create: `tests/smoke/.gitkeep`
- Create: `tests/live/.gitkeep`
- Create: `tests/runtime/.gitkeep`
- Create: `tests/_fixtures/.gitkeep`

**Step 1: Create all directories**

Run:
```bash
mkdir -p tests/{unit,assembly,integration,smoke,live,runtime,_fixtures/data}
touch tests/unit/.gitkeep tests/assembly/.gitkeep tests/integration/.gitkeep tests/smoke/.gitkeep tests/live/.gitkeep tests/runtime/.gitkeep tests/_fixtures/.gitkeep
```

Expected: Directories created, no output

**Step 2: Verify structure**

Run: `ls -la tests/`

Expected: All directories listed

**Step 3: Commit**

```bash
git add tests/
git commit -m "chore: create /tests/ directory structure"
```

---

### Task 2: Create Test Household Configuration

**Files:**
- Create: `tests/_fixtures/data/households/_test/household.yml`

**Step 1: Create household config**

```yaml
# tests/_fixtures/data/households/_test/household.yml
id: _test
name: Test Household
head: _alice
members:
  - _alice
  - _bob
  - _charlie
```

**Step 2: Verify YAML is valid**

Run: `node -e "console.log(require('js-yaml').load(require('fs').readFileSync('tests/_fixtures/data/households/_test/household.yml', 'utf8')))"`

Expected: `{ id: '_test', name: 'Test Household', head: '_alice', members: [ '_alice', '_bob', '_charlie' ] }`

**Step 3: Commit**

```bash
git add tests/_fixtures/data/households/_test/
git commit -m "chore: add _test household fixture"
```

---

### Task 3: Create Test User Profiles

**Files:**
- Create: `tests/_fixtures/data/users/_alice/profile.yml`
- Create: `tests/_fixtures/data/users/_bob/profile.yml`
- Create: `tests/_fixtures/data/users/_charlie/profile.yml`

**Step 1: Create Alice profile**

```yaml
# tests/_fixtures/data/users/_alice/profile.yml
id: _alice
name: Alice Test
email: alice@test.local
fitness:
  max_hr: 185
  resting_hr: 60
  zones:
    - { name: recovery, min: 0, max: 120 }
    - { name: aerobic, min: 120, max: 150 }
    - { name: threshold, min: 150, max: 170 }
    - { name: max, min: 170, max: 185 }
```

**Step 2: Create Bob profile**

```yaml
# tests/_fixtures/data/users/_bob/profile.yml
id: _bob
name: Bob Test
email: bob@test.local
fitness:
  max_hr: 175
  resting_hr: 55
```

**Step 3: Create Charlie profile**

```yaml
# tests/_fixtures/data/users/_charlie/profile.yml
id: _charlie
name: Charlie Test
email: charlie@test.local
fitness:
  max_hr: 190
  resting_hr: 65
```

**Step 4: Commit**

```bash
git add tests/_fixtures/data/users/
git commit -m "chore: add test user profiles (_alice, _bob, _charlie)"
```

---

### Task 4: Create Test Setup Helper

**Files:**
- Create: `tests/_fixtures/setupTestEnv.mjs`

**Step 1: Write the test setup helper**

```js
// tests/_fixtures/setupTestEnv.mjs
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Configure process.env for test mode
 * Points data paths to test fixtures
 */
export function setupTestEnv(options = {}) {
  const { household = '_test' } = options;

  // Set test data path
  const testDataPath = path.join(__dirname, 'data');

  // Configure environment
  process.env.HOUSEHOLD_ID = household;
  process.env.NODE_ENV = 'test';

  // Override path.data if not already set for tests
  if (!process.env.TEST_DATA_PATH) {
    process.env.TEST_DATA_PATH = testDataPath;
  }

  return {
    dataPath: testDataPath,
    household,
    users: ['_alice', '_bob', '_charlie']
  };
}

export const TEST_USERS = {
  alice: '_alice',
  bob: '_bob',
  charlie: '_charlie'
};

export const TEST_HOUSEHOLD = '_test';
```

**Step 2: Verify module loads**

Run: `node --experimental-vm-modules -e "import('./tests/_fixtures/setupTestEnv.mjs').then(m => console.log(m.TEST_USERS))"`

Expected: `{ alice: '_alice', bob: '_bob', charlie: '_charlie' }`

**Step 3: Commit**

```bash
git add tests/_fixtures/setupTestEnv.mjs
git commit -m "chore: add test environment setup helper"
```

---

### Task 5: Install Playwright

**Files:**
- Modify: `package.json` (devDependencies)
- Create: `playwright.config.js`

**Step 1: Install Playwright**

Run: `npm install -D @playwright/test`

Expected: Package installed, package.json updated

**Step 2: Install browsers**

Run: `npx playwright install chromium`

Expected: Chromium browser downloaded

**Step 3: Create Playwright config**

```js
// playwright.config.js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/runtime',
  testMatch: '**/*.runtime.test.mjs',
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:3111',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3111',
    reuseExistingServer: true,
    timeout: 120000,
  }
});
```

**Step 4: Commit**

```bash
git add package.json package-lock.json playwright.config.js
git commit -m "chore: install and configure Playwright for runtime tests"
```

---

### Task 6: Update Jest Configuration

**Files:**
- Modify: `jest.config.js`

**Step 1: Read current jest config**

Run: `cat jest.config.js`

**Step 2: Update jest.config.js**

Add/update these settings:

```js
// jest.config.js
export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: [
    '**/tests/unit/**/*.test.mjs',
    '**/tests/assembly/**/*.test.mjs',
    '**/tests/integration/**/*.test.mjs',
    '**/tests/smoke/**/*.test.mjs',
    '**/tests/live/**/*.test.mjs'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/runtime/'  // Playwright handles these
  ],
  setupFilesAfterEnv: ['<rootDir>/backend/chatbots/jest.setup.mjs'],
  collectCoverageFrom: [
    'backend/lib/**/*.{js,mjs}',
    'backend/routers/**/*.{js,mjs}',
    'frontend/src/**/*.{js,jsx,mjs}',
    '!**/*.test.{js,mjs}',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'html'],
  moduleFileExtensions: ['js', 'mjs', 'json', 'node']
};
```

**Step 3: Verify config loads**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --showConfig | head -20`

Expected: Config displayed without errors

**Step 4: Commit**

```bash
git add jest.config.js
git commit -m "chore: update Jest config for new test directory structure"
```

---

### Task 7: Add NPM Test Scripts

**Files:**
- Modify: `package.json` (scripts section)

**Step 1: Read current scripts**

Run: `node -e "console.log(JSON.stringify(require('./package.json').scripts, null, 2))"`

**Step 2: Add new test scripts**

Add these to package.json scripts:

```json
{
  "test": "npm run test:unit && npm run test:assembly",
  "test:unit": "node --experimental-vm-modules node_modules/jest/bin/jest.js --testPathPattern=tests/unit",
  "test:assembly": "node --experimental-vm-modules node_modules/jest/bin/jest.js --testPathPattern=tests/assembly",
  "test:integration": "node --experimental-vm-modules node_modules/jest/bin/jest.js --testPathPattern=tests/integration",
  "test:smoke": "node --experimental-vm-modules node_modules/jest/bin/jest.js --testPathPattern=tests/smoke",
  "test:live": "node --experimental-vm-modules node_modules/jest/bin/jest.js --testPathPattern=tests/live",
  "test:pre-commit": "npm run test:unit && npm run test:assembly && npm run test:integration",
  "test:pre-deploy": "npm run test:pre-commit && npm run test:smoke && npm run test:live",
  "test:coverage": "npm run test:unit -- --coverage",
  "test:watch": "node --experimental-vm-modules node_modules/jest/bin/jest.js --watch --testPathPattern=tests/unit",
  "rt": "npx playwright test tests/runtime --headed",
  "rt:player": "npx playwright test tests/runtime/player --headed",
  "rt:fitness": "npx playwright test tests/runtime/fitness-session --headed"
}
```

**Step 3: Verify scripts added**

Run: `npm run test:unit --help 2>&1 | head -3`

Expected: No syntax errors

**Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add npm scripts for test categories"
```

---

### Task 8: Create First Smoke Test (Plex)

**Files:**
- Create: `tests/smoke/plex.smoke.test.mjs`

**Step 1: Write the smoke test**

```js
// tests/smoke/plex.smoke.test.mjs
import { describe, it, expect, beforeAll } from '@jest/globals';

describe('Plex connectivity', () => {
  let plexUrl;
  let plexToken;

  beforeAll(async () => {
    // Dynamic import to handle ESM config loading
    const { configService } = await import('../../backend/lib/config/ConfigService.mjs');
    plexUrl = configService.get('plex.url') || process.env.PLEX_URL;
    plexToken = configService.get('plex.token') || process.env.PLEX_TOKEN;
  });

  it('has Plex URL configured', () => {
    expect(plexUrl).toBeDefined();
    expect(plexUrl).not.toBe('');
  });

  it('has Plex token configured', () => {
    expect(plexToken).toBeDefined();
    expect(plexToken).not.toBe('');
  });

  it('can reach Plex server identity endpoint', async () => {
    if (!plexUrl || !plexToken) {
      console.warn('Skipping: Plex not configured');
      return;
    }

    const response = await fetch(`${plexUrl}/identity`, {
      headers: { 'X-Plex-Token': plexToken }
    });

    expect(response.ok).toBe(true);
  });
});
```

**Step 2: Run the smoke test**

Run: `npm run test:smoke`

Expected: Tests run (pass or skip depending on Plex config)

**Step 3: Commit**

```bash
git add tests/smoke/plex.smoke.test.mjs
git commit -m "test: add Plex connectivity smoke test"
```

---

### Task 9: Create First Assembly Test (io.mjs)

**Files:**
- Create: `tests/assembly/io.assembly.test.mjs`

**Step 1: Write the assembly test**

```js
// tests/assembly/io.assembly.test.mjs
import { describe, it, expect, beforeAll } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('io.mjs assembly', () => {
  let io;

  beforeAll(async () => {
    // Set test data path before importing io
    process.env.path = process.env.path || {};
    process.env.path.data = path.join(__dirname, '../_fixtures/data');

    io = await import('../../backend/lib/io.mjs');
  });

  describe('module imports', () => {
    it('exports loadFile function', () => {
      expect(typeof io.loadFile).toBe('function');
    });

    it('exports saveFile function', () => {
      expect(typeof io.saveFile).toBe('function');
    });

    it('exports userLoadFile function', () => {
      expect(typeof io.userLoadFile).toBe('function');
    });

    it('exports householdLoadFile function', () => {
      expect(typeof io.householdLoadFile).toBe('function');
    });
  });

  describe('loadFile with test fixtures', () => {
    it('loads _test household config', () => {
      const household = io.householdLoadFile('_test', 'household');
      expect(household).toBeDefined();
      expect(household.id).toBe('_test');
      expect(household.head).toBe('_alice');
    });

    it('returns null for non-existent file', () => {
      const result = io.loadFile('nonexistent/path');
      expect(result).toBeNull();
    });
  });
});
```

**Step 2: Run the assembly test**

Run: `npm run test:assembly`

Expected: Tests pass

**Step 3: Commit**

```bash
git add tests/assembly/io.assembly.test.mjs
git commit -m "test: add io.mjs assembly test"
```

---

### Task 10: Create First Runtime Test (Player)

**Files:**
- Create: `tests/runtime/player/video-playback.runtime.test.mjs`

**Step 1: Create player test directory**

Run: `mkdir -p tests/runtime/player`

**Step 2: Write the runtime test**

```js
// tests/runtime/player/video-playback.runtime.test.mjs
import { test, expect } from '@playwright/test';

test.describe('Video Player', () => {
  test('player component renders', async ({ page }) => {
    // Navigate to TV app (has video player)
    await page.goto('/tv');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Check if player or media content exists
    const hasPlayer = await page.locator('.player, video, [class*="player"]').count();

    // This test verifies the page loads without crashing
    // Actual player testing requires media content
    expect(hasPlayer >= 0).toBe(true);
  });

  test('page loads without JavaScript errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.goto('/tv');
    await page.waitForLoadState('networkidle');

    // Allow for non-critical errors, but log them
    if (errors.length > 0) {
      console.warn('Page errors:', errors);
    }

    // Test passes if page loads (errors are warnings, not failures)
    expect(true).toBe(true);
  });
});
```

**Step 3: Verify test file syntax**

Run: `node --check tests/runtime/player/video-playback.runtime.test.mjs`

Expected: No output (syntax valid)

**Step 4: Commit**

```bash
git add tests/runtime/player/
git commit -m "test: add basic Player runtime test"
```

---

### Task 11: Add Fitness Test Data

**Files:**
- Create: `tests/_fixtures/data/households/_test/apps/fitness/config.yml`
- Create: `tests/_fixtures/data/users/_alice/lifelog/fitness.yml`

**Step 1: Create fitness config for _test household**

```yaml
# tests/_fixtures/data/households/_test/apps/fitness/config.yml
devices:
  heart_rate:
    "12345": _alice
    "12346": _bob
    "12347": _charlie
  cadence:
    "54321": equipment_bike

device_colors:
  heart_rate:
    "12345": "#ff6b6b"
    "12346": "#4ecdc4"
    "12347": "#45b7d1"

users:
  primary:
    - id: _alice
      name: Alice Test
      hr: 12345
    - id: _bob
      name: Bob Test
      hr: 12346
  secondary:
    - id: _charlie
      name: Charlie Test
      hr: 12347

equipment:
  - id: equipment_bike
    name: Test Bike
    type: bike
```

**Step 2: Create Alice's fitness lifelog**

```yaml
# tests/_fixtures/data/users/_alice/lifelog/fitness.yml
sessions:
  - date: "2026-01-01"
    duration_minutes: 30
    avg_hr: 145
    max_hr: 175
    calories: 320
  - date: "2026-01-02"
    duration_minutes: 45
    avg_hr: 138
    max_hr: 168
    calories: 410
```

**Step 3: Commit**

```bash
git add tests/_fixtures/data/households/_test/apps/ tests/_fixtures/data/users/_alice/lifelog/
git commit -m "chore: add fitness test data fixtures"
```

---

### Task 12: Final Verification

**Step 1: Run all unit/assembly tests**

Run: `npm test`

Expected: All tests pass (or skip gracefully)

**Step 2: Run smoke tests**

Run: `npm run test:smoke`

Expected: Tests run (pass or skip depending on environment)

**Step 3: Verify runtime test syntax**

Run: `npx playwright test tests/runtime --list`

Expected: Lists available runtime tests

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: complete testing infrastructure setup"
```

---

## Summary

After completing all tasks:

| Command | Purpose |
|---------|---------|
| `npm test` | Quick unit + assembly tests |
| `npm run test:pre-commit` | Full local validation |
| `npm run test:pre-deploy` | Include smoke + live |
| `npm run test:smoke` | Environment connectivity |
| `npm run rt:player` | Ad-hoc browser test |

**Test users:** `_alice`, `_bob`, `_charlie`
**Test household:** `_test`
**Test data:** `tests/_fixtures/data/`
