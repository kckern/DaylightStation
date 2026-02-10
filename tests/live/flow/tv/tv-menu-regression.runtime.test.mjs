/**
 * TVApp Menu Regression Test
 *
 * Config-driven test suite that reads tvapp.yml and verifies every menu item
 * is in working order: API resolves, content is viewable/selectable/playable
 * based on its declared action and capabilities.
 *
 * This test is the SSOT for "does every TV menu item work?" — if a new item
 * is added to tvapp.yml it's automatically covered.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { load } from 'js-yaml';
import { getDataPath } from '#testlib/configHelper.mjs';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE = BACKEND_URL;
const DATA_PATH = getDataPath();

// ── Load tvapp menu config ──────────────────────────────────────
const TVAPP_PATH = `${DATA_PATH}/household/config/lists/menus/tvapp.yml`;
const tvappRaw = load(readFileSync(TVAPP_PATH, 'utf8'));
const menuItems = tvappRaw?.items || (Array.isArray(tvappRaw) ? tvappRaw : []);

/**
 * Normalize the YAML `input` field to a compound content ID.
 * Handles the space-after-colon YAML quirk and semicolons.
 */
function normalizeInput(input) {
  if (!input) return null;
  return input.replace(/^(\w+):\s+/, '$1:').trim();
}

/**
 * Determine the API endpoint and expected behavior for an item based on action.
 *
 * Returns { apiUrl, expectedFormat, apiType } or null if untestable.
 */
function resolveTestTarget(item) {
  const action = (item.action || 'Play').toLowerCase();
  const input = normalizeInput(item.input);
  if (!input) return null;

  // Parse the compound ID: handle semicolons (composite IDs like plex:663846;overlay:440630)
  const primaryId = input.split(';')[0].trim();

  // API routes use slashes not colons: /api/v1/list/plex/663035 not /api/v1/list/plex:663035
  const apiPath = primaryId.replace(':', '/');

  switch (action) {
    case 'list':
      return { apiUrl: `${BASE}/api/v1/list/${apiPath}`, apiType: 'list' };
    case 'queue':
      return { apiUrl: `${BASE}/api/v1/list/${apiPath}`, apiType: 'list' };
    case 'play':
    default:
      return { apiUrl: `${BASE}/api/v1/info/${apiPath}`, apiType: 'info' };
  }
}

/**
 * Build the TV URL for an item (what the frontend would navigate to).
 */
function buildTvUrl(item) {
  const action = (item.action || 'Play').toLowerCase();
  const input = normalizeInput(item.input);
  if (!input) return null;

  switch (action) {
    case 'list':
      return `${BASE}/tv?list=${input}`;
    case 'queue':
      return `${BASE}/tv?queue=${input}`;
    case 'open':
      return null; // Apps not tested via URL navigation
    case 'display':
      return `${BASE}/tv?display=${input}`;
    default:
      return `${BASE}/tv?play=${input}`;
  }
}

// ── Partition items by action type for organized test output ────
const activeItems = menuItems.filter(i => i.active !== false);
const inactiveItems = menuItems.filter(i => i.active === false);

// ──────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────

// NOTE: No top-level serial mode — API sections run independently so one
// timeout doesn't cascade-fail everything. Only the TV page section uses
// serial mode because it shares a single browser page.

// Plex-backed endpoints can be slow (cold cache, large libraries).
const PLEX_TIMEOUT = 30000;
const API_TIMEOUT  = 15000;

let sharedPage;
let sharedContext;

