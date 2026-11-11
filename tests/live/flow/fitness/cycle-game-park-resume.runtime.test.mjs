/**
 * Cycle Game — park and resume.
 *
 * Nobody is eliminated for stopping. A rider who stops pedalling for longer than
 * the park window is PARKED: their gauge shows the PARKED card and the log says
 * `cycle_game.rider_parked`. Pedalling again clears the card, their distance
 * grows again, and the log says `cycle_game.rider_resumed`. No screen says DNF.
 *
 * Two riders are driven so the race stays open while one of them is parked (a
 * race closes itself only when every live rider has been away for a while).
 * Needs a machine where the backend can run: it reads the fitness session log.
 */
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';
import { setRpm, launchCycleGame } from '#testlib/FitnessSimHelper.mjs';
import { waitForCycleEvent, readCycleGameEvents, hasEvent, eventTime } from '#testlib/cycleGameLog.mjs';

async function waitForController(page) {
  await page.waitForFunction(
    () => !!(window.__fitnessSimController && typeof window.__fitnessSimController.getEquipment === 'function'),
    null, { timeout: 45000 }
  );
}
const phaseOf = (page) => page.evaluate(() => window.__cycleGameControl?.getPhase?.() ?? null);
const raceState = (page) => page.evaluate(() => window.__cycleGameControl?.getRaceState?.() ?? null);

test.describe('Cycle Game — park and resume', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test.setTimeout(240000);

  test('a rider who stops is parked, pedalling again resumes them, nothing says DNF', async ({ page }) => {
    const since = Date.now() - 2000; // the page clock and this one share a machine
    await page.goto(`${FRONTEND_URL}/fitness`);
    await waitForController(page);
    await page.waitForFunction(() => ((window.__fitnessSimController?.getEquipment?.() || []).length > 0), null, { timeout: 15000 });
    await launchCycleGame(page);
    await waitForController(page);
    await expect(page.getByTestId('cycle-game-home')).toBeVisible({ timeout: 15000 });

    const assigns = await page.evaluate(() => window.__fitnessSimController.autoAssignRiders(2));
    expect(assigns.length, 'two bikes were claimed').toBe(2);
    const [bikeA, bikeB] = assigns.map((a) => a.equipmentId);
    const riderB = assigns[1].userId;
    await page.waitForFunction(() => window.__cycleGameControl?.ready === true, null, { timeout: 15000 });

    // A long time race so the race outlasts the park window.
    expect(await page.evaluate(() => window.__cycleGameControl.startRace({ winCondition: 'time', value: 240 })),
      'the start was accepted').toBe(true);

    // Both riders pedal from the start; poll the phase to green (staging and
    // the countdown take a few seconds).
    const greenBy = Date.now() + 40000;
    let phase = await phaseOf(page);
    while (Date.now() < greenBy && phase !== 'racing') {
      await setRpm(page, bikeA, 85);
      await setRpm(page, bikeB, 85);
      await page.waitForTimeout(250);
      phase = await phaseOf(page);
    }
    expect(phase, 'reached the race screen').toBe('racing');
    await expect(page.getByTestId('cycle-race-screen')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('cycle-speedometer-parked'), 'nobody is parked while both pedal').toHaveCount(0);

    // Rider B stops; rider A keeps going. Wait for the PARKED card (the park
    // window is the config's park_idle_s, 20 s by default; allow well over that).
    const parkBy = Date.now() + 90000;
    let parkedShown = false;
    while (Date.now() < parkBy) {
      await setRpm(page, bikeA, 85);
      await setRpm(page, bikeB, 0);
      if (await page.getByTestId('cycle-speedometer-parked').count() > 0) { parkedShown = true; break; }
      await page.waitForTimeout(1000);
    }
    expect(parkedShown, 'a stopped rider is shown the PARKED card').toBe(true);
    await expect(page.getByTestId('cycle-speedometer-parked')).toHaveCount(1);
    await expect(page.getByTestId('cycle-speedometer-parked')).toContainText('PARKED');
    await expect(page.getByTestId('cycle-race-screen')).not.toContainText('DNF');

    const parked = await waitForCycleEvent('cycle_game.rider_parked', (e) => e.data?.userId === riderB, { timeoutMs: 15000, since });
    expect(parked.data.raceId, 'the park event carries the race id').toBeTruthy();
    const parkedDistance = (await raceState(page)).riders.find((r) => r.userId === riderB).distanceM;

    // Rider B pedals again: the card goes and distance grows.
    const resumeBy = Date.now() + 30000;
    let cardGone = false;
    while (Date.now() < resumeBy) {
      await setRpm(page, bikeA, 85);
      await setRpm(page, bikeB, 85);
      if (await page.getByTestId('cycle-speedometer-parked').count() === 0) { cardGone = true; break; }
      await page.waitForTimeout(1000);
    }
    expect(cardGone, 'pedalling again clears the PARKED card').toBe(true);

    for (let i = 0; i < 6; i++) {
      await setRpm(page, bikeA, 85);
      await setRpm(page, bikeB, 85);
      await page.waitForTimeout(1000);
    }
    const resumedDistance = (await raceState(page)).riders.find((r) => r.userId === riderB).distanceM;
    expect(resumedDistance, 'distance grows again after the rider resumes').toBeGreaterThan(parkedDistance);

    const resumed = await waitForCycleEvent('cycle_game.rider_resumed', (e) => e.data?.userId === riderB, { timeoutMs: 15000, since });
    expect(resumed.data.raceId).toBe(parked.data.raceId);
    expect(resumed.data.awayS, 'the resume event says how long they were away').toBeGreaterThan(0);

    // Nothing in the whole run was called a DNF.
    const events = readCycleGameEvents().filter((e) => eventTime(e) >= since);
    expect(hasEvent(events, 'cycle_game.rider_dnf')).toBe(false);
    await expect(page.locator('body')).not.toContainText('DNF');

    // Leave the lobby clean for the next flow.
    await page.evaluate(() => window.__cycleGameControl.cancel());
    await expect(page.getByTestId('cycle-game-home')).toBeVisible({ timeout: 10000 });
  });
});
