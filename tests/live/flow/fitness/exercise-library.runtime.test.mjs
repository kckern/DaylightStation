// tests/live/flow/fitness/exercise-library.runtime.test.mjs
/**
 * Exercise Library — the live Browse → Build → Run journey.
 *
 * WHAT THIS TEST IS FOR
 * ---------------------
 * Every layer under this feature is unit- and mutation-tested, and each of those
 * suites mocks the API. None of them can answer the only question that matters to
 * the person in the garage: can a human actually walk the journey in a browser
 * against the real 1,296-exercise corpus? So nothing here is stubbed — no route
 * interception, no fixtures. The page talks to the running backend and the real
 * corpus index, and every count asserted below is a measured property of that
 * corpus rather than a number this test invented.
 *
 * THE COUNTS ARE THE POINT
 * ------------------------
 * `?group=chest&group=back` is 366 and `?group=chest&equipment=barbell` is 12.
 * Those two assertions pin the multi-value-facet encoding: OR is a repeated key,
 * AND is different keys. Collapsing a facet to one value, or joining with commas,
 * does not error — it silently returns everything or nothing, which reads on
 * screen as "the filter is just very selective". That bug class has been caught
 * twice on this branch, so a UI walk that never checks the grid actually narrowed
 * would be worth very little.
 *
 * ACTIVATION: onPointerDown
 * -------------------------
 * Every target in this feature fires on `onPointerDown`, not `onClick`. Playwright's
 * `.click()` dispatches pointerdown, so real clicks are used throughout and nothing
 * here synthesises events — if a target stops being reachable, this test stops
 * passing, which is the whole point. (During development the card `+` control was
 * genuinely unclickable: the grid stretched each card so its `aspect-ratio` thumb
 * resolved to 0, collapsing the card to its 4px borders and clipping the control
 * away. The "browse grid is usable" test below exists to catch exactly that, and
 * measures the card rather than trusting that it rendered.)
 *
 * NO SKIPPING
 * -----------
 * Per CLAUDE.md → Test Discipline: a precondition that does not hold fails the
 * assertion, it does not skip it. `beforeAll` fails fast and loudly if the
 * backend or the corpus index is missing, because a browse grid that renders zero
 * cards must never be mistaken for a passing flow test.
 *
 * CLEANUP
 * -------
 * Saving is part of the journey, so this test writes to the household workout
 * shelf. Completing a run ALSO writes to session history — the runner opens a
 * session to attribute the strength block to. Both are deleted in `afterAll`,
 * which then asserts neither survived.
 *
 * That second cleanup is not optional. A leaked session is a workout that never
 * happened, and it is indistinguishable from a real one to session detail,
 * recaps, the longitudinal widget, and Strava reconciliation. An earlier run of
 * this test left one in real household history.
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL, BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = FRONTEND_URL;
const API_URL = BACKEND_URL;

// The widget is registered as `fitness:instruction`; `fitness_instruction` is the
// legacy manifest id FitnessApp routes on (see frontend/src/modules/Fitness/index.js).
const MODULE_URL = `${BASE_URL}/fitness/module/fitness_instruction`;

const EXERCISES_API = `${API_URL}/api/v1/fitness/exercises`;
const WORKOUTS_API = `${API_URL}/api/v1/fitness/workouts`;

/**
 * Measured properties of the real corpus. These are assertions about the data the
 * feature ships against, not arbitrary fixtures — see the docblock.
 */
const CORPUS = {
  total: 1296,
  chest: 157,
  chestOrBack: 366,      // repeated `group` key — OR within a facet
  chestAndBarbell: 12,   // different keys — AND across facets
  pushUp: 50,            // ?q=push up
  groups: 12,
  muscles: 38,
  equipment: 29,
};

/** The window ExerciseBrowser mounts per page (PAGE_SIZE). */
const PAGE_SIZE = 60;

/** Title we save under, so cleanup can recognise its own litter. */
const TEST_TITLE = 'ZZ E2E Exercise Library';
const TEST_ID_PREFIX = 'zz-e2e-exercise-library';

let sharedContext;
let page;

/** Workout ids this run created, deleted in afterAll. */
const createdWorkoutIds = new Set();

