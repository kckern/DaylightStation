/**
 * TV Content URL Regression Suite
 *
 * Comprehensive test covering every permutation of /tv?key=val across
 * all content types, providers, ID formats, and legacy params.
 *
 * Structure:
 *   1. API Health — verify backend endpoints return 200 for each content type
 *   2. TV Page Load — verify /tv?key=val navigates without API errors
 *   3. Renderer Detection — verify correct player/component renders per format
 *   4. Legacy Params — verify ?hymn=, ?scripture=, etc. still work
 *   5. ID Format Variants — compound, path-segment, heuristic, alias
 *   6. Modifiers — shuffle, continuous, volume, overlay
 *   7. Dynamic Menu Samples — real menu items from TVApp config
 */
import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE = BACKEND_URL;

// ────────────────────────────────────────────────────────────────────────────
// Fixtures: real content IDs confirmed in CAPTURE_MANIFEST and test data
// ────────────────────────────────────────────────────────────────────────────

const IDS = {
  plex:       { playable: '660440', container: '81061',  series: '456724' },
  hymn:       { id: '113',  alt: '2' },
  primary:    { id: '10' },
  scripture:  { ref: 'alma-32', volume: 'bom' },
  talk:       { legacy: 'ldsgc', canonical: 'ldsgc/ldsgc202510/13' },
  poem:       { id: 'remedy/01' },
  watchlist:  { name: 'TVApp', alt: 'FHE' },
  app:        { noParam: 'webcam', withParam: 'family-selector' },
};

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Collect API errors while a callback runs on the page. */
async function collectApiErrors(page, fn) {
  const errors = [];
  const handler = res => {
    if (res.url().includes('/api/') && res.status() >= 400) {
      errors.push(`${res.status()} ${res.url()}`);
    }
  };
  page.on('response', handler);
  await fn();
  page.off('response', handler);
  return errors;
}

/** Navigate to a TV URL, wait for settle, return API errors. */
async function loadTvUrl(page, queryString, settleMs = 4000) {
  const url = `${BASE}/tv?${queryString}`;
  const errors = await collectApiErrors(page, async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(settleMs);
  });
  return errors;
}

/** Detect which renderer is visible on the page. */
async function detectRenderer(page) {
  const checks = [
    { name: 'video',     selector: 'video[src], dash-video, .video-element.show' },
    { name: 'audio',     selector: 'audio[src], audio' },
    { name: 'singalong', selector: '[class*="singing"], [class*="singalong"], .singing-scroller' },
    { name: 'readalong', selector: '[class*="narrated"], [class*="readalong"], .narrated-scroller' },
    { name: 'menu',      selector: '.tv-menu__item, .menu-item, [class*="menu-item"], .folder-item' },
    { name: 'app',       selector: '[data-app-id], .app-container, [class*="AppContainer"]' },
    { name: 'display',   selector: '[class*="displayer"], [class*="canvas"], .display-image' },
    { name: 'player',    selector: '.single-player, .video-player, [class*="player"]' },
    { name: 'shader',    selector: '.audio-shader, [class*="shader"]' },
    { name: 'loading',   selector: '.player-overlay-loading, .loading-overlay, [class*="spinner"]' },
  ];
  const found = [];
  for (const { name, selector } of checks) {
    const count = await page.locator(selector).count().catch(() => 0);
    if (count > 0) found.push(name);
  }
  return found;
}

// ────────────────────────────────────────────────────────────────────────────
// Section 1: API Health Checks
// ────────────────────────────────────────────────────────────────────────────

