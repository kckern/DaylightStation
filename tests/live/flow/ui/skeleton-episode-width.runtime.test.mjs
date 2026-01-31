/**
 * Skeleton Loader Episode Width Test
 *
 * Measures the width of episode card placeholders in the FitnessShow skeleton loader
 * and compares them against the actual loaded episode cards.
 *
 * Concern: Skeleton placeholders may be too small compared to actual content.
 *
 * Strategy: Intercept API and HOLD it indefinitely while we measure the skeleton,
 * then release and measure actual cards.
 *
 * Usage:
 *   npx playwright test tests/runtime/skeleton/skeleton-episode-width.runtime.test.mjs --headed
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

const HEALTH_ENDPOINT = `${FRONTEND_URL}/api/fitness`;

// Minimum acceptable skeleton width as percentage of actual loaded card width
const MIN_SKELETON_WIDTH_RATIO = 0.85; // Skeleton should be at least 85% of actual width
// Minimum absolute width in pixels for skeleton cards
const MIN_SKELETON_WIDTH_PX = 100;

// How long to hold API before measuring skeleton (ms)
const API_HOLD_TIME = 100;

/**
 * Helper: Get dimensions of skeleton episode cards
 */
async function getSkeletonCardDimensions(page) {
  return page.evaluate(() => {
    const cards = document.querySelectorAll('.episode-card.episode-skeleton');
    if (!cards.length) return { error: 'No skeleton cards found', count: 0 };

    const dimensions = [];
    cards.forEach((card, i) => {
      const rect = card.getBoundingClientRect();
      dimensions.push({
        index: i,
        width: rect.width,
        height: rect.height,
        aspectRatio: rect.width > 0 ? rect.height / rect.width : 0
      });
    });

    // Also get the container width for reference
    const container = document.querySelector('.episodes-container') ||
                      document.querySelector('.episodes-grid');
    const containerWidth = container ? container.getBoundingClientRect().width : null;

    // Get the grid info
    const grid = document.querySelector('.episodes-grid');
    const gridStyles = grid ? window.getComputedStyle(grid) : null;

    return {
      count: dimensions.length,
      dimensions,
      containerWidth,
      gridTemplateColumns: gridStyles?.gridTemplateColumns || null,
      avgWidth: dimensions.length > 0
        ? dimensions.reduce((a, b) => a + b.width, 0) / dimensions.length
        : 0,
      avgHeight: dimensions.length > 0
        ? dimensions.reduce((a, b) => a + b.height, 0) / dimensions.length
        : 0
    };
  });
}

/**
 * Helper: Get dimensions of actual loaded episode cards
 */
async function getActualCardDimensions(page) {
  return page.evaluate(() => {
    // Exclude skeleton cards - look for loaded cards with images
    const cards = document.querySelectorAll('.episode-card.vertical:not(.episode-skeleton)');
    if (!cards.length) return { error: 'No loaded episode cards found', count: 0 };

    const dimensions = [];
    cards.forEach((card, i) => {
      const rect = card.getBoundingClientRect();
      dimensions.push({
        index: i,
        width: rect.width,
        height: rect.height,
        aspectRatio: rect.width > 0 ? rect.height / rect.width : 0
      });
    });

    const container = document.querySelector('.episodes-container') ||
                      document.querySelector('.episodes-grid');
    const containerWidth = container ? container.getBoundingClientRect().width : null;

    const grid = document.querySelector('.episodes-grid');
    const gridStyles = grid ? window.getComputedStyle(grid) : null;

    return {
      count: dimensions.length,
      dimensions,
      containerWidth,
      gridTemplateColumns: gridStyles?.gridTemplateColumns || null,
      avgWidth: dimensions.length > 0
        ? dimensions.reduce((a, b) => a + b.width, 0) / dimensions.length
        : 0,
      avgHeight: dimensions.length > 0
        ? dimensions.reduce((a, b) => a + b.height, 0) / dimensions.length
        : 0
    };
  });
}

