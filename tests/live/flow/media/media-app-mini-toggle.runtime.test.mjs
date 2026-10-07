import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';
import { playArrivalHere } from './lib/mediaDriver.mjs';

test.describe('MediaApp — mini player toggle', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage BEFORE any app script runs so a previously
    // persisted paused session does not hydrate into state.
    await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
    // After the clear (init scripts run in order): the first-use card is a real overlay.
    await markFirstUseDone(page);
  });

  // Search and tap the movie (a tap plays at the aim: this device); leaves the handle up.
  async function startPlayback(page) {
    await page.goto('/media');
    await playArrivalHere(page);
  }

  test('mini player shows exactly one transport button that toggles', async ({ page }) => {
    await startPlayback(page);
    const toggle = page.getByTestId('mini-toggle');
    await expect(toggle).toBeVisible({ timeout: 10000 });
    // After Play Now the session transitions to playing; give the state
    // machine time to reflect that in the aria-label.
    await expect(toggle).toHaveAttribute('aria-label', /pause/i, { timeout: 10000 });
    await toggle.click();
    // After click the element is paused and the label reads Resume (it read Play before the redesign).
    await expect(toggle).toHaveAttribute('aria-label', /resume/i, { timeout: 5000 });
    // And there should be only one transport button, not both mini-play and mini-pause.
    await expect(page.getByTestId('mini-play')).toHaveCount(0);
    await expect(page.getByTestId('mini-pause')).toHaveCount(0);
  });
});
