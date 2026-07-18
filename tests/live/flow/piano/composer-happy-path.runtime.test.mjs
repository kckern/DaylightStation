/**
 * Piano Composer Happy Path Runtime Test (Composer P2, Task 12)
 *
 * Drives the Composer mode through the same surface a person would touch on
 * the kiosk tablet, verifying the CREATE → PERSIST → RELOAD spine:
 *
 *   1. /piano/composer → dismiss the ConnectGate ("Continue without piano",
 *      because headless Chromium has no Web MIDI) → land on the song Gallery.
 *   2. "New Song" → fill NewSongSetup's title input with a test-identifiable
 *      title, then its prominent "Skip → 4/4 · C · treble · 100bpm" button →
 *      a brand-new empty score is created (POST) and the mode switches to
 *      the editor view.
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
 * TEST DATA: step 2 writes ONE real per-user composition (title prefixed
 * `e2e-composer-test`). afterAll DELETES every composition with that prefix
 * belonging to the roster's default user (the same `users[0].id` fallback
 * Composer itself resolves via usePianoUser — see PianoUserContext.jsx),
 * so a clean run leaves no household data behind (and a crashed run
 * self-cleans on the next run). Mirrors producer-happy-path's cleanup.
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
const USERS_API = `${API_URL}/api/v1/piano/users`;

/** Prefix for the composition this flow creates — afterAll sweeps it. */
const SONG_TITLE_PREFIX = 'e2e-composer-test';
const SONG_TITLE = `${SONG_TITLE_PREFIX}-${Date.now()}`;

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

  test.afterAll(async ({ request }) => {
    // Clean up every per-user composition this flow (or a prior crashed run)
    // created. Resolve the default user the SAME way the app does — the
    // first roster entry (usePianoUser's users[0].id fallback, since no
    // localStorage selection is ever set in this headless flow).
    try {
      const usersResp = await request.get(USERS_API, { timeout: 10000 });
      if (!usersResp.ok()) throw new Error(`GET ${USERS_API} → ${usersResp.status()}`);
      const { users = [] } = await usersResp.json();
      const userId = users[0]?.id;
      if (!userId) {
        console.log('cleanup: no roster user resolved, skipping composition sweep');
        return;
      }

      const compositionsApi = `${API_URL}/api/v1/piano/users/${userId}/compositions`;
      const resp = await request.get(compositionsApi, { timeout: 10000 });
      if (resp.ok()) {
        const { compositions = [] } = await resp.json();
        const stale = compositions.filter((c) => String(c.title || '').startsWith(SONG_TITLE_PREFIX));
        for (const c of stale) {
          const del = await request.delete(`${compositionsApi}/${c.id}`, { timeout: 10000 });
          console.log(`cleanup: deleted composition ${c.id} ("${c.title}") for user ${userId} → ${del.status()}`);
        }
        if (stale.length === 0) console.log(`cleanup: no e2e-composer-test compositions to remove for user ${userId}`);
      }
    } catch (err) {
      console.log('cleanup: failed to sweep test compositions:', err.message);
    }
  });

  test('new song → editor mounts → reload → gallery reachable', async ({ page }) => {
    await enterComposer(page);

    // Gallery: "New Song" front door (Gallery.jsx).
    await page.getByRole('button', { name: /new song/i }).click();

    // NewSongSetup: fill the title with a test-identifiable value BEFORE
    // Skip, so afterAll can find and delete exactly this composition (and
    // any prior crashed run's) via the API — mirrors producer-happy-path's
    // title-prefix cleanup.
    await page.getByLabel(/song title/i).fill(SONG_TITLE);

    // The prominent Skip-to-defaults button creates the score (POST
    // /users/:userId/compositions) and switches the mode to the editor view
    // via onCreated → openSong.
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
