/**
 * Zone Propagation Test - Fixed for Per-User Zones
 *
 * Previous tests failed because they used HR=130 which maps to different zones
 * for different users (age-adjusted thresholds).
 *
 * This test uses HR values that put ALL users in the same zone regardless
 * of their individual thresholds.
 */
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';
import { FitnessSimHelper } from '#testlib/FitnessSimHelper.mjs';

async function extractZoneState(page) {
  return page.evaluate(() => {
    const session = window.__fitnessSession;
    const result = {};

    session?.userManager?.users?.forEach((user, id) => {
      if (!user.hrDeviceId) return;
      const profile = session.zoneProfileStore?.getProfile(id);
      result[id] = {
        name: user.name,
        hrDeviceId: String(user.hrDeviceId),
        hr: profile?.heartRate || 0,
        zone: profile?.currentZoneId || 'unknown',
        warmMin: user.zoneConfig?.find(z => z.id === 'warm')?.min
      };
    });

    return result;
  });
}

test.describe('Zone Propagation (Fixed)', () => {

  test('HR=180 puts all users in hot/fire zone', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/fitness`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const sim = new FitnessSimHelper(page);
    await sim.waitForController();

    // Get device list
    const devices = await page.evaluate(() =>
      window.__fitnessSimController?.getDevices?.().map(d => d.deviceId) || []
    );

    console.log('Devices:', devices);
    expect(devices.length).toBeGreaterThan(0);

    // Send HR=180 to all devices (should be hot/fire for ALL users)
    console.log('\nSending HR=180 to all devices...');
    for (const deviceId of devices) {
      await sim.setHR(deviceId, 180);
      await page.waitForTimeout(100);
    }

    // Wait for sync
    await page.waitForTimeout(1500);

    const state = await extractZoneState(page);
    console.log('\nZone state after HR=180:');
    for (const [id, data] of Object.entries(state)) {
      console.log(`  ${data.name}: HR=${data.hr}, zone=${data.zone} (warmMin=${data.warmMin})`);
    }

    // All users should be in hot or fire zone
    const highZones = ['hot', 'fire'];
    const allInHighZone = Object.values(state).every(u => highZones.includes(u.zone));
    console.log('\nAll users in hot/fire zone:', allInHighZone);

    expect(allInHighZone).toBe(true);
  });

  test('rapid vs delayed updates with universal HR', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/fitness`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const sim = new FitnessSimHelper(page);
    await sim.waitForController();

    const devices = await page.evaluate(() =>
      window.__fitnessSimController?.getDevices?.().map(d => d.deviceId) || []
    );

    // Reset to cool
    console.log('Resetting to HR=50 (cool)...');
    for (const deviceId of devices) {
      await sim.setHR(deviceId, 50);
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(1000);

    // Test RAPID updates with HR=180
    console.log('\n=== RAPID updates (HR=180) ===');
    for (const deviceId of devices) {
      await sim.setHR(deviceId, 180);
      // NO delay
    }
    await page.waitForTimeout(1500);

    const rapidState = await extractZoneState(page);
    const rapidCorrect = Object.values(rapidState).filter(u => ['hot', 'fire'].includes(u.zone)).length;
    console.log('Rapid: ' + rapidCorrect + '/' + Object.keys(rapidState).length + ' in hot/fire');

    // Reset
    for (const deviceId of devices) {
      await sim.setHR(deviceId, 50);
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(1000);

    // Test DELAYED updates with HR=180
    console.log('\n=== DELAYED updates (HR=180) ===');
    for (const deviceId of devices) {
      await sim.setHR(deviceId, 180);
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(1500);

    const delayedState = await extractZoneState(page);
    const delayedCorrect = Object.values(delayedState).filter(u => ['hot', 'fire'].includes(u.zone)).length;
    console.log('Delayed: ' + delayedCorrect + '/' + Object.keys(delayedState).length + ' in hot/fire');

    console.log('\n=== COMPARISON ===');
    console.log('Rapid correct:   ' + rapidCorrect);
    console.log('Delayed correct: ' + delayedCorrect);

    // Both should work equally
    expect(rapidCorrect).toBe(delayedCorrect);
    expect(delayedCorrect).toBeGreaterThanOrEqual(devices.length);
  });
});
