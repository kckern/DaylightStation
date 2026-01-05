/**
 * Fitness Session Save E2E Tests
 *
 * Tests that fitness sessions run correctly and persist to file.
 * Uses the simulation script to generate realistic device data.
 */

import { test, expect } from '@playwright/test';
import {
  stopDevServer,
  startDevServer,
  clearDevLog,
  runSimulation,
  getSessionFilesForToday,
  getLatestSessionFile,
  readSessionFile,
  validateSessionStructure,
  logContains
} from './fitness-test-utils.mjs';

// Default simulation duration (can be overridden via env)
const SIMULATION_DURATION = parseInt(process.env.FITNESS_SIM_DURATION || '120', 10);
const BACKEND_URL = 'http://localhost:3112';

test.describe('Fitness Session Save', () => {
  let sessionFilesBefore = [];

  test.beforeAll(async () => {
    console.log('Setting up fitness session tests...');

    // Kill any existing dev server
    await stopDevServer();

    // Clear dev.log for fresh logging
    await clearDevLog();

    // Start fresh dev server
    await startDevServer(90000);

    // Record existing session files (to detect new ones)
    sessionFilesBefore = await getSessionFilesForToday();
    console.log(`Found ${sessionFilesBefore.length} existing session files for today`);
  });

  test.afterAll(async () => {
    // Optionally stop server - leave running for faster iteration
    // await stopDevServer();
    console.log('Fitness session tests complete');
  });

  test('session file is created after simulation', async ({ page }) => {
    // Verify backend is available
    const healthCheck = await page.request.get(`${BACKEND_URL}/health`).catch(() => null);
    if (!healthCheck?.ok()) {
      test.skip();
      return;
    }

    // Navigate to fitness page to activate the app
    await page.goto('/fitness');
    await page.waitForLoadState('networkidle');

    // Run simulation
    console.log(`Running ${SIMULATION_DURATION}s simulation...`);
    await runSimulation(SIMULATION_DURATION);

    // Wait for final autosave
    await page.waitForTimeout(10000);

    // Check for new session file
    const sessionFilesAfter = await getSessionFilesForToday();
    console.log(`Found ${sessionFilesAfter.length} session files after simulation`);

    expect(sessionFilesAfter.length).toBeGreaterThan(sessionFilesBefore.length);
  });

  test('session file has valid structure', async () => {
    const sessionPath = await getLatestSessionFile();
    expect(sessionPath).toBeTruthy();

    const session = await readSessionFile(sessionPath);
    const validation = validateSessionStructure(session);

    if (!validation.valid) {
      console.error('Validation failed:', validation.reason);
    }

    expect(validation.valid).toBe(true);
  });

  test('session data reflects simulation accurately', async () => {
    const sessionPath = await getLatestSessionFile();
    expect(sessionPath).toBeTruthy();

    const session = await readSessionFile(sessionPath);

    // Duration should be approximately what we simulated (within 20% tolerance)
    const expectedMs = SIMULATION_DURATION * 1000;
    expect(session.durationMs).toBeGreaterThan(expectedMs * 0.8);
    expect(session.durationMs).toBeLessThan(expectedMs * 1.2);

    // Should have tick data (5-second intervals)
    const expectedTicks = Math.floor(SIMULATION_DURATION / 5);
    const actualTicks = session.timeline?.timebase?.tickCount || 0;
    console.log(`Expected ~${expectedTicks} ticks, got ${actualTicks}`);
    expect(actualTicks).toBeGreaterThan(expectedTicks * 0.7);

    // Should have user series data
    const seriesKeys = Object.keys(session.timeline?.series || {});
    const userSeries = seriesKeys.filter(k => k.startsWith('user:'));
    const deviceSeries = seriesKeys.filter(k => k.startsWith('device:'));

    console.log(`Series: ${userSeries.length} user, ${deviceSeries.length} device`);
    expect(userSeries.length).toBeGreaterThan(0);
    expect(deviceSeries.length).toBeGreaterThan(0);

    // Should have heart-rate data in series
    const hrSeries = seriesKeys.filter(k => k.includes('heart-rate'));
    expect(hrSeries.length).toBeGreaterThan(0);
  });

  test('UI displays chart during session', async ({ page }) => {
    // Navigate to fitness page
    await page.goto('/fitness');
    await page.waitForLoadState('networkidle');

    // Run a short simulation just to verify UI
    const shortDuration = 15;
    console.log(`Running ${shortDuration}s UI verification simulation...`);

    // Start simulation in background
    const simPromise = runSimulation(shortDuration);

    // Wait for chart to appear
    // The chart component should become visible when data arrives
    const chart = page.locator('.fitness-chart, [data-testid="fitness-chart"], .recharts-wrapper');
    await expect(chart).toBeVisible({ timeout: 20000 });

    // Wait for simulation to complete
    await simPromise;
  });

  test('debug logging shows save attempts', async () => {
    // Check that our debug logging captured save attempts
    const hasSessionSave = logContains('SESSION_SAVE');
    const hasSessionSaved = logContains('SESSION_SAVED');

    console.log(`Log contains SESSION_SAVE: ${hasSessionSave}`);
    console.log(`Log contains SESSION_SAVED: ${hasSessionSaved}`);

    // At least one save should have been attempted
    expect(hasSessionSave || hasSessionSaved).toBe(true);

    // Check for validation failures (these would indicate the bug we're tracking)
    const hasValidationFail = logContains('VALIDATION_FAIL');
    if (hasValidationFail) {
      console.warn('WARNING: Validation failures detected in logs');
    }
  });
});
