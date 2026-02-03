/**
 * Governance Lock Screen Monitor Test
 *
 * Tracks every state change in the governance lock screen with precise timestamps.
 * Reports timing from lock screen appearance through user state changes to unlock.
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL, BACKEND_URL } from '#fixtures/runtime/urls.mjs';
import { FitnessSimHelper } from '#testlib/FitnessSimHelper.mjs';

const BASE_URL = FRONTEND_URL;
const API_URL = BACKEND_URL;

// Mario Kart Fitness - governed content from testdata.yml
const GOVERNED_CONTENT_ID = '606052';

test.describe('Governance Lock Screen Monitor', () => {
  test('tracks all state changes with precise timing from lock to unlock', async ({ browser }) => {
    // ═══════════════════════════════════════════════════════════════
    // TIMING INFRASTRUCTURE
    // ═══════════════════════════════════════════════════════════════
    const testStartTime = Date.now();
    const getElapsed = () => Date.now() - testStartTime;
    const formatMs = (ms) => `T+${ms}ms`;

    // Timeline of events with full state snapshots
    const timeline = [];
    const userHistory = {}; // Track each user's state changes

    const recordEvent = (event, data = {}) => {
      const elapsed = getElapsed();
      const entry = {
        t: elapsed,
        tFormatted: formatMs(elapsed),
        event,
        ...data
      };
      timeline.push(entry);
      return entry;
    };

    const recordUserState = (userName, state) => {
      if (!userHistory[userName]) {
        userHistory[userName] = [];
      }
      userHistory[userName].push({
        t: getElapsed(),
        ...state
      });
    };

    // ═══════════════════════════════════════════════════════════════
    // SETUP
    // ═══════════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(80));
    console.log('GOVERNANCE LOCK SCREEN TIMING ANALYSIS');
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
        if (!overlay) return { visible: false, rows: [] };

        const panel = overlay.querySelector('.governance-lock');
        const title = panel?.querySelector('.governance-lock__title')?.textContent?.trim() || null;
        const message = panel?.querySelector('.governance-lock__message')?.textContent?.trim() || null;
        const statusClass = [...overlay.classList].find(c => c.startsWith('governance-overlay--'));
        const status = statusClass?.replace('governance-overlay--', '') || 'unknown';

        const emptyRow = panel?.querySelector('.governance-lock__row--empty');
        const isEmpty = emptyRow !== null;

        const rows = [];
        const rowElements = panel?.querySelectorAll('.governance-lock__row:not(.governance-lock__row--header):not(.governance-lock__row--empty)') || [];

        rowElements.forEach(row => {
          const name = row.querySelector('.governance-lock__chip-name')?.textContent?.trim() || 'Unknown';
          const meta = row.querySelector('.governance-lock__chip-meta')?.textContent?.trim() || '';

          // Parse HR from meta (format: "currentHR / targetHR")
          const hrMatch = meta.match(/^(\d+)\s*\/\s*(\d+)$/);
          const currentHR = hrMatch ? parseInt(hrMatch[1], 10) : null;
          const targetHR = hrMatch ? parseInt(hrMatch[2], 10) : null;

          const currentPill = row.querySelector('.governance-lock__pill:not(.governance-lock__pill--target)');
          const targetPill = row.querySelector('.governance-lock__pill--target');

          const currentZone = currentPill?.textContent?.trim() || 'No signal';
          const targetZone = targetPill?.textContent?.trim() || 'Target';
          const currentZoneClass = [...(currentPill?.classList || [])].find(c => c.startsWith('zone-'))?.replace('zone-', '') || 'none';
          const targetZoneClass = [...(targetPill?.classList || [])].find(c => c.startsWith('zone-'))?.replace('zone-', '') || 'none';

          const progressIndicator = row.querySelector('.governance-lock__progress-indicator span');
          const progressText = progressIndicator?.textContent?.trim() || null;
          const progressPercent = progressText ? parseInt(progressText.replace('%', ''), 10) : null;

          rows.push({
            name,
            currentHR,
            targetHR,
            currentZone,
            currentZoneClass,
            targetZone,
            targetZoneClass,
            progressPercent,
            metTarget: currentHR !== null && targetHR !== null && currentHR >= targetHR
          });
        });

        return { visible: true, status, title, message, isEmpty, rows };
      });
    };

    // ═══════════════════════════════════════════════════════════════
    // TRACKING STATE
    // ═══════════════════════════════════════════════════════════════
    let lastState = { visible: false, rows: [], isEmpty: true };
    let lockScreenAppearedAt = null;
    let rowsAppearedAt = null;
    let unlockedAt = null;
    const seenUsers = new Set();

    const checkState = async () => {
      const state = await extractState();
      const now = getElapsed();

      // Lock screen visibility change
      if (!lastState.visible && state.visible) {
        lockScreenAppearedAt = now;
        recordEvent('LOCK_SCREEN_APPEARED', {
          status: state.status,
          title: state.title,
          message: state.message,
          isEmpty: state.isEmpty
        });

        // If lock screen appears with rows already, record them
        if (!state.isEmpty && state.rows.length > 0) {
          rowsAppearedAt = now;
          recordEvent('USER_ROWS_APPEARED', {
            count: state.rows.length,
            users: state.rows.map(r => r.name)
          });

          for (const row of state.rows) {
            if (!seenUsers.has(row.name)) {
              seenUsers.add(row.name);
              recordEvent('USER_INITIAL_STATE', {
                user: row.name,
                currentHR: row.currentHR,
                targetHR: row.targetHR,
                currentZone: row.currentZone,
                targetZone: row.targetZone,
                deficit: row.targetHR !== null && row.currentHR !== null ? row.targetHR - row.currentHR : null
              });
              recordUserState(row.name, {
                event: 'INITIAL',
                currentHR: row.currentHR,
                targetHR: row.targetHR,
                currentZone: row.currentZoneClass,
                targetZone: row.targetZoneClass,
                progress: row.progressPercent,
                metTarget: row.metTarget
              });
            }
          }
        }
      } else if (lastState.visible && !state.visible) {
        unlockedAt = now;
        recordEvent('LOCK_SCREEN_DISAPPEARED');
      }

      // Empty → rows transition (when lock screen was already visible)
      if (lastState.visible && lastState.isEmpty && !state.isEmpty && state.rows.length > 0) {
        rowsAppearedAt = now;
        recordEvent('USER_ROWS_APPEARED', {
          count: state.rows.length,
          users: state.rows.map(r => r.name)
        });

        for (const row of state.rows) {
          if (!seenUsers.has(row.name)) {
            seenUsers.add(row.name);
            recordEvent('USER_INITIAL_STATE', {
              user: row.name,
              currentHR: row.currentHR,
              targetHR: row.targetHR,
              currentZone: row.currentZone,
              targetZone: row.targetZone,
              deficit: row.targetHR !== null && row.currentHR !== null ? row.targetHR - row.currentHR : null
            });
            recordUserState(row.name, {
              event: 'INITIAL',
              currentHR: row.currentHR,
              targetHR: row.targetHR,
              currentZone: row.currentZoneClass,
              targetZone: row.targetZoneClass,
              progress: row.progressPercent,
              metTarget: row.metTarget
            });
          }
        }
      }

      // Check for new users appearing mid-flow
      if (state.visible && state.rows.length > 0) {
        for (const row of state.rows) {
          if (!seenUsers.has(row.name)) {
            seenUsers.add(row.name);
            recordEvent('USER_INITIAL_STATE', {
              user: row.name,
              currentHR: row.currentHR,
              targetHR: row.targetHR,
              currentZone: row.currentZone,
              targetZone: row.targetZone,
              deficit: row.targetHR !== null && row.currentHR !== null ? row.targetHR - row.currentHR : null
            });
            recordUserState(row.name, {
              event: 'INITIAL',
              currentHR: row.currentHR,
              targetHR: row.targetHR,
              currentZone: row.currentZoneClass,
              targetZone: row.targetZoneClass,
              progress: row.progressPercent,
              metTarget: row.metTarget
            });
          }
        }
      }

      // Check for changes in existing rows
      if (state.visible && state.rows.length > 0) {
        for (const row of state.rows) {
          const lastRow = lastState.rows?.find(r => r.name === row.name);

          if (lastRow) {
            // HR change
            if (lastRow.currentHR !== row.currentHR) {
              recordEvent('USER_HR_CHANGED', {
                user: row.name,
                from: lastRow.currentHR,
                to: row.currentHR,
                targetHR: row.targetHR,
                delta: row.currentHR - lastRow.currentHR,
                metTarget: row.metTarget
              });
              recordUserState(row.name, {
                event: 'HR_CHANGE',
                currentHR: row.currentHR,
                targetHR: row.targetHR,
                metTarget: row.metTarget
              });
            }

            // Zone change
            if (lastRow.currentZoneClass !== row.currentZoneClass) {
              recordEvent('USER_ZONE_CHANGED', {
                user: row.name,
                from: lastRow.currentZoneClass,
                to: row.currentZoneClass,
                currentHR: row.currentHR
              });
              recordUserState(row.name, {
                event: 'ZONE_CHANGE',
                from: lastRow.currentZoneClass,
                to: row.currentZoneClass,
                currentHR: row.currentHR
              });
            }

            // Progress change
            if (lastRow.progressPercent !== row.progressPercent) {
              recordEvent('USER_PROGRESS_CHANGED', {
                user: row.name,
                from: lastRow.progressPercent,
                to: row.progressPercent
              });
              recordUserState(row.name, {
                event: 'PROGRESS_CHANGE',
                progress: row.progressPercent
              });
            }

            // Target HR change
            if (lastRow.targetHR !== row.targetHR) {
              recordEvent('USER_TARGET_CHANGED', {
                user: row.name,
                from: lastRow.targetHR,
                to: row.targetHR
              });
            }
          }
        }

        // Check for removed users
        for (const lastRow of (lastState.rows || [])) {
          if (!state.rows.find(r => r.name === lastRow.name)) {
            recordEvent('USER_REMOVED', {
              user: lastRow.name,
              lastHR: lastRow.currentHR,
              targetHR: lastRow.targetHR,
              hadMetTarget: lastRow.metTarget
            });
            recordUserState(lastRow.name, {
              event: 'REMOVED',
              reason: lastRow.metTarget ? 'met_target' : 'unknown'
            });
          }
        }
      }

      lastState = state;
      return state;
    };

    try {
      // ═══════════════════════════════════════════════════════════════
      // NAVIGATION
      // ═══════════════════════════════════════════════════════════════
      recordEvent('NAVIGATION_START');
      await page.goto(`${BASE_URL}/fitness/play/${GOVERNED_CONTENT_ID}`);
      recordEvent('NAVIGATION_COMPLETE', { url: `/fitness/play/${GOVERNED_CONTENT_ID}` });

      await page.waitForSelector('.fitness-player, .fitness-app', { timeout: 15000 });
      recordEvent('PAGE_LOADED');

      await sim.waitForController();
      recordEvent('CONTROLLER_READY');

      // Check initial state immediately
      await checkState();

      // Get devices
      const devices = await sim.getDevices();
      recordEvent('DEVICES_ENUMERATED', { count: devices.length });

      // ═══════════════════════════════════════════════════════════════
      // SET ALL DEVICES TO COOL ZONE
      // ═══════════════════════════════════════════════════════════════
      recordEvent('SETTING_COOL_ZONE_START');
      for (const device of devices) {
        await sim.setZone(device.deviceId, 'cool');
        await page.waitForTimeout(200);
      }
      recordEvent('SETTING_COOL_ZONE_COMPLETE');

      await page.waitForTimeout(500);
      await checkState();

      // ═══════════════════════════════════════════════════════════════
      // MOVE USERS TO WARM ZONE ONE BY ONE
      // ═══════════════════════════════════════════════════════════════
      for (let i = 0; i < devices.length; i++) {
        const device = devices[i];

        recordEvent('SETTING_WARM_ZONE', { deviceIndex: i, deviceId: device.deviceId });
        await sim.setZone(device.deviceId, 'warm');

        // Poll for state changes
        for (let j = 0; j < 6; j++) {
          await page.waitForTimeout(400);
          const state = await checkState();
          if (!state.visible) break;
        }

        if (!lastState.visible) break;
      }

      // Final poll to ensure unlock is captured
      for (let i = 0; i < 10 && lastState.visible; i++) {
        await page.waitForTimeout(300);
        await checkState();
      }

      // ═══════════════════════════════════════════════════════════════
      // TIMING REPORT
      // ═══════════════════════════════════════════════════════════════
      console.log('\n' + '═'.repeat(80));
      console.log('TIMING REPORT');
      console.log('═'.repeat(80));

      // Key milestones
      console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ KEY MILESTONES                                                              │');
      console.log('├─────────────────────────────────────────────────────────────────────────────┤');

      const navStart = timeline.find(e => e.event === 'NAVIGATION_START')?.t || 0;
      const navComplete = timeline.find(e => e.event === 'NAVIGATION_COMPLETE')?.t || 0;
      const pageLoaded = timeline.find(e => e.event === 'PAGE_LOADED')?.t || 0;
      const controllerReady = timeline.find(e => e.event === 'CONTROLLER_READY')?.t || 0;

      console.log(`│ Navigation start:       ${formatMs(navStart).padEnd(12)} │`);
      console.log(`│ Navigation complete:    ${formatMs(navComplete).padEnd(12)} (+${navComplete - navStart}ms) │`);
      console.log(`│ Page loaded:            ${formatMs(pageLoaded).padEnd(12)} (+${pageLoaded - navComplete}ms) │`);
      console.log(`│ Controller ready:       ${formatMs(controllerReady).padEnd(12)} (+${controllerReady - pageLoaded}ms) │`);

      if (lockScreenAppearedAt) {
        console.log(`│ Lock screen appeared:   ${formatMs(lockScreenAppearedAt).padEnd(12)} (+${lockScreenAppearedAt - controllerReady}ms) │`);
      }
      if (rowsAppearedAt) {
        console.log(`│ User rows appeared:     ${formatMs(rowsAppearedAt).padEnd(12)} (+${rowsAppearedAt - (lockScreenAppearedAt || controllerReady)}ms) │`);
      }
      if (unlockedAt) {
        console.log(`│ Video unlocked:         ${formatMs(unlockedAt).padEnd(12)} (+${unlockedAt - (rowsAppearedAt || lockScreenAppearedAt || controllerReady)}ms) │`);
        console.log(`│ Total lock duration:    ${unlockedAt - (lockScreenAppearedAt || 0)}ms │`);
      }
      console.log('└─────────────────────────────────────────────────────────────────────────────┘');

      // User state progression
      console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ USER STATE PROGRESSION                                                      │');
      console.log('├─────────────────────────────────────────────────────────────────────────────┤');

      const userInitials = timeline.filter(e => e.event === 'USER_INITIAL_STATE');
      for (const init of userInitials) {
        const userName = init.user;
        const history = userHistory[userName] || [];
        const removed = timeline.find(e => e.event === 'USER_REMOVED' && e.user === userName);

        console.log(`│                                                                             │`);
        console.log(`│ ${userName.padEnd(12)} Initial: HR ${String(init.currentHR).padStart(3)}/${String(init.targetHR).padStart(3)} (deficit: ${String(init.deficit).padStart(3)}) │`);
        console.log(`│              Target zone: ${init.targetZone.padEnd(20)}                      │`);

        // Show HR changes
        const hrChanges = timeline.filter(e => e.event === 'USER_HR_CHANGED' && e.user === userName);
        for (const hrc of hrChanges) {
          const status = hrc.metTarget ? '✓ MET' : `deficit: ${hrc.targetHR - hrc.to}`;
          console.log(`│              ${formatMs(hrc.t).padEnd(10)} HR: ${String(hrc.from).padStart(3)} → ${String(hrc.to).padStart(3)} (${status}) │`);
        }

        // Show zone changes
        const zoneChanges = timeline.filter(e => e.event === 'USER_ZONE_CHANGED' && e.user === userName);
        for (const zc of zoneChanges) {
          console.log(`│              ${formatMs(zc.t).padEnd(10)} Zone: ${zc.from} → ${zc.to} │`);
        }

        if (removed) {
          const status = removed.hadMetTarget ? 'REQUIREMENT MET' : 'removed';
          console.log(`│              ${formatMs(removed.t).padEnd(10)} REMOVED (${status}) │`);
        }
      }
      console.log('└─────────────────────────────────────────────────────────────────────────────┘');

      // Full timeline
      console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ FULL EVENT TIMELINE                                                         │');
      console.log('├─────────────────────────────────────────────────────────────────────────────┤');

      let lastT = 0;
      for (const event of timeline) {
        const delta = event.t - lastT;
        const deltaStr = delta > 0 ? `+${delta}ms` : '';

        let details = '';
        switch (event.event) {
          case 'USER_INITIAL_STATE':
            details = `${event.user}: HR ${event.currentHR}/${event.targetHR}, target=${event.targetZone}`;
            break;
          case 'USER_HR_CHANGED':
            details = `${event.user}: ${event.from}→${event.to} BPM ${event.metTarget ? '✓' : ''}`;
            break;
          case 'USER_ZONE_CHANGED':
            details = `${event.user}: ${event.from}→${event.to}`;
            break;
          case 'USER_REMOVED':
            details = `${event.user} ${event.hadMetTarget ? '(met target)' : ''}`;
            break;
          case 'USER_PROGRESS_CHANGED':
            details = `${event.user}: ${event.from || 0}%→${event.to}%`;
            break;
          case 'LOCK_SCREEN_APPEARED':
            details = event.isEmpty ? 'empty (waiting for data)' : `${event.status}`;
            break;
          case 'USER_ROWS_APPEARED':
            details = `${event.count} users: ${event.users.join(', ')}`;
            break;
          default:
            details = '';
        }

        const line = `│ ${event.tFormatted.padEnd(10)} ${deltaStr.padEnd(8)} ${event.event.padEnd(25)} ${details.slice(0, 30).padEnd(30)} │`;
        console.log(line);
        lastT = event.t;
      }
      console.log('└─────────────────────────────────────────────────────────────────────────────┘');

      // Summary stats
      console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ SUMMARY                                                                     │');
      console.log('├─────────────────────────────────────────────────────────────────────────────┤');
      console.log(`│ Total events:           ${String(timeline.length).padEnd(10)}                                    │`);
      console.log(`│ Users tracked:          ${String(Object.keys(userHistory).length).padEnd(10)}                                    │`);
      console.log(`│ Users removed (met):    ${String(timeline.filter(e => e.event === 'USER_REMOVED' && e.hadMetTarget).length).padEnd(10)}                                    │`);
      console.log(`│ Lock duration:          ${String((unlockedAt || getElapsed()) - (lockScreenAppearedAt || 0)) + 'ms'}                              │`);
      console.log(`│ Video unlocked:         ${unlockedAt ? 'YES' : 'NO'}                                          │`);
      console.log('└─────────────────────────────────────────────────────────────────────────────┘');

      // Assertions
      expect(timeline.length).toBeGreaterThan(10);
      expect(unlockedAt).toBeTruthy();
      console.log('\n✓ Test passed: Video unlocked successfully');

    } finally {
      await sim.stopAll().catch(() => {});
      await context.close();
    }
  });
});
