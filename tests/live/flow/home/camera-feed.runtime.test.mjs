// tests/live/flow/home/camera-feed.runtime.test.mjs
import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:3111';

test.describe('HomeApp Camera Feed', () => {

  test('loads /home and displays camera snapshot', async ({ page }) => {
    const apiCalls = [];
    page.on('response', resp => {
      const url = resp.url();
      if (url.includes('/api/v1/camera')) {
        apiCalls.push({ url, status: resp.status(), type: resp.headers()['content-type'] });
      }
    });

    page.on('console', msg => {
      console.log(`[browser ${msg.type()}] ${msg.text()}`);
    });

    await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' });

    // Camera card should appear after API fetch
    const card = page.locator('.home-cameras__card');
    await expect(card).toBeVisible({ timeout: 10000 });

    // Camera label should show camera ID
    const label = page.locator('.home-cameras__label');
    await expect(label).toHaveText('driveway-camera');

    // Snapshot image should load — camera takes ~13s to respond with a 3.4MB JPEG
    const img = card.locator('img');
    await expect(img).toBeVisible({ timeout: 30000 });

    // Verify snapshot API was called and succeeded
    const snapCall = apiCalls.find(c => c.url.includes('/snap'));
    expect(snapCall, 'Snapshot API was called').toBeTruthy();
    expect(snapCall.status).toBe(200);
    expect(snapCall.type).toBe('image/jpeg');

    // Image should have real dimensions (not broken)
    const imgSize = await img.evaluate(el => ({
      naturalWidth: el.naturalWidth,
      naturalHeight: el.naturalHeight,
    }));
    expect(imgSize.naturalWidth).toBeGreaterThan(100);
    expect(imgSize.naturalHeight).toBeGreaterThan(100);

    console.log(`Snapshot loaded: ${imgSize.naturalWidth}x${imgSize.naturalHeight}`);
  }, 60000);

  test('live button starts HLS stream', async ({ page }) => {
    page.on('console', msg => {
      console.log(`[browser ${msg.type()}] ${msg.text()}`);
    });

    const apiCalls = [];
    page.on('response', resp => {
      const url = resp.url();
      if (url.includes('/api/v1/camera')) {
        apiCalls.push({ url, status: resp.status(), type: resp.headers()['content-type'] });
      }
    });

    await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' });

    // Wait for card to appear
    const card = page.locator('.home-cameras__card');
    await expect(card).toBeVisible({ timeout: 10000 });

    // Click the Live button
    const liveBtn = page.locator('.home-cameras__toggle');
    await expect(liveBtn).toBeVisible();
    await expect(liveBtn).toHaveText('Live');
    await liveBtn.click();

    // Button should now say "Stop"
    await expect(liveBtn).toHaveText('Stop');

    // Video element should appear
    const video = card.locator('video');
    await expect(video).toBeVisible({ timeout: 5000 });

    // Wait for HLS to start — ffmpeg needs time to produce segments
    await page.waitForTimeout(15000);

    // Check if the m3u8 was requested
    const hlsCall = apiCalls.find(c => c.url.includes('stream.m3u8'));
    console.log('HLS playlist call:', hlsCall ? `${hlsCall.status} ${hlsCall.type}` : 'NOT FOUND');

    // Check for .ts segment requests
    const tsCalls = apiCalls.filter(c => c.url.includes('.ts'));
    console.log(`TS segment calls: ${tsCalls.length}`);

    console.log('All camera API calls:', JSON.stringify(apiCalls.map(c => ({
      url: c.url.replace(BASE, ''),
      status: c.status,
    })), null, 2));

    // The m3u8 should have been requested — accept 200 or 206 (sendFile with range)
    expect(hlsCall, 'HLS playlist was requested').toBeTruthy();
    expect([200, 206]).toContain(hlsCall.status);

    // Video should have some data loaded
    const videoState = await video.evaluate(el => ({
      readyState: el.readyState,
      networkState: el.networkState,
      error: el.error?.message || null,
      currentTime: el.currentTime,
      paused: el.paused,
    }));
    console.log('Video state:', JSON.stringify(videoState));

    // readyState >= 2 means we have current data
    expect(videoState.readyState).toBeGreaterThanOrEqual(2);
    expect(videoState.error).toBeNull();

    // Clean up — stop the stream
    await liveBtn.click();
    await expect(liveBtn).toHaveText('Live');
  }, 45000);

  test('camera state endpoint returns detection data', async () => {
    const res = await fetch(`${BASE}/api/v1/camera/driveway-camera/state`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty('detections');
    expect(data).toHaveProperty('motion');
    expect(Array.isArray(data.detections)).toBe(true);
    expect(typeof data.motion).toBe('boolean');
    console.log('Detection state:', JSON.stringify(data));
  });

  test('clicking snapshot opens fullscreen viewport', async ({ page }) => {
    await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' });

    // Wait for snapshot to load
    const img = page.locator('.camera-feed img');
    await expect(img).toBeVisible({ timeout: 30000 });

    // Click the image to open viewport
    await img.click();

    // Viewport overlay should appear
    const viewport = page.locator('.camera-viewport');
    await expect(viewport).toBeVisible({ timeout: 3000 });

    // Should have close button and hints bar
    await expect(page.locator('.camera-viewport__close')).toBeVisible();
    await expect(page.locator('.camera-viewport__hints')).toBeVisible();

    // Close with Esc
    await page.keyboard.press('Escape');
    await expect(viewport).not.toBeVisible({ timeout: 2000 });
  }, 60000);

  test('controls endpoint returns camera controls', async () => {
    const res = await fetch(`${BASE}/api/v1/camera/driveway-camera/controls`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty('controls');
    expect(Array.isArray(data.controls)).toBe(true);
    const types = data.controls.map(c => c.type);
    console.log('Camera controls:', JSON.stringify(data.controls));
    // Should have floodlight and siren from HA config
    expect(types).toContain('light');
    expect(types).toContain('siren');
  });
});
