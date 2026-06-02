# Cycle Game — Plan 6: Live Container + Simulator-Driven E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. **This plan is TDD with the Playwright simulator E2E as the acceptance criterion** — the E2E is written FIRST and must drive the real app through full race lifecycles before the container is considered done.

**Goal:** Make the cycle game actually launchable and correct end-to-end: a live `CycleGameContainer` that wires `useFitnessContext` + `CycleRaceController` (Plan 4) + the screens (Plans 2/4/5) into the lifecycle, emits structured lifecycle logs, registers as a launchable fitness widget — verified by Playwright tests that drive the **dev simulator** (`window.__fitnessSimController`, incl. the new `setEquipmentRider`) through distance-race, time-race, and DNF lifecycles and assert on both the DOM and the per-session JSONL logs.

**Architecture:** The container is the one piece that can only be validated against the running app, so its acceptance test is the simulator-driven Playwright E2E (not unit tests). The E2E reads the per-app JSONL log (`media/logs/fitness/*.jsonl`, populated because the fitness logger sets `context.sessionLog: true`) for durable lifecycle assertions, plus DOM checks. Build → deploy → run E2E → iterate until green.

**Tech Stack:** React + Playwright (`@playwright/test`), `FitnessSimHelper`, the frontend logging framework (`getLogger`), JSONL session-file transport.

**Plan 6 of 6.** Depends on Plans 1-5 (merged to main) + the simulator rider-assignment addition (`FitnessSimulationController.setEquipmentRider`, sim-panel). Spec §3, §12.

---

## Test commands
- E2E (Playwright auto-starts the dev server per `playwright.config.mjs`): `npx playwright test tests/live/flow/fitness/cycle-game-lifecycle.runtime.test.mjs --reporter=line`
- Unit (sim helper): vitest/jest as in prior plans.

---

## Lifecycle log events (the validation contract)

The container emits these via a `getLogger().child({ component: 'cycle-game' })` (inherits `sessionLog: true`), so they land in `media/logs/fitness/*.jsonl` and the E2E can assert them:

| event | data | when |
|-------|------|------|
| `cycle_game.home` | `{ courses, riderCount }` | idle/home shown |
| `cycle_game.staged` | `{ courseId, winCondition, goalM\|timeCapS, riders:[userId] }` | race configured/armed |
| `cycle_game.countdown` | `{ remaining }` | each countdown tick |
| `cycle_game.race_started` | `{ raceId, riders, winCondition }` | racing begins |
| `cycle_game.rider_dnf` | `{ raceId, userId, elapsedS }` | a rider is DNF'd |
| `cycle_game.race_finished` | `{ raceId, standings:[{userId,placement,finishTimeS,distanceM}] }` | finish |
| `cycle_game.race_saved` | `{ raceId, ok }` | record POSTed to `/cycle-races` |
| `cycle_game.cancelled` | `{ raceId\|null }` | cancel |

---

## File Structure

| File | Responsibility |
|------|----------------|
| `tests/_lib/FitnessSimHelper.mjs` (modify) | add `setEquipmentRider(page, equipmentId, userId)` + `getEquipmentRiders(page)` helpers |
| `tests/live/flow/fitness/cycle-game-lifecycle.runtime.test.mjs` (create) | **acceptance E2E** — distance race, time race, DNF |
| `tests/_lib/cycleGameLog.mjs` (create) | read + filter the fitness JSONL session log for assertions |
| `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx` (create) | live lifecycle container (controller + context + intervals + screens + save + logging) |
| `frontend/src/modules/Fitness/widgets/CycleGame/index.jsx` (create) | launcher + `manifest` (id `cycle_game`) |
| `frontend/src/modules/Fitness/index.js` (modify) | register `fitness:cycle-game` |

---

## Task 1: Acceptance E2E (write FIRST — must fail)

**Files:**
- Modify: `tests/_lib/FitnessSimHelper.mjs`
- Create: `tests/_lib/cycleGameLog.mjs`
- Create: `tests/live/flow/fitness/cycle-game-lifecycle.runtime.test.mjs`

- [ ] **Step 1: Add simulator + log helpers**

In `tests/_lib/FitnessSimHelper.mjs`, add (near the other standalone helpers):