/**
 * Session ids this run caused to be opened, deleted in afterAll. Completing a
 * run posts to /sessions/:id/strength; that id is the session the runner opened
 * for attribution, and it lands in real household history if left behind.
 */
const createdSessionIds = new Set();

/** Every fitness API request the page made, in order. */
let apiCalls = [];

const testId = (id) => page.locator(`[data-testid="${id}"]`);

/** Wait for the browse count line to settle on an exact total. */
async function waitForTotal(expectedTotal, label) {
  await page
    .waitForFunction(
      (total) => {
        const el = document.querySelector('[data-testid="exercise-browser-count"]');
        return Boolean(el) && new RegExp(`of ${total}$`).test(el.textContent.trim());
      },
      expectedTotal,
      { timeout: 20000 },
    )
    .catch(() => { /* fall through — the expect below reports the real value */ });

  const text = (await testId('exercise-browser-count').textContent()).trim();
  const actual = Number(text.match(/of (\d+)$/)?.[1] ?? NaN);
  expect(
    actual,
    `${label}: browse count line read "${text}" — expected a total of ${expectedTotal}. ` +
    'A total of 1296 here means the facet was dropped from the query; 0 means it was ' +
    'sent in an encoding the API reads as one unknown slug (comma-joined, or collapsed ' +
    'to a single value). Both are silent — see buildExerciseQuery in ExerciseBrowser.jsx.',
  ).toBe(expectedTotal);
}

/**
 * Load a fresh browse screen.
 *
 * Filter state lives in the component, and these tests share one page, so a test
 * that started by toggling `chest` on top of a leftover `chest` would toggle it
 * OFF and then assert against a corpus slice nobody chose. Each test that browses
 * starts from the URL instead. (The run tests deliberately do NOT reload — they
 * continue the run the journey test started.)
 */
async function openBrowse() {
  await page.goto(MODULE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await expect(testId('exercise-browser-grid')).toBeVisible({ timeout: 30000 });
  await waitForTotal(CORPUS.total, 'fresh browse');
}

/** Slugs currently mounted in the grid, in render order. */
async function visibleSlugs() {
  return page
    .locator('[data-testid^="exercise-card-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid').replace('exercise-card-', '')));
}

test.describe.configure({ mode: 'serial' });

