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

async function expectSeekState(native, slider, target, paused) {
  await expect.poll(() => native.evaluate((element, expected) => ({
    settled: !element.seeking
      && element.paused === expected.paused
      && Math.abs(element.currentTime - expected.target) <= 2,
    nativeTime: element.currentTime,
    target: expected.target,
    delta: Math.abs(element.currentTime - expected.target),
    paused: element.paused,
    seeking: element.seeking,
    readyState: element.readyState,
  }), { target, paused }), { timeout: 20000 }).toMatchObject({
    settled: true,
    target,
    paused,
    seeking: false,
  });
  await expect.poll(async () => {
    const shown = Number(await slider.getAttribute('aria-valuenow'));
    const actual = await native.evaluate(element => element.currentTime);
    return Number.isFinite(shown) && Math.abs(shown - actual) <= 2;
  }, { timeout: 15000 }).toBe(true);
}

function parseTimecode(value) {
  return value.trim().split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

const ARRIVAL_VIDEO = {
  contentId: 'plex:55854',
  query: 'arrival',
  surfaceSelector: '.video-player',
  nativeSelector: '.video-player video',
};

const FAITH_AUDIO = {
  contentId: 'plex:584614',
  query: 'Faith',
  // AudioPlayer's production renderer owns this scoped native node; do not
  // infer playback from ambient audio elements elsewhere on the screen.
  surfaceSelector: '.audio-player',
  nativeSelector: '.audio-player audio',
};

async function startArrivalJourney(context, sender, {
  mobile = false,
  media = ARRIVAL_VIDEO,
  afterDispatch = async () => ({}),
} = {}) {
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

  let searchInput;
  let result;
  if (mobile) {
    // On phones the dock intentionally exposes only a Search launcher; the
    // ordinary mobile destination control lives inside SearchMode.
    await expect(sender.getByTestId('media-search-launcher')).toBeVisible();
    await sender.getByTestId('media-search-launcher').click();
    const searchMode = sender.getByTestId('search-mode');
    await expect(searchMode).toBeVisible();
    await searchMode.getByTestId('destination-line').click();
    await expect(sender.getByTestId('destination-sheet')).toBeVisible();
    await sender.getByTestId('picker-device-acceptance-media').click();
    await sender.getByTestId('picker-submit').click();
    await expect(searchMode.getByTestId('destination-line-name')).toHaveText('Acceptance receiver');
    searchInput = sender.getByTestId('search-mode-input');
    result = sender.getByTestId(`search-mode-result-${media.contentId}`);
  } else {
    await expect(sender.getByTestId('cast-target-chip')).toBeVisible({ timeout: 30000 });
    await sender.getByTestId('cast-target-chip').click();
    await expect(sender.getByTestId('cast-target-checkbox-acceptance-media')).toBeVisible();
    await sender.getByTestId('cast-mode-fork').check();
    await sender.getByTestId('cast-target-checkbox-acceptance-media').check();
    await sender.getByTestId('cast-target-chip').click();
    await expect(sender.getByTestId('cast-popover')).toBeHidden();
    searchInput = sender.getByRole('textbox', { name: 'Search media…' });
    result = sender.getByTestId(`combobox-option-${media.contentId}`);
  }

  await searchInput.fill(media.query);
  await expect(result).toBeVisible({ timeout: 30000 });
  await result.click();
  await expect.poll(() => loads.length, { timeout: 10000 }).toBe(1);
  const { searchModeDismissed = false } = await afterDispatch();

  const surface = receiver.locator(media.surfaceSelector);
  const native = receiver.locator(media.nativeSelector);
  await expect(surface).toBeVisible({ timeout: 60000 });
  await expect(native).toHaveCount(1);
  await expect.poll(() => native.evaluate(element => element.readyState >= 2
    && !element.paused && element.currentTime > 0), { timeout: 30000 }).toBe(true);
  const startupNativeTime = await native.evaluate(element => element.currentTime);
  await expect.poll(async () => (await readReceiverState(sender))?.snapshot?.currentItem?.contentId)
    .toBe(media.contentId);
  await expect.poll(async () => {
    const nativeState = await native.evaluate(element => ({ paused: element.paused, currentTime: element.currentTime }));
    const receiverState = await readReceiverState(sender);
    return {
      nativePaused: nativeState.paused,
      nativeTime: nativeState.currentTime,
      nativeAdvancing: !nativeState.paused && nativeState.currentTime > startupNativeTime + 1,
      receiverState: receiverState?.snapshot?.state ?? null,
      receiverPosition: receiverState?.snapshot?.position ?? null,
    };
  }, { timeout: 30000 }).toMatchObject({
    nativePaused: false,
    nativeAdvancing: true,
    receiverState: 'playing',
  });
  if (mobile && !searchModeDismissed) {
    // SearchMode intentionally remains open after a Play action. Dismiss it
    // through its visible close control before navigating to phone Devices.
    // Default callers must exercise this visible cleanup. A callback may skip
    // it only after it has explicitly dismissed SearchMode itself.
    await expect(sender.getByTestId('search-mode')).toBeVisible();
    await sender.getByTestId('search-mode-close').click();
    await expect(sender.getByTestId('search-mode')).toBeHidden();
  }
  return { receiver, video: native, native, loads };
}

async function openPeekControls(sender, navTestId = 'app-nav-fleet') {
  // Open the real device-control surface; every transport call below comes
  // from its visible controls, never from a direct API request in the test.
  await sender.getByTestId(navTestId).click();
  await expect(sender.getByTestId('fleet-peek-acceptance-media')).toBeVisible({ timeout: 30000 });
  await sender.getByTestId('fleet-peek-acceptance-media').click();
  await expect(sender.getByTestId('peek-panel')).toBeVisible();
  return sender.getByTestId('np-toggle');
}

async function runPausedControlsJourney(context, sender, navTestId, mobile = false, media = ARRIVAL_VIDEO) {
  test.setTimeout(150000);
  const { receiver, native, loads } = await startArrivalJourney(context, sender, { mobile, media });
  const toggle = await openPeekControls(sender, navTestId);
  await expect(toggle).toHaveAttribute('aria-label', 'Pause');
  await expect(toggle).toBeEnabled();

  const pauseRequest = sender.waitForRequest(request => request.method() === 'POST'
    && new URL(request.url()).pathname.endsWith('/api/v1/device/acceptance-media/session/transport')
    && request.postDataJSON()?.action === 'pause', { timeout: 15000 });
  const pauseStartedAt = Date.now();
  await toggle.click();
  // Within two seconds either the receiver's changed state is visible, or the
  // existing pending overlay honestly names that it is still awaiting proof.
  await expect.poll(async () => {
    const state = (await readReceiverState(sender))?.snapshot?.state ?? null;
    const status = sender.getByTestId('peek-panel').locator('.peek-status');
    const pending = await status.getAttribute('data-pending');
    return await status.isVisible() && (pending === 'true'
      || (state === 'paused' && /Paused/.test(await status.innerText())));
  }, { timeout: 2000, intervals: [50] }).toBe(true);
  expect(Date.now() - pauseStartedAt).toBeLessThanOrEqual(2000);
  const pause = await pauseRequest;
  expect(pause.postDataJSON().commandId).toBeTruthy();
  const pauseResponse = await pause.response();
  expect(pauseResponse?.status()).toBe(200);
  expect(await pauseResponse.json()).toMatchObject({ ok: true, commandId: pause.postDataJSON().commandId });
  await expect.poll(async () => (await readReceiverState(sender))?.snapshot?.state, { timeout: 15000 })
    .toBe('paused');
  await expect.poll(() => native.evaluate(element => element.paused), { timeout: 15000 }).toBe(true);

  const slider = sender.getByRole('slider', { name: 'Seek', exact: true });
  await expect(slider).toBeVisible();
  const fixedPausedPosition = await native.evaluate(element => element.currentTime);
  const backTen = sender.getByTestId('np-rew');
  await expect(backTen).toBeEnabled();
  const forward = await issueThroughControl(sender, 'seekRel', () => sender.getByTestId('np-ffw').click());
  expect(forward.value).toBe(10);
  await expectSeekState(native, slider, fixedPausedPosition + 10, true);

  const backward = await issueThroughControl(sender, 'seekRel', () => backTen.click());
  expect(backward.value).toBe(-10);
  await expectSeekState(native, slider, fixedPausedPosition, true);

  await expect(slider).not.toHaveAttribute('aria-disabled', 'true');
  const absoluteFraction = 0.35;
  const sliderDuration = Number(await slider.getAttribute('aria-valuemax'));
  // These are causal-distance checks, not movie-length requirements: keep a
  // substantial fraction for the two deliberately distinct targets, and a
  // smaller but still observable distance from the original paused position.
  const farSeekDistance = Math.min(60, sliderDuration * 0.15);
  const postDragMovementDistance = Math.min(60, sliderDuration * 0.05);
  const absoluteTarget = Math.round(sliderDuration * absoluteFraction);
  expect(Math.abs(absoluteTarget - fixedPausedPosition)).toBeGreaterThan(farSeekDistance);
  const absoluteBounds = await slider.boundingBox();
  expect(absoluteBounds).not.toBeNull();
  const absolute = await issueThroughControl(sender, 'seekAbs', () => slider.click({
    position: { x: absoluteBounds.width * absoluteFraction, y: absoluteBounds.height / 2 },
  }));
  expect(Math.abs(absolute.value - absoluteTarget)).toBeLessThanOrEqual(1);
  expect(absolute.value).toBeGreaterThan(fixedPausedPosition + farSeekDistance);
  await expectSeekState(native, slider, absolute.value, true);

  const sliderBounds = await slider.boundingBox();
  expect(sliderBounds).not.toBeNull();
  const dragFraction = 0.12;
  const dragTarget = Math.round(sliderDuration * dragFraction);
  expect(Math.abs(dragTarget - absolute.value)).toBeGreaterThan(farSeekDistance);
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
  expect(Math.abs(drag.value - fixedPausedPosition)).toBeGreaterThan(postDragMovementDistance);
  await expectSeekState(native, slider, drag.value, true);

  const beforeResumeTime = await native.evaluate(element => element.currentTime);
  await expect(toggle).toHaveAttribute('aria-label', 'Play');
  await issueThroughControl(sender, 'play', () => toggle.click());
  await expect.poll(async () => {
    const receiverState = await readReceiverState(sender);
    const nativeState = await native.evaluate(element => ({
      paused: element.paused,
      currentTime: element.currentTime,
      seeking: element.seeking,
      readyState: element.readyState,
    }));
    return {
      receiverState: receiverState?.snapshot?.state ?? null,
      receiverPosition: receiverState?.snapshot?.position ?? null,
      nativePaused: nativeState.paused,
      nativeTime: nativeState.currentTime,
      nativeSeeking: nativeState.seeking,
      nativeReadyState: nativeState.readyState,
    };
  }, { timeout: 15000 }).toMatchObject({
    receiverState: 'playing',
    nativePaused: false,
  });
  await expect.poll(() => native.evaluate((element, time) => !element.paused
    && element.currentTime > time + 1, beforeResumeTime), { timeout: 15000 }).toBe(true);

  expect(loads).toHaveLength(1);
  await receiver.close();
}

async function runSteerConfirmationJourney(context, sender, {
  mobile = false,
  navTestId = 'app-nav-fleet',
  homeTestId = 'app-nav-home',
} = {}) {
  test.setTimeout(150000);
  const changeAimToThisDevice = async () => {
    if (mobile) {
      const searchMode = sender.getByTestId('search-mode');
      await searchMode.getByTestId('destination-line').click();
      await expect(sender.getByTestId('destination-sheet')).toBeVisible();
      await sender.getByTestId('picker-this-device').click();
      await expect(searchMode.getByTestId('destination-line-name')).toHaveText('This device');
      return;
    }
    await sender.getByTestId('cast-target-chip').click();
    const acceptanceTarget = sender.getByTestId('cast-target-checkbox-acceptance-media');
    await expect(acceptanceTarget).toBeChecked();
    await acceptanceTarget.uncheck();
    await expect(acceptanceTarget).not.toBeChecked();
    await sender.getByTestId('cast-target-chip').click();
    await expect(sender.getByTestId('cast-popover')).toBeHidden();
  };
  const { receiver, native } = await startArrivalJourney(context, sender, {
    mobile,
    afterDispatch: async () => {
      await changeAimToThisDevice();
      if (mobile) {
        await sender.getByTestId('search-mode-close').click();
        await expect(sender.getByTestId('search-mode')).toBeHidden();
      }
      const steer = sender.getByRole('button', { name: 'Steer it', exact: true });
      await expect(steer).toBeVisible();
      await steer.click();
      await expect(sender.getByTestId('peek-panel')).toBeVisible();
      await expect(sender.getByTestId('peek-panel').getByRole('heading', { name: 'Acceptance receiver' })).toBeVisible();
      return { searchModeDismissed: mobile };
    },
  });
  await expect(sender.locator('[data-testid^="dispatch-remote-"]')).toHaveCount(0);
  const confirmationToggle = sender.getByTestId('np-toggle');
  await expect(confirmationToggle).toHaveAttribute('aria-label', 'Pause');
  await issueThroughControl(sender, 'pause', () => confirmationToggle.click());
  await expect.poll(() => native.evaluate(element => element.paused)).toBe(true);
  await expect(confirmationToggle).toHaveAttribute('aria-label', 'Play');
  await expect.poll(async () => (await readReceiverState(sender))?.snapshot?.state, { timeout: 15000 })
    .toBe('paused');
  await sender.getByTestId(homeTestId).click();
  const toggle = await openPeekControls(sender, navTestId);
  await expect(toggle).toHaveAttribute('aria-label', 'Play');
  await issueThroughControl(sender, 'play', () => toggle.click());
  await expect.poll(() => native.evaluate(element => !element.paused)).toBe(true);
  await expect(toggle).toHaveAttribute('aria-label', 'Pause');
  await receiver.close();
}

test('STEER.1c confirmation and later Devices reach the same receiver', async ({ context, page: sender }) => {
  await runSteerConfirmationJourney(context, sender);
});

test('Peek Pause, Resume, and Seek control the actual receiver video while paused', async ({ context, page: sender }) => {
  await runPausedControlsJourney(context, sender, 'app-nav-fleet');
});

test('Peek Pause, Resume, and Seek control the actual Faith audio while paused', async ({ context, page: sender }) => {
  await runPausedControlsJourney(context, sender, 'app-nav-fleet', false, FAITH_AUDIO);
});

for (const { label, viewport, navTestId, mobile } of [
  { label: 'phone', viewport: { width: 390, height: 844 }, navTestId: 'app-tab-fleet', mobile: true },
  { label: 'tablet', viewport: { width: 820, height: 1180 }, navTestId: 'app-nav-fleet', mobile: false },
]) {
  test.describe(label, () => {
    test.use({ viewport });
    test('Pause/Resume/Seek control the actual receiver video while paused', async ({ context, page: sender }) => {
      await runPausedControlsJourney(context, sender, navTestId, mobile);
    });

    test('Pause/Resume/Seek control the actual Faith audio while paused', async ({ context, page: sender }) => {
      await runPausedControlsJourney(context, sender, navTestId, mobile, FAITH_AUDIO);
    });

    test('STEER.1c confirmation and later Devices reach the same receiver', async ({ context, page: sender }) => {
      await runSteerConfirmationJourney(context, sender, {
        mobile,
        navTestId,
        homeTestId: mobile ? 'app-tab-home' : 'app-nav-home',
      });
    });
  });
}

test('Peek Next and Previous advance the real ordinary receiver queue', async ({ context, page: sender }) => {
  test.setTimeout(150000);
  const { receiver, native } = await startArrivalJourney(context, sender);
  const search = sender.getByRole('textbox', { name: 'Search media…' });
  await search.fill('disclosure day');
  const more = sender.getByTestId('result-more-plex:697368');
  await expect(more).toBeVisible({ timeout: 30000 });
  await more.click();
  const add = sender.getByTestId('result-action-add-plex:697368');
  await expect(add).toBeVisible({ timeout: 30000 });
  await add.click();
  await expect.poll(async () => {
    const state = await readReceiverState(sender);
    return state?.snapshot?.currentItem?.contentId === ARRIVAL_VIDEO.contentId
      && state.snapshot.queue?.currentIndex === 0
      && state.snapshot.queue?.items?.some(item => item.contentId === 'plex:697368');
  }, { timeout: 30000 }).toBe(true);
  const toggle = await openPeekControls(sender);
  const panel = sender.getByTestId('peek-panel');
  const next = sender.getByTestId('np-next');
  const previous = sender.getByTestId('np-prev');
  await expect(next).toBeEnabled();
  await expect(previous).toBeDisabled();

  const beforeNext = await readReceiverState(sender);
  const queueBeforeNext = beforeNext.snapshot.queue.items.map(item => item.queueItemId);
  const beforeNextOwner = beforeNext.snapshot.meta.playbackOwner;
  const beforeNextNative = await native.evaluate(element => ({
    source: element.currentSrc || element.src,
    duration: element.duration,
    currentTime: element.currentTime,
  }));
  const nextCommand = await issueThroughControl(sender, 'skipNext', () => next.click());
  expect(nextCommand.value).toBeUndefined();
  await expect.poll(async () => {
    const state = await readReceiverState(sender);
    const owner = state?.snapshot?.meta?.playbackOwner;
    const nativeState = await native.evaluate(element => ({
      source: element.currentSrc || element.src,
      duration: element.duration,
      paused: element.paused,
      currentTime: element.currentTime,
      readyState: element.readyState,
    }));
    return state?.snapshot?.currentItem?.contentId === 'plex:697368'
      && state.snapshot.queue?.currentIndex === 1
      && state.snapshot.queue?.items?.map(item => item.queueItemId).join(',') === queueBeforeNext.join(',')
      && owner?.ownerInstanceId === beforeNextOwner.ownerInstanceId
      && owner?.playbackRevision > beforeNextOwner.playbackRevision
      && (nativeState.source !== beforeNextNative.source || nativeState.duration !== beforeNextNative.duration)
      && nativeState.readyState >= 2
      && !nativeState.paused;
  }, { timeout: 30000 }).toBe(true);
  const nextNativeBaseline = await native.evaluate(element => element.currentTime);
  await expect.poll(() => native.evaluate((element, baseline) => !element.paused
    && element.currentTime > baseline + 1, nextNativeBaseline), { timeout: 30000 }).toBe(true);
  await expect(panel).toContainText('Disclosure');
  await expect(previous).toBeEnabled();
  await expect(next).toBeDisabled();

  const beforePrevious = await readReceiverState(sender);
  const beforePreviousOwner = beforePrevious.snapshot.meta.playbackOwner;
  const beforePreviousNative = await native.evaluate(element => ({
    source: element.currentSrc || element.src,
    duration: element.duration,
    currentTime: element.currentTime,
  }));
  const previousCommand = await issueThroughControl(sender, 'skipPrev', () => previous.click());
  expect(previousCommand.value).toBeUndefined();
  await expect.poll(async () => {
    const state = await readReceiverState(sender);
    const owner = state?.snapshot?.meta?.playbackOwner;
    const nativeState = await native.evaluate(element => ({
      source: element.currentSrc || element.src,
      duration: element.duration,
      paused: element.paused,
      currentTime: element.currentTime,
      readyState: element.readyState,
    }));
    return state?.snapshot?.currentItem?.contentId === ARRIVAL_VIDEO.contentId
      && state.snapshot.queue?.currentIndex === 0
      && state.snapshot.queue?.items?.map(item => item.queueItemId).join(',') === queueBeforeNext.join(',')
      && owner?.ownerInstanceId === beforePreviousOwner.ownerInstanceId
      && owner?.playbackRevision > beforePreviousOwner.playbackRevision
      && (nativeState.source !== beforePreviousNative.source || nativeState.duration !== beforePreviousNative.duration)
      && nativeState.readyState >= 2
      && !nativeState.paused;
  }, { timeout: 30000 }).toBe(true);
  const previousNativeBaseline = await native.evaluate(element => element.currentTime);
  await expect.poll(() => native.evaluate((element, baseline) => !element.paused
    && element.currentTime > baseline + 1, previousNativeBaseline), { timeout: 30000 }).toBe(true);
  await expect(panel).toContainText(/Arrival/i);
  await expect(toggle).toHaveAttribute('aria-label', 'Pause');
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  await receiver.close();
});

test('[STEER.3a/AC4] disconnected virtual receiver becomes unavailable and reconnect does not replay a command', async ({ context, page: sender }) => {
  // The fixture deliberately uses production-like 60 s state liveness. Do not
  // replace it with a fabricated offline event: this waits for the actual
  // receiver connection to stop publishing and the real liveness expiry.
  test.setTimeout(180000);
  const { receiver } = await startArrivalJourney(context, sender);
  await openPeekControls(sender);
  const transportPosts = [];
  sender.on('request', request => {
    if (request.method() === 'POST'
      && new URL(request.url()).pathname.endsWith('/api/v1/device/acceptance-media/session/transport')) {
      transportPosts.push(request.postDataJSON());
    }
  });

  await receiver.close();
  await expect(sender.getByText('Offline', { exact: true })).toBeVisible({ timeout: 75000 });
  const toggle = sender.getByTestId('np-toggle');
  await expect(toggle).toBeDisabled();
  await expect(sender.getByText('This device is offline', { exact: true })).toBeVisible();
  const disabledBox = await toggle.boundingBox();
  expect(disabledBox, 'the unavailable control remains visibly targetable').not.toBeNull();
  await sender.mouse.click(disabledBox.x + disabledBox.width / 2, disabledBox.y + disabledBox.height / 2);
  const observationStart = Date.now();
  await expect.poll(() => Date.now() - observationStart >= 5000 && transportPosts.length === 0,
    { timeout: 7000 }).toBe(true);

  // Reconnect the real receiver page; a command that was never sent while
  // offline must not be deferred or replayed. This intentionally does not
  // infer any assertion from the newly mounted receiver's initial native state.
  const reconnectedReceiver = await context.newPage();
  await reconnectedReceiver.goto('/screen/living-room', { waitUntil: 'domcontentloaded' });
  await expect.poll(async () => (await readReceiverState(sender))?.online === true,
    { timeout: 30000 }).toBe(true);
  const reconnectObservationStart = Date.now();
  await expect.poll(() => Date.now() - reconnectObservationStart >= 5000 && transportPosts.length === 0,
    { timeout: 7000 }).toBe(true);
  await reconnectedReceiver.close();
});

test('Peek Stop retains the receiver queue and Play resumes the stopped item', async ({ context, page: sender }) => {
  test.setTimeout(150000);
  const { receiver, video, loads } = await startArrivalJourney(context, sender);
  const toggle = await openPeekControls(sender);

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
  await expect(queueKept.getByText(
    `Queue kept: ${queueBeforeStop.length} item${queueBeforeStop.length === 1 ? '' : 's'}`,
    { exact: true },
  )).toBeVisible();
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

  const stoppedNativeTime = await videoHandle.evaluate(element => element.currentTime);
  await expect(toggle).toHaveAttribute('aria-label', 'Play');
  await issueThroughControl(sender, 'play', () => toggle.click());
  await expect.poll(async () => {
    const state = await readReceiverState(sender);
    return state?.snapshot?.state === 'playing'
      && state.snapshot.currentItem?.contentId === beforeStop.snapshot.currentItem.contentId;
  }, { timeout: 20000 }).toBe(true);
  await expect.poll(() => videoHandle.evaluate((element, time) => !element.paused
    && element.currentTime > time + 1, stoppedNativeTime), { timeout: 20000 }).toBe(true);
  const resumedAfterStop = await readReceiverState(sender);
  expect(resumedAfterStop.snapshot.queue.items.map(item => ({
    queueItemId: item.queueItemId,
    contentId: item.contentId,
    title: item.title ?? item.contentId,
  }))).toEqual(queueBeforeStop);
  await expect(sender.getByTestId('peek-queue-kept')).toBeHidden();

  expect(loads).toHaveLength(1);
  await receiver.close();
});
