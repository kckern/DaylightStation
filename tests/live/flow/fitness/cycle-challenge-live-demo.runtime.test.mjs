/**
 * Cycle Challenge Live Demo — Playwright runtime test.
 *
 * Not a pass/fail test — a visual demo. Opens a real browser pointed at
 * production, drives the cycle challenge through every state of its
 * lifecycle with long pauses so a human can watch the overlay react.
 *
 * Run with:
 *   npx playwright test tests/live/flow/fitness/cycle-challenge-live-demo.runtime.test.mjs --headed --reporter=line
 *
 * Stages walked (≈90s total):
 *   1. Boot + sim controller ready
 *   2. Activate HR for two participants (engine sees a "session")
 *   3. Trigger cycle challenge for rider 'felix'
 *   4. INIT       — slate blue ring, 0 RPM       — 8s pause
 *   5. RAMP       — warm yellow ring, RPM 35     — 6s pause
 *   6. MAINTAIN   — green ring, RPM 75           — 8s pause
 *   7. LOCKED     — red ring, RPM dropped to 0   — 8s pause
 *   8. RECOVER    — back to ramp/maintain        — 8s pause
 *   9. PHASES     — cruise to success            — up to 90s
 *  10. CLEANUP    — overlay clears, state nulls  — 5s pause
 */

import { test, expect } from '@playwright/test';

const URL = 'https://daylightlocal.kckern.net/fitness/play/674219';
const EQUIPMENT_ID = 'cycle_ace';
const RIDER_ID = 'felix';

const PAUSE = {
  short: 3000,
  medium: 6000,
  long: 8000
};

function banner(stage, msg) {
  // eslint-disable-next-line no-console
  console.log(`\n  ====== ${stage} ======\n  ${msg}`);
}

async function readState(page) {
  return page.evaluate(() => {
    const gov = window.__fitnessGovernance;
    if (!gov || gov.activeChallengeType !== 'cycle') return null;
    return {
      cycleState: gov.cycleState,
      currentRpm: gov.currentRpm,
      riderId: gov.riderId,
      currentPhaseIndex: gov.currentPhaseIndex,
      totalPhases: gov.totalPhases,
      phaseProgressPct: gov.phaseProgressPct
    };
  });
}

async function setRpm(page, rpm) {
  return page.evaluate(({ id, rpm }) => {
    const ctl = window.__fitnessSimController;
    if (!ctl) return { ok: false, error: 'controller_unavailable' };
    return ctl.setRpm(id, rpm);
  }, { id: EQUIPMENT_ID, rpm });
}

async function dumpStateLoop(page, durationMs, label) {
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    const state = await readState(page);
    // eslint-disable-next-line no-console
    console.log(`    [${label}] ${state ? `state=${state.cycleState} rpm=${state.currentRpm} phase=${state.currentPhaseIndex + 1}/${state.totalPhases} progress=${state.phaseProgressPct}%` : '(no active cycle)'}`);
    await page.waitForTimeout(1000);
  }
}

test.describe('Cycle challenge live demo', () => {
  test.setTimeout(360000); // 6 minutes

  test('walks every cycle state with visible pauses', async ({ page }) => {
    banner('1. BOOT', `Opening ${URL}`);
    await page.goto(URL);
    await page.waitForFunction(() => !!window.__fitnessSimController, null, { timeout: 30000 });
    await page.waitForTimeout(2000);
    // eslint-disable-next-line no-console
    console.log('    Sim controller ready.');

    // Confirm equipment + selection visibility — fail loudly if Tasks 1-2 didn't land.
    const equipment = await page.evaluate(() => window.__fitnessSimController.getEquipment());
    const cycleAce = equipment.find(e => e.equipmentId === EQUIPMENT_ID);
    expect(cycleAce, `${EQUIPMENT_ID} should be in the equipment catalog`).toBeTruthy();
    // eslint-disable-next-line no-console
    console.log(`    Equipment: ${cycleAce.name} (cad ${cycleAce.cadenceDeviceId}) eligible=${cycleAce.eligibleUsers.join(',')}`);

    const selections = await page.evaluate(() => window.__fitnessSimController.listCycleSelections());
    const cycleSel = selections.find(s => s.equipment === EQUIPMENT_ID);
    expect(cycleSel, 'a cycle selection should exist for cycle_ace').toBeTruthy();
    const selectionId = cycleSel.id;
    // eslint-disable-next-line no-console
    console.log(`    Selection: ${selectionId} (${cycleSel.label})`);

    banner('2. SESSION', 'Activating HR for two participants');
    await page.evaluate(() => {
      const ctl = window.__fitnessSimController;
      const devices = ctl.getDevices();
      devices.slice(0, 2).forEach(d => ctl.startAutoSession(d.deviceId, { phaseOffset: 200 }));
    });
    await page.waitForTimeout(PAUSE.short);

    banner('3. TRIGGER', `Triggering cycle challenge → rider=${RIDER_ID}`);
    const trigger = await page.evaluate(({ selectionId, riderId }) => {
      return window.__fitnessSimController.triggerCycleChallenge({ selectionId, riderId });
    }, { selectionId, riderId: RIDER_ID });
    expect(trigger.success, `trigger should succeed; got reason=${trigger.reason}`).toBe(true);
    // eslint-disable-next-line no-console
    console.log(`    Trigger accepted, challengeId=${trigger.challengeId}`);

    banner('4. INIT', 'Slate-blue ring at top-left. RPM=0. Hold for 8s.');
    await setRpm(page, 0);
    await dumpStateLoop(page, PAUSE.long, 'init');

    banner('5. RAMP', 'Driving RPM=35 → ring should turn warm yellow.');
    await setRpm(page, 35);
    await dumpStateLoop(page, PAUSE.medium, 'ramp');

    banner('6. MAINTAIN', 'Driving RPM=75 → ring should turn green.');
    await setRpm(page, 75);
    await dumpStateLoop(page, PAUSE.long, 'maintain');

    banner('7. LOCKED', 'Dropping RPM=0 → ring should turn red, video should dim.');
    await setRpm(page, 0);
    await dumpStateLoop(page, PAUSE.long, 'locked');

    banner('8. RECOVER', 'Driving RPM=75 → unlock back to ramp/maintain.');
    await setRpm(page, 75);
    await dumpStateLoop(page, PAUSE.long, 'recover');

    banner('9. PHASES', 'Cruising at RPM=85 to advance through phases.');
    const phaseDeadline = Date.now() + 90000;
    let lastPhase = -1;
    while (Date.now() < phaseDeadline) {
      await setRpm(page, 85);
      const state = await readState(page);
      if (!state) break; // success — challenge cleared
      if (state.currentPhaseIndex !== lastPhase) {
        lastPhase = state.currentPhaseIndex;
        // eslint-disable-next-line no-console
        console.log(`    [phases] advanced to phase ${lastPhase + 1}/${state.totalPhases} state=${state.cycleState} rpm=${state.currentRpm}`);
      }
      await page.waitForTimeout(1500);
    }

    banner('10. CLEANUP', 'Cycle should have cleared. Holding 5s for visual confirmation.');
    await page.waitForTimeout(PAUSE.short + 2000);

    const finalState = await readState(page);
    // eslint-disable-next-line no-console
    console.log(`    Final state: ${finalState ? JSON.stringify(finalState) : '(cleared)'}`);

    banner('DONE', 'Demo complete.');
  });
});
