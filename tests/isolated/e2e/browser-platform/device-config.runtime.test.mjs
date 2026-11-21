import { expect, test } from '@playwright/test';

const CONFIG_PATH = '/api/v1/device/config';
const cameras = {
  'old-screen': { input: { preferred_camera: 'Old Camera' } },
  'new-screen': { input: { preferred_camera: 'New Camera' } },
};

async function mockCaptureDevices(page) {
  await page.addInitScript(() => {
    window.captureAttempts = [];
    Object.defineProperty(navigator, 'mediaDevices', { value: {
      async getUserMedia(constraints) {
        window.captureAttempts.push(constraints.video?.deviceId?.exact ?? 'default');
        return new MediaStream();
      },
      async enumerateDevices() {
        return [
          { deviceId: 'default-camera', kind: 'videoinput', label: 'Default Camera' },
          { deviceId: 'old-camera', kind: 'videoinput', label: 'Old Camera' },
          { deviceId: 'new-camera', kind: 'videoinput', label: 'New Camera' },
        ];
      },
      addEventListener() {},
      removeEventListener() {},
    } });
  });
  await page.routeWebSocket('**/*', () => {});
  return () => page.evaluate(() => window.captureAttempts);
}

async function goToDevice(page, deviceId) {
  await page.evaluate(id => {
    history.pushState(null, '', `/app/videocall/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, deviceId);
}

test('VideoCall selects the current device from a pending full roster across route changes', async ({ page }) => {
  const captureAttempts = await mockCaptureDevices(page);
  const devices = Promise.withResolvers();
  const joining = [];
  let configReads = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === CONFIG_PATH) {
      configReads += 1;
      return route.fulfill({ json: await devices.promise });
    }
    if (path.endsWith('/join-active')) {
      joining.push(path.split('/').at(-2));
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  try {
    await page.goto('/app/videocall/old-screen');
    await expect.poll(() => configReads).toBe(1);
    await goToDevice(page, 'new-screen');
    await expect.poll(() => joining).toContain('new-screen');
    const beforeConfig = await captureAttempts();
    devices.resolve({ devices: cameras });
    await expect.poll(captureAttempts).toContain('new-camera');
    expect(await captureAttempts()).not.toContain('old-camera');
    expect(beforeConfig).toEqual([]);
    expect(configReads).toBe(1);

    await goToDevice(page, 'old-screen');
    await expect.poll(captureAttempts).toContain('old-camera');
    expect((await captureAttempts()).filter(id => id !== 'default')).toEqual(['new-camera', 'old-camera']);
    expect(configReads).toBe(1);
  } finally {
    devices.resolve({ devices: cameras });
  }
});

test('Webcam uses the first configured camera from a legacy flat device roster', async ({ page }) => {
  const captureAttempts = await mockCaptureDevices(page);
  let configReads = 0;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === CONFIG_PATH) {
      configReads += 1;
      return route.fulfill({ json: { printer: { type: 'printer' }, ...cameras } });
    }
    return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  await page.goto('/app/webcam');
  await expect.poll(captureAttempts).toContain('old-camera');
  expect(await captureAttempts()).not.toContain('new-camera');
  expect(configReads).toBe(1);
});
