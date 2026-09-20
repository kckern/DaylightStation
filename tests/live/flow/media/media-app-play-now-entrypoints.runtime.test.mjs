import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' });

async function receiverState(sender) {
  return sender.evaluate(async () => {
    const response = await fetch('/api/v1/device/acceptance-media/receiver-state');
    return response.ok ? response.json() : null;
  });
}

async function prepareQueuedArrival({ context, sender }) {
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

  // A real local play naturally records Arrival in local Recents before the
  // virtual receiver is aimed; the test never seeds app storage.
  const search = sender.getByRole('textbox', { name: 'Search media…' });
  await search.fill('arrival');
  await sender.getByTestId('combobox-option-plex:55854').click();
  const localVideo = sender.locator('.video-player video');
  await expect(localVideo).toBeVisible({ timeout: 60000 });
  await expect.poll(() => localVideo.evaluate(video => video.readyState >= 2 && video.currentTime > 0), { timeout: 30000 })
    .toBe(true);
  await expect.poll(() => sender.evaluate(() => JSON.parse(localStorage.getItem('media-app.recents') || '[]')
    .some(item => item.contentId === 'plex:55854')), { timeout: 10000 }).toBe(true);

  await expect(sender.getByTestId('cast-target-chip')).toBeVisible({ timeout: 30000 });
  await sender.getByTestId('cast-target-chip').click();
  await expect(sender.getByTestId('cast-target-checkbox-acceptance-media')).toBeVisible();
  await sender.getByTestId('cast-target-checkbox-acceptance-media').check();
  await sender.getByTestId('cast-target-chip').click();
  await expect(sender.getByTestId('cast-popover')).toBeHidden();

  // Seed the actual receiver with Arrival plus the queued Disclosure tail.
  await search.fill('arrival');
  await sender.getByTestId('combobox-option-plex:55854').click();
  await expect.poll(() => loads.length, { timeout: 10000 }).toBe(1);
  const native = receiver.locator('.video-player video');
  await expect(native).toBeVisible({ timeout: 60000 });
  await expect.poll(() => native.evaluate(video => video.readyState >= 2 && video.currentTime > 0), { timeout: 30000 })
    .toBe(true);
  await expect.poll(async () => (await receiverState(sender))?.snapshot?.currentItem?.contentId)
    .toBe('plex:55854');

  await search.fill('disclosure day');
  await sender.getByTestId('result-more-plex:697368').click();
  await sender.getByTestId('result-action-add-plex:697368').click();
  const before = await receiverState(sender);
  await expect.poll(async () => {
    const state = await receiverState(sender);
    const tail = state?.snapshot?.queue?.items?.at(-1);
    return state?.snapshot?.currentItem?.contentId === 'plex:55854'
      && tail?.contentId === 'plex:697368' && Boolean(tail?.queueItemId);
  }, { timeout: 30000 }).toBe(true);
  return { receiver, native, search, loads, before: await receiverState(sender) };
}

async function openPlayNowEntry(sender, entry) {
  if (entry === 'Browse leaf') {
    await sender.getByTestId('app-nav-browse').click();
    await expect(sender.getByTestId('browse-view')).toBeVisible();
    await sender.getByTestId('browse-open-plex:').click();
    await expect(sender.getByTestId('browse-view')).toBeVisible();
    await sender.getByTestId('browse-open-plex:library/sections/6/all').click();
    await expect(sender.getByTestId('browse-row-plex:55854')).toBeVisible({ timeout: 30000 });
    await sender.getByTestId('result-play-now-plex:55854').click();
  } else if (entry === 'Detail') {
    await sender.getByTestId('app-nav-browse').click();
    await expect(sender.getByTestId('browse-view')).toBeVisible();
    await sender.getByTestId('browse-open-plex:').click();
    await sender.getByTestId('browse-open-plex:library/sections/6/all').click();
    await sender.getByTestId('browse-detail-plex:55854').click();
    await expect(sender.getByTestId('detail-view')).toBeVisible({ timeout: 30000 });
    await sender.getByTestId('detail-play-now').click();
  } else {
    await sender.getByTestId('app-nav-home').click();
    await expect(sender.getByTestId('recent-plex:55854')).toBeVisible({ timeout: 10000 });
    await sender.getByTestId('recent-plex:55854').click();
  }
}

