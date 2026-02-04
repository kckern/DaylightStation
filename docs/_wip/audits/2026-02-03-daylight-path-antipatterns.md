# Audit: DAYLIGHT_DATA_PATH Antipatterns

**Date:** 2026-02-03
**Status:** Complete
**Trigger:** Test infrastructure failing in git worktrees due to missing `.env`

---

## Problem

Code was reading `DAYLIGHT_DATA_PATH` and `DAYLIGHT_BASE_PATH` from `process.env` directly, but these variables are:
1. **Set by ConfigService at runtime** - `process.env.DAYLIGHT_DATA_PATH = svc.getDataDir()`
2. **Not available before bootstrap** - Tests and CLI tools run before the server boots

This caused failures when:
- Running tests in git worktrees (no `.env` in worktree)
- Running standalone test utilities
- Running CLI tools outside the server context

---

## Correct Pattern

### For Backend/Server Code
```javascript
// Import from ConfigService (already initialized)
import { configService } from '#system/config/index.mjs';
const dataDir = configService.getDataDir();
```

### For Test Infrastructure
```javascript
// Use configHelper which derives from .env file and supports worktrees
import { getDataPath } from '#testlib/configHelper.mjs';
const dataPath = getDataPath();
```

### For CLI Tools
```javascript
// Derive from .env file (same pattern as configHelper)
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
const basePath = process.env.DAYLIGHT_BASE_PATH;
const dataDir = path.join(basePath, 'data');
```

---

## Fixed Files (2026-02-03)

| File | Change |
|------|--------|
| `tests/_lib/configHelper.mjs` | Complete rewrite - derives path from .env, supports worktrees |
| `tests/_lib/testDataService.mjs` | Uses `getDataPath()` from configHelper |
| `tests/_lib/fixture-loader.mjs` | Uses `getDataPath()` from configHelper |
| `tests/_lib/listFixtureLoader.mjs` | Uses `getDataPath()` from configHelper |
| `tests/_lib/fitness-test-utils.mjs` | Uses `getDataPath()` and `getAppPort()` from configHelper |
| `.env.example` | Updated documentation to clarify correct pattern |
| `tests/live/adapter/harness-utils.mjs` | Uses `getDataPath()` from configHelper |
| `tests/_fixtures/config/testConfig.mjs` | Uses `getDataPath()` from configHelper |
| `tests/_lib/api-test-utils/testServer.mjs` | Uses `getDataPath()` from configHelper |
| `tests/live/adapter/weather.live.test.mjs` | Uses harness-utils `getDataPathOrFail()` |
| `tests/live/adapter/gmail.live.test.mjs` | Uses harness-utils `getDataPathOrFail()` |
| `tests/live/adapter/todoist.live.test.mjs` | Uses harness-utils `getDataPathOrFail()` |
| `tests/live/adapter/fitness.live.test.mjs` | Uses harness-utils `getDataPathOrFail()` |
| `tests/live/adapter/withings.live.test.mjs` | Uses harness-utils `getDataPathOrFail()` |
| `tests/live/adapter/strava.live.test.mjs` | Uses harness-utils `getDataPathOrFail()` |
| `tests/live/adapter/health.live.test.mjs` | Uses harness-utils `getDataPathOrFail()` |
| `tests/live/adapter/gcal.live.test.mjs` | Uses harness-utils `getDataPathOrFail()` |
| `tests/live/adapter/youtube.live.test.mjs` | Uses harness-utils `getDataPathOrFail()` |
| `tests/live/adapter/lastfm.live.test.mjs` | Uses harness-utils `getDataPathOrFail()` |
| `tests/live/adapter/reddit.live.test.mjs` | Uses harness-utils `getDataPathOrFail()` |
| `tests/live/adapter/shopping.live.test.mjs` | Uses harness-utils `getDataPathOrFail()` |
| `tests/live/adapter/infinity.live.test.mjs` | Uses harness-utils `getDataPathOrFail()` |
| `tests/live/adapter/budget.live.test.mjs` | Uses harness-utils `getDataPathOrFail()` |
| `tests/live/adapter/goodreads.live.test.mjs` | Uses harness-utils `getDataPathOrFail()` |
| `tests/live/adapter/github.live.test.mjs` | Uses harness-utils `getDataPathOrFail()` |
| `tests/live/adapter/foursquare.live.test.mjs` | Uses harness-utils `getDataPathOrFail()` |
| `tests/live/adapter/letterboxd.live.test.mjs` | Uses harness-utils `getDataPathOrFail()` |
| `tests/live/adapter/ldsgc.live.test.mjs` | Uses harness-utils `getDataPathOrFail()` |
| `tests/live/adapter/clickup.live.test.mjs` | Uses harness-utils `getDataPathOrFail()` |
| `tests/live/adapter/GoogleImageSearch.live.test.mjs` | Uses harness-utils `getDataPathOrFail()` |
| `tests/live/adapter/smoke.mjs` | Uses harness-utils `getDataPathOrFail()` |
| `tests/unit/suite/withings-auth.test.mjs` | Uses `getDataPath()` from configHelper |
| `tests/live/api/content/content-api.regression.test.mjs` | Uses `getDataPath()` from configHelper |
| `tests/integrated/api/fitness/plex-parity.test.mjs` | Uses `getDataPath()` from configHelper |
| `tests/integrated/api/content/smoke-plex.test.mjs` | Uses `getDataPath()` from configHelper |
| `backend/src/2_domains/lifelog/services/__tests__/LifelogAggregator.test.mjs` | Uses `getDataPath()` from configHelper |

---

## Out of Scope (CLI Tools & Backend Entry Points)

| File | Notes |
|------|-------|
| `cli/migrate-watch-history.mjs` | Migration script - CLI tools run with `.env` loaded |
| `cli/scripts/migrate-media-keys.mjs` | Migration script - CLI tools run with `.env` loaded |
| `cli/auth-validator.cli.mjs` | Auth validation tool - CLI tools run with `.env` loaded |
| `cli/plex.cli.mjs` | Plex CLI - CLI tools run with `.env` loaded |
| `frontend/vite.config.js` | Uses `loadEnv()` from Vite, reads from .env. Works correctly. |
| `backend/src/4_api/v1/routers/screens.mjs` | Has fallback default, used at runtime after ConfigService sets env |
| `backend/index.js` | Entry point that derives dataDir from `DAYLIGHT_BASE_PATH` - correct pattern |

---

## Testing

After all fixes, verify:
1. Unit tests pass from git worktrees
2. Playwright tests can find the port
3. Live adapter tests still work
4. CLI tools still work

---

## References

- `backend/src/0_system/config/index.mjs` - ConfigService that sets `process.env.DAYLIGHT_DATA_PATH`
- `backend/index.js` - Entry point that derives dataDir from `DAYLIGHT_BASE_PATH`
- `tests/_lib/configHelper.mjs` - Reference implementation for deriving path from .env
