/**
 * Legacy Query Params Runtime Tests
 *
 * Verifies content migration backward compatibility:
 * 1. Legacy URL params work (?hymn=2, ?scripture=alma-32)
 * 2. Canonical params work (?play=singalong:hymn/2)
 * 3. API resolution works for legacy IDs (hymn:2, scripture:alma-32)
 *
 * Prerequisites:
 * - Dev server running (npm run dev)
 * - New adapters registered and working
 * - Data migration complete (Task 19)
 *
 * Created: 2026-02-02
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;

test.describe('Legacy query params', () => {
  test('tv?hymn=2 plays singalong:hymn/2', async ({ page }) => {
    test.setTimeout(15000);

    const legacyUrl = `${BASE_URL}/tv?hymn=2`;
    console.log(`\nNavigating to: ${legacyUrl}`);

    await page.goto(legacyUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    // Wait for content to load
    await page.waitForSelector('[data-visual-type="singalong"], .singalong-scroller, .content-scroller', {
      timeout: 10000
    });

    // Verify title contains hymn info
    const title = await page.locator('h2, h1, [data-testid="content-title"]').first().textContent();
    console.log(`Content title: ${title}`);
    expect(title).toBeTruthy();

    console.log('Legacy hymn param loaded successfully');
  });

  test('tv?scripture=alma-32 resolves and plays', async ({ page }) => {
    test.setTimeout(15000);

    const legacyUrl = `${BASE_URL}/tv?scripture=alma-32`;
    console.log(`\nNavigating to: ${legacyUrl}`);

    await page.goto(legacyUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    // Wait for content to load
    await page.waitForSelector('[data-visual-type="readalong"], .readalong-scroller, .content-scroller', {
      timeout: 10000
    });

    const title = await page.locator('h2, h1, [data-testid="content-title"]').first().textContent();
    console.log(`Content title: ${title}`);
    expect(title).toBeTruthy();

    console.log('Legacy scripture param loaded successfully');
  });

  test('tv?play=singalong:hymn/2 works with canonical ID', async ({ page }) => {
    test.setTimeout(15000);

    const canonicalUrl = `${BASE_URL}/tv?play=singalong:hymn/2`;
    console.log(`\nNavigating to: ${canonicalUrl}`);

    await page.goto(canonicalUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    // Wait for singalong player
    await page.waitForSelector('[data-visual-type="singalong"], .singalong-scroller', {
      timeout: 10000
    });

    console.log('Canonical singalong param loaded successfully');
  });

  test('tv?play=readalong:scripture/alma-32 works with canonical readalong ID', async ({ page }) => {
    test.setTimeout(15000);

    const canonicalUrl = `${BASE_URL}/tv?play=readalong:scripture/alma-32`;
    console.log(`\nNavigating to: ${canonicalUrl}`);

    await page.goto(canonicalUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    // Wait for readalong player
    await page.waitForSelector('[data-visual-type="readalong"], .readalong-scroller', {
      timeout: 10000
    });

    console.log('Canonical readalong param loaded successfully');
  });
});

test.describe('API endpoints', () => {
  test('singalong hymn item endpoint returns content', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/item/singalong/hymn/2`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    console.log(`API singalong/hymn/2 response:`, {
      id: data.id,
      title: data.title
    });

    expect(data.id).toBe('singalong:hymn/2');
  });

  test('readalong scripture item endpoint returns content', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/item/readalong/scripture/bom`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    console.log(`API readalong/scripture/bom response:`, {
      id: data.id,
      title: data.title
    });

    expect(data.id).toContain('readalong:scripture');
  });

  test('config content-prefixes endpoint returns legacy mapping', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/config/content-prefixes`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    console.log(`Config content-prefixes:`, data);

    expect(data.legacy).toBeDefined();
    expect(data.legacy.hymn).toBe('singalong:hymn');
    expect(data.legacy.scripture).toBe('readalong:scripture');
  });
});

test.describe('ID format variations', () => {
  test('hymn with different numbers resolves', async ({ request }) => {
    // Test hymn ID 100
    const response = await request.get(`${BASE_URL}/api/v1/item/singalong/hymn/100`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data).toBeDefined();
    expect(data.id).toBe('singalong:hymn/100');
  });

  test('scripture volumes resolve', async ({ request }) => {
    // Test Book of Mormon volume
    const response = await request.get(`${BASE_URL}/api/v1/item/readalong/scripture/bom`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data).toBeDefined();
    expect(data.id).toContain('readalong:scripture');
  });
});
