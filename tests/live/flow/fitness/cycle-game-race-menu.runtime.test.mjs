/**
 * Cycle Game — the race menu is the only way to stop a race.
 *
 * During a race nothing destructive is one tap away: a corner button opens a
 * sheet, and its items ignore taps for a short guard after it opens.
 *  - "End race here" closes the race where it stands: the results board says it
 *    was ended early, the record is saved as incomplete, and the weekly ladder
 *    does not move.
 *  - "Discard race" returns to the lobby and saves nothing.
 * The app's navigation rail is hidden for the whole race and back in the lobby.
 *
 * Needs a machine where the backend can run: it reads the fitness session log
 * and the saved-race API.
 */
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';
import { setRpm, launchCycleGame } from '#testlib/FitnessSimHelper.mjs';
import { waitForCycleEvent, readCycleGameEvents, eventTime } from '#testlib/cycleGameLog.mjs';

const GUARD_MS = 600; // RACE_MENU_GUARD_MS in RaceMenu.jsx
const RAIL = '.fitness-navbar';

async function waitForController(page) {
  await page.waitForFunction(
    () => !!(window.__fitnessSimController && typeof window.__fitnessSimController.getEquipment === 'function'),
    null, { timeout: 45000 }
  );
}
const phaseOf = (page) => page.evaluate(() => window.__cycleGameControl?.getPhase?.() ?? null);

// Start a 4-minute time race with both bikes pedalling, wait for the race
// screen, and pedal a few seconds more so the ride has real distance.
async function startAndRide(page, bikes) {
  expect(await page.evaluate(() => window.__cycleGameControl.startRace({ winCondition: 'time', value: 240 })),
    'the start was accepted').toBe(true);
  const by = Date.now() + 40000;
  let phase = await phaseOf(page);
  while (Date.now() < by && phase !== 'racing') {
    for (const id of bikes) await setRpm(page, id, 85);
    await page.waitForTimeout(250);
    phase = await phaseOf(page);
  }
  expect(phase, 'reached the race screen').toBe('racing');
  await expect(page.getByTestId('cycle-race-screen')).toBeVisible({ timeout: 10000 });
  for (let i = 0; i < 6; i++) {
    for (const id of bikes) await setRpm(page, id, 85);
    await page.waitForTimeout(1000);
  }
}

async function ladderSnapshot(request) {
  const resp = await request.get(`${FRONTEND_URL}/api/v1/fitness/cycle-races/ladder`);
  return { status: resp.status(), body: await resp.json() };
}

test.describe('Cycle Game — race menu', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test.setTimeout(300000);

  test('End race here saves an incomplete ride; Discard saves nothing', async ({ page, request }) => {
    const since = Date.now() - 2000; // the page clock and this one share a machine
    await page.goto(`${FRONTEND_URL}/fitness`);
    await waitForController(page);
    await page.waitForFunction(() => ((window.__fitnessSimController?.getEquipment?.() || []).length > 0), null, { timeout: 15000 });
    await launchCycleGame(page);
    await waitForController(page);
    await expect(page.getByTestId('cycle-game-home')).toBeVisible({ timeout: 15000 });

    const assigns = await page.evaluate(() => window.__fitnessSimController.autoAssignRiders(2));
    expect(assigns.length, 'two bikes were claimed').toBe(2);
    const bikes = assigns.map((a) => a.equipmentId);
    await page.waitForFunction(() => window.__cycleGameControl?.ready === true, null, { timeout: 15000 });

    // The lobby has no race menu and keeps the app's navigation rail.
    await expect(page.getByTestId('race-menu-open')).toHaveCount(0);
    await expect(page.locator(RAIL)).toHaveCount(1);

    const ladderBefore = await ladderSnapshot(request);

    // ── race 1: end it here ────────────────────────────────────────────────
    await startAndRide(page, bikes);
    await expect(page.locator(RAIL), 'the navigation rail is hidden during the race').toHaveCount(0);
    const started = await waitForCycleEvent('cycle_game.race_started', () => true, { timeoutMs: 15000, since });
    const endedId = started.data.raceId;

    // No single-tap way out: the sheet's items do not exist until it is open.
    await expect(page.getByTestId('race-menu-end')).toHaveCount(0);
    await expect(page.getByTestId('race-menu-discard')).toHaveCount(0);

    await page.getByTestId('race-menu-open').click();
    // A tap inside the guard window does nothing.
    await page.getByTestId('race-menu-end').click();
    expect(await phaseOf(page), 'a tap inside the guard did not end the race').toBe('racing');
    await page.waitForTimeout(GUARD_MS + 200);
    await page.getByTestId('race-menu-end').click();

    await expect(page.getByTestId('race-results')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('race-results')).toContainText('Ended early', { timeout: 15000 });
    await waitForCycleEvent('cycle_game.ended_early', (e) => e.data?.raceId === endedId, { timeoutMs: 15000, since });
    const saved = await waitForCycleEvent('cycle_game.race_saved', (e) => e.data?.raceId === endedId, { timeoutMs: 20000, since });
    expect(saved.data.ok, 'the ended-early ride was saved').toBe(true);

    const record = await request.get(`${FRONTEND_URL}/api/v1/fitness/cycle-races/${endedId}`);
    expect(record.status(), 'the saved race can be read back').toBe(200);
    const body = await record.json();
    expect(body.race.race.incomplete, 'the saved record is marked incomplete').toBe(true);

    expect(await ladderSnapshot(request), 'an ended-early ride does not move the ladder').toEqual(ladderBefore);

    // Out of the results board and back to the lobby, with the rail back.
    await page.getByTestId('race-results-exit').click();
    await expect(page.getByTestId('cycle-game-home')).toBeVisible({ timeout: 15000 });
    await expect(page.locator(RAIL)).toHaveCount(1);

    // ── race 2: discard it ─────────────────────────────────────────────────
    await startAndRide(page, bikes);
    const second = await waitForCycleEvent('cycle_game.race_started', (e) => e.data?.raceId !== endedId, { timeoutMs: 15000, since });
    const discardedId = second.data.raceId;

    await page.getByTestId('race-menu-open').click();
    await page.waitForTimeout(GUARD_MS + 200);
    await page.getByTestId('race-menu-discard').click();

    await expect(page.getByTestId('cycle-game-home')).toBeVisible({ timeout: 15000 });
    await expect(page.locator(RAIL)).toHaveCount(1);
    await waitForCycleEvent('cycle_game.cancelled', (e) => e.data?.raceId === discardedId, { timeoutMs: 15000, since });

    // Give a (wrong) save time to land before checking that none did.
    await page.waitForTimeout(3000);
    const events = readCycleGameEvents().filter((e) => eventTime(e) >= since);
    expect(events.some((e) => e.event === 'cycle_game.race_saved' && e.data?.raceId === discardedId),
      'a discarded race is never saved').toBe(false);
    expect(events.some((e) => e.event === 'cycle_game.race_finished' && e.data?.raceId === discardedId),
      'a discarded race never finished').toBe(false);
    const gone = await request.get(`${FRONTEND_URL}/api/v1/fitness/cycle-races/${discardedId}`);
    expect(gone.status(), 'nothing was saved for the discarded race').toBe(404);
  });
});