```js
export async function setEquipmentRider(page, equipmentId, userId) {
  return page.evaluate(
    ([eq, u]) => window.__fitnessSimController.setEquipmentRider(eq, u),
    [equipmentId, userId]
  );
}
export async function getEquipmentRiders(page) {
  return page.evaluate(() => (window.__fitnessSimController.getEquipment() || [])
    .map((e) => ({ equipmentId: e.equipmentId, rider: e.rider })));
}
export async function launchCycleGame(page) {
  // The game registers as a fitness module widget; deep-link to its standalone route.
  await page.goto(`${(await page.evaluate(() => location.origin))}/fitness/module/cycle_game`);
}
```

Create `tests/_lib/cycleGameLog.mjs`:

```js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// media/logs/fitness/*.jsonl — newest file, filtered to cycle_game.* events
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');

export function readCycleGameEvents({ baseDir } = {}) {
  const dir = baseDir || process.env.DAYLIGHT_MEDIA_LOGS_FITNESS || path.join(ROOT, 'media/logs/fitness');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (files.length === 0) return [];
  const lines = fs.readFileSync(path.join(dir, files[0].f), 'utf8').split('\n').filter(Boolean);
  const events = [];
  for (const line of lines) {
    try { const e = JSON.parse(line); if (String(e.event || '').startsWith('cycle_game.')) events.push(e); } catch { /* skip */ }
  }
  return events;
}

export function hasEvent(events, name) { return events.some((e) => e.event === name); }
export function lastEvent(events, name) { return [...events].reverse().find((e) => e.event === name) || null; }
```

> Note: confirm the fitness JSONL path during execution (`media/logs/fitness/`); set `DAYLIGHT_MEDIA_LOGS_FITNESS` in the test env if the harness uses a different media root.

- [ ] **Step 2: Write the acceptance E2E**

Create `tests/live/flow/fitness/cycle-game-lifecycle.runtime.test.mjs`:

```js
/**
 * Cycle Game Lifecycle — Runtime acceptance test (TDD criterion for Plan 6).
 * Drives the dev simulator through full race lifecycles and asserts DOM + logs.
 */
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';
import { setRpm, setHR, getEquipment, setEquipmentRider, launchCycleGame } from '#testlib/FitnessSimHelper.mjs';
import { readCycleGameEvents, hasEvent, lastEvent } from '#testlib/cycleGameLog.mjs';

const BIKE = 'cycle_ace';      // cadence 49904
const BIKE2 = 'tricycle';      // cadence 7153

async function boot(page) {
  await page.goto(`${FRONTEND_URL}/fitness`);
  await page.waitForFunction(() => !!window.__fitnessSimController, null, { timeout: 30000 });
  await page.waitForFunction(() => (window.__fitnessSimController.getEquipment?.() || []).length > 0, null, { timeout: 15000 });
}

test.describe('Cycle game lifecycle (simulator-driven)', () => {
  test.setTimeout(180000);

  test('distance race: assign riders, race to goal, results + record saved', async ({ page }) => {
    await boot(page);
    const eq = await getEquipment(page);
    const rider1 = eq.find((e) => e.equipmentId === BIKE).eligibleUsers[0];
    const rider2 = eq.find((e) => e.equipmentId === BIKE2).eligibleUsers[0];

    await launchCycleGame(page);
    await expect(page.getByTestId('cycle-game-home')).toBeVisible({ timeout: 15000 });

    // assign riders + give them an HR zone so the multiplier applies
    await setEquipmentRider(page, BIKE, rider1);
    await setEquipmentRider(page, BIKE2, rider2);
    await setHR(page, eq.find((e) => e.equipmentId === BIKE).cadenceDeviceId, 0); // no-op safety
    // pick the first course (distance), stage, start
    await page.getByTestId(/^course-/).first().click();
    await page.getByTestId('cycle-game-start').click();

    // race screen appears (after countdown)
    await expect(page.getByTestId('cycle-race-screen')).toBeVisible({ timeout: 20000 });

    // drive both bikes hard until the race finishes
    for (let i = 0; i < 60; i++) {
      await setRpm(page, BIKE, 100);
      await setRpm(page, BIKE2, 100);
      if (await page.getByTestId('race-results').isVisible().catch(() => false)) break;
      await page.waitForTimeout(1000);
    }

    await expect(page.getByTestId('race-results')).toBeVisible({ timeout: 60000 });

    // logs: started, finished, saved
    await page.waitForTimeout(1500); // allow log flush
    const events = readCycleGameEvents();
    expect(hasEvent(events, 'cycle_game.race_started')).toBe(true);
    expect(hasEvent(events, 'cycle_game.race_finished')).toBe(true);
    const saved = lastEvent(events, 'cycle_game.race_saved');
    expect(saved?.data?.ok).toBe(true);
  });

  test('DNF: an idle rider is DNFd and the race still completes', async ({ page }) => {
    await boot(page);
    const eq = await getEquipment(page);
    const rider1 = eq.find((e) => e.equipmentId === BIKE).eligibleUsers[0];
    const rider2 = eq.find((e) => e.equipmentId === BIKE2).eligibleUsers[0];
    await launchCycleGame(page);
    await expect(page.getByTestId('cycle-game-home')).toBeVisible({ timeout: 15000 });
    await setEquipmentRider(page, BIKE, rider1);
    await setEquipmentRider(page, BIKE2, rider2);
    await page.getByTestId(/^course-/).first().click();
    await page.getByTestId('cycle-game-start').click();
    await expect(page.getByTestId('cycle-race-screen')).toBeVisible({ timeout: 20000 });

    // rider1 pedals; rider2 stays idle (rpm 0) → DNF; race still finishes
    for (let i = 0; i < 90; i++) {
      await setRpm(page, BIKE, 100);
      await setRpm(page, BIKE2, 0);
      if (await page.getByTestId('race-results').isVisible().catch(() => false)) break;
      await page.waitForTimeout(1000);
    }
    await expect(page.getByTestId('race-results')).toBeVisible({ timeout: 90000 });
    await page.waitForTimeout(1500);
    const events = readCycleGameEvents();
    expect(hasEvent(events, 'cycle_game.rider_dnf')).toBe(true);
    expect(hasEvent(events, 'cycle_game.race_finished')).toBe(true);
  });
});
```

