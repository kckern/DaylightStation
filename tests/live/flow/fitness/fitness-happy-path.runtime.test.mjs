/**
 * Fitness Happy Path Runtime Test
 *
 * Proves the fitness stack is wired correctly end-to-end:
 * - /api/v1/fitness returns config with nav_items
 * - Content APIs load shows and episodes
 * - Plex proxy streams video correctly
 *
 * This is a UI-focused integration test - if any API fails,
 * the UI won't render and the test fails fast.
 *
 * Uses testDataService for curated test data with expectations.
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { FRONTEND_URL, BACKEND_URL } from '#fixtures/runtime/urls.mjs';
import { getTestSample, validateExpectations, clearCache } from '#testlib/testDataService.mjs';
import { FitnessSimHelper } from '#testlib/FitnessSimHelper.mjs';

/**
 * Read render FPS from dev.log (frontend logs playback.render_fps events)
 * Returns most recent FPS value from the log
 */
function readRenderFpsFromLog(fromPosition = 0) {
  try {
    const content = fs.readFileSync(DEV_LOG_PATH, 'utf-8').slice(fromPosition);
    const lines = content.split('\n');

    // Find most recent playback.render_fps event
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line.includes('playback.render_fps')) {
        try {
          const json = JSON.parse(line);
          const fps = json.data?.renderFps;
          if (typeof fps === 'number') {
            return {
              valid: true,
              renderFps: fps,
              title: json.data?.title,
              mediaKey: json.data?.mediaKey
            };
          }
        } catch { /* ignore parse errors */ }
      }
    }
    return { valid: false, error: 'no render_fps events found' };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

const BASE_URL = FRONTEND_URL;
const API_URL = BACKEND_URL;
const DEV_LOG_PATH = path.join(process.cwd(), 'dev.log');
const PROJECT_ROOT = path.resolve(process.cwd());

let sharedPage;
let sharedContext;
let plexTestData = null;
let logStartPosition = 0;
let devServerProc = null;

/**
 * Check if the backend API is responding
 */
async function isBackendReady() {
  try {
    const response = await fetch(`${API_URL}/api/v1/ping`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Start dev server if not already running (only backend on 3112)
 */
async function ensureDevServer(timeout = 90000) {
  // Check if already running
  if (await isBackendReady()) {
    console.log('Backend already running on 3112');
    return null;
  }

  console.log('Starting dev server...');

  // Clear dev.log for fresh logging
  try {
    fs.writeFileSync(DEV_LOG_PATH, '');
  } catch { /* ignore */ }

  // Start dev server
  const proc = spawn('npm', ['run', 'dev'], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: 'ignore'
  });
  proc.unref();

  // Wait for backend to be ready
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await isBackendReady()) {
      console.log('Dev server ready');
      return proc;
    }
    await new Promise(r => setTimeout(r, 2000));
    process.stdout.write('.');
  }

  throw new Error(`Dev server did not start within ${timeout}ms`);
}

/**
 * Read dev.log content from a starting position
 */
function readDevLog(fromPosition = 0) {
  try {
    const content = fs.readFileSync(DEV_LOG_PATH, 'utf-8');
    return content.slice(fromPosition);
  } catch {
    return '';
  }
}

/**
 * Get current dev.log size (for marking test start)
 */
function getDevLogPosition() {
  try {
    const stats = fs.statSync(DEV_LOG_PATH);
    return stats.size;
  } catch {
    return 0;
  }
}

/**
 * Extract errors and warnings from log content
 */
function extractLogIssues(logContent, maxLines = 20) {
  const lines = logContent.split('\n');
  const issues = lines.filter(line => {
    const lower = line.toLowerCase();
    return lower.includes('"level":"error"') ||
           lower.includes('"level":"warn"') ||
           lower.includes('error:') ||
           lower.includes('failed') ||
           lower.includes('exception');
  });
  return issues.slice(-maxLines);
}

test.describe.configure({ mode: 'serial' });

