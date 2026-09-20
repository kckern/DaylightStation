import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' });

async function readReceiverState(sender) {
  return sender.evaluate(async () => {
    const response = await fetch('/api/v1/device/acceptance-media/receiver-state');
    return response.ok ? response.json() : null;
  });
}

async function issueThroughControl(sender, action, clickControl) {
  const requestPromise = sender.waitForRequest(request => {
    if (request.method() !== 'POST') return false;
    if (!new URL(request.url()).pathname.endsWith('/api/v1/device/acceptance-media/session/transport')) return false;
    return request.postDataJSON()?.action === action;
  }, { timeout: 15000 });
  await clickControl();
  const request = await requestPromise;
  const body = request.postDataJSON();
  expect(body.action).toBe(action);
  expect(body.commandId).toBeTruthy();
  const response = await request.response();
  expect(response?.status()).toBe(200);
  const acknowledgement = await response.json();
  expect(acknowledgement).toMatchObject({ ok: true, commandId: body.commandId });
  return { ...body, acknowledgement };
}

test('Peek Pause, Resume, Seek, and Stop control the actual receiver video and retain its queue', async ({ context, page: sender }) => {
  test.setTimeout(150000);
  const receiver = await context.newPage();
  const loads = [];
  sender.on('request', request => {
    if (request.url().includes('/api/v1/device/acceptance-media/load')) loads.push(request);
  });

  await sender.goto('/media', { waitUntil: 'domcontentloaded' });
  await receiver.goto('/screen/living-room', { waitUntil: 'domcontentloaded' });
  await expect.poll(async () => sender.evaluate(async () => {
    const response = await fetch('/api/v1/device/acceptance-media/receiver-ready');
    return response.ok && (await response.json()).ready;
  }), { timeout: 30000 }).toBe(true);

  await expect(sender.getByTestId('cast-target-chip')).toBeVisible({ timeout: 30000 });
  await sender.getByTestId('cast-target-chip').click();
  await expect(sender.getByTestId('cast-target-checkbox-acceptance-media')).toBeVisible();
  await sender.getByTestId('cast-mode-fork').check();
  await sender.getByTestId('cast-target-checkbox-acceptance-media').check();
  await sender.getByTestId('cast-target-chip').click();
  await expect(sender.getByTestId('cast-popover')).toBeHidden();

  await sender.getByRole('textbox', { name: 'Search media…' }).fill('arrival');
  await sender.getByTestId('combobox-option-plex:55854').click();
  await expect.poll(() => loads.length, { timeout: 10000 }).toBe(1);

  const video = receiver.locator('.video-player video');
  await expect(video).toBeVisible({ timeout: 60000 });
  await expect.poll(() => video.evaluate(element => element.readyState >= 2
    && !element.paused && element.currentTime > 0), { timeout: 30000 }).toBe(true);
  await expect.poll(async () => (await readReceiverState(sender))?.snapshot?.currentItem?.contentId)
    .toBe('plex:55854');
  await expect.poll(async () => (await readReceiverState(sender))?.snapshot?.state)
    .toBe('playing');

  // Open the real device-control surface; every transport call below comes
  // from its visible controls, never from a direct API request in the test.
  await sender.getByTestId('app-nav-fleet').click();
  await expect(sender.getByTestId('fleet-peek-acceptance-media')).toBeVisible({ timeout: 30000 });
  await sender.getByTestId('fleet-peek-acceptance-media').click();
  await expect(sender.getByTestId('peek-panel')).toBeVisible();
  const toggle = sender.getByTestId('np-toggle');
  await expect(toggle).toHaveAttribute('aria-label', 'Pause');
  await expect(toggle).toBeEnabled();

  await issueThroughControl(sender, 'pause', () => toggle.click());
  await expect.poll(async () => (await readReceiverState(sender))?.snapshot?.state, { timeout: 15000 })
    .toBe('paused');
  await expect.poll(() => video.evaluate(element => element.paused), { timeout: 15000 }).toBe(true);

  const beforeResumeTime = await video.evaluate(element => element.currentTime);
  await expect(toggle).toHaveAttribute('aria-label', 'Play');
  await issueThroughControl(sender, 'play', () => toggle.click());
  await expect.poll(async () => (await readReceiverState(sender))?.snapshot?.state, { timeout: 15000 })
    .toBe('playing');
  await expect.poll(() => video.evaluate((element, time) => !element.paused
    && element.currentTime > time + 1, beforeResumeTime), { timeout: 15000 }).toBe(true);

  const slider = sender.getByRole('slider', { name: 'Seek', exact: true });
  await expect(slider).toBeVisible();
  await expect(slider).not.toHaveAttribute('aria-disabled', 'true');
  const sliderBefore = Number(await slider.getAttribute('aria-valuenow'));
  const seek = await issueThroughControl(sender, 'seekAbs', () => slider.press('ArrowRight'));
  expect(Number.isFinite(seek.value)).toBe(true);
  expect(Math.abs(seek.value - (sliderBefore + 5))).toBeLessThanOrEqual(1);
  await expect.poll(() => video.evaluate((element, target) => !element.paused && !element.seeking
    && Math.abs(element.currentTime - target) <= 2, seek.value), { timeout: 20000 }).toBe(true);
  await expect.poll(async () => {
    const shown = Number(await slider.getAttribute('aria-valuenow'));
    const actual = await video.evaluate(element => element.currentTime);
    return Number.isFinite(shown) && Math.abs(shown - actual) <= 2;
  }, { timeout: 15000 }).toBe(true);

  const beforeStop = await readReceiverState(sender);
  expect(beforeStop.snapshot.state).toBe('playing');
  const queueBeforeStop = beforeStop.snapshot.queue.items.map(item => ({
    queueItemId: item.queueItemId,
    contentId: item.contentId,
  }));
  expect(queueBeforeStop.length).toBeGreaterThan(0);
  const videoHandle = await video.elementHandle();
  const stop = sender.getByTestId('np-stop');
  await expect(stop).toBeEnabled();
  await issueThroughControl(sender, 'stop', () => stop.click());
  await expect.poll(async () => {
    const state = await readReceiverState(sender);
    return state?.snapshot?.state === 'ready';
  }, { timeout: 20000 }).toBe(true);
  await expect.poll(() => videoHandle.evaluate(element => element.paused && element.currentTime <= 1), {
    timeout: 15000,
  }).toBe(true);
  const stopped = await readReceiverState(sender);
  expect(stopped.snapshot.state).toBe('ready');
  expect(stopped.snapshot.currentItem).toBeNull();
  expect(stopped.snapshot.queue.currentIndex).toBe(beforeStop.snapshot.queue.currentIndex);
  expect(stopped.snapshot.queue.items.map(item => ({
    queueItemId: item.queueItemId,
    contentId: item.contentId,
  }))).toEqual(queueBeforeStop);

  expect(loads).toHaveLength(1);
  await receiver.close();
});
