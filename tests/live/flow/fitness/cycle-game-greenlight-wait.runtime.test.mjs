/**
 * Cycle Game Race — green-light wait must survive the transient initial 'idle'.
 *
 * After startRace() the render phase is 'idle' for the first frame (React hasn't
 * flushed setPhase('staging') yet), then idle→staging→countdown→racing. A naive
 * wait that treats ANY 'idle' as "aborted before start" bails on that first frame
 * and never drives the bikes — they idle-DNF. This pins the corrected behavior:
 * the wait ignores the initial idle and reaches 'racing'.
 */
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';
import { launchCycleGame } from '#testlib/FitnessSimHelper.mjs';

async function waitForController(page) {
  await page.waitForFunction(
    () => !!(window.__fitnessSimController && typeof window.__fitnessSimController.getEquipment === 'function'),
    null, { timeout: 45000 }
  );
}

test.describe('Cycle Game — green-light wait', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test.setTimeout(120000);

  test('the wait ignores the transient initial idle and reaches racing', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/fitness`);
    await waitForController(page);
    await page.waitForFunction(() => ((window.__fitnessSimController?.getEquipment?.() || []).length > 0), null, { timeout: 15000 });
    await launchCycleGame(page);
    await waitForController(page);
    await expect(page.getByTestId('cycle-game-home')).toBeVisible({ timeout: 15000 });
    await page.evaluate(() => window.__fitnessSimController.autoAssignRiders(2));
    await page.waitForFunction(() => window.__cycleGameControl?.ready === true, null, { timeout: 15000 });

    // Run BOTH wait algorithms against the same live race lifecycle and compare.
    const result = await page.evaluate(async () => {
      const ctl = window.__cycleGameControl;
      const phaseOf = () => (ctl.getPhase ? ctl.getPhase() : null);
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      ctl.startRace({ winCondition: 'time', value: 60 });

      const firstPhase = phaseOf(); // the transient frame the driver sees first

      // Corrected wait (mirrors sim-panel.html): ignore initial idle.
      const greenBy = Date.now() + 30000;
      let phase = phaseOf();
      let sawStart = false;
      let naiveWouldAbort = false;
      let checkedNaive = false;
      while (Date.now() < greenBy && phase !== 'racing') {
        // Record what a naive "break on any idle/results" would have done on the
        // very first observation.
        if (!checkedNaive) { naiveWouldAbort = (phase === 'idle' || phase === 'results'); checkedNaive = true; }
        if (phase === 'staging' || phase === 'countdown') sawStart = true;
        if (phase === 'results') break;
        if (phase === 'idle' && sawStart) break;
        await sleep(150);
        phase = phaseOf();
      }
      return { firstPhase, finalPhase: phase, sawStart, naiveWouldAbort };
    });

    // eslint-disable-next-line no-console
    console.log('GREENLIGHT_WAIT', JSON.stringify(result));

    // The first observed phase is the transient idle — which the naive guard would
    // have aborted on (this is the bug the fix addresses).
    expect(result.naiveWouldAbort, 'naive break-on-idle would have aborted at the start').toBe(true);
    // The corrected wait saw the race begin and reached the green light.
    expect(result.sawStart, 'corrected wait observed staging/countdown').toBe(true);
    expect(result.finalPhase, 'corrected wait reached racing (driver would drive, not abort)').toBe('racing');
  });
});
