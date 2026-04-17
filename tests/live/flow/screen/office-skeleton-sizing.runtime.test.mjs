/**
 * Office Screen Skeleton Sizing Test
 *
 * Holds widget API endpoints to keep widgets in skeleton state, measures bounding
 * boxes, then releases and compares against hydrated dimensions.
 *
 * Usage:
 *   npx playwright test tests/live/flow/screen/office-skeleton-sizing.runtime.test.mjs --headed
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

// Skeleton should be within this range of hydrated size
const MIN_RATIO = 0.80;
const MAX_RATIO = 1.20;

// Widgets to measure and the API endpoints that gate their loading.
// Patterns must NOT match /api/v1/screens/* (the config endpoint).
const WIDGET_CONFIGS = [
  { name: 'weight', selector: '.weight', api: /\/api\/v1\/lifelog\/weight/ },
  { name: 'finance', selector: '.finance', api: /\/api\/v1\/finance\/data\/daytoday/ },
  { name: 'upcoming', selector: '.upcoming', api: /\/api\/v1\/home\/events/ },
  { name: 'entropy', selector: '.entropy-panel', api: /\/api\/v1\/home\/entropy/ },
];

/**
 * Measure all widgets: inner content element AND parent screen-widget wrapper.
 */
async function measureAll(page) {
  return page.evaluate((configs) => {
    const results = {};
    for (const { name, selector } of configs) {
      const inner = document.querySelector(selector);
      if (!inner) {
        results[name] = null;
        continue;
      }
      const wrapper = inner.closest('.screen-widget');
      const innerRect = inner.getBoundingClientRect();
      const wrapperRect = wrapper ? wrapper.getBoundingClientRect() : null;

      results[name] = {
        inner: { w: Math.round(innerRect.width), h: Math.round(innerRect.height) },
        wrapper: wrapperRect ? { w: Math.round(wrapperRect.width), h: Math.round(wrapperRect.height) } : null,
        innerFills: {
          width: wrapperRect ? Math.round(innerRect.width / wrapperRect.width * 100) : 0,
          height: wrapperRect ? Math.round(innerRect.height / wrapperRect.height * 100) : 0,
        },
      };
    }

    // Also measure the layout areas (columns)
    const areas = document.querySelectorAll('.screen-area');
    results._areas = Array.from(areas).map((a, i) => {
      const r = a.getBoundingClientRect();
      const s = window.getComputedStyle(a);
      return {
        index: i,
        w: Math.round(r.width), h: Math.round(r.height),
        grow: s.flexGrow, basis: s.flexBasis,
      };
    });

    return results;
  }, WIDGET_CONFIGS.map(c => ({ name: c.name, selector: c.selector })));
}

test.describe.serial('Office Screen Skeleton Sizing', () => {
  /** @type {import('@playwright/test').Page} */
  let page;
  const resolvers = {};
  let skeletonState = null;
  let hydratedState = null;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    page = await context.newPage();

    // Set up API interception BEFORE navigation — use regex patterns
    // so they don't accidentally match the /api/v1/screens/office config endpoint.
    for (const config of WIDGET_CONFIGS) {
      const holdPromise = new Promise(resolve => {
        resolvers[config.name] = resolve;
      });
      await page.route(config.api, async (route) => {
        await holdPromise;
        await route.continue();
      });
    }
  });

  test.afterAll(async () => {
    if (page) await page.close();
  });

  test('navigate and measure skeleton state', async () => {
    await page.goto(`${FRONTEND_URL}/screen/office`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.screen-root', { timeout: 15000 });
    await page.waitForTimeout(1500);

    // Screenshot skeleton state
    await page.screenshot({ path: 'test-results/skeleton-state.png' });

    skeletonState = await measureAll(page);

    console.log('\n=== SKELETON STATE ===');
    console.log('Areas:', JSON.stringify(skeletonState._areas));
    for (const config of WIDGET_CONFIGS) {
      const m = skeletonState[config.name];
      if (!m) { console.log(`  ${config.name}: NOT FOUND`); continue; }
      console.log(`  ${config.name}: wrapper=${m.wrapper?.w}x${m.wrapper?.h}  inner=${m.inner.w}x${m.inner.h}  fills=${m.innerFills.width}%w ${m.innerFills.height}%h`);
    }
  });

  test('release APIs and measure hydrated state', async () => {
    for (const config of WIDGET_CONFIGS) {
      if (resolvers[config.name]) resolvers[config.name]();
    }

    await page.waitForTimeout(5000);

    await page.screenshot({ path: 'test-results/hydrated-state.png' });

    hydratedState = await measureAll(page);

    console.log('\n=== HYDRATED STATE ===');
    console.log('Areas:', JSON.stringify(hydratedState._areas));
    for (const config of WIDGET_CONFIGS) {
      const m = hydratedState[config.name];
      if (!m) { console.log(`  ${config.name}: NOT FOUND`); continue; }
      console.log(`  ${config.name}: wrapper=${m.wrapper?.w}x${m.wrapper?.h}  inner=${m.inner.w}x${m.inner.h}  fills=${m.innerFills.width}%w ${m.innerFills.height}%h`);
    }
  });

  test('skeleton vs hydrated wrapper sizes within 80-120%', async () => {
    console.log('\n=== COMPARISON ===');
    const failures = [];

    for (const config of WIDGET_CONFIGS) {
      const sk = skeletonState?.[config.name];
      const hy = hydratedState?.[config.name];
      if (!sk?.wrapper || !hy?.wrapper) {
        console.log(`  SKIP ${config.name}: missing measurements`);
        continue;
      }

      const wRatio = sk.wrapper.w / hy.wrapper.w;
      const hRatio = sk.wrapper.h / hy.wrapper.h;
      const wOk = wRatio >= MIN_RATIO && wRatio <= MAX_RATIO;
      const hOk = hRatio >= MIN_RATIO && hRatio <= MAX_RATIO;

      console.log(`  ${wOk && hOk ? 'PASS' : 'FAIL'} ${config.name}: ${sk.wrapper.w}x${sk.wrapper.h} → ${hy.wrapper.w}x${hy.wrapper.h}  (w=${(wRatio*100).toFixed(0)}% h=${(hRatio*100).toFixed(0)}%)`);

      if (!wOk) failures.push(`${config.name} width: ${(wRatio*100).toFixed(0)}% (want ${MIN_RATIO*100}-${MAX_RATIO*100}%)`);
      if (!hOk) failures.push(`${config.name} height: ${(hRatio*100).toFixed(0)}% (want ${MIN_RATIO*100}-${MAX_RATIO*100}%)`);
    }

    if (failures.length > 0) {
      console.log(`\n  FAILURES:`);
      for (const f of failures) console.log(`    - ${f}`);
    }

    for (const f of failures) {
      expect.soft(false, f).toBe(true);
    }
  });
});
