import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

/** Read-only live check: never pairs, disconnects or forgets a real peripheral. */
test('configured arcade host exposes controller recovery without leaving its screen', async ({ page, request }) => {
  const configResponse = await request.get(`${FRONTEND_URL}/api/v1/device/config`);
  expect(configResponse.ok(), 'Device registry must be readable').toBe(true);
  const registry = await configResponse.json();
  const hosts = Object.entries(registry.devices || registry).filter(([,d])=>d.bluetooth_bridge?.url);
  const wanted = process.env.BLUETOOTH_DEVICE_ID;
  const chosen = wanted ? hosts.find(([id])=>id===wanted) : hosts.length===1 ? hosts[0] : null;
  expect(chosen, 'Select one configured bluetooth_bridge host with BLUETOOTH_DEVICE_ID when there are several').toBeTruthy();
  const [deviceId, device] = chosen;
  expect(device.screen_path, 'Configured host must declare its kiosk screen_path').toBeTruthy();
  const stateResponse = await request.get(`${FRONTEND_URL}/api/v1/arcade-bluetooth/${encodeURIComponent(deviceId)}`);
  expect(stateResponse.ok(), 'Native Bluetooth API must be reachable through the mounted adapter').toBe(true);
  const state = await stateResponse.json();
  expect(state.ok).toBe(true);expect(Array.isArray(state.devices)).toBe(true);
  await page.goto(`${FRONTEND_URL}${device.screen_path}`);
  const entry = page.getByRole('button', { name: 'Controllers', exact: true });
  // A screen may initially show its root menu rather than its game-selection view.
  if (!(await entry.isVisible())) await page.getByText(/^(Video Games|Games|Arcade)$/).first().click();
  await expect(entry).toBeVisible();
  await entry.focus();await page.keyboard.press('Enter');
  const recovery = page.getByRole('dialog', { name: 'Controller recovery' });
  await expect(recovery).toBeVisible();
  await expect(recovery.getByText('Reading controller status…')).not.toBeVisible();
  const before = page.url();
  const forget = recovery.getByRole('button', { name: /^Forget / }).first();
  expect(state.devices.some(d=>d.manageable && d.bond==='bonded'), 'This lifecycle check requires a bonded gamepad').toBe(true);
  await expect(forget).toBeEnabled();await forget.click();
  await expect(recovery.getByRole('region', { name: 'Confirm forget' })).toBeVisible();
  await recovery.getByRole('button', { name: 'Cancel forget' }).click();
  await page.keyboard.press('Escape');await expect(recovery).not.toBeVisible();
  await expect(entry).toBeFocused();expect(page.url()).toBe(before);
});
