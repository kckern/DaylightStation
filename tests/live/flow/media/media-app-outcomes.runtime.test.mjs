import { test, expect } from '@playwright/test';

// Requires `media-redesign-server.mjs`: its local EventBus/device composition
// is the only permitted receiver ("Acceptance receiver", a virtual browser
// screen). No route fabricates success: a failure is a real missing receiver,
// and success requires the receiver's own state and native media.
test.use({ viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' });

async function aimAtReceiver(sender) {
  await expect(sender.getByTestId('cast-target-chip')).toBeVisible({ timeout: 30000 });
  await sender.getByTestId('cast-target-chip').click();
  await expect(sender.getByTestId('cast-target-checkbox-acceptance-media')).toBeVisible();
  await sender.getByTestId('cast-mode-fork').check();
  await sender.getByTestId('cast-target-checkbox-acceptance-media').check();
  await sender.getByTestId('cast-target-chip').click();
  await expect(sender.getByTestId('cast-popover')).toBeHidden();
}

async function receiverReady(sender) {
  await expect.poll(async () => sender.evaluate(async () => {
    const response = await fetch('/api/v1/device/acceptance-media/receiver-ready');
    return response.ok && (await response.json()).ready;
  }), { timeout: 30000 }).toBe(true);
}

async function receiverState(sender) {
  return sender.evaluate(async () => {
    const response = await fetch('/api/v1/device/acceptance-media/receiver-state');
    return response.ok ? response.json() : null;
  });
}

test('[RELY.3a][RELY.6a] a start nobody received stays sent, then may-not-have-started with Steer it and Try again; Try again replays that attempt and the notice clears when the screen plays', async ({ context, page: sender }) => {
  test.setTimeout(300000);
  const loads = [];
  sender.on('request', request => {
    if (request.url().includes('/api/v1/device/acceptance-media/load')) loads.push(request.url());
  });
  await sender.goto('/media', { waitUntil: 'domcontentloaded' });
  await aimAtReceiver(sender);

  const search = sender.getByRole('textbox', { name: 'Search media…' });
  await search.fill('arrival');
  const arrival = sender.getByTestId('combobox-option-plex:55854');
  await expect(arrival).toBeVisible({ timeout: 30000 });
  await arrival.click();
  const tappedAt = Date.now();

  // No receiver is open: the press is never shown as playing.
  const row = sender.locator('[data-testid^="dispatch-row-"]').filter({ hasText: 'Acceptance receiver' }).first();
  await expect(row).toBeVisible({ timeout: 10000 });
  const attemptId = (await row.getAttribute('data-testid')).replace(/^dispatch-row-/, '');
  const attempt = sender.getByTestId(`dispatch-row-${attemptId}`);
  await expect(sender.getByTestId('dispatch-tray')).not.toContainText('Playing on Acceptance receiver');
  // O1: inside the 10s window the start offers Undo; once that has passed,
  // while it is still unresolved, it offers Stop instead.
  await expect(attempt.getByTestId('item-action-undo')).toBeVisible();
  await expect(sender.getByTestId(`dispatch-stop-${attemptId}`)).toBeVisible({ timeout: 20000 });
  expect(Date.now() - tappedAt).toBeGreaterThanOrEqual(9000);
  await expect(attempt.getByTestId('item-action-undo')).toHaveCount(0);
  await expect(attempt).toHaveAttribute('data-phase', /running|sent/);

  // The screen comes up later; the earlier press must never apply on its own.
  const receiver = await context.newPage();
  await receiver.goto('/screen/living-room', { waitUntil: 'domcontentloaded' });
  await receiverReady(sender);
  await expect(attempt).toContainText('may not have started on Acceptance receiver', { timeout: 180000 });
  await expect(attempt).toHaveAttribute('data-phase', 'unconfirmed');
  await expect(attempt.getByRole('button', { name: /Steer it/ })).toBeVisible();
  await expect(attempt.getByRole('button', { name: /Try again/ })).toBeVisible();
  await expect(sender.getByTestId('media-outcome-announcer')).toContainText('may not have started');
  expect(Date.now() - tappedAt).toBeGreaterThan(50000);
  const quiet = await receiverState(sender);
  expect(quiet?.snapshot?.currentItem?.contentId ?? null).not.toBe('plex:55854');
  await expect(receiver.locator('.video-player video')).toHaveCount(0);
  expect(loads).toHaveLength(1);
  // It stays until dismissed or until that screen reports the item playing.
  await sender.waitForTimeout(10000);
  await expect(attempt).toHaveAttribute('data-phase', 'unconfirmed');

  // Try again replays exactly that attempt: same item, same screen.
  await sender.getByTestId(`dispatch-retry-${attemptId}`).click();
  const native = receiver.locator('.video-player video');
  await expect(native).toBeVisible({ timeout: 60000 });
  await expect.poll(() => native.evaluate(element => element.readyState >= 2 && !element.paused && element.currentTime > 0), { timeout: 60000 }).toBe(true);
  await expect.poll(async () => (await receiverState(sender))?.snapshot?.currentItem?.contentId, { timeout: 60000 }).toBe('plex:55854');
  expect(loads).toHaveLength(2);
  expect(new URL(loads[1]).searchParams.get('play')).toBe('plex:55854');
  expect(new URL(loads[1]).searchParams.get('deferredRetry')).toBe('0');
  // The screen now reports the same item playing: the notice clears.
  await expect(sender.getByTestId('dispatch-tray')).not.toContainText('may not have started', { timeout: 30000 });
  await expect(sender.getByTestId('dispatch-tray')).toContainText('Playing on Acceptance receiver', { timeout: 60000 });
  const confirmed = sender.locator('[data-testid^="dispatch-row-"][data-phase="confirmed"]').filter({ hasText: 'Playing on Acceptance receiver' }).first();
  await expect(confirmed.getByRole('button', { name: /Steer it/ })).toBeVisible();
  await receiver.close();
});

test('[RELY.2a] a far start shows its progress in plain words wherever the person goes until the outcome is known', async ({ context, page: sender }) => {
  test.setTimeout(120000);
  const receiver = await context.newPage();
  await sender.goto('/media', { waitUntil: 'domcontentloaded' });
  await receiver.goto('/screen/living-room', { waitUntil: 'domcontentloaded' });
  await receiverReady(sender);
  await aimAtReceiver(sender);

  let release;
  const held = new Promise(resolve => { release = resolve; });
  await sender.route('**/api/v1/device/acceptance-media/load**', async route => { await held; await route.continue(); });
  const search = sender.getByRole('textbox', { name: 'Search media…' });
  await search.fill('arrival');
  const arrival = sender.getByTestId('combobox-option-plex:55854');
  await expect(arrival).toBeVisible({ timeout: 30000 });
  await arrival.click();

  const progress = sender.locator('[data-testid^="dispatch-row-"]').filter({ hasText: 'Sending Arrival to Acceptance receiver' });
  await expect(progress).toBeVisible({ timeout: 10000 });
  await expect(progress).toHaveAttribute('data-phase', 'running');
  for (const area of ['fleet', 'browse', 'home']) {
    await sender.getByTestId(`app-nav-${area}`).click();
    await expect(progress).toBeVisible();
  }
  release();
  await expect(sender.getByTestId('dispatch-tray')).toContainText('Playing on Acceptance receiver', { timeout: 60000 });
  await expect(sender.getByTestId('dispatch-tray').getByRole('button', { name: /Steer it/ })).toBeVisible();
  await expect.poll(async () => (await receiverState(sender))?.snapshot?.currentItem?.contentId, { timeout: 60000 }).toBe('plex:55854');
  await receiver.close();
});
