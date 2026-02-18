// tests/live/flow/feed/feed-minibar-playback.runtime.test.mjs
import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

test.describe('Feed Scroll – MiniBar playback', () => {

  test.beforeAll(async ({ request }) => {
    // Verify API is healthy and at least one playable item exists
    const res = await request.get(`${BACKEND_URL}/api/v1/feed/scroll`);
    expect(res.ok(), 'Feed scroll API should be healthy').toBe(true);
    const data = await res.json();
    const hasPlayable = (data.items || []).some(i => i.meta?.playable);
    expect(hasPlayable, 'Feed must contain at least one playable item').toBe(true);
  });

  test('clicking play on first playable item shows mini bar and starts playback', async ({ page }) => {
    // Collect console errors for diagnostics
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    const networkErrors = [];
    page.on('requestfailed', req => {
      networkErrors.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
    });

    await page.goto('/feed/scroll', { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for cards to render
    await expect(page.locator('.scroll-item-wrapper').first()).toBeVisible({ timeout: 15000 });

    // The playable item may not be in the viewport — scroll until we find it
    const playButton = page.locator('.feed-card button[aria-label="Play"]').first();

    await expect(async () => {
      if (await playButton.isVisible()) return;
      await page.keyboard.press('End');
      await page.waitForTimeout(500);
      expect(await playButton.isVisible(), 'Play button should become visible after scrolling').toBe(true);
    }).toPass({ timeout: 30000 });

    // Scroll the play button into view and click it
    await playButton.scrollIntoViewIfNeeded();
    await playButton.click();

    // The FeedPlayerMiniBar should appear (class: feed-mini-bar)
    const miniBar = page.locator('.feed-mini-bar');
    await expect(miniBar, 'Mini bar should appear after clicking play').toBeVisible({ timeout: 10000 });

    // Mini bar should show a title
    const title = miniBar.locator('.feed-mini-bar-title');
    await expect(title).toBeVisible();
    const titleText = await title.textContent();
    expect(titleText.length, 'Mini bar title should not be empty').toBeGreaterThan(0);
    console.log(`Mini bar title: ${titleText}`);

    // Wait for Player to load and media to start — give it 20s for lazy load + content resolution
    await page.waitForTimeout(5000);

    // Diagnostic: check what media elements exist and their state
    const mediaDiag = await page.evaluate(() => {
      const elements = document.querySelectorAll('audio, video');
      return Array.from(elements).map(el => ({
        tag: el.tagName,
        src: el.src || el.currentSrc || '(no src)',
        paused: el.paused,
        readyState: el.readyState,
        currentTime: el.currentTime,
        duration: el.duration,
        error: el.error ? { code: el.error.code, message: el.error.message } : null,
        networkState: el.networkState,
      }));
    });
    console.log('Media elements:', JSON.stringify(mediaDiag, null, 2));

    if (consoleErrors.length > 0) {
      console.log('Console errors:', consoleErrors.slice(0, 10).join('\n'));
    }
    if (networkErrors.length > 0) {
      console.log('Network errors:', networkErrors.join('\n'));
    }

    // Check toggle button state
    const toggleLabel = await miniBar.locator('.feed-mini-bar-toggle').getAttribute('aria-label');
    console.log(`Toggle button label: ${toggleLabel}`);

    // Assert: the toggle should show Pause (meaning media is playing)
    await expect(async () => {
      const label = await miniBar.locator('.feed-mini-bar-toggle').getAttribute('aria-label');
      expect(label, 'Toggle button should show Pause (= playing)').toBe('Pause');
    }).toPass({ timeout: 20000 });

    // The PersistentPlayer should have created an audio/video element that is playing
    await expect(async () => {
      const isPlaying = await page.evaluate(() => {
        const media = document.querySelector('audio, video');
        return media && !media.paused && media.currentTime > 0;
      });
      expect(isPlaying, 'A media element should be actively playing').toBe(true);
    }).toPass({ timeout: 15000 });

    // Progress should advance — wait for currentTime > 0 in the time display
    const timeDisplay = miniBar.locator('.feed-mini-bar-time');
    if (await timeDisplay.count() > 0) {
      await expect(async () => {
        const text = await timeDisplay.textContent();
        const currentTimePart = text.split('/')[0].trim();
        expect(currentTimePart, 'Current time should advance past 0:00').not.toBe('0:00');
      }).toPass({ timeout: 15000 });

      const timeText = await timeDisplay.textContent();
      console.log(`Playback time: ${timeText}`);
    }

    // Verify the progress bar fill element exists and has non-zero width
    const progressFill = miniBar.locator('.feed-mini-bar-progress-fill');
    await expect(progressFill).toBeVisible();
    await expect(async () => {
      const width = await progressFill.evaluate(el => parseFloat(el.style.width));
      expect(width, 'Progress bar should have advanced').toBeGreaterThan(0);
    }).toPass({ timeout: 15000 });

    console.log('Mini bar playback verified successfully');
  });

});
