import { test, expect } from '@playwright/test';
import { getAppUrl } from '../../../_lib/configHelper.mjs';

test('combobox keeps user scroll position after pagination load-more', async ({ page }) => {
  const base = await getAppUrl();
  await page.goto(`${base}/admin`);

  // Navigate to a list with a row whose value has many siblings (hymns, plex albums, etc.)
  // Adjust selector to your admin's actual navigation.
  await page.getByRole('link', { name: /menus|lists|fhe/i }).first().click();

  // Click a row that will trigger sibling pagination.
  const paginatedRow = page.locator('[data-content-value^="singalong:hymn/"], [data-content-value^="plex:"]').first();
  await paginatedRow.click();

  const dropdown = page.locator('[role="listbox"]').first();
  await expect(dropdown).toBeVisible();

  // Wait for sibling items to render.
  await page.waitForTimeout(300);

  // Capture initial scroll state.
  const initialScroll = await dropdown.evaluate(el => ({ top: el.scrollTop, items: el.querySelectorAll('[data-value]').length }));

  // Scroll to bottom to trigger pagination.
  await dropdown.evaluate(el => { el.scrollTop = el.scrollHeight; });

  // Wait for pagination to fire and new items to append.
  await page.waitForFunction(
    (initialCount) => {
      const el = document.querySelector('[role="listbox"]');
      return el && el.querySelectorAll('[data-value]').length > initialCount;
    },
    initialScroll.items,
    { timeout: 3000 }
  );

  // Verify the scroll position did NOT snap back to the top / selected item.
  const afterScroll = await dropdown.evaluate(el => el.scrollTop);

  // Allow some tolerance (browser may scroll a few px when new content arrives), but
  // assert we're still clearly below the initial position of the selected item.
  expect(afterScroll).toBeGreaterThan(initialScroll.top + 100);
});
