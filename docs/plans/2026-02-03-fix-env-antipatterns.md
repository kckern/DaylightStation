# Fix DAYLIGHT_DATA_PATH Antipatterns Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace direct `process.env.DAYLIGHT_DATA_PATH` reads with proper configHelper imports across test infrastructure, ensuring tests work in git worktrees.

**Architecture:** The fix is simple: instead of reading `process.env.DAYLIGHT_DATA_PATH` (which is set by ConfigService at runtime), tests import `getDataPath()` from `configHelper.mjs` which derives the path directly from `.env` file and supports git worktrees.

**Tech Stack:** Node.js ES modules, Vitest test framework

---

## Task 1: Fix harness-utils.mjs

**Files:**
- Modify: `tests/live/adapter/harness-utils.mjs:12-14`

**Step 1: Update import and getDataPath function**

Replace the current implementation:
```javascript
export function getDataPath() {
  return process.env.DAYLIGHT_DATA_PATH;
}
```

With:
```javascript
import { getDataPath as _getDataPath } from '../../_lib/configHelper.mjs';

export function getDataPath() {
  return _getDataPath();
}
```

**Step 2: Verify the fix**

Run: `node -e "import('./tests/live/adapter/harness-utils.mjs').then(m => console.log(m.getDataPath()))"`
Expected: Prints the data path (e.g., `/Users/kckern/Documents/GitHub/DaylightStation/data`)

**Step 3: Commit**

```bash
git add tests/live/adapter/harness-utils.mjs
git commit -m "fix(tests): use configHelper in harness-utils.mjs"
```

---

## Task 2: Fix testConfig.mjs

**Files:**
- Modify: `tests/_fixtures/config/testConfig.mjs:23-30`

**Step 1: Add configHelper import at top of file**

After line 14 (after existing imports), add:
```javascript
import { getDataPath } from '../../_lib/configHelper.mjs';
```

**Step 2: Replace process.env.DAYLIGHT_DATA_PATH usage**

Replace:
```javascript
export function initTestConfigService() {
  const dataDir = process.env.DAYLIGHT_DATA_PATH;
  if (!dataDir) {
```

With:
```javascript
export function initTestConfigService() {
  const dataDir = getDataPath();
  if (!dataDir) {
```

**Step 3: Update error message**

Replace:
```javascript
    throw new Error(
      'DAYLIGHT_DATA_PATH not set. Required for integration tests.\n' +
      'Set it in .env or use createMockConfigService() for unit tests.'
    );
```

With:
```javascript
    throw new Error(
      'Could not determine data path. Required for integration tests.\n' +
      'Ensure .env exists with DAYLIGHT_BASE_PATH or use createMockConfigService() for unit tests.'
    );
```

**Step 4: Verify the fix**

Run: `node -e "import('./tests/_fixtures/config/testConfig.mjs').then(m => console.log('loaded'))"`
Expected: Prints "loaded" without errors

**Step 5: Commit**

```bash
git add tests/_fixtures/config/testConfig.mjs
git commit -m "fix(tests): use configHelper in testConfig.mjs"
```

---

## Task 3: Fix testServer.mjs

**Files:**
- Modify: `tests/_lib/api-test-utils/testServer.mjs`

**Step 1: Read the file to understand its structure**

Read the file first to see the exact line and context.

**Step 2: Add configHelper import**

Add near the top imports:
```javascript
import { getDataPath } from '../configHelper.mjs';
```

**Step 3: Replace process.env.DAYLIGHT_DATA_PATH usage**

Replace:
```javascript
const dataPath = process.env.DAYLIGHT_DATA_PATH;
```

With:
```javascript
const dataPath = getDataPath();
```

**Step 4: Commit**

```bash
git add tests/_lib/api-test-utils/testServer.mjs
git commit -m "fix(tests): use configHelper in testServer.mjs"
```

---

## Task 4: Fix adapter tests (batch 1 - weather, gmail, todoist)

**Files:**
- Modify: `tests/live/adapter/weather/weather.live.test.mjs:13`
- Modify: `tests/live/adapter/email/gmail.live.test.mjs:16`
- Modify: `tests/live/adapter/productivity/todoist.live.test.mjs:15`

For each file, the pattern is the same:

**Step 1: Add configHelper import**

Add at top of file (after existing imports):
```javascript
import { getDataPath } from '../../../_lib/configHelper.mjs';
```

Note: Path depth varies by file location. Weather is in `adapter/weather/`, so `../../../_lib/` is correct.
For files directly in `adapter/`, use `../../_lib/`.

**Step 2: Replace process.env usage in beforeAll**

Replace:
```javascript
const dataPath = process.env.DAYLIGHT_DATA_PATH;
if (!dataPath) {
  throw new Error('DAYLIGHT_DATA_PATH environment variable required');
}
```

With:
```javascript
const dataPath = getDataPath();
if (!dataPath) {
  throw new Error('Could not determine data path from .env');
}
```

**Step 3: Run one test to verify**

Run: `npm test -- tests/live/adapter/weather/weather.live.test.mjs --run`
Expected: Test runs (may pass or fail based on API, but should not fail on path resolution)

**Step 4: Commit**

```bash
git add tests/live/adapter/weather/weather.live.test.mjs tests/live/adapter/email/gmail.live.test.mjs tests/live/adapter/productivity/todoist.live.test.mjs
git commit -m "fix(tests): use configHelper in weather, gmail, todoist adapter tests"
```

---

## Task 5: Fix adapter tests (batch 2 - fitness, health, calendar)

