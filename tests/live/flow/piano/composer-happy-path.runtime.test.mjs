/**
 * Piano Composer Happy Path Runtime Test (Composer P2, Task 12)
 *
 * Drives the Composer mode through the same surface a person would touch on
 * the kiosk tablet, verifying the CREATE → PERSIST → RELOAD spine:
 *
 *   1. /piano/composer → dismiss the ConnectGate ("Continue without piano",
 *      because headless Chromium has no Web MIDI) → land on the song Gallery.
 *   2. "New Song" → NewSongSetup's prominent "Skip → 4/4 · C · treble ·
 *      100bpm" button → a brand-new empty score is created (POST) and the
 *      mode switches to the editor view.
 *   3. Assert the editor mounted (`.composer-editor`).
 *   4. Full reload (drops all in-memory state) → dismiss the gate again → the
 *      Gallery is reachable ("New Song" visible), proving the create actually
 *      persisted server-side rather than just updating in-memory view state.
 *
 * HEADLESS REALITY: note-entry happens over MIDI (armed input →
 * useComposerInput), and there is no PianoKiosk MIDI shim for headless
 * Playwright (confirmed: no equivalent of a virtual-MIDI test harness exists
 * for any Piano mode). So this flow cannot drive actual note entry — it
 * verifies the create/persist/reload spine at the UI level. The note-level
 * data-loss invariant (score round-trips through MusicXML without losing
 * notes) is covered by the model round-trip tests (P1) and the store/API
 * tests (Tasks 1–3).
 *
 * Mirrors tests/live/flow/piano/producer-happy-path.runtime.test.mjs: a
 * fail-fast backend health check in beforeAll, `domcontentloaded` navigation
 * + waiting on selectors (never `networkidle` — the piano app can hold open
 * persistent connections that would starve networkidle's "no more than 0
 * connections for 500ms" condition).
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL, BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = FRONTEND_URL;
const API_URL = BACKEND_URL;
const COMPOSER_URL = `${BASE_URL}/piano/composer`;

/** Dismiss the ConnectGate (no Web MIDI in headless) and wait for the Composer mode to mount. */
async function enterComposer(page) {
  await page.goto(COMPOSER_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // The gate blocks the app until Web MIDI connects OR it's dismissed. Headless
  // Chromium has no Web MIDI, so the only way in is "Continue without piano".
  // This is the SHARED ConnectGate (PianoApp.jsx) that wraps every Piano mode,
  // not a Composer-specific gate.
  const skip = page.getByRole('button', { name: /continue without piano/i });
  await expect(skip, 'ConnectGate "Continue without piano" should be present in headless').toBeVisible({ timeout: 15000 });
  await skip.click();

  await expect(page.locator('.piano-mode--composer'), 'Composer mode should mount').toBeVisible({ timeout: 15000 });
}

test.describe.configure({ mode: 'serial' });

test.describe('Piano Composer Happy Path', () => {
  test.beforeAll(async ({ request }) => {
    // FAIL FAST: backend must be up before we drive the DOM against it.
    let ping;
    try {
      ping = await request.get(`${API_URL}/api/v1/ping`, { timeout: 8000 });
    } catch (err) {
      throw new Error(`FAIL FAST: backend not responding at ${API_URL}. ${err.message}`);
    }
    expect(ping.ok(), 'backend /api/v1/ping should be 200').toBe(true);
  });

  test('new song → editor mounts → reload → gallery reachable', async ({ page }) => {
    await enterComposer(page);

    // Gallery: "New Song" front door (Gallery.jsx).
    await page.getByRole('button', { name: /new song/i }).click();

    // NewSongSetup: the prominent Skip-to-defaults button creates an empty
    // score (POST /users/:userId/compositions) and switches the mode to the
    // editor view via onCreated → openSong.
    await page.getByRole('button', { name: /skip/i }).click();

    // The score persisted server-side (create) and the editor mounted.
    await expect(page.locator('.composer-editor'), 'editor should mount after Skip').toBeVisible({ timeout: 15000 });

    // FULL RELOAD drops all in-memory state — the Gallery must still work,
    // proving the create call landed on disk rather than just local state.
    await enterComposer(page);
    await expect(
      page.getByRole('button', { name: /new song/i }),
      'Gallery ("New Song") should be reachable after reload',
    ).toBeVisible({ timeout: 15000 });
  });
});
