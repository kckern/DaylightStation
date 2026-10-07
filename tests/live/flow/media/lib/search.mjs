// Search helpers shared by journeys: one vocabulary for the phone's full-screen
// SearchMode and the tablet/laptop dock combobox. Ordinary input only.
import { expect } from '@playwright/test';

export const isPhone = (vp) => vp.width < 600;

export async function goArea(page, vp, area) {
  const nav = page.getByTestId(`${isPhone(vp) ? 'app-tab' : 'app-nav'}-${area}`);
  await expect(nav).toBeVisible({ timeout: 30000 });
  await nav.click();
  await expect(nav).toHaveAttribute('aria-current', 'page');
}

export const searchSurface = (page, vp) => (isPhone(vp) ? page.getByTestId('search-mode') : page.getByTestId('media-search-bar'));

/** Open search the way a person does and return its input (phone: launcher; wider: the dock field). */
export async function openSearch(page, vp) {
  if (isPhone(vp)) {
    await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('media-search-launcher').click();
    await expect(page.getByTestId('search-mode')).toBeVisible();
    return page.getByTestId('search-mode-input');
  }
  const input = page.getByRole('textbox', { name: 'Search media…', exact: true });
  await expect(input).toBeVisible({ timeout: 30000 });
  await input.click();
  return input;
}

export const resultRows = (page, vp) => (isPhone(vp)
  ? page.getByTestId('search-mode-results').locator('[data-testid^="search-mode-result-"]')
  : page.locator('[data-testid^="combobox-option-"]'));

/** The row for one content id (the tap target); More is `result-more-<id>` on both surfaces. */
export const resultRow = (page, vp, id) => page.getByTestId(isPhone(vp) ? `search-mode-result-${id}` : `combobox-option-${id}`);

/** A result row's picture slot: the artwork, or the kind icon placeholder of an artwork-less item. */
export const rowPicture = (row) => row.locator('img, .media-result-thumb--icon, [data-testid="result-artwork-placeholder"]');

export async function closeSearch(page, vp) {
  if (isPhone(vp)) {
    await page.getByTestId('search-mode-close').click();
    await expect(page.getByTestId('search-mode')).toHaveCount(0);
  } else {
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid^="combobox-option-"]').first()).toBeHidden();
  }
}

export async function waitForSearchSettled(page) {
  await expect.poll(async () => {
    const status = page.getByTestId('stream-status-line');
    if (await status.count() === 0) return true;
    return !/Still searching|Searching/.test(await status.first().innerText());
  }, { timeout: 40000, message: 'the search stream should settle' }).toBe(true);
}

/** Where the person is: area, address, and how far the page is scrolled. */
export async function whereAmI(page) {
  return page.evaluate(() => ({
    url: location.pathname + location.search,
    area: document.querySelector('[aria-current="page"].media-nav-item')?.getAttribute('data-testid') ?? null,
    scroll: document.querySelector('[data-testid="media-canvas"]')?.scrollTop ?? 0,
    // Browse: the collection I am inside (its breadcrumb); other areas have no single heading.
    heading: document.querySelector('.browse-crumb--current')?.textContent?.trim() ?? null,
  }));
}
