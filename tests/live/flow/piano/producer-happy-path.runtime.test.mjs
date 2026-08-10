/**
 * Piano Producer happy-path runtime test.
 *
 * Drives the redesigned Producer end-to-end through the SAME surface a person
 * would touch on the kiosk tablet:
 *
 *   1. /piano/producer → dismiss the ConnectGate ("Continue without piano",
 *      because headless Chromium has no Web MIDI) → land on the Producer Loop
 *      front doors.
 *   1b. Record a two-bar drum pass → main transport Stop must pause capture,
 *      preserve the completed pass, Resume cleanly, and close without adding or
 *      persisting anything.
 *   2. Browse the library → pick a CHORD-PROGRESSION loop → a ChannelStrip
 *      carrying that loop's roman identity appears in Loop.
 *   3. Add a second compatible layer under the guardrail ("Showing what fits
 *      your jam") → pick a groove → a drums ChannelStrip appears.
 *   4. Press Play → assert isPlaying (button flips to Stop AND the bar:beat
 *      readout advances, proving the rAF transport clock runs). Nudge tempo +
 *      transpose (BPM/Key labels update). Press Stop.
 *   5. "Add to song" → auto-switch to the Song tab → a section slot appears in
 *      the structure rail.
 *   6. Save the song → success toast. Capture the exact POST response identity
 *      from the real household tree (dev backend writes to disk).
 *   7. FULL RELOAD (proves disk persistence, not optimistic in-memory state) →
 *      open "Songs & Resume" → the saved song is listed → load it → it hydrates
 *      back onto the Song tab with its slot.
 *   8. Play the loaded arrangement → assert isPlaying.
 *
 * HEADLESS REALITY (designed around, not papered over):
 *  - Web MIDI is absent → ConnectGate shows "unsupported"; we dismiss it.
 *  - AudioContext runs but is inaudible; we assert STATE, never sound. The
 *    transport clock is performance.now()/rAF driven (useProducerTransport), so
 *    isPlaying + bar:beat advance WITHOUT any audio output.
 *  - Loop MIDI + prefab/song YAML come from the dev backend's loop-manifest,
 *    local-stream, and /api/v1/piano/producer routes against the real mounted
 *    media/household tree.
 *
 * TEST DATA: when persistence is explicitly enabled, step 6 writes ONE real
 * household song. The test captures the server-generated id from that exact
 * POST and afterAll deletes only that id. Read-only mode skips all three
 * persistence steps and performs no cleanup mutation.
 *
 * Mirrors tests/live/flow/fitness/fitness-happy-path.runtime.test.mjs:
 * serial describe, one shared page, fail-fast health check, waits on selectors
 * (never networkidle).
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL, BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = FRONTEND_URL;
const API_URL = BACKEND_URL;
const PRODUCER_URL = `${BASE_URL}/piano/producer`;

const SONGS_API = `${API_URL}/api/v1/piano/producer/songs`;
// Safe release-check mode exercises the complete non-persistent journey and
// performs no mounted household writes or cleanup deletes. The full flow stays
// available when persistence verification is explicitly authorized.
const READ_ONLY = process.env.PRODUCER_E2E_READ_ONLY === '1';

let sharedPage;
let sharedContext;
let createdSongId = null;
let createdSongTitle = null;

/** Dismiss the ConnectGate (no Web MIDI in headless) and wait for Loop. */
async function enterProducer(page) {
  await page.goto(PRODUCER_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // The gate blocks the app until Web MIDI connects OR it's dismissed. Headless
  // Chromium has no Web MIDI, so the only way in is "Continue without piano".
  const skip = page.getByRole('button', { name: /continue without piano/i });
  await expect(skip, 'ConnectGate "Continue without piano" should be present in headless').toBeVisible({ timeout: 15000 });
  await skip.click();

  // Producer mounts; the loop library then loads (PianoEmpty spinner → doors).
  await expect(page.locator('.piano-producer-mode')).toBeVisible({ timeout: 15000 });
}

test.describe.configure({ mode: 'serial' });

test.describe('Piano Producer Happy Path', () => {
  test.beforeAll(async ({ browser, request }) => {
    // FAIL FAST: backend must be up and the producer API reachable (a stale
    // main-checkout server would hang on /piano/producer — see the runbook).
    let ping;
    try {
      ping = await request.get(`${API_URL}/api/v1/ping`, { timeout: 8000 });
    } catch (err) {
      throw new Error(`FAIL FAST: backend not responding at ${API_URL}. ${err.message}`);
    }
    expect(ping.ok(), 'backend /api/v1/ping should be 200').toBe(true);

    const songsResp = await request.get(SONGS_API, { timeout: 10000 });
    expect(songsResp.ok(), `producer songs API should be 200 (got ${songsResp.status()})`).toBe(true);
    const songsBody = await songsResp.json();
    expect(Array.isArray(songsBody.items), 'producer songs API should return { items: [] }').toBe(true);

    // The generated loop manifest is the library's production contract. The
    // legacy loops/index.yml probe was stale and could fail while the app was
    // healthy (the manifest is built directly from the mounted ledger/files).
    const manifest = await request.get(`${API_URL}/api/v1/piano/loop-manifest`, { timeout: 15000 });
    expect(manifest.ok(), 'loop-manifest should be servable').toBe(true);
    const manifestBody = await manifest.json();
    expect(manifestBody.bricks?.length, 'loop-manifest should contain playable material').toBeGreaterThan(0);

    sharedContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    sharedPage = await sharedContext.newPage();

    // Surface page errors to the test log (helps diagnose a blocked step).
    sharedPage.on('pageerror', (e) => console.log('[pageerror]', e.message));

    try {
      const cdp = await sharedContext.newCDPSession(sharedPage);
      await cdp.send('Emulation.setAutoplayPolicy', { autoplayPolicy: 'no-user-gesture-required' });
    } catch { /* autoplay policy is a nicety; the transport clock is rAF-based */ }
  });

  test.afterAll(async ({ request }) => {
    if (READ_ONLY) {
      console.log('cleanup: skipped in read-only mode (no mounted writes were made)');
      if (sharedPage) await sharedPage.close();
      if (sharedContext) await sharedContext.close();
      return;
    }
    // Delete only the record created by this exact run. Never prefix-sweep a
    // shared household tree: another person's similarly named song is not test
    // garbage, and cleanup must remain identity-scoped.
    if (createdSongId) {
      try {
        const del = await request.delete(`${SONGS_API}/${createdSongId}`, { timeout: 10000 });
        console.log(`cleanup: deleted song ${createdSongId} ("${createdSongTitle}") → ${del.status()}`);
      } catch (err) {
        console.log(`cleanup: failed to delete song ${createdSongId}:`, err.message);
      }
    } else {
      console.log('cleanup: no song was created by this run');
    }

    if (sharedPage) await sharedPage.close();
    if (sharedContext) await sharedContext.close();
  });

  // ── STEP 1 ────────────────────────────────────────────────────────────────
  test('1. dismiss ConnectGate → land on Producer Loop front doors', async () => {
    await enterProducer(sharedPage);

    // Front-door entry cards render only when the library loaded and Loop is
    // empty — this proves the generated loop-manifest fetch succeeded.
    const browseDoor = sharedPage.locator('.piano-producer-mode__door', { hasText: 'Browse the library' });
    await expect(browseDoor, 'Browse front door should be visible on an empty Loop').toBeVisible({ timeout: 20000 });

    const doorCount = await sharedPage.locator('.piano-producer-mode__door').count();
    console.log(`Producer front doors visible: ${doorCount}`);
    expect(doorCount).toBeGreaterThanOrEqual(3);
  });

  test('1b. capture Stop → paused take → Resume → Stop → Done (read-only)', async () => {
    await sharedPage.locator('.piano-producer-mode__door', { hasText: 'Record my own' }).click();
    const capture = sharedPage.getByRole('dialog', { name: 'capture' });
    await expect(capture).toBeVisible({ timeout: 5000 });

    await capture.getByRole('button', { name: 'Drums', exact: true }).click();
    await capture.getByRole('group', { name: 'loop length' })
      .getByRole('button', { name: '2 bars', exact: true }).click();
    await capture.getByRole('button', { name: /arm/i }).click();

    const transport = sharedPage.locator('.piano-producer-mode__play');
    await expect(transport).toHaveText(/Stop/, { timeout: 5000 });
    await expect(capture.getByLabel('bar dial')).toContainText('1 / 2', { timeout: 5000 });

    // A real pointer click exercises pad monitoring + capture note-on/off. Wait
    // for the next two-bar boundary so the in-flight contribution becomes one
    // completed, Keep-able pass.
    await capture.getByRole('button', { name: 'Kick', exact: true }).click();
    const passes = capture.locator('.piano-capture-card__passes');
    await expect(passes).toContainText('1 pass · 1 note', { timeout: 7000 });

    await transport.click();
    await expect(capture.getByText('Recording paused — completed passes kept', { exact: true }))
      .toBeVisible({ timeout: 5000 });
    await expect(capture.getByRole('button', { name: 'Keep', exact: true })).toBeEnabled();
    await expect(capture.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();

    await capture.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(capture.getByText('Recording — loop rolling', { exact: true }))
      .toBeVisible({ timeout: 5000 });
    await expect(transport).toHaveText(/Stop/, { timeout: 5000 });
    await transport.click();
    await expect(capture.getByText('Recording paused — completed passes kept', { exact: true }))
      .toBeVisible({ timeout: 5000 });

    await capture.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(capture).toBeHidden({ timeout: 5000 });
    expect(await sharedPage.locator('.piano-channel-strip').count(), 'unkept read-only capture must add no layer').toBe(0);
    console.log('Capture Stop/paused/Resume teardown passed without persistence');
  });

  // ── STEP 2 ────────────────────────────────────────────────────────────────
  test('2. browse library → pick a chord-progression loop → strip appears', async () => {
    await sharedPage.locator('.piano-producer-mode__door', { hasText: 'Browse the library' }).click();

    const overlay = sharedPage.locator('.piano-producer-mode__overlay[aria-label="loop library"]');
    await expect(overlay, 'library overlay should open').toBeVisible({ timeout: 10000 });

    // Narrow to the Chords facet so the grid is chord loops.
    await overlay.locator('[aria-label="kind"] button', { hasText: /^Chords$/ }).click();

    // A chord-progression card = a .piano-loop whose identity renders a roman
    // progression. Wait for at least one, then pick it.
    const romanCards = overlay.locator('.piano-loop', { has: sharedPage.locator('.roman-progression') });
    await expect(romanCards.first(), 'at least one roman-progression loop card should render').toBeVisible({ timeout: 15000 });
    const romanCount = await romanCards.count();
    console.log(`Chord-progression cards visible: ${romanCount}`);

    // Capture the EXACT roman identity of the card we're about to pick, so we
    // can prove the resulting strip carries THIS loop — not merely that some
    // roman element rendered (a wrong loop loading would otherwise green-pass).
    const pickedRoman = (await romanCards.first().locator('.roman-chord').allTextContents())
      .map((token) => token.trim()).join('|');
    expect(pickedRoman, 'picked card should have a non-empty roman progression').toBeTruthy();
    console.log(`Picking chord loop with roman identity: "${pickedRoman}"`);

    // Audition is a visible, reversible action. Verify the same first card can
    // enter and leave preview without being added to the workspace.
    const pickedWrap = romanCards.first().locator('..');
    const preview = pickedWrap.locator('.piano-loop__preview');
    await preview.click();
    await expect(preview, 'Preview should become Stop while auditioning').toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });
    expect(await sharedPage.locator('.piano-channel-strip').count(), 'preview must not add a layer').toBe(0);
    await preview.click();
    await expect(preview, 'Stop should end the audition explicitly').toHaveAttribute('aria-pressed', 'false', { timeout: 5000 });

    await romanCards.first().click();

    // Overlay closes; a ChannelStrip appears in Loop carrying the loop's
    // roman identity (notes fetch async — wait on the strip, not networkidle).
    await expect(overlay, 'library overlay should close after picking').toBeHidden({ timeout: 10000 });
    const strip = sharedPage.locator('.piano-channel-strip');
    await expect(strip.first(), 'a ChannelStrip should appear for the picked loop').toBeVisible({ timeout: 15000 });
    const stripLane = strip.first().locator('.piano-chord-lane');
    await expect(
      stripLane,
      'the strip should show the chord loop\'s roman identity',
    ).toBeVisible({ timeout: 5000 });
    // Cross-check identity without the keyed chord names that the strip adds
    // above each Roman token for the current target key.
    const stripRoman = (await stripLane.locator('.roman-chord').allTextContents())
      .map((token) => token.trim()).join('|');
    expect(stripRoman, 'the strip\'s roman identity must match the picked chord loop').toBe(pickedRoman);

    // Guard against the zombie-row path (failed note load removes the layer).
    await sharedPage.waitForTimeout(1500);
    expect(await strip.count(), 'the chord strip should persist (notes loaded, not removed)').toBe(1);
    console.log('Chord ChannelStrip present with roman identity');
  });

  // ── STEP 3 ────────────────────────────────────────────────────────────────
  test('3. add a groove under the guardrail → drums strip appears', async () => {
    await sharedPage.locator('.piano-producer-mode__add-layer').click();
    const addSheet = sharedPage.getByRole('dialog', { name: 'add a layer' });
    await expect(addSheet).toBeVisible({ timeout: 5000 });
    await addSheet.getByRole('button', { name: /drums/i }).click();

    const overlay = sharedPage.locator('.piano-producer-mode__overlay[aria-label="loop library"]');
    await expect(overlay).toBeVisible({ timeout: 10000 });

    // The chord loop is now the harmonic base → the consonance gate is active.
    const gate = overlay.locator('.piano-producer-mode__gate-note');
    await expect(gate, 'guardrail indicator should show once a harmonic base exists').toBeVisible({ timeout: 10000 });
    await expect(gate).toContainText('Showing what fits your jam');
    console.log('Guardrail active:', (await gate.textContent())?.trim());

    // Grooves always stack — pick one from the Grooves facet.
    await overlay.locator('[aria-label="kind"] button', { hasText: /^Grooves$/ }).click();
    const grooveCards = overlay.locator('.piano-loop');
    await expect(grooveCards.first(), 'groove cards should render under the guardrail').toBeVisible({ timeout: 15000 });
    console.log(`Groove cards visible: ${await grooveCards.count()}`);
    await grooveCards.first().click();

    await expect(overlay).toBeHidden({ timeout: 10000 });

    // Second ChannelStrip appears; one of them is a drums (groove) strip.
    const strips = sharedPage.locator('.piano-channel-strip');
    await expect(strips.nth(1), 'a second ChannelStrip should appear for the groove').toBeVisible({ timeout: 15000 });
    await sharedPage.waitForTimeout(1000);
    expect(await strips.count(), 'Loop should hold two layers').toBe(2);

    // The groove strip identifies as a drums layer (role "groove", voice "Drums").
    const grooveRole = sharedPage.locator('.piano-channel-strip__role', { hasText: /^groove$/ });
    await expect(grooveRole.first(), 'a groove-role strip should be present').toBeVisible({ timeout: 5000 });
    console.log('Second (drums) ChannelStrip present');
  });

  // ── STEP 4 ────────────────────────────────────────────────────────────────
  test('4. Play → transport runs (bar:beat advances) → tempo/key nudge → Stop', async () => {
    const play = sharedPage.locator('.piano-producer-mode__play');
    const pos = sharedPage.locator('.piano-producer-mode__pos');

    await expect(play).toHaveText(/Play/, { timeout: 5000 });
    await expect(pos).toContainText('1:1');

    await play.click();

    // isPlaying is reflected in the button flipping to Stop.
    await expect(play, 'play button should flip to Stop').toHaveText(/Stop/, { timeout: 5000 });

    // The rAF transport clock must actually advance the bar:beat readout — this
    // proves the transport is RUNNING, not merely flagged playing.
    await expect
      .poll(async () => (await pos.textContent())?.split('·')[0].trim(), {
        message: 'bar:beat readout should advance past 1:1',
        timeout: 6000,
      })
      .not.toBe('1:1');
    console.log('Transport clock advanced to', (await pos.textContent())?.trim());

    // Tempo nudge: the BPM label updates immediately (reducer state).
    const tempoLabel = sharedPage.getByRole('button', { name: 'tempo', exact: true });
    const bpmBefore = (await tempoLabel.textContent())?.trim();
    await tempoLabel.click();
    const tempoSheet = sharedPage.getByRole('dialog', { name: 'tempo' });
    await expect(tempoSheet).toBeVisible({ timeout: 5000 });
    await tempoSheet.getByRole('button', { name: 'tempo up' }).click();
    await expect(tempoLabel, 'BPM label should change after tempo up').not.toHaveText(bpmBefore);
    console.log(`BPM: ${bpmBefore} → ${(await tempoLabel.textContent())?.trim()}`);
    await tempoSheet.getByRole('button', { name: 'Done' }).click();

    // Transpose: the Key label updates immediately.
    const keyLabel = sharedPage.getByRole('button', { name: 'key', exact: true });
    const keyBefore = (await keyLabel.textContent())?.trim();
    await keyLabel.click();
    const keySheet = sharedPage.getByRole('dialog', { name: 'key' });
    await expect(keySheet).toBeVisible({ timeout: 5000 });
    await keySheet.getByRole('button', { name: 'key G', exact: true }).click();
    await expect(keyLabel, 'Key label should change after transpose').not.toHaveText(keyBefore);
    console.log(`Key: ${keyBefore} → ${(await keyLabel.textContent())?.trim()}`);

    // Stop.
    await play.click();
    await expect(play, 'play button should return to Play after Stop').toHaveText(/Play/, { timeout: 5000 });
  });

  // ── STEP 5 ────────────────────────────────────────────────────────────────
  test('5. Add to song → auto-switch to Song tab → section slot appears', async () => {
    await sharedPage.locator('.piano-producer-mode__promote', { hasText: /Add to song/ }).click();

    // First promote auto-switches to the Song tab.
    const songTab = sharedPage.locator('[role="tab"]', { hasText: /^Song$/ });
    await expect(songTab, 'Song tab should be selected after promote').toHaveAttribute('aria-selected', 'true', { timeout: 5000 });

    const slot = sharedPage.locator('.piano-song-view__slot');
    await expect(slot.first(), 'a section slot should appear in the structure rail').toBeVisible({ timeout: 10000 });
    console.log(`Structure rail slots: ${await slot.count()}`);
  });

  // ── STEP 6 ────────────────────────────────────────────────────────────────
  test('6. Save the song → success toast + persisted to household tree', async ({ request }) => {
    test.skip(READ_ONLY, 'read-only mode forbids mounted household writes');
    // Save uses the kiosk's timestamped default title. Capture the exact POST
    // response instead of depending on the obsolete pre-remediation title box
    // or guessing which newly listed record belongs to this test.
    const saveResponsePromise = sharedPage.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'POST'
        && url.pathname === '/api/v1/piano/producer/songs';
    }, { timeout: 10000 });
    await sharedPage.locator('.piano-song-view__save').click();
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.ok(), `song POST should succeed (got ${saveResponse.status()})`).toBe(true);
    const saved = await saveResponse.json();
    createdSongId = saved.id;
    createdSongTitle = saved.title;
    expect(createdSongId, 'song POST should return its generated id').toBeTruthy();
    expect(createdSongTitle, 'song POST should return its generated title').toBeTruthy();

    // Success is surfaced as a transient toast in the Producer shell.
    const toast = sharedPage.locator('.piano-producer-mode__save-toast');
    await expect(toast, 'a save toast should confirm success').toBeVisible({ timeout: 10000 });
    await expect(toast).toContainText('Saved');
    console.log('Save toast:', (await toast.textContent())?.trim());

    // The POST must have hit disk: the API now lists our song.
    const resp = await request.get(SONGS_API, { timeout: 10000 });
    const { items = [] } = await resp.json();
    const found = items.find((song) => song.id === createdSongId);
    expect(found, `saved song ${createdSongId} must appear in the producer songs API`).toBeTruthy();
    expect(found.title).toBe(createdSongTitle);
    console.log(`Persisted song id: ${found.id}, sections: ${found.sectionCount}`);
  });

  // ── STEP 7 ────────────────────────────────────────────────────────────────
  test('7. full reload → open Songs & Resume → load saved song → it hydrates', async () => {
    test.skip(READ_ONLY, 'read-only mode does not create a song to reload');
    // A hard reload drops all in-memory state — the song list must now come
    // from disk, proving real persistence rather than an optimistic insert.
    await enterProducer(sharedPage);

    await sharedPage.locator('.piano-producer-mode__door', { hasText: 'Songs & Resume' }).click();

    const picker = sharedPage.locator('.piano-song-picker[aria-label="saved songs"]');
    await expect(picker, 'Songs & Resume picker should open').toBeVisible({ timeout: 10000 });

    expect(createdSongTitle, 'step 6 must capture the persisted title').toBeTruthy();
    const songRow = picker.locator('.piano-song-picker__song', { hasText: createdSongTitle });
    await expect(songRow, 'the saved song should be listed after reload (loaded from disk)').toBeVisible({ timeout: 15000 });
    await songRow.click();

    // Loading hydrates the draft and lands on the Song tab with the slot back.
    await expect(picker).toBeHidden({ timeout: 10000 });
    const songTab = sharedPage.locator('[role="tab"]', { hasText: /^Song$/ });
    await expect(songTab).toHaveAttribute('aria-selected', 'true', { timeout: 10000 });
    await expect(
      sharedPage.locator('.piano-song-view__slot').first(),
      'the loaded song should hydrate its section slot',
    ).toBeVisible({ timeout: 10000 });
    console.log('Song hydrated after reload with', await sharedPage.locator('.piano-song-view__slot').count(), 'slot(s)');
  });

  // ── STEP 8 ────────────────────────────────────────────────────────────────
  test('8. play the loaded arrangement → isPlaying', async () => {
    test.skip(READ_ONLY, 'read-only mode does not create a song to reload');
    const play = sharedPage.locator('.piano-producer-mode__play');
    const pos = sharedPage.locator('.piano-producer-mode__pos');

    // Play becomes enabled only once the arrangement is playable — i.e. after
    // ensureLayerNotes has re-fetched the section layers' notes (canPlay =
    // songPlayable). Poll on that instead of a fixed sleep: waits exactly as
    // long as the re-fetch needs, no more, no less.
    await expect(play, 'play should become enabled once the loaded arrangement is playable').toBeEnabled({ timeout: 15000 });
    await expect(play).toHaveText(/Play/);

    await play.click();
    await expect(play, 'arrangement should start playing').toHaveText(/Stop/, { timeout: 5000 });
    await expect
      .poll(async () => (await pos.textContent())?.split('·')[0].trim(), {
        message: 'arrangement bar:beat should advance',
        timeout: 6000,
      })
      .not.toBe('1:1');
    console.log('Arrangement playing at', (await pos.textContent())?.trim());

    await play.click();
    await expect(play).toHaveText(/Play/, { timeout: 5000 });
  });
});
