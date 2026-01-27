# Fitness Happy Path Test Design

**Created:** 2026-01-22
**Status:** Implemented
**Config Requirements:** Plex auth must be configured for content/video tests

## Purpose

Proves the fitness stack is wired correctly end-to-end by exercising the full flow from API to UI to video playback.

## What It Validates

1. **API Layer** (`/api/v1/fitness`) - Returns config with nav_items and users
2. **Content APIs** - Collection → shows → episodes load correctly
3. **Plex Proxy** (`backend/src/2_adapters/proxy/PlexProxyAdapter.mjs`) - Video streams correctly
4. **UI Integration** - FitnessApp renders based on API responses

## Test Flow

```
Test 1: fitness API returns config
    └── GET /api/v1/fitness → validates nav_items exist

Test 2: app loads with navbar
    └── Navigate to /fitness → verify .fitness-app-container and navbar buttons

Test 3: collection click loads shows
    └── Click first collection → verify .show-card appears

Test 4: show click loads episodes
    └── Click first show → verify .episode-card appears

Test 5: episode click starts video
    └── Double-tap episode thumbnail → verify video element with src

Test 6: video plays and advances
    └── Monitor video.currentTime for 5 seconds → verify advancement

Test 7: direct play with test data (optional)
    └── Use testDataService for known-good episode
    └── Navigate to /fitness/play/{id} → verify playback
```

## Integration Points Proven

| Layer | Component | Validation |
|-------|-----------|------------|
| Frontend | FitnessApp.jsx | Renders navbar from config |
| Frontend | FitnessMenu.jsx | Shows collection content |
| Frontend | FitnessShow.jsx | Shows episode list |
| Frontend | FitnessPlayer.jsx | Video playback |
| Backend | apiV1Router | /api/v1/fitness endpoint |
| Backend | FitnessDomainService | Config assembly |
| Backend | PlexProxyAdapter | Video streaming |

## Test Data

Uses `testDataService` to load curated Plex test samples from the registry when available. Falls back to UI-discovered content if no test data is configured.

## Configuration-Aware Skipping

Tests gracefully skip when required services aren't configured:

| Test | Requirement | Skip Condition |
|------|-------------|----------------|
| Tests 3-7 | Plex auth | `/api/v1/list/plex/{id}` returns error |

When Plex isn't configured:
- Tests 1-2 pass (API config, navbar)
- Tests 3-7 skip with message "Plex content API not available"

To enable full testing, configure Plex auth in `data/households/{id}/auth.yml`:
```yaml
plex:
  server_url: http://localhost:32400
  token: YOUR_PLEX_TOKEN
```

## Failure Diagnostics

- **dev.log monitoring**: Captures errors/warnings during test run
- **Per-test logging**: On failure, outputs relevant dev.log content
- **Console output**: Each test logs what it's doing and what it found

## File Location

```
tests/runtime/suite/fitness-happy-path/fitness-happy-path.runtime.test.mjs
```

## Running

```bash
npx playwright test tests/runtime/suite/fitness-happy-path/ --project=runtime
```
