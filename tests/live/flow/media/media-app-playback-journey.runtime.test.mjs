import { test, expect } from '@playwright/test';

// A real catalog → app → Player → media element → UI round trip.
// No route mocks, synthetic clicks, forced clicks, or fabricated session state.
// Each test has a fresh browser context and targets only its own local player.
const title = process.env.MEDIA_ACCEPTANCE_TITLE || 'Disclosure Day';

test.use({ viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure', actionTimeout: 10000 });
test.setTimeout(90000);

async function startMovie(page) {
  await test.step('Find and start the movie with ordinary user input', async () => {
    await page.goto('/media');
    await page.getByRole('textbox', { name: 'Search media…' }).fill(title);
    const result = page.getByRole('option').filter({ hasText: title });
    await expect(result).toHaveCount(1, { timeout: 15000 });
    await result.click();
    await page.getByTestId('mini-player-open-nowplaying').click();
  });
  const video = page.getByTestId('now-playing-host').locator('video');
  await expect(video).toHaveCount(1, { timeout: 30000 });
  await expect.poll(() => video.evaluate(el => !el.paused && el.currentTime > 0 && el.readyState >= 2), {
    timeout: 30000, message: 'The real video must advance, not merely show its title',
  }).toBe(true);
  return video;
}

test('[PLAY.1b/AC1][STEER.4a/AC1] discovered movie duration and progress reach the visible seek bar', async ({ page }) => {
  const video = await startMovie(page);
  const slider = page.getByRole('slider', { name: 'Seek', exact: true });
  await expect(slider).not.toHaveAttribute('aria-disabled', 'true');
  const duration = await video.evaluate(el => el.duration);
  expect(duration).toBeGreaterThan(0);
  await expect.poll(async () => Math.abs(Number(await slider.getAttribute('aria-valuemax')) - duration)).toBeLessThanOrEqual(1);
  await expect.poll(async () => {
    const actual = await video.evaluate(el => el.currentTime);
    return Math.abs(Number(await slider.getAttribute('aria-valuenow')) - actual);
  }).toBeLessThanOrEqual(2);
  await page.getByTestId('np-toggle').click();
  await expect.poll(() => video.evaluate(el => el.paused)).toBe(true);
  const before = await video.evaluate(el => el.currentTime);
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => video.evaluate(el => el.currentTime), { timeout: 15000 }).toBeGreaterThan(before + 3);
  await expect.poll(async () => Math.abs(Number(await slider.getAttribute('aria-valuenow')) - await video.evaluate(el => el.currentTime))).toBeLessThanOrEqual(2);
  const bounds = await slider.boundingBox();
  expect(bounds).not.toBeNull();
  const destination = Math.min(duration * 0.1, before + 90);
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + bounds.width * (before / duration), y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * (destination / duration), y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs(await video.evaluate(el => el.currentTime) - destination), { timeout: 15000 }).toBeLessThanOrEqual(3);
  await expect.poll(async () => Math.abs(Number(await slider.getAttribute('aria-valuenow')) - await video.evaluate(el => el.currentTime))).toBeLessThanOrEqual(2);
});

test('[STEER.3a/AC1][STEER.3a/AC3] pause and resume reflect the real player without a false startup stall', async ({ page }) => {
  const video = await startMovie(page);
  const toggle = page.getByTestId('np-toggle');
  await expect(toggle).toHaveAccessibleName('Pause');
  await toggle.click();
  await expect.poll(() => video.evaluate(el => el.paused)).toBe(true);
  await expect(toggle).toHaveAccessibleName('Play');
  const pausedAt = await video.evaluate(el => el.currentTime);
  await toggle.click();
  await expect.poll(() => video.evaluate((el, position) => !el.paused && el.currentTime > position, pausedAt), { timeout: 15000 }).toBe(true);
  await expect(toggle).toHaveAccessibleName('Pause');
  // Pass the historical 15-second watchdog boundary while observing actual
  // progress. Time passing alone cannot satisfy this assertion.
  await expect.poll(() => video.evaluate(el => el.currentTime), { timeout: 25000 }).toBeGreaterThan(pausedAt + 16);
  await expect(page.getByTestId('np-state')).toHaveAttribute('data-state', 'playing');
  await expect(toggle).toHaveAccessibleName('Pause');
});

test('[STEER.4a/AC2] forward and back controls seek the real video', async ({ page }) => {
  const video = await startMovie(page);
  await page.getByTestId('np-toggle').click();
  await expect.poll(() => video.evaluate(el => el.paused)).toBe(true);
  const before = await video.evaluate(el => el.currentTime);
  await page.getByRole('button', { name: 'Forward 10 seconds' }).click();
  await expect.poll(async () => Math.abs(await video.evaluate(el => el.currentTime) - (before + 10)), { timeout: 15000 }).toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: 'Back 10 seconds' }).click();
  await expect.poll(async () => Math.abs(await video.evaluate(el => el.currentTime) - before), { timeout: 15000 }).toBeLessThanOrEqual(2);
});

test('[STEER.2a/AC1][STEER.2a/AC2] focused video expands and shrinks without replacing or restarting media', async ({ page }) => {
  const video = await startMovie(page);
  const original = await video.elementHandle();
  const before = await video.evaluate(el => el.currentTime);
  await expect(page.getByRole('button', { name: 'Expand video', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand video', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Shrink video', exact: true })).toBeVisible();
  await expect(page.locator('.video-player.focused')).toBeVisible();
  await expect.poll(() => original.evaluate(el => el.isConnected && !el.paused && el.currentTime >= before)).toBe(true);
  await page.getByRole('button', { name: 'Shrink video', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Expand video', exact: true })).toBeVisible();
  await expect.poll(() => original.evaluate(el => el.isConnected && !el.paused && el.currentTime >= before)).toBe(true);
  await page.getByTestId('now-playing-back').click();
  await expect(page.getByTestId('mini-player-open-nowplaying')).toBeVisible();
  await expect.poll(() => original.evaluate(el => el.isConnected && !el.paused && el.currentTime >= before)).toBe(true);
});

test('[STEER.6a/AC1][STEER.6a/AC2][STEER.7a/AC2] stop ends actual playback and keeps the queue reachable', async ({ page }) => {
  await startMovie(page);
  await page.getByTestId('np-stop').click();
  await expect.poll(() => page.locator('video, audio').evaluateAll(els => els.every(el => el.paused || el.ended))).toBe(true);
  await expect(page.getByTestId('mini-player-open-nowplaying')).toBeVisible();
  await page.getByTestId('now-playing-back').click();
  await page.getByTestId('mini-player-open-nowplaying').click();
  await expect(page.getByTestId('now-playing-view')).toContainText(title);
});
