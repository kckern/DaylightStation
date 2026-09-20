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

async function expectSeekState(video, slider, target, paused) {
  await expect.poll(() => video.evaluate((element, expected) => !element.seeking
    && element.paused === expected.paused
    && Math.abs(element.currentTime - expected.target) <= 2, { target, paused }), { timeout: 20000 }).toBe(true);
  await expect.poll(async () => {
    const shown = Number(await slider.getAttribute('aria-valuenow'));
    const actual = await video.evaluate(element => element.currentTime);
    return Number.isFinite(shown) && Math.abs(shown - actual) <= 2;
  }, { timeout: 15000 }).toBe(true);
}

function parseTimecode(value) {
  return value.trim().split(':').reduce((total, part) => total * 60 + Number(part), 0);
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

  const slider = sender.getByRole('slider', { name: 'Seek', exact: true });
  await expect(slider).toBeVisible();
  const fixedPausedPosition = await video.evaluate(element => element.currentTime);
  const backTen = sender.getByTestId('np-rew');
  await expect(backTen).toBeEnabled();
  const forward = await issueThroughControl(sender, 'seekRel', () => sender.getByTestId('np-ffw').click());
  expect(forward.value).toBe(10);
  await expectSeekState(video, slider, fixedPausedPosition + 10, true);

  const backward = await issueThroughControl(sender, 'seekRel', () => backTen.click());
  expect(backward.value).toBe(-10);
  await expectSeekState(video, slider, fixedPausedPosition, true);

  await expect(slider).not.toHaveAttribute('aria-disabled', 'true');
  const absoluteFraction = 0.35;
  const absoluteTarget = Math.round(Number(await slider.getAttribute('aria-valuemax')) * absoluteFraction);
  expect(Math.abs(absoluteTarget - fixedPausedPosition)).toBeGreaterThan(60);
  const absoluteBounds = await slider.boundingBox();
  expect(absoluteBounds).not.toBeNull();
  const absolute = await issueThroughControl(sender, 'seekAbs', () => slider.click({
    position: { x: absoluteBounds.width * absoluteFraction, y: absoluteBounds.height / 2 },
  }));
  expect(Math.abs(absolute.value - Number(await slider.getAttribute('aria-valuenow')))).toBeLessThanOrEqual(1);
  expect(absolute.value).toBeGreaterThan(fixedPausedPosition + 60);
  await expectSeekState(video, slider, absolute.value, true);

  const sliderBounds = await slider.boundingBox();
  expect(sliderBounds).not.toBeNull();
  const dragFraction = 0.12;
  const dragTarget = Math.round(Number(await slider.getAttribute('aria-valuemax')) * dragFraction);
  expect(Math.abs(dragTarget - absolute.value)).toBeGreaterThan(60);
  const dragX = sliderBounds.x + sliderBounds.width * dragFraction;
  const dragY = sliderBounds.y + sliderBounds.height / 2;
  const elapsed = sender.getByTestId('np-seek-elapsed');
  const drag = await issueThroughControl(sender, 'seekAbs', async () => {
    await sender.mouse.move(sliderBounds.x + sliderBounds.width * 0.01, dragY);
    await sender.mouse.down();
    await sender.mouse.move(dragX, dragY, { steps: 5 });
    await expect.poll(async () => Number(await slider.getAttribute('aria-valuenow')), { timeout: 5000 })
      .toBe(dragTarget);
    expect(Math.abs(parseTimecode(await elapsed.innerText()) - dragTarget)).toBeLessThanOrEqual(1);
    await sender.mouse.up();
  });
  expect(Math.abs(drag.value - dragTarget)).toBeLessThanOrEqual(1);
  expect(Math.abs(drag.value - fixedPausedPosition)).toBeGreaterThan(60);
  await expectSeekState(video, slider, drag.value, true);

  const beforeResumeTime = await video.evaluate(element => element.currentTime);
  await expect(toggle).toHaveAttribute('aria-label', 'Play');
  await issueThroughControl(sender, 'play', () => toggle.click());
  await expect.poll(async () => (await readReceiverState(sender))?.snapshot?.state, { timeout: 15000 })
    .toBe('playing');
  await expect.poll(() => video.evaluate((element, time) => !element.paused
    && element.currentTime > time + 1, beforeResumeTime), { timeout: 15000 }).toBe(true);

  const beforeStop = await readReceiverState(sender);
  expect(beforeStop.snapshot.state).toBe('playing');
  const queueBeforeStop = beforeStop.snapshot.queue.items.map(item => ({
    queueItemId: item.queueItemId,
    contentId: item.contentId,
    title: item.title ?? item.contentId,
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
    title: item.title ?? item.contentId,
  }))).toEqual(queueBeforeStop);

  const queueKept = sender.getByTestId('peek-queue-kept');
  await expect(queueKept).toHaveText(new RegExp(`^Queue kept: ${queueBeforeStop.length} item${queueBeforeStop.length === 1 ? '' : 's'}$`));
  const openQueue = sender.getByTestId('peek-open-queue');
  const queuePanel = sender.getByTestId('queue-panel');
  await expect(openQueue).toBeVisible();
  await openQueue.click();
  await expect(queuePanel).toBeVisible();
  await expect.poll(() => sender.evaluate(() => {
    const focused = document.activeElement;
    const panel = document.querySelector('[data-testid="queue-panel"]');
    return focused?.getAttribute('tabindex') === '-1' && !!panel && focused.contains(panel);
  })).toBe(true);
  for (const item of queueBeforeStop) {
    const queueRow = sender.getByTestId(`queue-item-${item.queueItemId}`);
    await expect(queueRow).toBeVisible();
    await expect(sender.getByTestId(`queue-jump-${item.queueItemId}`)).toContainText(item.title);
  }
  await openQueue.click();
  await expect(queuePanel).toBeVisible();
  await expect.poll(() => sender.evaluate(() => {
    const focused = document.activeElement;
    const panel = document.querySelector('[data-testid="queue-panel"]');
    return focused?.getAttribute('tabindex') === '-1' && !!panel && focused.contains(panel);
  })).toBe(true);

  expect(loads).toHaveLength(1);
  await receiver.close();
});
