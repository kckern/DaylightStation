// tests/live/flow/health/health-barcode-lifecycle.runtime.test.mjs
// Benchmark journey #3: unknown UPC → custom food sheet → create → rescan
// hits the catalog. No camera in headless — exercises the manual-UPC field,
// the same submit path a real camera decode uses (BarcodeCapture.onDecode).
import { test, expect } from '@playwright/test';

// Random 12-digit code per run, well outside the real GTIN space (999999xxxxxx)
// so it's never in OFF/Nutritionix — guarantees the "unknown" half every time —
// and never collides with a PRIOR run's own catalog mapping, so the "rescan
// resolves from the catalog" half is only ever testing what THIS run created.
// There is no catalog delete route, so a fixed shared UPC would silently skip
// the unknown-sheet path on the second and later runs.
function randomUpc() {
  const suffix = Math.floor(100000 + Math.random() * 900000);
  return `999999${suffix}`;
}

test.afterEach(async ({ request }) => {
  const res = await request.get('/api/v1/health/nutrilist');
  const body = await res.json().catch(() => ({}));
  for (const row of body?.data || []) {
    const name = row.name || row.item || '';
    if (name.includes('Playwright Granola')) {
      await request.delete(`/api/v1/health/nutrilist/${row.uuid}`).catch(() => {});
    }
  }
});

test('unknown UPC → custom food sheet → create → rescan hits the catalog', async ({ page, request }) => {
  test.setTimeout(90_000);
  page.on('dialog', (d) => d.accept());

  const upc = randomUpc();
  const foodName = `Playwright Granola ${Date.now()}`;

  await page.goto('/health');

  // Open barcode capture, use the manual-UPC field (the same submit path as a camera decode)
  await page.getByRole('button', { name: /barcode/i }).click();
  await page.getByLabel('Manual UPC entry').fill(upc);
  await page.getByRole('button', { name: /look up/i }).click();

  // Unknown → CustomFoodSheet
  await expect(page.getByText(/isn't in any database/)).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Name').fill(foodName);
  await page.getByLabel(/Calories/).fill('210');
  await page.getByRole('button', { name: /create & log/i }).click();
  await expect(page.locator('.health-row', { hasText: foodName })).toBeVisible({ timeout: 15_000 });

  // Rescan: same UPC now resolves from the catalog (no unknown sheet)
  await page.getByRole('button', { name: /barcode/i }).click();
  await page.getByLabel('Manual UPC entry').fill(upc);
  await page.getByRole('button', { name: /look up/i }).click();
  await expect(page.getByText(/isn't in any database/)).not.toBeVisible({ timeout: 30_000 });

  // Cleanup rows created by both scans — both carry the identical distinctive
  // name, so a UI-click loop can't disambiguate which "first match" survived
  // a prior delete's in-flight reload (raced and flaked in practice: the
  // list mutates out from under the locator between find and click). The
  // API is the deterministic seam — same one afterEach uses as a backstop.
  const res = await request.get('/api/v1/health/nutrilist');
  const body = await res.json().catch(() => ({}));
  for (const row of body?.data || []) {
    if ((row.name || row.item || '') === foodName) {
      await request.delete(`/api/v1/health/nutrilist/${row.uuid}`).catch(() => {});
    }
  }
  const check = await request.get('/api/v1/health/nutrilist');
  const remaining = ((await check.json().catch(() => ({}))).data || [])
    .filter((row) => (row.name || row.item || '') === foodName);
  expect(remaining.length).toBe(0);
});
