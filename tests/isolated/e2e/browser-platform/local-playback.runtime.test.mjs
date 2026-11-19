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

test('Media Start fresh forgets a Play URL only after a full reset', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await page.routeWebSocket('**/ws', () => {});
  const playUrl = '/media?play=plex%3A42';
  const token = () => page.evaluate(() => localStorage.getItem('media-app.url-command-token'));
  await page.goto(playUrl);
  await originalClock(page);
  const originalToken = await token();
  expect(originalToken).toBe('v2:play=plex:42&queue=&shuffle=&shader=&volume=');
  const dialog = page.getByRole('dialog', { name: 'Start fresh on this device?' });
  const openReset = async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByTestId('settings-reset-session').click();
    await expect(dialog).toBeVisible();
  };
  const confirm = dialog.getByRole('button', { name: 'Start fresh', exact: true });

  await openReset();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await token()).toBe(originalToken);

  await openReset();
  await dialog.getByTestId('start-fresh-playing').uncheck();
  await confirm.click();
  await expect(dialog).toBeHidden();
  expect(await token()).toBe(originalToken);

  await openReset();
  await confirm.click();
  await expect(dialog).toBeHidden();
  expect(await token()).toBeNull();
  await expect(page).toHaveURL(playUrl);
  await page.reload();
  await originalClock(page);
  expect(await token()).toBe(originalToken);
});

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

test('Feed keeps its original audio through a prolonged socket outage and releases the policy on exit', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    sessionStorage.setItem('fixture-document-count', Number(sessionStorage.getItem('fixture-document-count') || 0) + 1);
    let down = false;
    window.fixtureFailedConnections = 0;
    const NativeSocket = window.WebSocket;
    function Socket(url, ...options) {
      if (new URL(url).pathname !== '/ws') return new NativeSocket(url, ...options);
      const socket = {
        readyState: NativeSocket.CONNECTING,
        send() {},
        close() {
          this.readyState = NativeSocket.CLOSED;
          this.onclose?.(new CloseEvent('close', { code: 1006 }));
        },
      };
      queueMicrotask(() => {
        if (down) {
          window.fixtureFailedConnections++;
          socket.close();
        } else {
          socket.readyState = NativeSocket.OPEN;
          window.fixtureDisconnect = () => { down = true; socket.close(); };
          socket.onopen?.();
        }
      });
      return socket;
    }
    Object.setPrototypeOf(Socket, NativeSocket);
    Socket.prototype = NativeSocket.prototype;
    window.WebSocket = Socket;
  });

  await page.goto('/feed/scroll');
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  const clock = await originalClock(page);
  const beforeOutage = await clock();
  await page.waitForFunction(() => typeof window.fixtureDisconnect === 'function');
  await page.evaluate(() => window.fixtureDisconnect());

  // Run the real shared backoff timers through their first degraded attempt.
  for (const delay of [1000, 2000, 4000, 8000, 15000, 30000]) {
    await page.clock.fastForward(delay + 500);
  }
  expect(await page.evaluate(() => window.fixtureFailedConnections)).toBeGreaterThanOrEqual(6);
  await page.clock.fastForward(181_000);
  const documentCount = () => page.evaluate(() => Number(sessionStorage.getItem('fixture-document-count'))).catch(() => 0);
  await expect.poll(() => clock().catch(() => -1)).toBeGreaterThan(beforeOutage + 0.5);
  expect(await documentCount()).toBe(1);

  await page.getByRole('link', { name: 'Reader', exact: true }).click();
  await expect(page).toHaveURL(/\/feed\/reader$/);
  const readerClock = await clock();
  await expect.poll(clock).toBeGreaterThan(readerClock);
  expect(await documentCount()).toBe(1);

  await page.route('**/home', route => route.request().isNavigationRequest()
    ? route.fulfill({ contentType: 'text/html', body: '<p>Reload after Feed exit</p>' })
    : route.fallback());
  await page.evaluate(() => {
    const state = { idx: (history.state?.idx ?? 0) + 1, key: 'feed-outage-home', usr: null };
    history.pushState(state, '', '/home');
    dispatchEvent(new PopStateEvent('popstate', { state }));
  });
  await expect(page.getByRole('button', { name: 'Rooms', exact: true })).toBeVisible();
  await page.clock.fastForward(181_000);
  await expect(page.getByText('Reload after Feed exit', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/home$/);
});

