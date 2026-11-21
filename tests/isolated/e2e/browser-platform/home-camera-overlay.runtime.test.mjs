import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', hasTouch: true });

test('Home camera controls offer keyboard-accessible retry after the inventory request fails', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  const reads = [];
  const writes = [];
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/camera/doorbell/controls')) {
      reads.push(request.method());
      if (reads.length === 1) return route.fulfill({ status: 403, json: { error: 'Not authorized' } });
      return route.fulfill({ json: { controls: [{ id: 'light', type: 'light', label: 'Camera light', state: 'off' }] } });
    }
    if (request.method() !== 'GET' && pathname.startsWith('/api/v1/camera')) writes.push(pathname);
    return route.fulfill({ json: pathname === '/api/v1/camera' ? { cameras: [{ id: 'doorbell' }] } : {} });
  });

  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto('/home');
  await page.getByRole('button', { name: 'Cameras', exact: true }).click();
  await page.getByRole('button', { name: 'Fullscreen doorbell', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Camera: doorbell', exact: true });
  const retry = dialog.getByRole('button', { name: 'Retry', exact: true });
  await expect(retry).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close camera', exact: true })).toBeVisible();
  await retry.focus();
  await page.keyboard.press('Enter');

  await expect(dialog.getByRole('button', { name: 'Camera light', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  expect(reads).toEqual(['GET', 'GET']);
  expect(writes).toEqual([]);
});

test('Home camera treats an empty controls inventory as a valid empty result', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/camera/doorbell/controls')) return route.fulfill({ json: { controls: [] } });
    return route.fulfill({ json: pathname === '/api/v1/camera' ? { cameras: [{ id: 'doorbell' }] } : {} });
  });

  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto('/home');
  await page.getByRole('button', { name: 'Cameras', exact: true }).click();
  await page.getByRole('button', { name: 'Fullscreen doorbell', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Camera: doorbell', exact: true });
  await expect(dialog.getByRole('button', { name: 'Close camera', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button')).toHaveCount(1);
});

test('Home camera keeps focus in its viewer when Retry returns an empty inventory', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  let reads = 0;
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/camera/doorbell/controls')) {
      if (++reads === 1) return route.fulfill({ status: 403, json: { error: 'Not authorized' } });
      return route.fulfill({ json: { controls: [] } });
    }
    return route.fulfill({ json: pathname === '/api/v1/camera' ? { cameras: [{ id: 'doorbell' }] } : {} });
  });

  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto('/home');
  await page.getByRole('button', { name: 'Cameras', exact: true }).click();
  await page.getByRole('button', { name: 'Fullscreen doorbell', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Camera: doorbell', exact: true });
  const region = dialog.getByRole('region', { name: 'Camera controls', exact: true });
  await dialog.getByRole('button', { name: 'Retry', exact: true }).focus();
  await page.keyboard.press('Enter');

  await expect(region).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Close camera', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close camera', exact: true })).toBeFocused();
  await expect(dialog).toBeVisible();
});

test('Home camera retires stale controls while a command readback is pending or failed', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  const writes = [];
  let reads = 0;
  let heldRead;
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/camera/doorbell/controls')) {
      if (++reads === 1) return route.fulfill({ json: { controls: [{ id: 'light', type: 'light', label: 'Camera light', state: 'off' }] } });
      if (reads === 2) { heldRead = route; return; }
      return route.fulfill({ json: { controls: [{ id: 'light', type: 'light', label: 'Camera light', state: 'on' }] } });
    }
    if (request.method() !== 'GET' && pathname.startsWith('/api/v1/camera')) {
      writes.push(pathname);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: pathname === '/api/v1/camera' ? { cameras: [{ id: 'doorbell' }] } : {} });
  });

  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto('/home');
  await page.getByRole('button', { name: 'Cameras', exact: true }).click();
  await page.getByRole('button', { name: 'Fullscreen doorbell', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Camera: doorbell', exact: true });
  const light = dialog.getByRole('button', { name: 'Camera light', exact: true });
  await expect(light).toBeEnabled();
  await light.click();
  await expect.poll(() => reads).toBe(2);
  await expect(light).toBeDisabled();
  await heldRead.fulfill({ status: 403, json: { error: 'Readback unavailable' } });
  await expect(light).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Retry', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => reads).toBe(3);
  await expect(dialog.getByRole('button', { name: 'Camera light', exact: true })).toBeVisible();
  expect(writes).toEqual(['/api/v1/camera/doorbell/controls/light']);
});

