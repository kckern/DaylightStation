/**
 * Music Player Width Stability Test
 *
 * Tests that the FitnessMusicPlayer doesn't cause scrollbar spasms when
 * songs change. The width of the music player and its container should
 * remain stable across track transitions.
 *
 * Concern: When a new song plays, the container width briefly changes,
 * causing scrollbars to appear and disappear (visual "spasm").
 *
 * Strategy:
 * 1. Navigate to fitness and select a show (Speed Train)
 * 2. Start playback - music player appears in sidebar
 * 3. Advance songs multiple times
 * 4. Monitor container dimensions for any width fluctuations
 *
 * Usage:
 *   npx playwright test tests/runtime/music-player/music-player-width-stability.runtime.test.mjs --headed
 */

import { test, expect } from '@playwright/test';

const FRONTEND_URL = 'http://localhost:3111';
const HEALTH_ENDPOINT = `${FRONTEND_URL}/api/fitness`;

// How many song advances to test
const SONG_ADVANCE_COUNT = 5;
// Time to wait after each song advance to observe layout changes
const POST_ADVANCE_OBSERVE_MS = 1500;
// Acceptable width deviation in pixels (0 = perfect stability)
const MAX_WIDTH_DEVIATION_PX = 2;

/**
 * Helper: Get dimensions of music player container and sidebar
 */
async function getMusicPlayerDimensions(page) {
  return page.evaluate(() => {
    const sidebar = document.querySelector('.fitness-cam-sidebar');
    const musicContainer = document.querySelector('.fitness-music-player-container');
    const musicContent = document.querySelector('.music-player-content');
    const trackInfo = document.querySelector('.music-player-info');
    const trackTitle = document.querySelector('.track-title');

    // Check for scrollbars
    const hasHorizontalScroll = (el) => el && el.scrollWidth > el.clientWidth;
    const hasVerticalScroll = (el) => el && el.scrollHeight > el.clientHeight;

    return {
      sidebar: sidebar ? {
        width: sidebar.getBoundingClientRect().width,
        scrollWidth: sidebar.scrollWidth,
        clientWidth: sidebar.clientWidth,
        hasHScrollbar: hasHorizontalScroll(sidebar),
        hasVScrollbar: hasVerticalScroll(sidebar),
        overflowX: window.getComputedStyle(sidebar).overflowX,
        overflowY: window.getComputedStyle(sidebar).overflowY
      } : null,
      musicContainer: musicContainer ? {
        width: musicContainer.getBoundingClientRect().width,
        scrollWidth: musicContainer.scrollWidth,
        clientWidth: musicContainer.clientWidth,
        hasHScrollbar: hasHorizontalScroll(musicContainer),
        computedWidth: window.getComputedStyle(musicContainer).width,
        maxWidth: window.getComputedStyle(musicContainer).maxWidth
      } : null,
      musicContent: musicContent ? {
        width: musicContent.getBoundingClientRect().width
      } : null,
      trackInfo: trackInfo ? {
        width: trackInfo.getBoundingClientRect().width,
        scrollWidth: trackInfo.scrollWidth,
        overflow: window.getComputedStyle(trackInfo).overflow
      } : null,
      trackTitle: trackTitle ? {
        text: trackTitle.textContent?.substring(0, 50),
        width: trackTitle.getBoundingClientRect().width,
        scrollWidth: trackTitle.scrollWidth
      } : null,
      timestamp: Date.now()
    };
  });
}

/**
 * Helper: Click the Next button on the music player
 */
async function advanceSong(page) {
  const nextButton = page.locator('.fitness-music-player-container .next-button, .control-button.next-button');
  if (await nextButton.isVisible({ timeout: 2000 })) {
    await nextButton.click();
    return true;
  }
  return false;
}

/**
 * Helper: Monitor width changes over a period
 */
async function monitorWidthStability(page, durationMs = 1000, intervalMs = 50) {
  const samples = [];
  const startTime = Date.now();

  while (Date.now() - startTime < durationMs) {
    const dims = await getMusicPlayerDimensions(page);
    samples.push(dims);
    await page.waitForTimeout(intervalMs);
  }

  return samples;
}

/**
 * Analyze width samples for stability
 */
