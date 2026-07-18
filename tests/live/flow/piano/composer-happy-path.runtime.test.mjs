/**
 * Piano Composer Happy Path Runtime Test (Composer P2)
 *
 * Drives the Composer mode through the same surface a person would touch on the
 * kiosk tablet, verifying the blank-staff-first CREATE → PERSIST → RELOAD spine:
 *
 *   1. /piano/composer → dismiss the ConnectGate ("Continue without piano",
 *      because headless Chromium has no Web MIDI) → land DIRECTLY on the
 *      blank-staff editor (no gallery gate, no title form).
 *   2. Make ONE edit — press Numpad0 (insert a rest). Headless has no Web MIDI,
 *      but the numpad keys are plain keydowns the editor maps to commands, so a
 *      rest is the note-free way to dirty the draft. The first edit triggers the
 *      lazy create (materialize-on-first-edit) → a POST lands server-side.
 *   3. Poll the API until a NEW composition id appears (proves the create hit
 *      disk, not just in-memory view state).
 *   4. Full reload (drops all in-memory state) → still lands on a blank staff →
 *      "☰ Songs" opens the gallery and the persisted song is reachable there.
 *
 * HEADLESS REALITY: pitched note-entry happens over MIDI (armed input →
 * useComposerInput), and there is no PianoKiosk MIDI shim for headless
 * Playwright. So this flow drives a REST (numpad keydown) rather than pitched
 * notes; the note-level data-loss invariant (score round-trips through MusicXML
 * without losing notes) is covered by the model round-trip tests (P1) and the
 * store/API tests (Tasks 1–3).
 *
 * TEST DATA: step 2 creates ONE real per-user composition (title 'Untitled' —
 * the new flow has no create-time title field). afterAll deletes exactly the id
 * this run created (captured from the API diff). NOTE: a run that crashes
 * between the create and afterAll can leave a single stray 'Untitled' behind;
 * that is a kid's own empty composition (one rest) and is harmless — we do NOT
 * blanket-sweep 'Untitled' titles, which could delete real user songs.
 *
 * Mirrors producer-happy-path: a fail-fast backend health check in beforeAll,
 * `domcontentloaded` navigation + waiting on selectors (never `networkidle` —
 * the piano app holds persistent connections that would starve it).
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL, BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = FRONTEND_URL;
const API_URL = BACKEND_URL;
const COMPOSER_URL = `${BASE_URL}/piano/composer`;
const USERS_API = `${API_URL}/api/v1/piano/users`;

/** Composition ids this run created — afterAll deletes them. */
const createdIds = [];
let userId = null;
let compositionsApi = null;

async function listIds(request) {
  const resp = await request.get(compositionsApi, { timeout: 10000 });
  if (!resp.ok()) return [];
  const { compositions = [] } = await resp.json();
  return compositions.map((c) => c.id);
}

/** Dismiss the ConnectGate (no Web MIDI in headless) and wait for the Composer mode to mount. */
async function enterComposer(page) {
  await page.goto(COMPOSER_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // The gate blocks the app until Web MIDI connects OR it's dismissed. Headless
  // Chromium has no Web MIDI, so the only way in is "Continue without piano".
  // This is the SHARED ConnectGate (PianoApp.jsx) that wraps every Piano mode.
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

    // Resolve the default user the SAME way the app does — the first roster
    // entry (usePianoUser's users[0] fallback, since no localStorage selection
    // is ever set in this headless flow).
    const usersResp = await request.get(USERS_API, { timeout: 10000 });
    expect(usersResp.ok(), `GET ${USERS_API} should be 200`).toBe(true);
    const { users = [] } = await usersResp.json();
    userId = users[0]?.id;
    expect(userId, 'a roster user should resolve for the composition API').toBeTruthy();
    compositionsApi = `${API_URL}/api/v1/piano/users/${userId}/compositions`;
  });

  test.afterAll(async ({ request }) => {
    for (const id of createdIds) {
      try {
        const del = await request.delete(`${compositionsApi}/${id}`, { timeout: 10000 });
        console.log(`cleanup: deleted composition ${id} for user ${userId} → ${del.status()}`);
      } catch (err) {
        console.log(`cleanup: failed to delete ${id}:`, err.message);
      }
    }
  });

  test('blank staff → first edit persists → reload → song reachable in Songs', async ({ page, request }) => {
    // 1. Enter → land DIRECTLY on the blank-staff editor (no gallery gate).
    await enterComposer(page);
    await expect(page.locator('.composer-editor'), 'should land on the blank-staff editor').toBeVisible({ timeout: 15000 });

    // 2. Snapshot existing compositions, then make ONE edit: insert a rest.
    const before = new Set(await listIds(request));
    await page.locator('.composer-editor').click(); // give the document focus
    await page.keyboard.press('Numpad0'); // insertRest → dirties the draft

    // 3. Autosave debounce (default 3000ms) then a POST creates the song. Poll
    //    the API until a NEW id appears — proves the create landed on disk.
    let newId = null;
    await expect
      .poll(
        async () => {
          const ids = await listIds(request);
          newId = ids.find((id) => !before.has(id)) || null;
          return newId;
        },
        { timeout: 20000, message: 'the first edit should lazily create a composition server-side' },
      )
      .toBeTruthy();
    createdIds.push(newId);

    // 4. FULL RELOAD drops all in-memory state — still lands on a blank staff,
    //    and the persisted song is reachable via "☰ Songs".
    await enterComposer(page);
    await expect(page.locator('.composer-editor')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /your songs/i }).click();
    await expect(
      page.locator('.composer-gallery__tile').first(),
      'the persisted song should appear in the Songs gallery after reload',
    ).toBeVisible({ timeout: 15000 });
  });
});
