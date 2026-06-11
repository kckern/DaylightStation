import { test, expect } from '@playwright/test';

// Regression: the platform Player's global hotkey listener (Backspace→prev,
// Space→toggle, Tab→next) must never hijack typing. Historically it ate
// Backspace in the search box whenever a session was active.
test.describe('MediaApp — typing in search while playback is active', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
  });

  test('Backspace and Space edit the query instead of driving the player', async ({ page }) => {
    await page.goto('/media');

    // Start real playback so the Player (and its keyboard handler) is mounted.
    await page.getByTestId('media-search-input').fill('lonesome');
    const firstRow = page.locator('[data-testid^="result-row-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });
    const id = (await firstRow.getAttribute('data-testid')).replace(/^result-row-/, '');
    await page.getByTestId(`result-play-now-${id}`).evaluate((el) => el.click());
    const toggle = page.getByTestId('mini-toggle');
    await expect(toggle).toBeVisible({ timeout: 15000 });
    await expect(toggle).toHaveAttribute('aria-label', /pause/i, { timeout: 10000 });

    // Type with real key events; Backspace must delete a character.
    const input = page.getByTestId('media-search-input');
    await input.click();
    await input.pressSequentially('abcd');
    await expect(input).toHaveValue('abcd');
    await page.keyboard.press('Backspace');
    await expect(input).toHaveValue('abc');

    // Space must insert a space, not toggle playback.
    await page.keyboard.press('Space');
    await expect(input).toHaveValue('abc ');
    await expect(toggle).toHaveAttribute('aria-label', /pause/i);
  });
});
