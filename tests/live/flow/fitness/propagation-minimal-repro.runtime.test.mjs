/**
 * Minimal Reproduction: Device Update Propagation
 *
 * Tests whether all 5 devices receive HR updates with various delays.
 */
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';
import { FitnessSimHelper } from '#testlib/FitnessSimHelper.mjs';

async function getHRState(page) {
  return page.evaluate(() => {
    const session = window.__fitnessSession;
    const result = {};
    session?.userManager?.users?.forEach((user, id) => {
      if (!user.hrDeviceId) return;
      const profile = session.zoneProfileStore?.getProfile(id);
      result[id] = {
        name: user.name,
        deviceId: String(user.hrDeviceId),
        hr: profile?.heartRate || 0
      };
    });
    return result;
  });
}

test.describe('Propagation Minimal Repro', () => {

  test('send HR to each device one at a time with 500ms delay', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/fitness`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const sim = new FitnessSimHelper(page);
    await sim.waitForController();

    const devices = await page.evaluate(() =>
      window.__fitnessSimController?.getDevices?.() || []
    );

    console.log('\n=== DEVICE-BY-DEVICE TEST (500ms delay) ===\n');

    for (const device of devices) {
      const beforeState = await getHRState(page);
      const targetUser = Object.values(beforeState).find(u => u.deviceId === device.deviceId);

      console.log(`Sending HR=150 to device ${device.deviceId} (${targetUser?.name || 'unknown'})...`);
      console.log(`  Before: HR=${targetUser?.hr || 0}`);

      await sim.setHR(device.deviceId, 150);
      await page.waitForTimeout(500); // Long delay

      const afterState = await getHRState(page);
      const afterUser = Object.values(afterState).find(u => u.deviceId === device.deviceId);

      console.log(`  After:  HR=${afterUser?.hr || 0}`);
      console.log(`  Result: ${afterUser?.hr === 150 ? 'OK' : 'FAILED'}`);
      console.log('');
    }

    // Final check
    await page.waitForTimeout(2000);
    const finalState = await getHRState(page);

    console.log('=== FINAL STATE ===');
    let failCount = 0;
    for (const [id, data] of Object.entries(finalState)) {
      const status = data.hr === 150 ? 'OK' : 'FAILED';
      console.log(`  ${data.name}: HR=${data.hr} ${status}`);
      if (data.hr !== 150) failCount++;
    }

    console.log(`\n${Object.keys(finalState).length - failCount}/${Object.keys(finalState).length} devices updated correctly`);

    expect(failCount).toBe(0);
  });

  test('check if device order matters', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/fitness`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const sim = new FitnessSimHelper(page);
    await sim.waitForController();

    const devices = await page.evaluate(() =>
      window.__fitnessSimController?.getDevices?.() || []
    );

    // Reset all to HR=50
    console.log('Resetting all devices to HR=50...');
    for (const device of devices) {
      await sim.setHR(device.deviceId, 50);
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(2000);

    // Send in REVERSE order
    console.log('\n=== REVERSE ORDER TEST ===\n');
    const reversedDevices = [...devices].reverse();

    for (const device of reversedDevices) {
      console.log(`Sending HR=160 to device ${device.deviceId}...`);
      await sim.setHR(device.deviceId, 160);
      await page.waitForTimeout(300);
    }

    await page.waitForTimeout(2000);

    const state = await getHRState(page);
    let correctCount = 0;
    for (const [id, data] of Object.entries(state)) {
      const isCorrect = data.hr === 160;
      console.log(`  ${data.name}: HR=${data.hr} ${isCorrect ? 'OK' : 'FAILED'}`);
      if (isCorrect) correctCount++;
    }

    console.log(`\n${correctCount}/${Object.keys(state).length} updated (reverse order)`);

    expect(correctCount).toBe(Object.keys(state).length);
  });
});
