import { test, expect } from '@playwright/test';

// Requires `media-redesign-server.mjs`: its local EventBus/device composition
// is the only permitted receiver. This test has no route interception and no
// synthetic acknowledgement/state; the screen must publish its own result.
test.use({ viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' });
test.setTimeout(120000);

test('ordinary aimed Play then Queue reaches the virtual screen receiver and truthful sender tray', async ({ context, page: sender }) => {
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

  const mediaSearch = sender.getByRole('textbox', { name: 'Search media…' });
  await mediaSearch.fill('arrival');
  const arrival = sender.getByTestId('combobox-option-plex:55854');
  await expect(arrival).toBeVisible({ timeout: 30000 });
  await arrival.click();
  const native = receiver.locator('.video-player video');
  await expect(native).toBeVisible({ timeout: 60000 });
  await expect.poll(() => native.evaluate(element => element.readyState >= 2 && element.currentTime > 0), { timeout: 30000 })
    .toBe(true);
  const before = await native.evaluate(element => {
    window.__ordinaryNativeReceiver = element;
    return { src: element.currentSrc || element.src, paused: element.paused, currentTime: element.currentTime };
  });
  expect(before.src).toBeTruthy();
  await expect.poll(() => native.evaluate((element, startTime) => !element.paused && element.currentTime > startTime, before.currentTime), { timeout: 60000 })
    .toBe(true);
  await expect.poll(async () => sender.evaluate(async played => {
    const response = await fetch('/api/v1/device/acceptance-media/receiver-state');
    return response.ok ? response.json() : null;
  }), { timeout: 60000 }).toMatchObject({ snapshot: { currentItem: { contentId: 'plex:55854' } } });
  await expect(sender.getByTestId('dispatch-tray')).toContainText('Playing on Acceptance receiver', { timeout: 60000 });

  const played = await sender.evaluate(async () => (await fetch('/api/v1/device/acceptance-media/receiver-state')).json());
  await mediaSearch.fill('tuttle twins');
  const container = sender.getByTestId('combobox-option-plex:663508');
  await expect(container).toBeVisible({ timeout: 30000 });
  await container.click();
  await expect(sender.getByTestId('browse-dispatch-header')).toBeVisible({ timeout: 30000 });
  await sender.getByTestId('browse-dispatch-queue').click();
  await expect.poll(async () => sender.evaluate(async () => {
    const after = await (await fetch('/api/v1/device/acceptance-media/receiver-state')).json();
    return after.snapshot.sessionId === played.snapshot.sessionId
      && after.snapshot.ownerId === played.snapshot.ownerId
      && after.snapshot.ownerInstanceId === played.snapshot.ownerInstanceId
      && after.snapshot.currentItem?.contentId === played.snapshot.currentItem?.contentId
      && after.snapshot.playbackRevision === played.snapshot.playbackRevision
      && after.snapshot.queueRevision > played.snapshot.queueRevision
      && after.snapshot.queue?.items?.some(item => item.contentId === 'plex:663508');
  }, played), { timeout: 60000 }).toBe(true);
  expect(await native.evaluate(element => element === window.__ordinaryNativeReceiver)).toBe(true);
  await expect.poll(() => native.evaluate(element => element.currentTime), { timeout: 30000 }).toBeGreaterThan(before.currentTime);
  await expect(sender.getByTestId('dispatch-tray')).toContainText('Added', { timeout: 60000 });

  expect(loads).toHaveLength(2);
  for (const request of loads) {
    expect(request.method()).toBe('GET');
    expect(new URL(request.url()).searchParams.get('dispatchId')).toBeTruthy();
  }
  await receiver.close();
});
