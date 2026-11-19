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

    await opener.tap({ position: { x: 2, y: 22 } });
    await expect(close).toBeFocused();
    await close.tap();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    expect(writes).toEqual([]);
  });
}
