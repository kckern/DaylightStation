import { expect, test } from '@playwright/test';
import { silentWave } from '../../../_fixtures/media/silentWave.mjs';

test.use({ viewport: { width: 390, height: 850 }, serviceWorkers: 'block' });

async function openDetailsWithPlayback(page, baseURL) {
  const origin = new URL(baseURL).origin;
  const audio = silentWave(30);
  const item = {
    contentId: 'plex:123', title: 'Resume fixture film', type: 'movie',
    spots: [
      { playhead: 720, duration: 7200, deviceId: 'browser:tablet' },
      { playhead: 4800, duration: 7200, deviceId: 'fleet:lounge' },
    ],
  };
  const playRequests = [];
  const castRequests = [];
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/fixture-audio.wav', route => route.fulfill({ contentType: 'audio/wav', body: audio }));
  await page.route('**/api/**', route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path.endsWith('/device/config')) return route.fulfill({ json: { devices: {
      lounge: { name: 'Lounge TV', fleet: true },
    } } });
    if (path === '/api/v1/media/screens') return route.fulfill({ json: { screens: [
      { id: 'fleet:lounge', name: 'Lounge TV' }, { id: 'browser:tablet', name: 'Kitchen Tablet' },
    ] } });
    if (path === '/api/v1/media/suggestions') return route.fulfill({ json: { rows: [{ id: 'carry-on', title: 'Carry on', items: [item] }] } });
    if (path === '/api/v1/media/household/carry-on') return route.fulfill({ json: { items: [item] } });
    if (path === '/api/v1/info/plex/123') return route.fulfill({ json: item });
    if (path.includes('/play/')) playRequests.push(path);
    if (path.endsWith('/device/lounge/load')) castRequests.push(path);
    if (path.endsWith('/play/plex:42')) return route.fulfill({ json: {
      id: 'plex:42', contentId: 'plex:42', title: 'Current track fixture',
      format: 'audio', mediaType: 'audio', mediaUrl: '/fixture-audio.wav', duration: 30,
    } });
    return route.fulfill({ json: {} });
  });

  await page.goto('/media?play=plex%3A42');
  const original = await page.waitForFunction(() => [...document.querySelectorAll('audio,video')]
    .find(media => media.currentSrc.includes('fixture-audio.wav') && !media.paused && media.currentTime > 0));
  const playbackTime = () => original.evaluate(media => media.isConnected && !media.paused ? media.currentTime : -1);
  await page.getByTestId('home-tile-carry-on-plex:123-more').click();
  await page.getByRole('menuitem', { name: 'Details', exact: true }).click();
  return { playbackTime, playRequests, castRequests };
}

test('Media resume chooser owns Escape before Details Back while audio plays', async ({ page, baseURL }) => {
  const { playbackTime, playRequests } = await openDetailsWithPlayback(page, baseURL);
  const playNow = page.getByRole('button', { name: 'Play Now', exact: true });
  await playNow.press('Enter');
  const chooser = page.getByRole('dialog', { name: 'Continue Resume fixture film from…' });
  await expect(chooser.getByRole('button', { name: '12:00 on Kitchen Tablet' })).toBeVisible();
  await expect(chooser.getByRole('button', { name: '1:20:00 on Lounge TV' })).toBeVisible();

  const beforeEscape = await playbackTime();
  await page.keyboard.press('Escape');
  await expect(chooser).toBeHidden();
  await expect(playNow).toBeFocused();
  await expect(page).toHaveURL(/view=detail/);
  await expect.poll(playbackTime).toBeGreaterThan(beforeEscape);
  expect(playRequests).toEqual(['/api/v1/play/plex:42']);

  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/view=detail/);
  const afterBack = await playbackTime();
  expect(afterBack).toBeGreaterThan(0);
  await expect.poll(playbackTime).toBeGreaterThan(afterBack);
});

test('Media Detail Cast stays visible on resize and owns the first Escape', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  const { playbackTime, playRequests, castRequests } = await openDetailsWithPlayback(page, baseURL);
  const trigger = page.getByRole('button', { name: 'Cast', exact: true });
  await trigger.press('Enter');
  const popover = page.getByRole('dialog', { name: 'Cast to a device', exact: true });
  const target = popover.getByTestId('picker-device-lounge');
  await expect(target).toBeVisible();
  await expect(popover).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(target).toBeFocused();
  const beforeResize = await playbackTime();

  await page.setViewportSize({ width: 390, height: 600 });
  await expect.soft(target).toBeInViewport({ ratio: 1 });
  await expect(target).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(/view=detail/);
  await expect.poll(playbackTime).toBeGreaterThan(beforeResize);
  expect(playRequests).toEqual(['/api/v1/play/plex:42']);
  expect(castRequests).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/view=detail/);
});

