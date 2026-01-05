# Testing Strategy Design

## Overview

A complete reorganization of the test suite from scattered `__tests__` directories into a unified `/tests/` hierarchy with clear categories, npm scripts, and coverage reporting.

## Test Taxonomy

| Category | Involves | Purpose | When to Run |
|----------|----------|---------|-------------|
| **Unit** | Pure functions only | Syntax, param validation, logic | Every save (watch) |
| **Assembly** | `io.mjs`, YAML, paths | File loading, imports, dependencies | Pre-commit |
| **Integration** | HTTP routes, WebSocket | API endpoints, middleware | Pre-commit |
| **Smoke** | Environment connections | Plex, Telegram, Home Assistant reachable | Pre-deploy |
| **Live** | `/harvest/*` endpoints | Real external API calls | Pre-deploy |
| **Runtime** | Browser + backend | UI flows with backend support | Ad-hoc |

## Directory Structure

```
/tests/
├── unit/                    # Pure logic, no I/O
│   ├── lib/                 # sanitize(), markFlowSequences(), etc.
│   └── domain/              # Value objects, validators
│
├── assembly/                # io.mjs involvement (file/YAML)
│   ├── io/                  # loadFile, saveFile, path translation
│   ├── config/              # ConfigService, pathResolver, loader
│   └── imports/             # Can modules import without error?
│
├── integration/             # HTTP or WebSocket involvement
│   ├── routers/             # Express route handlers (supertest)
│   ├── websocket/           # WS message handling
│   └── middleware/          # Auth, error handling
│
├── smoke/                   # Environment connectivity
│   ├── plex.smoke.test.mjs
│   ├── telegram.smoke.test.mjs
│   ├── homeassistant.smoke.test.mjs
│   ├── mqtt.smoke.test.mjs
│   └── database.smoke.test.mjs
│
├── live/                    # harvest.mjs endpoints (real APIs)
│   ├── strava.live.test.mjs
│   ├── garmin.live.test.mjs
│   ├── gmail.live.test.mjs
│   └── ...per harvester
│
├── runtime/                 # Browser + backend scenarios (ad-hoc)
│   ├── player/
│   │   └── video-playback.runtime.test.mjs
│   ├── fitness-session/
│   │   ├── start-workout.runtime.test.mjs
│   │   └── simulation-chart.runtime.test.mjs
│   └── ...
│
└── _fixtures/               # Shared test data
    ├── nutrition/
    ├── fitness/
    └── mocks/
```

## NPM Scripts

```json
{
  "scripts": {
    "test": "npm run test:unit && npm run test:assembly",
    "test:unit": "node --experimental-vm-modules node_modules/jest/bin/jest.js --testPathPattern=tests/unit",
    "test:assembly": "node --experimental-vm-modules node_modules/jest/bin/jest.js --testPathPattern=tests/assembly",
    "test:integration": "node --experimental-vm-modules node_modules/jest/bin/jest.js --testPathPattern=tests/integration",
    "test:smoke": "node --experimental-vm-modules node_modules/jest/bin/jest.js --testPathPattern=tests/smoke",
    "test:live": "node --experimental-vm-modules node_modules/jest/bin/jest.js --testPathPattern=tests/live",

    "test:pre-commit": "npm run test:unit && npm run test:assembly && npm run test:integration",
    "test:pre-deploy": "npm run test:pre-commit && npm run test:smoke && npm run test:live",

    "test:coverage": "npm run test:unit -- --coverage",
    "test:watch": "node --experimental-vm-modules node_modules/jest/bin/jest.js --watch",

    "rt": "npx playwright test tests/runtime --headed",
    "rt:player": "npx playwright test tests/runtime/player --headed",
    "rt:fitness": "npx playwright test tests/runtime/fitness-session --headed",
    "rt:chart": "npx playwright test tests/runtime/fitness-session/simulation-chart.runtime.test.mjs --headed",
    "rt:workout": "npx playwright test tests/runtime/fitness-session/start-workout.runtime.test.mjs --headed"
  }
}
```

## Workflow

| When | Command | Time |
|------|---------|------|
| Every save (watch) | `npm run test:watch` | <1s |
| Before commit | `npm run test:pre-commit` | ~30s |
| Before deploy | `npm run test:pre-deploy` | ~2-3min |
| Ad-hoc UI check | `npm run rt:player` | varies |