**Files:**
- Modify: `tests/live/adapter/fitness/fitness.live.test.mjs`
- Modify: `tests/live/adapter/fitness/withings.live.test.mjs`
- Modify: `tests/live/adapter/fitness/strava.live.test.mjs`
- Modify: `tests/live/adapter/health/health.live.test.mjs`
- Modify: `tests/live/adapter/calendar/gcal.live.test.mjs`

Same pattern as Task 4 - add import, replace process.env usage.

**Step 1: Commit**

```bash
git add tests/live/adapter/fitness/*.live.test.mjs tests/live/adapter/health/health.live.test.mjs tests/live/adapter/calendar/gcal.live.test.mjs
git commit -m "fix(tests): use configHelper in fitness, health, calendar adapter tests"
```

---

## Task 6: Fix adapter tests (batch 3 - media, social, finance)

**Files:**
- Modify: `tests/live/adapter/media/youtube.live.test.mjs`
- Modify: `tests/live/adapter/music/lastfm.live.test.mjs`
- Modify: `tests/live/adapter/social/reddit.live.test.mjs`
- Modify: `tests/live/adapter/finance/shopping.live.test.mjs`
- Modify: `tests/live/adapter/finance/infinity.live.test.mjs`
- Modify: `tests/live/adapter/finance/budget.live.test.mjs`

Same pattern - add import, replace process.env usage.

**Step 1: Commit**

```bash
git add tests/live/adapter/media/*.live.test.mjs tests/live/adapter/music/*.live.test.mjs tests/live/adapter/social/*.live.test.mjs tests/live/adapter/finance/*.live.test.mjs
git commit -m "fix(tests): use configHelper in media, music, social, finance adapter tests"
```

---

## Task 7: Fix adapter tests (batch 4 - remaining)

**Files:**
- Modify: `tests/live/adapter/reading/goodreads.live.test.mjs`
- Modify: `tests/live/adapter/development/github.live.test.mjs`
- Modify: `tests/live/adapter/location/foursquare.live.test.mjs`
- Modify: `tests/live/adapter/movies/letterboxd.live.test.mjs`
- Modify: `tests/live/adapter/content/ldsgc.live.test.mjs`
- Modify: `tests/live/adapter/productivity/clickup.live.test.mjs`
- Modify: `tests/live/adapter/nutrition/GoogleImageSearch.live.test.mjs`
- Modify: `tests/live/adapter/smoke.mjs`

Same pattern - add import, replace process.env usage.

**Step 1: Commit**

```bash
git add tests/live/adapter/reading/*.live.test.mjs tests/live/adapter/development/*.live.test.mjs tests/live/adapter/location/*.live.test.mjs tests/live/adapter/movies/*.live.test.mjs tests/live/adapter/content/*.live.test.mjs tests/live/adapter/productivity/clickup.live.test.mjs tests/live/adapter/nutrition/GoogleImageSearch.live.test.mjs tests/live/adapter/smoke.mjs
git commit -m "fix(tests): use configHelper in remaining adapter tests"
```

---

## Task 8: Fix integration/unit tests

**Files:**
- Modify: `tests/unit/suite/withings-auth.test.mjs`
- Modify: `tests/live/api/content/content-api.regression.test.mjs`
- Modify: `tests/integrated/api/fitness/plex-parity.test.mjs`
- Modify: `tests/integrated/api/content/smoke-plex.test.mjs`
- Modify: `backend/src/2_domains/lifelog/services/__tests__/LifelogAggregator.test.mjs`

Same pattern - add configHelper import, replace process.env usage.

Note: Backend test file needs different import path:
```javascript
import { getDataPath } from '../../../../../../tests/_lib/configHelper.mjs';
```

**Step 1: Commit**

```bash
git add tests/unit/suite/withings-auth.test.mjs tests/live/api/content/content-api.regression.test.mjs tests/integrated/api/fitness/plex-parity.test.mjs tests/integrated/api/content/smoke-plex.test.mjs backend/src/2_domains/lifelog/services/__tests__/LifelogAggregator.test.mjs
git commit -m "fix(tests): use configHelper in integration and unit tests"
```

---

## Task 9: Verify all tests pass

**Step 1: Run full test suite**

Run: `npm test -- --run`
Expected: All tests pass (or fail for reasons unrelated to path resolution)

**Step 2: Test from a git worktree (if one exists)**

Run: `cd ../some-worktree && npm test -- tests/live/adapter/weather/weather.live.test.mjs --run`
Expected: Test runs without "DAYLIGHT_DATA_PATH not set" errors

---

## Task 10: Update audit document

**Files:**
- Modify: `docs/_wip/audits/2026-02-03-daylight-path-antipatterns.md`

**Step 1: Move fixed files to "Fixed Files" section**

Update the "Remaining Antipatterns" sections to show all items as fixed.

**Step 2: Update status**

Change:
```markdown
**Status:** In Progress
```

To:
```markdown
**Status:** Complete
```

**Step 3: Commit**

```bash
git add docs/_wip/audits/2026-02-03-daylight-path-antipatterns.md
git commit -m "docs: mark env antipatterns audit as complete"
```

---

## Out of Scope (Low Priority)

The following are intentionally not fixed in this plan:

1. **CLI Tools** (`cli/*.mjs`) - These typically run with `.env` loaded via dotenv. They have fallbacks and work correctly.

2. **Backend entry points** (`backend/index.js`, `backend/src/server.mjs`) - These legitimately read from env vars as they run AFTER dotenv loads `.env`.

3. **ConfigService** (`backend/src/0_system/config/index.mjs`) - This SETS the env var, doesn't read it incorrectly.

4. **screens.mjs router** - Runtime code that runs after ConfigService initializes.

These can be addressed in a future cleanup if needed.