test('Media Detail Cast stays reachable when the visual viewport excludes its trigger', async ({ page, baseURL }) => {
  await openDetailsWithPlayback(page, baseURL);
  const trigger = page.getByRole('button', { name: 'Cast', exact: true });
  await trigger.press('Enter');
  const popover = page.getByRole('dialog', { name: 'Cast to a device', exact: true });
  const target = popover.getByTestId('picker-device-lounge');
  await expect(target).toBeVisible();

  const moveViewport = (position, event) => trigger.evaluate((button, { position, event }) => {
    const bounds = button.getBoundingClientRect();
    const top = position === 'above' ? 0 : bounds.bottom + 48;
    const bottom = position === 'above' ? bounds.top - 48 : window.innerHeight;
    const viewport = window.visualViewport;
    Object.defineProperties(viewport, {
      offsetTop: { configurable: true, value: top },
      height: { configurable: true, value: bottom - top },
    });
    viewport.dispatchEvent(new Event(event));
  }, { position, event });
  const pickerFits = () => popover.evaluate(panel => {
    const { top, bottom } = panel.getBoundingClientRect();
    const viewport = window.visualViewport;
    return top >= viewport.offsetTop && bottom <= viewport.offsetTop + viewport.height;
  });
  const targetIsReachable = () => target.evaluate(button => {
    const { top, bottom, left, right } = button.getBoundingClientRect();
    const viewport = window.visualViewport;
    return top >= viewport.offsetTop && bottom <= viewport.offsetTop + viewport.height
      && button.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2));
  });

  await moveViewport('above', 'resize');
  await expect.configure({ soft: true }).poll(pickerFits).toBe(true);
  await expect.configure({ soft: true }).poll(targetIsReachable).toBe(true);
  await moveViewport('below', 'scroll');
  await expect.configure({ soft: true }).poll(pickerFits).toBe(true);
  await expect.poll(targetIsReachable).toBe(true);

  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(/view=detail/);
});

test('Media Detail Cast stays anchored while its scroll container moves', async ({ page, baseURL }) => {
  await openDetailsWithPlayback(page, baseURL);

  const canvas = page.locator('.media-canvas');
  await canvas.evaluate((element) => {
    const detail = element.querySelector('.detail-view');
    const spacer = document.createElement('div');
    spacer.style.height = '900px';
    detail.append(spacer);
    element.style.height = '650px';
    element.style.flex = 'none';
  });

  const trigger = page.getByRole('button', { name: 'Cast', exact: true });
  await expect(trigger).toBeInViewport();
  await trigger.press('Enter');
  const popover = page.getByRole('dialog', { name: 'Cast to a device', exact: true });

  const alignmentError = async () => {
    const [anchor, picker] = await Promise.all([
      trigger.evaluate((button) => button.getBoundingClientRect()),
      popover.evaluate((panel) => ({ rect: panel.getBoundingClientRect(), opensAbove: !!panel.style.bottom })),
    ]);
    return picker.opensAbove
      ? Math.abs(picker.rect.bottom - anchor.top + 6)
      : Math.abs(picker.rect.top - anchor.bottom - 6);
  };
  await expect.poll(alignmentError).toBeLessThan(1);

  const scrollTopBefore = await canvas.evaluate((element) => element.scrollTop);
  const anchorTopBefore = await trigger.evaluate((button) => button.getBoundingClientRect().top);
  await canvas.evaluate((element) => { element.scrollTop += 40; });
  await expect.poll(() => canvas.evaluate((element) => element.scrollTop)).toBe(scrollTopBefore + 40);
  await expect(trigger).toBeInViewport();
  await expect.poll(() => trigger.evaluate((button) => button.getBoundingClientRect().top)).toBe(anchorTopBefore - 40);
  await expect.poll(alignmentError).toBeLessThan(1);

  const pickerPosition = await popover.evaluate((panel) => ({ top: panel.style.top, bottom: panel.style.bottom }));
  await trigger.evaluate((button) => { button.style.transform = 'translateY(20px)'; });
  await popover.evaluate((panel) => panel.dispatchEvent(new Event('scroll')));
  await expect.poll(() => popover.evaluate((panel) => ({ top: panel.style.top, bottom: panel.style.bottom })))
    .toEqual(pickerPosition);
  await trigger.evaluate((button) => { button.style.transform = ''; });
});
