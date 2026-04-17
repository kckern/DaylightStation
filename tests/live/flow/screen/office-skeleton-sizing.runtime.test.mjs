/**
 * Office Screen Skeleton Sizing Test
 *
 * Holds API endpoints to keep widgets in skeleton state, measures their bounding boxes,
 * then releases APIs and measures hydrated dimensions.
 *
 * Verifies that skeleton loaders occupy roughly the same space as hydrated content
 * to prevent layout shift.
 *
 * Usage:
 *   npx playwright test tests/live/flow/screen/office-skeleton-sizing.runtime.test.mjs --headed
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

// Skeleton should be at least 80% of hydrated size (allows minor differences)
const MIN_SIZE_RATIO = 0.80;
// Skeleton should be at most 120% of hydrated size
const MAX_SIZE_RATIO = 1.20;

// Widgets to measure and the API endpoints that gate their loading
const WIDGET_CONFIGS = [
  { name: 'weight', selector: '.weight', api: '**/api/v1/lifelog/weight' },
  { name: 'finance', selector: '.finance', api: '**/api/v1/finance/data/daytoday' },
  { name: 'upcoming', selector: '.upcoming', api: '**/api/v1/home/events' },
  { name: 'entropy', selector: '.entropy-panel', api: '**/api/v1/home/entropy' },
];

/**
 * Measure bounding box of a widget's root element.
 */
async function measureWidget(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height, top: rect.top, left: rect.left };
  }, selector);
}

test.describe.serial('Office Screen Skeleton Sizing', () => {
  /** @type {import('@playwright/test').Page} */
  let page;
  const resolvers = {};
  const skeletonDims = {};
  const hydratedDims = {};

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    page = await context.newPage();

    // Set up API interception — hold all widget APIs
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

  test('navigate to office screen and wait for layout', async () => {
    await page.goto(`${FRONTEND_URL}/screen/office`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.screen-root', { timeout: 15000 });
    // Let the layout stabilize with skeletons rendered
    await page.waitForTimeout(1000);
  });

  test('measure skeleton dimensions', async () => {
    for (const config of WIDGET_CONFIGS) {
      const dims = await measureWidget(page, config.selector);
      skeletonDims[config.name] = dims;

      if (dims) {
        console.log(`  SKELETON ${config.name}: ${dims.width.toFixed(0)}x${dims.height.toFixed(0)}px`);
      } else {
        console.log(`  SKELETON ${config.name}: NOT FOUND`);
      }
    }
  });

  test('release APIs and measure hydrated dimensions', async () => {
    // Release all APIs
    for (const config of WIDGET_CONFIGS) {
      if (resolvers[config.name]) resolvers[config.name]();
    }

    // Wait for all widgets to hydrate
    await page.waitForTimeout(5000);

    for (const config of WIDGET_CONFIGS) {
      const dims = await measureWidget(page, config.selector);
      hydratedDims[config.name] = dims;

      if (dims) {
        console.log(`  HYDRATED ${config.name}: ${dims.width.toFixed(0)}x${dims.height.toFixed(0)}px`);
      } else {
        console.log(`  HYDRATED ${config.name}: NOT FOUND`);
      }
    }
  });

  test('skeleton and hydrated sizes are within tolerance', async () => {
    for (const config of WIDGET_CONFIGS) {
      const skeleton = skeletonDims[config.name];
      const hydrated = hydratedDims[config.name];

      if (!skeleton || !hydrated) {
        console.log(`  SKIP ${config.name}: missing measurements`);
        continue;
      }

      const widthRatio = skeleton.width / hydrated.width;
      const heightRatio = skeleton.height / hydrated.height;

      console.log(`  ${config.name}: width ${(widthRatio * 100).toFixed(0)}%, height ${(heightRatio * 100).toFixed(0)}%`);

      expect(widthRatio, `${config.name} width ratio ${widthRatio.toFixed(2)}`).toBeGreaterThanOrEqual(MIN_SIZE_RATIO);
      expect(widthRatio, `${config.name} width ratio ${widthRatio.toFixed(2)}`).toBeLessThanOrEqual(MAX_SIZE_RATIO);
      expect(heightRatio, `${config.name} height ratio ${heightRatio.toFixed(2)}`).toBeGreaterThanOrEqual(MIN_SIZE_RATIO);
      expect(heightRatio, `${config.name} height ratio ${heightRatio.toFixed(2)}`).toBeLessThanOrEqual(MAX_SIZE_RATIO);
    }
  });
});