function analyzeWidthStability(samples, componentKey = 'musicContainer') {
  const widths = samples
    .filter(s => s[componentKey]?.width)
    .map(s => s[componentKey].width);

  if (widths.length === 0) return { stable: true, reason: 'no samples' };

  const minWidth = Math.min(...widths);
  const maxWidth = Math.max(...widths);
  const deviation = maxWidth - minWidth;
  const avgWidth = widths.reduce((a, b) => a + b, 0) / widths.length;

  // Check for scrollbar appearances
  const scrollbarAppearances = samples.filter(s =>
    s[componentKey]?.hasHScrollbar || s.sidebar?.hasHScrollbar
  ).length;

  return {
    stable: deviation <= MAX_WIDTH_DEVIATION_PX && scrollbarAppearances === 0,
    minWidth,
    maxWidth,
    deviation,
    avgWidth,
    sampleCount: widths.length,
    scrollbarAppearances,
    widthHistory: widths.slice(0, 10).map(w => w.toFixed(1))
  };
}

test.describe.serial('Music Player Width Stability', () => {
  /** @type {import('@playwright/test').Page} */
  let page;
  let baselineDimensions = null;
  let allWidthSamples = [];

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
  // HURDLE 2: Navigate to Fitness and Wait for Menu
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 2: Navigate to fitness page', async () => {
    console.log('\n🏃 HURDLE 2: Navigating to fitness...');

    await page.goto(`${FRONTEND_URL}/fitness`, { waitUntil: 'domcontentloaded' });

    // Wait for the main content to appear
    const mainContent = page.locator('.fitness-main-content');
    await mainContent.waitFor({ state: 'visible', timeout: 15000 });

    // Give it time to load collections
    await page.waitForTimeout(3000);

    console.log('✅ HURDLE 2 PASSED: Fitness page loaded\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 3: Navigate to Strength Collection
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 3: Navigate to Strength collection', async () => {
    console.log('\n🏃 HURDLE 3: Navigating to Strength collection...');

    // The page starts on "Fitness Dashboard" (Home plugin)
    // Need to click a collection nav button like "Strength" to see shows
    // Use the .nav-item class that governance tests use
    const strengthButton = page.locator('.fitness-navbar button.nav-item', { hasText: 'Strength' });

    const isStrengthVisible = await strengthButton.isVisible({ timeout: 5000 }).catch(() => false);

    if (isStrengthVisible) {
      console.log('   Clicking Strength nav button...');
      await strengthButton.click();
    } else {
      throw new Error('Strength nav button not found');
    }

    // Wait for menu to load
    await page.waitForTimeout(3000);

    // Verify we're now seeing show cards
    const showCards = page.locator('[data-testid="show-card"]');
    await expect(showCards.first()).toBeVisible({ timeout: 10000 });

    const showCount = await showCards.count();
    console.log(`   Collection loaded with ${showCount} shows`);

    console.log('✅ HURDLE 3 PASSED: Collection loaded\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 4: Select the First Show in Strength Collection
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 4: Select first show', async () => {
    console.log('\n🏃 HURDLE 4: Selecting first show in Strength collection...');

    // Get all available shows
    const showInfo = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-testid="show-card"]');
      return Array.from(cards).map(card => ({
        id: card.getAttribute('data-show-id'),
        title: card.getAttribute('data-show-title')
      }));
    });

    console.log(`   Found ${showInfo.length} shows:`);
    showInfo.slice(0, 5).forEach(s => console.log(`     - ${s.title} (${s.id})`));

    // Select the first show
    const firstShow = showInfo[0];
    if (!firstShow) {
      throw new Error('No shows found in Strength collection');
    }

    // Click the first show
    const showCard = page.locator('[data-testid="show-card"]').first();
    await expect(showCard).toBeVisible({ timeout: 5000 });

    console.log(`   Clicking show: ${firstShow.title}`);
    await showCard.click();
    await page.waitForTimeout(2000);

    console.log('✅ HURDLE 4 PASSED: Show selected\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 5: Start Episode Playback
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 5: Start episode playback', async () => {
    console.log('\n🏃 HURDLE 5: Starting episode playback...');

    // Wait for episodes to load
    const episodeThumbnail = page.locator('.episode-card .episode-thumbnail').first();
    await expect(episodeThumbnail).toBeVisible({ timeout: 10000 });

    // Get episode info
    const episodeTitle = await page.locator('.episode-card .episode-title').first().textContent().catch(() => 'Episode');
    console.log(`   Playing: ${episodeTitle?.substring(0, 50).trim()}`);

    // Click to play
    await episodeThumbnail.click();
    await page.waitForTimeout(3000);

    // Verify video player appeared
    const videoPlayer = page.locator('.fitness-player, .fitness-cam-stage, video');
    const hasPlayer = await videoPlayer.first().isVisible({ timeout: 10000 }).catch(() => false);

    if (hasPlayer) {
      console.log('   Video player visible');
    } else {
      console.log('   ⚠️ Video player not immediately visible (may be loading)');
    }

    console.log('✅ HURDLE 5 PASSED: Playback started\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 6: Wait for Music Player to Appear
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 6: Music player appears in sidebar', async () => {
    console.log('\n🏃 HURDLE 6: Waiting for music player...');

    // Music player should appear in the sidebar
    const musicPlayer = page.locator('.fitness-music-player-container');

    // Give it time to appear (may depend on video starting)
    await page.waitForTimeout(5000);

    const isVisible = await musicPlayer.isVisible({ timeout: 15000 }).catch(() => false);

    if (!isVisible) {
      // Check what's in the sidebar
      const sidebarContent = await page.evaluate(() => {
        const sidebar = document.querySelector('.fitness-cam-sidebar');
        return {
          exists: !!sidebar,
          classes: sidebar?.className,
          innerHTML: sidebar?.innerHTML?.substring(0, 500)
        };
      });
      console.log('   Sidebar state:', JSON.stringify(sidebarContent, null, 2));
    }

    expect(isVisible, 'Music player not visible in sidebar').toBe(true);

    // Get baseline dimensions
    baselineDimensions = await getMusicPlayerDimensions(page);
    console.log(`   Music player baseline width: ${baselineDimensions.musicContainer?.width?.toFixed(1)}px`);
    console.log(`   Sidebar width: ${baselineDimensions.sidebar?.width?.toFixed(1)}px`);
    console.log(`   Track: ${baselineDimensions.trackTitle?.text || 'Unknown'}`);

    console.log('✅ HURDLE 6 PASSED: Music player visible\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 7: Advance Songs and Monitor Width Stability
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 7: Test width stability across song changes', async () => {
    console.log('\n🏃 HURDLE 7: Testing width stability across song changes...');
    console.log(`   Will advance ${SONG_ADVANCE_COUNT} songs and monitor for scrollbar spasms\n`);

    const results = [];

    for (let i = 0; i < SONG_ADVANCE_COUNT; i++) {
      console.log(`   --- Song Advance ${i + 1}/${SONG_ADVANCE_COUNT} ---`);

      // Get pre-advance dimensions
      const preDims = await getMusicPlayerDimensions(page);
      console.log(`   Pre-advance width: ${preDims.musicContainer?.width?.toFixed(1)}px`);
      console.log(`   Current track: ${preDims.trackTitle?.text || 'Unknown'}`);

      // Advance the song
      const advanced = await advanceSong(page);
      if (!advanced) {
        console.log('   ⚠️ Could not click next button');
        continue;
      }

      // Monitor width stability immediately after advance
      console.log('   Monitoring for width fluctuations...');
      const samples = await monitorWidthStability(page, POST_ADVANCE_OBSERVE_MS, 30);
      allWidthSamples.push(...samples);

      // Analyze this batch
      const analysis = analyzeWidthStability(samples);

      // Get post-advance dimensions
      const postDims = samples[samples.length - 1];
      const newTrack = postDims?.trackTitle?.text || 'Unknown';

      console.log(`   Post-advance width: ${postDims?.musicContainer?.width?.toFixed(1)}px`);
      console.log(`   New track: ${newTrack}`);
      console.log(`   Width deviation: ${analysis.deviation.toFixed(2)}px (${analysis.sampleCount} samples)`);
      console.log(`   Scrollbar appearances: ${analysis.scrollbarAppearances}`);

      if (!analysis.stable) {
        console.log(`   ⚠️ INSTABILITY DETECTED:`);
        console.log(`      Min: ${analysis.minWidth.toFixed(1)}px, Max: ${analysis.maxWidth.toFixed(1)}px`);
        console.log(`      Width history: [${analysis.widthHistory.join(', ')}]`);
      }

      results.push({
        advance: i + 1,
        preDims,
        postDims,
        analysis,
        stable: analysis.stable
      });

      // Small delay before next advance
      await page.waitForTimeout(500);
    }

    // Summary
    console.log('\n   ╔═══════════════════════════════════════════════════════════╗');
    console.log('   ║            📊 WIDTH STABILITY SUMMARY                      ║');
    console.log('   ╚═══════════════════════════════════════════════════════════╝\n');

    const unstableCount = results.filter(r => !r.stable).length;
    const totalScrollbars = results.reduce((sum, r) => sum + r.analysis.scrollbarAppearances, 0);
    const maxDeviation = Math.max(...results.map(r => r.analysis.deviation));

    console.log(`   Total song advances: ${SONG_ADVANCE_COUNT}`);
    console.log(`   Unstable transitions: ${unstableCount}`);
    console.log(`   Total scrollbar appearances: ${totalScrollbars}`);
    console.log(`   Maximum width deviation: ${maxDeviation.toFixed(2)}px`);
    console.log(`   Baseline width: ${baselineDimensions?.musicContainer?.width?.toFixed(1)}px`);

    // Overall analysis across all samples
    const overallAnalysis = analyzeWidthStability(allWidthSamples);
    console.log(`\n   Overall deviation across all ${overallAnalysis.sampleCount} samples: ${overallAnalysis.deviation.toFixed(2)}px`);

    if (unstableCount > 0 || totalScrollbars > 0) {
      console.log('\n   ⚠️ WIDTH INSTABILITY DETECTED');
      console.log('   This may cause visible scrollbar "spasms" during song transitions.');
      console.log('   Investigate CSS width constraints on .music-player-info and .track-details');
    } else {
      console.log('\n   ✅ Width remained stable across all song transitions');
    }

    console.log('\n✅ HURDLE 7 PASSED: Width stability tested\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 8: Final Assertions
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 8: Assert width stability requirements', async () => {
    console.log('\n🏃 HURDLE 8: Final assertions...');

    const overallAnalysis = analyzeWidthStability(allWidthSamples);

    // Soft assertions - report issues but document what we found
    console.log(`   Width deviation: ${overallAnalysis.deviation.toFixed(2)}px`);
    console.log(`   Max allowed: ${MAX_WIDTH_DEVIATION_PX}px`);
    console.log(`   Scrollbar appearances: ${overallAnalysis.scrollbarAppearances}`);

    // This test documents the issue - assertion can be adjusted based on findings
    if (overallAnalysis.deviation > MAX_WIDTH_DEVIATION_PX) {
      console.log(`\n   ⚠️ FAILING: Width deviation (${overallAnalysis.deviation.toFixed(2)}px) exceeds threshold (${MAX_WIDTH_DEVIATION_PX}px)`);
      console.log('   Width fluctuation detected - this likely causes scrollbar spasms');
    }

    if (overallAnalysis.scrollbarAppearances > 0) {
      console.log(`\n   ⚠️ FAILING: Scrollbars appeared ${overallAnalysis.scrollbarAppearances} times during transitions`);
    }

    // Assert stability
    expect(overallAnalysis.deviation,
      `Width deviation (${overallAnalysis.deviation.toFixed(2)}px) exceeds ${MAX_WIDTH_DEVIATION_PX}px threshold`
    ).toBeLessThanOrEqual(MAX_WIDTH_DEVIATION_PX);

    expect(overallAnalysis.scrollbarAppearances,
      `Scrollbars appeared ${overallAnalysis.scrollbarAppearances} times`
    ).toBe(0);

    console.log('✅ HURDLE 8 PASSED: Width stability requirements met\n');
  });

  test.afterAll(async () => {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('🎵 MUSIC PLAYER WIDTH STABILITY TEST COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════\n');
  });
});
