import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', hasTouch: true });

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
