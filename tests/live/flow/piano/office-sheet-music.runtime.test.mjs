// Sheet Music on the office piano screen, driven by simulated MIDI only.
//
// The real PianoVisualizer in a 1280×720 canvas, its backend answered by
// routes (tests/_fixtures/piano/office-sheet-music/routes.mjs), its piano the
// `midi` bus messages the recorder sends. Nothing is clicked: the screen has no
// touch, so a click passing would prove nothing.
//   launcher → Sheet Music → pick a piece → a take → result → continue → back → exit
// Every screen is checked for clipping and saved under .superpowers/office-sheet-music/.
//   npx playwright test --config tests/_infrastructure/config/playwright.office-sheet-music.config.mjs
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installOfficeRoutes, deskPieces, OFFICE_KEYBOARD } from '../../../_fixtures/piano/office-sheet-music/routes.mjs';
import { findClipping } from '../../../_fixtures/piano/office-sheet-music/clipCheck.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SHOTS = path.join(repo, '.superpowers/office-sheet-music');
mkdirSync(SHOTS, { recursive: true });

const LOW = OFFICE_KEYBOARD.startNote;
const HIGH = OFFICE_KEYBOARD.endNote;
const KEY = { C2: 36, D2: 38, E2: 40, F2: 41, C3: 48, D3: 50, E3: 52, C4: 60, D4: 62, D5: 74 };
const SCALE = [60, 62, 64, 65, 67, 69, 71, 72]; // the fixture score: C4 up to C5

const midi = (page, fn, ...args) => page.evaluate(([f, a]) => window.__officeMidi[f](...a), [fn, args]);
async function tap(page, note, holdMs = 90) {
  await midi(page, 'press', note);
  await page.waitForTimeout(holdMs);
  await midi(page, 'release', note);
  await page.waitForTimeout(140);
}
async function chord(page, notes, holdMs) {
  for (const note of notes) await midi(page, 'press', note);
  await page.waitForTimeout(holdMs);
  for (const note of notes) await midi(page, 'release', note);
  await page.waitForTimeout(200);
}
async function noClipping(page, label, scope = '.tetris-fullscreen', ignore = []) {
  await page.screenshot({ path: path.join(SHOTS, `${label}.png`) });
  const findings = await page.evaluate(findClipping, { scope, ignore });
  expect(findings, `${label}: clipped`).toEqual([]);
}

