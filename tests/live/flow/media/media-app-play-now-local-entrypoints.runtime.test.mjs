import { test, expect } from '@playwright/test';

// FIND.1b's result-row More → Play Now journey already proves Search locally
// at phone, tablet, and laptop widths. This file covers the other finite
// entrypoints against the real acceptance receiver, without interception.
test.use({ trace: 'retain-on-failure' });

const viewports = [
  ['phone', { width: 390, height: 844 }, true],
  ['tablet', { width: 768, height: 1024 }, false],
  ['laptop', { width: 1440, height: 900 }, false],
];
const entries = [
  ['Browse leaf', async (page, nav) => {
    await page.getByTestId(nav('browse')).click();
    await page.getByTestId('browse-open-plex:').click();
    await page.getByTestId('browse-open-plex:library/sections/6/all').click();
    const content = page.getByTestId('browse-row-plex:55854');
    await expect(content).toBeVisible({ timeout: 30000 });
    return { content, action: page.getByTestId('result-play-now-plex:55854') };
  }],
  ['Detail', async (page, nav) => {
    await page.getByTestId(nav('browse')).click();
    await page.getByTestId('browse-open-plex:').click();
    await page.getByTestId('browse-open-plex:library/sections/6/all').click();
    await page.getByTestId('browse-detail-plex:55854').click();
    const content = page.getByTestId('detail-view');
    await expect(content).toBeVisible({ timeout: 30000 });
    return { content, action: page.getByTestId('detail-play-now') };
  }],
  ['Home Recents', async (page, nav) => {
    await page.getByTestId(nav('home')).click();
    const content = page.getByTestId('recent-plex:55854');
    await expect(content).toBeVisible({ timeout: 10000 });
    return { content, action: content };
  }],
];

const receiverState = page => page.evaluate(async () => {
  const response = await fetch('/api/v1/device/acceptance-media/receiver-state');
  return response.ok ? response.json() : null;
});

function receiverSnapshot(state) {
  const s = state?.snapshot;
  const q = s?.queue;
  const visit = q?.items?.[q.currentIndex];
  const owner = s?.meta?.playbackOwner;
  return {
    sessionId: s?.sessionId ?? null,
    ownerId: s?.meta?.ownerId ?? null,
    currentItem: s?.currentItem ? { contentId: s.currentItem.contentId, title: s.currentItem.title } : null,
    playbackOwner: owner ? {
      ownerInstanceId: owner.ownerInstanceId,
      playbackRevision: owner.playbackRevision,
      queueRevision: owner.queueRevision,
      contentId: owner.contentId,
      queueItemId: owner.queueItemId,
    } : null,
    currentVisit: visit ? { contentId: visit.contentId, queueItemId: visit.queueItemId } : null,
    queueItemIds: Array.isArray(q?.items) ? q.items.map(item => item.queueItemId) : [],
  };
}

async function openSearch(page, phone) {
  if (!phone) {
    const input = page.getByRole('textbox', { name: 'Search media…', exact: true });
    await expect(input).toBeVisible({ timeout: 30000 });
    return input;
  }
  await page.getByTestId('media-search-launcher').click();
  await expect(page.getByTestId('search-mode')).toBeVisible();
  return page.getByTestId('search-mode-input');
}
async function closeSearch(page, phone) {
  if (!phone) return;
  await page.getByTestId('search-mode-close').click();
  await expect(page.getByTestId('search-mode')).toBeHidden();
}
function arrivalResult(page, phone) {
  return page.getByTestId(phone ? 'search-mode-result-plex:55854' : 'combobox-option-plex:55854');
}
async function setReceiverAim(page, phone) {
  if (phone) {
    const searchSurface = page.getByTestId('search-mode');
    await searchSurface.getByTestId('destination-line').click();
    await expect(page.getByTestId('destination-sheet')).toBeVisible();
    await page.getByTestId('picker-device-acceptance-media').click();
    await page.getByTestId('picker-submit').click();
    await expect(searchSurface.getByTestId('destination-line-name')).toHaveText('Acceptance receiver');
    return;
  }
  await page.getByTestId('cast-target-chip').click();
  await page.getByTestId('cast-target-checkbox-acceptance-media').check();
  await page.getByTestId('cast-target-chip').click();
  await expect(page.getByTestId('cast-popover')).toBeHidden();
}
async function setLocalAim(page, phone) {
  if (phone) {
    await page.getByTestId('media-search-launcher').click();
    const searchSurface = page.getByTestId('search-mode');
    await expect(searchSurface).toBeVisible();
    await searchSurface.getByTestId('destination-line').click();
    await expect(page.getByTestId('destination-sheet')).toBeVisible();
    await page.getByTestId('picker-this-device').click();
    await expect(searchSurface.getByTestId('destination-line-name')).toHaveText('This device');
    return closeSearch(page, true);
  }
  await page.getByTestId('cast-target-chip').click();
  await page.getByTestId('cast-target-checkbox-acceptance-media').uncheck();
  await page.getByTestId('cast-target-chip').click();
  await expect(page.getByTestId('cast-popover')).toBeHidden();
}

