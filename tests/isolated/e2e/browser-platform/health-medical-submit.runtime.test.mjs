import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

async function installMedical(page) {
  const release = Promise.withResolvers();
  const submissions = [];
  let metrics = [];
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
  await page.route('**/health/context', route => route.fulfill({ json: { userId: 'alice' } }));
  await page.route('**/api/v1/health/medical', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { metrics } });
    const { metric, value, date, note } = route.request().postDataJSON();
    submissions.push({ metric, value, note });
    const failure = submissions.length === 1 && await release.promise;
    if (failure) return route.fulfill({ status: 409, json: { message: 'Reading was refused' } });
    const reading = { id: String(submissions.length), date, value, note };
    metrics = [{ metric, readings: [reading], latest: reading }];
    return route.fulfill({ json: reading });
  });
  await page.goto('/health/medical');
  return { release, submissions };
}

async function fillReading(page, note) {
  await page.getByRole('button', { name: 'Add reading', exact: true }).press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Add reading', exact: true });
  await dialog.getByLabel('Metric', { exact: true }).fill('glucose');
  await dialog.getByLabel('Value', { exact: true }).fill('110');
  await dialog.getByLabel('Note', { exact: true }).fill(note);
  return dialog;
}

test('Health applies a committed reading without closing the replacement draft', async ({ page }) => {
  const { release, submissions } = await installMedical(page);
  const first = await fillReading(page, 'Committed reading');
  await first.getByRole('button', { name: 'Save reading' }).press('Enter');
  await expect.poll(() => submissions).toEqual([{ metric: 'glucose', value: 110, note: 'Committed reading' }]);
  await first.getByRole('button', { name: 'Close' }).press('Enter');
  await expect(first).toBeHidden();

  const replacement = await fillReading(page, 'Replacement draft');
  release.resolve();
  await expect(page.getByText('Committed reading', { exact: true })).toBeVisible();
  await expect(replacement.getByLabel('Note', { exact: true })).toHaveValue('Replacement draft');
  expect(submissions).toHaveLength(1);
});

test('Health keeps focus and admits one reading save at a time, then retries the refusal', async ({ page }) => {
  const { release, submissions } = await installMedical(page);
  const dialog = await fillReading(page, 'Retry draft');
  const save = dialog.getByRole('button', { name: 'Save reading' });
  await save.press('Enter');
  await expect.poll(() => submissions).toHaveLength(1);
  await expect(save).toBeFocused();
  await expect(save).toHaveAttribute('aria-busy', 'true');
  await save.press('Enter');
  await dialog.locator('form').evaluate(form => form.requestSubmit());
  expect(submissions).toHaveLength(1);

  release.resolve(true);
  await expect(dialog.getByRole('alert')).toContainText('Reading was refused');
  await expect(dialog.getByLabel('Note', { exact: true })).toHaveValue('Retry draft');
  await expect(save).toBeFocused();
  await save.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Retry draft', { exact: true })).toBeVisible();
  expect(submissions).toHaveLength(2);
});