test('the whole Sheet Music flow, on keys only', async ({ page }) => {
  const { writes } = await installOfficeRoutes(page, { studyDate: 'today', pieces: deskPieces(10) });
  await page.goto('/', { waitUntil: 'networkidle' });

  // The launcher: Sheet Music is an entry, on its own key.
  await chord(page, [LOW, HIGH], 150);
  const entry = page.locator('.nl-key', { hasText: 'Sheet Music' });
  await expect(entry).toBeVisible();
  await expect(entry).toContainText('D5');
  await noClipping(page, '01-launcher', '.note-launcher');

  // Sheet Music → the player's pieces, newest first, six a page, with level badges and the browse keys.
  await tap(page, KEY.D5);
  await expect(page.locator('.office-piece-key')).toHaveCount(6);
  await expect(page.locator('.office-piece-key').first()).toHaveAttribute('data-score', 'files:docs/sheet-music/four-bars.musicxml');
  await expect(page.locator('.office-piece-key__badge').first()).toHaveText('Bronze next');
  await expect(page.locator('.office-piece-key__badge').nth(1)).toHaveText('Gold next');
  const browseKey = (id) => page.locator(`.office-piece-picker__page[data-browse="${id}"]`);
  await expect(browseKey('switch')).toContainText('All music');
  await expect(browseKey('previous')).not.toHaveAttribute('data-enabled', 'true');
  await expect(browseKey('next')).toHaveAttribute('data-enabled', 'true');
  await expect(page.locator('button')).toHaveCount(0); // nothing to tap
  await noClipping(page, '02-picker');

  // Next turns the page; Previous turns it back.
  await tap(page, KEY.E3);
  await expect(page.locator('.office-piece-key')).toHaveCount(4);
  await expect(page.locator('.office-piece-picker__page-count')).toHaveText('2 of 2');
  await expect(browseKey('next')).not.toHaveAttribute('data-enabled', 'true');
  await noClipping(page, '03-picker-page-2');
  await tap(page, KEY.D3);
  await expect(page.locator('.office-piece-key')).toHaveCount(6);

  // All music: the shelves, one per key; a shelf lists its engraved scores six a page.
  await tap(page, KEY.C3);
  await expect(page.locator('.office-piece-key--shelf')).toHaveCount(7);
  await expect(page.locator('.office-piece-picker__head h2')).toHaveText('All music');
  await expect(browseKey('switch')).toContainText('Your pieces');
  // Each shelf says how many pieces open here (the page-image scan is not counted).
  await expect(page.locator('.office-piece-key--shelf').first()).toContainText('14 pieces');
  await noClipping(page, '03b-shelves');
  await tap(page, KEY.C4);
  await expect(page.locator('.office-piece-picker__head h2')).toHaveText('Beginner');
  await expect(page.locator('.office-piece-key')).toHaveCount(6);
  // A piece the player has started shows its progress here too; the rest are New.
  await expect(page.locator('.office-piece-key__badge').first()).toHaveText('Gold next');
  await expect(page.locator('.office-piece-key__badge').nth(1)).toHaveText('New');
  await tap(page, KEY.E3);
  await tap(page, KEY.E3);
  // 14 engraved scores: the third page holds two; the page-image scan is left off.
  await expect(page.locator('.office-piece-key')).toHaveCount(2);
  await noClipping(page, '03c-shelf-page-3');
  // Open a catalog piece, come back with the Pieces key to the same shelf and page.
  await tap(page, KEY.D4);
  await expect(page.locator('.piano-learn-lab')).toBeVisible({ timeout: 20000 });
  await tap(page, KEY.C2);
  await expect(page.locator('.office-piece-picker__head h2')).toHaveText('Beginner');
  await expect(page.locator('.office-piece-picker__page-count')).toHaveText('3 of 3');
  // Back to the shelves, then to the player's own pieces.
  await tap(page, KEY.C3);
  await tap(page, KEY.C3);
  await expect(page.locator('.office-piece-key').first()).toHaveAttribute('data-score', 'files:docs/sheet-music/four-bars.musicxml');

  // A piece opens straight on the coach's next step, with the key strip under it.
  await tap(page, KEY.C4);
  await expect(page.locator('.piano-learn-lab')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.piano-exercise-run')).toHaveAttribute('data-phase', 'ready', { timeout: 20000 });
  const strip = page.locator('.office-key-strip');
  await expect(strip.locator('[data-key="pieces"]')).toHaveAttribute('data-enabled', 'true');
  await expect(strip.locator('[data-key="retry"]')).not.toHaveAttribute('data-enabled', 'true');
  // No note output on this piano: Listen is not drawn, and no touch control is.
  await expect(strip.locator('[data-key="listen"]')).toHaveCount(0);
  await expect(page.locator('.piano-learn-lab__back, .piano-learn-lab__run-controls, .piano-learn-speed, .piano-learn-click')).toHaveCount(0);
  await expect(page.locator('.piano-passage-path__all')).toBeHidden();
  await noClipping(page, '04-drill');

  // A take with wrong notes in it: the strip lets go of its keys while it runs.
  await tap(page, SCALE[0], 250);
  await expect(page.locator('.piano-exercise-run')).toHaveAttribute('data-phase', 'running');
  await expect(strip).not.toHaveAttribute('data-active', 'true');
  for (const note of [61, 63, 61, 63, ...SCALE.slice(1)]) await tap(page, note, 220);
  await expect(page.locator('.piano-exercise-run')).toHaveAttribute('data-phase', 'done', { timeout: 10000 });
  await expect(strip).toHaveAttribute('data-active', 'true');
  await expect(strip.locator('[data-key="retry"]')).toHaveAttribute('data-enabled', 'true');
  expect(writes.filter((write) => write.kind === 'coach' && write.event?.type === 'outcome' && write.user === 'learner4')).toHaveLength(1);
  await expect(page.locator('[data-result-armed="true"]')).toBeVisible({ timeout: 10000 });
  // The docked result card covers the step rail by design (Exercises.scss `.is-docked`).
  await noClipping(page, '05-result', undefined, ['.piano-exercise-run.is-done .piano-exercise-run__rail']);

  // Continue: Try again on the strip is a new take, not a note in one. The score is shown only at its
  // final size: every frame of the next 1.5 s that shows the engraving shows it at the height it had.
  // The size the music is drawn at: the engraving's scale on screen, screen px per engraved unit (its
  // SVG box fills the stage whatever the music inside it is scaled to), times the staff's 40-unit height.
  const shownHeight = () => page.evaluate(() => {
    const svg = document.querySelector('.piano-score-passage .musicxml-renderer__svg svg');
    return svg && getComputedStyle(svg).visibility === 'visible' ? Math.round(svg.getScreenCTM().a * 400) / 10 : null;
  });
  const heightBefore = await shownHeight();
  expect(heightBefore).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.__scoreHeights = [];
    const until = performance.now() + 1500;
    const sample = () => {
      const svg = document.querySelector('.piano-score-passage .musicxml-renderer__svg svg');
      if (svg && getComputedStyle(svg).visibility === 'visible') window.__scoreHeights.push(Math.round(svg.getScreenCTM().a * 400) / 10);
      if (performance.now() < until) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await tap(page, KEY.F2);
  await expect(page.locator('.piano-exercise-run')).toHaveAttribute('data-phase', 'ready');
  await page.waitForTimeout(1600);
  const heights = await page.evaluate(() => window.__scoreHeights);
  expect(heights.length).toBeGreaterThan(0);
  expect(new Set(heights).size, `score heights seen: ${[...new Set(heights)].join(', ')}`).toBe(1);
  expect(heights[0]).toBe(heightBefore);
  await expect(page.locator('.piano-score-passage')).toHaveAttribute('data-engraving-ready', 'true');
  await expect(strip.locator('[data-key="retry"]')).not.toHaveAttribute('data-enabled', 'true');

  // A second take, and this time any other key continues, as on the tablet.
  for (const note of [SCALE[0], 61, 63, 61, 63, ...SCALE.slice(1)]) await tap(page, note, 220);
  await expect(page.locator('.piano-exercise-run')).toHaveAttribute('data-phase', 'done', { timeout: 10000 });
  await expect(page.locator('[data-result-armed="true"]')).toBeVisible({ timeout: 10000 }); // the card arms after its resolve beat
  await tap(page, KEY.C4);
  await expect(page.locator('.piano-exercise-run')).toHaveAttribute('data-phase', 'ready');

  // Back: the Pieces key returns to the list.
  await tap(page, KEY.C2);
  await expect(page.locator('.office-piece-picker')).toBeVisible();
  await expect(page.locator('.piano-learn-lab')).toHaveCount(0);

  // Exit: lowest + highest held for two seconds leaves to the launcher's free play.
  await chord(page, [LOW, HIGH], 2400);
  await expect(page.locator('.office-sheet-music')).toHaveCount(0);
  await expect(page.locator('.tetris-fullscreen')).toHaveCount(0);
});

test('the picker holds a short list, an empty one and a slow one by layout', async ({ page }) => {
  // Three pieces (the usual case), then one, then none, then a list still loading.
  await installOfficeRoutes(page, { studyDate: 'today', pieces: deskPieces(3) });
  await page.goto('/', { waitUntil: 'networkidle' });
  await chord(page, [LOW, HIGH], 150);
  await tap(page, KEY.D5);
  await expect(page.locator('.office-piece-key')).toHaveCount(3);
  await expect(page.locator('.office-piece-picker__page[data-browse="next"] .office-key-card')).toHaveCount(0);
  await noClipping(page, '02b-picker-three');

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await installOfficeRoutes(page, { studyDate: 'today', pieces: deskPieces(1) });
  await page.goto('/', { waitUntil: 'networkidle' });
  await chord(page, [LOW, HIGH], 150);
  await tap(page, KEY.D5);
  await expect(page.locator('.office-piece-key')).toHaveCount(1);
  await noClipping(page, '02c-picker-one');

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await installOfficeRoutes(page, { studyDate: 'today', pieces: [] });
  await page.goto('/', { waitUntil: 'networkidle' });
  await chord(page, [LOW, HIGH], 150);
  await tap(page, KEY.D5);
  // No pieces of their own: Sheet Music opens on the shelves, saying why, with no key back to an empty list.
  await expect(page.locator('.office-piece-picker__head')).toContainText('No pieces started yet');
  await expect(page.locator('.office-piece-key--shelf')).toHaveCount(7);
  await expect(page.locator('.office-piece-picker__page[data-browse="switch"] .office-key-card')).toHaveCount(0);
  await noClipping(page, '02d-picker-empty');

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await installOfficeRoutes(page, { studyDate: 'today' });
  await page.route('**/api/v1/piano/activity/desk/**', () => {}); // never answers: the list is still loading
  await page.goto('/', { waitUntil: 'networkidle' }).catch(() => {});
  await chord(page, [LOW, HIGH], 150);
  await tap(page, KEY.D5);
  await expect(page.locator('.office-sheet-music [role="status"]')).toContainText('Finding your pieces');
  await noClipping(page, '02e-picker-loading');
});

test('with games off, Sheet Music stays on the launcher and the games are locked in place', async ({ page }) => {
  await installOfficeRoutes(page, { studyDate: 'today', gamesOffFor: ['learner4'] });
  await page.goto('/', { waitUntil: 'networkidle' });
  await chord(page, [LOW, HIGH], 150);
  await expect(page.locator('.note-launcher__notice')).toContainText('Games are off');
  await expect(page.locator('.nl-key.is-locked')).toHaveCount(8);
  await expect(page.locator('.nl-key:not(.is-locked)')).toContainText('Sheet Music');
  await noClipping(page, '06-launcher-games-off', '.note-launcher');
  // A game key does nothing; the Sheet Music key opens it.
  await tap(page, KEY.C4);
  await expect(page.locator('.tetris-fullscreen')).toHaveCount(0);
  await tap(page, KEY.D5);
  await expect(page.locator('.office-piece-picker')).toBeVisible();
});

test('a player picked on another day is asked for before anything saves', async ({ page }) => {
  const { writes } = await installOfficeRoutes(page, { studyDate: '2026-01-01' });
  await page.goto('/', { waitUntil: 'networkidle' });
  await chord(page, [LOW, HIGH], 150);
  await tap(page, KEY.D5);
  await expect(page.locator('.office-sheet-music--who .note-launcher--users')).toBeVisible();
  await expect(page.locator('.office-piece-picker')).toHaveCount(0);
  await noClipping(page, '07-who-is-practising');
  await tap(page, 62); // D4: the second player
  await expect(page.locator('.office-piece-picker')).toBeVisible();
  await expect(page.locator('.office-game-chrome')).toContainText('Learner Five');
  expect(writes).toEqual([]);
});
