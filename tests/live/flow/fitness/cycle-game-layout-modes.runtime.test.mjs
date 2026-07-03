/**
 * Cycle Game Race — layout mode assertions (sidebar vs. wide).
 *
 * Guards the RaceLayoutManager data-mode attribute and the presence/absence
 * of zone-oval depending on field size:
 *  - 2 riders → data-mode="sidebar", race-pov visible, zone-oval visible.
 *  - 4 riders → data-mode="wide",   race-pov visible, zone-oval absent.
 *
 * Boot+drive flow copied from cycle-game-autostart-drive.runtime.test.mjs.
 */
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';
import { setRpm, launchCycleGame } from '#testlib/FitnessSimHelper.mjs';
import fs from 'node:fs';

const SHOT = '/opt/Code/DaylightStation/tmp/cycle-layout-shots';

async function waitForController(page) {
  await page.waitForFunction(
    () => !!(window.__fitnessSimController && typeof window.__fitnessSimController.getEquipment === 'function'),
    null, { timeout: 45000 }
  );
}
const phaseOf = (page) => page.evaluate(() => window.__cycleGameControl?.getPhase?.() ?? null);
const raceState = (page) => page.evaluate(() => window.__cycleGameControl?.getRaceState?.() ?? null);

/**
 * Boot the fitness page, launch cycle game, assign N riders, start a 120s race,
 * and wait for green light (ignoring transient initial 'idle'). Returns bikeIds.
 * The caller is responsible for driving and asserting — this just gets to racing.
 */
async function bootToRacing(page, riderCount) {
  fs.mkdirSync(SHOT, { recursive: true });

  await page.goto(`${FRONTEND_URL}/fitness`);
  await waitForController(page);
  await page.waitForFunction(
    () => ((window.__fitnessSimController?.getEquipment?.() || []).length > 0),
    null, { timeout: 15000 }
  );
  await launchCycleGame(page);
  await waitForController(page);
  await expect(page.getByTestId('cycle-game-home')).toBeVisible({ timeout: 15000 });

  const assigns = await page.evaluate(
    (n) => window.__fitnessSimController.autoAssignRiders(n),
    riderCount
  );
  const bikeIds = assigns.map((a) => a.equipmentId);

  await page.waitForFunction(
    () => window.__cycleGameControl?.ready === true,
    null, { timeout: 15000 }
  );

  // HOLD bikes at 0 through staging+countdown to avoid a self-inflicted false start.
  for (const id of bikeIds) await setRpm(page, id, 0);
  // Use 120s race so there's ample time for layout assertions + some driving.
  await page.evaluate(() => window.__cycleGameControl.startRace({ winCondition: 'time', value: 120 }));

  // CORRECTED green-light wait: ignore the transient initial 'idle'.
  const greenBy = Date.now() + 30000;
  let phase = await phaseOf(page);
  let sawStart = false;
  while (Date.now() < greenBy && phase !== 'racing') {
    if (phase === 'staging' || phase === 'countdown') sawStart = true;
    if (phase === 'results') break;
    if (phase === 'idle' && sawStart) break;
    for (const id of bikeIds) await setRpm(page, id, 0);
    await page.waitForTimeout(200);
    phase = await phaseOf(page);
  }
  expect(phase, 'reached the green light').toBe('racing');

  // Hold 0 across the first engine tick to avoid a self-inflicted false start.
  for (const id of bikeIds) await setRpm(page, id, 0);
  await page.waitForTimeout(1400);

  return bikeIds;
}

test.describe('Cycle Game — layout modes', () => {
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  test.setTimeout(180000);

  test('2 riders → sidebar mode (chart+speedo main, POV + standings tower)', async ({ page }) => {
    const bikeIds = await bootToRacing(page, 2);

    // Assert layout immediately at racing phase — layout is set by field size, not distance.
    // Phase 2 (T8): the standings tower replaced the oval in the live panel map.
    await expect(page.getByTestId('race-layout')).toHaveAttribute('data-mode', 'sidebar');
    await expect(page.getByTestId('race-pov')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('zone-tower')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('standings-tower')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('zone-oval')).toHaveCount(0);

    await page.screenshot({ path: `${SHOT}/sidebar.png` });
    // eslint-disable-next-line no-console
    console.log('LAYOUT_MODE_SIDEBAR', { mode: 'sidebar', screenshot: `${SHOT}/sidebar.png` });

    // Drive briefly to confirm the race stays live (not just asserting during staging).
    const stopEquipment = (id) => page.evaluate((e) => window.__fitnessSimController.stopEquipment(e), id);
    for (let i = 0; i < 5; i++) {
      const phase = await phaseOf(page);
      if (!phase || phase === 'results' || phase === 'idle') break;
      const rs = await raceState(page);
      for (let k = 0; k < bikeIds.length; k++) {
        const id = bikeIds[k];
        const r = (rs?.riders || []).find((x) => x.equipmentId === id);
        if (r?.boxed) await stopEquipment(id); else await setRpm(page, id, 85 + k * 5);
      }
      await page.waitForTimeout(1000);
    }
    const fin = await raceState(page);
    const maxDist = Math.max(0, ...(fin?.riders || []).map((r) => r.distanceM || 0));
    expect(maxDist, 'riders accumulated real distance').toBeGreaterThan(10);
  });

  test('4 riders → wide mode (chart|POV top row, full-width speedo, standings tower column, no oval)', async ({ page }) => {
    const bikeIds = await bootToRacing(page, 4);

    if (bikeIds.length < 4) {
      // Hard fail — the sim must expose ≥4 cycle bikes (niceday, cycle_ace, tricycle, ab_roller).
      // This is NOT a silent skip: it indicates a config problem.
      throw new Error(
        `Wide-mode test requires 4 riders but autoAssignRiders(4) only assigned ${bikeIds.length}. ` +
        'Check that 4 cycle-capable bikes are configured in the sim (niceday, cycle_ace, tricycle, ab_roller).'
      );
    }

    // Assert layout immediately at racing phase — layout is set by field size, not distance.
    await expect(page.getByTestId('race-layout')).toHaveAttribute('data-mode', 'wide');
    await expect(page.getByTestId('race-pov')).toBeVisible({ timeout: 5000 });
    // Phase 2 (T8): wide mode gains the standings tower column; the oval is gone.
    await expect(page.getByTestId('zone-tower')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('zone-oval')).toHaveCount(0);

    await page.screenshot({ path: `${SHOT}/wide.png` });
    // eslint-disable-next-line no-console
    console.log('LAYOUT_MODE_WIDE', { mode: 'wide', riders: bikeIds.length, screenshot: `${SHOT}/wide.png` });
  });
});