- [ ] **Step 3: Run — must FAIL**

Run: `npx playwright test tests/live/flow/fitness/cycle-game-lifecycle.runtime.test.mjs --reporter=line`
Expected: FAIL (no `cycle-game-home` testid / route `/fitness/module/cycle_game` not registered). This proves the criterion is real before building.

- [ ] **Step 4: Commit the failing acceptance test**

```bash
git add tests/_lib/FitnessSimHelper.mjs tests/_lib/cycleGameLog.mjs tests/live/flow/fitness/cycle-game-lifecycle.runtime.test.mjs
git commit -m "test(cycle-game): simulator-driven E2E lifecycle acceptance (TDD, red)"
```

---

## Task 2: `CycleGameContainer` (make the E2E pass)

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx`
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/index.jsx`
- Modify: `frontend/src/modules/Fitness/index.js`

- [ ] **Step 1: Build the container**

`CycleGameContainer.jsx` responsibilities (the contract the E2E enforces — testids in **bold** must be present):

- Read `useFitnessContext()` for: the equipment catalog + `getEquipmentRider` (via `fitnessSessionInstance`), live `rpmDevices` (rpm by cadence device id), `roster`/per-user `heartRate`+`zoneId`, the `cycle_game` config (`courses`, `cadence_zones`, `hrless_multiplier`, `start_countdown_s`, `race_idle_dnf_s`, win-condition/goal defaults), `zones` (with `distance_multiplier`), and per-equipment `wheel_circumference_m`.
- Hold a `CycleRaceController` (Plan 4) created on stage from `buildRaceConfigFromCourse(course, {...liveOpts})` (Plan 5).
- **Phase rendering:** `idle` → `<CycleGameHome>` (**`cycle-game-home`**; course buttons already `course-{id}`; a **`cycle-game-start`** button stages+starts the selected course), `countdown` → `<CountdownStoplight>` (drive `countdownTick()` on a 1s interval), `racing` → `<CycleRaceScreen>` (**`cycle-race-screen`**; drive `controller.tick(liveInputs)` on a `race interval` — e.g. 1s — building `{userId:{rpm,zoneId}}` from the current rider→bike→rpm + rider HR zone), `finished`/`results` → `<RaceResults>` (**`race-results`**) and POST `buildRaceRecord(...)` to `/api/v1/fitness/cycle-races`.
- **Riders** = bikes that have a claimed rider (`getEquipmentRider`), with `wheelCircumferenceM` from equipment config; `riderLive[userId]` = `{ rpm, heartRate, zoneId, zoneColor, multiplier: zoneMultiplierFor(zoneId, zones, hrless) }`.
- **Logging:** emit the events from the contract table at each transition (use a `getLogger().child({ component: 'cycle-game' })`).
- Cancel button (**`cycle-game-cancel`**) → confirm → `controller.cancel()` → idle.

