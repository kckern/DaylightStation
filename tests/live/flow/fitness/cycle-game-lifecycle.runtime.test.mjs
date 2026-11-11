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

// The sim controller is exposed via an effect and DELETED on unmount, so it is
// transiently undefined across full-page navigations (/fitness and
// /fitness/module/cycle_game). Every access right after a navigation must wait
// null-safely for it to be (re)exposed before touching its methods.
async function waitForController(page) {
  await page.waitForFunction(
    () => !!(window.__fitnessSimController && typeof window.__fitnessSimController.getEquipment === 'function'),
    null,
    { timeout: 30000 }
  );
}

async function boot(page) {
  await page.goto(`${FRONTEND_URL}/fitness`);
  await waitForController(page);
  await page.waitForFunction(
    () => ((window.__fitnessSimController?.getEquipment?.() || []).length > 0),
    null,
    { timeout: 15000 }
  );
}

// Launch the cycle game and wait for the controller to be re-exposed after the
// full-page navigation, so subsequent setEquipmentRider/setRpm calls are safe.
async function launchCycleGameSafe(page) {
  await launchCycleGame(page);
  await waitForController(page);
}

// Press Start. A claimed bike whose sensor has not reported yet makes the
// lobby's sensor check warn first; these flows start anyway (the sim sends
// cadence once the race is on).
async function pressStart(page) {
  await page.getByTestId('cycle-game-start').click();
  const anyway = page.getByTestId('sensor-warning-start');
  if (await anyway.isVisible().catch(() => false)) await anyway.click();
}

test.describe('Cycle game lifecycle (simulator-driven)', () => {
  // A time race runs the full configured cap (120 s) at a true 1 Hz tick, plus
  // boot + navigation + countdown + the per-iteration polling overhead. 180 s is
  // too tight for that lifecycle; give each case generous wall-clock headroom.
  test.setTimeout(300000);

  test('distance race: assign riders, race to goal, results + record saved', async ({ page }) => {
    await boot(page);
    const eq = await getEquipment(page);
    const rider1 = eq.find((e) => e.equipmentId === BIKE).eligibleUsers[0];
    const rider2 = eq.find((e) => e.equipmentId === BIKE2).eligibleUsers[0];

    await launchCycleGameSafe(page);
    await expect(page.getByTestId('cycle-game-home')).toBeVisible({ timeout: 15000 });

    // assign riders + give them an HR zone so the multiplier applies
    await setEquipmentRider(page, BIKE, rider1);
    await setEquipmentRider(page, BIKE2, rider2);
    await setHR(page, eq.find((e) => e.equipmentId === BIKE).cadenceDeviceId, 0); // no-op safety
    // pick the first course (distance), stage, start
    await page.getByTestId(/^course-/).first().click();
    await pressStart(page);

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

  test('parked: an idle rider is parked (never eliminated) and the race still completes', async ({ page }) => {
    await boot(page);
    const eq = await getEquipment(page);
    const rider1 = eq.find((e) => e.equipmentId === BIKE).eligibleUsers[0];
    const rider2 = eq.find((e) => e.equipmentId === BIKE2).eligibleUsers[0];
    await launchCycleGameSafe(page);
    await expect(page.getByTestId('cycle-game-home')).toBeVisible({ timeout: 15000 });
    await setEquipmentRider(page, BIKE, rider1);
    await setEquipmentRider(page, BIKE2, rider2);
    await page.getByTestId(/^course-/).first().click();
    await pressStart(page);
    await expect(page.getByTestId('cycle-race-screen')).toBeVisible({ timeout: 20000 });

    // rider1 pedals; rider2 stays idle (rpm 0) → parked after the start grace;
    // the race still finishes and nobody is shown DNF.
    for (let i = 0; i < 90; i++) {
      await setRpm(page, BIKE, 100);
      await setRpm(page, BIKE2, 0);
      if (await page.getByTestId('race-results').isVisible().catch(() => false)) break;
      await page.waitForTimeout(1000);
    }
    await expect(page.getByTestId('race-results')).toBeVisible({ timeout: 90000 });
    await page.waitForTimeout(1500);
    const events = readCycleGameEvents();
    expect(hasEvent(events, 'cycle_game.rider_parked')).toBe(true);
    expect(hasEvent(events, 'cycle_game.rider_dnf')).toBe(false);
    expect(hasEvent(events, 'cycle_game.race_finished')).toBe(true);
    await expect(page.getByTestId('race-results')).not.toContainText('DNF');
    await expect(page.getByTestId('race-results')).toContainText('Stopped at');
  });

  test('time race: clock counts down, finishes at cap, results show distance + saved', async ({ page }) => {
    await boot(page);
    const eq = await getEquipment(page);
    const rider1 = eq.find((e) => e.equipmentId === BIKE).eligibleUsers[0];
    const rider2 = eq.find((e) => e.equipmentId === BIKE2).eligibleUsers[0];
    await launchCycleGameSafe(page);
    await expect(page.getByTestId('cycle-game-home')).toBeVisible({ timeout: 15000 });
    await setEquipmentRider(page, BIKE, rider1);
    await setEquipmentRider(page, BIKE2, rider2);

    // a time-cap course is exposed with a stable testid
    await expect(page.getByTestId('course-time')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('course-time').click();
    await pressStart(page);

    await expect(page.getByTestId('cycle-race-screen')).toBeVisible({ timeout: 20000 });

    // capture the clock early — for a time race it must count DOWN toward 0
    await page.waitForTimeout(2000);
    const firstClock = await page.getByTestId('race-clock').textContent();
    const toSeconds = (mmss) => {
      const [m, s] = String(mmss || '0:0').split(':').map((n) => parseInt(n, 10) || 0);
      return m * 60 + s;
    };

    let clockDecreased = false;
    for (let i = 0; i < 150; i++) {
      // Break as soon as results render — once the race finishes the race-clock
      // element is unmounted, so reading it (with the default auto-wait) would
      // otherwise stall each post-finish iteration and exhaust the test budget.
      if (await page.getByTestId('race-results').isVisible().catch(() => false)) break;
      await setRpm(page, BIKE, 100);
      await setRpm(page, BIKE2, 100);
      const nowClock = await page.getByTestId('race-clock').textContent({ timeout: 1000 }).catch(() => null);
      if (nowClock != null && toSeconds(nowClock) < toSeconds(firstClock)) clockDecreased = true;
      await page.waitForTimeout(1000);
    }

    expect(clockDecreased).toBe(true);
    await expect(page.getByTestId('race-results')).toBeVisible({ timeout: 120000 });

    await page.waitForTimeout(1500);
    const events = readCycleGameEvents();
    const started = lastEvent(events, 'cycle_game.race_started');
    expect(started?.data?.winCondition).toBe('time');
    expect(hasEvent(events, 'cycle_game.race_finished')).toBe(true);
    const saved = lastEvent(events, 'cycle_game.race_saved');
    expect(saved?.data?.ok).toBe(true);
  });
});
