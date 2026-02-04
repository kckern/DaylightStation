/**
 * Group Label Fallback Test
 *
 * Verifies that when multiple HR devices are active, users with group_label
 * configured show their group_label instead of display_name in the sidebar.
 *
 * Test flow:
 * 1. kckern alone → shows "KC Kern"
 * 2. felix joins → kckern shows "Dad", felix shows "Felix"
 * 3. felix drops → kckern shows "KC Kern"
 *
 * SSOT validation: If governance overlay is visible, verify it shows the same
 * label as the sidebar.
 *
 * IMPORTANT: Test Isolation Requirement
 * -------------------------------------
 * This test requires exclusive access to the fitness WebSocket topic.
 * If another browser window (e.g., the dev server's Chrome tab) has the
 * fitness app open with active simulators, those devices will be broadcast
 * to this test's browser via WebSocket, causing false test failures.
 *
 * Before running this test:
 * - Close any browser tabs that have the fitness player open
 * - Or stop any running fitness simulators in other windows
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL, BACKEND_URL } from '#fixtures/runtime/urls.mjs';
import { FitnessSimHelper } from '#testlib/FitnessSimHelper.mjs';

const BASE_URL = FRONTEND_URL;
const API_URL = BACKEND_URL;

// Device configuration
const KCKERN_DEVICE_ID = '40475';
const FELIX_DEVICE_ID = '28812';

const EXPECTED = {
  kckern: { single: 'KC Kern', group: 'Dad' },
  felix: { single: 'Felix', group: 'Felix' } // no group_label configured
};

// ═══════════════════════════════════════════════════════════════════════════════
// FAIL-FAST CHECKS
// ═══════════════════════════════════════════════════════════════════════════════

/** @type {{contentId: string} | null} */
let governedContentFixture = null;

/**
 * Verify fitness API is healthy before running tests
 */
