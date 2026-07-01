import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3111';

/**
 * End-to-end (real data): Back to the Future's real 219-cue VidAngel EDL flows
 * through the whole client pipeline — backend endpoint -> useFilterData ->
 * resolver (family profile) -> useContentFilter — in a real browser.
 *
 * Uses the POC harness in ?contentId mode so the assertion is deterministic and
 * doesn't depend on the headless browser decoding the Plex transcode. (Driving
 * the full Plex stream in the live VideoPlayer is a manual/real-browser step:
 * /tv?play=662169&filter=1.)
 */
test('BTTF real EDL resolves to applied skip+mute cues via the filter pipeline', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // The backend endpoint serves the real cascade — incl. the calibrated sync.
  const api = await page.request.get(`${BASE}/api/v1/content-filter/662170?profile=family`);
  expect(api.ok()).toBe(true);
  const cascade = await api.json();
  expect(cascade.edl.cues.length).toBe(219);
  expect(cascade.profile.name).toBe('Family');
  // Calibration (SRT-snap) derived a ~+6.6s offset for this Plex file.
  expect(cascade.override.sync.offsetSec).toBeGreaterThan(2);
  expect(cascade.override.sync.offsetSec).toBeLessThan(20);

  // The client pipeline resolves that real data into concrete effects.
  await page.goto(`${BASE}/filter-poc?contentId=plex:662170`, { waitUntil: 'domcontentloaded' });
  const statusLoc = page.locator('[data-testid="poc-status"]');
  await statusLoc.waitFor({ state: 'visible', timeout: 15000 });

  // Poll until real data has loaded and resolved.
  let status = null;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    status = JSON.parse(await statusLoc.textContent());
    if (status.title === 'Back to the Future' && status.cues > 0) break;
    await page.waitForTimeout(200);
  }

  console.log('BTTF resolved status:', JSON.stringify(status));
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  expect(status.title).toBe('Back to the Future');
  expect(status.profileName).toBe('Family');
  // Family philosophy: language -> mute; sexual/nudity/assault -> blur (keep audio);
  // violence/peril -> KEPT (not filtered). So mutes + blurs present, and the
  // resolved set is well under the raw 219 (peril + credits + alcohol kept).
  expect(status.byEffect.mute, 'profanity resolved to mute').toBeGreaterThan(0);
  expect(status.byEffect['full-blur'], 'sexual/nudity resolved to blur').toBeGreaterThan(0);
  expect(status.cues, 'peril/unmapped kept (profile authoritative)').toBeLessThan(219);
});