test.describe('Exercise Library: browse → build → run', () => {
  test.beforeAll(async ({ browser }) => {
    // ── Fail fast: the backend must be up. ────────────────────────────────────
    let ping;
    try {
      ping = await fetch(`${API_URL}/api/v1/ping`, { signal: AbortSignal.timeout(10000) });
    } catch (err) {
      throw new Error(
        `FAIL FAST: backend not reachable at ${API_URL}. Cannot run the exercise ` +
        `library flow.\nError: ${err.message}`,
      );
    }
    expect(ping.ok, `FAIL FAST: ${API_URL}/api/v1/ping returned ${ping.status}`).toBe(true);

    // ── Fail fast: the corpus index must exist. ───────────────────────────────
    // Without it browse is LEGITIMATELY empty, and a flow test that passes against
    // an empty grid is worse than no test at all. This is an assertion, never a skip.
    const taxonomyRes = await fetch(`${EXERCISES_API}/taxonomy`, { signal: AbortSignal.timeout(15000) });
    expect(
      taxonomyRes.ok,
      `FAIL FAST: taxonomy endpoint returned ${taxonomyRes.status}. The exercise ` +
      'library API is not serving.',
    ).toBe(true);
    const taxonomy = await taxonomyRes.json();

    expect(
      taxonomy?.library?.available,
      'FAIL FAST: the exercise corpus index is not built, so browse has nothing to ' +
      'show and every assertion below would be vacuous. Build it with ' +
      '`npm run exercise:index` (it writes data/household/apps/fitness/exercise-index.yml), ' +
      'then re-run.',
    ).toBe(true);

    expect(taxonomy.groups?.length, 'taxonomy muscle groups').toBe(CORPUS.groups);
    expect(taxonomy.muscles?.length, 'taxonomy muscles').toBe(CORPUS.muscles);
    expect(taxonomy.equipment?.length, 'taxonomy equipment').toBe(CORPUS.equipment);

    // ── Fail fast: the corpus must be the one these counts describe. ──────────
    const listRes = await fetch(EXERCISES_API, { signal: AbortSignal.timeout(20000) });
    expect(listRes.ok, `FAIL FAST: exercise list returned ${listRes.status}`).toBe(true);
    const list = await listRes.json();
    expect(
      list.total,
      `FAIL FAST: the corpus holds ${list.total} exercises, not ${CORPUS.total}. Either ` +
      'the index was rebuilt from a different source or these expectations are stale — ' +
      'reconcile before trusting any narrowing assertion below.',
    ).toBe(CORPUS.total);

    console.log(`Corpus ready: ${list.total} exercises, built ${taxonomy.library.builtAt}`);

    sharedContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    page = await sharedContext.newPage();

    apiCalls = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/api/v1/fitness/')) {
        apiCalls.push({ method: req.method(), path: url.replace(BASE_URL, '') });
        const strength = url.match(/\/sessions\/([^/]+)\/strength/);
        if (strength) createdSessionIds.add(decodeURIComponent(strength[1]));
      }
    });
  });

  test.afterAll(async () => {
    if (page) await page.close();
    if (sharedContext) await sharedContext.close();

    // Delete everything this run put on the shelf, then prove the shelf is clean.
    for (const id of createdWorkoutIds) {
      const res = await fetch(`${WORKOUTS_API}/${id}`, { method: 'DELETE' });
      console.log(`cleanup: DELETE workout ${id} → ${res.status}`);
    }

    const listRes = await fetch(WORKOUTS_API);
    const { workouts = [] } = await listRes.json();
    const leftovers = workouts.filter((w) => String(w.id || '').startsWith(TEST_ID_PREFIX));
    // Belt and braces: a save whose id we failed to read still gets swept.
    for (const stray of leftovers) {
      const res = await fetch(`${WORKOUTS_API}/${stray.id}`, { method: 'DELETE' });
      console.log(`cleanup: DELETE stray workout ${stray.id} → ${res.status}`);
    }

    const finalRes = await fetch(WORKOUTS_API);
    const { workouts: remaining = [] } = await finalRes.json();
    const stillThere = remaining.filter((w) => String(w.id || '').startsWith(TEST_ID_PREFIX));
    expect(stillThere.map((w) => w.id), 'cleanup must leave no test workouts on the shelf').toEqual([]);

    // Sessions the runner opened to attribute strength runs to. Left behind,
    // each one reads as a real workout in history — see the CLEANUP docblock.
    const survivingSessions = [];
    for (const sessionId of createdSessionIds) {
      const res = await fetch(`${API_URL}/api/v1/fitness/sessions/${sessionId}`, { method: 'DELETE' });
      console.log(`cleanup: DELETE session ${sessionId} → ${res.status}`);
      const check = await fetch(`${API_URL}/api/v1/fitness/sessions/${sessionId}`);
      if (check.status !== 404) survivingSessions.push(`${sessionId} (GET → ${check.status})`);
    }
    expect(survivingSessions, 'cleanup must leave no test sessions in history').toEqual([]);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Browse renders the real corpus.
  // ═══════════════════════════════════════════════════════════════════════════
  test('browse renders the real corpus and its facet rails', async () => {
    await page.goto(MODULE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await expect(testId('fitness-instruction')).toBeVisible({ timeout: 30000 });
    await expect(testId('fitness-instruction')).toHaveAttribute('data-state', 'browse');
    await expect(testId('exercise-browser-grid')).toBeVisible({ timeout: 30000 });

    // The unbuilt-index panel and an over-narrow filter both render zero cards;
    // only this one says the index is missing. It must not be on screen.
    expect(
      await testId('exercise-browser-unavailable').count(),
      'the "library has not been built" panel is showing — the corpus index is missing',
    ).toBe(0);

    await waitForTotal(CORPUS.total, 'unfiltered browse');

    // The DOM cap: 1,296 results, 60 cards mounted. Rendering all of them would
    // page the kiosk to death, so this is load-bearing behaviour, not a detail.
    const cards = await page.locator('[data-testid^="exercise-card-"]').count();
    expect(cards, `browse should mount exactly PAGE_SIZE (${PAGE_SIZE}) cards, not the whole corpus`)
      .toBe(PAGE_SIZE);

    // Names come from the corpus records. Images are lazy (IntersectionObserver),
    // so nothing here asserts on image load.
    const firstName = (await page.locator('.exercise-browser__card-name').first().textContent()).trim();
    expect(firstName.length, 'the first card should carry a real exercise name').toBeGreaterThan(0);

    expect(await page.locator('[data-testid^="exercise-group-"]').count(), 'group chips').toBe(CORPUS.groups);
    await testId('exercise-browser-tab-equipment').click();
    expect(await page.locator('[data-testid^="exercise-equipment-"]').count(), 'equipment chips').toBe(CORPUS.equipment);

    // The muscle category is gated on a body area: all 38 at once is unreadable.
    await testId('exercise-browser-tab-muscles').click();
    await expect(testId('exercise-browser-muscle-hint')).toBeVisible();
    expect(
      await page.locator('[data-testid^="exercise-muscle-"]').count(),
      'no muscle chips should render before a group is picked',
    ).toBe(0);

    console.log(`Browse: ${cards} cards mounted of ${CORPUS.total}; first card "${firstName}"`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Filtering actually narrows — the multi-value-facet contract.
  // ═══════════════════════════════════════════════════════════════════════════
  test('filters narrow the corpus: OR within a facet, AND across facets', async () => {
    await openBrowse();

    await testId('exercise-group-chest').click();
    await waitForTotal(CORPUS.chest, 'group=chest');

    // Two values in ONE facet must OR (repeated key), not replace and not AND.
    await testId('exercise-group-back').click();
    await waitForTotal(CORPUS.chestOrBack, 'group=chest&group=back');
    expect(
      CORPUS.chestOrBack,
      'chest OR back must exceed chest alone, or the second value was dropped',
    ).toBeGreaterThan(CORPUS.chest);

    // Toggling the same chip off is symmetric.
    await testId('exercise-group-back').click();
    await waitForTotal(CORPUS.chest, 'group=chest (back toggled off)');

    // Two values across DIFFERENT facets must AND.
    await testId('exercise-browser-tab-equipment').click();
    await testId('exercise-equipment-barbell').click();
    await waitForTotal(CORPUS.chestAndBarbell, 'group=chest&equipment=barbell');
    expect(
      CORPUS.chestAndBarbell,
      'chest AND barbell must be narrower than chest alone',
    ).toBeLessThan(CORPUS.chest);

    // The muscle category unlocks once a group is picked, and shows only that group's
    // muscles — a muscle outside the selected groups could only ever AND to zero.
    await testId('exercise-browser-tab-muscles').click();
    const muscleChips = await page.locator('[data-testid^="exercise-muscle-"]').count();
    expect(muscleChips, 'picking a group should unlock its muscle chips').toBeGreaterThan(0);
    expect(muscleChips, 'the muscle rail should show one group\'s muscles, not all 38')
      .toBeLessThan(CORPUS.muscles);

    // Clearing restores the whole corpus.
    await testId('exercise-browser-clear').click();
    await waitForTotal(CORPUS.total, 'filters cleared');

    console.log(
      `Filters verified: chest=${CORPUS.chest}, chest|back=${CORPUS.chestOrBack}, ` +
      `chest&barbell=${CORPUS.chestAndBarbell}`,
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. The grid has to be usable, not merely present.
  //
  // A card that renders and a card a person can tap are different claims, and only
  // the second one matters at arm's length on a TV. This test measures the rendered
  // card and hit-tests the `+` control at its own centre. It is the test that owns
  // the layout defect the rest of the journey routes around with `pointerTap`.
  // ═══════════════════════════════════════════════════════════════════════════
  test('browse grid is usable: cards have height and the + target is tappable', async () => {
    await openBrowse();

    await testId('exercise-group-chest').click();
    await waitForTotal(CORPUS.chest, 'group=chest');
    await testId('exercise-browser-tab-equipment').click();
    await testId('exercise-equipment-barbell').click();
    await waitForTotal(CORPUS.chestAndBarbell, 'group=chest&equipment=barbell');

    const geometry = await page.evaluate(() => {
      const card = document.querySelector('[data-testid^="exercise-card-"]');
      if (!card) return null;
      const add = card.querySelector('[data-testid^="exercise-add-"]');
      const thumb = card.querySelector('.exercise-browser__thumb');
      const grid = document.querySelector('.exercise-browser__grid');
      const facets = document.querySelector('.exercise-browser__filter-deck');
      const rect = add?.getBoundingClientRect();
      const hit = rect
        ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        : null;
      const round = (n) => Math.round(n);
      return {
        cardHeight: round(card.getBoundingClientRect().height),
        thumbHeight: thumb ? round(thumb.getBoundingClientRect().height) : null,
        gridHeight: grid ? round(grid.getBoundingClientRect().height) : null,
        facetsHeight: facets ? round(facets.getBoundingClientRect().height) : null,
        addIsTopmost: hit ? Boolean(hit.closest('[data-testid^="exercise-add-"]')) : false,
        blockedBy: hit ? String(hit.className).slice(0, 80) : null,
      };
    });

    expect(geometry, 'no exercise card mounted to measure').not.toBeNull();
    console.log('Grid geometry:', JSON.stringify(geometry));

    // A card is a 4:3 demo thumb above a name, so a real one is ~350px. Anything
    // near zero means the card collapsed rather than laid out.
    expect(
      geometry.cardHeight,
      `an exercise card rendered ${geometry.cardHeight}px tall with a ${geometry.thumbHeight}px ` +
      `thumb inside a ${geometry.gridHeight}px grid. The card collapses to its borders, ` +
      'and because `.exercise-browser__card` sets `overflow: hidden` the demo GIF, the ' +
      'name and the + control are all clipped away — the grid renders as hairlines.\n' +
      'Root cause: `.exercise-browser__grid` leaves `align-items` at its initial ' +
      '`normal`/stretch, so each card is stretched to its grid row. The row is ' +
      '`grid-auto-rows: auto`, sized from the card content, and the card content height ' +
      'comes from `.exercise-browser__thumb`\'s `aspect-ratio: 4/3`. Stretching makes ' +
      'that circular and Chromium resolves the thumb to 0. Adding `align-items: start` ' +
      'to the grid (or `align-self: start` to the card) yields a 356px card with a 300px ' +
      'thumb — verified in this browser.\n' +
      'Note the GIF is fetched and decoded either way (img.complete is true, natural ' +
      'size 360x360) and then painted at zero height, so the corpus is paying full ' +
      'bandwidth for artwork nobody can see.',
    ).toBeGreaterThan(100);

    expect(
      geometry.addIsTopmost,
      `the + control is not the topmost element at its own centre (hit "${geometry.blockedBy}"), ` +
      'so a person cannot tap it to add an exercise. Downstream of the card collapse ' +
      'above: the + is absolutely positioned at the card\'s bottom, so against a 4px ' +
      'card its box lands above the card entirely, over the facet rails, and is clipped ' +
      'to a sliver by the card\'s `overflow: hidden`.',
    ).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. The journey: pick two, group them, save, run, advance a step.
  // ═══════════════════════════════════════════════════════════════════════════
  test('picks two exercises, groups them, saves, and runs a step', async () => {
    await openBrowse();

    // Filtered down to a workable set — this is how the screen is meant to be used.
    await testId('exercise-group-chest').click();
    await waitForTotal(CORPUS.chest, 'group=chest');
    await testId('exercise-browser-tab-equipment').click();
    await testId('exercise-equipment-barbell').click();
    await waitForTotal(CORPUS.chestAndBarbell, 'group=chest&equipment=barbell');

    const slugs = await visibleSlugs();
    expect(slugs.length, 'chest+barbell should mount all 12 matches').toBe(CORPUS.chestAndBarbell);

    const [firstSlug, secondSlug] = slugs;
    const nameOf = async (slug) =>
      (await page.locator(`[data-testid="exercise-card-${slug}"] .exercise-browser__card-name`).textContent()).trim();
    const firstName = await nameOf(firstSlug);
    const secondName = await nameOf(secondSlug);

    await testId(`exercise-add-${firstSlug}`).click();
    await expect(testId(`exercise-add-${firstSlug}`)).toHaveAttribute('data-in-tray', 'true');
    await testId(`exercise-add-${secondSlug}`).click();
    await expect(testId(`exercise-add-${secondSlug}`)).toHaveAttribute('data-in-tray', 'true');

    // The tray count is the affordance that tells the user the picks landed.
    await expect(page.locator('[data-testid="fitness-instruction-to-build"] .exercise-browser__tap-sub'))
      .toHaveText('2 selected');

    // ── browse → build ───────────────────────────────────────────────────────
    await testId('fitness-instruction-to-build').click();
    await expect(testId('fitness-instruction')).toHaveAttribute('data-state', 'build');
    await expect(testId('workout-builder')).toBeVisible({ timeout: 15000 });

    // Two picks seed two straight-sets groups of 3 sets each.
    await expect(testId('workout-builder-summary')).toHaveText('2 groups · 6 sets');
    await expect(testId('workout-group-0-kind')).toHaveText('Straight sets');
    await expect(testId('workout-group-1-kind')).toHaveText('Straight sets');

    // ── group them ───────────────────────────────────────────────────────────
    // Merging is the gesture that turns two singles into a superset. The 3 sets
    // each must carry across as 3 rounds — the work survives the gesture.
    await testId('workout-group-0-merge').click();
    await expect(testId('workout-group-0-kind')).toHaveText('Superset');
    await expect(testId('workout-group-0-rounds-value')).toHaveText('3');
    await expect(testId('workout-builder-summary')).toHaveText('1 group · 6 sets');
    expect(
      await page.locator('[data-testid^="workout-group-"][data-kind]').count(),
      'merging two groups should leave one',
    ).toBe(1);

    // Reordering inside the group is buttons, not drag.
    await testId('workout-group-0-ex-1-up').click();
    await expect(testId('workout-group-0-ex-0')).toHaveAttribute('data-slug', secondSlug);
    await expect(testId('workout-group-0-ex-1')).toHaveAttribute('data-slug', firstSlug);
    // Put it back so the run order below is predictable.
    await testId('workout-group-0-ex-1-up').click();
    await expect(testId('workout-group-0-ex-0')).toHaveAttribute('data-slug', firstSlug);

    // ── save ─────────────────────────────────────────────────────────────────
    await testId('workout-builder-title').fill(TEST_TITLE);
    await testId('workout-builder-save').click();
    await expect(testId('workout-builder-saved')).toBeVisible({ timeout: 20000 });
    expect(
      await testId('workout-builder-error').count(),
      'save reported an error',
    ).toBe(0);

    const savedId = (await testId('workout-builder-saved').textContent()).replace('Saved', '').trim();
    expect(savedId, 'the saved banner should name the workout id').toMatch(/^zz-e2e-exercise-library/);
    createdWorkoutIds.add(savedId);
    console.log(`Saved workout ${savedId}`);

    // It really reached the shelf, not just the banner.
    const shelfRes = await fetch(`${WORKOUTS_API}/${savedId}`);
    expect(shelfRes.ok, `GET /workouts/${savedId} returned ${shelfRes.status}`).toBe(true);
    const stored = await shelfRes.json();
    const storedWorkout = stored.workout ?? stored;
    expect(storedWorkout.groups?.length, 'stored workout should hold one merged group').toBe(1);
    expect(storedWorkout.groups[0].exercises.map((e) => e.slug)).toEqual([firstSlug, secondSlug]);
    expect(storedWorkout.groups[0].rounds, 'stored rounds should carry the merged passes').toBe(3);

    // ── build → run ──────────────────────────────────────────────────────────
    await testId('fitness-instruction-to-run').click();
    await expect(testId('fitness-instruction')).toHaveAttribute('data-state', 'run', { timeout: 20000 });
    await expect(testId('workout-runner')).toBeVisible({ timeout: 20000 });
    expect(
      await testId('workout-builder-run-error').count(),
      'the run round trip failed and the builder held with an error',
    ).toBe(0);

    // The step list is expanded SERVER-side by expandWorkout: a superset of two
    // exercises over 3 rounds is 6 work steps interleaved with 5 rests. Asserting
    // the exact total pins the UI to the domain's ordering rule rather than to a
    // number the frontend derived for itself.
    await expect(testId('workout-runner-progress')).toHaveText('Step 1 of 11');
    await expect(testId('workout-runner')).toHaveAttribute('data-phase', 'work');
    await expect(testId('workout-runner-name')).toHaveText(firstName);
    await expect(testId('workout-runner-group')).toHaveText('Superset · Round 1 of 3');
    await expect(testId('workout-runner-set')).toHaveText('Set 1 of 3');
    await expect(testId('workout-runner-target')).toHaveText('10 reps');

    // ── run one step ─────────────────────────────────────────────────────────
    await testId('workout-runner-done').click();
    await expect(testId('workout-runner-progress')).toHaveText('Step 2 of 11');
    await expect(testId('workout-runner')).toHaveAttribute('data-phase', 'rest');

    console.log(`Ran a step of "${firstName}" → "${secondName}" superset (11 steps expanded)`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. The strength endpoint is live in this deployment.
  //
  // Cheap reachability probe that writes nothing: a 503 means the composition root
  // never constructed LogStrengthRun (no workout repository), which would make the
  // wiring assertion in the next test unfair. A 404 with a reason proves the route,
  // the use case and the repository are all present and talking.
  // ═══════════════════════════════════════════════════════════════════════════
  test('the session strength endpoint is wired and reachable', async () => {
    const res = await fetch(`${API_URL}/api/v1/fitness/sessions/20260101000000/strength`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workoutId: 'zz-e2e-no-such-workout',
        completedSteps: [{ groupIndex: 0, slug: 'barbell-bench-press' }],
      }),
    });
    const body = await res.json();

    expect(
      res.status,
      `POST /sessions/:id/strength returned ${res.status} (${JSON.stringify(body)}). A 503 ` +
      'means strength logging was never constructed in the composition root.',
    ).toBe(404);
    expect(body.reason, 'the endpoint should name why it refused').toBe('unknown_workout');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. A finished run has to reach the session record.
  //
  // This is the end of the journey the feature promises: LogStrengthRun writes the
  // run onto the same session record a cycle ride uses, so session detail, recaps,
  // the longitudinal widget and Strava reconciliation all pick it up. Test 5 proved
  // the endpoint is there. This asserts the runner actually calls it.
  // ═══════════════════════════════════════════════════════════════════════════
  test('running the workout reports the completed sets to the session record', async () => {
    // Finish the run that test 4 started, so this is a genuinely completed workout
    // and not an abandoned one.
    for (let i = 0; i < 20; i += 1) {
      if (await testId('workout-runner-complete').count()) break;
      await testId('workout-runner-done').click();
      await page.waitForTimeout(120);
    }

    await expect(
      testId('workout-runner'),
      'the run never reached its completion screen',
    ).toHaveAttribute('data-phase', 'complete', { timeout: 15000 });

    await page.waitForTimeout(2000); // let any post-completion request go out

    const strengthCalls = apiCalls.filter((c) => c.path.includes('/strength'));
    console.log('Fitness API calls made during the journey:');
    apiCalls.forEach((c) => console.log(`  ${c.method} ${c.path}`));

    expect(
      strengthCalls.length,
      'a completed workout never reported itself: the page made no POST to ' +
      '/api/v1/fitness/sessions/:sessionId/strength, so the run is not on any session ' +
      'record and nothing downstream (session detail, recap, longitudinal widget, ' +
      'Strava reconciliation) will ever know it happened. The backend leg is fully ' +
      'built and reachable (see the previous test) — the gap is in the client: ' +
      'WorkoutRunner accepts an `onComplete` prop, but FitnessInstructionContainer ' +
      'renders it with only `onExit`, and no layer in the browse/build/run flow ever ' +
      'holds a sessionId to attribute the run to.',
    ).toBeGreaterThan(0);
  });
});
