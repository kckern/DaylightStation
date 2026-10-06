// Ordinary-input helpers shared by the accessibility / persona journeys.
import { expect } from '@playwright/test';

export async function freshPage(page, path = '/media') {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('cleared')) { localStorage.clear(); sessionStorage.setItem('cleared', '1'); }
  });
  await page.goto(path);
}

export const isPhone = (page) => page.viewportSize().width < 600;

/** Skip the first-use card if it is up (it is, on a fresh browser). */
export async function skipFirstUse(page) {
  const skip = page.getByTestId('first-use-skip');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

/** Search for a title with ordinary input, leaving the results visible. */
export async function searchFor(page, text) {
  if (isPhone(page)) {
    await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('media-search-launcher').click();
    await page.getByRole('searchbox', { name: 'Search media', exact: true }).fill(text);
    await expect(page.getByTestId('search-mode-results').getByText(text, { exact: true }).first()).toBeVisible({ timeout: 20000 });
  } else {
    const search = page.getByRole('textbox', { name: 'Search media…' });
    await expect(search).toBeVisible({ timeout: 30000 });
    await search.fill('');
    await search.fill(text);
    await expect(page.getByRole('option').filter({ hasText: text }).first()).toBeVisible({ timeout: 20000 });
  }
}

/** Search for Arrival and tap the movie to play it here; leaves the handle up. */
export async function playArrivalHere(page) {
  await searchFor(page, 'Arrival');
  if (isPhone(page)) {
    await page.getByTestId('search-mode-results').getByText('Arrival', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Close search' }).click();
  } else {
    const option = page.getByRole('option').filter({ hasText: 'Arrival' }).filter({ hasText: 'Movie' });
    await expect(option).toHaveCount(1, { timeout: 15000 });
    await option.click();
    await page.keyboard.press('Escape');
  }
  await expect(page.getByTestId('mini-player-open-nowplaying')).toContainText('Arrival', { timeout: 30000 });
}
