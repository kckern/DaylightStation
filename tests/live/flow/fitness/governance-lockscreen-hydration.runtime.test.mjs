/**
 * Governance Lock Screen Hydration Test
 *
 * Parameterized test covering two scenarios:
 * 1. HR-first: HR simulation starts before video (data available when lock screen appears)
 * 2. Video-first: Video starts first, see "waiting for users", then HR monitoring starts
 *
 * Exit criteria: Both scenarios must show proper zone labels (no "Target zone" placeholders)
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL, BACKEND_URL } from '#fixtures/runtime/urls.mjs';
import { FitnessSimHelper } from '#testlib/FitnessSimHelper.mjs';

const BASE_URL = FRONTEND_URL;
const API_URL = BACKEND_URL;

// Mario Kart Fitness - governed content from testdata.yml
const GOVERNED_CONTENT_ID = '606052';

// Test both scenarios
const scenarios = [
  { name: 'hr-first', description: 'HR data sent before lock screen appears' },
  { name: 'video-first', description: 'Lock screen appears first, then HR data sent' }
];

for (const scenario of scenarios) {
  test.describe(`Governance Lock Screen Hydration (${scenario.name})`, () => {
    test(`${scenario.description}`, async ({ browser }) => {
      // ═══════════════════════════════════════════════════════════════
      // TIMING INFRASTRUCTURE
      // ═══════════════════════════════════════════════════════════════
      const testStartTime = Date.now();
      const getElapsed = () => Date.now() - testStartTime;
      const formatMs = (ms) => `T+${ms}ms`;

      const timeline = [];
      const recordEvent = (event, data = {}) => {
        const elapsed = getElapsed();
        timeline.push({ t: elapsed, tFormatted: formatMs(elapsed), event, ...data });
      };

      // ═══════════════════════════════════════════════════════════════
      // SETUP
      // ═══════════════════════════════════════════════════════════════
      console.log('\n' + '═'.repeat(80));
      console.log(`GOVERNANCE LOCK SCREEN HYDRATION TEST - ${scenario.name.toUpperCase()}`);
      console.log('═'.repeat(80));

      // Health check
      const response = await fetch(`${API_URL}/api/v1/fitness`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`FAIL FAST: Fitness API returned ${response.status}`);
      recordEvent('API_HEALTHY');

      const context = await browser.newContext();
      const page = await context.newPage();
      const sim = new FitnessSimHelper(page);

      // ═══════════════════════════════════════════════════════════════
      // HELPER: Extract detailed lock screen state
      // ═══════════════════════════════════════════════════════════════
      const extractState = async () => {
        return page.evaluate(() => {
          const overlay = document.querySelector('.governance-overlay');
          if (!overlay) return { visible: false, phase: 'NO_OVERLAY', rows: [] };

          const panel = overlay.querySelector('.governance-lock');
          if (!panel) return { visible: true, phase: 'OVERLAY_NO_PANEL', rows: [] };

          const title = panel.querySelector('.governance-lock__title')?.textContent?.trim() || null;
          const message = panel.querySelector('.governance-lock__message')?.textContent?.trim() || null;
          const emptyRow = panel.querySelector('.governance-lock__row--empty');
          const rowElements = panel.querySelectorAll('.governance-lock__row:not(.governance-lock__row--header):not(.governance-lock__row--empty)');

          const rows = [];
          rowElements.forEach(row => {
            const name = row.querySelector('.governance-lock__chip-name')?.textContent?.trim() || 'Unknown';
            const meta = row.querySelector('.governance-lock__chip-meta')?.textContent?.trim() || '';
            const currentPill = row.querySelector('.governance-lock__pill:not(.governance-lock__pill--target)');
            const targetPill = row.querySelector('.governance-lock__pill--target');
            const currentZone = currentPill?.textContent?.trim() || 'No signal';
            const targetZone = targetPill?.textContent?.trim() || 'Target';

            const hrMatch = meta.match(/^(\d+)\s*\/\s*(\d+)$/);
            const hasValidHR = hrMatch !== null;
            const hasCurrentZone = currentZone && currentZone !== 'No signal' && currentZone !== '';
            const hasTargetZone = targetZone && targetZone !== 'Target' && targetZone !== 'Target zone' && targetZone !== 'Zone' && targetZone !== '';

            rows.push({
              name,
              meta,
              currentZone,
              targetZone,
              hasValidHR,
              hasCurrentZone,
              hasTargetZone,
              fullyHydrated: hasValidHR && hasCurrentZone && hasTargetZone
            });
          });

          // Determine phase
          let phase;
          if (emptyRow) {
            phase = 'EMPTY_WAITING';
          } else if (rowElements.length === 0) {
            phase = 'PANEL_NO_ROWS';
          } else {
            const allHydrated = rows.every(r => r.fullyHydrated);
            const someHydrated = rows.some(r => r.fullyHydrated);
            const anyHasHR = rows.some(r => r.hasValidHR);

            if (allHydrated) {
              phase = 'FULLY_HYDRATED';
            } else if (someHydrated) {
              phase = 'PARTIALLY_HYDRATED';
            } else if (anyHasHR) {
              phase = 'HR_PRESENT_ZONES_PENDING';
            } else {
              phase = 'ROWS_PRESENT_DATA_PENDING';
            }
          }

          return { visible: true, phase, title, message, isEmpty: !!emptyRow, rowCount: rows.length, rows };
        });
      };

      // Track problematic states (placeholders)
      const problematicStates = [];
      const checkForPlaceholders = (state) => {
        if (!state.visible || state.rows.length === 0) return;

        for (const row of state.rows) {
          if (row.targetZone === 'Target zone') {
            problematicStates.push({
              t: getElapsed(),
              issue: 'TARGET_ZONE_PLACEHOLDER',
              row: row.name,
              targetZone: row.targetZone
            });
          }
          if (row.meta && row.meta.includes('/ 60')) {
            problematicStates.push({
              t: getElapsed(),
              issue: 'HR_60_PLACEHOLDER',
              row: row.name,
              meta: row.meta
            });
          }
        }
      };

      try {
        // ═══════════════════════════════════════════════════════════════
        // NAVIGATION
        // ═══════════════════════════════════════════════════════════════
        recordEvent('NAVIGATION_START');
        await page.goto(`${BASE_URL}/fitness/play/${GOVERNED_CONTENT_ID}`);
        recordEvent('NAVIGATION_COMPLETE');

        await page.waitForSelector('.fitness-player, .fitness-app', { timeout: 15000 });
        recordEvent('PAGE_LOADED');

        await sim.waitForController();
        recordEvent('CONTROLLER_READY');

        const devices = await sim.getDevices();
        recordEvent('DEVICES_ENUMERATED', { count: devices.length });

        // ═══════════════════════════════════════════════════════════════
        // SCENARIO-SPECIFIC LOGIC
        // ═══════════════════════════════════════════════════════════════

        if (scenario.name === 'hr-first') {
          // HR-FIRST: Send HR data immediately, then observe hydration
          console.log('\n[HR-FIRST] Sending HR data before lock screen appears...');

          // Send HR for first device immediately
          await sim.setZone(devices[0].deviceId, 'cool');
          recordEvent('HR_SENT_FIRST_DEVICE', { deviceId: devices[0].deviceId });

          // Rapid poll for hydration
          const hydrationEvents = [];
          let lastPhase = null;

          for (let i = 0; i < 150; i++) {
            const state = await extractState();
            checkForPlaceholders(state);

            if (state.phase !== lastPhase) {
              hydrationEvents.push({ t: getElapsed(), ...state });
              recordEvent('HYDRATION_STATE', { phase: state.phase, rowCount: state.rowCount });
              console.log(`  [${formatMs(getElapsed())}] Phase: ${state.phase}, Rows: ${state.rowCount}`);

              if (state.rows.length > 0) {
                state.rows.forEach(r => {
                  console.log(`    - ${r.name}: target="${r.targetZone}" [hydrated: ${r.fullyHydrated}]`);
                });
              }
              lastPhase = state.phase;
            }

            // Send HR for additional devices periodically
            const deviceIndex = Math.floor(i / 10) + 1;
            if (i > 0 && i % 10 === 0 && deviceIndex < devices.length) {
              await sim.setZone(devices[deviceIndex].deviceId, 'cool');
            }

            if (state.phase === 'FULLY_HYDRATED' && state.rowCount >= 3) {
              console.log(`  [${formatMs(getElapsed())}] Fully hydrated with ${state.rowCount} rows`);
              break;
            }

            await page.waitForTimeout(30);
          }

        } else {
          // VIDEO-FIRST: Wait for lock screen, verify "waiting" state, then send HR
          console.log('\n[VIDEO-FIRST] Waiting for lock screen to appear with empty state...');

          // Wait for lock screen to appear
          let waitingStateObserved = false;
          for (let i = 0; i < 200; i++) {
            const state = await extractState();

            if (state.visible && state.isEmpty) {
              waitingStateObserved = true;
              recordEvent('LOCK_SCREEN_EMPTY', { message: state.message });
              console.log(`  [${formatMs(getElapsed())}] Lock screen appeared - EMPTY state`);
              console.log(`    Message: "${state.message}"`);
              break;
            }

            if (state.visible && state.rowCount > 0) {
              // Lock screen appeared with data already - record but continue
              console.log(`  [${formatMs(getElapsed())}] Lock screen appeared with ${state.rowCount} rows (unexpected for video-first)`);
            }

            await page.waitForTimeout(50);
          }

          if (!waitingStateObserved) {
            console.log('  WARNING: Empty "waiting" state was not observed');
          }

          // Now start sending HR data and observe row population
          console.log('\n[VIDEO-FIRST] Starting HR simulation, observing row population...');

          const hydrationEvents = [];
          let lastPhase = null;

          for (let i = 0; i < devices.length; i++) {
            const device = devices[i];
            await sim.setZone(device.deviceId, 'cool');
            recordEvent('HR_SENT', { deviceIndex: i, deviceId: device.deviceId });
            console.log(`  [${formatMs(getElapsed())}] Sent HR for device[${i}]: ${device.deviceId}`);

            // Poll for state changes after each device
            for (let j = 0; j < 20; j++) {
              const state = await extractState();
              checkForPlaceholders(state);

              if (state.phase !== lastPhase || (state.rowCount > 0 && hydrationEvents[hydrationEvents.length - 1]?.rowCount !== state.rowCount)) {
                hydrationEvents.push({ t: getElapsed(), ...state });
                recordEvent('HYDRATION_STATE', { phase: state.phase, rowCount: state.rowCount });
                console.log(`  [${formatMs(getElapsed())}] Phase: ${state.phase}, Rows: ${state.rowCount}`);

                if (state.rows.length > 0) {
                  state.rows.forEach(r => {
                    console.log(`    - ${r.name}: target="${r.targetZone}" [hydrated: ${r.fullyHydrated}]`);
                  });
                }
                lastPhase = state.phase;
              }

              await page.waitForTimeout(100);
            }
          }

          // Verify we saw the "waiting" → "populated" transition
          expect(waitingStateObserved).toBe(true);
        }

        // ═══════════════════════════════════════════════════════════════
        // UNLOCK SEQUENCE (same for both scenarios)
        // ═══════════════════════════════════════════════════════════════
        console.log('\n[UNLOCK] Moving users to target zone...');

        // Ensure all devices are in cool zone first
        for (const device of devices) {
          await sim.setZone(device.deviceId, 'cool');
        }
        await page.waitForTimeout(1000);

        // Move to warm zone (target) one by one
        let unlocked = false;
        for (const device of devices) {
          await sim.setZone(device.deviceId, 'warm');
          console.log(`  [${formatMs(getElapsed())}] Set device ${device.deviceId} to warm zone`);

          // Poll for unlock after each device
          for (let i = 0; i < 15; i++) {
            await page.waitForTimeout(400);
            const state = await extractState();
            checkForPlaceholders(state);

            if (!state.visible) {
              unlocked = true;
              recordEvent('UNLOCKED');
              console.log(`  [${formatMs(getElapsed())}] Video unlocked!`);
              break;
            }
          }

          if (unlocked) break;
        }

        // Final poll if still locked
        if (!unlocked) {
          for (let i = 0; i < 20; i++) {
            await page.waitForTimeout(300);
            const state = await extractState();
            if (!state.visible) {
              unlocked = true;
              recordEvent('UNLOCKED');
              console.log(`  [${formatMs(getElapsed())}] Video unlocked!`);
              break;
            }
          }
        }

        // ═══════════════════════════════════════════════════════════════
        // RESULTS
        // ═══════════════════════════════════════════════════════════════
        console.log('\n' + '═'.repeat(80));
        console.log('RESULTS');
        console.log('═'.repeat(80));

        console.log(`\n  Scenario: ${scenario.name}`);
        console.log(`  Video unlocked: ${unlocked ? 'YES' : 'NO'}`);
        console.log(`  Placeholder issues found: ${problematicStates.length}`);

        if (problematicStates.length > 0) {
          console.log('\n  PLACEHOLDER ISSUES:');
          for (const issue of problematicStates) {
            console.log(`    [${formatMs(issue.t)}] ${issue.issue}: ${issue.row} - ${issue.targetZone || issue.meta}`);
          }
        }

        // ═══════════════════════════════════════════════════════════════
        // ASSERTIONS
        // ═══════════════════════════════════════════════════════════════

        // Must unlock
        expect(unlocked, 'Video should unlock after meeting zone requirements').toBe(true);

        // No placeholder issues
        expect(
          problematicStates.length,
          `Should have no placeholder issues, but found: ${problematicStates.map(s => `${s.issue} at ${s.t}ms`).join(', ')}`
        ).toBe(0);

        console.log('\n✓ Test passed: No placeholders, video unlocked');

      } finally {
        await sim.stopAll().catch(() => {});
        await context.close();
      }
    });
  });
}
