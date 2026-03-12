// tests/live/flow/feed/feed-detail-playback.runtime.test.mjs
import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

test.describe('Feed Detail – Player section playback', () => {

  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/v1/feed/scroll`);
    expect(res.ok(), 'Feed scroll API should be healthy').toBe(true);
  });

  test('clicking Play in a detail player section mounts a media element', async ({ page }) => {
    // Capture player-related console output for diagnostics
    const playerLogs = [];
    page.on('console', msg => {
      const text = msg.text();
      if (/player|contentId|PersistentPlayer|mount/i.test(text)) {
        playerLogs.push(`[${msg.type()}] ${text.slice(0, 200)}`);
      }
    });

    // Load feed filtered to plex (guarantees playable items with player sections)
    await page.goto('/feed/scroll?filter=plex', { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.locator('.scroll-item-wrapper').first()).toBeVisible({ timeout: 15000 });

    // Click the first feed card to open detail view
    const firstCard = page.locator('.feed-card').first();
    await firstCard.click();

    // Wait for detail view (mobile: .detail-view, desktop: inside .detail-modal-panel)
    const detail = page.locator('.detail-view');
    await expect(detail, 'Detail view should open').toBeVisible({ timeout: 10000 });

    // Wait for detail sections to load (fetched async from /api/v1/feed/detail/:id)
    const sections = detail.locator('.detail-section');
    await expect(sections.first(), 'Detail sections should load').toBeVisible({ timeout: 10000 });

    // Find the Play button inside a player section
    // PlayerSection renders a full-width <button> with SVG play icon + text "Play"
    const detailPlayBtn = sections.locator('button', { hasText: 'Play' }).first();
    await expect(
      detailPlayBtn,
      'Plex detail should have a player section with a Play button'
    ).toBeVisible({ timeout: 5000 });

    // Click Play in the detail player section
    await detailPlayBtn.click();

    // CRITICAL ASSERTION: PersistentPlayer should mount a media element.
    // Before the fix, contentId is undefined → PersistentPlayer returns null → no media element.
    // After the fix, contentId flows through → Player mounts → audio/video element exists.
    await expect(async () => {
      const mediaCount = await page.evaluate(() =>
        document.querySelectorAll('audio, video').length
      );
      expect(mediaCount, 'PersistentPlayer should mount a media element (audio or video)').toBeGreaterThan(0);
    }).toPass({ timeout: 15000 });

    // Bonus: the mini bar should appear (proves activeMedia has real contentId)
    const miniBar = page.locator('.feed-mini-bar');
    await expect(miniBar, 'Mini bar should appear after play').toBeVisible({ timeout: 5000 });

    if (playerLogs.length > 0) {
      console.log('Player logs:', playerLogs.join('\n'));
    }

    console.log('Detail player section playback verified');
  });
});
