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
 * 1. Navigate directly to fitness player URL
 * 2. Force-enable music via React context
 * 3. Wait for music player to load with tracks
 * 4. Advance songs multiple times
 * 5. Monitor container dimensions for any width fluctuations
 *
 * Usage:
 *   npx playwright test tests/live/flow/music/music-player-width-stability.runtime.test.mjs --headed
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

const HEALTH_ENDPOINT = `${FRONTEND_URL}/api/v1/fitness`;

// Playable with NoMusic label - triggers music auto-enable
// 599479 = known working NoMusic video (used in music-fix-verify test)
const PLAY_URL = `${FRONTEND_URL}/fitness/play/599479`;

// Default playlist ID from fitness config (Fitness playlist)
const DEFAULT_PLAYLIST_ID = 672596;

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
    const sidebar = document.querySelector('.fitness-sidebar-container');
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

/**
 * Helper: Force-enable music in the fitness context
 */
async function forceEnableMusic(page, playlistId = DEFAULT_PLAYLIST_ID) {
  return page.evaluate((playlistId) => {
    // Find React fiber to access context
    const findReactFiber = (element) => {
      if (!element) return null;
      const key = Object.keys(element).find(k => k.startsWith('__reactFiber$'));
      return key ? element[key] : null;
    };

    const findContextValue = (fiber, displayName) => {
      let current = fiber;
      while (current) {
        if (current.memoizedState?.memoizedState?.current) {
          // Check if this looks like FitnessContext
          const state = current.memoizedState;
          if (state && typeof state === 'object') {
            // Walk the memoizedState chain
            let node = state;
            while (node) {
              if (node.memoizedState && typeof node.memoizedState === 'object') {
                const ctx = node.memoizedState;
                if (ctx.setMusicOverride || ctx.setSelectedPlaylistId) {
                  return ctx;
                }
              }
              node = node.next;
            }
          }
        }
        current = current.return;
      }
      return null;
    };

    // Try to find React app root
    const root = document.getElementById('root') || document.querySelector('[data-reactroot]');
    if (!root) return { success: false, error: 'No React root found' };

    const fiber = findReactFiber(root);
    if (!fiber) return { success: false, error: 'No React fiber found' };

    // Alternative: dispatch a custom event that the context listens to
    // This is more reliable than trying to access React internals
    window.dispatchEvent(new CustomEvent('force-enable-music', { detail: { playlistId } }));

    return { success: true, method: 'custom-event', playlistId };
  }, playlistId);
}

