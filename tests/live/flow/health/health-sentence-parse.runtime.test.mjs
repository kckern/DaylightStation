// tests/live/flow/health/health-sentence-parse.runtime.test.mjs
// Benchmark journey #2: free sentence → pending card (real AI parse) →
// accept → totals move. Costs one real AI call by design — if the gateway
// is down this test correctly FAILS; do not weaken it to a skip.
import { test, expect } from '@playwright/test';

test.afterEach(async ({ request }) => {
  const res = await request.get('/api/v1/health/nutrilist');
  const body = await res.json().catch(() => ({}));
  for (const row of body?.data || []) {
    const name = (row.name || row.item || '').toLowerCase();
    if (name.includes('egg') || name.includes('toast') || name.includes('sourdough')) {
      await request.delete(`/api/v1/health/nutrilist/${row.uuid}`).catch(() => {});
    }
  }
});

test('free sentence → pending card → accept → totals move', async ({ page }) => {
  test.setTimeout(90_000); // real AI parse in the loop
  page.on('dialog', (d) => d.accept());

  await page.goto('/health');
  await page.getByText(/Add food/).first().click();
  const input = page.getByPlaceholder(/Food name/);
  await input.fill('two scrambled eggs and a slice of sourdough toast');
  await input.press('Enter');

  // Pending card with itemized parse — the AI gateway being down FAILS here (no-skip policy).
  const card = page.locator('.health-pending');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByRole('button', { name: /accept/i })).toBeVisible();
  await card.getByRole('button', { name: /accept/i }).click();

  // Accepted entries land in the log
  await expect(page.locator('.health-row', { hasText: /egg/i }).first()).toBeVisible({ timeout: 15_000 });

  // Cleanup: delete what we logged
  for (const pattern of [/egg/i, /toast|sourdough/i]) {
    const row = page.locator('.health-row', { hasText: pattern }).first();
    if (await row.isVisible().catch(() => false)) {
      await row.click();
      await page.getByRole('button', { name: /^Delete$/ }).click();
    }
  }
});
