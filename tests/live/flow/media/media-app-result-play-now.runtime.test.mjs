import { test, expect } from '@playwright/test';

// Requires `media-redesign-server.mjs`: its local EventBus/device composition
// is the only permitted receiver. This test has no route interception and no
// synthetic acknowledgement/state; the screen must publish its own result.
test.use({ viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' });

const surfaces = [
  ['phone SearchMode', { width: 390, height: 844 }, true],
  ['tablet dock search', { width: 768, height: 1024 }, false],
  ['laptop dock search', { width: 1440, height: 900 }, false],
];

async function assertDockInputGeometry(page, input) {
  const geometry = await input.evaluate((element) => {
    const wrapper = element.closest('.media-search-input-wrap');
    const section = element.parentElement?.querySelector('.mantine-Input-section');
    const inputBox = element.getBoundingClientRect();
    const wrapperBox = wrapper?.getBoundingClientRect();
    const sectionBox = section?.getBoundingClientRect();
    const centerX = inputBox.left + inputBox.width / 2;
    const centerY = inputBox.top + inputBox.height / 2;
    const hit = document.elementFromPoint(centerX, centerY);
    return {
      wrapperWidth: wrapperBox?.width ?? 0,
      inputWidth: inputBox.width,
      centerX,
      sectionRight: sectionBox?.right ?? 0,
      centerHitsInput: hit === element || element.contains(hit),
    };
  });
  expect(geometry.wrapperWidth, `dock input wrapper width: ${JSON.stringify(geometry)}`).toBeGreaterThan(48);
  expect(
    geometry.centerHitsInput || geometry.centerX > geometry.sectionRight,
    `dock input center is covered by its left section: ${JSON.stringify(geometry)}`
  ).toBe(true);
}

async function openSearch(page, isPhone) {
  await page.goto('/media', { waitUntil: 'domcontentloaded' });
  if (isPhone) {
    await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('media-search-launcher').click();
    await expect(page.getByTestId('search-mode')).toBeVisible();
    return page.getByTestId('search-mode-input');
  }
  await expect(page.getByTestId('media-search-bar')).toBeVisible({ timeout: 30000 });
  const input = page.getByRole('textbox', { name: 'Search media…', exact: true });
  await assertDockInputGeometry(page, input);
  await input.click();
  return input;
}

function searchSurface(page, isPhone) {
  return isPhone ? page.getByTestId('search-mode') : page.getByTestId('media-search-bar');
}

async function setDestination(page, isPhone, targetId) {
  await searchSurface(page, isPhone).getByTestId('destination-line').click();
  await expect(page.getByTestId('destination-sheet')).toBeVisible();
  if (!targetId) {
    await page.getByTestId('picker-this-device').click();
    return;
  }
  await page.getByTestId(`picker-device-${targetId}`).click();
  await page.getByTestId('picker-submit').click();
}

const receiverState = page => page.evaluate(async () =>
  (await fetch('/api/v1/device/acceptance-media/receiver-state')).json());

async function assertSearchIdentity(page, input, isPhone, id, query = 'arrival') {
  await expect(input).toHaveValue(query);
  await expect(searchSurface(page, isPhone).getByTestId('scope-chip-all')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId(`result-more-${id}`)).toBeVisible();
}

async function resultActionIdentity(page, id) {
  const expected = [
    { id: `result-action-playNow-${id}`, text: 'Play Now', enabled: true },
    { id: `result-action-playNext-${id}`, text: 'Play Next', enabled: true },
    { id: `result-action-upNext-${id}`, text: 'Up Next', enabled: true },
    { id: `result-action-add-${id}`, text: 'Add to Queue', enabled: true },
    { id: `result-action-detail-${id}`, text: 'Open detail', enabled: true },
  ];
  await page.getByTestId(`result-more-${id}`).click();
  const menu = page.getByTestId(`result-more-menu-${id}`);
  await expect(menu).toBeVisible();
  const actual = await Promise.all(expected.map(async ({ id: actionId }) => {
    const action = page.getByTestId(actionId);
    return {
      id: actionId,
      text: (await action.textContent())?.trim(),
      enabled: await action.isEnabled(),
    };
  }));
  expect(actual).toEqual(expected);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  return actual;
}

async function runResultPlayNowJourney({ context, page: sender }, chooseExplicitFork) {
  test.setTimeout(chooseExplicitFork ? 120000 : 60000);
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
  if (chooseExplicitFork) await sender.getByTestId('cast-mode-fork').check();
  await sender.getByTestId('cast-target-checkbox-acceptance-media').check();
  await sender.getByTestId('cast-target-chip').click();
  await expect(sender.getByTestId('cast-popover')).toBeHidden();

  const mediaSearch = sender.getByRole('textbox', { name: 'Search media…' });
  await mediaSearch.fill('arrival');
  const arrival = sender.getByTestId('combobox-option-plex:55854');
  await expect(arrival).toBeVisible({ timeout: 30000 });
  await arrival.click();
  await expect.poll(() => loads.length, { timeout: 10000 }).toBe(1);
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
  await expect.poll(async () => sender.evaluate(async () => {
    const response = await fetch('/api/v1/device/acceptance-media/receiver-state');
    return response.ok ? response.json() : null;
  }), { timeout: 60000 }).toMatchObject({ snapshot: { currentItem: { contentId: 'plex:55854' } } });
  await expect(sender.getByTestId('dispatch-tray')).toContainText('Playing on Acceptance receiver', { timeout: 60000 });

  const played = await sender.evaluate(async () => (await fetch('/api/v1/device/acceptance-media/receiver-state')).json());
  const playedOwner = played.snapshot?.meta?.playbackOwner;
  expect(played.snapshot?.meta?.ownerId).toBe('acceptance-media');
  expect(playedOwner).toMatchObject({
    ownerInstanceId: expect.any(String), playbackRevision: expect.any(Number), queueRevision: expect.any(Number),
  });

  await mediaSearch.fill('disclosure day');
  const disclosureMore = sender.getByTestId('result-more-plex:697368');
  await expect(disclosureMore).toBeVisible({ timeout: 30000 });
  await disclosureMore.click();
  const addDisclosure = sender.getByTestId('result-action-add-plex:697368');
  await expect(addDisclosure).toBeVisible({ timeout: 30000 });
  const addStartTime = await native.evaluate(element => {
    const events = ['pause', 'emptied', 'loadstart'];
    window.__ordinaryNativePostAddEvents = [];
    for (const type of events) {
      element.addEventListener(type, () => window.__ordinaryNativePostAddEvents.push(type));
    }
    return element.currentTime;
  });
  await addDisclosure.click();
  await expect.poll(async () => sender.evaluate(async (beforeAdd) => {
    const response = await fetch('/api/v1/device/acceptance-media/receiver-state');
    if (!response.ok) return false;
    const after = await response.json();
    const beforeOwner = beforeAdd.snapshot.meta.playbackOwner;
    const afterOwner = after.snapshot?.meta?.playbackOwner;
    return after.snapshot.sessionId === beforeAdd.snapshot.sessionId
      && after.snapshot.meta?.ownerId === beforeAdd.snapshot.meta.ownerId
      && afterOwner?.ownerInstanceId === beforeOwner.ownerInstanceId
      && after.snapshot.currentItem?.contentId === beforeAdd.snapshot.currentItem?.contentId
      && afterOwner?.playbackRevision === beforeOwner.playbackRevision
      && afterOwner?.queueRevision > beforeOwner.queueRevision
      && after.snapshot.queue?.items?.some(item => item.contentId === 'plex:697368');
  }, played), { timeout: 60000 }).toBe(true);
  expect(await native.evaluate(element => element === window.__ordinaryNativeReceiver)).toBe(true);
  const afterAddNative = await native.evaluate(element => ({
    paused: element.paused,
    currentTime: element.currentTime,
    events: [...window.__ordinaryNativePostAddEvents],
  }));
  expect(afterAddNative.paused).toBe(false);
  expect(afterAddNative.currentTime).toBeGreaterThan(addStartTime);
  expect(afterAddNative.events).toEqual([]);
  await expect(sender.getByTestId('dispatch-tray')).toContainText('Added', { timeout: 60000 });

  const afterAdd = await sender.evaluate(async () => (await fetch('/api/v1/device/acceptance-media/receiver-state')).json());
  const disclosureVisit = afterAdd.snapshot?.queue?.items?.find(item => item.contentId === 'plex:697368');
  const disclosureIndex = afterAdd.snapshot?.queue?.items?.findIndex(item => item.queueItemId === disclosureVisit?.queueItemId);
  const previousCurrentVisit = afterAdd.snapshot?.queue?.items?.[afterAdd.snapshot?.queue?.currentIndex];
  expect(afterAdd.snapshot?.currentItem?.contentId).toBe('plex:55854');
  expect(disclosureVisit?.queueItemId).toBeTruthy();
  expect(disclosureIndex).toBe(afterAdd.snapshot.queue.items.length - 1);
  expect(previousCurrentVisit?.contentId).toBe('plex:55854');
  expect(previousCurrentVisit?.queueItemId).toBeTruthy();
  // The provider suppresses identical Play requests for 5s. Wait for actual
  // receiver progress beyond that window, without advancing or freezing clocks.
  await expect.poll(() => native.evaluate((element, startTime) => !element.paused && element.currentTime > startTime + 6, afterAddNative.currentTime), { timeout: 20000 })
    .toBe(true);

  // Re-open the same actual result row and use its ResultRow More action, not
  // the combobox option tap (which has different clear-rest semantics).
  await mediaSearch.fill('arrival');
  const arrivalMore = sender.getByTestId('result-more-plex:55854');
  await expect(arrivalMore).toBeVisible({ timeout: 30000 });
  await arrivalMore.click();
  const playNow = sender.getByTestId('result-action-playNow-plex:55854');
  await expect(playNow).toBeVisible({ timeout: 30000 });
  await playNow.click();
  // A same-item Play within DispatchProvider's 5s dedupe window could look
  // like a no-op, so require the third real GET before inspecting the result.
  // In untouched default mode this short gate intentionally exposes the RED.
  await expect.poll(() => loads.length, { timeout: chooseExplicitFork ? 60000 : 5000 }).toBe(3);

  await expect.poll(async () => sender.evaluate(async ({ previous, queuedDisclosureId, queuedDisclosureIndex }) => {
    const response = await fetch('/api/v1/device/acceptance-media/receiver-state');
    if (!response.ok) return false;
    const after = await response.json();
    const beforeOwner = previous.snapshot.meta.playbackOwner;
    const afterOwner = after.snapshot?.meta?.playbackOwner;
    const queue = after.snapshot?.queue;
    const currentVisit = queue?.items?.[queue.currentIndex];
    const disclosureIndexNow = queue?.items?.findIndex(item => item.queueItemId === queuedDisclosureId);
    return after.snapshot.sessionId === previous.snapshot.sessionId
      && after.snapshot.meta?.ownerId === previous.snapshot.meta.ownerId
      && afterOwner?.ownerInstanceId === beforeOwner.ownerInstanceId
      && afterOwner?.playbackRevision > beforeOwner.playbackRevision
      && afterOwner?.queueRevision > beforeOwner.queueRevision
      && after.snapshot.currentItem?.contentId === 'plex:55854'
      && currentVisit?.contentId === 'plex:55854'
      && currentVisit?.queueItemId
      && currentVisit.queueItemId !== previous.snapshot.queue.items[previous.snapshot.queue.currentIndex]?.queueItemId
      && disclosureIndexNow === queuedDisclosureIndex
      && disclosureIndexNow === queue.items.length - 1;
  }, {
    previous: afterAdd,
    queuedDisclosureId: disclosureVisit.queueItemId,
    queuedDisclosureIndex: disclosureIndex,
  }), { timeout: 60000 }).toBe(true);

  const afterMorePlay = await sender.evaluate(async () => (await fetch('/api/v1/device/acceptance-media/receiver-state')).json());
  const afterMoreOwner = afterMorePlay.snapshot?.meta?.playbackOwner;
  const currentVisit = afterMorePlay.snapshot?.queue?.items?.[afterMorePlay.snapshot?.queue?.currentIndex];
  const retainedDisclosureIndex = afterMorePlay.snapshot?.queue?.items?.findIndex(item => item.queueItemId === disclosureVisit.queueItemId);
  expect(afterMorePlay.snapshot?.currentItem?.contentId).toBe('plex:55854');
  expect(currentVisit?.contentId).toBe('plex:55854');
  expect(currentVisit?.queueItemId).not.toBe(previousCurrentVisit.queueItemId);
  expect(afterMoreOwner?.playbackRevision).toBeGreaterThan(afterAdd.snapshot.meta.playbackOwner.playbackRevision);
  expect(retainedDisclosureIndex).toBe(disclosureIndex);
  expect(retainedDisclosureIndex).toBe(afterMorePlay.snapshot.queue.items.length - 1);

  const morePlayNative = receiver.locator('.video-player video');
  await expect(morePlayNative).toBeVisible({ timeout: 60000 });
  await expect.poll(() => morePlayNative.evaluate(element => element.readyState >= 2 && element.currentTime > 0), { timeout: 30000 })
    .toBe(true);
  const newCurrentNative = await morePlayNative.evaluate(element => ({
    src: element.currentSrc || element.src,
    paused: element.paused,
    currentTime: element.currentTime,
  }));
  expect(newCurrentNative.src).toBeTruthy();
  await expect.poll(() => morePlayNative.evaluate((element, startTime) => !element.paused && element.currentTime > startTime, newCurrentNative.currentTime), { timeout: 60000 })
    .toBe(true);

  expect(loads).toHaveLength(3);
  const thirdLoad = loads[2];
  expect(thirdLoad.method()).toBe('GET');
  const thirdLoadUrl = new URL(thirdLoad.url());
  expect(thirdLoadUrl.searchParams.get('play')).toBe('plex:55854');
  expect(thirdLoadUrl.searchParams.get('queue')).toBeNull();
  const dispatchId = thirdLoadUrl.searchParams.get('dispatchId');
  expect(dispatchId).toBeTruthy();
  await expect(sender.getByTestId(`dispatch-row-${dispatchId}`)).toContainText('Playing on Acceptance receiver', { timeout: 60000 });
  await receiver.close();
}

test('explicit fork: aimed More → Play Now starts a new receiver visit and preserves the queued tail', async ({ context, page }) => {
  await runResultPlayNowJourney({ context, page }, true);
});

test('fresh/default mode: aimed More → Play Now starts a new receiver visit and preserves the queued tail', async ({ context, page }) => {
  await runResultPlayNowJourney({ context, page }, false);
});

for (const [surface, viewport, isPhone] of surfaces) {
  test(`[FIND.1b/AC1,AC2] ${surface}: remote Play/Add and local Play keep search and receiver state isolated`, async ({ context, page: sender }) => {
    test.setTimeout(120000);
    await sender.setViewportSize(viewport);
    const receiver = await context.newPage();
    const loads = [];
    const transportCommands = [];
    sender.on('request', request => {
      if (request.url().includes('/api/v1/device/acceptance-media/load')) loads.push(request);
      if (new URL(request.url()).pathname.endsWith('/api/v1/device/acceptance-media/session/transport')) {
        transportCommands.push(request);
      }
    });
    await receiver.goto('/screen/living-room', { waitUntil: 'domcontentloaded' });
    const input = await openSearch(sender, isPhone);
    await expect.poll(async () => sender.evaluate(async () => {
      const response = await fetch('/api/v1/device/acceptance-media/receiver-ready');
      return response.ok && (await response.json()).ready;
    }), { timeout: 30000 }).toBe(true);

    const id = 'plex:55854';
    const addId = 'plex:697368';
    await input.fill('arrival');
    await expect(sender.getByTestId(`result-more-${id}`)).toBeVisible({ timeout: 30000 });
    await assertSearchIdentity(sender, input, isPhone, id);

    await setDestination(sender, isPhone, 'acceptance-media');
    await expect(searchSurface(sender, isPhone).getByTestId('destination-line-name')).toHaveText('Acceptance receiver');
    await assertSearchIdentity(sender, input, isPhone, id);
    const remotePlayActions = await resultActionIdentity(sender, id);
    await assertSearchIdentity(sender, input, isPhone, id);
    await sender.getByTestId(`result-more-${id}`).click();
    await sender.getByTestId(`result-action-playNow-${id}`).click();
    await expect.poll(() => loads.length).toBe(1);
    const receiverVideo = receiver.locator('.video-player video');
    await expect(receiverVideo).toBeVisible({ timeout: 60000 });
    await expect.poll(() => receiverVideo.evaluate(el => el.readyState >= 2 && !el.paused && el.currentTime > 0), { timeout: 60000 }).toBe(true);
    const remotePlayStartTime = await receiverVideo.evaluate(el => el.currentTime);
    let remoteAfterPlay = null;
    await expect.poll(async () => {
      const [state, nativeAdvancing] = await Promise.all([
        receiverState(sender),
        receiverVideo.evaluate((el, startTime) => (
          el.readyState >= 2 && !el.paused && el.currentTime > startTime
        ), remotePlayStartTime),
      ]);
      const snapshot = state.snapshot;
      const owner = snapshot?.meta?.playbackOwner;
      const currentVisit = snapshot?.queue?.items?.[snapshot.queue.currentIndex];
      const settled = nativeAdvancing
        && snapshot?.state === 'playing'
        && snapshot?.currentItem?.contentId === id
        && snapshot?.meta?.ownerId === 'acceptance-media'
        && typeof snapshot?.sessionId === 'string' && snapshot.sessionId.length > 0
        && owner?.sessionId === snapshot.sessionId
        && typeof owner?.ownerInstanceId === 'string' && owner.ownerInstanceId.length > 0
        && Number.isInteger(owner?.playbackRevision) && owner.playbackRevision > 0
        && Number.isInteger(owner?.queueRevision) && owner.queueRevision > 0
        && owner?.contentId === id
        && typeof owner?.queueItemId === 'string' && owner.queueItemId.length > 0
        && currentVisit?.contentId === id
        && currentVisit?.queueItemId === owner.queueItemId;
      if (settled) remoteAfterPlay = state;
      return settled;
    }, { timeout: 60000 }).toBe(true);
    await expect(sender.getByTestId('dispatch-tray')).toContainText('Playing on Acceptance receiver', { timeout: 60000 });
    await assertSearchIdentity(sender, input, isPhone, id);
    expect(await resultActionIdentity(sender, id)).toEqual(remotePlayActions);
    await assertSearchIdentity(sender, input, isPhone, id);

    await input.fill('disclosure day');
    await expect(sender.getByTestId(`result-more-${addId}`)).toBeVisible({ timeout: 30000 });
    await assertSearchIdentity(sender, input, isPhone, addId, 'disclosure day');
    const remoteAddActions = await resultActionIdentity(sender, addId);
    await assertSearchIdentity(sender, input, isPhone, addId, 'disclosure day');
    await sender.getByTestId(`result-more-${addId}`).click();
    await sender.getByTestId(`result-action-add-${addId}`).click();
    await expect.poll(async () => {
      const state = await receiverState(sender);
      const before = remoteAfterPlay.snapshot.meta.playbackOwner;
      const after = state.snapshot?.meta?.playbackOwner;
      const beforeVisit = remoteAfterPlay.snapshot.queue.items[remoteAfterPlay.snapshot.queue.currentIndex];
      const afterVisit = state.snapshot?.queue?.items?.[state.snapshot.queue.currentIndex];
      return state.snapshot?.sessionId === remoteAfterPlay.snapshot.sessionId
        && state.snapshot?.meta?.ownerId === remoteAfterPlay.snapshot.meta.ownerId
        && after?.ownerInstanceId === before.ownerInstanceId
        && state.snapshot?.currentItem?.contentId === remoteAfterPlay.snapshot.currentItem.contentId
        && afterVisit?.contentId === beforeVisit.contentId
        && afterVisit?.queueItemId === beforeVisit.queueItemId
        && after?.playbackRevision === before?.playbackRevision
        && after?.queueRevision > before?.queueRevision
        && state.snapshot?.queue?.items?.some(item => item.contentId === addId);
    }, { timeout: 60000 }).toBe(true);
    const remoteAfterAdd = await receiverState(sender);
    await expect(sender.getByTestId('dispatch-tray')).toContainText('Added', { timeout: 60000 });
    await expect(sender.getByTestId('dispatch-tray')).toContainText('Acceptance receiver');
    await assertSearchIdentity(sender, input, isPhone, addId, 'disclosure day');
    expect(await resultActionIdentity(sender, addId)).toEqual(remoteAddActions);
    await assertSearchIdentity(sender, input, isPhone, addId, 'disclosure day');

    await input.fill('arrival');
    await assertSearchIdentity(sender, input, isPhone, id);
    await setDestination(sender, isPhone, null);
    await expect(searchSurface(sender, isPhone).getByTestId('destination-line-name')).toHaveText('This device');
    await assertSearchIdentity(sender, input, isPhone, id);
    const localPlayActions = await resultActionIdentity(sender, id);
    await assertSearchIdentity(sender, input, isPhone, id);
    await sender.getByTestId(`result-more-${id}`).click();
    await sender.getByTestId(`result-action-playNow-${id}`).click();
    const localVideo = sender.locator('.video-player video');
    await expect(localVideo).toBeVisible({ timeout: 60000 });
    await expect.poll(() => localVideo.evaluate(el => el.readyState >= 2 && !el.paused && el.currentTime > 0), { timeout: 60000 }).toBe(true);
    const remoteAfterLocal = await receiverState(sender);
    expect(remoteAfterLocal).toMatchObject({
      snapshot: {
        currentItem: remoteAfterAdd.snapshot.currentItem,
        meta: {
          ownerId: remoteAfterAdd.snapshot.meta.ownerId,
          playbackOwner: {
            ownerInstanceId: remoteAfterAdd.snapshot.meta.playbackOwner.ownerInstanceId,
            playbackRevision: remoteAfterAdd.snapshot.meta.playbackOwner.playbackRevision,
            queueRevision: remoteAfterAdd.snapshot.meta.playbackOwner.queueRevision,
          },
        },
      },
    });
    await assertSearchIdentity(sender, input, isPhone, id);
    expect(await resultActionIdentity(sender, id)).toEqual(localPlayActions);
    await assertSearchIdentity(sender, input, isPhone, id);

    const aimedTargetBeforePeek = JSON.parse(await sender.evaluate(() => localStorage.getItem('media-app.cast-target')));
    const loadsBeforePeek = loads.length;
    const transportCommandsBeforePeek = transportCommands.length;
    expect(aimedTargetBeforePeek).toBeTruthy();
    if (isPhone) {
      await expect(sender.getByTestId('search-mode')).toBeVisible();
      await sender.getByTestId('search-mode-close').click();
      await expect(sender.getByTestId('search-mode')).toBeHidden();
    }
    await sender.getByTestId(isPhone ? 'app-tab-fleet' : 'app-nav-fleet').click();
    await expect(sender.getByTestId('fleet-peek-acceptance-media')).toBeVisible({ timeout: 30000 });
    await sender.getByTestId('fleet-peek-acceptance-media').click();
    const peekPanel = sender.getByTestId('peek-panel');
    await expect(peekPanel).toBeVisible();
    const disclosureVisits = remoteAfterAdd.snapshot.queue.items.filter(item => item.contentId === addId);
    expect(disclosureVisits).toHaveLength(1);
    const disclosureVisit = disclosureVisits[0];
    const disclosureRow = sender.getByTestId(`queue-item-${disclosureVisit.queueItemId}`);
    await expect(disclosureRow).toBeVisible();
    await expect(disclosureRow).toContainText('Disclosure Day');
    expect(loads).toHaveLength(loadsBeforePeek);
    expect(transportCommands).toHaveLength(transportCommandsBeforePeek);
    const aimedTargetAfterPeek = JSON.parse(await sender.evaluate(() => localStorage.getItem('media-app.cast-target')));
    expect(aimedTargetAfterPeek).toMatchObject({
      mode: aimedTargetBeforePeek.mode,
      targetIds: aimedTargetBeforePeek.targetIds,
    });
    const remoteAfterPeek = await receiverState(sender);
    expect(remoteAfterPeek.snapshot).toMatchObject({
      sessionId: remoteAfterAdd.snapshot.sessionId,
      currentItem: remoteAfterAdd.snapshot.currentItem,
      meta: {
        ownerId: remoteAfterAdd.snapshot.meta.ownerId,
        playbackOwner: {
          ownerInstanceId: remoteAfterAdd.snapshot.meta.playbackOwner.ownerInstanceId,
          playbackRevision: remoteAfterAdd.snapshot.meta.playbackOwner.playbackRevision,
          queueRevision: remoteAfterAdd.snapshot.meta.playbackOwner.queueRevision,
        },
      },
    });
    await receiver.close();
  });
}