async function prepare({ context, sender, phone }) {
  const receiver = await context.newPage();
  const loads = [];
  const transports = [];
  const localPlays = [];
  sender.on('request', request => {
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.endsWith('/api/v1/device/acceptance-media/load')) loads.push(request);
    if (path.endsWith('/api/v1/device/acceptance-media/session/transport')) transports.push(request);
    if (path === '/api/v1/play/plex:55854') {
      localPlays.push({ request, session: url.searchParams.get('session') });
    }
  });
  await sender.goto('/media', { waitUntil: 'domcontentloaded' });
  await receiver.goto('/screen/living-room', { waitUntil: 'domcontentloaded' });
  await expect.poll(async () => sender.evaluate(async () => {
    const r = await fetch('/api/v1/device/acceptance-media/receiver-ready');
    return r.ok && (await r.json()).ready;
  }), { timeout: 30000 }).toBe(true);

  // A native local play records the actual Recents source; no localStorage seed.
  const search = await openSearch(sender, phone);
  await search.fill('arrival');
  await arrivalResult(sender, phone).click();
  const localVideo = sender.locator('.video-player video');
  await expect(localVideo).toBeVisible({ timeout: 60000 });
  await expect.poll(() => localVideo.evaluate(v => v.readyState >= 2 && !v.paused && v.currentTime > 0), { timeout: 30000 }).toBe(true);
  await expect.poll(() => sender.evaluate(() => JSON.parse(localStorage.getItem('media-app.recents') || '[]')
    .some(item => item.contentId === 'plex:55854')), { timeout: 10000 }).toBe(true);
  await setReceiverAim(sender, phone);
  await search.fill('arrival');
  await arrivalResult(sender, phone).click();
  await expect.poll(() => loads.length, { timeout: 10000 }).toBe(1);
  const native = receiver.locator('.video-player video');
  await expect(native).toBeVisible({ timeout: 60000 });
  await expect.poll(() => native.evaluate(v => v.readyState >= 2 && !v.paused && v.currentTime > 0), { timeout: 30000 }).toBe(true);
  await search.fill('disclosure day');
  await sender.getByTestId('result-more-plex:697368').click();
  await sender.getByTestId('result-action-add-plex:697368').click();
  await expect.poll(async () => {
    const queue = (await receiverState(sender))?.snapshot?.queue;
    return queue?.items?.at(-1)?.contentId === 'plex:697368' && Boolean(queue.items.at(-1)?.queueItemId);
  }, { timeout: 30000 }).toBe(true);
  await closeSearch(sender, phone);
  return { receiver, loads, transports, localPlays, localVideo };
}

for (const [name, viewport, phone] of viewports) {
  for (const [entryName, open] of entries) {
    test(`[PLAY.1b/AC1,AC2] ${name} ${entryName}: This device stays local and retains route`, async ({ context, page: sender }) => {
      test.setTimeout(180000);
      await sender.setViewportSize(viewport);
      const { receiver, loads, transports, localPlays, localVideo } = await prepare({ context, sender, phone });
      try {
        const { action, content } = await open(sender, area => `${phone ? 'app-tab' : 'app-nav'}-${area}`);
        await setLocalAim(sender, phone);
        await expect(content).toBeVisible();
        const route = sender.url();
        const before = receiverSnapshot(await receiverState(sender));
        const loadCount = loads.length;
        const transportCount = transports.length;
        const localPlayCount = localPlays.length;
        const oldLocalSession = localPlays.at(-1)?.session;
        expect(oldLocalSession).toBeTruthy();
        const oldLocalTime = await localVideo.evaluate(v => v.currentTime);
        await sender.waitForTimeout(750); // baseline must be settled before the action
        expect(receiverSnapshot(await receiverState(sender))).toEqual(before);
        expect(loads).toHaveLength(loadCount);
        expect(transports).toHaveLength(transportCount);

        await action.click();
        await expect.poll(() => localPlays.length, { timeout: 30000 }).toBe(localPlayCount + 1);
        const newLocalPlay = localPlays.at(-1);
        expect(newLocalPlay?.session).toBeTruthy();
        expect(newLocalPlay?.session).not.toBe(oldLocalSession);
        await expect.poll(() => localVideo.evaluate((v, oldTime) => v.currentTime < oldTime, oldLocalTime), { timeout: 30000 }).toBe(true);
        const newVisitTime = await localVideo.evaluate(v => v.currentTime);
        await expect.poll(() => localVideo.evaluate((v, start) => (
          v.readyState >= 2 && !v.paused && v.currentTime > start
        ), newVisitTime), { timeout: 30000 }).toBe(true);
        await expect(sender.getByTestId('media-mini-player')).toContainText('Arrival');
        await expect(sender.getByTestId('mini-player-video-dock')).toBeVisible();
        expect(sender.url()).toBe(route);
        await expect(content).toBeVisible();
        expect(receiverSnapshot(await receiverState(sender))).toEqual(before);
        expect(loads).toHaveLength(loadCount);
        expect(transports).toHaveLength(transportCount);
      } finally {
        await receiver.close();
      }
    });
  }
}
