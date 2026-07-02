/**
 * Cycle Game — featured-course ladder card (weekly time-trial ladder).
 *
 * The lobby's featured-course card surfaces this ISO week's active course
 * (config: cycle_game.featured_courses / featured_course_override) with a
 * "Ride It" button. This is a live guard that the card renders on the real
 * lobby and that clicking Ride It — with a rider assigned to a bike, the
 * same way the sibling sim tests do — actually starts the race flow
 * (staging phase appears). With NO rider assigned, Ride It is a no-op
 * (startRace warns no_riders and stays idle), so a rider must be claimed
 * first for the assertion to be real.
 *
 * The ladder itself may be empty for the active course (shows "No rides
 * yet this week") — this test does not assert on specific standings.
 */
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';
import { getEquipment, setEquipmentRider, launchCycleGame } from '#testlib/FitnessSimHelper.mjs';

const BIKE = 'cycle_ace'; // cadence 49904

// The sim controller is exposed via an effect and DELETED on unmount, so it is
// transiently undefined across full-page navigations. Every access right
// after a navigation must wait null-safely for it to be (re)exposed before
// touching its methods.
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

async function launchCycleGameSafe(page) {
  await launchCycleGame(page);
  await waitForController(page);
}

test.describe('Cycle game — featured-course ladder card', () => {
  test.setTimeout(90000);

  test('featured-course ladder: card renders and Ride It reaches staging', async ({ page }) => {
    await boot(page);
    const eq = await getEquipment(page);
    const rider = eq.find((e) => e.equipmentId === BIKE).eligibleUsers[0];

    await launchCycleGameSafe(page);
    await expect(page.getByTestId('cycle-game-home')).toBeVisible({ timeout: 15000 });

    // The card renders on the lobby regardless of ladder content (config from
    // Step 1 guarantees a featured course is active).
    const card = page.getByTestId('featured-course-card');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('featured-ride')).toBeVisible();

    // Claim a rider on a bike — the same mechanism the sibling sim tests use.
    // Without an assigned rider, Ride It no-ops (startRace warns no_riders).
    await setEquipmentRider(page, BIKE, rider);

    await card.getByTestId('featured-ride').click();

    await expect(page.getByTestId('cycle-game-staging')).toBeVisible({ timeout: 5000 });
  });
});
