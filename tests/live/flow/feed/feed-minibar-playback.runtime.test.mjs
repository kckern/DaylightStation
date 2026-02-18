// tests/live/flow/feed/feed-minibar-playback.runtime.test.mjs
import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

test.describe('Feed Scroll – MiniBar playback', () => {

  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/v1/feed/scroll`);
    expect(res.ok(), 'Feed scroll API should be healthy').toBe(true);
  });

  test('clicking play on first playable item shows mini bar and starts playback', async ({ page }) => {
    // Collect ALL console messages for diagnostics
    const consoleErrors = [];
    const consoleLogs = [];
    page.on('console', msg => {
      const text = msg.text();
      if (msg.type() === 'error') consoleErrors.push(text);
      // Capture player-related logs
      if (text.includes('player') || text.includes('Player') || text.includes('Stall') || text.includes('stall') || text.includes('remount') || text.includes('resilience') || text.includes('media') || text.includes('audio') || text.includes('fetch')) {
        consoleLogs.push(`[${msg.type()}] ${text.slice(0, 200)}`);
      }
    });
    const networkErrors = [];
    page.on('requestfailed', req => {
      networkErrors.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
    });

    // Use filter=plex to guarantee playable items in the feed
    await page.goto('/feed/scroll?filter=plex', { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for cards to render
    await expect(page.locator('.scroll-item-wrapper').first()).toBeVisible({ timeout: 15000 });

    // Find the first playable card's play button
    const playButton = page.locator('.feed-card button[aria-label="Play"]').first();
    await expect(playButton, 'Plex feed should have a playable item').toBeVisible({ timeout: 10000 });

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

    // Poll media state every second for diagnostics
    for (let t = 1; t <= 8; t++) {
      await page.waitForTimeout(1000);
      const snap = await page.evaluate(() => {
        const els = document.querySelectorAll('audio, video');
        return {
          count: els.length,
          items: Array.from(els).map(el => ({
            tag: el.tagName,
            src: (el.src || el.currentSrc || '').split('?')[0].slice(-40),
            paused: el.paused,
            readyState: el.readyState,
            currentTime: Math.round(el.currentTime * 10) / 10,
            networkState: el.networkState,
            error: el.error?.code || null,
          })),
          persistentPlayer: !!document.querySelector('[aria-hidden="true"] .audio-player, [aria-hidden="true"] audio, [aria-hidden="true"] video'),
        };
      });
      console.log(`t=${t}s: media=${snap.count} persistent=${snap.persistentPlayer}${snap.items.length ? ' ' + JSON.stringify(snap.items[0]) : ''}`);
    }

    if (consoleLogs.length > 0) {
      console.log('Player-related logs:', consoleLogs.slice(0, 30).join('\n'));
    }
    if (consoleErrors.length > 0) {
      console.log('Console errors:', consoleErrors.slice(0, 10).join('\n'));
    }
    if (networkErrors.length > 0) {
      console.log('Network errors:', networkErrors.join('\n'));
    }

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
