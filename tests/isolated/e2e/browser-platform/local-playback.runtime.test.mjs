import { test, expect } from '@playwright/test';
import { silentWave } from '../../../_fixtures/media/silentWave.mjs';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

const item = {
  id: 'plex:42', contentId: 'plex:42', source: 'plex', type: 'track',
  title: 'Playback fixture', image: '/icon-192.png', meta: { playable: true, duration: 30 },
};
const fixtureAudio = silentWave(30);
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.route('**/fixture-audio.wav', route => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
    if (!range) return route.fulfill({ contentType: 'audio/wav', body: fixtureAudio });
    const first = Number(range[1]);
    const last = range[2] ? Math.min(Number(range[2]), fixtureAudio.length - 1) : fixtureAudio.length - 1;
    return route.fulfill({
      status: 206,
      contentType: 'audio/wav',
      headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${first}-${last}/${fixtureAudio.length}` },
      body: fixtureAudio.subarray(first, last + 1),
    });
  });
  await page.route('**/api/**', route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    let json = {};
    if (path.endsWith('/supervision/bootstrap')) json = { enabled: false };
    else if (path.endsWith('/headlines/pages')) json = [];
    else if (path.includes('/scroll/sessions')) json = { items: [item], sessionId: 'fixture', hasMore: false };
    else if (path === '/api/v1/feed/detail/plex:42') json = { sections: [] };
    else if (path.endsWith('/play/plex:42')) json = {
      ...item, format: 'audio', mediaType: 'audio', mediaUrl: '/fixture-audio.wav', duration: 30,
    };
    return route.fulfill({ json });
  });
});

async function originalClock(page) {
  const node = await page.waitForFunction(() => [...document.querySelectorAll('audio,video')]
    .find(media => media.currentSrc.includes('fixture-audio.wav') && !media.paused && media.currentTime > 0));
  return () => node.evaluate(media => media.isConnected && !media.paused ? media.currentTime : -1);
}

async function openFixtureSheet(page) {
  await page.routeWebSocket('**/ws', () => {});
  await page.goto('/feed/scroll');
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  const clock = await originalClock(page);
  const opener = page.getByRole('button', { name: /Open player/ });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: item.title });
  return { clock, opener, dialog };
}

for (const app of ['Media', 'Feed']) {
  test(app + ' keeps its local audio through a WebSocket disconnect and reconnect', async ({ page }) => {
    const sockets = [];
    const commands = [];
    await page.routeWebSocket('**/ws', socket => {
      sockets.push(socket);
      socket.onMessage(raw => {
        const message = JSON.parse(raw);
        if (/^(device-control|client-control):/.test(message.topic || '')) commands.push(message);
      });
    });
    await page.goto(app === 'Media' ? '/media?play=plex:42' : '/feed/scroll');
    if (app === 'Feed') await page.getByRole('button', { name: 'Play', exact: true }).first().click();
    const clock = await originalClock(page);
    const initial = await clock();
    await expect.poll(() => sockets.length).toBe(1);
    sockets[0].close({ code: 1001, reason: 'fixture disconnect' });
    await expect.poll(() => sockets.length, { timeout: 20000 }).toBe(2);
    await expect.poll(clock).toBeGreaterThan(initial);
    const reconnected = await clock();
    await expect.poll(clock).toBeGreaterThan(reconnected);
    expect(commands).toEqual([]);
  });
}

test('Feed article playback survives its player sheet and Back restores the card focus', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  await page.goto('/feed/scroll');
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  const clock = await originalClock(page);
  const initial = await clock();
  const opener = page.getByRole('button', { name: /^Open:/ }).first();
  await opener.press('Enter');
  await expect(page).toHaveURL(/\/feed\/scroll\/[^/]+$/);
  await expect(page.getByRole('heading', { name: item.title, exact: true })).toBeVisible();
  await expect.poll(clock).toBeGreaterThan(initial);

  const mini = page.getByRole('button', { name: /Open player/ });
  await mini.click();
  const expanded = await clock();
  await expect.poll(clock).toBeGreaterThan(expanded);
  await page.getByRole('button', { name: 'Close player' }).click();
  await expect(mini).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/\/feed\/scroll$/);
  await expect(opener).toBeFocused();
  const returned = await clock();
  expect(returned).toBeGreaterThan(initial);
  await expect.poll(clock).toBeGreaterThan(returned);
});

test('Feed Scroll leaves J/K focus with the expanded player until dismissal', async ({ page }) => {
  const { dialog, opener } = await openFixtureSheet(page);
  const close = dialog.getByRole('button', { name: 'Close player' });
  await close.focus();
  await page.keyboard.press('j');
  await expect(close).toBeFocused();
  await page.keyboard.press('k');
  await expect(close).toBeFocused();
  await close.press('Escape');
  await expect(opener).toBeFocused();
  await page.keyboard.press('j');
  await expect(page.getByRole('button', { name: `Open: ${item.title}` })).toBeFocused();
});

test('Feed cancels a player sheet scrub when Escape dismisses the sheet', async ({ page }) => {
  const { clock, dialog, opener } = await openFixtureSheet(page);
  await page.locator('audio[src$="fixture-audio.wav"]').evaluate(audio => {
    window.fixtureAudioSeeks = [];
    audio.addEventListener('seeking', () => window.fixtureAudioSeeks.push(audio.currentTime));
  });
  const slider = dialog.getByRole('slider', { name: 'Playback position' });
  await expect(slider).toHaveAttribute('aria-valuemax', '30');
  await slider.click({ trial: true });
  const bounds = await slider.boundingBox();
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + bounds.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.8, y);
  await expect(slider).toHaveAttribute('aria-valuenow', '24');
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => window.fixtureAudioSeeks)).toEqual([]);
  const beforeRelease = await clock();
  await page.mouse.up();
  await expect.poll(clock).toBeGreaterThan(beforeRelease);
  expect(await page.evaluate(() => window.fixtureAudioSeeks)).toEqual([]);

  await opener.click();
  await slider.click({ trial: true });
  const reopenedBounds = await slider.boundingBox();
  const reopenedY = reopenedBounds.y + reopenedBounds.height / 2;
  await page.mouse.move(reopenedBounds.x + reopenedBounds.width / 2, reopenedY);
  await page.mouse.down();
  await page.mouse.move(reopenedBounds.x + reopenedBounds.width * 0.8, reopenedY - reopenedBounds.height);
  await page.mouse.up();
  const seeks = () => page.evaluate(() => window.fixtureAudioSeeks);
  await expect.poll(seeks).toHaveLength(1);
  expect((await seeks())[0]).toBeCloseTo(24, 0);
});

test('Feed abandons a canceled touch scrub without dragging the player sheet', async ({ page }) => {
  const { clock, dialog, opener } = await openFixtureSheet(page);
  const slider = dialog.getByRole('slider', { name: 'Playback position' });
  await expect(slider).toHaveAttribute('aria-valuemax', '30');
  await slider.click({ trial: true });
  const bounds = await slider.boundingBox();
  const y = Math.round(bounds.y + bounds.height / 2);
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: Math.round(bounds.x + bounds.width / 2), y }],
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [{ x: Math.round(bounds.x + bounds.width * 0.8), y: y + 90 }],
  });
  await expect(slider).toHaveAttribute('aria-valuenow', '24');
  expect(await dialog.evaluate(panel => panel.style.transform)).toBe('');
  const fill = slider.locator('.sheet-scrubber-fill');
  const width = () => fill.evaluate(node => parseFloat(node.style.width));
  expect(await width()).toBeCloseTo(80, 0);
  const previewTime = await clock();
  await expect.poll(clock).toBeGreaterThan(previewTime + 0.2);
  expect(await width()).toBeCloseTo(80, 0);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(slider).not.toHaveAttribute('aria-valuenow', '24');
  await expect(dialog).toBeVisible();
  expect(await clock()).toBeLessThan(15);

  const handle = await dialog.locator('.sheet-drag-handle').boundingBox();
  const point = { x: Math.round(handle.x + handle.width / 2), y: Math.round(handle.y + handle.height / 2) };
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, y: point.y + 90 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  const returned = await clock();
  await expect.poll(clock).toBeGreaterThan(returned);
});

test('Feed paints a keyboard seek while the same audio is paused', async ({ page }) => {
  const { dialog } = await openFixtureSheet(page);
  await dialog.getByRole('button', { name: 'Pause', exact: true }).click();
  const audio = await page.locator('audio[src$="fixture-audio.wav"]').elementHandle();
  await expect.poll(() => audio.evaluate(node => node.paused)).toBe(true);
  const pausedAt = await audio.evaluate(node => node.currentTime);
  const slider = dialog.getByRole('slider', { name: 'Playback position' });
  await expect(slider).toHaveAttribute('aria-valuemax', '30');
  await expect(slider).toHaveAttribute('aria-valuenow', String(Math.round(pausedAt)));
  await slider.press('ArrowRight');
  await expect.poll(() => audio.evaluate(node => node.currentTime)).toBeCloseTo(pausedAt + 5, 0);
  const seekedTime = await audio.evaluate(node => node.currentTime);
  const fill = slider.locator('.sheet-scrubber-fill');
  await expect.poll(() => fill.evaluate(node => parseFloat(node.style.width))).toBeCloseTo(seekedTime / 30 * 100, 2);
  expect(await audio.evaluate(node => node.isConnected && node.paused)).toBe(true);
});

test('Feed suspends its progress display while the same audio keeps playing in the background', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  await page.goto('/feed/scroll');
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  const clock = await originalClock(page);
  const progress = page.locator('.feed-mini-bar-progress-fill');
  await expect(progress).toBeVisible();
  const width = () => progress.evaluate(bar => parseFloat(bar.style.width));
  await expect.poll(width).toBeGreaterThan(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hidden = await width();
  const position = await clock();
  await expect.poll(clock).toBeGreaterThan(position + 1);
  expect(await width()).toBe(hidden);
  await page.evaluate(() => {
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(width).toBeGreaterThan(hidden);
});

test('Feed stops painting its open player sheet while the audio keeps playing in the background', async ({ page }) => {
  const { clock, dialog } = await openFixtureSheet(page);
  const fill = dialog.locator('.sheet-scrubber-fill');
  const width = () => fill.evaluate(node => parseFloat(node.style.width));
  await expect.poll(width).toBeGreaterThan(0);
  await fill.evaluate(node => {
    const style = node.style;
    window.fixtureSheetPaints = 0;
    Object.defineProperty(style, 'width', {
      get: () => style.getPropertyValue('width'),
      set: value => {
        window.fixtureSheetPaints += 1;
        style.setProperty('width', value);
      },
    });
  });
  const paints = () => page.evaluate(() => window.fixtureSheetPaints);
  await expect.poll(paints).toBeGreaterThan(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hiddenPaints = await paints();
  const hiddenWidth = await width();
  const hiddenTime = await clock();
  await expect.poll(clock).toBeGreaterThan(hiddenTime + 1);
  expect(await paints()).toBe(hiddenPaints);
  expect(await width()).toBe(hiddenWidth);
  await page.evaluate(() => {
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(width).toBeGreaterThan(hiddenWidth);
});
