import { test, expect } from '@playwright/test';

/** Wait for a media element (audio, video, or dash-video) inside the visible modal body */
function waitForMedia(page, timeout = 30000) {
  return page.waitForFunction(() => {
    const bodies = document.querySelectorAll('.mantine-Modal-body');
    for (const body of bodies) {
      if (body.offsetHeight === 0) continue;
      if (body.querySelector('audio, video, dash-video')) return true;
    }
    return false;
  }, { timeout });
}

/** Wait for playback to actually start (currentTime > 0 or progress bar advancing) */
function waitForPlayback(page, timeout = 20000) {
  return page.waitForFunction(() => {
    const bodies = document.querySelectorAll('.mantine-Modal-body');
    for (const body of bodies) {
      if (body.offsetHeight === 0) continue;
      const stdEl = body.querySelector('audio, video');
      if (stdEl && stdEl.currentTime > 0) {
        return { tag: stdEl.tagName, currentTime: stdEl.currentTime };
      }
      const dashEl = body.querySelector('dash-video');
      if (dashEl) {
        const inner = dashEl.querySelector('video') || dashEl.shadowRoot?.querySelector('video');
        if (inner && inner.currentTime > 0) {
          return { tag: 'DASH-VIDEO', currentTime: inner.currentTime };
        }
        const progress = body.querySelector('.progress-bar .progress');
        if (progress) {
          const width = parseFloat(progress.style.width);
          if (width > 0) return { tag: 'DASH-VIDEO', currentTime: width };
        }
      }
    }
    return false;
  }, { timeout });
}

async function testPreviewButton(page, index) {
  const previewButtons = page.locator('.col-preview .mantine-ActionIcon-root');
  await previewButtons.nth(index).click();

  const overlay = page.locator('.mantine-Modal-overlay:visible');
  await expect(overlay).toBeVisible({ timeout: 5000 });

  await waitForMedia(page);
  const handle = await waitForPlayback(page);
  const result = await handle.jsonValue();
  expect(result).toBeTruthy();
  console.log(`  button[${index}]: <${result.tag}> playing at ${result.currentTime}s`);

  // Close modal
  await page.locator('.mantine-Modal-overlay:visible').click({ position: { x: 5, y: 5 } });
  await expect(overlay).not.toBeVisible({ timeout: 3000 });
}

test('preview play buttons open modal and media actually plays', async ({ page }) => {
  await page.goto('/admin/content/lists/menus/fhe', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForSelector('.item-row:not(.empty-row)', { timeout: 10000 });

  const previewButtons = page.locator('.col-preview .mantine-ActionIcon-root');
  const btnCount = await previewButtons.count();
  expect(btnCount).toBeGreaterThan(4);
  console.log(`Found ${btnCount} preview buttons`);

  // Test first button (audio/singing content)
  await testPreviewButton(page, 0);

  // Test second button (plex/DASH video content)
  await testPreviewButton(page, 1);

  // Test fifth button (local media/video clip)
  await testPreviewButton(page, 4);
});
