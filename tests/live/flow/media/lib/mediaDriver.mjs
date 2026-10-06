// Ordinary-input helpers shared by the accessibility / persona journeys.
import { expect } from '@playwright/test';

export async function freshPage(page, path = '/media') {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('cleared')) { localStorage.clear(); sessionStorage.setItem('cleared', '1'); }
  });
  // Under the dev acceptance server a module fetch can be lost and the page
  // parks on its chunk-reload cooldown; that is not what is under test, so
  // navigation is retried a bounded number of times (the journey still fails
  // if the app never comes up).
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    if (await page.getByTestId('media-shell').waitFor({ state: 'visible', timeout: 40000 }).then(() => true, () => false)) return;
  }
  throw new Error(`freshPage: the media shell never became visible at ${path} after 3 navigation attempts`);
}

export const isPhone = (page) => page.viewportSize().width < 600;

/** Skip the first-use card if it is up (it is, on a fresh browser). */
export async function skipFirstUse(page) {
  // Wait for the shell (and the first-use card, which a fresh browser always gets).
  await expect(page.getByTestId('media-dock')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('first-use-card')).toBeVisible({ timeout: 30000 });
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
    const option = page.getByRole('option').filter({ hasText: text }).first();
    // The first keystrokes can land before the search surface has settled; type again once.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await search.fill('');
      await search.fill(text);
      if (await option.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false)) break;
      if (attempt === 1) await page.waitForTimeout(500);
    }
    await expect(option).toBeVisible({ timeout: 15000 });
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
