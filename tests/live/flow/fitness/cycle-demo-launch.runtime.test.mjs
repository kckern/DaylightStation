/**
 * Cycle Challenge Demo — Launch + Lifecycle Runtime Test
 *
 * Exit criterion for the cycle-demo bug-fix plan.
 *
 * Test 1: Verifies the demo overlay mounts correctly when the
 *   "Cycle Challenge Demo" card is selected from the app menu.
 *
 * Test 2: Extended lifecycle assertion — samples governance state over
 *   a 90-second window and verifies:
 *   (1) phaseProgressPct stays in [0, 1] (unit fix — T2)
 *   (2) maintain→success state_transition fires no more than 3 times
 *       (transition spam regression — T1)
 *   (3) the SM actually advances to cycleState=maintain
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

test.describe('Cycle Challenge Demo', () => {
  test.setTimeout(180000); // 3 minutes for the launch test

  test('overlay mounts when Cycle Challenge Demo card is selected', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/fitness/menu/app_menu1`);
    await page.waitForFunction(() => !!window.__fitnessSimController, null, { timeout: 30000 });

    await page.locator('.module-card', { hasText: 'Cycle Challenge Demo' }).click();
    await page.waitForURL(/\/fitness\/play\/\d+\?.*cycle-demo=1/, { timeout: 15000 });
    await expect(page.locator('.cycle-challenge-demo')).toBeVisible({ timeout: 15000 });
  });

  test('demo runs one full lifecycle without transition spam or unit bugs', async ({ page }) => {
    test.setTimeout(150000); // 2.5 minutes: 90s window + setup buffer

    const transitions = [];
    page.on('console', (msg) => {
      const t = msg.text();
      const successMatch = t.match(/state_transition.*"from":"maintain","to":"success"/);
      if (successMatch) transitions.push({ at: Date.now(), text: t.slice(0, 200) });
    });

    await page.goto(`${FRONTEND_URL}/fitness/menu/app_menu1`);
    await page.waitForFunction(() => !!window.__fitnessSimController, null, { timeout: 30000 });
    await page.locator('.module-card', { hasText: 'Cycle Challenge Demo' }).click();
    await page.waitForURL(/\/fitness\/play\/\d+\?.*cycle-demo=1/, { timeout: 15000 });
    await expect(page.locator('.cycle-challenge-demo')).toBeVisible({ timeout: 15000 });

    // Sample phaseProgressPct over time; must always be in [0, 1] when non-null.
    const samples = [];
    const deadline = Date.now() + 90000; // 90s window — covers ~1 full demo iteration
    while (Date.now() < deadline) {
      const sample = await page.evaluate(() => {
        const g = window.__fitnessGovernance;
        return g ? { progress: g.phaseProgressPct, state: g.cycleState, rpm: g.currentRpm } : null;
      });
      if (sample) samples.push(sample);
      await page.waitForTimeout(500);
    }

    // 1. Progress unit: every non-null sample must be in [0, 1].
    const progressSamples = samples.filter((s) => s.progress != null);
    expect(progressSamples.length).toBeGreaterThan(5);
    for (const s of progressSamples) {
      expect(s.progress).toBeGreaterThanOrEqual(0);
      expect(s.progress).toBeLessThanOrEqual(1);
    }

    // 2. No transition spam: at most 3 maintain→success events.
    expect(transitions.length).toBeLessThanOrEqual(3);

    // 3. Saw cycleState=maintain at some point — proves SM advanced.
    const sawMaintain = samples.some((s) => s.state === 'maintain');
    expect(sawMaintain).toBe(true);
  });
});
