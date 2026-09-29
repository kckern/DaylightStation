import { expect } from '@playwright/test';

/**
 * Scroll a paged Browse list the way a person does until `rowTestId` exists.
 * Browse loads 50 titles at a time; the next page loads when the
 * `browse-page-sentinel` scrolls into view. A title past the first page is
 * therefore only reachable by scrolling — tests must not assume the whole
 * container arrived at once.
 *
 * Fails (does not return quietly) if the list runs out or `maxPages` pass
 * without the row appearing.
 */
export async function revealBrowseRow(page, rowTestId, { maxPages = 20, pageTimeout = 30000 } = {}) {
  const row = page.getByTestId(rowTestId);
  const rows = page.locator('[data-testid^="browse-row-"]');
  const sentinel = page.getByTestId('browse-page-sentinel');
  await expect(rows.first()).toBeVisible({ timeout: pageTimeout });
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    if (await row.count() > 0) {
      await row.scrollIntoViewIfNeeded();
      return row;
    }
    if (await sentinel.count() === 0) break;
    const before = await rows.count();
    await sentinel.scrollIntoViewIfNeeded();
    await expect.poll(() => rows.count(), { timeout: pageTimeout }).toBeGreaterThan(before);
  }
  await expect(row, `${rowTestId} never appeared after scrolling the Browse list`).toHaveCount(1);
  return row;
}
