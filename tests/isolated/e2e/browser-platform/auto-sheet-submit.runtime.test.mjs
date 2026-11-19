import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

const root = '/api/v1/automotive';
const car = `${root}/vehicles/sample`;
const fixtures = {
  [`${root}/vehicles`]: { vehicles: [{ id: 'sample', label: 'Sample' }] },
  [car]: { odometer: { km: 123 }, fuel: { needsMoreData: true }, trip_count: 1 },
  [`${car}/journeys`]: { journeys: [{ id: 'drive', title: 'Morning drive', origin: { fix: { lat: 1, lon: 2 } }, stops: [] }] },
  [`${car}/fuel`]: { logs: [] },
  [`${car}/service`]: { records: [] },
};

for (const { tab, title, field, value, path, expected } of [
  { tab: 'Fuel', title: 'Log a fill-up', field: 'Gallons', value: '5', path: `${car}/fuel`, expected: { volumeGal: 5 } },
  { tab: 'Service', title: 'Log service', field: 'Who did it', value: 'Fixture garage', path: `${car}/service`, expected: { vendor: 'Fixture garage' } },
  { tab: 'Drives', title: 'Name this place', field: 'What is it?', value: 'Fixture place', path: `${root}/places`, expected: { label: 'Fixture place' } },
]) {
  test(`Auto ${tab} keeps the keyboard on Save through a refused submission`, async ({ page }) => {
    const finishFirstSave = Promise.withResolvers();
    const saves = [];
    await page.routeWebSocket('**/*', () => {});
    await page.route('**/api/**', async route => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (!pathname.startsWith('/api/')) return route.fallback();
      if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
      if (pathname === path && request.method() === 'POST') {
        saves.push(request.postDataJSON());
        if (saves.length === 1) {
          await finishFirstSave.promise;
          return route.fulfill({ status: 422, json: { error: 'Record refused' } });
        }
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({ json: fixtures[pathname] ?? {} });
    });

    await page.goto('/auto');
    await page.getByRole('button', { name: tab, exact: true }).click();
    const opener = page.getByRole('button', { name: title, exact: true });
    await opener.press('Enter');
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    const input = dialog.getByLabel(field, { exact: true });
    const save = dialog.getByRole('button', { name: 'Save', exact: true });
    await input.fill(value);
    try {
      await save.press('Enter');
      await expect.poll(() => saves).toHaveLength(1);
      const pending = dialog.getByRole('button', { name: 'Saving…', exact: true });
      await expect(pending).toBeFocused();
      await expect(pending).toBeDisabled();
      await page.keyboard.press('Enter');
      await dialog.getByRole('form', { name: title, exact: true }).evaluate(form => form.requestSubmit());
    } finally {
      finishFirstSave.resolve();
    }

    await expect(dialog.getByRole('alert')).toContainText('Record refused');
    await expect(input).toHaveValue(value);
    await expect(save).toBeFocused();
    expect(saves).toEqual([expect.objectContaining(expected)]);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    expect(saves).toEqual([expect.objectContaining(expected), expect.objectContaining(expected)]);
  });
}
