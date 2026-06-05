/**
 * Cycle Game Race — self-correcting sim feedback loop.
 *
 * Proves the contract the sim panel's closed-loop driver relies on:
 *   1. __cycleGameControl.getRaceState() exposes per-bike race state, including the
 *      false-start (penalty-boxed) flag — so a driver can SEE a wedged bike.
 *   2. The self-correction works: a deliberately induced false start (pedalling
 *      through the countdown) locks the meter (distance frozen at 0), and dropping
 *      the boxed bikes to RPM 0 clears the lock and lets the race progress.
 *
 * This is exactly what stops the sim from "train-wrecking down the course": the
 * panel observes the lock and backs off, instead of holding throttle (which keeps
 * the box shut for the whole race).
 */
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';
import { setRpm, launchCycleGame } from '#testlib/FitnessSimHelper.mjs';

async function waitForController(page) {
  await page.waitForFunction(
    () => !!(window.__fitnessSimController && typeof window.__fitnessSimController.getEquipment === 'function'),
    null, { timeout: 45000 }
  );
}
const raceState = (page) => page.evaluate(() => window.__cycleGameControl?.getRaceState?.() ?? null);
const phaseOf = (page) => page.evaluate(() => window.__cycleGameControl?.getPhase?.() ?? null);

test.describe('Cycle Game — self-correcting sim', () => {
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  test.setTimeout(180000);

  test('getRaceState exposes false-start; backing off to RPM 0 clears it and the race progresses', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/fitness`);
    await waitForController(page);
    await page.waitForFunction(
      () => ((window.__fitnessSimController?.getEquipment?.() || []).length > 0), null, { timeout: 15000 }
    );
    await launchCycleGame(page);
    await waitForController(page);
    await expect(page.getByTestId('cycle-game-home')).toBeVisible({ timeout: 15000 });

    const assigns = await page.evaluate(() => window.__fitnessSimController.autoAssignRiders(2));
    const bikeIds = assigns.map((a) => a.equipmentId);
    await page.waitForFunction(() => window.__cycleGameControl?.ready === true, null, { timeout: 15000 });

    // The readback API must exist.
    const hasApi = await page.evaluate(() => typeof window.__cycleGameControl?.getRaceState === 'function');
    expect(hasApi, 'getRaceState readback is exposed on __cycleGameControl').toBe(true);

    await page.evaluate(() => window.__cycleGameControl.startRace({ winCondition: 'time', value: 90 }));

    // INDUCE A FALSE START: pedal hard from the gun, re-sending every 200ms (cadence
    // freshness is per-message) so rpm > 0 is read at the first racing tick.
    const induceDeadline = Date.now() + 30000;
    let phase = await phaseOf(page);
    while (Date.now() < induceDeadline && phase !== 'racing') {
      for (const id of bikeIds) await setRpm(page, id, 110);
      await page.waitForTimeout(200);
      phase = await phaseOf(page);
    }
    expect(phase, 'race reached the green light').toBe('racing');
    // Keep pedalling briefly so the first racing tick definitely reads rpm > 0.
    for (let i = 0; i < 5; i++) { for (const id of bikeIds) await setRpm(page, id, 110); await page.waitForTimeout(200); }

    // CONFIRM the lock is visible via the readback (and that distance is frozen).
    let boxedSeen = false, frozenAtZero = false;
    for (let i = 0; i < 12 && !boxedSeen; i++) {
      const rs = await raceState(page);
      if (rs?.riders?.some((r) => r.boxed)) {
        boxedSeen = true;
        frozenAtZero = rs.riders.filter((r) => r.boxed).every((r) => (r.distanceM | 0) === 0);
      }
      if (!boxedSeen) await page.waitForTimeout(500);
    }
    expect(boxedSeen, 'getRaceState surfaced a penalty-boxed (false-started) bike').toBe(true);
    expect(frozenAtZero, 'a boxed bike has its meter locked at 0 m').toBe(true);

    // SELF-CORRECT: exactly what the sim panel now does — boxed → RPM 0 (the box
    // opens only at rest), everyone else drives. Loop until nobody is boxed.
    let allClear = false;
    for (let i = 0; i < 30 && !allClear; i++) {
      const rs = await raceState(page);
      const riders = rs?.riders || [];
      for (const id of bikeIds) {
        const r = riders.find((x) => x.equipmentId === id);
        await setRpm(page, id, r?.boxed ? 0 : 100); // back off if locked, else drive
      }
      allClear = riders.length > 0 && riders.every((r) => !r.boxed);
      if (!allClear) await page.waitForTimeout(1000);
    }
    expect(allClear, 'backing off to RPM 0 cleared the false-start lock').toBe(true);

    // CONFIRM PROGRESS: once unlocked and driving, distance must actually advance.
    const before = await raceState(page);
    const distBefore = Math.max(0, ...(before?.riders || []).map((r) => r.distanceM || 0));
    for (let i = 0; i < 8; i++) {
      for (const id of bikeIds) await setRpm(page, id, 100);
      await page.waitForTimeout(1000);
    }
    const after = await raceState(page);
    const distAfter = Math.max(0, ...(after?.riders || []).map((r) => r.distanceM || 0));

    // eslint-disable-next-line no-console
    console.log('SELF_CORRECT_REPORT', JSON.stringify({
      boxedSeen, frozenAtZero, clearedAfterBackoff: allClear, distBefore, distAfter
    }));

    expect(distAfter - distBefore, 'race progresses after the lock is cleared').toBeGreaterThan(10);
  });
});
