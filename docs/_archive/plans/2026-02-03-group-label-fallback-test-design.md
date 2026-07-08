# Group Label Fallback Test Design

**Date:** 2026-02-03
**Status:** Ready for implementation

## Overview

A Playwright test that verifies the `group_label` fallback behavior in the fitness sidebar when multiple HR devices are active.

**File:** `tests/live/flow/fitness/group-label-fallback.runtime.test.mjs`

## Background

When a single user is exercising, the sidebar shows their full `display_name` (e.g., "User_1"). When multiple users join, the system switches to showing `group_label` for users who have one configured (e.g., "Dad"), making the UI more compact and familiar.

### Config Sources

- **user_1** (device 40475): `display_name: "User_1"`, `group_label: "Dad"`
- **user_2** (device 90003): `display_name: "User_2"`, no group_label

### Trigger Condition

The switch happens when `heartRateDevices.length > 1` (see `FitnessContext.jsx:1218`).

## Test Flow

```
1. Navigate to governed content
2. Wait for FitnessSimController ready
3. Activate user_1 device (40475) → zone 'warm'
4. Wait for sidebar to show device row
5. ASSERT: user_1 row shows "User_1"
6. Activate user_2 device (90003) → zone 'warm'
7. Poll until user_1 row shows "Dad" (with timeout)
8. ASSERT: user_1 row shows "Dad"
9. ASSERT: user_2 row shows "User_2"
10. (SSOT) If governance overlay visible, assert it also shows "Dad"
11. Deactivate user_2 device
12. Poll until user_1 row shows "User_1" (with timeout)
13. ASSERT: user_1 row shows "User_1"
```

## DOM Selectors

### Device Row Location

The device card has a title attribute containing the device ID:

```jsx
// FitnessUsers.jsx:1077-1078
<div
  className="fitness-device ..."
  title="Device: User_1 (40475) - ..."
>
```

### Device Name Element

```jsx
// FitnessUsers.jsx:1131
<div className="device-name">
  {deviceName}
</div>
```

### Selector Strategy

```javascript
// Find device by ID in title attribute
const device = page.locator(`.fitness-device[title*="(${deviceId})"]`);
const nameEl = device.locator('.device-name');
const name = await nameEl.textContent();
```

## Helper Functions

```javascript
/**
 * Get the displayed name for a device
 */
async function getDeviceName(page, deviceId) {
  const device = page.locator(`.fitness-device[title*="(${deviceId})"]`);
  await device.waitFor({ state: 'visible', timeout: 5000 });
  const nameEl = device.locator('.device-name');
  return (await nameEl.textContent()).trim();
}

/**
 * Wait for device name to match expected value
 */
async function waitForDeviceName(page, deviceId, expected, timeoutMs = 10000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const name = await getDeviceName(page, deviceId);
      if (name === expected) return true;
    } catch { /* device not visible yet */ }
    await page.waitForTimeout(200);
  }
  return false;
}
```

## Test Structure

```javascript
test.describe('Group Label Fallback', () => {
  test.beforeAll(async () => {
    // Fail-fast checks:
    // 1. API health
    // 2. Governed content exists
  });

  test('switches to group_label when second device joins', async ({ browser }) => {
    // Setup
    const context = await browser.newContext();
    const page = await context.newPage();
    const sim = new FitnessSimHelper(page);

    try {
      // Navigate and wait for controller
      await page.goto(`${BASE_URL}/fitness/play/${contentId}`);
      await sim.waitForController();

      // Verify devices exist
      const devices = await sim.getDevices();
      const hasKckern = devices.some(d => String(d.deviceId) === '40475');
      const hasFelix = devices.some(d => String(d.deviceId) === '90003');
      expect(hasKckern, 'user_1 device (40475) must exist').toBe(true);
      expect(hasFelix, 'user_2 device (90003) must exist').toBe(true);

      // Phase 1: Single device - should show display_name
      await sim.setZone('40475', 'warm');
      await waitForDeviceName(page, '40475', 'User_1');
      expect(await getDeviceName(page, '40475')).toBe('User_1');

      // Phase 2: Second device joins - should switch to group_label
      await sim.setZone('90003', 'warm');
      await waitForDeviceName(page, '40475', 'Dad');
      expect(await getDeviceName(page, '40475')).toBe('Dad');
      expect(await getDeviceName(page, '90003')).toBe('User_2');

      // SSOT check: if lock screen visible, verify label matches
      const govOverlay = page.locator('.governance-overlay');
      if (await govOverlay.isVisible()) {
        const lockName = await govOverlay.locator('[class*="chip-name"]').textContent();
        if (lockName?.includes('Dad') || lockName?.includes('KC')) {
          expect(lockName.trim()).toBe('Dad');
        }
      }

      // Phase 3: Second device drops - should restore display_name
      await sim.stopDevice('90003');
      await waitForDeviceName(page, '40475', 'User_1');
      expect(await getDeviceName(page, '40475')).toBe('User_1');

    } finally {
      await sim.stopAll().catch(() => {});
      await context.close();
    }
  });
});
```

## Exit Criteria

1. Test passes when labels switch correctly on device join/leave
2. No placeholders or stale labels observed
3. Lock screen (if visible) shows same label as sidebar (SSOT validation)
4. Fail-fast on missing devices or API issues

## Files to Create

- `tests/live/flow/fitness/group-label-fallback.runtime.test.mjs`

## Related Files

- `frontend/src/context/FitnessContext.jsx` - preferGroupLabels logic (line 1218)
- `frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx` - hrDisplayNameMap (line 443)
- `frontend/src/hooks/fitness/types.js` - resolveDisplayLabel (line 112)
- `tests/_lib/FitnessSimHelper.mjs` - test automation helper
