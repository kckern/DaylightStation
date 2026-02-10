import { test, expect } from '@playwright/test';

/**
 * Smoke test: seek overlay shows INTENDED position, not CURRENT position.
 *
 * Bug context: When seeking, the overlay's position label would briefly flash
 * the current playback position before switching to the target. The fix
 * (sticky intent refs in useMediaResilience) preserves the seek target so
 * the overlay always shows where you're seeking TO.
 *
 * This content (play=379319) uses a <dash-video> custom element with shadow
 * DOM. The custom element proxies currentTime/duration so we query it
 * directly rather than the inner <video>.
 *
 * @see frontend/src/modules/Player/hooks/useMediaResilience.js
 * @see frontend/src/modules/Player/components/PlayerOverlayLoading.jsx
 */

/** Parse "M:SS" or "H:MM:SS" time string to seconds. Returns null on failure. */
function parseTimeToSeconds(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.trim().split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

test.describe('Seek Overlay Position Display', () => {
  test('overlay shows intended seek target, not pre-seek position', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    // 1. Navigate to video content
    await page.goto('/tv?play=379319', { waitUntil: 'networkidle' });

    // 2. Wait for media to be ready (currentTime > 0, known duration)
    //    Content may resume from a previous watch position, so don't assume near start.
    const videoReady = await page.waitForFunction(() => {
      const el = document.querySelector('dash-video') || document.querySelector('video');
      return el && Number.isFinite(el.currentTime) && el.currentTime > 0 && el.duration > 60
        ? { currentTime: el.currentTime, duration: el.duration }
        : null;
    }, { timeout: 20000 });

    const preSeek = await videoReady.jsonValue();
    const currentPct = preSeek.currentTime / preSeek.duration;
    console.log(`Pre-seek: ${preSeek.currentTime.toFixed(1)}s (${(currentPct * 100).toFixed(0)}%) | Duration: ${preSeek.duration.toFixed(1)}s`);

    // 3. Ensure loading overlay is NOT currently showing (playback is stable)
    await expect(page.locator('.loading-overlay')).not.toBeAttached({ timeout: 5000 });

    // 4. Pick a seek target far AHEAD of the current position.
    //    Always click past the filled portion of the progress bar to avoid the
    //    event.target bug in handleProgressClick (clicking on the .progress child
    //    gives wrong getBoundingClientRect). Clicking in the unfilled area ensures
    //    event.target is the .progress-bar parent.
    const clickFraction = Math.min(currentPct + 0.35, 0.95);
    const targetTime = preSeek.duration * clickFraction;
    const gap = Math.abs(targetTime - preSeek.currentTime);

    console.log(`Seeking to ${(clickFraction * 100).toFixed(0)}% → target: ${targetTime.toFixed(1)}s (gap: ${gap.toFixed(0)}s)`);

    // 5. Click on the progress bar at the computed position
    const progressBar = page.locator('.progress-bar');
    const box = await progressBar.boundingBox();
    expect(box, 'Progress bar must be visible and have dimensions').toBeTruthy();

    const clickX = box.width * clickFraction;
    await progressBar.click({ position: { x: clickX, y: box.height / 2 } });

    // 6. Wait for loading overlay to appear with a position label.
    //    The 600ms seek grace period suppresses the overlay for brief seeks.
    //    If the seek is fast enough, the overlay never appears — that's a PASS.
    let displayedText = null;
    try {
      const handle = await page.waitForFunction(() => {
        const el = document.querySelector('.loading-position');
        const text = el?.textContent?.trim();
        return (text && text !== '' && text !== '0:00') ? text : null;
      }, { timeout: 5000 });
      displayedText = await handle.jsonValue();
    } catch {
      console.log('Loading overlay did not appear — seek completed within grace period. PASS (grace working).');
      return;
    }

    // 7. Parse the displayed time and compare distances
    const displayedTime = parseTimeToSeconds(displayedText);
    expect(displayedTime, `Could not parse overlay position text: "${displayedText}"`).not.toBeNull();

    const distanceToTarget = Math.abs(displayedTime - targetTime);
    const distanceToCurrent = Math.abs(displayedTime - preSeek.currentTime);

    console.log(`Overlay shows: "${displayedText}" (${displayedTime}s)`);
    console.log(`Distance to target (${targetTime.toFixed(1)}s): ${distanceToTarget.toFixed(1)}s`);
    console.log(`Distance to pre-seek (${preSeek.currentTime.toFixed(1)}s): ${distanceToCurrent.toFixed(1)}s`);

    await page.screenshot({ path: '/tmp/seek-overlay-position.png', fullPage: true });

    // THE KEY ASSERTION: displayed position must be closer to the intended
    // target than to the pre-seek position.
    expect(
      distanceToTarget,
      `Overlay shows "${displayedText}" which is closer to pre-seek position ` +
      `(${preSeek.currentTime.toFixed(1)}s) than to target (${targetTime.toFixed(1)}s). ` +
      `This means the overlay is showing the CURRENT position instead of the INTENDED position.`
    ).toBeLessThan(distanceToCurrent);
  });
});
