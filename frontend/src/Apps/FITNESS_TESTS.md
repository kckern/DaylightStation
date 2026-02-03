# Fitness App Tests

Runtime tests for the Fitness application. All tests run against a live dev server.

## Test Files

| File | Tests | Purpose |
|------|-------|---------|
| `fitness-happy-path.runtime.test.mjs` | 11 | End-to-end UI flow |
| `fitness-governance-simulation.runtime.test.mjs` | 11 | HR simulation & governance |

## Running Tests

```bash
# All fitness tests
npx playwright test tests/live/flow/fitness/

# Happy path only
npx playwright test tests/live/flow/fitness/fitness-happy-path.runtime.test.mjs

# Governance simulation only
npx playwright test tests/live/flow/fitness/fitness-governance-simulation.runtime.test.mjs
```

## Happy Path Tests (11)

Tests the core UI flow from API to video playback.

| # | Test | What it verifies |
|---|------|------------------|
| 1 | fitness API returns config | `/api/v1/fitness` returns nav_items and users |
| 2 | app loads with navbar | FitnessApp renders with navigation |
| 3 | collection click loads shows | Clicking nav item loads show grid |
| 4 | show click loads episodes | Clicking show loads episode list |
| 5 | episode click starts video | Clicking episode starts video player |
| 6 | video plays and advances | Video playhead advances over time |
| 7 | direct play with test data | Direct URL play with governed content (Mario Kart Fitness) |
| 8 | simulation controller available on localhost | `window.__fitnessSimController` exists with devices |
| 9 | setting zone updates participant state | `setZone()` sends HR and updates device state |
| 10 | auto session progresses through zones | `startAutoSession()` progresses HR over time |
| 11 | governance override enables challenges | Full challenge flow: enable, trigger, complete |

## Governance Simulation Tests (11)

Tests the FitnessSimulationController governance features. Exit criteria for HR simulation panel.

| # | Test | What it verifies |
|---|------|------------------|
| 1 | challenge win - all participants reach target | All devices hit target zone, challenge succeeds |
| 2 | challenge fail - timeout expires | No one reaches target, challenge fails after timeout |
| 3 | multi-hurdle sequential challenges | 4 challenges in sequence (3 wins, 1 fail) |
| 4 | partial completion - mixed results | Some participants reach target, others don't |
| 5 | participant dropout mid-challenge | Device stops mid-challenge, others continue |
| 6 | zone overshoot - fire counts for hot target | Exceeding target zone still counts as success |
| 7 | zone oscillation - once reached stays reached | Sticky progress: dropping below target keeps credit |
| 8 | challenge during phase transitions | Challenges work across warmup/main/cooldown phases |
| 9 | governance override on/off | Enable/disable governance, verify state changes |
| 10 | rapid challenge succession | Multiple challenges back-to-back without issues |
| 11 | already in target zone when challenge starts | Pre-positioned devices get instant credit |

## Test Fixtures

### Dynamic (from API)

Tests discover these at runtime - no hardcoded values:

| Data | Source | How tests get it |
|------|--------|------------------|
| Device IDs | `/api/v1/fitness` → `users.primary[].hr` | `sim.getDevices()` returns configured HR monitors |
| User names | `/api/v1/fitness` → `users.primary[].name` | Devices include user name from config |
| Nav items | `/api/v1/fitness` → `plex.nav_items` | First collection clicked dynamically |
| Shows/Episodes | Plex collection API | UI discovery via clicking |
| Zone thresholds | `/api/v1/fitness` → `zones` | Controller computes midpoints |

### Curated (from testdata.yml)

Content IDs in `data/system/config/testdata.yml`:

| ID | Content | Why chosen |
|----|---------|------------|
| 606052 | Mario Kart Fitness | Has `kidsfun` label (governed), ~10 min duration |

### Hardcoded (technical debt)

| File | Value | Issue |
|------|-------|-------|
| `fitness-direct-play.runtime.test.mjs` | `449316` | Should use testdata.yml instead |

## Health Checks

Tests fail fast if:
- Fitness API (`/api/v1/fitness`) is unreachable
- API returns no `nav_items`
- API returns no `users.primary`

## Related Files

- `frontend/src/Apps/FitnessApp.jsx` - Main app component
- `frontend/src/context/FitnessContext.jsx` - State management
- `frontend/src/modules/Fitness/FitnessSimulationController.js` - HR simulation
- `tests/_lib/FitnessSimHelper.mjs` - Playwright test helper