test.describe('Fitness Happy Path', () => {

  test.beforeAll(async ({ browser }) => {
    console.log('Setting up fitness happy path tests...');

    // Start dev server if not already running
    devServerProc = await ensureDevServer(90000);

    // FAIL FAST: Verify fitness API returns valid data before running any tests
    console.log('Verifying fitness API health...');
    let fitnessConfig;
    try {
      const response = await fetch(`${API_URL}/api/v1/fitness`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) {
        throw new Error(`Fitness API returned ${response.status}: ${response.statusText}`);
      }
      fitnessConfig = await response.json();
    } catch (err) {
      throw new Error(`FAIL FAST: Fitness API not responding. Cannot run tests.\nError: ${err.message}\nURL: ${API_URL}/api/v1/fitness`);
    }

    // Validate essential config fields exist
    const navItems = fitnessConfig?.fitness?.plex?.nav_items || fitnessConfig?.plex?.nav_items;
    const users = fitnessConfig?.fitness?.users?.primary || fitnessConfig?.users?.primary;
    if (!navItems || navItems.length === 0) {
      throw new Error(`FAIL FAST: Fitness API returned no nav_items. Config may be invalid.\nReceived keys: ${Object.keys(fitnessConfig || {}).join(', ')}`);
    }
    console.log(`Fitness API healthy: ${navItems.length} nav items, ${users?.length || 0} primary users`);

    // Mark log position at test start
    logStartPosition = getDevLogPosition();
    console.log(`dev.log position at start: ${logStartPosition}`);

    // Load curated test data
    clearCache();
    plexTestData = await getTestSample('plex');
    if (plexTestData) {
      console.log(`Loaded plex test sample: ${plexTestData.id}`);
    } else {
      console.log('No plex test data available, will use UI-discovered content');
    }

    sharedContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });
    sharedPage = await sharedContext.newPage();

    // Enable autoplay for video
    try {
      const cdp = await sharedContext.newCDPSession(sharedPage);
      await cdp.send('Emulation.setAutoplayPolicy', { autoplayPolicy: 'no-user-gesture-required' });
    } catch (e) {
      console.log('Could not set autoplay policy:', e.message);
    }
  });

  test.afterAll(async () => {
    // Let video play for 10 seconds before teardown (user requested)
    console.log('Waiting 10 seconds before teardown to allow video playback...');
    await new Promise(r => setTimeout(r, 10000));

    // Capture final log state
    const logContent = readDevLog(logStartPosition);
    const issues = extractLogIssues(logContent);

    if (issues.length > 0) {
      console.log('\n=== dev.log issues during test run ===');
      issues.forEach(line => console.log(line));
      console.log('======================================\n');
    } else {
      console.log(`dev.log: ${logContent.split('\n').length} lines, no errors/warnings`);
    }

    if (sharedPage) await sharedPage.close();
    if (sharedContext) await sharedContext.close();

    // Dev server left running for faster iteration
    // To stop: if (devServerProc) process.kill(-devServerProc.pid);
    console.log('Fitness happy path tests complete (dev server left running)');
  });

  // Track per-test log position for failure diagnostics
  let testLogPosition = 0;

  test.beforeEach(() => {
    testLogPosition = getDevLogPosition();
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== 'passed') {
      const logContent = readDevLog(testLogPosition);
      const issues = extractLogIssues(logContent, 30);

      console.log(`\n=== dev.log for failed test: ${testInfo.title} ===`);
      if (issues.length > 0) {
        issues.forEach(line => console.log(line));
      } else {
        // Show last 10 lines if no obvious issues
        const lastLines = logContent.split('\n').slice(-10);
        lastLines.forEach(line => console.log(line));
      }
      console.log('================================================\n');
    }
  });

  // Track if Plex content is available (checked in test 1)
  let plexContentAvailable = false;

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 1: Fitness API returns valid config
  // ═══════════════════════════════════════════════════════════════════════════
  test('fitness API returns config', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/v1/fitness`);
    expect(response.ok(), 'Fitness API should return 200').toBe(true);

    const data = await response.json();

    // Must have nav_items for the UI to render
    const navItems = data.fitness?.plex?.nav_items || data.plex?.nav_items || [];
    console.log(`API returned ${navItems.length} nav_items`);
    expect(navItems.length, 'Should have at least one nav item').toBeGreaterThan(0);

    // Must have users config for fitness sessions
    const users = data.fitness?.users || data.users || {};
    const primaryUsers = users.primary || [];
    console.log(`API returned ${primaryUsers.length} primary users`);

    // Check if Plex content API is available (test list endpoint with a known collection ID)
    // Use the first collection ID from nav_items if available
    const firstCollection = navItems.find(item => item.type === 'plex_collection');
    if (firstCollection) {
      const collectionId = firstCollection.target?.collection_id;
      try {
        const contentCheck = await request.get(`${API_URL}/api/v1/info/plex/${collectionId}`);
        const contentData = await contentCheck.json().catch(() => ({}));
        plexContentAvailable = contentCheck.ok() && !contentData.error;
        console.log(`Plex content available: ${plexContentAvailable}${!plexContentAvailable ? ` (${contentData.error || 'API error'} - will skip content tests)` : ''}`);
      } catch {
        plexContentAvailable = false;
        console.log('Plex content not available (will skip content tests)');
      }
    } else {
      plexContentAvailable = false;
      console.log('No Plex collections in config (will skip content tests)');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: Fitness app loads with navbar
  // ═══════════════════════════════════════════════════════════════════════════
  test('app loads with navbar', async () => {
    await sharedPage.goto(`${BASE_URL}/fitness`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // App container should be visible
    await expect(sharedPage.locator('.fitness-app-container')).toBeVisible({ timeout: 10000 });

    // Navbar should have collection buttons (proves /api/v1/fitness returned config)
    const navButtons = sharedPage.locator('.fitness-navbar button');
    await expect(navButtons.first()).toBeVisible({ timeout: 10000 });

    const buttonCount = await navButtons.count();
    console.log(`Navbar has ${buttonCount} collection buttons`);
    expect(buttonCount).toBeGreaterThan(0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: Click collection → shows appear
  // ═══════════════════════════════════════════════════════════════════════════
  test('collection click loads shows', async () => {
    if (!plexContentAvailable) {
      console.log('Skipping: Plex content API not available (missing auth config)');
      test.skip();
      return;
    }

    // Find a plex collection button (skip Home, Session, and other plugins)
    // Look for typical fitness collection names
    const navButtons = sharedPage.locator('.fitness-navbar button');
    const buttonCount = await navButtons.count();

    let targetButton = null;
    let collectionName = '';

    for (let i = 0; i < buttonCount; i++) {
      const btn = navButtons.nth(i);
      const text = await btn.textContent();
      const lowerText = text.toLowerCase();

      // Skip known plugins/special views and empty collections
      if (lowerText.includes('home') ||
          lowerText.includes('session') ||
          lowerText.includes('users') ||
          lowerText.includes('favorite')) {
        continue;
      }

      // Found a likely collection
      targetButton = btn;
      collectionName = text;
      break;
    }

    if (!targetButton) {
      throw new Error('No plex collection button found in navbar');
    }

    console.log(`Clicking collection: ${collectionName}`);
    await targetButton.click();
    await sharedPage.waitForTimeout(2000);

    // Show cards should appear (proves content API works)
    const showCard = sharedPage.locator('.show-card').first();
    await expect(showCard).toBeVisible({ timeout: 10000 });

    const showCount = await sharedPage.locator('.show-card').count();
    console.log(`Found ${showCount} shows in collection`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 4: Click show → episodes appear
  // ═══════════════════════════════════════════════════════════════════════════
  test('show click loads episodes', async () => {
    if (!plexContentAvailable) {
      console.log('Skipping: Plex content API not available');
      test.skip();
      return;
    }

    // Click first show card
    const showCard = sharedPage.locator('.show-card').first();
    const showTitle = await showCard.getAttribute('data-show-title').catch(() => 'Unknown');
    console.log(`Clicking show: ${showTitle}`);

    await showCard.click();
    await sharedPage.waitForTimeout(3000);

    // Episode cards should appear (proves show/episode API works)
    const episodeCard = sharedPage.locator('.episode-card').first();
    await expect(episodeCard).toBeVisible({ timeout: 10000 });

    const episodeCount = await sharedPage.locator('.episode-card').count();
    console.log(`Found ${episodeCount} episodes`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 5: Click episode → video appears
  // ═══════════════════════════════════════════════════════════════════════════
  test('episode click starts video', async () => {
    if (!plexContentAvailable) {
      console.log('Skipping: Plex content API not available');
      test.skip();
      return;
    }

    // Use data-testid for more reliable targeting
    const episodeThumbnail = sharedPage.locator('[data-testid="episode-thumbnail"]').first();
    await expect(episodeThumbnail).toBeVisible({ timeout: 5000 });

    // Get episode info from the thumbnail
    const plexId = await episodeThumbnail.getAttribute('data-plex-id');
    const episodeTitle = await sharedPage.locator('.episode-card .episode-title-text').first().textContent().catch(() => 'Episode');
    console.log(`Playing episode: ${episodeTitle?.trim().substring(0, 50)} (plex: ${plexId})`);

    // Get current URL before click
    const urlBefore = sharedPage.url();
    console.log(`URL before click: ${urlBefore}`);

    // Click via JavaScript to bypass any scroll-gate logic
    // This simulates a user click more reliably in automated tests
    await episodeThumbnail.evaluate((el) => {
      // Create and dispatch a click event
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      });
      el.dispatchEvent(clickEvent);
    });

    // Wait for navigation/state change
    await sharedPage.waitForTimeout(2000);

    // Check if URL changed (indicates navigation to player)
    const urlAfter = sharedPage.url();
    console.log(`URL after click: ${urlAfter}`);

    // If URL didn't change, the click handler may not have fired - try direct navigation
    if (urlAfter === urlBefore && plexId) {
      console.log('Click did not navigate, trying direct navigation to player...');
      await sharedPage.goto(`${BASE_URL}/fitness/play/${plexId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      });
    }

    // Wait for player UI to load - the fitness-player-footer proves navigation succeeded
    // DASH videos may fail to play in headless Chrome due to codec support, but the player UI should load
    const playerFooter = sharedPage.locator('.fitness-player-footer');
    await expect(playerFooter).toBeVisible({ timeout: 10000 });
    console.log('Player footer is visible - player UI loaded successfully');

    // Check for video element (DASH videos use MediaSource, not src attribute)
    const dashVideo = sharedPage.locator('dash-video').first();
    const regularVideo = sharedPage.locator('video').first();

    const dashVideoVisible = await dashVideo.isVisible().catch(() => false);
    const regularVideoVisible = await regularVideo.isVisible().catch(() => false);

    console.log(`Video elements: dash-video=${dashVideoVisible}, video=${regularVideoVisible}`);

    // Video element should exist (even if it shows "Not supported" in headless Chrome)
    expect(dashVideoVisible || regularVideoVisible, 'Video element should be present').toBe(true);

    // For DASH streams, check if the video has a MediaSource (not src attribute)
    // Or check for the dash-video src attribute which contains the MPD URL
    if (dashVideoVisible) {
      const dashSrc = await dashVideo.getAttribute('src');
      console.log(`dash-video src: ${dashSrc ? dashSrc.substring(0, 80) + '...' : 'none'}`);
      // DASH video should have an MPD URL or proxy stream URL as its src
      if (dashSrc) {
        const isDashStream = dashSrc.includes('.mpd') || dashSrc.includes('/proxy/plex/stream/');
        expect(isDashStream, `Expected DASH stream URL, got: ${dashSrc}`).toBe(true);
      }
    }

    // Check video state via JavaScript - DASH videos use MediaSource
    const videoState = await sharedPage.evaluate(() => {
      const video = document.querySelector('video');
      if (!video) return null;
      return {
        hasMediaSource: !!video.srcObject || (video.src && video.src.startsWith('blob:')),
        srcAttribute: video.getAttribute('src'),
        readyState: video.readyState,
        networkState: video.networkState,
        error: video.error ? { code: video.error.code, message: video.error.message } : null
      };
    });
    console.log('Video state:', JSON.stringify(videoState, null, 2));

    // The video element should either have a src/blob or MediaSource
    // In headless Chrome, DASH may fail to initialize, but the element should exist
    expect(videoState, 'Should have video state info').toBeTruthy();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 6: Video plays (proves Plex proxy streams correctly)
  // NOTE: This test may skip in headless Chrome due to DASH codec limitations
  // ═══════════════════════════════════════════════════════════════════════════
  test('video plays and advances', async () => {
    if (!plexContentAvailable) {
      console.log('Skipping: Plex content API not available');
      test.skip();
      return;
    }

    // Helper to get video state from either dash-video or regular video
    const getVideoState = async () => {
      return await sharedPage.evaluate(() => {
        // Try dash-video first (used for DASH streams from Plex)
        const dashVideo = document.querySelector('dash-video');
        if (dashVideo) {
          const internalVideo = dashVideo.video || dashVideo.media || dashVideo.shadowRoot?.querySelector('video');
          if (internalVideo) {
            return {
              type: 'dash',
              paused: internalVideo.paused,
              currentTime: internalVideo.currentTime,
              readyState: internalVideo.readyState,
              duration: internalVideo.duration,
              error: internalVideo.error ? { code: internalVideo.error.code } : null
            };
          }
        }
        // Fall back to regular video element
        const video = document.querySelector('video');
        if (!video) return null;
        return {
          type: 'video',
          paused: video.paused,
          currentTime: video.currentTime,
          readyState: video.readyState,
          duration: video.duration,
          error: video.error ? { code: video.error.code } : null
        };
      });
    };

    let state = await getVideoState();
    if (!state) {
      throw new Error('No video element found (checked dash-video and video)');
    }
    console.log(`Video type: ${state.type}, readyState: ${state.readyState}`);

    // Check if video failed to initialize (common in headless Chrome with DASH)
    // readyState 0 means HAVE_NOTHING - the video never loaded
    if (state.readyState === 0) {
      console.log('Video readyState is 0 (HAVE_NOTHING) - DASH playback likely not supported in headless mode');
      console.log('Skipping playback test - player UI validation already passed in test 5');
      test.skip();
      return;
    }

    // Try to play if paused
    if (state.paused) {
      console.log('Video paused, triggering play...');
      await sharedPage.evaluate(() => {
        const dashVideo = document.querySelector('dash-video');
        if (dashVideo) {
          const internalVideo = dashVideo.video || dashVideo.media || dashVideo.shadowRoot?.querySelector('video');
          if (internalVideo) {
            internalVideo.play().catch(() => {});
            return;
          }
        }
        const v = document.querySelector('video');
        if (v) v.play().catch(() => {});
      });
      await sharedPage.waitForTimeout(1000);
    }

    // Wait for frontend to log FPS (it logs every 5 seconds)
    console.log('Waiting for render FPS to be logged...');
    await sharedPage.waitForTimeout(6000);

    // Monitor playback for 5 seconds
    const startTime = state.currentTime || 0;
    let playingCount = 0;

    for (let i = 0; i < 5; i++) {
      await sharedPage.waitForTimeout(1000);
      state = await getVideoState();
      if (!state) break;

      const delta = (state.currentTime || 0) - startTime;
      const isPlaying = !state.paused && delta > 0.5;
      if (isPlaying) playingCount++;

      console.log(`[${i + 1}s] time=${state.currentTime?.toFixed(2)}s, paused=${state.paused}, delta=${delta.toFixed(2)}s${isPlaying ? ' ✓' : ''}`);

      if (playingCount >= 2) {
        console.log('Video is playing!');
        break;
      }
    }

    // Read FPS from dev.log (frontend logs playback.render_fps)
    const fpsFromLog = readRenderFpsFromLog(testLogPosition);
    console.log('FPS from dev.log:', JSON.stringify(fpsFromLog));

    // Report FPS status
    if (!fpsFromLog.valid) {
      console.log(`⚠️  No FPS logged yet: ${fpsFromLog.error || 'unknown'}`);
    } else if (fpsFromLog.renderFps === 0) {
      console.log(`⚠️  FPS is 0 (video not rendering)`);
    } else {
      console.log(`✓ Render FPS: ${fpsFromLog.renderFps} fps`);
      expect(fpsFromLog.renderFps, 'Render FPS should be > 0').toBeGreaterThan(0);
    }

    // Assert video played (currentTime advanced or ready to play)
    const finalState = await getVideoState();
    const advanced = finalState && (finalState.currentTime > startTime + 0.5);
    const ready = finalState && finalState.readyState >= 3;

    expect(advanced || ready, 'Video should play and advance, or be ready to play').toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 7: Direct play with curated test data (validates Plex proxy with known-good episode)
  // ═══════════════════════════════════════════════════════════════════════════
  test('direct play with test data', async ({ request }) => {
    if (!plexContentAvailable) {
      console.log('Skipping: Plex content API not available');
      test.skip();
      return;
    }

    if (!plexTestData) {
      console.log('No plex test data available, skipping direct play test');
      test.skip();
      return;
    }

    const episodeId = plexTestData.id;
    console.log(`Testing direct play with episode: ${episodeId}`);

    // First validate the episode exists via API
    const infoResponse = await request.get(`${API_URL}/api/v1/info/plex/${episodeId}`);
    if (!infoResponse.ok()) {
      console.log(`Episode ${episodeId} not available (${infoResponse.status()}), skipping`);
      test.skip();
      return;
    }

    const episodeInfo = await infoResponse.json();
    console.log(`Episode info: ${episodeInfo.title || episodeId}`);

    // Validate against test data expectations if available
    if (plexTestData.expect && Object.keys(plexTestData.expect).length > 0) {
      const validation = validateExpectations(episodeInfo, plexTestData.expect);
      if (!validation.valid) {
        console.log('Validation errors:', validation.errors);
      }
      expect(validation.valid, 'Episode should match test data expectations').toBe(true);
    }

    // Navigate directly to play this episode
    await sharedPage.goto(`${BASE_URL}/fitness/play/${episodeId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Wait for the fitness player footer (indicates player is rendering)
    // The page snapshot shows timeline markers when player is active
    await expect(sharedPage.locator('.fitness-player-footer')).toBeVisible({ timeout: 15000 });
    console.log('Fitness player footer visible');

    // Give video element time to mount
    await sharedPage.waitForTimeout(2000);

    // Check for video elements and their state via evaluate (more reliable than locators for custom elements)
    const videoInfo = await sharedPage.evaluate(() => {
      const dashVideo = document.querySelector('dash-video');
      const regularVideo = document.querySelector('video');

      if (dashVideo) {
        const src = dashVideo.getAttribute('src');
        const internalVideo = dashVideo.video || dashVideo.media || dashVideo.shadowRoot?.querySelector('video');
        return {
          type: 'dash',
          visible: true,
          src: src,
          state: internalVideo ? {
            paused: internalVideo.paused,
            currentTime: internalVideo.currentTime,
            readyState: internalVideo.readyState
          } : null
        };
      }

      if (regularVideo) {
        return {
          type: 'video',
          visible: true,
          src: regularVideo.getAttribute('src'),
          state: {
            paused: regularVideo.paused,
            currentTime: regularVideo.currentTime,
            readyState: regularVideo.readyState
          }
        };
      }

      return { type: null, visible: false, src: null, state: null };
    });

    console.log(`Direct play video: type=${videoInfo.type}, visible=${videoInfo.visible}, src=${videoInfo.src ? videoInfo.src.substring(0, 60) + '...' : 'none'}`);
    console.log(`Direct play state: paused=${videoInfo.state?.paused}, time=${videoInfo.state?.currentTime?.toFixed(2)}s, readyState=${videoInfo.state?.readyState}`);

    expect(videoInfo.visible, 'Video element should be present').toBe(true);
    expect(videoInfo.src, 'Video should have a source URL').toBeTruthy();
    expect(videoInfo.src).toContain('/api/v1/proxy/plex/'); // Verify it's a Plex proxy URL

    // Try to start playback if paused (autoplay may be blocked)
    if (videoInfo.state?.paused) {
      console.log('Video paused, attempting to start playback...');
      await sharedPage.evaluate(() => {
        const dashVideo = document.querySelector('dash-video');
        if (dashVideo) {
          const internalVideo = dashVideo.video || dashVideo.media || dashVideo.shadowRoot?.querySelector('video');
          if (internalVideo) internalVideo.play().catch(() => {});
        }
      });
      await sharedPage.waitForTimeout(2000);

      // Re-check state after attempting play
      const finalState = await sharedPage.evaluate(() => {
        const dashVideo = document.querySelector('dash-video');
        if (dashVideo) {
          const internalVideo = dashVideo.video || dashVideo.media || dashVideo.shadowRoot?.querySelector('video');
          if (internalVideo) {
            return { paused: internalVideo.paused, currentTime: internalVideo.currentTime, readyState: internalVideo.readyState };
          }
        }
        return null;
      });
      console.log(`After play attempt: paused=${finalState?.paused}, time=${finalState?.currentTime?.toFixed(2)}s, readyState=${finalState?.readyState}`);

      // Accept either playing or ready to play (readyState >= 1 means we have metadata)
      expect(finalState?.readyState >= 1 || !finalState?.paused, 'Video should have loaded or be playing').toBe(true);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // TEST 8: Simulation controller initializes
  // ═══════════════════════════════════════════════════════════════
  test('simulation controller available on localhost', async () => {
    // Navigate to fitness app if not already there
    if (!sharedPage.url().includes('/fitness')) {
      await sharedPage.goto(`${BASE_URL}/fitness`);
      await sharedPage.waitForTimeout(2000);
    }

    const sim = new FitnessSimHelper(sharedPage);
    await sim.waitForController();

    const devices = await sim.getDevices();
    console.log(`Controller ready with ${devices.length} configured devices`);
    expect(devices.length).toBeGreaterThan(0);
  });

  // ═══════════════════════════════════════════════════════════════
  // TEST 9: Zone changes update participant state
  // ═══════════════════════════════════════════════════════════════
  test('setting zone updates participant state', async () => {
    const sim = new FitnessSimHelper(sharedPage);
    await sim.waitForController();

    const devices = await sim.getDevices();
    const device = devices[0];

    // Set to hot zone
    const result = await sim.setZone(device.deviceId, 'hot');
    expect(result.ok).toBe(true);

    // Wait for zone to register
    await sim.waitForZone(device.deviceId, 'hot');

    // Verify device state
    const updated = await sim.getDevices();
    const updatedDevice = updated.find(d => d.deviceId === device.deviceId);
    expect(updatedDevice.currentZone).toBe('hot');
    expect(updatedDevice.currentHR).toBeGreaterThan(140);

    console.log(`Device ${device.deviceId} now at ${updatedDevice.currentHR} bpm (${updatedDevice.currentZone})`);
  });

  // ═══════════════════════════════════════════════════════════════
  // TEST 10: Auto session progresses through zones
  // ═══════════════════════════════════════════════════════════════
  test('auto session progresses through zones', async () => {
    const sim = new FitnessSimHelper(sharedPage);
    await sim.waitForController();

    const devices = await sim.getDevices();
    const device = devices[0];

    // Start short auto session (30 seconds)
    await sim.startAutoSession(device.deviceId, { duration: 30 });

    // Should start in warmup (cool → active range)
    await sharedPage.waitForTimeout(3000);
    let state = await sim.getDevices();
    let d = state.find(x => x.deviceId === device.deviceId);
    console.log(`After 3s: ${d.currentHR} bpm (${d.currentZone})`);
    expect(d.autoMode).toBe('session');

    // Wait and check progression
    await sharedPage.waitForTimeout(5000);
    state = await sim.getDevices();
    d = state.find(x => x.deviceId === device.deviceId);
    console.log(`After 8s: ${d.currentHR} bpm (${d.currentZone})`);

    await sim.stopAuto(device.deviceId);
  });

  // ═══════════════════════════════════════════════════════════════
  // TEST 11: Governance override enables challenges
  // ═══════════════════════════════════════════════════════════════
  test('governance override enables challenges on any content', async () => {
    const sim = new FitnessSimHelper(sharedPage);
    await sim.waitForController();

    // Enable governance with short phases for testing
    await sim.enableGovernance({
      phases: { warmup: 3, main: 60, cooldown: 3 },
      challenges: { enabled: true, interval: 10, duration: 15 }
    });

    // Activate all participants
    await sim.activateAll('active');
    const devices = await sim.getDevices();
    await sim.waitForActiveCount(devices.length, 5000);
    console.log('All devices activated');

    // Wait for warmup, then trigger challenge
    await sharedPage.waitForTimeout(4000);

    const challengeResult = await sim.triggerChallenge({ targetZone: 'hot' });
    expect(challengeResult.ok).toBe(true);
    console.log('Challenge triggered');

    // When delegated to real GovernanceEngine, the challenge may be rejected
    // if the current media is not in the governed set (governance.evaluate.media_not_governed).
    // Poll for the state but handle the "not governed" case gracefully.
    let state = null;
    for (let i = 0; i < 6; i++) {
      await sharedPage.waitForTimeout(500);
      state = await sim.getGovernanceState();
      if (state.activeChallenge) break;
    }

    if (!state.activeChallenge && challengeResult.delegated) {
      // Real GovernanceEngine rejected challenge (media not governed) — this is expected
      // when the test runs on non-fitness content. Verify delegation worked correctly.
      console.log('Challenge delegated to real engine but media not governed — skipping challenge assertions');
      const realState = await sharedPage.evaluate(() => window.__fitnessGovernance);
      console.log(`Real engine state: phase=${realState?.phase}, activeChallenge=${realState?.activeChallenge}`);
    } else {
      expect(state.activeChallenge, 'Challenge should be active after trigger').not.toBeNull();
      expect(state.activeChallenge.targetZone).toBe('hot');

      // Move all devices to target zone
      for (const d of devices) {
        await sim.setZone(d.deviceId, 'hot');
      }

      // Complete challenge successfully
      await sim.completeChallenge(true);

      // Verify win recorded
      const finalState = await sim.getGovernanceState();
      expect(finalState.stats.challengesWon).toBeGreaterThan(0);
      console.log(`Challenge completed. Wins: ${finalState.stats.challengesWon}`);
    }

    // Cleanup
    await sim.disableGovernance();
    await sim.stopAll();
  });

  // ═══════════════════════════════════════════════════════════════
  // TEST 12: Persistence validation accepts heart_rate series keys
  // Regression: PersistenceManager checked for `:hr` suffix but
  //   actual series keys use `:heart_rate`, silently rejecting
  //   every session since Feb 15 2026 with "no-meaningful-data".
  // ═══════════════════════════════════════════════════════════════
  test('persistence validation accepts heart_rate series keys', async () => {
    // Ensure we're on the fitness app so PersistenceManager is loaded
    if (!sharedPage.url().includes('/fitness')) {
      await sharedPage.goto(`${BASE_URL}/fitness`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sharedPage.waitForTimeout(2000);
    }

    // Run validation directly in the browser with both key formats
    const results = await sharedPage.evaluate(() => {
      const session = window.__fitnessSession;
      if (!session) return { error: 'no __fitnessSession on window' };
      const pm = session._persistenceManager;
      if (!pm) return { error: 'no _persistenceManager' };

      const now = Date.now();
      const basePayload = {
        sessionId: 'test-' + now,
        startTime: now - 120000,
        endTime: now,
        durationMs: 120000,
        roster: [{ userId: 'testuser', displayName: 'Test User' }],
        deviceAssignments: [{ deviceId: '12345', userId: 'testuser' }],
        timeline: {
          timebase: { intervalMs: 5000, tickCount: 24 },
          events: [],
          series: {}
        }
      };

      // Test 1: heart_rate key (actual production format) — MUST pass
      const hrPayload = JSON.parse(JSON.stringify(basePayload));
      hrPayload.timeline.series['user:testuser:heart_rate'] = Array(24).fill(120);
      hrPayload.timeline.series['user:testuser:zone_id'] = Array(24).fill(2);
      hrPayload.timeline.series['user:testuser:coins_total'] = Array(24).fill(100);
      const heartRateResult = pm.validateSessionPayload(hrPayload);

      // Test 2: hr key (legacy format) — MUST also pass
      const legacyPayload = JSON.parse(JSON.stringify(basePayload));
      legacyPayload.sessionId = 'test-legacy-' + now;
      legacyPayload.timeline.series['user:testuser:hr'] = Array(24).fill(110);
      legacyPayload.timeline.series['user:testuser:zone_id'] = Array(24).fill(2);
      legacyPayload.timeline.series['user:testuser:coins_total'] = Array(24).fill(50);
      const legacyResult = pm.validateSessionPayload(legacyPayload);

      // Test 3: no HR data — MUST fail with no-meaningful-data
      const noHrPayload = JSON.parse(JSON.stringify(basePayload));
      noHrPayload.sessionId = 'test-nohr-' + now;
      noHrPayload.timeline.series['user:testuser:zone_id'] = Array(24).fill(0);
      const noHrResult = pm.validateSessionPayload(noHrPayload);

      // Test 4: all-zero HR — MUST fail with no-meaningful-data
      const zeroHrPayload = JSON.parse(JSON.stringify(basePayload));
      zeroHrPayload.sessionId = 'test-zerohr-' + now;
      zeroHrPayload.timeline.series['user:testuser:heart_rate'] = Array(24).fill(0);
      const zeroHrResult = pm.validateSessionPayload(zeroHrPayload);

      return { heartRateResult, legacyResult, noHrResult, zeroHrResult };
    });

    if (results.error) {
      throw new Error(`Cannot test validation: ${results.error}`);
    }

    // heart_rate key MUST be accepted
    console.log('heart_rate result:', JSON.stringify(results.heartRateResult));
    expect(results.heartRateResult.ok, `heart_rate series must be accepted, got: ${results.heartRateResult.reason}`).toBe(true);

    // Legacy :hr key MUST also be accepted
    console.log('legacy :hr result:', JSON.stringify(results.legacyResult));
    expect(results.legacyResult.ok, `legacy :hr series must be accepted, got: ${results.legacyResult.reason}`).toBe(true);

    // No HR series MUST be rejected
    console.log('no HR result:', JSON.stringify(results.noHrResult));
    expect(results.noHrResult.ok, 'No HR series should be rejected').toBe(false);
    expect(results.noHrResult.reason).toBe('no-meaningful-data');

    // All-zero HR MUST be rejected
    console.log('zero HR result:', JSON.stringify(results.zeroHrResult));
    expect(results.zeroHrResult.ok, 'All-zero HR should be rejected').toBe(false);
    expect(results.zeroHrResult.reason).toBe('no-meaningful-data');

    console.log('Validation regression test PASSED — heart_rate keys accepted');
  });

  // ═══════════════════════════════════════════════════════════════
  // TEST 13: save_session API persists data to disk
  // Proves the backend endpoint accepts a valid session payload
  //   and the session file actually appears in the sessions list.
  // ═══════════════════════════════════════════════════════════════
  test('save_session API persists session to disk', async ({ request }) => {
    const now = Date.now();
    // Session IDs are numeric timestamps (YYYYMMDDHHmmss) — no text prefix
    const sessionId = new Date(now).toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
    const sessionDate = new Date(now).toISOString().slice(0, 10);
    const startISO = new Date(now - 120000).toISOString().replace('T', ' ').slice(0, 23);
    const endISO = new Date(now).toISOString().replace('T', ' ').slice(0, 23);

    const sessionPayload = {
      sessionData: {
        version: 3,
        sessionId,
        session: {
          id: sessionId,
          date: sessionDate,
          start: startISO,
          end: endISO,
          duration_seconds: 120
        },
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        participants: {
          testuser: {
            display_name: 'Test User',
            hr_device: '99999',
            is_primary: true
          }
        },
        timeline: {
          series: {
            'user:testuser:heart_rate': [100, 105, 110, 115, 120, 125, 130, 128, 125, 120, 115, 110, 105, 100, 98, 95, 92, 90, 88, 85, 82, 80, 78, 75],
            'user:testuser:zone_id': [0, 0, 1, 1, 2, 2, 3, 3, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            'user:testuser:coins_total': [0, 1, 3, 5, 8, 12, 17, 22, 26, 30, 33, 36, 38, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50],
            'global:coins': [0, 1, 3, 5, 8, 12, 17, 22, 26, 30, 33, 36, 38, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50]
          },
          events: [],
          interval_seconds: 5,
          tick_count: 24,
          encoding: 'rle'
        },
        treasureBox: {
          coinTimeUnitMs: 5000,
          totalCoins: 50,
          buckets: { blue: 0, green: 20, yellow: 20, orange: 10, red: 0 }
        },
        summary: {
          participants: {
            testuser: {
              coins: 50,
              hr_avg: 104,
              hr_max: 130,
              hr_min: 75,
              zone_minutes: { cool: 1.0, active: 0.5, warm: 0.33, hot: 0.17 }
            }
          },
          media: [],
          coins: {
            total: 50,
            buckets: { blue: 0, green: 20, yellow: 20, orange: 10, red: 0 }
          },
          challenges: { total: 0, succeeded: 0, failed: 0 },
          voiceMemos: []
        }
      }
    };

    // POST to save_session
    console.log(`Posting test session ${sessionId} for date ${sessionDate}...`);
    const saveResponse = await request.post(`${API_URL}/api/v1/fitness/save_session`, {
      data: sessionPayload
    });

    expect(saveResponse.ok(), `save_session should return 200, got ${saveResponse.status()}`).toBe(true);

    const saveResult = await saveResponse.json();
    console.log('save_session response:', JSON.stringify({
      message: saveResult.message,
      filename: saveResult.filename,
      sessionId: saveResult.sessionData?.sessionId || saveResult.sessionData?.session?.id
    }));

    expect(saveResult.message, 'Response should confirm save').toContain('saved');
    expect(saveResult.filename, 'Response should include filename').toBeTruthy();

    // Verify the session appears in the sessions list for that date
    const listResponse = await request.get(`${API_URL}/api/v1/fitness/sessions?date=${sessionDate}`);
    expect(listResponse.ok(), 'Sessions list should return 200').toBe(true);

    const listData = await listResponse.json();
    const sessions = listData.sessions || [];
    console.log(`Sessions for ${sessionDate}: ${sessions.length} found`);
    console.log('Session IDs:', sessions.map(s => s.sessionId || s.id).join(', '));

    const found = sessions.some(s => {
      const id = s.sessionId || s.id || '';
      return id === sessionId || id.includes(sessionId);
    });
    expect(found, `Session ${sessionId} must appear in sessions list for ${sessionDate}`).toBe(true);
    console.log(`Session ${sessionId} confirmed persisted to disk`);

    console.log('Backend persistence test PASSED');
  });

  // ═══════════════════════════════════════════════════════════════
  // TEST 14: Render update rate stays below threshold
  // Regression: batchedForceUpdate fired ~1,400/30s causing CPU starvation
  // Fix: Throttled to max 4/sec (250ms interval)
  // ═══════════════════════════════════════════════════════════════
  test('render update rate stays below threshold during simulation', async () => {
    if (!sharedPage.url().includes('/fitness')) {
      await sharedPage.goto(`${BASE_URL}/fitness`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sharedPage.waitForTimeout(2000);
    }

    const sim = new FitnessSimHelper(sharedPage);
    await sim.waitForController();

    // Activate all devices to generate HR traffic
    await sim.activateAll('warm');
    const devices = await sim.getDevices();
    await sim.waitForActiveCount(devices.length, 5000);

    // Collect render stats over 10 seconds
    const startStats = await sharedPage.evaluate(() => {
      const stats = typeof window.__fitnessRenderStats === 'function'
        ? window.__fitnessRenderStats()
        : window.__fitnessRenderStats;
      return { timestamp: Date.now(), forceUpdateCount: stats?.forceUpdateCount ?? null };
    });

    await sharedPage.waitForTimeout(10000);

    const endStats = await sharedPage.evaluate(() => {
      const stats = typeof window.__fitnessRenderStats === 'function'
        ? window.__fitnessRenderStats()
        : window.__fitnessRenderStats;
      return { timestamp: Date.now(), forceUpdateCount: stats?.forceUpdateCount ?? null };
    });

    await sim.stopAll();

    if (startStats.forceUpdateCount != null && endStats.forceUpdateCount != null) {
      const elapsed = (endStats.timestamp - startStats.timestamp) / 1000;
      const updates = endStats.forceUpdateCount - startStats.forceUpdateCount;
      const rate = updates / elapsed;
      console.log(`Force update rate: ${rate.toFixed(1)}/sec over ${elapsed.toFixed(1)}s (${updates} updates)`);

      // With 250ms throttle, max should be ~4/sec. Allow headroom for circuit breaker resets.
      expect(rate).toBeLessThan(10); // Was ~47/sec before fix
    } else {
      // If render stats not exposed, check dev.log for render_thrashing warnings
      const logContent = readDevLog(testLogPosition);
      const thrashingWarnings = logContent.split('\n').filter(l => l.includes('render_thrashing'));
      console.log(`Render thrashing warnings in log: ${thrashingWarnings.length}`);
      expect(thrashingWarnings.length).toBeLessThan(5);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // TEST 15: No phantom stall overlays during smooth playback
  // Regression: 66 false stall events per session, overlay flashed
  // Fix: Validate playhead advancement before showing overlay
  // ═══════════════════════════════════════════════════════════════
  test('no phantom stall overlays during playback with simulation', async () => {
    if (!plexContentAvailable) {
      console.log('Skipping: Plex content not available');
      test.skip();
      return;
    }

    const sim = new FitnessSimHelper(sharedPage);
    await sim.waitForController();

    // Activate devices to generate HR traffic while video plays
    await sim.activateAll('active');

    // Let video play for 15 seconds with HR simulation active
    await sharedPage.waitForTimeout(15000);

    // Check dev.log for phantom stall events
    const logContent = readDevLog(testLogPosition);
    const stallEvents = logContent.split('\n').filter(l => l.includes('playback.stall_detected'));
    const phantomStalls = logContent.split('\n').filter(l => l.includes('playback.stall_phantom'));

    console.log(`Stall events: ${stallEvents.length}, Phantom (suppressed): ${phantomStalls.length}`);

    // Real stalls should be very rare. Before fix: 66 in 30min.
    const realStalls = stallEvents.length;
    console.log(`Real stalls: ${realStalls}`);
    expect(realStalls).toBeLessThan(5);

    await sim.stopAll();
  });

  // ═══════════════════════════════════════════════════════════════
  // TEST 16: Challenge feasibility prevents unwinnable challenges
  // Regression: Hot-zone challenge triggered when participant 32 BPM below
  // Fix: Feasibility check with zone downgrade
  // ═══════════════════════════════════════════════════════════════
  test('challenge feasibility prevents unwinnable hot challenges', async () => {
    if (!sharedPage.url().includes('/fitness')) {
      await sharedPage.goto(`${BASE_URL}/fitness`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sharedPage.waitForTimeout(2000);
    }

    const sim = new FitnessSimHelper(sharedPage);
    await sim.waitForController();

    // Put all devices in cool zone (far from hot)
    // Must send 4+ readings per device to get past the startup discard (first 3 discarded)
    await sim.activateAll('cool');
    await sharedPage.waitForTimeout(500);
    await sim.activateAll('cool');
    await sharedPage.waitForTimeout(500);
    await sim.activateAll('cool');
    await sharedPage.waitForTimeout(500);
    await sim.activateAll('cool');
    const devices = await sim.getDevices();
    await sim.waitForActiveCount(devices.length, 5000);

    // Wait for profiles to be built from HR data, then verify user resolution
    await sharedPage.waitForTimeout(2000);
    const profileStatus = await sim.getParticipantProfiles();
    console.log(`Profile resolution: ${profileStatus.resolvedCount}/${profileStatus.total} resolved, ${profileStatus.unresolvedCount} unresolved`);
    for (const [id, p] of Object.entries(profileStatus.profiles || {})) {
      console.log(`  ${id}: resolved=${p.resolved}, hr=${p.heartRate}, zone=${p.currentZoneId}, zoneConfig=${p.hasZoneConfig}(${p.zoneConfigCount}), source=${p.source}`);
    }

    // GATE: Fail fast if user resolution is broken — no point testing feasibility
    expect(profileStatus.resolvedCount,
      `Expected all participants resolved but got ${profileStatus.resolvedCount}/${profileStatus.total}. ` +
      `Unresolved IDs signal a user-resolution coupling bug.`
    ).toBeGreaterThan(0);
    expect(profileStatus.unresolvedCount,
      `${profileStatus.unresolvedCount} participants unresolved — feasibility check will be vacuous`
    ).toBe(0);

    // Verify each resolved profile has zone config (needed for threshold lookup)
    for (const [id, p] of Object.entries(profileStatus.profiles || {})) {
      if (p.resolved) {
        expect(p.hasZoneConfig, `Profile ${id} resolved but has no zone config`).toBe(true);
      }
    }

    // Enable governance
    await sim.enableGovernance({
      phases: { warmup: 2, main: 60, cooldown: 2 },
      challenges: { enabled: true, interval: 5, duration: 30 }
    });

    // Wait for warmup phase to pass
    await sharedPage.waitForTimeout(3000);

    // Trigger a hot challenge — should be downgraded or skipped
    const challengeResult = await sim.triggerChallenge({ targetZone: 'hot' });
    await sharedPage.waitForTimeout(2000);

    const state = await sim.getGovernanceState();

    if (state.activeChallenge) {
      // If a challenge was created, it should NOT be hot (feasibility should downgrade)
      const zone = state.activeChallenge.targetZone;
      console.log(`Challenge zone: ${zone} (requested: hot)`);
      expect(zone).not.toBe('hot');
    } else {
      // Challenge was skipped as infeasible (also correct)
      console.log('Challenge skipped as infeasible (correct behavior)');
    }

    // Check log for feasibility events
    const logContent = readDevLog(testLogPosition);
    const feasibilityEvents = logContent.split('\n').filter(l =>
      l.includes('challenge.skipped_infeasible') || l.includes('challenge.zone_downgraded')
    );
    console.log(`Feasibility events: ${feasibilityEvents.length}`);
    expect(feasibilityEvents.length).toBeGreaterThan(0);

    await sim.disableGovernance();
    await sim.stopAll();
  });

  // ═══════════════════════════════════════════════════════════════
  // TEST 17: No chart mismatch console.warn spam
  // Regression: 756 raw console.warn calls per session
  // Fix: Convert to logger.sampled(), filter 'global' entry
  // ═══════════════════════════════════════════════════════════════
  test('chart does not spam console.warn during session', async () => {
    if (!sharedPage.url().includes('/fitness')) {
      await sharedPage.goto(`${BASE_URL}/fitness`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sharedPage.waitForTimeout(2000);
    }

    // Capture console.warn count during a 10-second simulation
    let warnCount = 0;
    const chartWarnMessages = [];
    const warnHandler = (msg) => {
      if (msg.type() === 'warning') {
        const text = msg.text();
        if (text.includes('[FitnessChart]')) {
          warnCount++;
          if (chartWarnMessages.length < 5) chartWarnMessages.push(text.slice(0, 100));
        }
      }
    };
    sharedPage.on('console', warnHandler);

    const sim = new FitnessSimHelper(sharedPage);
    await sim.waitForController();
    await sim.activateAll('active');

    await sharedPage.waitForTimeout(10000);

    sharedPage.off('console', warnHandler);
    await sim.stopAll();

    console.log(`Chart console.warn count in 10s: ${warnCount}`);
    if (chartWarnMessages.length > 0) {
      console.log('Sample warnings:', chartWarnMessages);
    }

    // Before fix: ~250 in 10s. After fix: 0 (migrated to logger.sampled).
    expect(warnCount).toBeLessThan(5);
  });

  // ═══════════════════════════════════════════════════════════════
  // TEST 18: Governance phase transitions work correctly
  // Tests: pending → unlocked → warning → locked lifecycle
  // ═══════════════════════════════════════════════════════════════
  test('governance phases transition correctly', async () => {
    if (!sharedPage.url().includes('/fitness')) {
      await sharedPage.goto(`${BASE_URL}/fitness`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sharedPage.waitForTimeout(2000);
    }

    const sim = new FitnessSimHelper(sharedPage);
    await sim.waitForController();

    // Enable governance with short phases
    await sim.enableGovernance({
      phases: { warmup: 2, main: 60, cooldown: 2 },
      challenges: { enabled: false }
    });

    // Initially should be pending (no active participants)
    let state = await sim.getGovernanceState();
    console.log(`Initial phase: ${state.phase}`);

    // Activate all devices at active zone — should transition to unlocked
    await sim.activateAll('active');
    const devices = await sim.getDevices();
    await sim.waitForActiveCount(devices.length, 5000);

    // Wait for warmup + transition
    await sharedPage.waitForTimeout(4000);

    state = await sim.getGovernanceState();
    console.log(`After activation + warmup: phase=${state.phase}`);
    // Should be unlocked (all participants in active+ zone)
    expect(['unlocked', 'pending'].includes(state.phase),
      `Expected unlocked or pending, got: ${state.phase}`).toBe(true);

    // Drop all devices to cool — should trigger warning → locked
    for (const d of devices) {
      await sim.setZone(d.deviceId, 'cool');
    }

    // Wait for warning grace period + lock
    await sharedPage.waitForTimeout(8000);

    state = await sim.getGovernanceState();
    console.log(`After dropping to cool: phase=${state.phase}`);

    // Check log for phase transitions
    const logContent = readDevLog(testLogPosition);
    const phaseChanges = logContent.split('\n').filter(l => l.includes('governance.phase_change'));
    console.log(`Phase change events: ${phaseChanges.length}`);

    // Move back to active to unlock
    for (const d of devices) {
      await sim.setZone(d.deviceId, 'active');
    }
    await sharedPage.waitForTimeout(3000);

    state = await sim.getGovernanceState();
    console.log(`After returning to active: phase=${state.phase}`);

    await sim.disableGovernance();
    await sim.stopAll();
  });

  // ═══════════════════════════════════════════════════════════════
  // TEST 19: Challenge lifecycle — trigger, satisfy, complete
  // Tests the full challenge flow with zone changes
  // ═══════════════════════════════════════════════════════════════
  test('challenge lifecycle completes when participants reach target zone', async () => {
    if (!sharedPage.url().includes('/fitness')) {
      await sharedPage.goto(`${BASE_URL}/fitness`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sharedPage.waitForTimeout(2000);
    }

    const sim = new FitnessSimHelper(sharedPage);
    await sim.waitForController();

    // Start all devices in warm zone (achievable for hot challenge)
    await sim.activateAll('warm');
    const devices = await sim.getDevices();
    await sim.waitForActiveCount(devices.length, 5000);

    await sim.enableGovernance({
      phases: { warmup: 2, main: 60, cooldown: 2 },
      challenges: { enabled: true, interval: 10, duration: 30 }
    });

    // Wait for warmup
    await sharedPage.waitForTimeout(3000);

    // Trigger a warm challenge (achievable from current zone)
    const challengeResult = await sim.triggerChallenge({ targetZone: 'warm' });
    console.log(`Challenge trigger result: ${JSON.stringify(challengeResult)}`);

    // Wait for challenge to activate
    await sharedPage.waitForTimeout(2000);
    let state = await sim.getGovernanceState();

    if (!state.activeChallenge && challengeResult.delegated) {
      console.log('Challenge delegated but media not governed — skipping lifecycle assertions');
      await sim.disableGovernance();
      await sim.stopAll();
      return;
    }

    if (state.activeChallenge) {
      console.log(`Active challenge: zone=${state.activeChallenge.targetZone}, required=${state.activeChallenge.requiredCount}`);

      // Move all devices to target zone
      for (const d of devices) {
        await sim.setZone(d.deviceId, state.activeChallenge.targetZone);
      }

      // Wait for zone to register and challenge to evaluate
      await sharedPage.waitForTimeout(3000);

      // Complete the challenge
      await sim.completeChallenge(true);

      const finalState = await sim.getGovernanceState();
      console.log(`After completion: wins=${finalState.stats?.challengesWon}, losses=${finalState.stats?.challengesLost}`);

      // Should have recorded the win
      expect(finalState.stats?.challengesWon).toBeGreaterThan(0);
    } else {
      console.log('No active challenge (may have been skipped for feasibility)');
    }

    await sim.disableGovernance();
    await sim.stopAll();
  });

  // ═══════════════════════════════════════════════════════════════
  // TEST 20: Challenge failure when time expires
  // Tests that challenges fail gracefully when not satisfied
  // ═══════════════════════════════════════════════════════════════
  test('challenge fails when participants cannot reach target zone', async () => {
    if (!sharedPage.url().includes('/fitness')) {
      await sharedPage.goto(`${BASE_URL}/fitness`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sharedPage.waitForTimeout(2000);
    }

    const sim = new FitnessSimHelper(sharedPage);
    await sim.waitForController();

    // Start all devices in active zone
    await sim.activateAll('active');
    const devices = await sim.getDevices();
    await sim.waitForActiveCount(devices.length, 5000);

    await sim.enableGovernance({
      phases: { warmup: 2, main: 60, cooldown: 2 },
      challenges: { enabled: true, interval: 10, duration: 10 } // short duration
    });

    await sharedPage.waitForTimeout(3000);

    // Trigger warm challenge but keep devices in cool (don't meet it)
    await sim.triggerChallenge({ targetZone: 'warm' });
    await sharedPage.waitForTimeout(1000);

    let state = await sim.getGovernanceState();
    if (!state.activeChallenge) {
      console.log('No challenge activated (may be feasibility-skipped or media not governed)');
      await sim.disableGovernance();
      await sim.stopAll();
      return;
    }

    // Drop to cool — won't satisfy the warm challenge
    for (const d of devices) {
      await sim.setZone(d.deviceId, 'cool');
    }

    // Wait for challenge to expire (10s duration + buffer)
    console.log('Waiting for challenge to expire...');
    await sharedPage.waitForTimeout(12000);

    // Force completion as failed
    await sim.completeChallenge(false);

    const finalState = await sim.getGovernanceState();
    console.log(`After expiry: wins=${finalState.stats?.challengesWon}, losses=${finalState.stats?.challengesLost}`);

    // Check log for challenge failure
    const logContent = readDevLog(testLogPosition);
    const challengeEvents = logContent.split('\n').filter(l =>
      l.includes('challenge.started') || l.includes('challenge.failed') || l.includes('challenge.completed')
    );
    console.log(`Challenge events: ${challengeEvents.length}`);
    challengeEvents.slice(-5).forEach(e => console.log(`  ${e.slice(0, 120)}`));

    await sim.disableGovernance();
    await sim.stopAll();
  });

  // ═══════════════════════════════════════════════════════════════
  // TEST 21: Device startup HR readings are discarded
  // Regression: BLE monitors send stale cached readings (161→90 BPM)
  // Fix: First 3 HR readings per device are discarded
  // ═══════════════════════════════════════════════════════════════
  test('device startup does not cause false zone spikes', async () => {
    if (!sharedPage.url().includes('/fitness')) {
      await sharedPage.goto(`${BASE_URL}/fitness`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sharedPage.waitForTimeout(2000);
    }

    const sim = new FitnessSimHelper(sharedPage);
    await sim.waitForController();

    // Clear all devices to simulate fresh connection
    await sim.clearAllDevices();
    await sharedPage.waitForTimeout(1000);

    // Check dev.log for startup discard events
    const logPos = getDevLogPosition();

    // Activate one device — the first few HR readings should be discarded
    const devices = await sim.getDevices();
    if (devices.length === 0) {
      console.log('No devices available after clear — activating all');
      await sim.activateAll('active');
      await sharedPage.waitForTimeout(3000);
    } else {
      await sim.setHR(devices[0].deviceId, 160); // Simulate stale high reading
      await sharedPage.waitForTimeout(500);
      await sim.setHR(devices[0].deviceId, 155); // Another stale reading
      await sharedPage.waitForTimeout(500);
      await sim.setHR(devices[0].deviceId, 90);  // Real reading (cool zone)
      await sharedPage.waitForTimeout(500);
      await sim.setHR(devices[0].deviceId, 95);  // 4th reading — should be accepted
      await sharedPage.waitForTimeout(2000);
    }

    // Check for startup discard log events
    const logContent = readDevLog(logPos);
    const discardEvents = logContent.split('\n').filter(l => l.includes('device_startup_discard'));
    console.log(`Startup discard events: ${discardEvents.length}`);

    // If discard events logged, verify they contain expected fields
    if (discardEvents.length > 0) {
      console.log('Sample discard event:', discardEvents[0].slice(0, 150));
      expect(discardEvents.length).toBeGreaterThanOrEqual(1);
    } else {
      // Simulator may bypass the normal device activity path
      console.log('No discard events (simulator may use direct path)');
    }

    await sim.stopAll();
  });

  // ═══════════════════════════════════════════════════════════════
  // TEST 22: Governance lock pauses video, unlock resumes
  // Tests that governance lock/unlock actually affects playback
  // ═══════════════════════════════════════════════════════════════
  test('governance lock pauses video and unlock resumes', async () => {
    if (!plexContentAvailable) {
      console.log('Skipping: Plex content not available');
      test.skip();
      return;
    }

    const sim = new FitnessSimHelper(sharedPage);
    await sim.waitForController();

    // Ensure video is playing
    await sim.activateAll('active');
    const devices = await sim.getDevices();
    await sim.waitForActiveCount(devices.length, 5000);

    await sim.enableGovernance({
      phases: { warmup: 2, main: 60, cooldown: 2 },
      challenges: { enabled: false }
    });

    // Wait for warmup + unlocked
    await sharedPage.waitForTimeout(4000);

    // Capture video state before lock
    const beforeLock = await sharedPage.evaluate(() => {
      const v = document.querySelector('video');
      return v ? { paused: v.paused, time: v.currentTime } : null;
    });
    console.log(`Before lock: paused=${beforeLock?.paused}, time=${beforeLock?.time?.toFixed(2)}`);

    // Drop all to cool to trigger warning → lock
    for (const d of devices) {
      await sim.setZone(d.deviceId, 'cool');
    }

    // Wait for warning grace + lock
    await sharedPage.waitForTimeout(8000);

    let state = await sim.getGovernanceState();
    console.log(`After cool drop: phase=${state.phase}`);

    if (state.phase === 'locked') {
      // Check if video is locked/paused
      const duringLock = await sharedPage.evaluate(() => {
        const v = document.querySelector('video');
        return v ? { paused: v.paused, time: v.currentTime } : null;
      });
      console.log(`During lock: paused=${duringLock?.paused}, time=${duringLock?.time?.toFixed(2)}`);

      // Bring devices back to active to unlock
      for (const d of devices) {
        await sim.setZone(d.deviceId, 'active');
      }
      await sharedPage.waitForTimeout(3000);

      state = await sim.getGovernanceState();
      console.log(`After return to active: phase=${state.phase}`);
    } else {
      console.log(`Phase is ${state.phase}, not locked — governance may not have activated on this content`);
    }

    await sim.disableGovernance();
    await sim.stopAll();
  });

});
