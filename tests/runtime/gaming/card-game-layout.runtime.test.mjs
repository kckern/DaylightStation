import { expect, test } from '@playwright/test';

test('Card Game tactical hand and scale challenge fit the 1280x800 piano viewport', async ({ page }) => {
  // Keep the kiosk's bridge-first MIDI input healthy in headless Chromium so
  // the provider does not correctly terminate the challenge as disconnected
  // before there is time to inspect its layout.
  await page.addInitScript(() => {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith('gaming:card-game:')) window.localStorage.removeItem(key);
    }
    const NativeWebSocket = window.WebSocket;
    class BridgeSocket {
      constructor(url) {
        this.url = String(url);
        this.readyState = 0;
        window.setTimeout(() => {
          this.readyState = 1;
          this.onopen?.(new Event('open'));
        }, 0);
      }

      send() {}

      close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.onclose?.({ code: 1000, reason: 'test complete' });
      }
    }
    function TestWebSocket(url, protocols) {
      if (String(url).startsWith('ws://localhost:8770')) return new BridgeSocket(url);
      return protocols === undefined
        ? new NativeWebSocket(url)
        : new NativeWebSocket(url, protocols);
    }
    TestWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
    TestWebSocket.OPEN = NativeWebSocket.OPEN;
    TestWebSocket.CLOSING = NativeWebSocket.CLOSING;
    TestWebSocket.CLOSED = NativeWebSocket.CLOSED;
    window.WebSocket = TestWebSocket;
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/piano/games/card-game', { waitUntil: 'networkidle' });

  const continueWithoutPiano = page.getByRole('button', { name: 'Continue without piano' });
  await continueWithoutPiano.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await continueWithoutPiano.isVisible()) await continueWithoutPiano.click();

  const cards = page.locator('.battle-card');
  await expect(cards).toHaveCount(3);
  await expect(page.locator('.combatant-combatant--enemy')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your hand' })).toBeVisible();
  const viewport = page.viewportSize();
  for (let index = 0; index < await cards.count(); index += 1) {
    const box = await cards.nth(index).boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(box.width).toBeGreaterThanOrEqual(160);
    expect(box.height).toBeGreaterThanOrEqual(120);
  }
  const scaleCard = cards.filter({ hasText: /scale/i });
  await expect(scaleCard).toHaveCount(1);
  await expect(scaleCard).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height);

  await scaleCard.click();
  const overlay = page.locator('.gaming-challenge-overlay');
  await expect(overlay).toBeVisible();
  await expect(page.getByText('Play from left to right', { exact: false })).toBeVisible({ timeout: 15000 });
  const staff = page.locator('.piano-scale-challenge__staff');
  await expect(staff).toBeVisible();
  const staffBox = await staff.boundingBox();
  expect(staffBox).not.toBeNull();
  expect(staffBox.width).toBeGreaterThanOrEqual(viewport.width * 0.8);
  expect(staffBox.height).toBeGreaterThanOrEqual((viewport.height - 60) * 0.45);
  expect(staffBox.x + staffBox.width).toBeLessThanOrEqual(viewport.width);
  expect(staffBox.y + staffBox.height).toBeLessThanOrEqual(viewport.height);

  const staffLines = page.locator('.piano-scale-challenge__staff .abcjs-staff');
  await expect(staffLines).toBeVisible();
  const staffLinesBox = await staffLines.boundingBox();
  expect(staffLinesBox).not.toBeNull();
  expect(Math.abs((staffLinesBox.x + staffLinesBox.width / 2) - viewport.width / 2)).toBeLessThan(4);
  expect(Math.abs((staffLinesBox.y + staffLinesBox.height / 2) - (staffBox.y + staffBox.height / 2))).toBeLessThan(6);

  await expect(page.locator('.piano-scale-note--next')).toHaveCount(1);
});
