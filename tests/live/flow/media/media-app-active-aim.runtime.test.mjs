import { test, expect } from '@playwright/test';
import { aimAt, aimLabel } from './lib/aim.mjs';
import { playResult } from './lib/search.mjs';

test.use({ viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' });
test.setTimeout(120000);

test('[PLACE.2a/AC4] sender aim is sticky: it survives two idle hours (no expiry), playing or not', async ({ context, page: sender }) => {
  const receiver = await context.newPage();
  await sender.clock.install();
  await sender.goto('/media', { waitUntil: 'domcontentloaded' });
  await receiver.goto('/screen/living-room', { waitUntil: 'domcontentloaded' });

  await expect.poll(async () => sender.evaluate(async () => {
    const response = await fetch('/api/v1/device/acceptance-media/receiver-ready');
    return response.ok && (await response.json()).ready;
  }), { timeout: 30000 }).toBe(true);

  await aimAt(sender, 'acceptance-media', { fork: true });

  const search = sender.getByRole('textbox', { name: 'Search media…' });
  await search.fill('arrival');
  await playResult(sender, sender.getByTestId('combobox-option-plex:55854'));
  const native = receiver.locator('.video-player video');
  await expect(native).toBeVisible({ timeout: 60000 });
  await expect.poll(() => native.evaluate(element => element.readyState >= 2 && element.currentTime > 0), { timeout: 30000 })
    .toBe(true);
  await expect(sender.getByTestId('dispatch-tray')).toContainText('Playing on Acceptance receiver', { timeout: 60000 });

  const readAim = () => sender.evaluate(() => ({
    now: Date.now(),
    aim: JSON.parse(localStorage.getItem('media-app.cast-target')),
  }));
  const before = await readAim();
  expect(before.aim?.targetIds).toEqual(['acceptance-media']);
  expect(await aimLabel(sender)).toBe('Acceptance receiver');
  const receiverTime = await native.evaluate(element => element.currentTime);

  const jumpedNow = before.now + (2 * 60 * 60 * 1000) + 1000;
  // This changes only sender Date; real receiver playback/heartbeats continue.
  // A reconnect during the jump is transport fallout, so require fresh positive
  // receiver proof rather than treating the jump itself as steering evidence.
  await sender.clock.setFixedTime(jumpedNow);
  await expect.poll(() => native.evaluate((element, start) => !element.paused && element.currentTime > start + 20, receiverTime), { timeout: 35000 })
    .toBe(true);

  const after = await readAim();
  expect(after.now - before.now).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000);
  // Sticky: two hours later the aim is still the screen, and the search chip still names it.
  expect(after.aim?.targetIds).toEqual(['acceptance-media']);
  await expect.poll(() => aimLabel(sender), { timeout: 30000 }).toBe('Acceptance receiver');
  await test.info().attach('active-aim-clock-evidence.json', {
    body: JSON.stringify({ before, after, receiverTime }),
    contentType: 'application/json',
  });
  await receiver.close();
});