(Full reference implementation lives with this task during execution; it is integration glue whose correctness is asserted by the Task-1 E2E, not by unit tests. Keep each interval in a `useEffect` with cleanup; gate the tick on `phase === 'racing'`.)

- [ ] **Step 2: Register the launcher**

`index.jsx` exports the container as default + `export const manifest = { id: 'cycle_game', name: 'Cycle Game', icon: '🚴', description: 'Cycling races — solo, ghost, or live.' }`. In `frontend/src/modules/Fitness/index.js`, register `fitness:cycle-game` (and map legacy id `cycle_game` → `fitness:cycle-game`) so `/fitness/module/cycle_game` mounts it.

- [ ] **Step 3: Run the E2E — iterate until GREEN**

Run: `npx playwright test tests/live/flow/fitness/cycle-game-lifecycle.runtime.test.mjs --reporter=line`
Iterate on the container until both tests pass (race reaches results; logs show started/finished/saved; DNF test shows rider_dnf + finished). Use `page.screenshot()` / the JSONL on failure to debug (do NOT weaken assertions to pass — fix the container).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx frontend/src/modules/Fitness/widgets/CycleGame/index.jsx frontend/src/modules/Fitness/index.js
git commit -m "feat(cycle-game): live CycleGameContainer + widget launch + lifecycle logging"
```

---

## Task 3: Time-race lifecycle (extend the E2E)

- [ ] Add a third E2E case: select a **time-cap** course, drive both riders, assert the clock counts **down**, the race finishes at the cap, results show **distance**, and `race_finished`/`race_saved` logged. Iterate the container if needed. Commit.

---

## Build, Deploy, Execute

- [ ] **Run the full E2E green locally (dev server)** — all 3 cases pass.
- [ ] **Run the cycle-game unit suites** (Plans 1-5) to confirm no regression: vitest cycleGame dirs + jest cycle-race suites.
- [ ] **Build + deploy** (this host = prod, deploy-at-will per CLAUDE.local.md): `sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest --build-arg BUILD_TIME=... --build-arg COMMIT_HASH=$(git rev-parse --short HEAD) .` → `sudo docker stop daylight-station && sudo docker rm daylight-station` → `sudo deploy-daylight`. (This also makes the `cycle_game` config + new backend code live.)
- [ ] **Re-run the E2E against the deployed container** to confirm prod parity. Record results.

---

## Self-Review Notes

- **TDD:** Task 1 writes the simulator-driven E2E first (red) and is the acceptance criterion; Task 2/3 build the container to green. No assertion-weakening to pass.
- **Logging validated:** the contract events land in `media/logs/fitness/*.jsonl` (fitness logger `sessionLog: true`); the E2E reads them via `cycleGameLog.mjs`.
- **Reuse:** container composes Plan 2 `<CycleSpeedometer>`, Plan 4 `<CountdownStoplight>`/`<RaceResults>`/`CycleRaceController`, Plan 5 `<CycleGameHome>`/`<CycleRaceScreen>`/`buildRaceConfigFromCourse`/`buildRaceRecord`; drives via the simulator's new `setEquipmentRider`.
- **Deferred still:** ambient Plex video mount + count-up/sound polish + `CycleChallengeOverlay`→`<CycleSpeedometer>` dedup (cosmetic; not gating the E2E).
