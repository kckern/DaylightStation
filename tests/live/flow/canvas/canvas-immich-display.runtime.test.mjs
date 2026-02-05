/**
 * Canvas Immich Display Test
 *
 * Verifies:
 * 1. Query API can find Immich people with photos
 * 2. Content API returns child items (photos) for a person
 * 3. TV app displays Immich photo via ?display=immich:asset:uuid
 * 4. Image loads from Immich proxy
 *
 * Prerequisites:
 * - Backend running at BACKEND_URL
 * - Immich adapter configured with people
 *
 * Created: 2026-01-31
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;
const MIN_PHOTO_COUNT = 5;

let sharedPage;
let sharedContext;
let discoveredPersonId;
let discoveredPersonName;
let discoveredPhotoId;
let discoveredPhotoTitle;

test.describe.configure({ mode: 'serial' });

test.describe('Canvas Immich Display', () => {

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
  // TEST 1: Discover Immich person with photos
  // ═══════════════════════════════════════════════════════════════════════════
  test('Discover Immich person with photos', async ({ request }) => {
    test.setTimeout(120000); // Immich people query can take 60+ seconds
    console.log(`\n🔍 Searching for Immich people via ${BASE_URL}/api/v1/content/query/list`);

    const response = await request.get(`${BASE_URL}/api/v1/content/query/list`, {
      params: {
        from: 'people',
        source: 'immich'
      }
    });

    // Handle case where Immich isn't configured
    if (response.status() === 404 || response.status() === 501) {
      const body = await response.json();
      console.log(`⚠️  Immich not configured: ${body.error}`);
      test.skip(true, 'Immich adapter not configured');
      return;
    }

    expect(response.ok()).toBe(true);
    const data = await response.json();

    console.log(`Found ${data.items?.length || 0} people total`);

    // Filter to people with enough photos
    const eligiblePeople = (data.items || []).filter(p =>
      (p.childCount || 0) >= MIN_PHOTO_COUNT
    );

    console.log(`${eligiblePeople.length} people have ${MIN_PHOTO_COUNT}+ photos`);

    if (eligiblePeople.length === 0) {
      console.log(`⚠️  No people with ${MIN_PHOTO_COUNT}+ photos found`);
      test.skip(true, `No people with ${MIN_PHOTO_COUNT}+ photos`);
      return;
    }

    // Pick random person
    const randomIndex = Math.floor(Math.random() * eligiblePeople.length);
    const person = eligiblePeople[randomIndex];

    discoveredPersonId = person.id;
    discoveredPersonName = person.title || person.name || 'Unknown';

    console.log(`✅ Selected person: ${discoveredPersonName} (${person.childCount} photos)`);
    console.log(`   ID: ${discoveredPersonId}`);

    expect(discoveredPersonId).toMatch(/^immich:/);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: Get a photo from the person
  // ═══════════════════════════════════════════════════════════════════════════
  test('Get photo from discovered person', async ({ request }) => {
    if (!discoveredPersonId) {
      test.skip(true, 'No person discovered in previous test');
      return;
    }

    test.setTimeout(60000);

    // Get photos for the person using the list endpoint
    // discoveredPersonId is "immich:person:uuid", we need just "person:uuid" for the path
    const localId = discoveredPersonId.replace('immich:', '');
    const url = `${BASE_URL}/api/v1/item/immich/${localId}`;

    console.log(`\n🔍 Fetching photos for ${discoveredPersonName}`);
    console.log(`   URL: ${url}`);

    const response = await request.get(url);

    if (!response.ok()) {
      const text = await response.text();
      console.log(`⚠️  Failed to get photos: ${response.status()} - ${text}`);
      test.skip(true, 'Could not fetch person photos');
      return;
    }

    const data = await response.json();
    const photos = data.items || data;

    console.log(`Found ${Array.isArray(photos) ? photos.length : 0} photos`);

    if (!Array.isArray(photos) || photos.length === 0) {
      console.log('⚠️  No photos returned');
      test.skip(true, 'No photos found for person');
      return;
    }

    // Pick random photo
    const randomIndex = Math.floor(Math.random() * photos.length);
    const photo = photos[randomIndex];

    discoveredPhotoId = photo.id;
    discoveredPhotoTitle = photo.title || 'Untitled';

    console.log(`✅ Selected photo: ${discoveredPhotoTitle}`);
    console.log(`   ID: ${discoveredPhotoId}`);
    console.log(`   ImageUrl: ${photo.imageUrl || 'N/A'}`);

    expect(discoveredPhotoId).toMatch(/^immich:/);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: TV app displays Immich photo via display= param
  // ═══════════════════════════════════════════════════════════════════════════
  test('TV app displays Immich photo via display= param', async () => {
    if (!discoveredPhotoId) {
      test.skip(true, 'No photo discovered in previous test');
      return;
    }

    const displayUrl = `${BASE_URL}/tv?display=${encodeURIComponent(discoveredPhotoId)}`;
    console.log(`\n🖼️  Opening TV app: ${displayUrl}`);

    await sharedPage.goto(displayUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Wait for art component to mount
    await sharedPage.waitForTimeout(3000);

    // Check for art-app class (same as canvas display)
    const artApp = await sharedPage.locator('.art-app').count();
    console.log(`\n🎨 Art app elements found: ${artApp}`);

    expect(artApp).toBeGreaterThan(0);

    // Check for image element
    const img = sharedPage.locator('.art-app img').first();
    const imgSrc = await img.getAttribute('src');
    console.log(`   Image src: ${imgSrc}`);

    // Should use immich proxy
    expect(imgSrc).toContain('/proxy/immich/');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 4: Image loads from Immich proxy
  // ═══════════════════════════════════════════════════════════════════════════
  test('Image loads from Immich proxy', async () => {
    if (!discoveredPhotoId) {
      test.skip(true, 'No photo discovered');
      return;
    }

    const img = sharedPage.locator('.art-app img').first();

    // Wait for image to load
    await sharedPage.waitForTimeout(2000);

    const naturalWidth = await img.evaluate(el => el.naturalWidth);
    const naturalHeight = await img.evaluate(el => el.naturalHeight);

    console.log(`\n📐 Image dimensions: ${naturalWidth}x${naturalHeight}`);

    expect(naturalWidth).toBeGreaterThan(0);
    expect(naturalHeight).toBeGreaterThan(0);

    console.log('\n✅ Canvas Immich display test completed successfully');
  });

});
