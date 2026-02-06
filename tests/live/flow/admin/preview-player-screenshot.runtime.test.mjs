import { test, expect } from '@playwright/test';

test('screenshot preview button 4 (media/video clip)', async ({ page }) => {
  await page.goto('/admin/content/lists/menus/fhe', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForSelector('.item-row:not(.empty-row)', { timeout: 10000 });

  const previewButtons = page.locator('.col-preview .mantine-ActionIcon-root');
  await previewButtons.nth(4).click();

  const overlay = page.locator('.mantine-Modal-overlay:visible');
  await expect(overlay).toBeVisible({ timeout: 5000 });

  // Wait for video to start playing
  await page.waitForFunction(() => {
    const body = document.querySelector('.mantine-Modal-body');
    if (!body) return false;
    const video = body.querySelector('video');
    if (video && video.currentTime > 0) return true;
    const dashVideo = body.querySelector('dash-video');
    if (dashVideo) {
      const inner = dashVideo.querySelector('video');
      if (inner && inner.currentTime > 0) return true;
    }
    return false;
  }, { timeout: 15000 });

  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-kckern-Documents-GitHub-DaylightStation/d0ea338a-9922-427d-b338-4d3f51de3c0e/scratchpad/preview-btn4.png' });
  console.log('PASS: video clip playing');
});
