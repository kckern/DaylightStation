import { test, expect } from '@playwright/test';

test.use({ trace: 'retain-on-failure' });

const sizes = [
  ['phone', { width: 390, height: 844 }, true],
  ['tablet', { width: 820, height: 1180 }, false],
  ['laptop', { width: 1440, height: 900 }, false],
];

const views = [
  ['home', ''], ['browse', '?view=browse'], ['detail', '?view=detail&contentId=plex%3A55854'],
  ['nowPlaying', '?view=nowPlaying'], ['fleet', '?view=fleet'], ['peek', '?view=peek&deviceId=acceptance-media'],
];

async function receiverState(page) {
  return page.evaluate(async () => (await fetch('/api/v1/device/acceptance-media/receiver-state')).json());
}

async function startArrival(context, sender, phone) {
  const receiver = await context.newPage();
  await sender.goto('/media', { waitUntil: 'domcontentloaded' });
  await receiver.goto('/screen/living-room', { waitUntil: 'domcontentloaded' });
  await expect.poll(async () => sender.evaluate(async () => {
    const response = await fetch('/api/v1/device/acceptance-media/receiver-ready');
    return response.ok && (await response.json()).ready;
  }), { timeout: 30000 }).toBe(true);

  let input;
  let result;
  if (phone) {
    await sender.getByTestId('media-search-launcher').click();
    const searchMode = sender.getByTestId('search-mode');
    await searchMode.getByTestId('destination-line').click();
    await sender.getByTestId('picker-device-acceptance-media').click();
    await sender.getByTestId('picker-submit').click();
    await expect(searchMode.getByTestId('destination-line-name')).toHaveText('Acceptance receiver');
    input = searchMode.getByTestId('search-mode-input');
    result = searchMode.getByTestId('search-mode-result-plex:55854');
  } else {
    await sender.getByTestId('cast-target-chip').click();
    await sender.getByTestId('cast-mode-fork').check();
    await sender.getByTestId('cast-target-checkbox-acceptance-media').check();
    await sender.getByTestId('cast-target-chip').click();
    input = sender.getByRole('textbox', { name: 'Search media…' });
    result = sender.getByTestId('combobox-option-plex:55854');
  }
  await input.fill('arrival');
  await expect(result).toBeVisible({ timeout: 30000 });
  await result.click();
  const native = receiver.locator('.video-player video');
  await expect(native).toHaveCount(1);
  await expect.poll(() => native.evaluate(element => element.readyState >= 2 && !element.paused && element.currentTime > 0),
    { timeout: 30000 }).toBe(true);
  await expect.poll(async () => (await receiverState(sender))?.snapshot?.state, { timeout: 30000 }).toBe('playing');
  if (phone) await sender.getByTestId('search-mode-close').click();
  return { receiver, native };
}

async function pauseThroughPeek(sender, native, phone) {
  await sender.getByTestId(phone ? 'app-tab-fleet' : 'app-nav-fleet').click();
  await sender.getByTestId('fleet-peek-acceptance-media').click();
  const toggle = sender.getByTestId('np-toggle');
  await expect(toggle).toHaveAttribute('aria-label', 'Pause');
  const request = sender.waitForRequest(r => r.method() === 'POST'
    && new URL(r.url()).pathname.endsWith('/api/v1/device/acceptance-media/session/transport')
    && r.postDataJSON()?.action === 'pause');
  await toggle.click();
  const pause = await request;
  expect((await pause.response())?.status()).toBe(200);
  await expect.poll(async () => (await receiverState(sender))?.snapshot?.state, { timeout: 15000 }).toBe('paused');
  await expect.poll(() => native.evaluate(element => element.paused), { timeout: 15000 }).toBe(true);
}

for (const [label, viewport, phone] of sizes) {
  test.describe(`HOUSE.1a ${label}`, () => {
    test.use({ viewport });

    test('one truthful shared indicator opens Fleet from every Canvas view', async ({ context, page }) => {
      test.setTimeout(150000);
      const { receiver, native } = await startArrival(context, page, phone);
      await expect(page.getByTestId('house-indicator')).toHaveAccessibleName('1 playing');
      await pauseThroughPeek(page, native, phone);
      await expect(page.getByTestId('house-indicator')).toHaveAccessibleName('0 playing · 1 paused');

      for (const [, query] of views) {
        await page.goto(`/media${query}`, { waitUntil: 'domcontentloaded' });
        const indicator = page.getByTestId('house-indicator');
        await expect(indicator).toHaveCount(1);
        await expect(indicator).toBeVisible();
        await expect(indicator).toHaveAccessibleName('0 playing · 1 paused');
        await indicator.click();
        await expect(page.getByTestId('fleet-view')).toBeVisible();
      }
      await receiver.close();
    });
  });
}
