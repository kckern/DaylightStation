import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure', actionTimeout: 10000 });
test.setTimeout(90000);

const ARRIVAL = 'Arrival';

async function guardDeviceMutations(page) {
  const attempts = [];
  await page.route('**/api/v1/device/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const isLoadOrClaim = /\/api\/v1\/device\/[^/]+\/(?:load|session\/claim)$/.test(path);
    if (isLoadOrClaim || request.method() !== 'GET') {
      attempts.push({ method: request.method(), path });
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  return attempts;
}

async function findArrivalOption(page) {
  // ContentCombobox exposes the real desktop TextInput through its placeholder
  // aria label. There is no source-owned `media-search-input` test id on that
  // input, so use the established journey locator rather than a stale alias.
  const search = page.getByRole('textbox', { name: 'Search media…' });
  await expect(search).toBeVisible({ timeout: 30000 });
  await search.fill(ARRIVAL);
  // Arrival also has non-movie catalog matches; this safety path must select
  // the movie deterministically before it opens Detail's CastButton.
  const option = page.getByRole('option')
    .filter({ hasText: ARRIVAL })
    .filter({ hasText: 'Movie' });
  await expect(option).toHaveCount(1, { timeout: 15000 });
  const testId = await option.getAttribute('data-testid');
  const contentId = testId?.replace(/^combobox-option-/, '');
  expect(contentId, 'Arrival option must expose its real content id').toBeTruthy();
  return { option, contentId };
}

async function selectFirstDevice(picker) {
  const device = picker.locator('[data-testid^="picker-device-"]').first();
  await expect(device).toBeVisible();
  await device.click();
}

// A plain Play from a result has no session to move: Move and the Move/Keep group
// are not offered at all, and the tile tap itself sends it (NF-TAP-10). The guard
// aborts the device call, so the proof is the single blocked load attempt.
async function expectNoMoveAndTapSends(picker, deviceAttempts) {
  await expect(picker.getByTestId('picker-mode-transfer')).toHaveCount(0);
  await expect(picker.getByTestId('picker-mode-fork')).toHaveCount(0);
  await expect(picker.getByTestId('picker-move-unavailable')).toHaveCount(0);
  await selectFirstDevice(picker);
  await expect.poll(() => deviceAttempts.length, { timeout: 15000 }).toBeGreaterThan(0);
}

test.describe('Media M0 Move safety', () => {
  test.afterEach(async ({ page }) => {
    // A failed assertion must not leave this test's local session playing.
    // Close a live result list first, then use the established ordinary UI
    // Stop path; never manipulate controller/store state directly.
    if (page.isClosed()) return;
    if (await page.getByRole('listbox').isVisible().catch(() => false)) await page.keyboard.press('Escape');
    const expandedStop = page.getByTestId('np-stop');
    const stop = await expandedStop.isVisible().catch(() => false)
      ? expandedStop
      : page.getByTestId('mini-stop');
    if (await stop.isVisible().catch(() => false)) await stop.click();
  });

  test('idle Arrival offers no Move, and the tile tap sends it (device call guarded)', async ({ page }) => {
    const deviceAttempts = await guardDeviceMutations(page);
    await page.goto('/media');

    // Desktop Media's result path is search → ⋯ → Play on… (Detail no longer carries a Cast button).
    const { contentId } = await findArrivalOption(page);
    await page.getByTestId(`result-more-${contentId}`).click();
    await expect(page.getByTestId(`result-more-menu-${contentId}`)).toBeVisible();
    await page.getByRole('menuitem', { name: 'Play on…' }).click();

    const picker = page.getByTestId('dispatch-target-picker');
    await expect(picker).toBeVisible();
    await expectNoMoveAndTapSends(picker, deviceAttempts);

    // The guard blocked the load the tap issued; nothing reached a device and
    // no claim/stop was attempted.
    expect(deviceAttempts.filter((a) => !/\/load$/.test(a.path)), 'only the Keep load may be attempted').toEqual([]);
  });

  test('current Arrival keeps its native node and time through handoff picker cancellation, then stops locally', async ({ page }) => {
    const deviceAttempts = await guardDeviceMutations(page);
    await page.goto('/media');

    const { option } = await findArrivalOption(page);
    await option.click();
    await expect(page.getByTestId('mini-player-open-nowplaying')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('mini-player-open-nowplaying').click();
    await expect(page.getByTestId('now-playing-view')).toBeVisible();

    const media = page.getByTestId('now-playing-host').locator('video');
    await expect(media).toHaveCount(1, { timeout: 30000 });
    await expect.poll(
      () => media.evaluate((node) => !node.paused && node.readyState >= 2 && node.currentTime > 0),
      { timeout: 30000, message: 'Arrival must be locally playing before inspecting its handoff picker' },
    ).toBe(true);
    const initialTime = await media.evaluate((node) => node.currentTime);
    await expect.poll(
      () => media.evaluate((node) => node.currentTime),
      { timeout: 10000, message: 'Arrival must advance before opening the handoff picker' },
    ).toBeGreaterThan(initialTime + 0.25);
    const nativeNode = await media.elementHandle();
    expect(nativeNode, 'a real media element is required for continuity proof').toBeTruthy();
    const timeBeforePicker = await media.evaluate((node) => node.currentTime);

    const handoffPicker = page.getByTestId('handoff-section').getByTestId('dispatch-target-picker');
    await expect(handoffPicker).toBeVisible();
    await selectFirstDevice(handoffPicker);
    await expect(handoffPicker.getByTestId('picker-mode-transfer')).toBeEnabled();
    await expect(handoffPicker.getByTestId('picker-mode-fork')).toHaveText(/Keep playing here too/i);
    await handoffPicker.getByTestId('picker-submit').click();
    await expect(handoffPicker.getByTestId('picker-dispatch-failed'))
      .toHaveText(/Playback here was kept/i);

    // The blocked destination request is uncertain, never source-stop proof.
    // The same native node must remain alive and continue advancing.
    const sameNativeNode = await page.evaluate(
      (original) => original.isConnected && [...document.querySelectorAll('video')].includes(original),
      nativeNode,
    );
    expect(sameNativeNode).toBe(true);
    await expect.poll(
      () => nativeNode.evaluate((node) => node.currentTime),
      { timeout: 10000, message: 'an uncertain destination must not reset, pause, or stop Arrival' },
    ).toBeGreaterThan(timeBeforePicker + 0.25);
    expect(deviceAttempts.some(({ path }) => /\/session\/handoff$/.test(path))).toBe(true);

    // Stop intentionally retains the queue. Assert the existing contract:
    // native media is paused/ended and the retained queue remains reachable.
    await page.getByTestId('np-stop').click();
    await expect.poll(() => page.locator('video, audio')
      .evaluateAll((nodes) => nodes.every((node) => node.paused || node.ended))).toBe(true);
    await expect(page.getByTestId('mini-player-open-nowplaying')).toBeVisible();
  });

  test('paused Arrival moves at the same paused native position before the unchanged source stops', async ({ page, context }) => {
    const receiver = await context.newPage();
    try {
      await receiver.goto('/screen/living-room', { waitUntil: 'domcontentloaded' });
      await expect.poll(async () => receiver.evaluate(async () => {
        const response = await fetch('/api/v1/device/acceptance-media/receiver-ready');
        return response.ok && (await response.json()).ready;
      }), { timeout: 30000 }).toBe(true);

      // A native move replaces an existing destination owner. Establish that
      // owner through the real ordinary-device load path rather than inventing
      // an idle handoff capability that the screen does not have.
      const seeded = await receiver.evaluate(async () => {
        const dispatchId = `paused-move-seed-${Date.now()}`;
        const response = await fetch(`/api/v1/device/acceptance-media/load?play=plex:697368&dispatchId=${dispatchId}`);
        return response.ok;
      });
      expect(seeded).toBe(true);
      const seededNative = receiver.locator('.video-player video');
      await expect(seededNative).toHaveCount(1, { timeout: 30000 });
      await expect.poll(() => seededNative.evaluate(node => !node.paused && node.readyState >= 2 && node.currentTime > 0),
        { timeout: 30000 }).toBe(true);

      await page.goto('/media');
      const { option } = await findArrivalOption(page);
      await option.click();
      await expect(page.getByTestId('mini-player-open-nowplaying')).toBeVisible({ timeout: 30000 });
      await page.getByTestId('mini-player-open-nowplaying').click();

      const sourceNative = page.getByTestId('now-playing-host').locator('video');
      await expect.poll(
        () => sourceNative.evaluate(node => !node.paused && node.readyState >= 2 && node.currentTime > 1),
        { timeout: 30000 },
      ).toBe(true);
      await page.getByTestId('np-toggle').click();
      await expect.poll(() => sourceNative.evaluate(node => node.paused && !node.seeking)).toBe(true);
      const pausedAt = await sourceNative.evaluate(node => node.currentTime);

      const picker = page.getByTestId('handoff-section').getByTestId('dispatch-target-picker');
      await picker.getByTestId('picker-device-acceptance-media').click();
      await picker.getByTestId('picker-mode-transfer').click();
      await picker.getByTestId('picker-submit').click();

      const receiverNative = receiver.locator('.video-player video');
      await expect(receiverNative).toHaveCount(1, { timeout: 30000 });
      await expect.poll(() => receiverNative.evaluate((node, expected) => {
        const delta = Math.abs(node.currentTime - expected);
        return {
          paused: node.paused,
          ready: node.readyState >= 2,
          seeking: node.seeking,
          delta,
          withinPositionTolerance: delta <= 2,
        };
      }, pausedAt), { timeout: 30000 }).toMatchObject({
        paused: true,
        ready: true,
        seeking: false,
        delta: expect.any(Number),
        withinPositionTolerance: true,
      });

      await expect(page.getByTestId('now-playing-title')).toHaveText('Nothing playing', { timeout: 30000 });
      await expect.poll(() => page.locator('video, audio')
        .evaluateAll(nodes => nodes.every(node => node.paused || node.ended))).toBe(true);
      await expect.poll(() => page.evaluate(async (expected) => {
        const response = await fetch('/api/v1/device/acceptance-media/receiver-state');
        const reported = await response.json();
        return reported.snapshot?.state === 'paused'
          && Math.abs(reported.snapshot?.position - expected) <= 2;
      }, pausedAt), { timeout: 30000 }).toBe(true);
      const reported = await page.evaluate(async () => {
        const response = await fetch('/api/v1/device/acceptance-media/receiver-state');
        return response.json();
      });
      expect(reported.snapshot?.state).toBe('paused');
      expect(Math.abs(reported.snapshot?.position - pausedAt)).toBeLessThanOrEqual(2);
    } finally {
      await receiver.close();
    }
  });
});
