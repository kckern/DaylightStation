# Live Test Harness Design

## Problem

Running all 22 live integration tests causes:
- **Cascading failures** - One broken API/auth causes dozens of tests to fail with same root cause
- **Rate limit avalanche** - Tests fire too fast, hit rate limits, everything fails
- **Output overwhelm** - Console flooded with stack traces

## Solution

A wrapper harness that runs tests sequentially with quarantine-by-service behavior.

## File Structure

```
tests/live/
├── harness.mjs          # Main harness runner
├── harness.config.mjs   # Optional per-service config (delays, retries)
├── harness-utils.mjs    # Shared helpers for data file verification
├── gcal/
│   └── gcal.live.test.mjs
├── strava/
│   └── strava.live.test.mjs
└── ... (22 services)
```

## Execution Logic

```
For each service directory:
  1. Print "▶ gcal" (service starting)
  2. Run each test file in that service
  3. If test passes: log "✓ fetches events"
  4. If test fails:
     - Log "✗ fetches events" + error summary
     - Mark service as quarantined
     - Skip remaining tests in this service
  5. Delay before next service (default 1s)
```

Tests execute via Jest programmatically:
```js
import { runCLI } from 'jest';

const result = await runCLI({
  testPathPattern: [testFile],
  silent: true,
  testTimeout: 60000,
}, [projectRoot]);
```

Quarantine is in-memory:
```js
const quarantined = new Set();

if (quarantined.has(serviceName)) {
  log(`⊘ ${testName} (skipped - ${serviceName} quarantined)`);
  continue;
}
```

## Output Format

During run:
```
▶ gcal
  ✓ fetches calendar events (1.2s)

▶ gmail
  ✗ fetches inbox messages
    → Error: Invalid refresh token
  ⊘ sends test email (skipped - gmail quarantined)

▶ strava
  ✓ fetches activities (2.1s)
  ✓ fetches athlete profile (0.8s)

▶ withings
  ⊘ (skipped - no auth configured)
```

Summary at end:
```
══════════════════════════════════════════
 LIVE TEST SUMMARY
══════════════════════════════════════════
 ✓ gcal          1/1 passed
 ✗ gmail         0/2 passed (quarantined)
 ✓ strava        2/2 passed
 ⊘ withings      skipped (no auth)
──────────────────────────────────────────
 Total: 3/5 passed, 1 quarantined, 1 skipped
══════════════════════════════════════════
```

Exit code: Non-zero if failures (for CI).

## CLI Interface

```bash
# Run all services
node tests/live/harness.mjs

# Run specific services only
node tests/live/harness.mjs --only=gcal,strava

# Skip specific services
node tests/live/harness.mjs --skip=gmail,withings

# Backfill mode (passed through to tests)
node tests/live/harness.mjs --backfill-since=2024-01-01

# Verbose mode (show full stack traces)
node tests/live/harness.mjs --verbose

# Dry run (show what would run, don't execute)
node tests/live/harness.mjs --dry-run
```

npm scripts:
```json
{
  "scripts": {
    "test:live": "node tests/live/harness.mjs",
    "test:live:verbose": "node tests/live/harness.mjs --verbose"
  }
}
```

## Test File Pattern

Each test harvests data then verifies entries exist in data file:

```js
// tests/live/lastfm/lastfm.live.test.mjs

import { configService } from '../../../backend/lib/config/ConfigService.mjs';
import { harvestLastfm } from '../../../backend/lib/lastfm.mjs';
import { readDataFile } from '../harness-utils.mjs';

const backfillSince = process.env.BACKFILL_SINCE;

describe('LastFM Live Harvest', () => {
  it('harvests recent scrobbles', async () => {
    const username = configService.getHeadOfHousehold();

    await harvestLastfm(username, { since: backfillSince });

    const data = readDataFile('lastfm', username);
    const today = new Date().toISOString().split('T')[0];
    const hasRecent = data.some(entry => entry.date >= today);

    expect(hasRecent).toBe(true);
  }, 60000);
});
```

## Configuration

`harness.config.mjs` (optional):
```js
export default {
  defaults: { delayBetweenTests: 1000 },
  services: {
    withings: { delayBetweenTests: 2000 },  // slower API
    nutribot: { maxFailures: 1 },            // backfill-heavy
  }
};
```

## Backfill Behavior

- **Normal run:** Harvest recent (e.g., last 7 days), harvester skips what's already on file
- **Backfill run:** `--backfill-since=2024-01-01` passed as `BACKFILL_SINCE` env var
- Tests that support backfill read the env var; others ignore it

## Compatibility

Running individual tests directly via Jest still works:
```bash
npm test -- tests/live/gcal/gcal.live.test.mjs
```

The harness is additive, not a replacement.
