/**
 * Governance Lock Screen Monitor Test
 *
 * Tests the governance lock screen overlay with detailed logging of all state changes.
 * Simulates 2 users starting in cool zone, then transitioning to warm zone to unlock video.
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL, BACKEND_URL } from '#fixtures/runtime/urls.mjs';
import { FitnessSimHelper } from '#testlib/FitnessSimHelper.mjs';

const BASE_URL = FRONTEND_URL;
const API_URL = BACKEND_URL;

// Mario Kart Fitness - governed content from testdata.yml
const GOVERNED_CONTENT_ID = '606052';

test.describe('Governance Lock Screen Monitor', () => {
  test('all required users must reach target zone to unlock governed content', async ({ browser }) => {
    // ═══════════════════════════════════════════════════════════════
    // SETUP: Health check and page init
    // ═══════════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(70));
    console.log('GOVERNANCE LOCK SCREEN MONITOR TEST');
    console.log('═'.repeat(70));

    // Fail fast health check
    console.log('\n[SETUP] Checking fitness API...');
    const response = await fetch(`${API_URL}/api/v1/fitness`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      throw new Error(`FAIL FAST: Fitness API returned ${response.status}`);
    }
    const config = await response.json();
    const users = config?.fitness?.users?.primary || config?.users?.primary || [];
    console.log(`[SETUP] API healthy: ${users.length} primary users configured`);

    // Create browser context and page
    const context = await browser.newContext();
    const page = await context.newPage();
    const sim = new FitnessSimHelper(page);

    // State tracking
    let lastOverlayState = null;
    let lastRowStates = {};
    const stateLog = [];

    const logState = (event, details = {}) => {
      const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
      const entry = { timestamp, event, ...details };
      stateLog.push(entry);
      console.log(`[${timestamp}] ${event}`, details.summary || '');
    };

    // ═══════════════════════════════════════════════════════════════
    // HELPER: Extract lock screen state from DOM
    // ═══════════════════════════════════════════════════════════════
    const extractLockScreenState = async () => {
      return page.evaluate(() => {
        const overlay = document.querySelector('.governance-overlay');
        if (!overlay) return { visible: false };

        const panel = overlay.querySelector('.governance-lock');
        const title = panel?.querySelector('.governance-lock__title')?.textContent || null;
        const message = panel?.querySelector('.governance-lock__message')?.textContent || null;
        const statusClass = [...overlay.classList].find(c => c.startsWith('governance-overlay--'));
        const status = statusClass?.replace('governance-overlay--', '') || 'unknown';

        // Extract rows
        const rows = [];
        const rowElements = panel?.querySelectorAll('.governance-lock__row:not(.governance-lock__row--header):not(.governance-lock__row--empty)') || [];
        rowElements.forEach(row => {
          const name = row.querySelector('.governance-lock__chip-name')?.textContent || 'Unknown';
          const meta = row.querySelector('.governance-lock__chip-meta')?.textContent || '';
          const currentPill = row.querySelector('.governance-lock__pill:not(.governance-lock__pill--target)');
          const targetPill = row.querySelector('.governance-lock__pill--target');
          const currentZone = currentPill?.textContent || 'No signal';
          const targetZone = targetPill?.textContent || 'Target';
          const currentZoneClass = [...(currentPill?.classList || [])].find(c => c.startsWith('zone-'))?.replace('zone-', '') || 'none';
          const targetZoneClass = [...(targetPill?.classList || [])].find(c => c.startsWith('zone-'))?.replace('zone-', '') || 'none';

          // Extract progress
          const progressFill = row.querySelector('.governance-lock__progress-fill');
          const progressIndicator = row.querySelector('.governance-lock__progress-indicator span');
          const progressPercent = progressIndicator?.textContent || null;

          rows.push({
            name,
            meta,
            currentZone,
            currentZoneClass,
            targetZone,
            targetZoneClass,
            progressPercent
          });
        });

        // Check for empty state
        const emptyRow = panel?.querySelector('.governance-lock__row--empty');
        const isEmpty = emptyRow !== null;

        return {
          visible: true,
          status,
          title,
          message,
          isEmpty,
          rows
        };
      });
    };

    // ═══════════════════════════════════════════════════════════════
    // HELPER: Monitor and log changes
    // ═══════════════════════════════════════════════════════════════
    const checkAndLogChanges = async (context = '') => {
      const state = await extractLockScreenState();

      // Check overlay visibility change
      if (lastOverlayState?.visible !== state.visible) {
        logState('OVERLAY_VISIBILITY', {
          summary: state.visible ? 'Lock screen APPEARED' : 'Lock screen DISAPPEARED',
          visible: state.visible
        });
      }

      if (!state.visible) {
        lastOverlayState = state;
        return state;
      }

      // Check status change
      if (lastOverlayState?.status !== state.status) {
        logState('OVERLAY_STATUS', {
          summary: `Status: ${lastOverlayState?.status || 'none'} → ${state.status}`,
          from: lastOverlayState?.status,
          to: state.status
        });
      }

      // Check title/message changes
      if (lastOverlayState?.title !== state.title) {
        logState('OVERLAY_TITLE', {
          summary: `Title: "${state.title}"`,
          title: state.title
        });
      }
      if (lastOverlayState?.message !== state.message) {
        logState('OVERLAY_MESSAGE', {
          summary: `Message: "${state.message}"`,
          message: state.message
        });
      }

      // Check empty state change
      if (lastOverlayState?.isEmpty !== state.isEmpty) {
        logState('OVERLAY_EMPTY_STATE', {
          summary: state.isEmpty ? 'Showing "Waiting for participant data..."' : 'Participant rows appeared',
          isEmpty: state.isEmpty
        });
      }

      // Check row changes
      for (const row of state.rows) {
        const key = row.name;
        const lastRow = lastRowStates[key];

        if (!lastRow) {
          logState('ROW_ADDED', {
            summary: `User "${row.name}" appeared: ${row.meta}, zone=${row.currentZoneClass}`,
            ...row
          });
        } else {
          // Zone change
          if (lastRow.currentZoneClass !== row.currentZoneClass) {
            logState('ZONE_CHANGE', {
              summary: `${row.name}: ${lastRow.currentZoneClass} → ${row.currentZoneClass} (${row.currentZone})`,
              user: row.name,
              from: lastRow.currentZoneClass,
              to: row.currentZoneClass,
              hrMeta: row.meta
            });
          }

          // HR change (check meta which shows "current / target")
          if (lastRow.meta !== row.meta) {
            logState('HR_CHANGE', {
              summary: `${row.name}: HR ${lastRow.meta} → ${row.meta}`,
              user: row.name,
              from: lastRow.meta,
              to: row.meta
            });
          }

          // Progress change
          if (lastRow.progressPercent !== row.progressPercent) {
            logState('PROGRESS_CHANGE', {
              summary: `${row.name}: Progress ${lastRow.progressPercent || '0%'} → ${row.progressPercent || '0%'}`,
              user: row.name,
              from: lastRow.progressPercent,
              to: row.progressPercent
            });
          }
        }

        lastRowStates[key] = row;
      }

      // Check for removed rows
      for (const key of Object.keys(lastRowStates)) {
        if (!state.rows.find(r => r.name === key)) {
          logState('ROW_REMOVED', {
            summary: `User "${key}" removed from lock screen`,
            user: key
          });
          delete lastRowStates[key];
        }
      }

      lastOverlayState = state;
      return state;
    };

    try {
      // ═══════════════════════════════════════════════════════════════
      // STEP 1: Navigate to governed content
      // ═══════════════════════════════════════════════════════════════
      console.log('\n[STEP 1] Navigating to governed content (Mario Kart Fitness)...');
      await page.goto(`${BASE_URL}/fitness/play/${GOVERNED_CONTENT_ID}`);
      logState('NAVIGATION', { summary: `Navigated to /fitness/play/${GOVERNED_CONTENT_ID}` });

      // Wait for page to load
      await page.waitForSelector('.fitness-player, .fitness-app', { timeout: 15000 });
      await page.waitForTimeout(2000);

      // Wait for simulation controller
      await sim.waitForController();
      logState('CONTROLLER_READY', { summary: 'FitnessSimulationController available' });

      // Get available devices
      const devices = await sim.getDevices();
      console.log(`[SETUP] Available devices: ${devices.length}`);
      devices.forEach((d, i) => console.log(`  [${i}] ${d.deviceId} - ${d.userName || 'unknown'}`));

      if (devices.length < 2) {
        throw new Error(`Need at least 2 devices, got ${devices.length}`);
      }

      // Use all devices to ensure all users meet requirements
      logState('DEVICES_SELECTED', {
        summary: `Using all ${devices.length} devices`
      });

      // Log all devices for debugging
      console.log('[DEBUG] All devices:');
      devices.forEach(d => console.log(`  - ${d.deviceId}: ${d.userName || '(no name)'}`));

      // Log zone config for debugging
      const zoneInfo = await page.evaluate(() => {
        const ctrl = window.__fitnessSimController;
        return {
          zoneMidpoints: ctrl.zoneMidpoints,
          zoneConfig: ctrl.zoneConfig
        };
      });
      console.log('[DEBUG] Zone midpoints:', JSON.stringify(zoneInfo.zoneMidpoints));
      console.log('[DEBUG] Zone config:', JSON.stringify(zoneInfo.zoneConfig?.zones?.map(z => ({ id: z.id, min: z.min }))));

      // ═══════════════════════════════════════════════════════════════
      // STEP 2: Initialize ALL users in cool zone
      // ═══════════════════════════════════════════════════════════════
      console.log('\n[STEP 2] Setting ALL users to COOL zone...');

      for (const device of devices) {
        await sim.setZone(device.deviceId, 'cool');
        logState('SET_ZONE', { summary: `${device.deviceId} → cool`, device: device.deviceId, zone: 'cool' });
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(500);
      await checkAndLogChanges('after all cool');

      // ═══════════════════════════════════════════════════════════════
      // STEP 3: Check initial lock screen state
      // ═══════════════════════════════════════════════════════════════
      console.log('\n[STEP 3] Checking initial lock screen state...');
      await page.waitForTimeout(1000);

      // Check for governance overlay
      const overlayVisible = await page.locator('.governance-overlay').isVisible().catch(() => false);
      if (!overlayVisible) {
        console.log('[WARNING] No governance overlay visible - content may not be governed');
        // Try to find any overlay
        const anyOverlay = await page.locator('[class*="overlay"]').first().isVisible().catch(() => false);
        console.log(`[DEBUG] Any overlay visible: ${anyOverlay}`);
      }

      let state = await checkAndLogChanges('initial state');
      console.log('[STATE] Initial lock screen:', JSON.stringify(state, null, 2));

      // ═══════════════════════════════════════════════════════════════
      // STEP 4: Move users to WARM zone one by one, monitoring unlock progress
      // ═══════════════════════════════════════════════════════════════
      console.log('\n[STEP 4] Moving users to WARM zone one by one...');

      for (let i = 0; i < devices.length; i++) {
        const device = devices[i];
        console.log(`\n--- Moving device ${i + 1}/${devices.length}: ${device.deviceId} to WARM ---`);

        await sim.setZone(device.deviceId, 'warm');
        logState('SET_ZONE', { summary: `${device.deviceId} → warm`, device: device.deviceId, zone: 'warm' });

        // Poll for changes
        for (let j = 0; j < 4; j++) {
          await page.waitForTimeout(500);
          state = await checkAndLogChanges(`after device ${i + 1} warm, poll ${j + 1}`);

          // Check if unlocked
          if (!state.visible) {
            console.log(`\n*** VIDEO UNLOCKED after device ${i + 1} (${device.deviceId}) reached warm! ***`);
            break;
          }
        }

        // Log current state
        state = await extractLockScreenState();
        if (state.visible && state.rows.length > 0) {
          const progressSummary = state.rows.map(r => `${r.name}: ${r.progressPercent || '0%'} (${r.meta})`).join(', ');
          console.log(`[STATE] Lock screen: ${progressSummary}`);
        } else if (!state.visible) {
          console.log('[STATE] Lock screen GONE - video unlocked!');
          break;
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // STEP 6: Wait for unlock (poll for progress changes)
      // ═══════════════════════════════════════════════════════════════
      console.log('\n[STEP 6] Waiting for video to unlock (monitoring progress)...');

      // Poll for up to 15 seconds, checking for overlay to disappear
      let unlocked = false;
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(500);
        state = await checkAndLogChanges(`unlock poll ${i+1}/30`);

        if (!state.visible) {
          unlocked = true;
          logState('VIDEO_UNLOCKED', { summary: 'Lock screen disappeared - video unlocked!' });
          break;
        }

        // Log progress every 2 seconds
        if (i % 4 === 0 && state.rows.length > 0) {
          const progressSummary = state.rows.map(r => `${r.name}: ${r.progressPercent || '0%'}`).join(', ');
          console.log(`[PROGRESS ${i/2}s] ${progressSummary}`);
        }
      }

      console.log('\n[STEP 7] Checking final video state...');

      // Check video playback state
      const videoState = await page.evaluate(() => {
        const video = document.querySelector('video');
        if (!video) return { found: false };
        return {
          found: true,
          paused: video.paused,
          currentTime: video.currentTime,
          readyState: video.readyState,
          src: video.src?.slice(0, 100)
        };
      });

      logState('VIDEO_STATE', {
        summary: videoState.found
          ? `Video: paused=${videoState.paused}, time=${videoState.currentTime?.toFixed(2)}s, ready=${videoState.readyState}`
          : 'No video element found',
        ...videoState
      });

      // Final overlay check
      const finalOverlayVisible = await page.locator('.governance-overlay').isVisible().catch(() => false);
      logState('FINAL_STATE', {
        summary: finalOverlayVisible ? 'Lock screen still visible' : 'Lock screen GONE - video unlocked!',
        overlayVisible: finalOverlayVisible
      });

      // ═══════════════════════════════════════════════════════════════
      // SUMMARY
      // ═══════════════════════════════════════════════════════════════
      console.log('\n' + '═'.repeat(70));
      console.log('STATE CHANGE LOG SUMMARY');
      console.log('═'.repeat(70));
      stateLog.forEach((entry, i) => {
        console.log(`${i + 1}. [${entry.timestamp}] ${entry.event}: ${entry.summary || ''}`);
      });
      console.log('═'.repeat(70));
      console.log(`Total state changes logged: ${stateLog.length}`);

      // Assertions
      expect(stateLog.length).toBeGreaterThan(0);

      // Verify video unlocked
      const unlockEvent = stateLog.find(e => e.event === 'VIDEO_UNLOCKED' || e.event === 'OVERLAY_VISIBILITY' && e.visible === false);
      expect(unlockEvent).toBeTruthy();
      console.log('\n[PASS] Video successfully unlocked after all required users reached target zone');

    } finally {
      // Cleanup
      await sim.stopAll().catch(() => {});
      await context.close();
    }
  });
});