test('Feed article playback survives Escape dismissing the player sheet before the article', async ({ page }) => {
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
  const sheet = page.getByRole('dialog', { name: item.title });
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/\/feed\/scroll\/[^/]+$/);
  await expect(mini).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/feed\/scroll$/);
  await expect(opener).toBeFocused();
  const returned = await clock();
  expect(returned).toBeGreaterThan(initial);
  await expect.poll(clock).toBeGreaterThan(returned);
});

test('Feed article arrows respect editing and the expanded player before navigating articles', async ({ page }) => {
  const next = { ...item, id: 'plex:43', contentId: 'plex:43', title: 'Next article fixture' };
  await page.routeWebSocket('**/ws', () => {});
  await page.route('**/api/v1/feed/scroll/sessions', route => route.fulfill({
    json: { items: [item, next], sessionId: 'fixture', hasMore: false },
  }));
  await page.goto('/feed/scroll');
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  const clock = await originalClock(page);
  await page.getByRole('button', { name: `Open: ${item.title}` }).press('Enter');
  const articleUrl = page.url();
  const heading = page.getByRole('heading', { name: item.title, exact: true });
  await expect(heading).toBeVisible();

  const note = page.getByRole('textbox', { name: 'Add a note' });
  await note.fill('Draft note');
  await note.evaluate(input => input.setSelectionRange(4, 4));
  await page.keyboard.press('ArrowLeft');
  expect(await note.evaluate(input => input.selectionStart)).toBe(3);
  await page.keyboard.press('ArrowRight');
  expect(await note.evaluate(input => input.selectionStart)).toBe(4);
  const settleArticleMotion = () => page.locator('.detail-content').evaluate(async content => {
    await Promise.allSettled(content.getAnimations().map(animation => animation.finished));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await settleArticleMotion();
  await expect(note).toBeFocused();
  await expect(page).toHaveURL(articleUrl);
  await expect(note).toHaveValue('Draft note');

  await page.getByRole('button', { name: /Open player/ }).click();
  const sheet = page.getByRole('dialog', { name: item.title });
  const seek = sheet.getByRole('slider', { name: 'Playback position' });
  const beforeSeek = await clock();
  await seek.press('ArrowRight');
  await expect.poll(clock).toBeGreaterThan(beforeSeek + 3);
  const afterSeek = await clock();
  await seek.press('ArrowLeft');
  await expect.poll(clock).toBeLessThan(afterSeek - 3);
  await sheet.getByRole('button', { name: 'Close player' }).press('ArrowRight');
  await settleArticleMotion();
  await expect(page).toHaveURL(articleUrl);
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  await page.getByRole('button', { name: 'Back to feed' }).first().press('ArrowRight');
  await expect(page.getByRole('heading', { name: next.title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to feed' }).first().press('ArrowLeft');
  await expect(page).toHaveURL(articleUrl);
  const returned = await clock();
  expect(returned).toBeGreaterThan(0);
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
  await close.evaluate(button => button.addEventListener('keydown', event => {
    if (event.key === 'Escape') event.preventDefault();
  }, { once: true }));
  await close.press('Escape');
  await expect(dialog).toBeVisible();
  await close.press('Escape');
  await expect(opener).toBeFocused();
  await page.keyboard.press('j');
  await expect(page.getByRole('button', { name: `Open: ${item.title}` })).toBeFocused();
});

test('Feed keeps the mini bar and expanded player controls inside the safe area', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CSS environment override uses Chromium DevTools');
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setSafeAreaInsetsOverride', { insets: { left: 40, right: 40, top: 30, bottom: 24 } });
  const { clock, dialog, opener } = await openFixtureSheet(page);
  const initial = await clock();
  const close = dialog.getByRole('button', { name: 'Close player' });
  const inside = locator => locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.left >= 39 && box.right <= 351 && box.top >= 29 && box.bottom <= innerHeight - 23;
  });
  await expect.poll(() => inside(close)).toBe(true);
  await page.setViewportSize({ width: 390, height: 420 });
  await expect.poll(() => dialog.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await expect(dialog).toHaveCSS('touch-action', 'auto');
  await close.click();
  await expect(opener).toBeFocused();
  await expect.poll(() => inside(opener)).toBe(true);
  await expect.poll(clock).toBeGreaterThan(initial);
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

test('Feed abandons a canceled touch scrub without dragging the player sheet', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native touch cancellation uses Chromium DevTools');
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

test('Media holds Now Playing progress while the original audio keeps playing in the background', async ({ page }) => {
  await page.routeWebSocket('**/ws', () => {});
  await page.goto('/media?play=plex%3A42');
  const clock = await originalClock(page);
  await page.getByTestId('mini-player-open-nowplaying').click();
  const fill = page.locator('.np-seek-fill');
  const width = () => fill.evaluate(node => Number.parseFloat(node.style.width));
  await expect.poll(width).toBeGreaterThan(0);
  const frozenWidth = await fill.evaluate(node => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    return Number.parseFloat(node.style.width);
  });
  const hiddenTime = await clock();
  await expect.poll(clock).toBeGreaterThan(hiddenTime + 1);
  expect(await width()).toBe(frozenWidth);

  await page.evaluate(() => {
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(width).toBeGreaterThan(frozenWidth);
  const resumed = await clock();
  await expect.poll(clock).toBeGreaterThan(resumed);
});

test('Media keeps the last paused seek when leaving its app and restores silently on return', async ({ page }) => {
  const track = { contentId: item.contentId, title: item.title, format: 'audio', duration: 30 };
  await page.addInitScript(track => {
    const updatedAt = new Date().toISOString();
    localStorage.setItem('media-app.session', JSON.stringify({
      schemaVersion: 1, sessionId: 'fixture', updatedAt, wasPlayingOnUnload: false,
      snapshot: {
        sessionId: 'fixture', state: 'paused', currentItem: track, position: 0,
        queue: { items: [{ ...track, queueItemId: 'fixture-track' }], currentIndex: 0, upNextCount: 0 },
        config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
        meta: { ownerId: 'fixture', updatedAt },
      },
    }));
  }, track);
  const playbackRequests = [];
  page.on('request', request => {
    const path = decodeURIComponent(new URL(request.url()).pathname);
    if (path.endsWith('/play/plex:42') || path.endsWith('/fixture-audio.wav')) playbackRequests.push(path);
  });
  await page.routeWebSocket('**/*', () => {});
  await page.clock.install();
  await page.goto('/media?view=nowPlaying');
  const seek = page.getByRole('slider', { name: 'Seek' });
  await expect(seek).toBeVisible();
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1000);

  await seek.press('ArrowRight');
  await seek.press('ArrowRight');
  await expect(seek).toHaveAttribute('aria-valuenow', '10');
  const diskPosition = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('media-app.session')).snapshot.position);
  expect(await diskPosition()).toBeLessThan(10);

  const navigate = path => page.evaluate(path => {
    const state = { idx: (history.state?.idx ?? 0) + 1, key: path, usr: null };
    history.pushState(state, '', path);
    dispatchEvent(new PopStateEvent('popstate', { state }));
  }, path);
  await navigate('/home');
  await expect(page.getByRole('button', { name: 'Rooms', exact: true })).toBeVisible();
  expect(await diskPosition()).toBe(10);
  await navigate('/media?view=nowPlaying');
  await expect(seek).toHaveAttribute('aria-valuenow', '10');
  await expect(page.locator('audio,video')).toHaveCount(0);
  expect(playbackRequests).toEqual([]);

  await page.clock.resume();
  await page.evaluate(() => {
    document.addEventListener('playing', event => {
      if (event.target instanceof HTMLAudioElement && event.target.currentSrc.endsWith('/fixture-audio.wav')) {
        window.initialFixturePlayingPosition ??= event.target.currentTime;
      }
    }, true);
  });
  await page.getByTestId('np-toggle').click();
  const clock = await originalClock(page);
  await expect.poll(() => page.evaluate(() => window.initialFixturePlayingPosition ?? -1)).toBeCloseTo(10, 0);
  await expect.poll(clock).toBeGreaterThan(10.1);
});