async function checkApiHealth() {
  const response = await fetch(`${API_URL}/api/v1/fitness`, {
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    throw new Error(`FAIL FAST: Fitness API returned ${response.status}`);
  }
  return true;
}

/**
 * Find governed content for testing
 */
async function findGovernedContent() {
  const response = await fetch(`${API_URL}/api/v1/fitness/governed-content?limit=10`, {
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`FAIL FAST: Governed content API returned ${response.status}`);
  }

  const data = await response.json();
  const items = data?.items || [];

  if (items.length === 0) {
    throw new Error('FAIL FAST: No governed content available');
  }

  const shows = items.filter(item => item.type === 'show');
  const selected = shows.length > 0 ? shows[0] : items[0];
  const contentId = selected.localId || selected.id?.replace('plex:', '');

  console.log(`Found governed content: "${selected.title}" (${contentId})`);
  return { contentId, title: selected.title };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the displayed name for a device from the sidebar
 * @param {import('@playwright/test').Page} page
 * @param {string} deviceId
 * @returns {Promise<string>}
 */
async function getDeviceName(page, deviceId) {
  const device = page.locator(`.fitness-device[title*="(${deviceId})"]`);
  await device.waitFor({ state: 'visible', timeout: 5000 });
  const nameEl = device.locator('.device-name');
  const text = await nameEl.textContent();
  return text?.trim() || '';
}

/**
 * Wait for device name to match expected value
 * @param {import('@playwright/test').Page} page
 * @param {string} deviceId
 * @param {string} expected
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function waitForDeviceName(page, deviceId, expected, timeoutMs = 10000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const name = await getDeviceName(page, deviceId);
      if (name === expected) {
        console.log(`  Device ${deviceId} shows "${name}" (expected "${expected}")`);
        return true;
      }
    } catch {
      // device not visible yet
    }
    await page.waitForTimeout(200);
  }
  // Final check for error message
  try {
    const name = await getDeviceName(page, deviceId);
    console.log(`  TIMEOUT: Device ${deviceId} shows "${name}" (expected "${expected}")`);
  } catch {
    console.log(`  TIMEOUT: Device ${deviceId} not visible (expected "${expected}")`);
  }
  return false;
}

/**
 * Wait for device to appear in sidebar
 * @param {import('@playwright/test').Page} page
 * @param {string} deviceId
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function waitForDeviceVisible(page, deviceId, timeoutMs = 10000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const device = page.locator(`.fitness-device[title*="(${deviceId})"]`);
    if (await device.isVisible().catch(() => false)) {
      return true;
    }
    await page.waitForTimeout(200);
  }
  return false;
}

/**
 * Wait for device to disappear from sidebar
 * @param {import('@playwright/test').Page} page
 * @param {string} deviceId
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function waitForDeviceGone(page, deviceId, timeoutMs = 15000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const device = page.locator(`.fitness-device[title*="(${deviceId})"]`);
    if (!(await device.isVisible().catch(() => false))) {
      return true;
    }
    await page.waitForTimeout(200);
  }
  return false;
}

/**
 * Wait for NO HR devices to be visible in sidebar
 * @param {import('@playwright/test').Page} page
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function waitForNoDevices(page, timeoutMs = 5000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const devices = page.locator('.fitness-device');
    const count = await devices.count().catch(() => 0);
    if (count === 0) {
      return true;
    }
    await page.waitForTimeout(200);
  }
  return false;
}

/**
 * Get count of visible HR devices
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
async function getVisibleDeviceCount(page) {
  const devices = page.locator('.fitness-device');
  return devices.count().catch(() => 0);
}

/**
 * Check governance overlay for SSOT validation
 * Returns the displayed name if kckern is shown, null otherwise
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string|null>}
 */
async function getGovernanceOverlayName(page) {
  const govOverlay = page.locator('.governance-overlay');
  if (!(await govOverlay.isVisible().catch(() => false))) {
    return null;
  }

  // Look for chip-name elements that might contain kckern's name
  const chipNames = govOverlay.locator('[class*="chip-name"]');
  const count = await chipNames.count();

  for (let i = 0; i < count; i++) {
    const text = await chipNames.nth(i).textContent();
    if (text?.includes('Dad') || text?.includes('KC Kern') || text?.includes('KC')) {
      return text.trim();
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Group Label Fallback', () => {
  test.beforeAll(async () => {
    console.log('\n' + '═'.repeat(80));
    console.log('GROUP LABEL FALLBACK TEST: PREFLIGHT CHECKS');
    console.log('═'.repeat(80));

    // Check fitness API health
    console.log('\n[1/2] Checking fitness API health...');
    await checkApiHealth();
    console.log('  ✓ Fitness API is healthy');

    // Find governed content
    console.log('\n[2/2] Finding governed content...');
    governedContentFixture = await findGovernedContent();
    console.log(`  ✓ Content ID: ${governedContentFixture.contentId}`);

    console.log('\n' + '═'.repeat(80));
    console.log('PREFLIGHT CHECKS PASSED - Starting test');
    console.log('═'.repeat(80) + '\n');
  });

  // Phase 3 requires waiting for ANT+ device timeout (60+ seconds)
  test.slow();

  test('switches to group_label when second device joins', async ({ browser }) => {
    console.log('\n' + '═'.repeat(80));
    console.log('TEST: GROUP LABEL FALLBACK');
    console.log('═'.repeat(80));

    if (!governedContentFixture) {
      throw new Error('FAIL FAST: governedContentFixture not initialized');
    }

    const { contentId } = governedContentFixture;
    console.log(`Using content ID: ${contentId}`);

    const context = await browser.newContext();
    const page = await context.newPage();
    const sim = new FitnessSimHelper(page);

    try {
      // ═══════════════════════════════════════════════════════════════
      // SETUP
      // ═══════════════════════════════════════════════════════════════
      console.log('\n[SETUP] Navigating to fitness player...');
      await page.goto(`${BASE_URL}/fitness/play/${contentId}`);
      await page.waitForSelector('.fitness-player, .fitness-app', { timeout: 15000 });
      await sim.waitForController();
      console.log('  Controller ready');

      // Clear any leftover state from previous test runs
      console.log('  Clearing previous device state...');

      // Step 1: Stop all simulators (stops sending HR data)
      await sim.stopAll();
      console.log('  Stopped all simulators');

      // Step 2: Clear device manager
      const clearResult = await sim.clearAllDevices();
      console.log(`  Cleared ${clearResult?.count || 0} devices from device manager`);

      // Step 3: Wait for UI to reflect no active devices
      const initialCount = await getVisibleDeviceCount(page);
      console.log(`  Initial visible device count: ${initialCount}`);

      if (initialCount > 0) {
        console.log('  Waiting for devices to disappear from UI...');
        const cleared = await waitForNoDevices(page, 8000);
        if (!cleared) {
          const stillCount = await getVisibleDeviceCount(page);
          console.log(`  WARNING: ${stillCount} devices still visible after clear`);
          console.log('  NOTE: If another browser has active simulators, close it and re-run');
        } else {
          console.log('  ✓ All devices cleared from UI');
        }
      }

      await page.waitForTimeout(1000); // Allow WebSocket state to settle

      // Step 4: Check for devices from other sessions (cross-browser pollution)
      // Note: With the fix to filter active devices with HR data, pre-populated devices
      // shouldn't affect preferGroupLabels. But devices from other sessions with active
      // simulators will still cause issues.
      const postSettleCount = await getVisibleDeviceCount(page);
      if (postSettleCount > 0) {
        console.log(`  ⚠️  ISOLATION WARNING: ${postSettleCount} device(s) detected from other session(s)`);
        console.log('     Another browser window may have active simulators.');
        console.log('     Test may fail due to cross-session device pollution.');
        // Don't fail immediately - let the test proceed to see if the fix works
      }

      // Verify required device configs exist (not active devices)
      const devices = await sim.getDevices();
      const hasKckern = devices.some(d => String(d.deviceId) === KCKERN_DEVICE_ID);
      const hasFelix = devices.some(d => String(d.deviceId) === FELIX_DEVICE_ID);

      console.log(`  Configured devices: ${devices.length}`);
      console.log(`  kckern (${KCKERN_DEVICE_ID}): ${hasKckern ? 'found' : 'MISSING'}`);
      console.log(`  felix (${FELIX_DEVICE_ID}): ${hasFelix ? 'found' : 'MISSING'}`);

      expect(hasKckern, `kckern device (${KCKERN_DEVICE_ID}) must exist`).toBe(true);
      expect(hasFelix, `felix device (${FELIX_DEVICE_ID}) must exist`).toBe(true);

      // ═══════════════════════════════════════════════════════════════
      // PHASE 1: Single device - should show display_name
      // ═══════════════════════════════════════════════════════════════
      console.log('\n[PHASE 1] Single device - expecting display_name');
      console.log(`  Activating kckern (${KCKERN_DEVICE_ID})...`);

      await sim.setZone(KCKERN_DEVICE_ID, 'warm');
      await page.waitForTimeout(1000);

      // Check for cross-browser pollution (other sessions injecting devices)
      const visibleAfterActivate = await getVisibleDeviceCount(page);
      if (visibleAfterActivate > 1) {
        console.log(`  ⚠️  WARNING: Expected 1 device, but ${visibleAfterActivate} are visible!`);
        console.log('     This may be due to another browser window with active simulators.');
        console.log('     Close other fitness browser tabs for accurate results.');
      }

      const deviceAppeared = await waitForDeviceVisible(page, KCKERN_DEVICE_ID);
      expect(deviceAppeared, 'kckern device should appear in sidebar').toBe(true);

      const nameFound = await waitForDeviceName(page, KCKERN_DEVICE_ID, EXPECTED.kckern.single);
      expect(nameFound, `kckern should show "${EXPECTED.kckern.single}" when alone`).toBe(true);

      const singleName = await getDeviceName(page, KCKERN_DEVICE_ID);
      console.log(`  ✓ kckern shows: "${singleName}"`);
      expect(singleName).toBe(EXPECTED.kckern.single);

      // ═══════════════════════════════════════════════════════════════
      // PHASE 2: Second device joins - should switch to group_label
      // ═══════════════════════════════════════════════════════════════
      console.log('\n[PHASE 2] Second device joins - expecting group_label');
      console.log(`  Activating felix (${FELIX_DEVICE_ID})...`);

      await sim.setZone(FELIX_DEVICE_ID, 'warm');
      await page.waitForTimeout(1000);

      const felixAppeared = await waitForDeviceVisible(page, FELIX_DEVICE_ID);
      expect(felixAppeared, 'felix device should appear in sidebar').toBe(true);

      // Wait for kckern's name to switch to group_label
      const switchedToGroup = await waitForDeviceName(page, KCKERN_DEVICE_ID, EXPECTED.kckern.group);
      expect(switchedToGroup, `kckern should switch to "${EXPECTED.kckern.group}" when felix joins`).toBe(true);

      const groupName = await getDeviceName(page, KCKERN_DEVICE_ID);
      const felixName = await getDeviceName(page, FELIX_DEVICE_ID);

      console.log(`  ✓ kckern shows: "${groupName}"`);
      console.log(`  ✓ felix shows: "${felixName}"`);

      expect(groupName).toBe(EXPECTED.kckern.group);
      expect(felixName).toBe(EXPECTED.felix.group);

      // ═══════════════════════════════════════════════════════════════
      // SSOT CHECK: Governance overlay should show same label
      // ═══════════════════════════════════════════════════════════════
      console.log('\n[SSOT CHECK] Verifying governance overlay consistency...');
      const overlayName = await getGovernanceOverlayName(page);
      if (overlayName !== null) {
        console.log(`  Governance overlay shows: "${overlayName}"`);
        expect(overlayName, 'Governance overlay should show group_label (SSOT)').toBe(EXPECTED.kckern.group);
        console.log('  ✓ SSOT validated: overlay matches sidebar');
      } else {
        console.log('  (Governance overlay not visible - skipping SSOT check)');
      }

      // ═══════════════════════════════════════════════════════════════
      // PHASE 3: Second device drops - should restore display_name
      // ═══════════════════════════════════════════════════════════════
      console.log('\n[PHASE 3] Second device drops - expecting display_name restored');
      console.log(`  Stopping felix (${FELIX_DEVICE_ID})...`);

      // Force-remove felix's device from the device manager (bypasses ANT+ timeout)
      await page.evaluate((deviceId) => {
        const session = window.__fitnessSession;
        if (session?.deviceManager) {
          session.deviceManager.removeDevice(deviceId);
        }
      }, FELIX_DEVICE_ID);
      await sim.stopDevice(FELIX_DEVICE_ID);
      await page.waitForTimeout(1000); // Give time for state to propagate

      // Wait for felix to disappear from UI
      const felixGone = await waitForDeviceGone(page, FELIX_DEVICE_ID, 10000);
      console.log(`  felix device gone: ${felixGone}`);

      // Wait for kckern's name to switch back to display_name
      const switchedBack = await waitForDeviceName(page, KCKERN_DEVICE_ID, EXPECTED.kckern.single, 10000);
      expect(switchedBack, `kckern should switch back to "${EXPECTED.kckern.single}" when felix leaves`).toBe(true);

      const restoredName = await getDeviceName(page, KCKERN_DEVICE_ID);
      console.log(`  ✓ kckern shows: "${restoredName}"`);
      expect(restoredName).toBe(EXPECTED.kckern.single);

      // ═══════════════════════════════════════════════════════════════
      // RESULTS
      // ═══════════════════════════════════════════════════════════════
      console.log('\n' + '═'.repeat(80));
      console.log('RESULTS');
      console.log('═'.repeat(80));
      console.log('\n  Phase 1 (single device): kckern showed "KC Kern" ✓');
      console.log('  Phase 2 (multi device):  kckern showed "Dad", felix showed "Felix" ✓');
      console.log('  Phase 3 (device drop):   kckern restored to "KC Kern" ✓');
      if (overlayName !== null) {
        console.log('  SSOT check:              governance overlay matched sidebar ✓');
      }
      console.log('\n✓ Test passed');

    } finally {
      await sim.stopAll().catch(() => {});
      await context.close();
    }
  });
});
