# Live Adapter Tests

Live tests for external API harvesters. Uses the same code path as production cron jobs.

## Quick Start

```bash
export DAYLIGHT_DATA_PATH=/path/to/data

# CLI: Run all harvesters (smoke test)
node tests/live/adapter/harvest.mjs

# CLI: Backfill from date
node tests/live/adapter/harvest.mjs --since=2025-01-01

# CLI: Specific harvesters
node tests/live/adapter/harvest.mjs --only=strava,withings

# Jest: Run all tests via harness
node tests/live/adapter/harness.mjs

# Jest: Single harvester
NODE_OPTIONS=--experimental-vm-modules npx jest tests/live/adapter/harvesters/strava.live.test.mjs
```

## Harvesters (15)

| Category | Harvesters | Backfill Support |
|----------|------------|------------------|
| Productivity | todoist, clickup, github | Yes (daysBack) |
| Social | lastfm, reddit, letterboxd, goodreads, foursquare | lastfm only |
| Communication | gmail, gcal | gcal only |
| Finance | buxfer, shopping | buxfer only |
| Fitness | strava, withings | strava only |
| Other | weather | No |

## CLI Options

| Option | Description |
|--------|-------------|
| `--only=a,b` | Run only specified harvesters |
| `--skip=a,b` | Skip specified harvesters |
| `--since=YYYY-MM-DD` | Backfill from date |
| `--dry-run` | Show what would run |
| `--json` | Output JSON for programmatic use |
| `--verbose` | Detailed logging |

## Test Discipline

- **auth_error** = credentials missing or expired → FIX REQUIRED
- **error** = API failure → triggers circuit breaker
- **cooldown** = circuit breaker open → ACCEPTABLE (will retry)
- **pass** = harvest succeeded

Tests fail on `auth_error` or `error`. Tests pass on `pass`, `cooldown`, `rate_limited`.

## Directory Structure

```
tests/live/adapter/
├── harvest.mjs              # CLI tool
├── harness.mjs              # Jest orchestrator
├── harness.config.mjs       # Timeouts
├── test-preconditions.mjs   # Helpers
├── README.md
└── harvesters/
    ├── _test-helper.mjs     # Shared test utilities
    ├── _jobs-config.live.test.mjs  # Cron validation
    ├── todoist.live.test.mjs
    ├── clickup.live.test.mjs
    ├── github.live.test.mjs
    ├── lastfm.live.test.mjs
    ├── reddit.live.test.mjs
    ├── letterboxd.live.test.mjs
    ├── goodreads.live.test.mjs
    ├── foursquare.live.test.mjs
    ├── gmail.live.test.mjs
    ├── gcal.live.test.mjs
    ├── buxfer.live.test.mjs
    ├── shopping.live.test.mjs
    ├── strava.live.test.mjs
    ├── withings.live.test.mjs
    └── weather.live.test.mjs
```
