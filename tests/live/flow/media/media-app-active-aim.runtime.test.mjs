import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' });
test.setTimeout(120000);

test('[PLACE.2a/AC4] sender aim survives two idle hours only while its receiver is truthfully playing', async ({ context, page: sender }) => {
  const receiver = await context.newPage();
  await sender.clock.install();
  await sender.goto('/media', { waitUntil: 'domcontentloaded' });
  await receiver.goto('/screen/living-room', { waitUntil: 'domcontentloaded' });

  await expect.poll(async () => sender.evaluate(async () => {
    const response = await fetch('/api/v1/device/acceptance-media/receiver-ready');
    return response.ok && (await response.json()).ready;
  }), { timeout: 30000 }).toBe(true);

  await sender.getByTestId('cast-target-chip').click();
  await sender.getByTestId('cast-mode-fork').check();
  await sender.getByTestId('cast-target-checkbox-acceptance-media').check();
  await sender.getByTestId('cast-target-chip').click();

  const search = sender.getByRole('textbox', { name: 'Search media…' });
  await search.fill('arrival');
  await sender.getByTestId('combobox-option-plex:55854').click();
  const native = receiver.locator('.video-player video');
  await expect(native).toBeVisible({ timeout: 60000 });
  await expect.poll(() => native.evaluate(element => element.readyState >= 2 && element.currentTime > 0), { timeout: 30000 })
    .toBe(true);
  await expect(sender.getByTestId('dispatch-tray')).toContainText('Playing on Acceptance receiver', { timeout: 60000 });

  const before = await sender.evaluate(() => ({
    now: Date.now(),
    aim: JSON.parse(localStorage.getItem('media-app.cast-target')),
  }));
  expect(before.aim?.targetIds).toEqual(['acceptance-media']);
  const receiverTime = await native.evaluate(element => element.currentTime);

  await sender.clock.setFixedTime(before.now + (2 * 60 * 60 * 1000) + 1000);
  await expect.poll(() => native.evaluate((element, start) => !element.paused && element.currentTime > start + 20, receiverTime), { timeout: 35000 })
    .toBe(true);

  const after = await sender.evaluate(() => ({
    now: Date.now(),
    aim: JSON.parse(localStorage.getItem('media-app.cast-target')),
  }));
  expect(after.now - before.now).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000);
  expect(after.aim?.targetIds).toEqual(['acceptance-media']);
  await sender.getByTestId('cast-target-chip').click();
  await expect(sender.getByTestId('cast-target-checkbox-acceptance-media')).toBeChecked();
  await sender.getByTestId('cast-target-chip').click();
  await test.info().attach('active-aim-clock-evidence.json', {
    body: JSON.stringify({ before, after, receiverTime }),
    contentType: 'application/json',
  });
  await receiver.close();
});
