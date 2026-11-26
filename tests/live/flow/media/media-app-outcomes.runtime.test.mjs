import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';
import { aimAt } from './lib/aim.mjs';

test.beforeEach(async ({ context }) => { await markFirstUseDone(context); });

// Requires `media-redesign-server.mjs`: its local EventBus/device composition
// is the only permitted receiver ("Acceptance receiver", a virtual browser
// screen). No route fabricates success: a failure is a real missing receiver,
// and success requires the receiver's own state and native media.
test.use({ viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' });

async function aimAtReceiver(sender) {
  await aimAt(sender, 'acceptance-media', { fork: true });
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

test('[RELY.3a][RELY.6a] a start nobody received stays starting, then may-not-have-started with its controls and Retry; Retry replays that attempt and the notice clears when the screen plays', async ({ context, page: sender }) => {
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
  // The row's ▶ is PLAY (selecting the row only opens its info view).
  await sender.getByTestId('result-play-all-plex:55854').click();
  const tappedAt = Date.now();

  // No receiver is open: the press is never shown as playing. The newest start
  // on a screen reads on that screen's handle ("▶ Arrival · Acceptance receiver").
  const handle = sender.getByTestId('screen-handle').filter({ hasText: 'Acceptance receiver' }).first();
  const state = handle.getByTestId('screen-handle-state');
  await expect(handle).toBeVisible({ timeout: 10000 });
  await expect(handle).toHaveAttribute('data-status', 'starting');
  await expect(state).toContainText('Starting on Acceptance receiver');
  // O1: inside the 10s window the start offers Undo; Stop stays offered while
  // it is unresolved, and Undo goes once the window has passed.
  await expect(handle.getByTestId('item-action-undo')).toBeVisible();
  await expect(handle.getByTestId('screen-handle-stop')).toBeVisible();
  await expect(handle.getByTestId('item-action-undo')).toHaveCount(0, { timeout: 20000 });
  expect(Date.now() - tappedAt).toBeGreaterThanOrEqual(9000);
  await expect(handle).toHaveAttribute('data-status', 'starting');

  // The screen comes up later; the earlier press must never apply on its own.
  const receiver = await context.newPage();
  await receiver.goto('/screen/living-room', { waitUntil: 'domcontentloaded' });
  await receiverReady(sender);
  await expect(state).toContainText('Acceptance receiver may not have started', { timeout: 180000 });
  await expect(handle).toHaveAttribute('data-status', 'failed');
  await expect(handle.getByTestId('screen-handle-open')).toBeVisible(); // steer it: opens that screen's controls
  await expect(handle.getByTestId('screen-handle-retry')).toBeVisible();
  await expect(sender.getByTestId('media-outcome-announcer')).toContainText('may not have started');
  expect(Date.now() - tappedAt).toBeGreaterThan(50000);
  const quiet = await receiverState(sender);
  expect(quiet?.snapshot?.currentItem?.contentId ?? null).not.toBe('plex:55854');
  await expect(receiver.locator('.video-player video')).toHaveCount(0);
  expect(loads).toHaveLength(1);
  // It stays until dismissed or until that screen reports the item playing.
  await sender.waitForTimeout(10000);
  await expect(handle).toHaveAttribute('data-status', 'failed');

  // Retry replays exactly that attempt: same item, same screen.
  await handle.getByTestId('screen-handle-retry').click();
  const native = receiver.locator('.video-player video');
  await expect(native).toBeVisible({ timeout: 60000 });
  await expect.poll(() => native.evaluate(element => element.readyState >= 2 && !element.paused && element.currentTime > 0), { timeout: 60000 }).toBe(true);
  await expect.poll(async () => (await receiverState(sender))?.snapshot?.currentItem?.contentId, { timeout: 60000 }).toBe('plex:55854');
  expect(loads).toHaveLength(2);
  expect(new URL(loads[1]).searchParams.get('play')).toBe('plex:55854');
  expect(new URL(loads[1]).searchParams.get('deferredRetry')).toBe('0');
  // The screen now reports the same item playing: the notice clears and the handle reads Playing.
  await expect(state).not.toContainText('may not have started', { timeout: 30000 });
  await expect(state).toHaveText(/^Playing/, { timeout: 60000 });
  await expect(handle.getByTestId('screen-handle-open')).toBeVisible();
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
  // The row's ▶ is PLAY (selecting the row only opens its info view).
  await sender.getByTestId('result-play-all-plex:55854').click();

  // The start's progress is the screen's handle: "Starting on Acceptance receiver…", in plain words.
  const handle = sender.getByTestId('screen-handle').filter({ hasText: 'Acceptance receiver' }).first();
  const state = handle.getByTestId('screen-handle-state');
  await expect(handle).toBeVisible({ timeout: 10000 });
  await expect(handle).toHaveAttribute('data-status', 'starting');
  await expect(handle.getByTestId('screen-handle-title')).toContainText('Arrival');
  await expect(state).toContainText('Starting on Acceptance receiver');
  for (const area of ['fleet', 'browse', 'home']) {
    await sender.getByTestId(`app-nav-${area}`).click();
    await expect(handle).toBeVisible();
  }
  release();
  await expect(state).toHaveText(/^Playing/, { timeout: 60000 });
  await expect(handle.getByTestId('screen-handle-open')).toBeVisible();
  await expect.poll(async () => (await receiverState(sender))?.snapshot?.currentItem?.contentId, { timeout: 60000 }).toBe('plex:55854');
  await receiver.close();
});
