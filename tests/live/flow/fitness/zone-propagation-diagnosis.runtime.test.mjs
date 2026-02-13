/**
 * Zone Propagation Diagnosis Test
 *
 * Minimal reproduction to isolate why rapid zone updates only propagate for kckern.
 *
 * Tests three hypotheses:
 * 1. WebSocket batching - are messages being dropped?
 * 2. User resolution - does resolveUserForDevice() return the correct user?
 * 3. Zone derivation - does ZoneProfileStore derive zones correctly?
 *
 * Run with: npx playwright test tests/live/flow/fitness/zone-propagation-diagnosis.runtime.test.mjs --headed
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';
import { FitnessSimHelper } from '#testlib/FitnessSimHelper.mjs';

const BASE_URL = FRONTEND_URL;

// Diagnostic extraction functions
async function extractFullState(page) {
  return page.evaluate(() => {
    const session = window.__fitnessSession;
    const gov = window.__fitnessGovernance;
    const sim = window.__fitnessSimController;

    if (!session) return { error: 'No session' };

    // Get all users from UserManager
    const usersFromManager = [];
    session.userManager?.users?.forEach((user, id) => {
      usersFromManager.push({
        id,
        name: user.name,
        hrDeviceId: user.hrDeviceId,
        currentHR: user.currentData?.heartRate,
        currentZone: user.currentData?.zone
      });
    });

    // Get all devices from DeviceManager
    const devicesFromManager = [];
    session.deviceManager?.devices?.forEach((device, id) => {
      devicesFromManager.push({
        id,
        type: device.type,
        heartRate: device.heartRate,
        zone: device.zone,
        inactiveSince: device.inactiveSince
      });
    });

    // Get zone profiles from ZoneProfileStore
    const zoneProfiles = {};
    if (session.zoneProfileStore) {
      usersFromManager.forEach(u => {
        const profile = session.zoneProfileStore.getProfile(u.id);
        if (profile) {
          zoneProfiles[u.id] = {
            currentZoneId: profile.currentZoneId,
            heartRate: profile.heartRate
          };
        }
      });
    }

    // Get governance state
    const govState = gov ? {
      phase: gov.phase,
      userZoneMap: gov.userZoneMap,
      activeParticipants: gov.activeParticipants
    } : null;

    // Get sim devices
    const simDevices = sim?.getDevices?.() || [];

    return {
      users: usersFromManager,
      devices: devicesFromManager,
      zoneProfiles,
      governance: govState,
      simDevices: simDevices.map(d => ({ deviceId: d.deviceId, userName: d.userName }))
    };
  });
}

async function sendZoneAndCapture(page, sim, deviceId, zone, label) {
  // Capture state before
  const before = await extractFullState(page);

  // Send zone update
  const result = await sim.setZone(deviceId, zone);

  // Wait a tick for WebSocket roundtrip
  await page.waitForTimeout(50);

  // Capture state after
  const after = await extractFullState(page);

  return { label, deviceId, zone, result, before, after };
}

test.describe('Zone Propagation Diagnosis', () => {

  test('hypothesis-1: compare rapid vs delayed zone updates', async ({ page }) => {
    // Navigate to fitness page
    await page.goto(`${BASE_URL}/fitness`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // Wait for session initialization

    const sim = new FitnessSimHelper(page);
    await sim.waitForController();

    // Get initial state to see what devices/users exist
    const initial = await extractFullState(page);
    console.log('\n=== INITIAL STATE ===');
    console.log('Users:', JSON.stringify(initial.users, null, 2));
    console.log('Sim Devices:', JSON.stringify(initial.simDevices, null, 2));

    if (initial.simDevices.length < 2) {
      console.log('SKIP: Need at least 2 devices for this test');
      test.skip();
      return;
    }

    // Test 1: RAPID updates (no delay between devices)
    console.log('\n=== TEST 1: RAPID UPDATES (no delay) ===');
    const rapidResults = [];
    for (const device of initial.simDevices.slice(0, 3)) {
      const result = await sendZoneAndCapture(page, sim, device.deviceId, 'warm', `rapid-${device.userName}`);
      rapidResults.push(result);
      // NO delay between devices
    }

    // Wait for any pending syncs
    await page.waitForTimeout(200);

    const afterRapid = await extractFullState(page);
    console.log('\nAfter RAPID updates:');
    console.log('Zone Profiles:', JSON.stringify(afterRapid.zoneProfiles, null, 2));
    console.log('Governance userZoneMap:', JSON.stringify(afterRapid.governance?.userZoneMap, null, 2));

    // Count how many users have correct zone
    const rapidCorrect = Object.values(afterRapid.zoneProfiles).filter(p => p.currentZoneId === 'warm').length;
    console.log(`RAPID: ${rapidCorrect}/${Object.keys(afterRapid.zoneProfiles).length} users at 'warm' zone`);

    // Reset all to cool
    console.log('\n--- Resetting to cool ---');
    for (const device of initial.simDevices) {
      await sim.setZone(device.deviceId, 'cool');
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(500);

    // Test 2: DELAYED updates (200ms between devices)
    console.log('\n=== TEST 2: DELAYED UPDATES (200ms delay) ===');
    const delayedResults = [];
    for (const device of initial.simDevices.slice(0, 3)) {
      const result = await sendZoneAndCapture(page, sim, device.deviceId, 'warm', `delayed-${device.userName}`);
      delayedResults.push(result);
      await page.waitForTimeout(200); // 200ms delay between devices
    }

    // Wait for any pending syncs
    await page.waitForTimeout(500);

    const afterDelayed = await extractFullState(page);
    console.log('\nAfter DELAYED updates:');
    console.log('Zone Profiles:', JSON.stringify(afterDelayed.zoneProfiles, null, 2));
    console.log('Governance userZoneMap:', JSON.stringify(afterDelayed.governance?.userZoneMap, null, 2));

    // Count how many users have correct zone
    const delayedCorrect = Object.values(afterDelayed.zoneProfiles).filter(p => p.currentZoneId === 'warm').length;
    console.log(`DELAYED: ${delayedCorrect}/${Object.keys(afterDelayed.zoneProfiles).length} users at 'warm' zone`);

    // Summary
    console.log('\n=== SUMMARY ===');
    console.log(`RAPID updates:   ${rapidCorrect} correct zones`);
    console.log(`DELAYED updates: ${delayedCorrect} correct zones`);

    if (rapidCorrect < delayedCorrect) {
      console.log('DIAGNOSIS: Rapid updates propagate fewer zones than delayed updates');
      console.log('This confirms the timing-related propagation issue');
    } else if (rapidCorrect === delayedCorrect && rapidCorrect === 0) {
      console.log('DIAGNOSIS: Neither rapid nor delayed updates propagate zones');
      console.log('Issue is not timing-related - check user/device configuration');
    } else {
      console.log('DIAGNOSIS: Both rapid and delayed updates work equally');
      console.log('Issue may be test-environment specific or already fixed');
    }

    // Assertions for test pass/fail
    expect(delayedCorrect).toBeGreaterThan(0); // At least delayed should work
  });

  test('hypothesis-2: trace single device update through all layers', async ({ page }) => {
    await page.goto(`${BASE_URL}/fitness`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const sim = new FitnessSimHelper(page);
    await sim.waitForController();

    const initial = await extractFullState(page);

    if (initial.simDevices.length === 0) {
      console.log('SKIP: No devices available');
      test.skip();
      return;
    }

    // Pick a non-primary device (not the first one, which is usually kckern)
    const targetDevice = initial.simDevices.length > 1
      ? initial.simDevices[1]
      : initial.simDevices[0];

    console.log('\n=== TRACING SINGLE DEVICE UPDATE ===');
    console.log(`Target: ${targetDevice.userName} (device ${targetDevice.deviceId})`);

    // Find corresponding user
    const targetUser = initial.users.find(u => u.hrDeviceId === targetDevice.deviceId);
    console.log('Matching user by hrDeviceId:', targetUser ? targetUser.name : 'NOT FOUND');

    if (!targetUser) {
      console.log('\n*** DIAGNOSIS: User hrDeviceId mismatch ***');
      console.log('Users hrDeviceIds:', initial.users.map(u => ({ name: u.name, hrDeviceId: u.hrDeviceId })));
      console.log('This could explain why updates fail for this device');
    }

    // Send update and trace
    console.log('\nSending zone update to warm...');
    const beforeUpdate = await extractFullState(page);

    await sim.setZone(targetDevice.deviceId, 'warm');
    await page.waitForTimeout(100);

    const afterUpdate = await extractFullState(page);

    // Compare state changes
    console.log('\n--- State Changes ---');

    // Device layer
    const deviceBefore = beforeUpdate.devices.find(d => d.id === targetDevice.deviceId);
    const deviceAfter = afterUpdate.devices.find(d => d.id === targetDevice.deviceId);
    console.log('Device HR:', deviceBefore?.heartRate, '->', deviceAfter?.heartRate);
    console.log('Device zone:', deviceBefore?.zone, '->', deviceAfter?.zone);

    // User layer (if found)
    if (targetUser) {
      const userBefore = beforeUpdate.users.find(u => u.id === targetUser.id);
      const userAfter = afterUpdate.users.find(u => u.id === targetUser.id);
      console.log('User HR:', userBefore?.currentHR, '->', userAfter?.currentHR);
      console.log('User zone:', userBefore?.currentZone, '->', userAfter?.currentZone);
    }

    // ZoneProfileStore layer
    if (targetUser) {
      const profileBefore = beforeUpdate.zoneProfiles[targetUser.id];
      const profileAfter = afterUpdate.zoneProfiles[targetUser.id];
      console.log('ZoneProfile HR:', profileBefore?.heartRate, '->', profileAfter?.heartRate);
      console.log('ZoneProfile zone:', profileBefore?.currentZoneId, '->', profileAfter?.currentZoneId);
    }

    // Governance layer
    if (targetUser) {
      const govZoneBefore = beforeUpdate.governance?.userZoneMap?.[targetUser.id];
      const govZoneAfter = afterUpdate.governance?.userZoneMap?.[targetUser.id];
      console.log('Governance zone:', govZoneBefore, '->', govZoneAfter);
    }

    // Wait for full propagation and check again
    await page.waitForTimeout(1500); // Wait past the 1000ms sync throttle
    const afterFullSync = await extractFullState(page);

    console.log('\n--- After 1.5s (past sync throttle) ---');
    if (targetUser) {
      const profileFinal = afterFullSync.zoneProfiles[targetUser.id];
      const govZoneFinal = afterFullSync.governance?.userZoneMap?.[targetUser.id];
      console.log('ZoneProfile zone:', profileFinal?.currentZoneId);
      console.log('Governance zone:', govZoneFinal);
    }

    // Determine where propagation stopped
    const deviceUpdated = deviceAfter?.heartRate !== deviceBefore?.heartRate;
    const userUpdated = targetUser && afterUpdate.users.find(u => u.id === targetUser.id)?.currentHR !== beforeUpdate.users.find(u => u.id === targetUser.id)?.currentHR;
    const profileUpdated = targetUser && afterFullSync.zoneProfiles[targetUser.id]?.currentZoneId === 'warm';
    const govUpdated = targetUser && afterFullSync.governance?.userZoneMap?.[targetUser.id] === 'warm';

    console.log('\n=== PROPAGATION DIAGNOSIS ===');
    console.log(`Device updated:       ${deviceUpdated ? 'YES' : 'NO'}`);
    console.log(`User updated:         ${userUpdated ? 'YES' : 'NO'}`);
    console.log(`ZoneProfile updated:  ${profileUpdated ? 'YES' : 'NO'}`);
    console.log(`Governance updated:   ${govUpdated ? 'YES' : 'NO'}`);

    if (!deviceUpdated) {
      console.log('\nFAILURE POINT: DeviceManager - WebSocket message may not have arrived');
    } else if (!userUpdated) {
      console.log('\nFAILURE POINT: UserManager - user.updateFromDevice() may have skipped');
      console.log('Check: Does user.hrDeviceId match device.id?');
    } else if (!profileUpdated) {
      console.log('\nFAILURE POINT: ZoneProfileStore - user not included in sync');
    } else if (!govUpdated) {
      console.log('\nFAILURE POINT: GovernanceEngine - user may not be in activeParticipants');
    } else {
      console.log('\nSUCCESS: Full propagation worked for this device');
    }

    expect(deviceUpdated).toBe(true); // At minimum, device should update
  });

  test('hypothesis-3: verify user hrDeviceId configuration', async ({ page }) => {
    await page.goto(`${BASE_URL}/fitness`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const sim = new FitnessSimHelper(page);
    await sim.waitForController();

    const state = await extractFullState(page);

    console.log('\n=== USER-DEVICE MAPPING VERIFICATION ===\n');

    // Build sim device lookup
    const simDeviceMap = new Map(state.simDevices.map(d => [d.deviceId, d.userName]));

    // Check each user
    let mismatches = 0;
    for (const user of state.users) {
      const expectedDevice = state.simDevices.find(d => d.userName.toLowerCase() === user.name.toLowerCase() || d.userName === user.id);
      const actualDeviceId = user.hrDeviceId;

      console.log(`User: ${user.name} (${user.id})`);
      console.log(`  hrDeviceId: ${actualDeviceId || 'NOT SET'}`);
      console.log(`  Expected device: ${expectedDevice?.deviceId || 'NOT FOUND in sim'}`);

      if (expectedDevice && actualDeviceId !== expectedDevice.deviceId) {
        console.log(`  *** MISMATCH: User has ${actualDeviceId}, but sim device is ${expectedDevice.deviceId}`);
        mismatches++;
      } else if (!actualDeviceId) {
        console.log(`  *** WARNING: No hrDeviceId set on user`);
        mismatches++;
      } else {
        console.log(`  OK`);
      }
      console.log('');
    }

    // Check for orphan sim devices (devices without matching users)
    console.log('--- Sim devices without matching users ---');
    for (const simDevice of state.simDevices) {
      const matchingUser = state.users.find(u => u.hrDeviceId === simDevice.deviceId);
      if (!matchingUser) {
        console.log(`Device ${simDevice.deviceId} (${simDevice.userName}): NO MATCHING USER by hrDeviceId`);
      }
    }

    console.log(`\n=== SUMMARY: ${mismatches} configuration issues found ===`);

    if (mismatches > 0) {
      console.log('DIAGNOSIS: User-device mapping issues may cause updateFromDevice() to skip updates');
    }

    // This test is informational - we expect the mapping to be correct
    // but want to see the actual state
    expect(state.users.length).toBeGreaterThan(0);
  });
});
