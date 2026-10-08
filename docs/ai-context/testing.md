# Testing Context

## Three runners, and how a file gets one

The repo runs **jest**, **vitest** and **node:test**, and which one executes a
file is decided by what the file imports — not by where it lives. Getting this
wrong does not produce an error; it produces a file nobody runs.

| Runner | Population | Gate |
|--------|-----------|------|
| jest | `tests/unit/suite/` | `npm run test:unit` |
| vitest | `tests/unit`, `tests/isolated` (excluding `suite/` and `backend/`) | `npm run test:unit:vitest` (ratchet) |
| mixed | `backend/tests/` — 60 vitest + 35 node:test | `npm run test:backend` |

The mixing is why `backend/tests` needs its own runner: `describe` from
`node:test` does not register with vitest (vitest reports "No test suite
found"), and a file importing from `'vitest'` does not run under `node --test`
at all. `scripts/test-backend.mjs` splits the tree by import and runs each half
under the right runner.

Two traps:

- **A file that imports nothing still runs under vitest**, because
  `vitest.config.mjs` sets `globals: true`. Seven files in `backend/tests` do
  exactly this. Absence of a `vitest` import does not mean it is a node:test
  file.
- **`@jest/globals` throws under vitest** and no jest glob covers
  `backend/tests`, so such a file is unrunnable anywhere. `test:backend` fails
  the run rather than skipping it.

All three are wired into `npm test`. Before 2026-08-16 `backend/tests` was in
none of them — 89 files executed by nothing, which is how it accumulated 18
vitest failures, 28 node:test failures, two files importing an alias that never
existed, and one testing a deleted module.

## Quick Reference

| Category | Harness | Data Source |
|----------|---------|-------------|
| Unit | `node tests/unit/harness.mjs` | `_fixtures/` (dummy) |
| Integration | `node tests/integration/harness.mjs` | testDataService |
| External | `node tests/integration/external/harness.mjs` | Live APIs |
| Runtime | `npx playwright test` | Real backend |

## Running Tests

### Unit Tests

```bash
# Run all unit tests
node tests/unit/harness.mjs

# Run specific folders
node tests/unit/harness.mjs --only=adapters,domains

# Skip folders
node tests/unit/harness.mjs --skip=voice-memo

# Pattern match
node tests/unit/harness.mjs --pattern=PlexAdapter

# Watch mode
node tests/unit/harness.mjs --watch
```

### Integration Tests

```bash
# Run all integration tests
node tests/integration/harness.mjs

# Run specific folders
node tests/integration/harness.mjs --only=api

# Pattern match
node tests/integration/harness.mjs --pattern=v1-regression

# Smoke tests only
node tests/integration/harness.mjs --smoke
```

### Harness Options

| Option | Description |
|--------|-------------|
| `--only=a,b` | Run only specified folders |
| `--skip=a,b` | Skip specified folders |
| `--pattern=text` | Only tests matching pattern |
| `--verbose, -v` | Show full output |
| `--dry-run` | Show what would run |
| `--watch, -w` | Watch mode |
| `--coverage` | Generate coverage report |

## Directory Structure

```
tests/
├── _archive/              # Archived tests
├── _fixtures/             # Dummy data for mocked tests
├── integration/
│   ├── harness.mjs        # Integration test harness
│   ├── _wip/              # Work in progress
│   ├── suite/             # Regression baseline
│   ├── edge/              # Edge cases
│   └── external/          # External API tests
├── lib/                   # testDataService, matchers
├── runtime/               # Playwright e2e
└── unit/
    ├── harness.mjs        # Unit test harness
    ├── _wip/, suite/, edge/
```

## Path Aliases

Use these instead of relative paths:

```javascript
import { X } from '@backend/src/1_domains/...';    // backend/
import { X } from '@frontend/hooks/...';           // frontend/src/
import { X } from '@fixtures/media/...';           // tests/_fixtures/
import { X } from '@testlib/testDataService.mjs';  // tests/lib/
```

## testDataService

Provides real test data from the data mount instead of hardcoded fixtures.

```javascript
import { loadTestData, validateExpectations } from '@testlib/testDataService.mjs';

const testData = await loadTestData({ scripture: 1, plex: 2 });
const sample = testData.plex[0];
// sample.id = '545219'
// sample.expect = { title: /regex/, type: 'movie|episode' }
```

Registry: `data/system/testdata.yml`

## Writing Tests

1. **Use path aliases** - Not relative paths
2. **Use testDataService** - For real data from data mount
3. **Use `_fixtures/`** - Only for dummy/mock data
4. **Choose right category:**
   - Unit test? → `tests/unit/suite/`
   - API test? → `tests/integration/suite/`
   - E2E? → `tests/runtime/suite/`

## Media acceptance fixtures

The Media app's journeys (`tests/live/flow/media/`) run against `tests/_lib/media-redesign-server.mjs`, an owned acceptance server (exact-SHA preview) that mounts REAL backend services over in-memory or throwaway state. It never writes household data and never commands a household screen (only Office may be used as a physical screen). What it provides:

| Piece | Where | What it is |
|---|---|---|
| Seeded household | `tests/_lib/media-household-fixture.mjs`, seed in `tests/_fixtures/media-household-seed/` (the data tree is in `tree/`, not `data/`, which .gitignore excludes) | The REAL `HouseholdMediaMemoryService`, `MediaSuggestionsService`, play ledger, favourites/removed YAML store, `MarkContentWatched` and the media router's `/api/v1/media/household/*`, `/suggestions` and `/screens/:id/played-earlier` routes, over a temp dir (`fs.mkdtemp`) created per server start from the seed (YAML in the real datastores' formats). Time tokens in the seed (`${local:D,M}`, `${iso:D,M}` = D days ago, M minutes offset) keep spots, plays and time-of-day history recent. Catalog describe calls go through the real adapter, confined to an allowlist (`BRANCH_ALLOWED_TITLES` plus the Bluey show/season for the next-episode climb); anything else is "not found". |
| Seed ids | `HOUSEHOLD_SEED_IDS` (also `SEED` in `tests/live/flow/media/lib/household.mjs`) | Arrival: one screen, 26 %. Disclosure Day: two screens, different spots. Countdown: 200 s / 6 % (unfinished by percent). Red Coast: 170 s / 4 % (not unfinished; a favourite item). Anatomy of a Fall: 310 s (unfinished by seconds), a `legacy` spot, on the removed list. Faith: finished, plays at this time of day on 3 earlier days. Hospital: finished, next episode Keepy Uppy. Bluey: favourite collection. Mario Kart Arcade GP: the "New" addition. Screens: `browser:kidtablet`, `browser:acceptance-tester` (a browser a journey can become with `pinBrowserIdentity`), `browser:oldtablet` (silent 45 days: "Not seen lately"). |
| Reset | `POST /api/v1/media/_fixture/reset` (`?seed=empty`: a household that has played nothing yet); `resetHouseholdAt(request, baseURL, { empty })` in `lib/household.mjs` | Puts the household, screen registry, routine history and recorded device-control calls back to the seed. Journeys share one server: call it in a `beforeEach` when the journey writes (favourite, remove, watched). |
| Fixture screens | `tests/_lib/media-ordinary-device-fixture.mjs` | Besides `acceptance-media` and `acceptance-media-b`: `acceptance-speaker` (type `speaker`, own room), `acceptance-offline` (registered, never connects: liveness not online, a send fails honestly), `acceptance-power` (virtual `device_control`: `GET /api/v1/device/acceptance-power/{on,off,toggle}` are answered by the fixture and recorded; read the record at `.../device-control-calls`; never hardware). All appear in `/api/v1/media/screens` and `/api/v1/device/config`. |
| Live channel | `LIVE_FIXTURE_ID = 'fixture:live'` in `tests/_lib/media-redesign-server.mjs` | A real sliding-window HLS live stream (test picture and tone) written in real time by one ffmpeg process the server starts on first request and owns (removed on exit). `/media?play=fixture:live` plays it here; `GET {device}/load?play=fixture:live` plays it on the virtual receiver. Its play descriptor carries `isLive: true`; pausing lets it fall behind the live edge, so Go to live is provable. Read-only, no household data. |
| Photo search result | same file (`serveFixturePhotoSearch`) | Typing "acceptance photo" in search answers with `fixture:art-1` (a public-domain painting) as a leaf photo, in the real SSE shape, so the camera/photo tap rule and "Show on…" are journey-provable. Nothing else about search changes. |
| Camera search result | same file (`serveFixturePhotoSearch`, `cameraFixtureItem`) | Typing "acceptance camera" answers with `fixture:cam-1` (type `camera`, a still snapshot of another public-domain painting; `GET /api/v1/play/fixture:cam-1` serves its image descriptor), so the camera half of the Show-here rule (FIND.8b/AC3) is journey-provable. |
| Branch search for unknown sources | same file (`isIdForUnknownSource`) | A `source:id` search whose source is not one of the upstream's own sources is answered by THIS branch's real content search router and `ContentQueryService` (the upstream predates the rule); every other search stays the household's real answer. |
| Fake Home Assistant | `tests/_lib/media-ha-caller.mjs` | `createHomeAssistantCaller({ baseUrl }).fireRoutine()` sends `GET /api/v1/device/<id>/load?...` with a `HomeAssistant/...` User-Agent, so the REAL `RoutineLoadRecorder` (origin, catalog match, 10 s dedupe, routine history) runs in front of the fixture's wake-and-load. `.history()` reads `/api/v1/media/routines/history`. The routine catalog is the seed's `state/routines.yml`. A failed run is not deduped; the dedupe only coalesces a successful start, which needs a connected receiver. `loadBrowser(clientId, { play, routine })` is the browser path: a routine origin published to the tab's `client-control:<stable id>` topic over the bus socket (never by name), returning the tab's own ack. |
| Network loss | `tests/live/flow/media/lib/networkLoss.mjs` | `installNetworkControl(page)` before the first `goto`; `lose()` goes offline, drops the live bus socket and refuses new ones; `restore()` and `waitForSocket()` for the app's own reconnect. |
| Fake clock | `tests/live/flow/media/lib/fakeClock.mjs` | `installFakeClock(page)` before `goto`; `advanceMinutes(30)` jumps a sleep timer (due timers fire once; `tick` runs them all). |
| Scripted receivers | `scriptReceiver(request, spec)` in `tests/live/flow/media/lib/scriptedReceiver.mjs` (fixture: `scriptReceiver` / `buildScriptedSnapshot` in `media-ordinary-device-fixture.mjs`; route `POST /api/v1/media/_fixture/receiver`) | Puts a fixture screen with **no mounted page** (`acceptance-power`, `acceptance-speaker`; `acceptance-offline` for off) into any receiver state by publishing the `device-state` a real screen would: `state` playing/paused/idle/off, `kind` video/audio/photo/slideshow/live, `duration: null` (no seeking: a capability limit), `queue`, `thumbnail`, `origin` (started by another device or a routine). It keeps reporting every 10 s (`heartbeatMs`; `0` = said once, then silent so it goes Off at the liveness timeout, which is how a stale screen is built, together with the fake clock). Nothing answers commands, so a Move from it, or a press on its Remote, fails honestly and the screen keeps its state. `reset` quiets every scripted screen. Never script a screen whose page a journey has mounted. `serverOffline: true` keeps the screen reporting (devices show it playing) while the server's liveness refuses a send with `DEVICE_OFFLINE` (a screen that looks online but cannot be reached); cleared by reset. |
| Virtual device steps | `media-ordinary-device-fixture.mjs` | A load that names `volume` runs the REAL volume step on any fixture screen and records `{action:'volume',level}`; a screen with virtual `device_control` (`acceptance-power`) also runs the REAL wake step ("Turning on…") and records `{action:'on',via:'wake'}`. Both are readable at `/api/v1/device/<id>/device-control-calls`, cleared by reset, never hardware. Queue item actions and edits (`queue/item-action|undo|remove|reorder|jump|clear`), `session/item-action/<id>/cancel` (Undo of a far start) and `shuffle`/`repeat` are open for virtual screens; starting content stays on the load route. |
| Controllable search stream | `tests/live/flow/media/lib/sseServer.mjs` | `startSseServer()` + `sse.install(page)` redirect the app's own search request to a tiny stream whose frames (real event vocabulary: `pending`, `results`, `source_error`, `complete`) the test releases with gates: the only way to see "still searching" and widened/empty states deterministically. |
| Shared journey helpers | `lib/receivers.mjs`, `lib/search.mjs` | `openReceiver`/`reopenReceiver`/`startOn` (incl. `asDevice` = started by another device)/`resetControls`/`gotoMedia` (bounded retry for a lost dev-module fetch)/`warmMedia`/`openRemote`; `openSearch`/`resultRow`/`resultRows` that read the same on the phone's SearchMode and the dock combobox. |
| One Media worker | `playwright.config.mjs` project `media` (`workers: 1`) | The household reset in `beforeEach` wipes shared server state, so `tests/live/flow/media/**` never runs in parallel with itself. The household fixture's `reset` builds the new tree beside the live one and swaps it in with `renameSync`, so no read sees a half-copied tree. |
| Gates | `scripts/media-p0-gate.mjs`, `scripts/media-stable-core-gate.mjs`, `scripts/media-gate-runner.mjs` | Never abort: every group runs and the run exits 1 listing every failed group. One retry per group, only after a failed attempt and only when `os.loadavg()[0] < os.cpus().length` (else `DEFERRED: load`); each attempt writes its own `-attempt-N` json/log. Lines read `PASS`, `PASS-AFTER-RETRY (flaky)`, `FAIL`; `--strict` refuses ledger-grade acceptance when any group passed only after a retry. |
| Source check (read-only) | `tests/_lib/media-redesign-server.mjs` `answerMediaSourceCheck` | `POST /api/v1/media-source/check` is answered by the acceptance server itself: it only tries to stream the allowlisted title (`readable` / `unreadable` on a proxy 503 / `unknown`) and never asks the real healer to chmod anything. The ordinary-journey allowlist used to answer it 403, so a file Plex refused for a few seconds (NFS `Permission denied (13)` in the Plex log) was never waited on and 'Faith audio'/local-video starts failed inside their window. Proof: `media-app-source-refusal.runtime.test.mjs`. |

Unit tests for each: `tests/_lib/media-household-fixture.test.mjs`, `media-phase1-fixture.test.mjs`, `media-house-fixture.test.mjs`, `media-ordinary-device-fixture.test.mjs` (`npx vitest run tests/_lib`). Live demos of every helper: `tests/live/flow/media/media-app-infra-helpers.runtime.test.mjs`. To exercise a new criterion against household rules, seed the state it needs in `tests/_fixtures/media-household-seed/` (never in the journey), and assert what the real services answer.

## Reference

See `docs/reference/core/testing.md` for full documentation.