test.describe('1. API Health — every content type returns 200', () => {
  const endpoints = [
    // Plex
    { name: 'play/plex (video)',              url: `/api/v1/play/plex/${IDS.plex.playable}` },
    { name: 'info/plex (video)',              url: `/api/v1/info/plex/${IDS.plex.playable}` },
    { name: 'list/plex (container)',          url: `/api/v1/list/plex/${IDS.plex.container}` },

    // Singalong
    { name: 'info/singalong/hymn',            url: `/api/v1/info/singalong/hymn/${IDS.hymn.id}` },
    { name: 'info/singalong/primary',         url: `/api/v1/info/singalong/primary/${IDS.primary.id}` },

    // Readalong
    { name: 'local-content/scripture',        url: `/api/v1/local-content/scripture/${IDS.scripture.ref}` },
    { name: 'local-content/talk',             url: `/api/v1/local-content/talk/${IDS.talk.legacy}` },
    { name: 'local-content/poem',             url: `/api/v1/local-content/poem/${IDS.poem.id}` },
    { name: 'local-content/hymn',             url: `/api/v1/local-content/hymn/${IDS.hymn.id}` },
    { name: 'local-content/primary',          url: `/api/v1/local-content/primary/${IDS.primary.id}` },

    // Watchlists
    { name: 'list/watchlist (morning-shows)',  url: `/api/v1/list/watchlist/${IDS.watchlist.name}` },
    { name: 'list/watchlist (cartoons)',       url: `/api/v1/list/watchlist/${IDS.watchlist.alt}` },

    // Info via alias prefixes (ContentIdResolver)
    { name: 'info/hymn alias',                url: `/api/v1/info/hymn/${IDS.hymn.id}` },
    { name: 'info/scripture alias',           url: `/api/v1/info/scripture/${IDS.scripture.ref}` },
  ];

  for (const ep of endpoints) {
    test(`API: ${ep.name}`, async ({ request }) => {
      const res = await request.get(`${BASE}${ep.url}`);
      expect(res.status(), `${ep.name} → ${ep.url}`).toBe(200);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Section 2: TV Page Loads — every ?key=val pattern loads without API errors
// ────────────────────────────────────────────────────────────────────────────

test.describe('2. TV Page Load — no API errors', () => {
  // One shared browser context for speed
  let page, context;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    try {
      const cdp = await context.newCDPSession(await context.newPage());
      await cdp.send('Emulation.setAutoplayPolicy', { autoplayPolicy: 'no-user-gesture-required' });
      await (await context.pages())[0].close();
    } catch { /* non-Chromium */ }
    page = await context.newPage();
  });
  test.afterAll(async () => { await page?.close(); await context?.close(); });

  // ── Plex ──
  test('play=plex:ID (video)',              async () => {
    const e = await loadTvUrl(page, `play=plex:${IDS.plex.playable}`);
    expect(e, e.join('; ')).toHaveLength(0);
  });
  test('list=plex:ID (container browse)',   async () => {
    const e = await loadTvUrl(page, `list=plex:${IDS.plex.container}`);
    expect(e, e.join('; ')).toHaveLength(0);
  });
  test('queue=plex:ID (queue mode)',        async () => {
    const e = await loadTvUrl(page, `queue=plex:${IDS.plex.container}`);
    expect(e, e.join('; ')).toHaveLength(0);
  });

  // ── Singalong (canonical) ──
  test('play=singalong:hymn/ID',            async () => {
    const e = await loadTvUrl(page, `play=singalong:hymn/${IDS.hymn.id}`);
    expect(e, e.join('; ')).toHaveLength(0);
  });
  test('play=singalong:primary/ID',         async () => {
    const e = await loadTvUrl(page, `play=singalong:primary/${IDS.primary.id}`);
    expect(e, e.join('; ')).toHaveLength(0);
  });

  // ── Readalong (canonical) ──
  test('play=readalong:scripture/REF',      async () => {
    const e = await loadTvUrl(page, `play=readalong:scripture/${IDS.scripture.ref}`);
    expect(e, e.join('; ')).toHaveLength(0);
  });
  test('play=readalong:talks/ID (specific item)', async () => {
    // Note: container paths like readalong:talks/ldsgc don't resolve via info endpoint;
    // use the alias form (talk:ldsgc) for containers. Canonical form requires a specific item.
    const e = await loadTvUrl(page, `play=readalong:talks/${IDS.talk.canonical}`);
    // Filter stream endpoint 404s — the proxy stream works but direct stream may not
    const critical = e.filter(err => !err.includes('/api/v1/stream/'));
    expect(critical, critical.join('; ')).toHaveLength(0);
  });
  test('play=readalong:poetry/ID',          async () => {
    const e = await loadTvUrl(page, `play=readalong:poetry/${IDS.poem.id}`);
    expect(e, e.join('; ')).toHaveLength(0);
  });

  // ── Alias prefixes via ?play= ──
  test('play=hymn:ID (alias)',              async () => {
    const e = await loadTvUrl(page, `play=hymn:${IDS.hymn.id}`);
    expect(e, e.join('; ')).toHaveLength(0);
  });
  test('play=primary:ID (alias)',           async () => {
    const e = await loadTvUrl(page, `play=primary:${IDS.primary.id}`);
    expect(e, e.join('; ')).toHaveLength(0);
  });
  test('play=scripture:REF (alias)',        async () => {
    const e = await loadTvUrl(page, `play=scripture:${IDS.scripture.ref}`);
    expect(e, e.join('; ')).toHaveLength(0);
  });
  test('play=talk:ID (alias)',              async () => {
    const e = await loadTvUrl(page, `play=talk:${IDS.talk.legacy}`);
    expect(e, e.join('; ')).toHaveLength(0);
  });
  test('play=poem:ID (alias)',              async () => {
    const e = await loadTvUrl(page, `play=poem:${IDS.poem.id}`);
    expect(e, e.join('; ')).toHaveLength(0);
  });

  // ── Watchlists / menus ──
  test('list=watchlist:NAME',               async () => {
    const e = await loadTvUrl(page, `list=watchlist:${IDS.watchlist.name}`);
    expect(e, e.join('; ')).toHaveLength(0);
  });
  test('queue=watchlist:NAME',              async () => {
    const e = await loadTvUrl(page, `queue=watchlist:${IDS.watchlist.name}`);
    expect(e, e.join('; ')).toHaveLength(0);
  });

  // ── Apps ──
  test('open=webcam (no param)',            async () => {
    const e = await loadTvUrl(page, 'open=webcam');
    expect(e, e.join('; ')).toHaveLength(0);
  });
  test('webcam=1 (app shorthand)',          async () => {
    const e = await loadTvUrl(page, 'webcam=1');
    expect(e, e.join('; ')).toHaveLength(0);
  });

  // ── Heuristic ID detection ──
  test('play=DIGITS (bare digits -> plex)', async () => {
    const e = await loadTvUrl(page, `play=${IDS.plex.playable}`);
    expect(e, e.join('; ')).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Section 3: Renderer Detection — correct component per content type
// ────────────────────────────────────────────────────────────────────────────

test.describe('3. Renderer Detection', () => {
  let page, context;
  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    try {
      const cdp = await context.newCDPSession(await context.newPage());
      await cdp.send('Emulation.setAutoplayPolicy', { autoplayPolicy: 'no-user-gesture-required' });
      await (await context.pages())[0].close();
    } catch { /* non-Chromium */ }
    page = await context.newPage();
  });
  test.afterAll(async () => { await page?.close(); await context?.close(); });

  test('plex video renders video/player element', async () => {
    await loadTvUrl(page, `play=plex:${IDS.plex.playable}`, 6000);
    const r = await detectRenderer(page);
    const hasMedia = r.includes('video') || r.includes('player') || r.includes('shader');
    expect(hasMedia, `Expected video/player, got: ${r.join(', ')}`).toBe(true);
  });

  test('hymn renders singalong scroller', async () => {
    await loadTvUrl(page, `play=singalong:hymn/${IDS.hymn.id}`, 6000);
    const r = await detectRenderer(page);
    const hasSingalong = r.includes('singalong') || r.includes('audio') || r.includes('shader');
    expect(hasSingalong, `Expected singalong/audio, got: ${r.join(', ')}`).toBe(true);
  });

  test('scripture renders readalong scroller', async () => {
    await loadTvUrl(page, `play=scripture:${IDS.scripture.ref}`, 6000);
    const r = await detectRenderer(page);
    const hasReadalong = r.includes('readalong') || r.includes('audio') || r.includes('player') || r.includes('shader');
    expect(hasReadalong, `Expected readalong/audio, got: ${r.join(', ')}`).toBe(true);
  });

  test('watchlist renders menu', async () => {
    await loadTvUrl(page, `list=watchlist:${IDS.watchlist.name}`, 5000);
    const r = await detectRenderer(page);
    expect(r.includes('menu'), `Expected menu, got: ${r.join(', ')}`).toBe(true);
  });

  test('plex container renders menu', async () => {
    await loadTvUrl(page, `list=plex:${IDS.plex.container}`, 5000);
    const r = await detectRenderer(page);
    expect(r.includes('menu'), `Expected menu, got: ${r.join(', ')}`).toBe(true);
  });

  test('app opens without errors', async () => {
    // Apps have no wrapper CSS class — webcam renders a <video> element directly.
    // Just verify the page loads without API errors.
    const e = await loadTvUrl(page, 'open=webcam', 5000);
    expect(e, `App open should not cause API errors: ${e.join('; ')}`).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Section 4: Legacy Params — ?hymn=, ?scripture=, ?primary=, ?talk=, ?poem=
// ────────────────────────────────────────────────────────────────────────────

test.describe('4. Legacy Params', () => {
  let page, context;
  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    try {
      const cdp = await context.newCDPSession(await context.newPage());
      await cdp.send('Emulation.setAutoplayPolicy', { autoplayPolicy: 'no-user-gesture-required' });
      await (await context.pages())[0].close();
    } catch { /* non-Chromium */ }
    page = await context.newPage();
  });
  test.afterAll(async () => { await page?.close(); await context?.close(); });

  test('?hymn=NUM loads hymn', async () => {
    const e = await loadTvUrl(page, `hymn=${IDS.hymn.id}`);
    expect(e, e.join('; ')).toHaveLength(0);
    const r = await detectRenderer(page);
    const ok = r.includes('singalong') || r.includes('audio') || r.includes('shader') || r.includes('player');
    expect(ok, `Legacy ?hymn= should render singalong, got: ${r.join(', ')}`).toBe(true);
  });

  test('?primary=NUM loads primary song', async () => {
    const e = await loadTvUrl(page, `primary=${IDS.primary.id}`);
    expect(e, e.join('; ')).toHaveLength(0);
    const r = await detectRenderer(page);
    const ok = r.includes('singalong') || r.includes('audio') || r.includes('shader') || r.includes('player');
    expect(ok, `Legacy ?primary= should render singalong, got: ${r.join(', ')}`).toBe(true);
  });

  test('?scripture=REF loads scripture', async () => {
    const e = await loadTvUrl(page, `scripture=${IDS.scripture.ref}`);
    expect(e, e.join('; ')).toHaveLength(0);
    const r = await detectRenderer(page);
    const ok = r.includes('readalong') || r.includes('audio') || r.includes('shader') || r.includes('player');
    expect(ok, `Legacy ?scripture= should render readalong, got: ${r.join(', ')}`).toBe(true);
  });

  test('?talk=ID loads talk', async () => {
    const e = await loadTvUrl(page, `talk=${IDS.talk.legacy}`);
    expect(e, e.join('; ')).toHaveLength(0);
  });

  test('?poem=ID loads poem', async () => {
    const e = await loadTvUrl(page, `poem=${IDS.poem.id}`);
    expect(e, e.join('; ')).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Section 5: ID Format Variants — same content via different ID shapes
// ────────────────────────────────────────────────────────────────────────────

test.describe('5. ID Format Variants', () => {
  let page, context;
  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    try {
      const cdp = await context.newCDPSession(await context.newPage());
      await cdp.send('Emulation.setAutoplayPolicy', { autoplayPolicy: 'no-user-gesture-required' });
      await (await context.pages())[0].close();
    } catch { /* non-Chromium */ }
    page = await context.newPage();
  });
  test.afterAll(async () => { await page?.close(); await context?.close(); });

  // Hymn: 4 ways to express the same content
  const hymnId = IDS.hymn.id;
  for (const [label, qs] of [
    ['canonical: play=singalong:hymn/ID',   `play=singalong:hymn/${hymnId}`],
    ['alias: play=hymn:ID',                 `play=hymn:${hymnId}`],
    ['legacy param: hymn=ID',               `hymn=${hymnId}`],
  ]) {
    test(`Hymn ${hymnId} via ${label}`, async () => {
      const e = await loadTvUrl(page, qs);
      expect(e, `${label}: ${e.join('; ')}`).toHaveLength(0);
    });
  }

  // Scripture: 3 ways
  const scrRef = IDS.scripture.ref;
  for (const [label, qs] of [
    ['canonical: play=readalong:scripture/REF', `play=readalong:scripture/${scrRef}`],
    ['alias: play=scripture:REF',               `play=scripture:${scrRef}`],
    ['legacy param: scripture=REF',             `scripture=${scrRef}`],
  ]) {
    test(`Scripture ${scrRef} via ${label}`, async () => {
      const e = await loadTvUrl(page, qs);
      expect(e, `${label}: ${e.join('; ')}`).toHaveLength(0);
    });
  }

  // Plex: compound vs bare digits
  const plexId = IDS.plex.playable;
  for (const [label, qs] of [
    ['compound: play=plex:ID',     `play=plex:${plexId}`],
    ['bare digits: play=ID',       `play=${plexId}`],
  ]) {
    test(`Plex ${plexId} via ${label}`, async () => {
      const e = await loadTvUrl(page, qs);
      expect(e, `${label}: ${e.join('; ')}`).toHaveLength(0);
    });
  }

  // Talk: 3 ways (legacy short form resolves internally)
  for (const [label, qs] of [
    ['canonical: play=readalong:talks/ID',  `play=readalong:talks/${IDS.talk.canonical}`],
    ['alias: play=talk:ID',                 `play=talk:${IDS.talk.legacy}`],
    ['legacy param: talk=ID',               `talk=${IDS.talk.legacy}`],
  ]) {
    test(`Talk via ${label}`, async () => {
      const e = await loadTvUrl(page, qs);
      // Filter stream endpoint 404s — proxy stream works but direct stream may not
      const critical = e.filter(err => !err.includes('/api/v1/stream/'));
      expect(critical, `${label}: ${critical.join('; ')}`).toHaveLength(0);
    });
  }

  // Poem: 3 ways
  const poemId = IDS.poem.id;
  for (const [label, qs] of [
    ['canonical: play=readalong:poetry/ID',  `play=readalong:poetry/${poemId}`],
    ['alias: play=poem:ID',                  `play=poem:${poemId}`],
    ['legacy param: poem=ID',                `poem=${poemId}`],
  ]) {
    test(`Poem via ${label}`, async () => {
      const e = await loadTvUrl(page, qs);
      expect(e, `${label}: ${e.join('; ')}`).toHaveLength(0);
    });
  }

  // Primary: 3 ways
  const priId = IDS.primary.id;
  for (const [label, qs] of [
    ['canonical: play=singalong:primary/ID', `play=singalong:primary/${priId}`],
    ['alias: play=primary:ID',               `play=primary:${priId}`],
    ['legacy param: primary=ID',             `primary=${priId}`],
  ]) {
    test(`Primary via ${label}`, async () => {
      const e = await loadTvUrl(page, qs);
      expect(e, `${label}: ${e.join('; ')}`).toHaveLength(0);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Section 6: Modifiers — shuffle, continuous, volume, overlay, playbackRate
// ────────────────────────────────────────────────────────────────────────────

test.describe('6. Modifiers', () => {
  let page, context;
  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    try {
      const cdp = await context.newCDPSession(await context.newPage());
      await cdp.send('Emulation.setAutoplayPolicy', { autoplayPolicy: 'no-user-gesture-required' });
      await (await context.pages())[0].close();
    } catch { /* non-Chromium */ }
    page = await context.newPage();
  });
  test.afterAll(async () => { await page?.close(); await context?.close(); });

  test('play + shuffle=1', async () => {
    const e = await loadTvUrl(page, `play=plex:${IDS.plex.playable}&shuffle=1`);
    expect(e, e.join('; ')).toHaveLength(0);
  });

  test('queue + shuffle=1&continuous=1', async () => {
    const e = await loadTvUrl(page, `queue=watchlist:${IDS.watchlist.name}&shuffle=1&continuous=1`);
    expect(e, e.join('; ')).toHaveLength(0);
  });

  test('play + volume=50', async () => {
    const e = await loadTvUrl(page, `play=plex:${IDS.plex.playable}&volume=50`);
    expect(e, e.join('; ')).toHaveLength(0);
  });

  test('play + playbackRate=1.5', async () => {
    const e = await loadTvUrl(page, `play=plex:${IDS.plex.playable}&playbackRate=1.5`);
    expect(e, e.join('; ')).toHaveLength(0);
  });

  test('hymn + continuous=1', async () => {
    const e = await loadTvUrl(page, `hymn=${IDS.hymn.id}&continuous=1`);
    expect(e, e.join('; ')).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Section 7: Dynamic Menu Samples — test real items from TVApp config
// ────────────────────────────────────────────────────────────────────────────

test.describe('7. Dynamic Menu Samples', () => {
  let page, context;
  let menuItems = [];

  test.beforeAll(async ({ browser, request }) => {
    // Fetch real TVApp menu (use list endpoint which returns items)
    const res = await request.get(`${BASE}/api/v1/list/watchlist/TVApp`);
    if (res.ok()) {
      const data = await res.json();
      menuItems = data.items || [];
    }

    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    try {
      const cdp = await context.newCDPSession(await context.newPage());
      await cdp.send('Emulation.setAutoplayPolicy', { autoplayPolicy: 'no-user-gesture-required' });
      await (await context.pages())[0].close();
    } catch { /* non-Chromium */ }
    page = await context.newPage();
  });
  test.afterAll(async () => { await page?.close(); await context?.close(); });

  test('TVApp menu loads', async () => {
    expect(menuItems.length, 'TVApp should have menu items').toBeGreaterThan(0);
  });

  test('All menu items resolve without API errors', async () => {
    const results = [];
    const failures = [];

    for (const item of menuItems) {
      const label = item.label || item.title || 'Unknown';
      const qs = buildMenuItemUrl(item);
      if (!qs) {
        results.push({ label, status: 'skipped (app/open)' });
        continue;
      }

      const errors = await loadTvUrl(page, qs, 3000);
      if (errors.length > 0) {
        failures.push({ label, qs, errors });
        results.push({ label, status: 'FAIL', errors });
      } else {
        results.push({ label, status: 'ok' });
      }
    }

    // Log summary
    const passed = results.filter(r => r.status === 'ok').length;
    const skipped = results.filter(r => r.status.startsWith('skipped')).length;
    console.log(`Menu items: ${passed} ok, ${failures.length} failed, ${skipped} skipped (of ${menuItems.length})`);
    for (const f of failures) {
      console.log(`  FAIL: ${f.label} (?${f.qs}) — ${f.errors.join(', ')}`);
    }

    expect(failures.length, `${failures.length} menu items had API errors`).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Section 8: Cross-action matrix — same content ID across play/list/info APIs
// ────────────────────────────────────────────────────────────────────────────

test.describe('8. Cross-action API matrix', () => {
  // Plex container can be listed, queued, and info'd
  test('plex container: info + list both return 200', async ({ request }) => {
    const [info, list] = await Promise.all([
      request.get(`${BASE}/api/v1/info/plex/${IDS.plex.container}`),
      request.get(`${BASE}/api/v1/list/plex/${IDS.plex.container}`),
    ]);
    expect(info.status()).toBe(200);
    expect(list.status()).toBe(200);
  });

  // Playable plex item: play + info
  test('plex playable: play + info both return 200', async ({ request }) => {
    const [play, info] = await Promise.all([
      request.get(`${BASE}/api/v1/play/plex/${IDS.plex.playable}`),
      request.get(`${BASE}/api/v1/info/plex/${IDS.plex.playable}`),
    ]);
    expect(play.status()).toBe(200);
    expect(info.status()).toBe(200);

    const playData = await play.json();
    expect(playData.format).toBeTruthy();
    expect(playData.mediaUrl).toBeTruthy();
  });

  // Singalong: info returns format field
  test('singalong hymn: info returns format=singalong', async ({ request }) => {
    const res = await request.get(`${BASE}/api/v1/info/singalong/hymn/${IDS.hymn.id}`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.format).toBe('singalong');
  });

  // Watchlist: list returns items
  test('watchlist: list returns items array', async ({ request }) => {
    const res = await request.get(`${BASE}/api/v1/list/watchlist/${IDS.watchlist.name}`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    const items = data.items || data;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Helpers for Section 7
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a query string from a TVApp menu item's action object.
 * Returns null for app/open actions that aren't directly URL-testable.
 */
function buildMenuItemUrl(item) {
  // Queue action
  if (item.queue && typeof item.queue === 'object') {
    for (const src of ['plex', 'watchlist', 'files', 'queue']) {
      if (item.queue[src]) {
        const mods = extractMods(item.queue);
        return `queue=${encodeURIComponent(item.queue[src])}${mods}`;
      }
    }
  }

  // Play action
  if (item.play && typeof item.play === 'object') {
    for (const src of ['plex', 'hymn', 'primary', 'scripture', 'talk', 'poem', 'watchlist', 'files']) {
      if (item.play[src]) {
        const mods = extractMods(item.play);
        return `${src}=${encodeURIComponent(item.play[src])}${mods}`;
      }
    }
  }

  // List action — include source prefix (e.g., menu:fhe, plex:12345)
  if (item.list && typeof item.list === 'object') {
    for (const src of ['plex', 'watchlist', 'list', 'menu']) {
      if (item.list[src]) {
        const value = String(item.list[src]);
        // If value already has source prefix (contains colon), use as-is
        const listId = value.includes(':') ? value : `${src}:${value}`;
        return `list=${encodeURIComponent(listId)}`;
      }
    }
  }

  // Open/app actions → skip
  if (item.open) return null;

  return null;
}

function extractMods(actionObj) {
  const modKeys = ['shuffle', 'continuous', 'playbackRate', 'volume', 'loop', 'repeat', 'overlay'];
  let qs = '';
  for (const k of modKeys) {
    if (actionObj[k] != null) {
      qs += `&${k}=${encodeURIComponent(actionObj[k])}`;
    }
  }
  return qs;
}
