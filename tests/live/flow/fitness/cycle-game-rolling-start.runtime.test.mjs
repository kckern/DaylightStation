/**
 * Cycle Game Race — rolling start.
 *
 * Pedalling before the green light is allowed and simply counts for nothing
 * until green. This flow pedals the bikes through the whole "to your bikes"
 * buffer and the stoplight countdown and proves:
 *   1. Staging advances to the countdown on time while the bikes are turning
 *      (there is no "stop pedalling" gate).
 *   2. No distance is credited before green.
 *   3. Distance counts from green with no lock: nobody is held back for having
 *      pedalled early.
 * It reads the race through __cycleGameControl.getRaceState(), the same readback
 * the sim panel's driver uses.
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

test.describe('Cycle Game — rolling start', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test.setTimeout(180000);

  test('pedalling through staging and the countdown neither holds the start nor locks the meter', async ({ page }) => {
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

    for (const id of bikeIds) await setRpm(page, id, 100);
    await page.evaluate(() => window.__cycleGameControl.startRace({ winCondition: 'time', value: 90 }));

    // Keep pedalling the whole way to green. The old stop-pedalling gate held
    // the race on the staging screen for as long as any bike turned.
    let phase = await phaseOf(page);
    let sawStaged = false;
    let creditedBeforeGreen = 0;
    const greenBy = Date.now() + 30000;
    while (Date.now() < greenBy && phase !== 'racing') {
      if (phase === 'staging' || phase === 'countdown' || phase === 'go') sawStaged = true;
      for (const id of bikeIds) await setRpm(page, id, 100);
      if (phase === 'staging' || phase === 'countdown') {
        const rs = await raceState(page);
        creditedBeforeGreen = Math.max(creditedBeforeGreen, ...(rs?.riders || []).map((r) => r.distanceM || 0));
      }
      await page.waitForTimeout(150);
      phase = await phaseOf(page);
    }
    expect(sawStaged, 'the race was staged').toBe(true);
    expect(creditedBeforeGreen, 'no distance is credited before green').toBe(0);
    expect(phase, 'pedalling did not hold the start: the race reached green').toBe('racing');

    // Distance counts from green for every live bike.
    for (let i = 0; i < 6; i++) {
      for (const id of bikeIds) await setRpm(page, id, 100);
      await page.waitForTimeout(1000);
    }
    const rs = await raceState(page);
    const live = (rs?.riders || []).filter((r) => !r.isGhost && bikeIds.includes(r.equipmentId));
    // eslint-disable-next-line no-console
    console.log('ROLLING_START_REPORT', JSON.stringify({ sawStaged, creditedBeforeGreen, riders: live.map((r) => ({ u: r.userId, d: r.distanceM })) }));
    expect(live.length, 'both staged bikes are in the race').toBe(bikeIds.length);
    live.forEach((r) => {
      expect(r.distanceM, `${r.userId} is credited from green`).toBeGreaterThan(10);
      expect(r, 'the readback carries no penalty fields').not.toHaveProperty('boxed');
    });
  });
});
