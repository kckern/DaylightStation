/**
 * Zone Configuration Check
 *
 * Verify zone thresholds per user to understand why HR=130 gives different zones.
 */
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

test('check zone thresholds per user', async ({ page }) => {
  await page.goto(`${FRONTEND_URL}/fitness`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  const result = await page.evaluate(() => {
    const session = window.__fitnessSession;
    const users = [];

    session?.userManager?.users?.forEach((user, id) => {
      // Only check users with devices
      if (!user.hrDeviceId) return;

      // Get zone config
      const zones = user.zoneConfig || [];
      const warmZone = zones.find(z => z.id === 'warm');
      const activeZone = zones.find(z => z.id === 'active');

      users.push({
        id,
        name: user.name,
        hrDeviceId: String(user.hrDeviceId),
        warmMin: warmZone?.min,
        warmMax: warmZone?.max,
        activeMin: activeZone?.min,
        activeMax: activeZone?.max,
        zoneCount: zones.length,
        zones: zones.map(z => z.id + ':' + z.min + '-' + (z.max || 'inf'))
      });
    });

    return users;
  });

  console.log('\n=== ZONE THRESHOLDS PER USER ===\n');
  for (const u of result) {
    console.log(u.name + ' (' + u.id + '):');
    console.log('  hrDeviceId: ' + u.hrDeviceId);
    console.log('  active zone: ' + u.activeMin + '-' + u.activeMax);
    console.log('  warm zone: ' + u.warmMin + '-' + u.warmMax);
    console.log('  zones: ' + u.zones.join(', '));
    console.log('');
  }

  // Check if zones differ between users
  const warmMins = result.map(u => u.warmMin);
  const allSame = warmMins.every(m => m === warmMins[0]);

  if (!allSame) {
    console.log('*** FINDING: Users have DIFFERENT warm zone thresholds ***');
    console.log('This explains why HR=130 gives different zones for different users');
  }

  expect(result.length).toBeGreaterThan(0);
});
