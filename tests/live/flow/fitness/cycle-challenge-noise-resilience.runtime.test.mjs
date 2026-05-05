/**
 * Cycle Challenge Sensor-Noise Resilience — Playwright runtime test.
 *
 * Bug under guard: when the cadence sensor flickers between 0 and a low
 * RPM (e.g. dropouts during pedaling), the published cycleState used to
 * strobe locked↔maintain on every blip, which made the overlay flash red.
 *
 * Tasks 1–6 introduced a CadenceFilter (EMA + staleness handling) and a
 * 500 ms transition debounce on the published cycleState. This test pins
 * those fixes by:
 *
 *   1. Booting on a cycling video URL (so the player + sim controller
 *      mount), discovered via the same nav_items path as the cycle demo.
 *   2. Activating two HR participants (drives the engine to 'unlocked').
 *   3. Triggering a manualTrigger cycle challenge directly via the
 *      simulator API (bypasses the demo overlay so we own RPM dispatch).
 *   4. Driving RPM=90 to reach MAINTAIN.
 *   5. Switching to a 0↔55 RPM bouncing stream at 5 Hz for 15 s while
 *      sampling the published cycleState every 200 ms.
 *   6. Asserting fewer than 2 locked transitions over the window.
 *
 * If this test starts failing (≥2 locked transitions), the noise filter
 * or the SM debounce has regressed in the live engine — investigate
 * before relaxing the assertion.
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

const CYCLE_EQUIPMENT_ID = 'cycle_ace';

test.describe('Cycle overlay noise resilience', () => {
  test.setTimeout(180000);

  test('does not strobe locked state under 0↔55 RPM noise', async ({ page }) => {
    page.on('console', (msg) => {
      const t = msg.text();
      if (/state_transition|recovered|locked|cycle\.published/i.test(t)) {
        // eslint-disable-next-line no-console
        console.log('[browser]', t.slice(0, 220));
      }
    });

    // Discover a GOVERNED cycling episode (so window.__fitnessGovernance
    // engages). We cross-reference governed-content with cycle nav items
    // and pick the first show that yields a playable episode. Mirrors the
    // discovery path used by tests/live/flow/fitness/cycle-challenge-lifecycle.
    const episodeId = await page.request.get(`${FRONTEND_URL}/api/v1/fitness/governed-content`)
      .then((r) => r.json())
      .then(async (governed) => {
        const items = Array.isArray(governed) ? governed : (governed?.items || []);
        // Try shows whose title looks cycling-related first.
        const cyclingShows = items.filter((s) =>
          /cycl|bike|ride|spin/i.test(s?.title || s?.name || ''));
        for (const show of cyclingShows.length > 0 ? cyclingShows : items) {
          const showId = String(show?.id || '').replace(/^[a-z]+:/i, '');
          if (!showId) continue;
          const playable = await page.request
            .get(`${FRONTEND_URL}/api/v1/fitness/show/${showId}/playable`)
            .then((r) => r.json())
            .catch(() => null);
          const eps = Array.isArray(playable?.items) ? playable.items : [];
          const firstEp = eps.find((e) => e?.id);
          if (firstEp) return String(firstEp.id).replace(/^[a-z]+:/i, '');
        }
        return null;
      })
      .catch(() => null);
    expect(episodeId, 'must discover at least one governed cycling episode').toBeTruthy();

    // Use ?nogovern so FitnessApp doesn't redirect on sequential-show.
    await page.goto(`${FRONTEND_URL}/fitness/play/${episodeId}?nogovern`);
    await page.waitForFunction(() => !!window.__fitnessSimController, null, { timeout: 30000 });
    await page.waitForFunction(
      () => {
        const ctl = window.__fitnessSimController;
        return Array.isArray(ctl?.getEquipment?.()) && ctl.getEquipment().length > 0;
      },
      null,
      { timeout: 15000 }
    );
    await page.waitForFunction(
      () => !!window.__fitnessGovernance?.contentId,
      null,
      { timeout: 30000 }
    );

    // Discover cycle selection + rider.
    const { selectionId, riderId } = await page.evaluate(() => {
      const ctl = window.__fitnessSimController;
      const eq = ctl.getEquipment().find((e) => e.equipmentId === 'cycle_ace');
      const sel = ctl.listCycleSelections().find((s) => s.equipment === 'cycle_ace');
      return {
        selectionId: sel?.id || null,
        riderId: eq?.eligibleUsers?.[0] || null
      };
    });
    expect(selectionId, 'cycle_ace selection should exist').toBeTruthy();
    expect(riderId, 'cycle_ace should have at least one eligible rider').toBeTruthy();

    // Activate two HR participants so the engine reaches 'unlocked'.
    await page.evaluate(() => {
      const ctl = window.__fitnessSimController;
      ctl.getDevices().slice(0, 2).forEach((d) =>
        ctl.startAutoSession(d.deviceId, { phaseOffset: 200 })
      );
    });
    await page.waitForFunction(
      () => window.__fitnessGovernance?.phase === 'unlocked',
      null,
      { timeout: 30000 }
    );

    // Trigger the cycle challenge (riderId → manualTrigger=true under the hood).
    const trigger = await page.evaluate(({ selId, rId }) => {
      return window.__fitnessSimController.triggerCycleChallenge({
        selectionId: selId,
        riderId: rId
      });
    }, { selId: selectionId, rId: riderId });
    expect(trigger.success, `trigger should succeed; reason=${trigger.reason}`).toBe(true);

    // Drive RPM=90 with a 500 ms sustain so cadence stays fresh while the
    // SM advances to MAINTAIN. We read the *published* (debounced) cycle
    // state from engine.state.challenge — window.__fitnessGovernance
    // exposes the pre-debounce internal state, which is not what overlays see.
    const sustainHandle = await page.evaluateHandle((id) => {
      window.__fitnessSimController?.setRpm?.(id, 90);
      return setInterval(() => {
        window.__fitnessSimController?.setRpm?.(id, 90);
      }, 500);
    }, CYCLE_EQUIPMENT_ID);
    await page.waitForFunction(
      () => {
        const eng = window.__fitnessSession?.governanceEngine;
        return eng?.state?.challenge?.cycleState === 'maintain';
      },
      null,
      { timeout: 30000 }
    );
    await page.evaluate((handle) => clearInterval(handle), sustainHandle);

    // Inject 0↔55 RPM oscillation while sampling the published cycleState
    // (engine.state.challenge.cycleState). We co-locate the sampler and
    // emitter inside the page so cadence dispatch and observation share
    // the same JS event loop.
    const result = await page.evaluate(async (id) => {
      const ctl = window.__fitnessSimController;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const readState = () =>
        window.__fitnessSession?.governanceEngine?.state?.challenge?.cycleState ?? null;
      let lockTransitions = 0;
      let prev = readState();
      const states = [];
      const startedAt = Date.now();
      // 75 ticks × 200 ms = 15 s.
      for (let i = 0; i < 75; i += 1) {
        ctl?.setRpm?.(id, i % 2 === 0 ? 55 : 0);
        const state = readState();
        if (state === 'locked' && prev !== 'locked') lockTransitions += 1;
        prev = state;
        states.push(state);
        // eslint-disable-next-line no-await-in-loop
        await sleep(200);
      }
      return {
        lockTransitions,
        states,
        durationMs: Date.now() - startedAt
      };
    }, CYCLE_EQUIPMENT_ID);

    // eslint-disable-next-line no-console
    console.log(
      `Noise window: lockTransitions=${result.lockTransitions}, ` +
      `duration=${result.durationMs}ms, ` +
      `distinct states=${[...new Set(result.states)].join(',')}`
    );
    // eslint-disable-next-line no-console
    console.log(`State trace: ${result.states.join(',')}`);

    expect(result.lockTransitions).toBeLessThan(2);

    // I-6: also verify the new UI surfaces from Tasks 9-11 actually render
    // for this cycle challenge. These assertions catch regressions where the
    // overlay component mounts but the new flags/countdown don't reach the
    // DOM (the kind of producer/consumer boundary bug that bricked the
    // base-req indicator before commit ae0898c0b).

    // CycleBaseReqIndicator should be visible (in some state — satisfied,
    // waiting, or inactive). Two HR devices are running so satisfied is the
    // expected mode, but the test passes if any of the three modes are
    // surfaced (the assertion is "the indicator IS rendered," not "it's
    // green right now").
    const indicator = page.locator('.cycle-base-req');
    await expect(indicator).toBeVisible({ timeout: 5000 });

    // Drive RPM=0 sustained so the cadence filter exits its grace window
    // and reports lostSignal=true after ~4 s. The overlay should pick up
    // the --lost-signal modifier class. We use a tighter 6 s wait to be
    // safely inside LOST_SIGNAL_MS=4000 without flakiness.
    await page.evaluate((id) => {
      window.__fitnessSimController?.setRpm?.(id, 0);
      // Then stop sending samples entirely.
    }, CYCLE_EQUIPMENT_ID);
    const overlay = page.locator('.cycle-challenge-overlay');
    await expect(overlay).toHaveClass(/cycle-challenge-overlay--lost-signal/, {
      timeout: 7000
    });
  });
});
