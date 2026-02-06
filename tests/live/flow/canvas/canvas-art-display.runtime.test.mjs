/**
 * Canvas Art Display Test
 *
 * Verifies:
 * 1. Content API returns DisplayableItem for canvas source
 * 2. TV app displays art via ?display=canvas:religious/nativity.jpg
 * 3. Image loads from Dropbox path via proxy
 *
 * Prerequisites:
 * - Backend running at BACKEND_URL
 * - Canvas adapter configured with art in religious/ folder
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;

let sharedPage;
let sharedContext;
let discoveredArtId;

test.describe.configure({ mode: 'serial' });

test.describe('Canvas Art Display', () => {

  test.beforeAll(async ({ browser }) => {
    sharedContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });
    sharedPage = await sharedContext.newPage();

    sharedPage.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`❌ Browser console error: ${msg.text()}`);
      }
    });
  });

  test.afterAll(async () => {
    if (sharedPage) await sharedPage.close();
    if (sharedContext) await sharedContext.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 1: Content API returns canvas items
  // ═══════════════════════════════════════════════════════════════════════════
  test('Content API returns canvas DisplayableItem', async ({ request }) => {
    console.log(`\n🔍 Fetching canvas item via ${BASE_URL}/api/v1/content/item/canvas/religious/nativity.jpg`);

    const response = await request.get(`${BASE_URL}/api/v1/content/item/canvas/religious/nativity.jpg`);

    if (response.status() === 404) {
      console.log('⚠️  Canvas adapter not configured or image not found');
      test.skip(true, 'Canvas not configured');
      return;
    }

    expect(response.ok()).toBe(true);
    const item = await response.json();

    console.log(`✅ Got item: "${item.title}"`);
    console.log(`   ID: ${item.id}`);
    console.log(`   Category: ${item.category}`);
    console.log(`   ImageUrl: ${item.imageUrl}`);

    expect(item.id).toBe('canvas:religious/nativity.jpg');
    expect(item.imageUrl).toContain('/api/v1/canvas/image/');

    discoveredArtId = item.id;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: TV app displays art via display= param
  // ═══════════════════════════════════════════════════════════════════════════
  test('TV app displays art via display= param', async () => {
    if (!discoveredArtId) {
      test.skip(true, 'No art discovered in previous test');
      return;
    }

    const displayUrl = `${BASE_URL}/tv?display=${discoveredArtId}&mode=art`;
    console.log(`\n🖼️  Opening TV app: ${displayUrl}`);

    await sharedPage.goto(displayUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Wait for displayer component to mount
    await sharedPage.waitForTimeout(3000);

    // Check for art-app class
    const displayer = await sharedPage.locator('.displayer').count();
    console.log(`\n🎨 Displayer elements found: ${displayer}`);

    expect(displayer).toBeGreaterThan(0);

    // Check for image element
    const img = sharedPage.locator('.displayer img').first();
    const imgSrc = await img.getAttribute('src');
    console.log(`   Image src: ${imgSrc}`);

    expect(imgSrc).toContain('/api/v1/canvas/image/');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: Image loads successfully
  // ═══════════════════════════════════════════════════════════════════════════
  test('Image loads from proxy', async () => {
    if (!discoveredArtId) {
      test.skip(true, 'No art discovered');
      return;
    }

    const img = sharedPage.locator('.displayer img').first();

    // Wait for image to load
    await sharedPage.waitForTimeout(2000);

    const naturalWidth = await img.evaluate(el => el.naturalWidth);
    const naturalHeight = await img.evaluate(el => el.naturalHeight);

    console.log(`\n📐 Image dimensions: ${naturalWidth}x${naturalHeight}`);

    expect(naturalWidth).toBeGreaterThan(0);
    expect(naturalHeight).toBeGreaterThan(0);

    console.log('\n✅ Canvas art display test completed successfully');
  });

});
