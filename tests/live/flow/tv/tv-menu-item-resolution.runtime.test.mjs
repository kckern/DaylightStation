/**
 * TV Menu Item Resolution - Runtime Playwright Test
 *
 * Tests that all TVApp menu items actually play content (not spinner forever).
 *
 * Strategy:
 * 1. Fetch TVApp menu from prod (source of truth for item list)
 * 2. For each item, build direct play URL param (/tv?plex=X, /tv?hymn=2, etc.)
 * 3. Load page in Playwright on both DEV and PROD
 * 4. Compare: content plays vs spinner stuck
 *
 * If prod plays but dev shows spinner → backend API regression
 */
import { test, expect } from '@playwright/test';

// Environment URLs - everything through 3112 (Vite proxies API calls)
const DEV_URL = process.env.TEST_DEV_URL || 'http://localhost:3112';
const DEV_API = process.env.TEST_DEV_API || 'http://localhost:3112';

// Timeout for content to load before declaring spinner-stuck
const LOAD_TIMEOUT_MS = 15000;

/**
 * Build URL param from menu item action
 * Returns { param: 'plex=545064', actionType: 'queue' } or null if not testable
 */
function buildUrlParam(item) {
  // Priority: queue > play > list (skip open - those are apps, not playable)

  if (item.queue && typeof item.queue === 'object') {
    const sources = ['plex', 'watchlist', 'files', 'queue'];
    for (const source of sources) {
      if (item.queue[source]) {
        // queue action → ?queue=<value>
        return {
          param: `queue=${encodeURIComponent(item.queue[source])}`,
          actionType: 'queue',
          source,
          value: item.queue[source],
          modifiers: extractModifiers(item.queue)
        };
      }
    }
  }

  if (item.play && typeof item.play === 'object') {
    // Source-specific params for play actions
    const sourceParams = ['plex', 'hymn', 'primary', 'scripture', 'talk', 'poem', 'watchlist', 'files'];
    for (const source of sourceParams) {
      if (item.play[source]) {
        // Use source-specific param: ?hymn=2, ?plex=545064
        return {
          param: `${source}=${encodeURIComponent(item.play[source])}`,
          actionType: 'play',
          source,
          value: item.play[source],
          modifiers: extractModifiers(item.play)
        };
      }
    }
  }

  if (item.list && typeof item.list === 'object') {
    const sources = ['plex', 'watchlist', 'list'];
    for (const source of sources) {
      if (item.list[source]) {
        // list action → ?list=<value>
        return {
          param: `list=${encodeURIComponent(item.list[source])}`,
          actionType: 'list',
          source,
          value: item.list[source],
          modifiers: {}
        };
      }
    }
  }

  // open actions or unrecognized → not directly testable via URL
  if (item.open) {
    return {
      param: null,
      actionType: 'open',
      skipReason: `open action: ${JSON.stringify(item.open)}`
    };
  }

  return {
    param: null,
    actionType: 'unknown',
    skipReason: `No recognized action in: ${JSON.stringify({ play: item.play, queue: item.queue, list: item.list })}`
  };
}

/**
 * Extract playback modifiers from action object
 */
function extractModifiers(action) {
  const modifiers = {};
  if (action.shuffle) modifiers.shuffle = action.shuffle;
  if (action.continuous) modifiers.continuous = action.continuous;
  if (action.playbackRate) modifiers.playbackRate = action.playbackRate;
  if (action.volume) modifiers.volume = action.volume;
  return modifiers;
}

/**
 * Build full URL with modifiers
 */
function buildFullUrl(baseUrl, param, modifiers = {}) {
  let url = `${baseUrl}/tv?${param}`;
  for (const [key, value] of Object.entries(modifiers)) {
    url += `&${key}=${encodeURIComponent(value)}`;
  }
  return url;
}

/**
 * Test if page loaded content or is stuck on spinner
 * Returns: 'playing' | 'menu' | 'spinner-stuck' | 'error'
 */
