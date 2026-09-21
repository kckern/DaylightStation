import { test, expect } from '@playwright/test';

test.use({ trace: 'retain-on-failure' });

test('HOUSE.2b: two browser devices agree on the local player title and state', async ({ browser }) => {
  test.setTimeout(120000);
  const senderContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const observerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await senderContext.addInitScript(() => localStorage.setItem('media-app.display-name', 'Sender browser'));
  await observerContext.addInitScript(() => localStorage.setItem('media-app.display-name', 'Observer browser'));
  const sender = await senderContext.newPage();
  const observer = await observerContext.newPage();

  try {
    await sender.goto('/media', { waitUntil: 'domcontentloaded' });
    const input = sender.getByRole('textbox', { name: 'Search media…', exact: true });
    await expect(input).toBeVisible({ timeout: 30000 });
    const senderId = await sender.evaluate(() => localStorage.getItem('media-app.client-id'));
    expect(senderId).toBeTruthy();
    const senderCard = `fleet-card-browser:${senderId}`;

    await observer.goto('/media', { waitUntil: 'domcontentloaded' });
    await input.fill('arrival');
    await sender.getByTestId('combobox-option-plex:55854').click();

    const native = sender.locator('.video-player video');
    await expect(native).toBeVisible({ timeout: 60000 });
    await expect.poll(() => native.evaluate(video => video.readyState >= 2 && !video.paused && video.currentTime > 0),
      { timeout: 30000 }).toBe(true);

    await sender.getByTestId('app-nav-fleet').click();
    await expect(sender.getByTestId(senderCard)).toContainText('Sender browser');
    await expect(sender.getByTestId(`fleet-this-device-browser:${senderId}`)).toHaveText('This device');
    await expect(sender.getByTestId(senderCard)).toContainText('Arrival');
    await expect(sender.getByTestId(`fleet-state-browser:${senderId}`)).toHaveText('Playing');

    await observer.getByTestId('app-nav-fleet').click();
    await expect(observer.getByTestId(senderCard)).toContainText('Sender browser', { timeout: 30000 });
    await expect(observer.getByTestId(senderCard)).toContainText('Arrival');
    await expect(observer.getByTestId(`fleet-state-browser:${senderId}`)).toHaveText('Playing');

    await sender.getByTestId('mini-player-open-nowplaying').click();
    await sender.getByTestId('np-toggle').click();
    await expect.poll(() => native.evaluate(video => video.paused), { timeout: 15000 }).toBe(true);
    await sender.getByTestId('app-nav-fleet').click();
    await expect(sender.getByTestId(`fleet-state-browser:${senderId}`)).toHaveText('Paused');
    await expect(observer.getByTestId(`fleet-state-browser:${senderId}`)).toHaveText('Paused', { timeout: 30000 });
    await expect(observer.getByTestId(senderCard)).toContainText('Arrival');
  } finally {
    await Promise.all([senderContext.close(), observerContext.close()]);
  }
});