## Naming Convention

```
<module>.<category>.test.mjs

Examples:
  io.assembly.test.mjs
  harvest-router.integration.test.mjs
  plex.smoke.test.mjs
  strava.live.test.mjs
  video-playback.runtime.test.mjs
```

## Coverage Configuration

```js
// jest.config.js additions
{
  collectCoverageFrom: [
    'backend/lib/**/*.{js,mjs}',
    'backend/routers/**/*.{js,mjs}',
    'frontend/src/**/*.{js,jsx,mjs}',
    '!**/*.test.{js,mjs}',
    '!**/node_modules/**'
  ],
  coverageThreshold: {
    global: {
      statements: 0,  // Start at 0, ratchet up over time
      branches: 0,
      functions: 0,
      lines: 0
    }
  },
  coverageReporters: ['text', 'text-summary', 'html']
}
```

## Example Tests

### Smoke Test (Plex)

```js
// tests/smoke/plex.smoke.test.mjs
import { describe, it, expect } from '@jest/globals';
import { configService } from '../../backend/lib/config/ConfigService.mjs';

describe('Plex connectivity', () => {
  it('can reach Plex server', async () => {
    const plexUrl = configService.get('plex.url');
    const plexToken = configService.get('plex.token');

    const response = await fetch(`${plexUrl}/identity`, {
      headers: { 'X-Plex-Token': plexToken }
    });

    expect(response.ok).toBe(true);
  });
});
```

### Smoke Test (Telegram)

```js
// tests/smoke/telegram.smoke.test.mjs
describe('Telegram connectivity', () => {
  it('bot token is valid', async () => {
    const token = configService.get('telegram.bot_token');
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.result.is_bot).toBe(true);
  });
});
```

### Smoke Test (Home Assistant)

```js
// tests/smoke/homeassistant.smoke.test.mjs
describe('Home Assistant connectivity', () => {
  it('can reach HA API', async () => {
    const haUrl = configService.get('home_assistant.url');
    const haToken = configService.get('home_assistant.token');

    const response = await fetch(`${haUrl}/api/`, {
      headers: { 'Authorization': `Bearer ${haToken}` }
    });

    expect(response.ok).toBe(true);
  });
});
```

### Runtime Test (Player)

```js
// tests/runtime/player/video-playback.runtime.test.mjs
import { test, expect } from '@playwright/test';

test('video player timer advances during playback', async ({ page }) => {
  // 1. Navigate to a page with video content
  await page.goto('http://localhost:3111/tv');

  // 2. Start playing a video (adjust selectors as needed)
  await page.click('[data-testid="play-button"]');

  // 3. Wait for player to mount
  await expect(page.locator('.player')).toBeVisible();

  // 4. Get initial time
  const getTime = () => page.evaluate(() => {
    const video = document.querySelector('video');
    return video ? video.currentTime : 0;
  });

  const initialTime = await getTime();

  // 5. Wait and check time advanced
  await page.waitForTimeout(3000);
  const laterTime = await getTime();

  expect(laterTime).toBeGreaterThan(initialTime);
});
```

### Runtime Test (Fitness Simulation)

```js
// tests/runtime/fitness-session/simulation-chart.runtime.test.mjs
import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import fs from 'fs';

test('fitness chart updates with simulation data', async ({ page }) => {
  // 1. Open FitnessApp
  await page.goto('http://localhost:3111/fitness');
  await expect(page.locator('.fitness-app-container')).toBeVisible();

  // 2. Start simulation in background
  const simulation = spawn('node', ['_extentions/fitness/simulation.mjs', '2'], {
    cwd: process.cwd(),
    detached: true
  });

  // 3. Navigate to chart view
  await page.click('[data-nav="chart"]');
  await page.waitForTimeout(5000);

  // 4. Check dev.log for activity
  const devLog = fs.readFileSync('./dev.log', 'utf8');
  expect(devLog).toContain('fitness-chart');

  // 5. Verify chart rendered
  const chartSvg = page.locator('.fitness-chart svg');
  await expect(chartSvg).toBeVisible();

  // Cleanup
  simulation.kill();
});
```

## Playwright Configuration

