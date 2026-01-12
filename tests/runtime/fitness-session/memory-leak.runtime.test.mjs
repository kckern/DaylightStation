/**
 * FitnessSession Memory Leak Detection Tests
 *
 * Detects memory leaks in FitnessSession by running an active session with
 * HR simulation and monitoring heap growth, timer counts, and allocation patterns.
 *
 * The leak manifests as browser freeze/crash after 3-5 minutes with an active
 * FitnessSession and HR users streaming. It occurs regardless of frontend view.
 *
 * Usage:
 *   npx playwright test tests/runtime/fitness-session/memory-leak.runtime.test.mjs --workers=1
 *
 * @see /docs/_wip/plans/2026-01-12-fitness-session-memory-leak-test.md
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  FitnessTestSimulator,
  TEST_DEVICES
} from '../../_fixtures/fitness/FitnessTestSimulator.mjs';
import {
  MemoryProfiler,
  TimerTracker,
  TIMER_TRACKER_SCRIPT,
  LeakAssertions,
  writeReport
} from '../../_fixtures/profiling/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.join(__dirname, 'reports');

const FRONTEND_URL = 'http://localhost:3111';
const WS_URL = 'ws://localhost:3111/ws';

// Test configuration
const CONFIG = {
  // Primary test: 5 minutes
  longRunDurationSec: 300,
  // Sampling interval for memory (ms)
  memorySampleIntervalMs: 10000,
  // Test timeouts (ms) - must exceed test duration
  timeouts: {
    longRun: 10 * 60 * 1000,  // 10 minutes for 5-min test
    churn: 5 * 60 * 1000,     // 5 minutes for churn test
    multiUser: 5 * 60 * 1000, // 5 minutes for multi-user test
    navigation: 5 * 60 * 1000 // 5 minutes for navigation test
  },
  // Thresholds
  thresholds: {
    maxHeapGrowthMB: 50,
    maxGrowthRateMBPerMin: 2.5,
    maxTimerGrowth: 5,
    warnHeapGrowthMB: 30,
    warnGrowthRateMBPerMin: 1.5,
    warnTimerGrowth: 2
  }
};

test.describe.serial('FitnessSession Memory Leak Detection', () => {
  /** @type {FitnessTestSimulator} */
  let simulator;
  /** @type {import('@playwright/test').Page} */
  let page;
  /** @type {import('@playwright/test').BrowserContext} */
  let context;
  /** @type {MemoryProfiler} */
  let profiler;
  /** @type {TimerTracker} */
  let timerTracker;

  test.beforeAll(async ({ browser }) => {
    // Create context with timer tracker injection
    context = await browser.newContext();
    await context.addInitScript(TIMER_TRACKER_SCRIPT);

    page = await context.newPage();

    // Capture console messages for debugging video/Shaka issues
    const consoleErrors = [];
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      if (type === 'error' || type === 'warning') {
        consoleErrors.push({ type, text: text.substring(0, 500) });
        if (consoleErrors.length <= 10 || text.includes('shaka') || text.includes('video')) {
          console.log(`[Browser ${type}] ${text.substring(0, 200)}`);
        }
      }
    });
    page.on('pageerror', err => {
      console.log(`[Page error] ${err.message?.substring(0, 200)}`);
    });

    // Set up memory profiler with CDP
    let cdpSession = null;
    try {
      cdpSession = await page.context().newCDPSession(page);
    } catch (e) {
      console.warn('[Setup] Could not create CDP session:', e.message);
    }
    profiler = new MemoryProfiler(page, cdpSession);
    timerTracker = new TimerTracker(page);

    // Connect HR simulator
    simulator = new FitnessTestSimulator({ wsUrl: WS_URL, verbose: false, updateInterval: 2000 });
    await simulator.connect();
    console.log('[Setup] Test infrastructure ready');
  });

  test.afterAll(async () => {
    simulator?.stopSimulation?.();
    simulator?.disconnect?.();
    profiler?.stopSampling?.();
    await context?.close();
  });

  test('LEAK-1: Memory stability over 5 minutes with video playback', async () => {
    test.setTimeout(CONFIG.timeouts.longRun);
    const testName = 'LEAK-1: Video playback stability';
    const durationSec = CONFIG.longRunDurationSec;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`${testName}`);
    console.log(`Duration: ${durationSec}s, Sampling: ${CONFIG.memorySampleIntervalMs}ms`);
    console.log(`${'='.repeat(60)}\n`);

    // 1. Start HR simulation (steady 120bpm - active zone, above governance threshold)
    console.log('[LEAK-1] Starting HR simulation (120bpm - active zone)...');
    simulator.runScenario({
      duration: durationSec + 120, // Extra buffer
      users: { alice: { hr: 120, variance: 5 } }
    });

    // 2. Wait for HR data to propagate
    await page.waitForTimeout(4000);

    // 3. Navigate to fitness app
    console.log('[LEAK-1] Loading fitness app...');
    await page.goto(`${FRONTEND_URL}/fitness`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // 4. Navigate to Kids collection (governed content)
    console.log('[LEAK-1] Navigating to Kids collection...');
    const kidsNav = page.locator('.fitness-navbar button.nav-item', { hasText: 'Kids' });
    await expect(kidsNav).toBeVisible({ timeout: 10000 });
    await kidsNav.click();
    await page.waitForTimeout(2000);

    // 5. Click first show
    console.log('[LEAK-1] Clicking first show...');
    const showTile = page.locator('.show-card[data-testid="show-card"]').first();
    await expect(showTile, 'No show tiles found').toBeVisible({ timeout: 10000 });
    await showTile.click();
    await page.waitForTimeout(2000);

    // 6. Start video playback (double-tap on episode)
    console.log('[LEAK-1] Starting video playback...');
    const episodeThumb = page.locator('.episode-card .episode-thumbnail').first();
    await expect(episodeThumb, 'No episode thumbnails found').toBeVisible({ timeout: 10000 });
    await episodeThumb.dispatchEvent('pointerdown');
    await page.waitForTimeout(800);
    await episodeThumb.dispatchEvent('pointerdown');

    // Log if using DASH or native video
    const playerType = await page.evaluate(() => {
      const shakaEl = document.querySelector('.video-element-host');
      const nativeEl = document.querySelector('video.video-element');
      return shakaEl ? 'DASH/Shaka' : (nativeEl ? 'Native' : 'Unknown');
    });
    console.log(`[LEAK-1] Player type: ${playerType}`);

    // 7. Wait for governance to unlock (with 120bpm HR)
    console.log('[LEAK-1] Waiting for governance to unlock...');
    const lockOverlay = page.locator('.governance-overlay');
    try {
      await expect(lockOverlay).toBeHidden({ timeout: 30000 });
      console.log('[LEAK-1] Governance unlocked - video should play');
    } catch (e) {
      console.log('[LEAK-1] WARNING: Governance still locked after 30s');
    }

    // Wait a bit more for video to actually start
    await page.waitForTimeout(3000);

    // Check video status (comprehensive) - find the WORKING video (readyState > 0)
    const videoState = await page.evaluate(() => {
      const videos = document.querySelectorAll('video');
      const allVideoInfo = Array.from(videos).map((v, i) => ({
        idx: i,
        src: v.src?.substring(0, 100) || '(empty)',
        srcObject: !!v.srcObject,
        readyState: v.readyState,
        networkState: v.networkState,
        paused: v.paused,
        currentTime: v.currentTime,
        duration: v.duration
      }));
      // Find the video with readyState > 0 (actually has media loaded)
      const workingVideo = Array.from(videos).find(v => v.readyState > 0) || videos[0];
      return {
        hasVideo: !!workingVideo,
        videoCount: videos.length,
        workingVideoIdx: allVideoInfo.findIndex(v => v.readyState > 0),
        videoPlaying: workingVideo && !workingVideo.paused,
        currentTime: workingVideo?.currentTime || 0,
        duration: workingVideo?.duration || 0,
        videoSrc: workingVideo?.src?.substring(0, 100) || null,
        hasSrcObject: !!workingVideo?.srcObject,
        readyState: workingVideo?.readyState,
        networkState: workingVideo?.networkState,
        error: workingVideo?.error ? { code: workingVideo.error.code, message: workingVideo.error.message } : null,
        allVideos: allVideoInfo
      };
    });
    console.log(`[LEAK-1] Video state: ${JSON.stringify(videoState, null, 2)}`);

    if (!videoState.videoPlaying) {
      console.log('[LEAK-1] WARNING: Video not playing - attempting to play the working video...');
      await page.evaluate(() => {
        const videos = document.querySelectorAll('video');
        // Play the working video (readyState > 0)
        const workingVideo = Array.from(videos).find(v => v.readyState > 0);
        if (workingVideo) {
          workingVideo.play().catch(e => console.log('[Play error]', e.message));
        }
      });
      await page.waitForTimeout(2000);
    }

    // 8. Capture baselines AFTER video starts
    console.log('[LEAK-1] Capturing baselines...');
    await profiler.captureBaseline();
    await timerTracker.captureBaseline();

    const baseline = {
      memory: profiler.baseline,
      timers: timerTracker.baselineCount
    };
    console.log(`[LEAK-1] Baseline - Heap: ${(baseline.memory.heapUsed / 1024 / 1024).toFixed(1)}MB, Timers: ${baseline.timers}`);

    // 6. Start memory sampling
    profiler.startSampling(CONFIG.memorySampleIntervalMs);

    // 9. Run for specified duration with periodic status
    const statusInterval = 30; // Log status every 30s (more frequent for video test)
    const iterations = Math.ceil(durationSec / statusInterval);

    for (let i = 0; i < iterations; i++) {
      const waitTime = Math.min(statusInterval, durationSec - i * statusInterval);
      if (waitTime <= 0) break;

      await page.waitForTimeout(waitTime * 1000);

      // Log progress
      const elapsed = (i + 1) * statusInterval;
      const currentStats = await timerTracker.getCurrentStats();
      const samples = profiler.getSamples();
      const latestSample = samples[samples.length - 1];

      // Check video status
      const vidStatus = await page.evaluate(() => {
        const videos = document.querySelectorAll('video');
        const video = Array.from(videos).find(v => v.readyState > 0) || videos[0];
        // Get buffered ranges info
        let bufferInfo = null;
        if (video?.buffered?.length > 0) {
          const ranges = [];
          for (let i = 0; i < video.buffered.length; i++) {
            ranges.push({ start: video.buffered.start(i), end: video.buffered.end(i) });
          }
          const totalBufferedSec = ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
          bufferInfo = { rangeCount: ranges.length, totalSec: Math.round(totalBufferedSec) };
        }
        return {
          playing: video && !video.paused,
          currentTime: video?.currentTime?.toFixed(0) || 0,
          duration: video?.duration?.toFixed(0) || 0,
          buffer: bufferInfo
        };
      }).catch(() => ({ playing: false, currentTime: 0, duration: 0, buffer: null }));

      const heapMB = latestSample?.heapUsedMB?.toFixed(1) ?? '?';
      const growthMB = profiler.getTotalGrowth().toFixed(1);

      const bufferStr = vidStatus.buffer
        ? `Buffer: ${vidStatus.buffer.totalSec}s in ${vidStatus.buffer.rangeCount} ranges`
        : 'Buffer: N/A';
      console.log(
        `[LEAK-1] ${elapsed}s - Heap: ${heapMB}MB (+${growthMB}), ` +
        `Timers: ${currentStats.activeIntervals}, ` +
        `Video: ${vidStatus.playing ? 'playing' : 'paused'} ${vidStatus.currentTime}/${vidStatus.duration}s, ${bufferStr}`
      );

      // Early abort if clearly failing
      const currentGrowth = profiler.getTotalGrowth();
      if (currentGrowth > CONFIG.thresholds.maxHeapGrowthMB * 1.5) {
        console.log(`[LEAK-1] EARLY ABORT: Heap growth ${currentGrowth.toFixed(1)}MB exceeds 1.5x threshold`);
        break;
      }

      // Check if page crashed
      const pageAlive = await page.evaluate(() => true).catch(() => false);
      if (!pageAlive) {
        console.log(`[LEAK-1] PAGE CRASHED at ${elapsed}s!`);
        break;
      }
    }

    // 8. Stop sampling and capture final state
    profiler.stopSampling();
    await timerTracker.captureFinal();
    simulator.stopSimulation();

    // 9. Run assertions
    console.log('\n[LEAK-1] Running assertions...');
    const assertions = new LeakAssertions(profiler, timerTracker, CONFIG.thresholds);
    const results = await assertions.runAllAssertions();

    // 10. Log results
    console.log(`\n[LEAK-1] Results:`);
    console.log(`  Passed: ${results.passed}`);
    console.log(`  Heap growth: ${results.metrics.heapGrowthMB?.toFixed(2)}MB`);
    console.log(`  Growth rate: ${results.metrics.growthRateMBPerMin?.toFixed(3)}MB/min`);
    console.log(`  Timer growth: ${results.metrics.timerGrowth}`);
    console.log(`  Peak usage: ${results.metrics.peakUsageMB?.toFixed(2)}MB`);

    if (results.failures.length > 0) {
      console.log(`  Failures:`);
      results.failures.forEach(f => console.log(`    - ${f}`));
    }

    if (results.warnings.length > 0) {
      console.log(`  Warnings:`);
      results.warnings.forEach(w => console.log(`    - ${w}`));
    }

    // Log leaked timer stacks if present
    if (results.metrics.leakedTimerStacks?.length > 0) {
      console.log(`\n[LEAK-1] Leaked timer stacks:`);
      results.metrics.leakedTimerStacks.forEach((t, i) => {
        console.log(`  Timer ${i + 1} (${t.ms}ms interval, age: ${t.ageMs}ms):`);
        console.log(`    ${t.stack.replace(/\n/g, '\n    ')}`);
      });
    }

    // 11. Write diagnostic report
    const report = await assertions.generateReport(testName, durationSec);
    try {
      await writeReport(report, REPORTS_DIR);
    } catch (e) {
      console.warn(`[LEAK-1] Could not write report: ${e.message}`);
    }

    // 12. Assert
    expect(results.passed, `Memory leak detected: ${results.failures.join('; ')}`).toBe(true);
  });

  test('LEAK-2: Session start/stop churn (10 cycles)', async () => {
    test.setTimeout(CONFIG.timeouts.churn);
    const testName = 'LEAK-2: Session churn';
    const cycles = 10;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`${testName}`);
    console.log(`Cycles: ${cycles}`);
    console.log(`${'='.repeat(60)}\n`);

    // Navigate fresh
    await page.goto(`${FRONTEND_URL}/fitness`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Capture baseline
    await profiler.captureBaseline();
    await timerTracker.captureBaseline();
    console.log(`[LEAK-2] Baseline timers: ${timerTracker.baselineCount}`);

    profiler.startSampling(5000);

    // Run cycles: start HR → wait → stop HR → wait
    for (let i = 0; i < cycles; i++) {
      console.log(`[LEAK-2] Cycle ${i + 1}/${cycles} - Starting HR...`);

      // Start HR simulation
      simulator.runScenario({
        duration: 15,
        users: { alice: { hr: 120, variance: 5 } }
      });

      await page.waitForTimeout(8000); // Let session start

      // Stop HR
      simulator.stopSimulation();
      console.log(`[LEAK-2] Cycle ${i + 1}/${cycles} - Stopped HR`);

      await page.waitForTimeout(5000); // Let session end

      // Check timer count
      const stats = await timerTracker.getCurrentStats();
      console.log(`[LEAK-2] Cycle ${i + 1} - Active timers: ${stats.activeIntervals}`);
    }

    // Final capture
    profiler.stopSampling();
    await timerTracker.captureFinal();

    // Assertions
    const assertions = new LeakAssertions(profiler, timerTracker, {
      ...CONFIG.thresholds,
      maxTimerGrowth: 3, // Stricter for churn test
      maxHeapGrowthMB: 30
    });
    const results = await assertions.runAllAssertions();

    console.log(`\n[LEAK-2] Results:`);
    console.log(`  Timer growth: ${results.metrics.timerGrowth} (baseline: ${timerTracker.baselineCount}, final: ${timerTracker.finalCount})`);
    console.log(`  Heap growth: ${results.metrics.heapGrowthMB?.toFixed(2)}MB`);

    if (results.metrics.leakedTimerStacks?.length > 0) {
      console.log(`\n[LEAK-2] Leaked timer stacks:`);
      results.metrics.leakedTimerStacks.slice(0, 5).forEach((t, i) => {
        console.log(`  Timer ${i + 1}: ${t.stack.split('\n')[0]}`);
      });
    }

    // Write report
    const report = await assertions.generateReport(testName, cycles * 13);
    try {
      await writeReport(report, REPORTS_DIR);
    } catch (e) {
      console.warn(`[LEAK-2] Could not write report: ${e.message}`);
    }

    expect(results.passed, `Leak detected after ${cycles} start/stop cycles: ${results.failures.join('; ')}`).toBe(true);
  });

  test('LEAK-3: Multi-user HR streaming (3 users)', async () => {
    test.setTimeout(CONFIG.timeouts.multiUser);
    const testName = 'LEAK-3: Multi-user';
    const durationSec = 120;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`${testName}`);
    console.log(`Duration: ${durationSec}s, Users: alice, bob, charlie`);
    console.log(`${'='.repeat(60)}\n`);

    // Navigate fresh
    await page.goto(`${FRONTEND_URL}/fitness`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Baseline
    await profiler.captureBaseline();
    await timerTracker.captureBaseline();
    profiler.startSampling(10000);

    // Start 3-user simulation
    console.log('[LEAK-3] Starting 3-user HR simulation...');
    simulator.runScenario({
      duration: durationSec + 30,
      users: {
        alice: { hr: 120, variance: 5 },
        bob: { hr: 130, variance: 5 },
        charlie: { hr: 115, variance: 5 }
      }
    });

    // Wait for duration
    const checkpoints = [30, 60, 90, 120];
    for (const checkpoint of checkpoints) {
      if (checkpoint > durationSec) break;
      await page.waitForTimeout(30000);

      const stats = await timerTracker.getCurrentStats();
      const growth = profiler.getTotalGrowth();
      console.log(`[LEAK-3] ${checkpoint}s - Heap growth: ${growth.toFixed(1)}MB, Timers: ${stats.activeIntervals}`);
    }

    // Final
    profiler.stopSampling();
    simulator.stopSimulation();
    await timerTracker.captureFinal();

    // Assertions - slightly higher thresholds for multi-user
    const assertions = new LeakAssertions(profiler, timerTracker, {
      ...CONFIG.thresholds,
      maxHeapGrowthMB: 40, // Allow more for 3 users
      maxTimerGrowth: 8    // 3 users might have more timers legitimately
    });
    const results = await assertions.runAllAssertions();

    console.log(`\n[LEAK-3] Results:`);
    console.log(`  Heap growth: ${results.metrics.heapGrowthMB?.toFixed(2)}MB`);
    console.log(`  Growth rate: ${results.metrics.growthRateMBPerMin?.toFixed(3)}MB/min`);
    console.log(`  Timer growth: ${results.metrics.timerGrowth}`);

    // Write report
    const report = await assertions.generateReport(testName, durationSec);
    try {
      await writeReport(report, REPORTS_DIR);
    } catch (e) {
      console.warn(`[LEAK-3] Could not write report: ${e.message}`);
    }

    expect(results.passed, `Multi-user leak: ${results.failures.join('; ')}`).toBe(true);
  });

  test('LEAK-4: View navigation during session', async () => {
    test.setTimeout(CONFIG.timeouts.navigation);
    const testName = 'LEAK-4: View navigation';
    const navigations = 6;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`${testName}`);
    console.log(`Navigations: ${navigations}`);
    console.log(`${'='.repeat(60)}\n`);

    // Start HR simulation
    simulator.runScenario({
      duration: 300,
      users: { alice: { hr: 120, variance: 5 } }
    });

    await page.waitForTimeout(3000);

    // Navigate to fitness
    await page.goto(`${FRONTEND_URL}/fitness`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);

    // Baseline
    await profiler.captureBaseline();
    await timerTracker.captureBaseline();
    profiler.startSampling(5000);

    // Navigate between views
    for (let i = 0; i < navigations; i++) {
      console.log(`[LEAK-4] Navigation ${i + 1}/${navigations}`);

      // Try to navigate to different sections (if available)
      const navButtons = await page.locator('.fitness-navbar button.nav-item').all();
      if (navButtons.length > 1) {
        const targetIdx = (i % (navButtons.length - 1)) + 1; // Cycle through non-first
        await navButtons[targetIdx].click().catch(() => {});
        await page.waitForTimeout(3000);
      }

      // Navigate away and back
      await page.goto(`${FRONTEND_URL}/`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
      await page.goto(`${FRONTEND_URL}/fitness`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(3000);

      const stats = await timerTracker.getCurrentStats();
      console.log(`[LEAK-4] After nav ${i + 1} - Timers: ${stats.activeIntervals}`);
    }

    // Final
    profiler.stopSampling();
    simulator.stopSimulation();
    await timerTracker.captureFinal();

    // Assertions - navigation should clean up properly
    const assertions = new LeakAssertions(profiler, timerTracker, {
      ...CONFIG.thresholds,
      maxTimerGrowth: 3 // Navigation should clean up timers
    });
    const results = await assertions.runAllAssertions();

    console.log(`\n[LEAK-4] Results:`);
    console.log(`  Timer baseline: ${timerTracker.baselineCount}, final: ${timerTracker.finalCount}`);
    console.log(`  Timer growth: ${results.metrics.timerGrowth}`);
    console.log(`  Heap growth: ${results.metrics.heapGrowthMB?.toFixed(2)}MB`);

    if (results.metrics.leakedTimerStacks?.length > 0) {
      console.log(`\n[LEAK-4] Leaked timer stacks (likely unmount failures):`);
      results.metrics.leakedTimerStacks.slice(0, 3).forEach((t, i) => {
        console.log(`  Timer ${i + 1}:`);
        console.log(`    ${t.stack.replace(/\n/g, '\n    ')}`);
      });
    }

    // Write report
    const report = await assertions.generateReport(testName, navigations * 10);
    try {
      await writeReport(report, REPORTS_DIR);
    } catch (e) {
      console.warn(`[LEAK-4] Could not write report: ${e.message}`);
    }

    expect(results.passed, `Navigation leak: ${results.failures.join('; ')}`).toBe(true);
  });
});
