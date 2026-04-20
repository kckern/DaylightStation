/**
 * Fitness Player — Stale Transcode Session Recovery Test
 *
 * Simulates the real failure mode: Plex-side transcode session death.
 * When a session dies mid-playback, all segment requests for that session
 * return 404. dash.js fires code-28 errors → watchdog escalates →
 * resilience recovery → hardReset cache-busts the <dash-video> src →
 * backend mints a fresh Plex transcode session → playback resumes.
 *
 * Technique:
 * - Intercept segment requests matching the FIRST session UUID seen
 * - Return 404 for all requests to that session (simulating dead session)
 * - Requests to any NEW session UUID are passed through (fresh session works)
 * - Verify window.__fitnessRecoveryEvents shows stream-url-refreshed fired
 * - Verify video eventually plays via the new session
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL, BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = FRONTEND_URL;
const API_URL = BACKEND_URL;

// Plex rating key for a known fitness video.
// Override via TEST_PLEX_ID env var if the default is unavailable.
const TEST_ID = process.env.TEST_PLEX_ID || '674498';

test.describe('Fitness player — stale transcode session recovery', () => {
  test.beforeAll(async () => {
    // FAIL FAST: verify fitness API is up before running the test
    try {
      const resp = await fetch(`${API_URL}/api/v1/fitness`, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) {
        throw new Error(`Fitness API returned ${resp.status}`);
      }
    } catch (err) {
      throw new Error(
        `FAIL FAST: Fitness API not responding. Cannot run stale-session recovery test.\n` +
        `Error: ${err.message}\nURL: ${API_URL}/api/v1/fitness`
      );
    }
  });

  test('recovers from simulated segment-404 by refreshing the stream URL', async ({ browser }) => {
    // Create a context with autoplay and generous viewport
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });

    // Enable autoplay policy via CDP so dash.js can start without a gesture
    const page = await context.newPage();
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setAutoplayPolicy', { autoplayPolicy: 'no-user-gesture-required' });
    } catch (e) {
      console.log('CDP autoplay policy not available:', e.message);
    }

    try {
      const sessionUuidsHit = new Set();
      let blockedCount = 0;
      let firstBlockedSession = null;

      // Intercept Plex transcode segment requests routed through our proxy.
      // Pattern: /api/v1/proxy/plex/video/:/transcode/universal/session/<uuid>/...
      // The session UUID is a hex string with hyphens (standard UUID format) or
      // a Plex-style alphanumeric session token.
      await context.route(
        /\/api\/v1\/proxy\/plex\/video\/:\/transcode\/universal\/session\/([^/]+)\//,
        async (route) => {
          const url = route.request().url();
          const match = url.match(/\/session\/([^/]+)\//);
          const sessionId = match?.[1];
          if (!sessionId) return route.continue();

          // Latch onto the first session UUID we see
          if (firstBlockedSession === null) {
            firstBlockedSession = sessionId;
            console.log(`[stale-session-test] Latching onto session to block: ${sessionId}`);
          }

          sessionUuidsHit.add(sessionId);

          if (sessionId === firstBlockedSession) {
            blockedCount++;
            if (blockedCount <= 3 || blockedCount % 10 === 0) {
              console.log(`[stale-session-test] Blocking segment #${blockedCount} for session ${sessionId}`);
            }
            return route.fulfill({
              status: 404,
              contentType: 'text/plain',
              body: 'simulated dead transcode session'
            });
          }

          // New session UUID — let it through (fresh session works)
          console.log(`[stale-session-test] Passing through new session: ${sessionId}`);
          return route.continue();
        }
      );

      // Seed the recovery event array before navigation so init-script
      // doesn't race with the component mounting it
      await page.addInitScript(() => {
        window.__fitnessRecoveryEvents = [];
      });

      console.log(`[stale-session-test] Navigating to ${BASE_URL}/fitness/play/${TEST_ID}?nogovern=1`);
      await page.goto(`${BASE_URL}/fitness/play/${TEST_ID}?nogovern=1`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Wait for the player to mount and begin segment requests
      // The watchdog fires after 3 code-28 errors within 10s.
      // Then resilience recovery + hardReset happens (cooldown ~4s).
      // Then dash.js re-fetches the MPD and starts a new session.
      // Allow up to 90s total for the full cycle.
      console.log('[stale-session-test] Waiting for stream-url-refreshed event (up to 90s)...');
      await page.waitForFunction(
        () => {
          const events = window.__fitnessRecoveryEvents || [];
          return events.some(e => e.event === 'playback.stream-url-refreshed');
        },
        null,
        { timeout: 90000 }
      );
      console.log('[stale-session-test] stream-url-refreshed event detected');

      // After recovery, allow the new session time to start delivering segments
      // and the video element to reach playing state.
      console.log('[stale-session-test] Waiting for video to play via new session (up to 30s)...');
      await page.waitForFunction(
        () => {
          // dash-video is a web component — inner video is in shadow DOM
          const dashEl = document.querySelector('dash-video');
          const shadowVideo = dashEl?.shadowRoot?.querySelector('video');
          const directVideo = document.querySelector('video');
          const v = shadowVideo || directVideo;
          return v && !v.paused && v.currentTime > 0 && v.readyState >= 3;
        },
        null,
        { timeout: 30000 }
      );
      console.log('[stale-session-test] Video is playing');

      // Collect final state for assertions
      const videoState = await page.evaluate(() => {
        const dashEl = document.querySelector('dash-video');
        const shadowVideo = dashEl?.shadowRoot?.querySelector('video');
        const directVideo = document.querySelector('video');
        const v = shadowVideo || directVideo;
        return v
          ? { paused: v.paused, currentTime: v.currentTime, readyState: v.readyState }
          : null;
      });

      const recoveryEvents = await page.evaluate(() => window.__fitnessRecoveryEvents || []);

      console.log('[stale-session-test] videoState:', videoState);
      console.log('[stale-session-test] recoveryEvents:', JSON.stringify(recoveryEvents, null, 2));
      console.log('[stale-session-test] sessionUuidsHit:', [...sessionUuidsHit]);
      console.log(`[stale-session-test] blockedCount: ${blockedCount}`);

      // ── Assertions ──────────────────────────────────────────────────────────

      // Video must be playing
      expect(videoState, 'video element must be found').not.toBeNull();
      expect(videoState.paused, 'video must not be paused').toBe(false);
      expect(videoState.currentTime, 'video must have advanced past 0').toBeGreaterThan(0);
      expect(videoState.readyState, 'video must have enough data (readyState >= 3)').toBeGreaterThanOrEqual(3);

      // Recovery pipeline must have fired
      const refreshEvents = recoveryEvents.filter(e => e.event === 'playback.stream-url-refreshed');
      expect(refreshEvents.length, 'stream-url-refreshed must fire at least once').toBeGreaterThanOrEqual(1);

      // The refreshed src must include the _refresh cache-buster
      expect(refreshEvents[0].nextSrc, 'refreshed src must include _refresh param').toMatch(/_refresh=\d+/);

      // The stale-session-detected event must also have fired
      const detectedEvents = recoveryEvents.filter(e => e.event === 'playback.stale-session-detected');
      expect(detectedEvents.length, 'stale-session-detected must fire at least once').toBeGreaterThanOrEqual(1);

      // Must have intercepted segments (confirming the mock was exercised)
      expect(blockedCount, 'must have blocked at least 3 segments from the dead session').toBeGreaterThanOrEqual(3);

      // Must have seen at least 2 distinct session UUIDs:
      // the dead one (blocked) and the fresh one (passed through)
      expect(sessionUuidsHit.size, 'must observe at least 2 distinct session UUIDs (dead + fresh)').toBeGreaterThanOrEqual(2);

    } finally {
      await context.close();
    }
  });
});