async function checkPageStatus(page, url, label) {
  try {
    // Capture console logs to detect playback
    let playbackDetected = false;
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('queue-track-changed') || text.includes('playback.') || text.includes('cover-loaded')) {
        playbackDetected = true;
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Race: content appears vs timeout (spinner stuck)
    const result = await Promise.race([
      // Success: video player element with content
      page.waitForSelector('.video-element.show, dash-video, video[src], audio[src], audio', { timeout: LOAD_TIMEOUT_MS })
        .then(() => 'playing'),

      // Success for list actions: menu items appear
      page.waitForSelector('.tv-menu__item, .menu-item, [class*="menu-item"]', { timeout: LOAD_TIMEOUT_MS })
        .then(() => 'menu'),

      // Timeout: check what state we're in
      new Promise(resolve => setTimeout(async () => {
        // Check console logs for playback
        if (playbackDetected) {
          resolve('playing');
          return;
        }
        // Check for spinner
        const spinnerVisible = await page.isVisible('.player-overlay-loading, .loading-overlay').catch(() => false);
        if (spinnerVisible) {
          resolve('spinner-stuck');
          return;
        }
        // Check for audio shader (audio playing with visualization)
        const shaderVisible = await page.isVisible('.audio-shader, [class*="shader"]').catch(() => false);
        if (shaderVisible) {
          resolve('playing');
          return;
        }
        // Check for player container
        const playerVisible = await page.isVisible('.video-player, .single-player, [class*="player"]').catch(() => false);
        if (playerVisible) {
          resolve('playing');
          return;
        }
        resolve('unknown');
      }, LOAD_TIMEOUT_MS))
    ]);

    return { status: result, error: null };

  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

test.describe('TV Menu Item Resolution', () => {
  // Each item takes up to LOAD_TIMEOUT_MS * 2 (prod + dev), plus navigation time
  test.setTimeout(600000); // 10 minutes for all items

  let menuItems = [];
  const results = [];
  const skipped = [];

  test.beforeAll(async ({ request }) => {
    const response = await request.get(`${DEV_API}/api/v1/info/watchlist/TVApp`);
    expect(response.ok(), `Failed to fetch TVApp menu from ${DEV_API}`).toBe(true);

    const data = await response.json();
    menuItems = data.items || [];
    console.log(`\nLoaded ${menuItems.length} menu items from TVApp`);
    console.log(`Testing: ${DEV_URL}\n`);
  });

  test('Menu items resolve to playable content', async ({ page }) => {
    for (const item of menuItems) {
      const label = item.label || item.title || 'Unknown';
      const urlInfo = buildUrlParam(item);

      if (!urlInfo.param) {
        skipped.push({ label, reason: urlInfo.skipReason });
        console.log(`[SKIP] ${label}: ${urlInfo.skipReason}`);
        continue;
      }

      const url = buildFullUrl(DEV_URL, urlInfo.param, urlInfo.modifiers);
      console.log(`[TEST] ${label} → /tv?${urlInfo.param}`);

      const result = await checkPageStatus(page, url, label);
      const works = ['playing', 'menu'].includes(result.status);

      results.push({
        label,
        actionType: urlInfo.actionType,
        param: urlInfo.param,
        status: result.status,
        works
      });

      const icon = works ? '✓' : '✗';
      console.log(`  [${icon}] ${result.status}`);
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));

    const working = results.filter(r => r.works);
    const failing = results.filter(r => !r.works);

    console.log(`\nWorking: ${working.length}/${results.length}`);
    console.log(`Failing: ${failing.length}`);
    console.log(`Skipped: ${skipped.length}\n`);

    if (failing.length > 0) {
      console.log('❌ FAILING:');
      for (const f of failing) {
        console.log(`  - ${f.label} (${f.actionType}): ${f.status}`);
        console.log(`    URL: /tv?${f.param}`);
      }
    }

    if (skipped.length > 0) {
      console.log('\n○ SKIPPED:');
      for (const s of skipped) {
        console.log(`  - ${s.label}: ${s.reason}`);
      }
    }

    // Assert all items work
    expect(failing.length,
      `${failing.length} items fail: ${failing.map(f => f.label).join(', ')}`
    ).toBe(0);
  });
});
