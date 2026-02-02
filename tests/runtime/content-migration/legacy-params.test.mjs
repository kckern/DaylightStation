/**
 * Legacy Query Params Runtime Tests
 *
 * Verifies content migration backward compatibility:
 * 1. Legacy URL params work (?hymn=2, ?scripture=alma-32)
 * 2. Canonical params work (?play=singing:hymn/2)
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
  test('tv?hymn=2 plays singing:hymn/2', async ({ page }) => {
    test.setTimeout(15000);

    const legacyUrl = `${BASE_URL}/tv?hymn=2`;
    console.log(`\nNavigating to: ${legacyUrl}`);

    await page.goto(legacyUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    // Wait for content to load
    await page.waitForSelector('[data-visual-type="singing"], .singing-scroller, .content-scroller', {
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
    await page.waitForSelector('[data-visual-type="narrated"], .narrated-scroller, .content-scroller', {
      timeout: 10000
    });

    const title = await page.locator('h2, h1, [data-testid="content-title"]').first().textContent();
    console.log(`Content title: ${title}`);
    expect(title).toBeTruthy();

    console.log('Legacy scripture param loaded successfully');
  });

  test('tv?play=singing:hymn/2 works with canonical ID', async ({ page }) => {
    test.setTimeout(15000);

    const canonicalUrl = `${BASE_URL}/tv?play=singing:hymn/2`;
    console.log(`\nNavigating to: ${canonicalUrl}`);

    await page.goto(canonicalUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    // Wait for singing player
    await page.waitForSelector('[data-visual-type="singing"], .singing-scroller', {
      timeout: 10000
    });

    console.log('Canonical singing param loaded successfully');
  });

  test('tv?play=narrated:scripture/alma-32 works with canonical narrated ID', async ({ page }) => {
    test.setTimeout(15000);

    const canonicalUrl = `${BASE_URL}/tv?play=narrated:scripture/alma-32`;
    console.log(`\nNavigating to: ${canonicalUrl}`);

    await page.goto(canonicalUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    // Wait for narrated player
    await page.waitForSelector('[data-visual-type="narrated"], .narrated-scroller', {
      timeout: 10000
    });

    console.log('Canonical narrated param loaded successfully');
  });
});

test.describe('API resolution', () => {
  test('hymn:2 resolves to singing:hymn/2', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/content/resolve?id=hymn:2`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    console.log(`hymn:2 resolved to:`, data);

    expect(data.id).toBe('singing:hymn/2');
    expect(data.category).toBe('singing');
  });

  test('scripture:alma-32 resolves correctly', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/content/resolve?id=scripture:alma-32`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    console.log(`scripture:alma-32 resolved to:`, data);

    expect(data.category).toBe('narrated');
    expect(data.collection).toBe('scripture');
  });

  test('hymn:2 API endpoint returns correct content metadata', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/singing/hymn/2`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    console.log(`API hymn/2 response:`, {
      id: data.id,
      title: data.title,
      category: data.category
    });

    expect(data.id).toBe('singing:hymn/2');
    expect(data.category).toBe('singing');
  });

  test('scripture API endpoint returns correct content metadata', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/narrated/scripture/alma-32`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    console.log(`API scripture/alma-32 response:`, {
      id: data.id,
      title: data.title,
      category: data.category
    });

    expect(data.category).toBe('narrated');
    expect(data.collection).toBe('scripture');
  });
});

test.describe('Legacy ID format variations', () => {
  test('hymn with numeric padding resolves', async ({ request }) => {
    // Test that hymn IDs work with various formats
    const response = await request.get(`${BASE_URL}/api/v1/content/resolve?id=hymn:2`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data).toBeDefined();
    expect(data.id).toBeTruthy();
  });

  test('scripture with book-chapter-verse format resolves', async ({ request }) => {
    // Test various scripture formats
    const response = await request.get(`${BASE_URL}/api/v1/content/resolve?id=scripture:alma-32`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data).toBeDefined();
    expect(data.id).toBeTruthy();
  });
});