```js
// playwright.config.js
export default {
  testDir: './tests/runtime',
  testMatch: '**/*.runtime.test.mjs',
  use: {
    baseURL: 'http://localhost:3111',
    headless: true,
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3111',
    reuseExistingServer: true,
  }
};
```

## Migration Plan

### Phase 1: Create Structure

1. Create `/tests/` directory with subdirectories
2. Move tests file-by-file, renaming as needed
3. Update imports to use absolute paths
4. Delete old `__tests__` and `_tests` folders
5. Update jest.config.js to point to new location

### Existing Test Mapping

| Current Location | New Location | Count |
|------------------|--------------|-------|
| `backend/tests/*.test.mjs` | `tests/integration/` or `tests/assembly/` | ~29 |
| `backend/chatbots/_tests/` | `tests/unit/chatbots/` + `tests/integration/chatbots/` | ~55 |
| `frontend/src/**/__tests__/` | `tests/unit/frontend/` | ~33 |
| `*.live.test.mjs` (scattered) | `tests/live/` | ~9 |

### Phase 2: Add Missing Tests

Priority order for new tests:
1. Smoke tests for all integrations (Plex, Telegram, HA, MQTT)
2. Assembly tests for `io.mjs` and config system
3. Integration tests for harvest router
4. Runtime test for Player component

## Test Data Strategy

### Test Household

A dedicated `_test` household with three test users for realistic data testing:

```
data/
├── households/
│   └── _test/
│       ├── household.yml
│       └── apps/
│           ├── fitness/
│           │   └── config.yml
│           └── ...
│
└── users/
    ├── _alice/
    │   ├── profile.yml
    │   ├── lifelog/
    │   │   ├── fitness/
    │   │   ├── nutrition/
    │   │   └── strava/
    │   └── auth/
    │       └── strava.yml  # test tokens
    │
    ├── _bob/
    │   ├── profile.yml
    │   ├── lifelog/
    │   └── auth/
    │
    └── _charlie/
        ├── profile.yml
        ├── lifelog/
        └── auth/
```

### Household Configuration

```yaml
# data/households/_test/household.yml
id: _test
name: Test Household
head: _alice
members:
  - _alice
  - _bob
  - _charlie
```

### User Profiles

```yaml
# data/users/_alice/profile.yml
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

```yaml
# data/users/_bob/profile.yml
id: _bob
name: Bob Test
email: bob@test.local
fitness:
  max_hr: 175
  resting_hr: 55
```

```yaml
# data/users/_charlie/profile.yml
id: _charlie
name: Charlie Test
email: charlie@test.local
fitness:
  max_hr: 190
  resting_hr: 65
```

### Test Data Principles

1. **Underscore prefix** - `_test`, `_alice`, `_bob`, `_charlie` clearly marks test data
2. **Real structure** - Mirrors production data layout exactly
3. **Isolated** - Won't interfere with real household/user data
4. **Committed to repo** - Test data lives in `tests/_fixtures/data/` and is copied during test setup
5. **Per-user auth** - Each test user can have their own mock or real API tokens

### Usage in Tests

```js
// tests/assembly/io.assembly.test.mjs
import { userLoadFile } from '../../backend/lib/io.mjs';

describe('userLoadFile', () => {
  beforeAll(() => {
    process.env.HOUSEHOLD_ID = '_test';
  });

  it('loads Alice fitness data', () => {
    const data = userLoadFile('_alice', 'fitness');
    expect(data).toBeDefined();
  });

  it('loads Bob profile', () => {
    const profile = userLoadProfile('_bob');
    expect(profile.name).toBe('Bob Test');
  });
});
```

```js
// tests/live/strava.live.test.mjs
describe('Strava harvester', () => {
  it('fetches activities for test user', async () => {
    const response = await fetch('/harvest/strava?user=_alice');
    expect(response.ok).toBe(true);
  });
});
```

## Key Principles

- **Smoke/Live are table stakes** - Not the "final boss", they're baseline expectations
- **Runtime is ad-hoc** - Not part of CI, used during development
- **Coverage starts at 0** - Ratchet up over time as tests are added
- **All tests in `/tests/`** - Not co-located with source
- **Test data uses underscore prefix** - `_test`, `_alice`, `_bob`, `_charlie`
