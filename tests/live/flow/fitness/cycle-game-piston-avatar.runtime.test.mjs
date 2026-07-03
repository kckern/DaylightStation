/**
 * Cycle Game — POV-grid marker avatar aspect + horizontal grid lines.
 *
 * Guards two POV-grid regressions:
 *   1. The marker avatars must be 1:1 (a bare min-width with no min-height squishes
 *      the 34px markers into ellipses).
 *   2. The horizontal depth-lines (hlines) must render — they are the tron-road
 *      depth cues and confirm the grid backdrop is present.
 * Also screenshots the chart for visual review.
 *
 * Updated from the old piston-chart test: `.cg-pistons__head` → `.cg-pov__marker`,
 * `.cg-pistons__gridline` → `.cg-pov__hline`, `race-pistons` testid → `race-pov`.
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

test.describe('Cycle Game — POV marker avatar + grid', () => {
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  test.setTimeout(180000);

  test('POV marker avatars are 1:1 and the horizontal depth-lines render', async ({ page }) => {
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
    await page.evaluate(() => window.__cycleGameControl.startRace({ winCondition: 'time', value: 120 }));

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

    // The POV grid is in the race-pov testid (sidebar mode for 2 riders).
    await expect(page.getByTestId('race-pov')).toBeVisible({ timeout: 15000 });

    // Drive until the leader has real distance so markers are well placed.
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

    await page.screenshot({ path: `${SHOT_DIR}/pov-avatar-grid.png` });

    // Measure every POV marker avatar for 1:1 aspect using offsetWidth/offsetHeight
    // (layout coordinates, NOT getBoundingClientRect which returns the distorted
    // 2D projection of the 3D-rotated .cg-pov__plane and would always be non-square).
    // Also confirm the road renders: the depth grid moved from DOM `.cg-pov__hline`
    // elements to the three.js shader (pre-Phase-2 rewrite), so the modern
    // equivalents are the GL canvas plus the pooled DOM metre-mark labels.
    const m = await page.evaluate(() => {
      const ratios = [];
      document.querySelectorAll('.cg-pov__marker').forEach((marker) => {
        ['.circular-user-avatar', '.avatar-core', 'img'].forEach((sel) => {
          const el = marker.querySelector(sel);
          if (!el) return;
          const w = el.offsetWidth;
          const h = el.offsetHeight;
          if (w > 6 && h > 6) ratios.push({ sel, w, h, ratio: +(w / h).toFixed(3) });
        });
      });
      return {
        ratios,
        glCanvasCount: document.querySelectorAll('.cg-pov canvas').length,
        markLabelCount: document.querySelectorAll('.cg-pov__mark-label').length,
      };
    });

    // eslint-disable-next-line no-console
    console.log('POV_AVATAR', JSON.stringify(m, null, 2));

    expect(m.ratios.length, 'measured POV marker avatars').toBeGreaterThan(0);
    for (const r of m.ratios) {
      expect(r.ratio, `${r.sel} is ~1:1 (was ${r.w}x${r.h})`).toBeGreaterThan(0.95);
      expect(r.ratio, `${r.sel} is ~1:1 (was ${r.w}x${r.h})`).toBeLessThan(1.05);
    }
    expect(m.glCanvasCount, 'the three.js road canvas renders in the POV grid').toBeGreaterThan(0);
    expect(m.markLabelCount, 'metre-mark labels render along the POV road').toBeGreaterThan(0);
  });
});
