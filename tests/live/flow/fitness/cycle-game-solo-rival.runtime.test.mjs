/**
 * Cycle Game — a lone rider races an automatic pace rival.
 *
 * One rider and no ghost picked: the game picks a rival itself (own best at this
 * race type and length, else the household best, else a constant par pace) and
 * logs `cycle_game.pace_rival`. The race screen uses the solo layout (a pace
 * delta panel, no standings tower). The results board compares the ride with the
 * rival, and "Race again" starts a second race with a new race id.
 *
 * A lone rider's start waits up to 1500 ms on the server's rival lookup, so the
 * flow polls the phase instead of expecting a synchronous start.
 * Needs a machine where the backend can run: it reads the fitness session log.
 */
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';
import { setRpm, launchCycleGame } from '#testlib/FitnessSimHelper.mjs';
import { waitForCycleEvent } from '#testlib/cycleGameLog.mjs';

async function waitForController(page) {
  await page.waitForFunction(
    () => !!(window.__fitnessSimController && typeof window.__fitnessSimController.getEquipment === 'function'),
    null, { timeout: 45000 }
  );
}
const phaseOf = (page) => page.evaluate(() => window.__cycleGameControl?.getPhase?.() ?? null);

// Pedal until the phase reaches `target` (staging, the countdown and the rival
// lookup all come first). Fails loudly when it does not.
async function pedalUntilPhase(page, bikeId, target, timeoutMs) {
  const by = Date.now() + timeoutMs;
  let phase = await phaseOf(page);
  while (Date.now() < by && phase !== target) {
    await setRpm(page, bikeId, 90);
    await page.waitForTimeout(250);
    phase = await phaseOf(page);
  }
  expect(phase, `reached phase ${target}`).toBe(target);
}

test.describe('Cycle Game — solo rider and the pace rival', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test.setTimeout(300000);

  test('a lone rider gets a pace rival, the solo layout, a comparison, and a rematch', async ({ page }) => {
    const since = Date.now() - 2000; // the page clock and this one share a machine
    await page.goto(`${FRONTEND_URL}/fitness`);
    await waitForController(page);
    await page.waitForFunction(() => ((window.__fitnessSimController?.getEquipment?.() || []).length > 0), null, { timeout: 15000 });
    await launchCycleGame(page);
    await waitForController(page);
    await expect(page.getByTestId('cycle-game-home')).toBeVisible({ timeout: 15000 });

    const assigns = await page.evaluate(() => window.__fitnessSimController.autoAssignRiders(1));
    expect(assigns.length, 'exactly one bike was claimed').toBe(1);
    const bike = assigns[0].equipmentId;
    await page.waitForFunction(() => window.__cycleGameControl?.ready === true, null, { timeout: 15000 });

    // A rival is opt-in: switch on "Race my best" the way a rider would.
    await page.getByTestId('race-my-best').click();
    await expect(page.getByTestId('race-my-best')).toHaveAttribute('aria-checked', 'true');
    // No ghost is picked: the seam starts a plain course.
    expect(await page.evaluate(() => window.__cycleGameControl.startRace({ winCondition: 'time', value: 60 })),
      'the start was accepted').toBe(true);
    await pedalUntilPhase(page, bike, 'racing', 45000);
    await expect(page.getByTestId('cycle-race-screen')).toBeVisible({ timeout: 10000 });

    // Solo layout: pace delta, no standings tower.
    await expect(page.getByTestId('race-layout')).toHaveAttribute('data-mode', 'solo');
    await expect(page.getByTestId('pace-delta')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('standings-tower')).toHaveCount(0);

    const started = await waitForCycleEvent('cycle_game.race_started', () => true, { timeoutMs: 15000, since });
    const firstRaceId = started.data.raceId;
    expect(firstRaceId).toBeTruthy();
    const rival = await waitForCycleEvent('cycle_game.pace_rival', (e) => e.data?.raceId === firstRaceId, { timeoutMs: 15000, since });
    expect(['self', 'household', 'par'], 'the rival kind is one of the three').toContain(rival.data.kind);

    // Ride to the time cap.
    const doneBy = Date.now() + 120000;
    while (Date.now() < doneBy && !(await page.getByTestId('race-results').isVisible().catch(() => false))) {
      await setRpm(page, bike, 90);
      await page.waitForTimeout(1000);
    }
    await expect(page.getByTestId('race-results')).toBeVisible({ timeout: 10000 });

    // The board compares the ride: the versus sentence, or a comparison line
    // against the rider's own history.
    const versus = page.getByTestId('race-results-versus');
    const compare = page.locator('[data-testid^="result-compare-"]');
    await expect(versus.or(compare.first()), 'the board shows a versus sentence or a comparison line').toBeVisible({ timeout: 10000 });

    // Race again: a second race with a new race id.
    await page.getByTestId('race-results-rematch').click();
    await pedalUntilPhase(page, bike, 'racing', 60000);
    const second = await waitForCycleEvent('cycle_game.race_started', (e) => e.data?.raceId !== firstRaceId, { timeoutMs: 15000, since });
    expect(second.data.raceId, 'the rematch has its own race id').not.toBe(firstRaceId);
    await waitForCycleEvent('cycle_game.rematch', (e) => e.data?.fromRaceId === firstRaceId, { timeoutMs: 15000, since });

    await page.evaluate(() => window.__cycleGameControl.cancel());
    await expect(page.getByTestId('cycle-game-home')).toBeVisible({ timeout: 10000 });
  });
});