test('Browse, Detail, and Recent Play Now each starts a fresh receiver visit and retains the queued tail', async ({ context, page: sender }) => {
  test.setTimeout(240000);
  const { receiver, native, loads } = await prepareQueuedArrival({ context, sender });

  for (const entry of ['Browse leaf', 'Detail', 'Recents']) {
    const before = await receiverState(sender);
    const beforeOwner = before.snapshot.meta.playbackOwner;
    const startTime = await native.evaluate(video => video.currentTime);
    // Stay outside the same-item dispatch de-duplication window.
    await expect.poll(() => native.evaluate((video, start) => !video.paused && video.currentTime > start + 6, startTime), { timeout: 20000 })
      .toBe(true);
    const beforeLoadCount = loads.length;

    await openPlayNowEntry(sender, entry);
    await expect.poll(() => loads.length, { timeout: 10000 }).toBe(beforeLoadCount + 1);
    const nextLoad = loads.at(-1);
    expect(nextLoad.method()).toBe('GET');
    const url = new URL(nextLoad.url());
    expect(url.searchParams.get('play')).toBe('plex:55854');
    expect(url.searchParams.get('queue')).toBeNull();
    const dispatchId = url.searchParams.get('dispatchId');
    expect(dispatchId).toBeTruthy();

    await expect.poll(async () => {
      const after = await receiverState(sender);
      const snapshot = after?.snapshot;
      const owner = snapshot?.meta?.playbackOwner;
      const currentVisit = snapshot?.queue?.items?.[snapshot.queue.currentIndex];
      const disclosureIndex = snapshot?.queue?.items?.findIndex(item => item.queueItemId === before.snapshot.queue.items.at(-1)?.queueItemId);
      return snapshot?.sessionId === before.snapshot.sessionId
        && snapshot?.meta?.ownerId === before.snapshot.meta.ownerId
        && owner?.ownerInstanceId === beforeOwner.ownerInstanceId
        && owner?.playbackRevision > beforeOwner.playbackRevision
        && owner?.queueRevision > beforeOwner.queueRevision
        && snapshot?.currentItem?.contentId === 'plex:55854'
        && currentVisit?.contentId === 'plex:55854'
        && currentVisit?.queueItemId !== before.snapshot.queue.items[before.snapshot.queue.currentIndex]?.queueItemId
        && disclosureIndex === before.snapshot.queue.items.length - 1
        && snapshot?.queue?.items?.at(-1)?.queueItemId === before.snapshot.queue.items.at(-1)?.queueItemId;
    }, { timeout: 30000 }).toBe(true);

    const afterVisit = await receiverState(sender);
    const newNative = receiver.locator('.video-player video');
    await expect.poll(() => newNative.evaluate(video => video.readyState >= 2 && video.currentTime > 0), { timeout: 30000 })
      .toBe(true);
    const nativeStart = await newNative.evaluate(video => ({ src: video.currentSrc || video.src, currentTime: video.currentTime }));
    expect(nativeStart.src).toBeTruthy();
    await expect.poll(() => newNative.evaluate((video, time) => !video.paused && video.currentTime > time, nativeStart.currentTime), { timeout: 30000 })
      .toBe(true);
    expect(afterVisit.snapshot.queue.items.at(-1).queueItemId).toBe(before.snapshot.queue.items.at(-1).queueItemId);
    await expect(sender.getByTestId(`dispatch-row-${dispatchId}`)).toContainText('Playing on Acceptance receiver', { timeout: 30000 });
  }
  await receiver.close();
});
