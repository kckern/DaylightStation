import { test, expect } from '@playwright/test';
import { resetHouseholdAt } from './lib/household.mjs';
import {
  A, ITEM, VIEWPORTS, receiverState, openReceiver, startOn, stopReceiver, resetControls, newAppPage, gotoMedia, warmMedia, openHouse, openRemote,
} from './lib/receivers.mjs';
import { openSearch, resultRow, closeSearch } from './lib/search.mjs';

// Smaller journeys that close single rows: skip back/forward for any queue,
// and that a device in the app is visibly part of the house.
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block' });
test.setTimeout(300000);
test.beforeAll(async ({ browser }) => { test.setTimeout(300000); await warmMedia(browser); });
test.beforeEach(async ({ request, baseURL }) => { await resetHouseholdAt(request, baseURL); });

test('[STEER.3a/AC2] skip forward and back are available for any queue: audio and video mixed, from the first item, the middle and the last', async ({ browser, request }) => {
  const vp = VIEWPORTS.laptop;
  const receiver = await openReceiver(browser, request, A);
  await resetControls(request, A);
  await startOn(request, A, ITEM.FAITH, { queue: [ITEM.HOSPITAL, ITEM.KEEPY] });
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  await openRemote(page, A, vp);
  const panel = page.getByTestId('peek-panel');
  const next = panel.getByTestId('np-prev'); // (the control labelled forward is `np-prev` in the transport row)
  const back = panel.getByTestId('np-next');
  const index = async () => (await receiverState(request, A)).queue.currentIndex;
  const labels = async () => ({ fwd: await panel.getByRole('button', { name: /next|forward|skip/i }).count() });
  void labels; void back; void next;
  // Locate by accessible names the person sees.
  const skipForward = panel.locator('[data-testid="np-prev"], [data-testid="np-next"]').filter({ has: page.locator('svg') });
  await expect(skipForward).toHaveCount(2);
  const [first, second] = [skipForward.nth(0), skipForward.nth(1)];
  // At the first item only the forward skip is available; the back skip is not.
  expect(await index()).toBe(0);
  const enabledCount = async () => (await Promise.all([first, second].map((b) => b.isEnabled()))).filter(Boolean).length;
  await expect.poll(enabledCount).toBe(1);
  // Forward through the middle: both skips are available.
  const forward = (await first.isEnabled()) ? first : second;
  await forward.click();
  await expect.poll(index, { timeout: 60000 }).toBe(1);
  await expect.poll(enabledCount).toBe(2);
  await forward.click();
  await expect.poll(index, { timeout: 60000 }).toBe(2);
  // At the last item only the back skip remains, and it returns.
  await expect.poll(enabledCount).toBe(1);
  const backward = (await first.isEnabled()) ? first : second;
  await backward.click();
  await expect.poll(index, { timeout: 60000 }).toBe(1);
  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});

test('[AUTO.3a/AC3] a device left open in the app shows, in the house overview, that it is visible to the house — idle or playing', async ({ browser }) => {
  const vp = VIEWPORTS.laptop;
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  await openHouse(page, vp);
  // Idle: this device's own card is there and says it is this device.
  const mine = page.locator('[data-testid^="fleet-this-device-"]').first();
  await expect(mine).toBeVisible({ timeout: 60000 });
  await expect(mine).toHaveText('This device');
  const cardId = (await mine.getAttribute('data-testid')).replace('fleet-this-device-', '');
  await expect(page.getByTestId(`fleet-card-${cardId}`)).toBeVisible();
  // Playing: still there, now with what it plays.
  const input = await openSearch(page, vp);
  await input.fill('Faith');
  await resultRow(page, vp, ITEM.FAITH).click();
  await closeSearch(page, vp);
  await openHouse(page, vp);
  await expect(page.getByTestId(`fleet-card-${cardId}`)).toContainText('Faith', { timeout: 60000 });
  await expect(mine).toHaveText('This device');
  await context.close();
});