test('Home camera serializes each control command and unlocks it after refusal', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  const writes = [];
  let pendingWrite;
  let controlReads = 0;
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/camera/doorbell/controls')) {
      controlReads += 1;
      return route.fulfill({ json: { controls: [{ id: 'light', type: 'light', label: 'Camera light', state: controlReads > 2 ? 'on' : 'off' }] } });
    }
    if (request.method() === 'POST' && pathname.endsWith('/camera/doorbell/controls/light')) {
      writes.push(request.postDataJSON());
      if (writes.length === 1) { pendingWrite = route; return; }
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: pathname === '/api/v1/camera' ? { cameras: [{ id: 'doorbell' }] } : {} });
  });

  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto('/home');
  await page.getByRole('button', { name: 'Cameras', exact: true }).click();
  await page.getByRole('button', { name: 'Fullscreen doorbell', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Camera: doorbell', exact: true });
  const light = dialog.getByRole('button', { name: 'Camera light', exact: true });
  await expect(light).toBeEnabled();
  await light.click();
  await expect.poll(() => Boolean(pendingWrite)).toBe(true);
  await expect(light).toBeDisabled();
  expect(writes).toEqual([{ action: 'on' }]);

  await pendingWrite.fulfill({ status: 503, json: { error: 'Command refused' } });
  await expect(dialog.getByRole('alert')).toContainText('Command refused');
  await expect(light).toBeEnabled();
  await light.click();
  await expect.poll(() => writes).toEqual([{ action: 'on' }, { action: 'on' }]);
  await expect(light).toBeVisible();
  await expect(light).toBeDisabled();
  await expect.poll(() => controlReads).toBe(2);
  await expect(dialog.getByRole('button', { name: 'Camera light', exact: true })).toBeEnabled();
});

for (const width of [390, 1440]) {
  test(`Home camera traps focus and returns it to the fullscreen trigger at ${width}px`, async ({ page, baseURL }) => {
    const origin = new URL(baseURL).origin;
    const writes = [];
    await page.context().route('**/*', route => (
      new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
    ));
    await page.setViewportSize({ width, height: 850 });
    await page.routeWebSocket('**/*', () => {});
    await page.route('**/api/**', route => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (request.method() !== 'GET' && pathname.startsWith('/api/v1/camera')) writes.push(pathname);
      if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
      if (pathname.endsWith('/camera/doorbell/controls')) {
        return route.fulfill({ json: { controls: [{ id: 'light', type: 'light', label: 'Camera light', state: 'off' }] } });
      }
      return route.fulfill({ json: pathname.endsWith('/api/v1/camera') ? { cameras: [{ id: 'doorbell' }] } : {} });
    });

    await page.goto('/home');
    await page.getByRole('button', { name: 'Cameras', exact: true }).press('Enter');
    const opener = page.getByRole('button', { name: 'Fullscreen doorbell', exact: true });
    const main = page.locator('main');
    await main.evaluate(element => {
      document.body.style.setProperty('overflow-x', 'clip', 'important');
      element.style.setProperty('overflow-y', 'scroll');
    });
    const scrolling = () => main.evaluate(element => ({
      body: [
        document.body.style.getPropertyValue('overflow-x'),
        document.body.style.getPropertyValue('overflow-y'),
        document.body.style.getPropertyPriority('overflow-x'),
      ],
      main: element.style.overflow,
    }));
    const restored = { body: ['clip', '', 'important'], main: '' };
    await opener.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Camera: doorbell', exact: true });
    const close = dialog.getByRole('button', { name: 'Close camera', exact: true });
    const light = dialog.getByRole('button', { name: 'Camera light', exact: true });
    await expect(close).toBeFocused();
    await expect(light).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds).toEqual({ x: 0, y: 0, width, height: 850 });

    await page.keyboard.press('Tab');
    await expect(light).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(light).toBeFocused();

    await page.keyboard.press('+');
    await expect(dialog.locator('.camera-viewport__zoom-indicator')).not.toHaveText('1.0x');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await expect.poll(scrolling).toEqual(restored);
    await expect(main).toHaveCSS('overflow-y', 'scroll');

    await opener.tap({ position: { x: 2, y: 22 } });
    await expect(close).toBeFocused();
    await expect.poll(scrolling).toEqual({ body: ['hidden', 'hidden', ''], main: 'hidden' });
    await close.tap();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await expect.poll(scrolling).toEqual(restored);
    expect(writes).toEqual([]);
  });
}

test('Home camera replaces a held detection read on foreground return', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.addInitScript(() => {
    window.cameraVisibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { get: () => window.cameraVisibility });
  });
  await page.routeWebSocket('**/*', () => {});
  let held;
  let reads = 0;
  let canceled = false;
  page.on('requestfailed', request => {
    if (held?.request() === request) canceled = true;
  });
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/v1/camera/doorbell/state') {
      if (++reads === 1) {
        held = route;
        return;
      }
      return route.fulfill({ json: { detections: [{ type: 'motion', active: true }] } });
    }
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    return route.fulfill({ json: pathname === '/api/v1/camera' ? { cameras: [{ id: 'doorbell' }] } : {} });
  });

  await page.goto('/home');
  await page.getByRole('button', { name: 'Cameras', exact: true }).click();
  await expect.poll(() => reads).toBe(1);
  await page.evaluate(() => {
    window.cameraVisibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    window.cameraVisibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
  });
  // The foreground event must issue a replacement before the two-second poll.
  await expect.poll(() => reads, { timeout: 1500 }).toBe(2);
  await expect.poll(() => canceled).toBe(true);
  await expect(page.getByText('motion', { exact: true })).toBeVisible();
  await held.fulfill({ json: { detections: [{ type: 'person', active: true }] } }).catch(() => {});
  await expect(page.getByText('person', { exact: true })).toHaveCount(0);
});
