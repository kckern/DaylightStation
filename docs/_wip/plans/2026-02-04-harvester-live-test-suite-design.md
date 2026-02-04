# Harvester Live Test Suite Design

**Date:** 2026-02-04
**Status:** Approved

## Overview

Unified CLI tool and Jest test suite for all 16 external data harvesters. The CLI doubles as an operational tool for manual harvesting and backfilling, while the Jest tests verify the same code path used in production cron jobs.

## Goals

1. **Bulletproof test coverage** for all harvesters
2. **CLI tool** for manual harvest/backfill operations
3. **Same code path as prod** - uses `createHarvesterServices()` from bootstrap
4. **Validate cron jobs.yml** matches registered harvesters

## Harvesters (16 total)

| Category | Harvesters | Cron Schedule |
|----------|------------|---------------|
| Communication | gcal, gmail | Every 10 min |
| Finance | buxfer, shopping | Hourly / Daily |
| Fitness | strava, withings, fitsync | Hourly / Daily |
| Productivity | todoist, clickup, github | 10 min / Hourly / Daily |
| Social | lastfm, reddit, letterboxd, goodreads, foursquare | Hourly / Daily |
| Other | weather | Every 10 min |

## Architecture

### File Structure

```
tests/live/adapter/
├── harvest.mjs                      # CLI tool (replaces smoke.mjs)
├── harness.mjs                      # Jest orchestrator (quarantine behavior)
├── harness.config.mjs               # Timeouts per harvester
├── test-preconditions.mjs           # requireConfig helpers
├── README.md
└── harvesters/
    ├── _jobs-config.live.test.mjs   # Cron validation test
    ├── gcal.live.test.mjs
    ├── gmail.live.test.mjs
    ├── buxfer.live.test.mjs
    ├── shopping.live.test.mjs
    ├── todoist.live.test.mjs
    ├── clickup.live.test.mjs
    ├── github.live.test.mjs
    ├── strava.live.test.mjs
    ├── withings.live.test.mjs
    ├── fitsync.live.test.mjs
    ├── lastfm.live.test.mjs
    ├── reddit.live.test.mjs
    ├── letterboxd.live.test.mjs
    ├── goodreads.live.test.mjs
    ├── foursquare.live.test.mjs
    └── weather.live.test.mjs
```

### CLI Tool (`harvest.mjs`)

**Usage:**
```bash
# Smoke test all harvesters (minimal data, quick)
node tests/live/adapter/harvest.mjs

# Full harvest with backfill
node tests/live/adapter/harvest.mjs --since=2025-01-01

# Specific harvesters
node tests/live/adapter/harvest.mjs --only=strava,withings --since=2025-01-01

# Skip problematic ones
node tests/live/adapter/harvest.mjs --skip=github,shopping

# Dry run (show what would execute)
node tests/live/adapter/harvest.mjs --dry-run

# JSON output for programmatic use
node tests/live/adapter/harvest.mjs --json

# Verbose logging
node tests/live/adapter/harvest.mjs --verbose
```

**Behavior:**
1. Initialize `configService` with data path from env
2. Call `createHarvesterServices()` from bootstrap (exact prod path)
3. For each harvester:
   - Check circuit breaker state (skip if open)
   - Convert `--since` to harvester-native options
   - Execute harvest with timeout
   - Report pass/fail/auth_error/timeout
4. Exit code: 0 if all pass, 1 if any fail

**Since date conversion** (internal):
```javascript
const SINCE_CONVERTERS = {
  strava: (since) => ({ daysBack: daysSince(since) }),
  gcal: (since) => ({ weeksBack: Math.ceil(daysSince(since) / 7), weeksAhead: 2 }),
  lastfm: (since) => ({ since }),
  buxfer: (since) => ({ startDate: since }),
  // etc.
};
```

### Jest Test Files

Each harvester gets a thin test file that invokes the CLI:

```javascript
describe('Strava Harvester Live', () => {
  it('harvests recent activities', async () => {
    const result = await runHarvest('strava');

    expect(result.status).not.toBe('auth_error');
    expect(result.status).not.toBe('error');
    expect(['pass', 'cooldown', 'skipped']).toContain(result.status);
  }, 60000);

  it('backfills from date when --since provided', async () => {
    const since = sevenDaysAgo();
    const result = await runHarvest('strava', { since });

    expect(result.status).toBe('pass');
  }, 120000);
});
```

### Cron Jobs Validation

`_jobs-config.live.test.mjs` verifies:
- Every harvester has a cron job entry
- All harvester jobs are enabled
- Job IDs match registered harvester serviceIds

## Error Handling

| Harvester State | CLI Output | Test Assertion |
|-----------------|------------|----------------|
| Success | `status: "pass"` | Pass |
| Auth error (401/403) | `status: "auth_error"` | Fail with clear message |
| API error (500, network) | `status: "error"` | Fail, triggers circuit breaker |
| Circuit breaker open | `status: "cooldown"` | Pass (expected behavior) |
| Rate limited (429) | `status: "rate_limited"` | Pass (will retry next run) |
| Timeout | `status: "timeout"` | Fail |
| Missing credentials | `status: "auth_error"` | Fail with "configure X" message |

**Test discipline:**
- Missing credentials → explicit `auth_error`, not silent pass
- API failures → explicit `error` with message
- Never return `pass` when nothing was actually harvested

## Cleanup

**Delete:**
- `tests/live/adapter/smoke.mjs` - replaced by harvest.mjs
- `tests/live/adapter/harness-utils.mjs` - unused
- `tests/live/adapter/finance/` - entire directory

**Update:**
- `harness.config.mjs` - timeouts for all 16 harvesters
- `README.md` - new documentation

## Usage After Implementation

```bash
# CLI for manual operations
node tests/live/adapter/harvest.mjs --only=strava --since=2025-01-01

# Full test suite via harness
node tests/live/adapter/harness.mjs

# Single harvester test via Jest
NODE_OPTIONS=--experimental-vm-modules npx jest tests/live/adapter/harvesters/strava.live.test.mjs
```
