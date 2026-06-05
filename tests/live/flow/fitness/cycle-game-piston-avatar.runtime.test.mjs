/**
 * Cycle Game — piston-chart avatar aspect + grid backdrop.
 *
 * Guards two piston-chart regressions:
 *   1. The tip avatars must be 1:1 (a bare min-width with no min-height squished the
 *      38px markers into 48×38 ellipses).
 *   2. The panning grid must be the chart-wide BACKDROP, not per-lane texture inside
 *      the bars — so it reads as a tracking camera.
 * Also screenshots the chart for visual review.
 */
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';
import { setRpm, launchCycleGame } from '#testlib/FitnessSimHelper.mjs';
import fs from 'node:fs';

const SHOT_DIR = '/opt/Code/DaylightStation/tmp/cycle-flash-shots';

async function waitForController(page) {
  await page.waitForFunction(
    () => !!(window.__fitnessSimController && typeof window.__fitnessSimController.getEquipment === 'function'),
    null, { timeout: 45000 }
  );
}
const phaseOf = (page) => page.evaluate(() => window.__cycleGameControl?.getPhase?.() ?? null);
const raceState = (page) => page.evaluate(() => window.__cycleGameControl?.getRaceState?.() ?? null);

test.describe('Cycle Game — piston avatar + grid', () => {
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  test.setTimeout(180000);

  test('piston tip avatars are 1:1 and the grid is a chart-wide backdrop', async ({ page }) => {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.goto(`${FRONTEND_URL}/fitness`);
    await waitForController(page);
    await page.waitForFunction(() => ((window.__fitnessSimController?.getEquipment?.() || []).length > 0), null, { timeout: 15000 });
    await launchCycleGame(page);
    await waitForController(page);
    await expect(page.getByTestId('cycle-game-home')).toBeVisible({ timeout: 15000 });

    const assigns = await page.evaluate(() => window.__fitnessSimController.autoAssignRiders(2));
    const bikeIds = assigns.map((a) => a.equipmentId);
    await page.waitForFunction(() => window.__cycleGameControl?.ready === true, null, { timeout: 15000 });

    for (const id of bikeIds) await setRpm(page, id, 0);
    await page.evaluate(() => window.__cycleGameControl.startRace({ winCondition: 'time', value: 60 }));

    // Corrected green-light wait (ignore the transient initial idle).
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
    expect(phase).toBe('racing');
    // Hold across the first tick (no self-inflicted false start), then drive.
    for (const id of bikeIds) await setRpm(page, id, 0);
    await page.waitForTimeout(1400);

    await expect(page.getByTestId('race-pistons')).toBeVisible({ timeout: 15000 });

    // Drive until the leader has real distance so the tip markers are well placed.
    const stopEquipment = (id) => page.evaluate((e) => window.__fitnessSimController.stopEquipment(e), id);
    for (let i = 0; i < 18; i++) {
      const rs = await raceState(page);
      const riders = rs?.riders || [];
      for (let k = 0; k < bikeIds.length; k++) {
        const id = bikeIds[k];
        const r = riders.find((x) => x.equipmentId === id);
        if (r?.boxed) await stopEquipment(id); else await setRpm(page, id, 90 + k * 6);
      }
      const maxD = Math.max(0, ...riders.map((r) => r.distanceM || 0));
      if (maxD > 25) break;
      await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: `${SHOT_DIR}/piston-avatar-grid.png` });

    // Measure every piston-head avatar (container, core, img) for 1:1 aspect, and
    // confirm the grid backdrop is on the container (not the per-lane track).
    const m = await page.evaluate(() => {
      const ratios = [];
      document.querySelectorAll('.cg-pistons__head').forEach((head) => {
        ['.circular-user-avatar', '.avatar-core', 'img'].forEach((sel) => {
          const el = head.querySelector(sel);
          if (!el) return;
          const r = el.getBoundingClientRect();
          if (r.width > 6 && r.height > 6) ratios.push({ sel, w: Math.round(r.width), h: Math.round(r.height), ratio: +(r.width / r.height).toFixed(3) });
        });
      });
      const pistons = document.querySelector('.cg-pistons');
      const track = document.querySelector('.cg-pistons__track');
      const bg = (el) => el ? getComputedStyle(el, '::before').backgroundImage : null;
      return {
        ratios,
        containerHasGrid: !!pistons && (getComputedStyle(pistons, '::before').backgroundImage || '').includes('gradient'),
        trackHasGrid: !!track && (getComputedStyle(track).backgroundImage || '').includes('gradient')
      };
    });

    // eslint-disable-next-line no-console
    console.log('PISTON_AVATAR', JSON.stringify(m, null, 2));

    expect(m.ratios.length, 'measured piston-head avatars').toBeGreaterThan(0);
    for (const r of m.ratios) {
      expect(r.ratio, `${r.sel} is ~1:1 (was ${r.w}x${r.h})`).toBeGreaterThan(0.95);
      expect(r.ratio, `${r.sel} is ~1:1 (was ${r.w}x${r.h})`).toBeLessThan(1.05);
    }
    expect(m.containerHasGrid, 'panning grid is the chart-wide backdrop (on .cg-pistons::before)').toBe(true);
    expect(m.trackHasGrid, 'grid is NOT per-lane texture inside the bars (.cg-pistons__track)').toBe(false);
  });
});
