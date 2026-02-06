/**
 * Displayer Mode Test
 *
 * Verifies:
 * 1. ?display=<id> renders Displayer in default mode
 * 2. ?display=<id>&mode=art renders art mode with frame
 * 3. ?display=<id>&mode=art&frame=ornate uses specified frame style
 *
 * Prerequisites:
 * - Backend running at BACKEND_URL
 * - At least one displayable content source configured (canvas or immich)
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;

let sharedPage;
let sharedContext;
let displayableId;

test.describe.configure({ mode: 'serial' });

test.describe('Displayer Modes', () => {

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

  // Discover a displayable item from canvas or immich
  test('Find a displayable content item', async ({ request }) => {
    // Try canvas first
    const canvasRes = await request.get(`${BASE_URL}/api/v1/content/list/canvas`);
    if (canvasRes.ok()) {
      const items = await canvasRes.json();
      if (items?.length > 0) {
        // Get first leaf item (not a container)
        const leaf = items.find(i => i.itemType === 'leaf' || i.imageUrl);
        if (leaf) {
          displayableId = leaf.id;
          console.log(`✅ Found canvas item: ${displayableId}`);
          return;
        }
        // If all are containers, drill into first
        const container = items[0];
        const childRes = await request.get(`${BASE_URL}/api/v1/content/list/${container.id.replace(':', '/')}`);
        if (childRes.ok()) {
          const children = await childRes.json();
          if (children?.length > 0) {
            displayableId = children[0].id;
            console.log(`✅ Found canvas child item: ${displayableId}`);
            return;
          }
        }
      }
    }

    console.log('⚠️  No displayable content found');
    test.skip(true, 'No displayable content configured');
  });

  test('Default mode renders bare image', async () => {
    if (!displayableId) {
      test.skip(true, 'No displayable item found');
      return;
    }

    await sharedPage.goto(`${BASE_URL}/tv?display=${displayableId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await sharedPage.waitForTimeout(3000);

    const displayer = await sharedPage.locator('.displayer').count();
    expect(displayer).toBeGreaterThan(0);

    // Default mode should NOT have frame elements
    const frame = await sharedPage.locator('.displayer__frame').count();
    expect(frame).toBe(0);

    // Should have an image
    const img = await sharedPage.locator('.displayer img').count();
    expect(img).toBeGreaterThan(0);

    console.log('✅ Default mode renders correctly');
  });

  test('Art mode renders with frame', async () => {
    if (!displayableId) {
      test.skip(true, 'No displayable item found');
      return;
    }

    await sharedPage.goto(`${BASE_URL}/tv?display=${displayableId}&mode=art`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await sharedPage.waitForTimeout(3000);

    const displayer = await sharedPage.locator('.displayer--art').count();
    expect(displayer).toBeGreaterThan(0);

    // Art mode should have frame elements with default classic style
    const frame = await sharedPage.locator('.displayer__frame--classic').count();
    expect(frame).toBeGreaterThan(0);

    console.log('✅ Art mode renders with classic frame');
  });

  test('Art mode respects frame param override', async () => {
    if (!displayableId) {
      test.skip(true, 'No displayable item found');
      return;
    }

    await sharedPage.goto(`${BASE_URL}/tv?display=${displayableId}&mode=art&frame=ornate`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await sharedPage.waitForTimeout(3000);

    // Should use ornate frame, not classic default
    const ornate = await sharedPage.locator('.displayer__frame--ornate').count();
    expect(ornate).toBeGreaterThan(0);

    const classic = await sharedPage.locator('.displayer__frame--classic').count();
    expect(classic).toBe(0);

    console.log('✅ Frame param override works correctly');
  });

});