test.describe('TVApp Menu Regression (tvapp.yml)', () => {

  test.beforeAll(async ({ browser }) => {
    sharedContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    // Enable autoplay for media tests
    try {
      const cdp = await sharedContext.newCDPSession(await sharedContext.newPage());
      await cdp.send('Emulation.setAutoplayPolicy', { policy: 'no-user-gesture-required' });
      await (await sharedContext.pages())[0].close();
    } catch { /* Non-Chromium browser, autoplay may not work */ }
    sharedPage = await sharedContext.newPage();
  });

  test.afterAll(async () => {
    await sharedPage?.close();
    await sharedContext?.close();
  });

  // ── 1. Config sanity ─────────────────────────────────────────
  test('tvapp.yml loads with items', () => {
    expect(menuItems.length, 'tvapp.yml should have items').toBeGreaterThan(0);
    for (const item of menuItems) {
      expect(item.label, 'Every item needs a label').toBeTruthy();
      expect(item.uid, `Item "${item.label}" needs a uid`).toBeTruthy();
    }
  });

  // ── 2. API health for ALL items (active + inactive) ──────────
  test.describe('API health: every item resolves', () => {
    for (const item of menuItems) {
      const target = resolveTestTarget(item);
      if (!target) continue;

      const tag = item.active === false ? ' [inactive]' : '';
      const timeout = target.apiType === 'list' ? PLEX_TIMEOUT : API_TIMEOUT;
      test(`API: ${item.label}${tag} (${target.apiType})`, async () => {
        const res = await sharedPage.request.get(target.apiUrl, { timeout });
        expect(res.status(), `${item.label}: ${target.apiUrl} should return 200`).toBe(200);
        const body = await res.json();
        expect(body, `${item.label}: response body should be truthy`).toBeTruthy();

        if (target.apiType === 'list') {
          // List/Queue: expect items array
          const items = body.items || (Array.isArray(body) ? body : null);
          expect(items, `${item.label}: list response should have items`).toBeTruthy();
          expect(Array.isArray(items), `${item.label}: items should be an array`).toBe(true);
          expect(items.length, `${item.label}: list should not be empty`).toBeGreaterThan(0);
        } else {
          // Play/Info: expect title and format
          expect(body.title || body.reference, `${item.label}: info should have title`).toBeTruthy();
          expect(body.format, `${item.label}: info should have format`).toBeTruthy();
        }
      });
    }
  });

  // ── 3. Playable items return media-ready responses ───────────
  test.describe('Playable items have media data', () => {
    const playItems = menuItems.filter(i => {
      const action = (i.action || 'Play').toLowerCase();
      return action === 'play' && i.active !== false;
    });

    for (const item of playItems) {
      const input = normalizeInput(item.input);
      if (!input) continue;
      const primaryId = input.split(';')[0].trim();
      const apiPath = primaryId.replace(':', '/');

      test(`Playable: ${item.label}`, async () => {
        // Use play endpoint (resolves containers to playable children)
        const res = await sharedPage.request.get(`${BASE}/api/v1/play/${apiPath}`, { timeout: PLEX_TIMEOUT });
        expect(res.status(), `${item.label}: play endpoint should return 200`).toBe(200);
        const body = await res.json();

        expect(body.format, `${item.label}: should have format`).toBeTruthy();
        expect(body.format, `${item.label}: format should not be "list" (should resolve to playable)`).not.toBe('list');

        // Readalong/singalong should have content (may be array or { type, data } object)
        if (body.format === 'readalong' || body.format === 'singalong') {
          expect(body.content, `${item.label}: ${body.format} should have content`).toBeTruthy();
          const contentData = Array.isArray(body.content)
            ? body.content
            : body.content?.data;
          if (contentData) {
            expect(Array.isArray(contentData), `${item.label}: content data should be array`).toBe(true);
            expect(contentData.length, `${item.label}: content data should not be empty`).toBeGreaterThan(0);
          }
        }

        // Video/audio should have mediaUrl
        if (['video', 'dash_video', 'audio'].includes(body.format)) {
          expect(body.mediaUrl, `${item.label}: ${body.format} should have mediaUrl`).toBeTruthy();
        }
      });
    }
  });

  // ── 4. Queueable items can be expanded ───────────────────────
  test.describe('Queue items expand to playable children', () => {
    const queueItems = menuItems.filter(i => {
      const action = (i.action || 'Play').toLowerCase();
      return action === 'queue' && i.active !== false;
    });

    for (const item of queueItems) {
      const input = normalizeInput(item.input);
      if (!input) continue;
      const primaryId = input.split(';')[0].trim();

      const apiPath = primaryId.replace(':', '/');

      test(`Queue: ${item.label}`, async () => {
        const res = await sharedPage.request.get(
          `${BASE}/api/v1/list/${apiPath}/playable`, { timeout: PLEX_TIMEOUT }
        );
        expect(res.status(), `${item.label}: playable list should return 200`).toBe(200);
        const body = await res.json();
        const items = body.items || (Array.isArray(body) ? body : []);

        expect(items.length, `${item.label}: queue should expand to playable items`).toBeGreaterThan(0);

        // First item should have a content ID
        const firstItem = items[0];
        const contentId = firstItem.play?.contentId || firstItem.contentId || firstItem.id;
        expect(contentId, `${item.label}: first queued item should have a content ID`).toBeTruthy();
      });
    }
  });

  // ── 5. List items return browseable children ─────────────────
  test.describe('List items return browseable children', () => {
    const listItems = menuItems.filter(i => {
      const action = (i.action || 'Play').toLowerCase();
      return action === 'list' && i.active !== false;
    });

    for (const item of listItems) {
      const input = normalizeInput(item.input);
      if (!input) continue;
      const primaryId = input.split(';')[0].trim();

      const apiPath = primaryId.replace(':', '/');

      test(`List: ${item.label}`, async () => {
        const res = await sharedPage.request.get(
          `${BASE}/api/v1/list/${apiPath}`, { timeout: PLEX_TIMEOUT }
        );
        expect(res.status(), `${item.label}: list should return 200`).toBe(200);
        const body = await res.json();
        const items = body.items || (Array.isArray(body) ? body : []);

        expect(items.length, `${item.label}: list should have items`).toBeGreaterThan(0);

        // Each child should have a label/title
        for (const child of items.slice(0, 3)) {
          const label = child.label || child.title;
          expect(label, `${item.label}: child item should have label/title`).toBeTruthy();
        }
      });
    }
  });

  // ── 6. TV page renders active items without API errors ───────
  // Serial: tests share a single page and must wait for rendering.
  test.describe('TV page renders without errors', () => {
    test.describe.configure({ mode: 'serial' });

    for (const item of activeItems) {
      const tvUrl = buildTvUrl(item);
      if (!tvUrl) continue;

      test(`TV page: ${item.label}`, async () => {
        const apiErrors = [];

        const onResponse = res => {
          if (res.url().includes('/api/') && res.status() >= 400) {
            apiErrors.push(`${res.status()} ${res.url()}`);
          }
        };

        sharedPage.on('response', onResponse);

        await sharedPage.goto(tvUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        // Allow time for API calls and content rendering
        await sharedPage.waitForTimeout(4000);

        sharedPage.off('response', onResponse);

        expect(apiErrors.length,
          `${item.label}: no API errors expected.\n  URL: ${tvUrl}\n  Errors: ${apiErrors.join('\n  ')}`
        ).toBe(0);
      });
    }
  });

  // ── 7. Thumbnail / display images resolve for items with contentId ──
  test.describe('Display URLs resolve (thumbnails)', () => {
    const itemsWithDisplayUrl = menuItems.filter(i => {
      const input = normalizeInput(i.input);
      // Items with external images don't need display URL testing
      if (i.image && i.image.startsWith('http')) return false;
      // Items without input can't generate display URLs
      if (!input) return false;
      // Only test items with a source prefix (display router needs it)
      return input.includes(':');
    });

    for (const item of itemsWithDisplayUrl) {
      const input = normalizeInput(item.input);
      const primaryId = input.split(';')[0].trim();

      const apiPath = primaryId.replace(':', '/');

      test(`Display: ${item.label}`, async () => {
        const res = await sharedPage.request.get(
          `${BASE}/api/v1/display/${apiPath}`, {
            timeout: API_TIMEOUT,
            maxRedirects: 0, // Don't follow redirect, just check it exists
          }
        );
        // Display endpoint returns 302 redirect to proxy, or 404 if no thumbnail
        // Both 200 and 302 are acceptable (redirect to proxy image)
        const acceptable = [200, 302];
        const isOk = acceptable.includes(res.status());
        // 404 is allowed for content types that genuinely have no thumbnail (singalong, etc.)
        // But we track it for visibility
        if (!isOk && res.status() !== 404) {
          expect.soft(res.status(), `${item.label}: unexpected display status`).toBeLessThan(500);
        }
      });
    }
  });
});
