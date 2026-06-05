/**
 * Cycle Game Race — autostart drives the race to a healthy finish.
 *
 * End-to-end guard for the sim panel's "🚴 Cycle Game Race" button: it must HOLD
 * bikes at 0 through the countdown, survive the transient initial 'idle', then
 * close the loop and actually drive the bikes — so the field finishes with real
 * distance instead of sitting at RPM 0 and idle-DNF'ing (the failure the logs
 * showed: both riders DNF at the 20s idle cutoff, race never driven).
 *
 * Mirrors the corrected runCycleGameRace driver against the live bridge.
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
const phaseOf = (page) => page.evaluate(() => window.__cycleGameControl?.getPhase?.() ?? null);
const raceState = (page) => page.evaluate(() => window.__cycleGameControl?.getRaceState?.() ?? null);

test.describe('Cycle Game — autostart drive', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test.setTimeout(180000);

  test('held bikes are driven to a healthy finish (no idle-DNF)', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/fitness`);
    await waitForController(page);
    await page.waitForFunction(() => ((window.__fitnessSimController?.getEquipment?.() || []).length > 0), null, { timeout: 15000 });
    await launchCycleGame(page);
    await waitForController(page);
    await expect(page.getByTestId('cycle-game-home')).toBeVisible({ timeout: 15000 });

    const assigns = await page.evaluate(() => window.__fitnessSimController.autoAssignRiders(2));
    const bikeIds = assigns.map((a) => a.equipmentId);
    await page.waitForFunction(() => window.__cycleGameControl?.ready === true, null, { timeout: 15000 });

    // HOLD bikes at 0 through staging+countdown (no false start), then start.
    for (const id of bikeIds) await setRpm(page, id, 0);
    await page.evaluate(() => window.__cycleGameControl.startRace({ winCondition: 'time', value: 25 }));

    // CORRECTED green-light wait: ignore the transient initial 'idle'.
    const greenBy = Date.now() + 30000;
    let phase = await phaseOf(page);
    let sawStart = false;
    while (Date.now() < greenBy && phase !== 'racing') {
      if (phase === 'staging' || phase === 'countdown') sawStart = true;
      if (phase === 'results') break;
      if (phase === 'idle' && sawStart) break;
      for (const id of bikeIds) await setRpm(page, id, 0); // keep holding at 0
      await page.waitForTimeout(200);
      phase = await phaseOf(page);
    }
    expect(phase, 'reached the green light').toBe('racing');

    // Hold 0 across the first engine tick (render 'racing' precedes the engine's
    // first-tick green-light check by up to one interval) so we don't self-inflict a
    // false start, THEN drive.
    for (const id of bikeIds) await setRpm(page, id, 0);
    await page.waitForTimeout(1400);

    // CLOSED-LOOP DRIVE until results: boxed → force cadence stale (reliable clear),
    // else drive.
    const stopEquipment = (id) => page.evaluate((e) => window.__fitnessSimController.stopEquipment(e), id);
    const stopBy = Date.now() + 60000;
    while (Date.now() < stopBy) {
      phase = await phaseOf(page);
      if (!phase || phase === 'results' || phase === 'idle') break;
      const rs = await raceState(page);
      const riders = rs?.riders || [];
      for (let i = 0; i < bikeIds.length; i++) {
        const id = bikeIds[i];
        const r = riders.find((x) => x.equipmentId === id);
        if (r?.boxed) await stopEquipment(id);
        else await setRpm(page, id, r?.finished ? 0 : 85 + i * 5);
      }
      await page.waitForTimeout(1000);
    }

    // The race finished, and the bikes were actually driven — at least one rider
    // accumulated real distance (would be 0 across the board on an idle-DNF).
    const fin = await raceState(page);
    const maxDist = Math.max(0, ...(fin?.riders || []).map((r) => r.distanceM || 0));
    // eslint-disable-next-line no-console
    console.log('AUTOSTART_DRIVE', JSON.stringify({ finalPhase: phase, riders: fin?.riders?.map((r) => ({ u: r.userId, d: r.distanceM, fin: r.finished })) , maxDist }));

    expect(maxDist, 'the field was driven and accumulated real distance (not idle-DNF at 0)').toBeGreaterThan(30);
  });
});
