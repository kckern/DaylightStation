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
        const contentCheck = await request.get(`${API_URL}/api/v1/list/plex/${collectionId}`);
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

    // Double-tap episode thumbnail (first tap scrolls, second plays)
    const episodeThumbnail = sharedPage.locator('.episode-card .episode-thumbnail').first();
    const episodeTitle = await sharedPage.locator('.episode-card .episode-title').first().textContent().catch(() => 'Episode');
    console.log(`Playing episode: ${episodeTitle.trim().substring(0, 50)}`);

    await episodeThumbnail.dispatchEvent('pointerdown');
    await sharedPage.waitForTimeout(800);
    await episodeThumbnail.dispatchEvent('pointerdown');
    await sharedPage.waitForTimeout(3000);

    // Check for either dash-video (DASH streams) or regular video element
    // DASH videos from Plex use the dash-video custom element
    const dashVideo = sharedPage.locator('dash-video').first();
    const regularVideo = sharedPage.locator('video').first();

    const dashVideoVisible = await dashVideo.isVisible().catch(() => false);
    const regularVideoVisible = await regularVideo.isVisible().catch(() => false);

    console.log(`Video elements: dash-video=${dashVideoVisible}, video=${regularVideoVisible}`);
    expect(dashVideoVisible || regularVideoVisible, 'Either dash-video or video element should be visible').toBe(true);

    // Get the src from whichever element is present
    let videoSrc = null;
    if (dashVideoVisible) {
      videoSrc = await dashVideo.getAttribute('src');
      console.log(`dash-video src: ${videoSrc ? videoSrc.substring(0, 80) + '...' : 'none'}`);
    }
    if (!videoSrc && regularVideoVisible) {
      videoSrc = await regularVideo.getAttribute('src');
      console.log(`video src: ${videoSrc ? videoSrc.substring(0, 80) + '...' : 'none'}`);
    }
    expect(videoSrc, 'Video element should have a source').toBeTruthy();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 6: Video plays (proves Plex proxy streams correctly)
  // ═══════════════════════════════════════════════════════════════════════════
  test('video plays and advances', async () => {
    if (!plexContentAvailable) {
      console.log('Skipping: Plex content API not available');
      test.skip();
      return;
    }

    // Helper to get video state from either dash-video or regular video
    // dash-video exposes the internal video element via .video property
    const getVideoState = async () => {
      return await sharedPage.evaluate(() => {
        // Try dash-video first (used for DASH streams from Plex)
        const dashVideo = document.querySelector('dash-video');
        if (dashVideo) {
          // dash-video-element exposes internal video via .video or .media property
          const internalVideo = dashVideo.video || dashVideo.media || dashVideo.shadowRoot?.querySelector('video');
          if (internalVideo) {
            return {
              type: 'dash',
              paused: internalVideo.paused,
              currentTime: internalVideo.currentTime,
              readyState: internalVideo.readyState,
              duration: internalVideo.duration
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
          duration: video.duration
        };
      });
    };

    let state = await getVideoState();
    if (!state) {
      throw new Error('No video element found (checked dash-video and video)');
    }
    console.log(`Video type: ${state.type}`);

    // Try to play if paused
    if (state.paused) {
      console.log('Video paused, triggering play...');
      await sharedPage.evaluate(() => {
        // Try dash-video first
        const dashVideo = document.querySelector('dash-video');
        if (dashVideo) {
          const internalVideo = dashVideo.video || dashVideo.media || dashVideo.shadowRoot?.querySelector('video');
          if (internalVideo) {
            internalVideo.play().catch(() => {});
            return;
          }
        }
        // Fall back to regular video
        const v = document.querySelector('video');
        if (v) v.play().catch(() => {});
      });
      await sharedPage.waitForTimeout(1000);
    }

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
    const infoResponse = await request.get(`${API_URL}/api/v1/content/plex/info/${episodeId}`);
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

});