test.describe.serial('Music Player Width Stability', () => {
  /** @type {import('@playwright/test').Page} */
  let page;
  let baselineDimensions = null;
  let allWidthSamples = [];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });
    page = await context.newPage();

    // Log console for debugging
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[Playlist]') || text.includes('[Track') || text.includes('music')) {
        console.log(`   [Page] ${text}`);
      }
    });
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
  // HURDLE 2: Navigate to Play URL (Triggers NoMusic Label Check)
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 2: Navigate to play URL and wait for video', async () => {
    console.log('\n🏃 HURDLE 2: Navigating to play URL (triggers NoMusic label check)...');
    console.log(`   URL: ${PLAY_URL}`);

    await page.goto(PLAY_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for video player to appear
    const videoPlayer = page.locator('video');
    await expect(videoPlayer.first()).toBeVisible({ timeout: 15000 });

    console.log('   Video player visible');
    console.log('✅ HURDLE 2 PASSED: Video playing\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 3: Enable Music Player
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 3: Enable music player', async () => {
    console.log('\n🏃 HURDLE 3: Enabling music player...');

    // Check if music player already exists
    let musicPlayerExists = await page.locator('.fitness-music-player-container').isVisible({ timeout: 2000 }).catch(() => false);

    if (musicPlayerExists) {
      console.log('   Music player already visible');
    } else {
      console.log('   Music player not visible, attempting to enable...');

      // Method 1: Try clicking a music enable toggle if it exists
      const musicToggle = page.locator('[data-testid="music-toggle"], .music-enable-toggle, button:has-text("Music")');
      if (await musicToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log('   Found music toggle, clicking...');
        await musicToggle.click();
        await page.waitForTimeout(2000);
      }

      // Method 2: Try to set via URL parameter
      // The app supports ?music=on but it may not be wired up
      const currentUrl = page.url();
      if (!currentUrl.includes('music=')) {
        console.log('   Trying URL parameter approach...');
        await page.goto(`${currentUrl}${currentUrl.includes('?') ? '&' : '?'}music=on`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
      }

      // Method 3: Use evaluate to directly modify React state
      console.log('   Attempting direct context manipulation...');
      await page.evaluate((playlistId) => {
        // Dispatch event that FitnessContext might listen to
        window.__FORCE_MUSIC_ENABLED__ = true;
        window.__FORCE_PLAYLIST_ID__ = playlistId;

        // Try localStorage approach
        localStorage.setItem('fitness-music-enabled', 'true');
        localStorage.setItem('fitness-playlist-id', String(playlistId));

        // Force a re-render by dispatching storage event
        window.dispatchEvent(new StorageEvent('storage', {
          key: 'fitness-music-enabled',
          newValue: 'true'
        }));
      }, DEFAULT_PLAYLIST_ID);

      await page.waitForTimeout(3000);

      // Check again
      musicPlayerExists = await page.locator('.fitness-music-player-container').isVisible({ timeout: 5000 }).catch(() => false);
    }

    // If still not visible, check what's in the sidebar
    if (!musicPlayerExists) {
      const sidebarInfo = await page.evaluate(() => {
        const sidebar = document.querySelector('.fitness-sidebar-container');
        const sidebarContainer = document.querySelector('.fitness-sidebar-container');
        const musicSection = document.querySelector('.fitness-sidebar-music');
        return {
          sidebarExists: !!sidebar,
          sidebarContainerExists: !!sidebarContainer,
          musicSectionExists: !!musicSection,
          sidebarClasses: sidebar?.className || 'N/A',
          sidebarHTML: sidebar?.innerHTML?.substring(0, 500) || 'N/A'
        };
      });
      console.log('   Sidebar state:', JSON.stringify(sidebarInfo, null, 2));

      // Skip remaining tests if music player cannot be enabled
      test.skip(!musicPlayerExists, 'Music player could not be enabled - video may not have NoMusic label');
    }

    expect(musicPlayerExists, 'Music player should be visible').toBe(true);
    console.log('✅ HURDLE 3 PASSED: Music player enabled\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 4: Wait for Track to Load
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 4: Wait for track to load', async () => {
    console.log('\n🏃 HURDLE 4: Waiting for track to load...');

    // Wait for track title to show actual content (not "No track playing")
    await page.waitForFunction(() => {
      const title = document.querySelector('.track-title');
      const text = title?.textContent?.trim();
      return text && text !== 'No track playing' && text !== 'Loading...';
    }, { timeout: 15000 }).catch(() => null);

    // Get baseline dimensions
    baselineDimensions = await getMusicPlayerDimensions(page);

    console.log(`   Music player width: ${baselineDimensions.musicContainer?.width?.toFixed(1)}px`);
    console.log(`   Sidebar width: ${baselineDimensions.sidebar?.width?.toFixed(1)}px`);
    console.log(`   Track: ${baselineDimensions.trackTitle?.text || 'Unknown'}`);

    const hasTrack = baselineDimensions.trackTitle?.text &&
                     baselineDimensions.trackTitle.text !== 'No track playing';

    expect(hasTrack, 'A track should be loaded').toBe(true);
    console.log('✅ HURDLE 4 PASSED: Track loaded\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 5: Test Width Stability Across Song Changes
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 5: Test width stability across song changes', async () => {
    console.log('\n🏃 HURDLE 5: Testing width stability across song changes...');
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

    console.log('✅ HURDLE 5 PASSED: Width stability tested\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HURDLE 6: Final Assertions
  // ═══════════════════════════════════════════════════════════════════════════
  test('HURDLE 6: Assert width stability requirements', async () => {
    console.log('\n🏃 HURDLE 6: Final assertions...');

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

    console.log('✅ HURDLE 6 PASSED: Width stability requirements met\n');
  });

  test.afterAll(async () => {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('🎵 MUSIC PLAYER WIDTH STABILITY TEST COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════\n');
  });
});