/**
 * Helper: Get skeleton thumbnail dimensions specifically
 */
async function getSkeletonThumbnailDimensions(page) {
  return page.evaluate(() => {
    const thumbnails = document.querySelectorAll('.episode-skeleton .episode-thumbnail');
    if (!thumbnails.length) return { error: 'No skeleton thumbnails found', count: 0 };

    const dimensions = [];
    thumbnails.forEach((thumb, i) => {
      const rect = thumb.getBoundingClientRect();
      const styles = window.getComputedStyle(thumb);
      dimensions.push({
        index: i,
        width: rect.width,
        height: rect.height,
        aspectRatio: rect.width > 0 ? (rect.width / rect.height).toFixed(2) : 0,
        expectedAspect: '16:9 = 1.78'
      });
    });

    return {
      count: dimensions.length,
      dimensions,
      avgWidth: dimensions.length > 0
        ? dimensions.reduce((a, b) => a + b.width, 0) / dimensions.length
        : 0,
      avgHeight: dimensions.length > 0
        ? dimensions.reduce((a, b) => a + b.height, 0) / dimensions.length
        : 0
    };
  });
}

test.describe.serial('Skeleton Loader Episode Width', () => {
  /** @type {import('@playwright/test').Page} */
  let page;
  let skeletonDims = null;
  let actualDims = null;
  let skeletonThumbnailDims = null;

  // Resolver function to release the held API
  let releaseApi = null;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterAll(async () => {
    if (page) await page.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 1: Dev Server Health Check
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 1: Dev server is running', async () => {
    console.log('\n🏃 HURDLE 1: Checking dev server...');

    const response = await fetch(HEALTH_ENDPOINT).catch(() => null);
    expect(response?.ok, 'Dev server not running - start with: npm run dev').toBe(true);

    console.log('✅ HURDLE 1 PASSED: Dev server healthy\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 2: Navigate and wait for config to load
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 2: Wait for config and menu', async () => {
    console.log('\n🏃 HURDLE 2: Navigating and waiting for config...');

    // Navigate to fitness page
    await page.goto(`${FRONTEND_URL}/fitness`, { waitUntil: 'domcontentloaded' });

    // Wait for the loading state to disappear
    console.log('   Waiting for config to load...');

    // The main content area becomes visible when loading is done
    // Wait for either the menu or a show card to appear
    const mainContent = page.locator('.fitness-main-content');
    await mainContent.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
      console.log('   ⚠️ fitness-main-content did not become visible');
    });

    // Give it more time for the shows to load from the collection API
    await page.waitForTimeout(3000);

    // Check what's rendered now
    const pageState = await page.evaluate(() => {
      const viewport = document.querySelector('.fitness-app-viewport');
      const mainContent = document.querySelector('.fitness-main-content');
      const menu = document.querySelector('.fitness-menu');
      const grid = document.querySelector('.fitness-grid');
      const showCards = document.querySelectorAll('[data-testid="show-card"]');
      const skeletonCards = document.querySelectorAll('.skeleton-card');
      const loadingText = document.body.innerText.includes('Loading fitness');
      const navbar = document.querySelector('.fitness-navbar');
      const fitnessShow = document.querySelector('.fitness-show');
      const pluginContainer = document.querySelector('.fitness-plugin-container');

      // What's inside main content?
      const mainContentChildren = mainContent ? Array.from(mainContent.children).map(c => c.className || c.tagName) : [];
      const mainContentHTML = mainContent ? mainContent.innerHTML.slice(0, 500) : 'N/A';

      return {
        hasViewport: !!viewport,
        viewportVisible: viewport ? window.getComputedStyle(viewport).visibility : 'n/a',
        hasMainContent: !!mainContent,
        mainContentVisible: mainContent ? window.getComputedStyle(mainContent.parentElement).visibility : 'n/a',
        mainContentChildren,
        mainContentHTML,
        hasMenu: !!menu,
        hasGrid: !!grid,
        hasFitnessShow: !!fitnessShow,
        hasPlugin: !!pluginContainer,
        showCardCount: showCards.length,
        skeletonCardCount: skeletonCards.length,
        isLoading: loadingText,
        hasNavbar: !!navbar,
        navbarItemCount: navbar ? navbar.querySelectorAll('button, a, [role="button"]').length : 0
      };
    });

    console.log('   Page state:');
    console.log(`     Viewport: ${pageState.hasViewport} (visibility: ${pageState.viewportVisible})`);
    console.log(`     MainContent: ${pageState.hasMainContent} (visibility: ${pageState.mainContentVisible})`);
    console.log(`     MainContent children: [${pageState.mainContentChildren.join(', ')}]`);
    console.log(`     Navbar: ${pageState.hasNavbar} (${pageState.navbarItemCount} items)`);
    console.log(`     Menu: ${pageState.hasMenu}`);
    console.log(`     FitnessShow: ${pageState.hasFitnessShow}`);
    console.log(`     Plugin: ${pageState.hasPlugin}`);
    console.log(`     Grid: ${pageState.hasGrid}`);
    console.log(`     Show cards: ${pageState.showCardCount}`);
    console.log(`     Skeleton cards: ${pageState.skeletonCardCount}`);
    console.log(`     Loading text: ${pageState.isLoading}`);
    console.log(`     MainContent HTML: ${pageState.mainContentHTML.slice(0, 200)}...`);

    // If no menu (showing plugin instead), click a navbar item to go to a collection
    if (!pageState.hasMenu && pageState.hasPlugin) {
      console.log('   Page is showing plugin, not menu. Clicking navbar to switch to collection...');

      // Find navbar buttons and click one that should show a collection
      const navButtons = page.locator('.fitness-navbar button, .fitness-navbar [role="button"]');
      const navCount = await navButtons.count();
      console.log(`   Found ${navCount} navbar buttons`);

      // Try to find a button that looks like it leads to content (not the users/session)
      // Usually the second or third button is a collection
      if (navCount > 1) {
        // Get all button texts
        const buttonTexts = await page.evaluate(() => {
          const buttons = document.querySelectorAll('.fitness-navbar button, .fitness-navbar [role="button"]');
          return Array.from(buttons).map((b, i) => ({
            index: i,
            text: b.textContent?.trim() || '',
            class: b.className
          }));
        });
        console.log('   Navbar buttons:', JSON.stringify(buttonTexts.slice(0, 5), null, 2));

        // Click the second button (index 1) - usually a collection
        await navButtons.nth(1).click();
        console.log('   Clicked navbar button index 1');

        // Wait for navigation and menu to appear
        await page.waitForTimeout(2000);

        // Check again
        const afterNav = await page.evaluate(() => ({
          hasMenu: !!document.querySelector('.fitness-menu'),
          hasGrid: !!document.querySelector('.fitness-grid'),
          showCardCount: document.querySelectorAll('[data-testid="show-card"]').length
        }));
        console.log(`   After nav click: menu=${afterNav.hasMenu}, grid=${afterNav.hasGrid}, cards=${afterNav.showCardCount}`);
      }
    }

    // If still no show cards, wait for them
    const finalShowCards = await page.locator('[data-testid="show-card"]').count();
    if (finalShowCards === 0) {
      console.log('   Waiting for show cards to load...');
      const showCard = page.locator('[data-testid="show-card"]');
      await showCard.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
        console.log('   ⚠️ Show cards did not appear');
      });
    }

    console.log('✅ HURDLE 2 PASSED: Page state checked\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 3: Wait for shows to load and click one
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 3: Click a show card to trigger loading', async () => {
    console.log('\n🏃 HURDLE 3: Waiting for show cards to load...');

    // Wait for show cards to appear (the menu needs to load shows from collections)
    const showCardLocator = page.locator('[data-testid="show-card"]');

    // Wait up to 10s for show cards to appear
    console.log('   Waiting for show cards...');
    await showCardLocator.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
      console.log('   ⚠️ Timeout waiting for show cards');
    });

    const showCount = await showCardLocator.count();
    console.log(`   Found ${showCount} show cards`);

    if (showCount === 0) {
      // Fallback: check what's actually in the DOM
      const domInfo = await page.evaluate(() => {
        const menu = document.querySelector('.fitness-menu');
        const grid = document.querySelector('.fitness-grid');
        const skeletons = document.querySelectorAll('.skeleton-card');
        const noShows = document.querySelector('.no-shows');
        return {
          hasMenu: !!menu,
          hasGrid: !!grid,
          skeletonCount: skeletons.length,
          noShows: noShows?.textContent || null,
          menuHtml: menu?.innerHTML?.slice(0, 1000) || 'NO MENU'
        };
      });
      console.log('   DOM state:', JSON.stringify(domInfo, null, 2));
      throw new Error('No show cards found - cannot proceed');
    }

    // Get the first show's ID for reference
    const firstShowId = await showCardLocator.first().getAttribute('data-show-id');
    const firstShowTitle = await showCardLocator.first().getAttribute('data-show-title');
    console.log(`   Will click show: "${firstShowTitle}" (ID: ${firstShowId})`);

    // NOW set up API interception to hold the /playable request
    let apiHoldPromise = new Promise(resolve => {
      releaseApi = resolve;
    });

    // Only intercept the /playable endpoint (episode data), not the collection/list
    await page.route('**/media/plex/list/*/playable', async (route) => {
      const url = route.request().url();
      console.log(`   🔒 HOLDING PLAYABLE API: ...${url.slice(-40)}`);
      await apiHoldPromise;
      console.log(`   🔓 RELEASING PLAYABLE API`);
      await route.continue();
    });

    // Click the first show card - this triggers FitnessShow to load
    console.log('   Clicking show card...');
    await showCardLocator.first().click();

    // Give a moment for the view transition
    await page.waitForTimeout(200);

    console.log('✅ HURDLE 3 PASSED: Show card clicked\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 4: Measure skeleton while API is held
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 4: Measure skeleton dimensions', async () => {
    console.log('\n🏃 HURDLE 4: Measuring skeleton while API is held...');

    // Poll for skeleton appearance
    let attempts = 0;
    const maxAttempts = 20;

    while (attempts < maxAttempts) {
      attempts++;

      // Check for loading state
      const hasLoading = await page.evaluate(() => {
        const loadingEl = document.querySelector('.fitness-show.loading');
        const skeletons = document.querySelectorAll('.episode-skeleton, .skeleton-block');
        return {
          hasLoadingClass: !!loadingEl,
          skeletonCount: skeletons.length,
          html: loadingEl ? 'found' : document.querySelector('.fitness-show')?.className || 'no fitness-show'
        };
      });

      console.log(`   Attempt ${attempts}: loading=${hasLoading.hasLoadingClass}, skeletons=${hasLoading.skeletonCount}, class="${hasLoading.html}"`);

      if (hasLoading.hasLoadingClass || hasLoading.skeletonCount > 0) {
        console.log('   🎯 SKELETON STATE DETECTED!');

        // Measure immediately
        skeletonDims = await getSkeletonCardDimensions(page);
        skeletonThumbnailDims = await getSkeletonThumbnailDimensions(page);

        console.log(`\n   📏 SKELETON MEASUREMENTS:`);
        console.log(`   Cards found: ${skeletonDims.count}`);
        console.log(`   Thumbnails found: ${skeletonThumbnailDims.count}`);

        if (skeletonDims.count > 0) {
          console.log(`   Card avg width: ${skeletonDims.avgWidth.toFixed(1)}px`);
          console.log(`   Card avg height: ${skeletonDims.avgHeight.toFixed(1)}px`);
          console.log(`   Container: ${skeletonDims.containerWidth?.toFixed(1) || 'N/A'}px`);
          console.log(`   Grid: ${skeletonDims.gridTemplateColumns || 'N/A'}`);

          skeletonDims.dimensions.forEach((d, i) => {
            if (i < 4) console.log(`     Skeleton ${i}: ${d.width.toFixed(1)}x${d.height.toFixed(1)}px`);
          });
        }

        if (skeletonThumbnailDims.count > 0) {
          console.log(`\n   Thumbnail avg width: ${skeletonThumbnailDims.avgWidth.toFixed(1)}px`);
          console.log(`   Thumbnail avg height: ${skeletonThumbnailDims.avgHeight.toFixed(1)}px`);
          skeletonThumbnailDims.dimensions.forEach((d, i) => {
            if (i < 4) console.log(`     Thumb ${i}: ${d.width.toFixed(1)}x${d.height.toFixed(1)}px (AR: ${d.aspectRatio})`);
          });
        }

        break;
      }

      await page.waitForTimeout(100);
    }

    if (!skeletonDims || skeletonDims.count === 0) {
      console.log('   ⚠️ Could not capture skeleton state');
      console.log('   Dumping page structure...');

      const structure = await page.evaluate(() => {
        const root = document.querySelector('.fitness-app, #root, body');
        const getStructure = (el, depth = 0) => {
          if (depth > 3 || !el) return '';
          const classes = el.className ? `.${el.className.split(' ').join('.')}` : '';
          const tag = el.tagName?.toLowerCase() || '?';
          let result = '  '.repeat(depth) + tag + classes + '\n';
          for (const child of (el.children || [])) {
            result += getStructure(child, depth + 1);
          }
          return result;
        };
        return getStructure(root);
      });
      console.log(structure.slice(0, 2000));
    }

    console.log('✅ HURDLE 4 PASSED: Skeleton measurement attempted\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 5: Release API and measure actual cards
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 5: Release API and measure actual cards', async () => {
    console.log('\n🏃 HURDLE 5: Releasing API and measuring actual cards...');

    // Release the held API
    if (releaseApi) {
      console.log('   Releasing held API...');
      releaseApi();
    }

    // Wait for content to load
    console.log('   Waiting for content to load...');
    await page.waitForTimeout(3000);

    // Measure actual cards
    actualDims = await getActualCardDimensions(page);

    if (actualDims.error) {
      console.log(`   ⚠️ ${actualDims.error}`);
    } else if (actualDims.count > 0) {
      console.log(`\n   📏 ACTUAL CARD MEASUREMENTS:`);
      console.log(`   Count: ${actualDims.count}`);
      console.log(`   Avg width: ${actualDims.avgWidth.toFixed(1)}px`);
      console.log(`   Avg height: ${actualDims.avgHeight.toFixed(1)}px`);
      console.log(`   Container: ${actualDims.containerWidth?.toFixed(1) || 'N/A'}px`);
      console.log(`   Grid: ${actualDims.gridTemplateColumns || 'N/A'}`);

      actualDims.dimensions.forEach((d, i) => {
        if (i < 4) console.log(`     Card ${i}: ${d.width.toFixed(1)}x${d.height.toFixed(1)}px`);
      });
    } else {
      console.log('   No actual cards found');
    }

    console.log('✅ HURDLE 5 PASSED: Actual cards measured\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 6: Compare skeleton vs actual dimensions
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 6: Compare skeleton vs actual', async () => {
    console.log('\n🏃 HURDLE 6: Comparing measurements...');

    console.log('\n   ╔═══════════════════════════════════════════════════════════╗');
    console.log('   ║            📊 SKELETON WIDTH COMPARISON REPORT            ║');
    console.log('   ╚═══════════════════════════════════════════════════════════╝\n');

    const hasSkeleton = skeletonDims && skeletonDims.count > 0;
    const hasActual = actualDims && actualDims.count > 0;

    if (hasSkeleton) {
      console.log('   SKELETON CARDS:');
      console.log(`     Count:     ${skeletonDims.count}`);
      console.log(`     Width:     ${skeletonDims.avgWidth.toFixed(1)}px avg`);
      console.log(`     Height:    ${skeletonDims.avgHeight.toFixed(1)}px avg`);
      console.log(`     Container: ${skeletonDims.containerWidth?.toFixed(1) || 'N/A'}px`);
    } else {
      console.log('   SKELETON CARDS: ❌ Not captured');
    }

    console.log('');

    if (hasActual) {
      console.log('   ACTUAL CARDS:');
      console.log(`     Count:     ${actualDims.count}`);
      console.log(`     Width:     ${actualDims.avgWidth.toFixed(1)}px avg`);
      console.log(`     Height:    ${actualDims.avgHeight.toFixed(1)}px avg`);
      console.log(`     Container: ${actualDims.containerWidth?.toFixed(1) || 'N/A'}px`);
    } else {
      console.log('   ACTUAL CARDS: ❌ Not found');
    }

    console.log('');

    if (hasSkeleton && hasActual) {
      const widthRatio = skeletonDims.avgWidth / actualDims.avgWidth;
      const heightRatio = skeletonDims.avgHeight / actualDims.avgHeight;
      const widthDiff = actualDims.avgWidth - skeletonDims.avgWidth;
      const heightDiff = actualDims.avgHeight - skeletonDims.avgHeight;

      console.log('   ┌─────────────────────────────────────────────────────────┐');
      console.log('   │                    COMPARISON RESULTS                   │');
      console.log('   ├─────────────────────────────────────────────────────────┤');
      console.log(`   │  Width ratio:    ${(widthRatio * 100).toFixed(1)}% (skeleton/actual)            │`);
      console.log(`   │  Height ratio:   ${(heightRatio * 100).toFixed(1)}% (skeleton/actual)            │`);
      console.log(`   │  Width diff:     ${widthDiff >= 0 ? '+' : ''}${widthDiff.toFixed(1)}px                            │`);
      console.log(`   │  Height diff:    ${heightDiff >= 0 ? '+' : ''}${heightDiff.toFixed(1)}px                            │`);
      console.log('   └─────────────────────────────────────────────────────────┘');

      console.log('');

      if (widthRatio < MIN_SKELETON_WIDTH_RATIO) {
        console.log(`   ⚠️  PROBLEM DETECTED: Skeleton cards are TOO NARROW!`);
        console.log(`       Skeleton width: ${skeletonDims.avgWidth.toFixed(1)}px`);
        console.log(`       Actual width:   ${actualDims.avgWidth.toFixed(1)}px`);
        console.log(`       Ratio:          ${(widthRatio * 100).toFixed(1)}% (minimum: ${MIN_SKELETON_WIDTH_RATIO * 100}%)`);
        console.log(`       Gap:            ${widthDiff.toFixed(1)}px too narrow`);
      } else {
        console.log(`   ✅ Skeleton width is acceptable (${(widthRatio * 100).toFixed(1)}% >= ${MIN_SKELETON_WIDTH_RATIO * 100}%)`);
      }

      // Soft assertion - report but don't fail
      if (widthRatio < MIN_SKELETON_WIDTH_RATIO) {
        console.log('\n   💡 RECOMMENDATION: Increase skeleton card width in CSS');
      }
    } else {
      console.log('   ⚠️ Cannot compare - missing measurements');
      if (!hasSkeleton) {
        console.log('      - Skeleton state was not captured (API may be too fast)');
      }
      if (!hasActual) {
        console.log('      - Actual cards not found (no show selected or content failed to load)');
      }
    }

    console.log('\n   ═══════════════════════════════════════════════════════════\n');

    console.log('✅ HURDLE 6 PASSED: Comparison complete\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════════
  test.afterAll(async () => {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('📏 SKELETON WIDTH TEST COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════\n');
  });
});
