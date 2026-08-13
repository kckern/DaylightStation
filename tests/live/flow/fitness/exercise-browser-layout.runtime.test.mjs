/**
 * Exercise Browser — vertical budget.
 *
 * WHY THIS EXISTS
 * ---------------
 * The browse screen renders inside `.fitness-module-container`, a FIXED-height
 * box with `overflow-y: hidden`. There is no page scroll, so every pixel the
 * filter deck takes is taken from the exercise grid permanently.
 *
 * The first cut of this screen shipped with 123 passing jsdom tests and was
 * still unusable: the muscle rail (38 chips) and the equipment rail (29) wrapped
 * freely and grew to ~1,225px of content inside a 744px panel, leaving the grid
 * 88px — 11.8% of the container, a strip of clipped card tops. Browse opened
 * showing essentially no exercises.
 *
 * jsdom has no layout engine and cannot see that class of bug. This can. It is
 * the only test in the suite that measures rendered geometry, so keep it cheap
 * and keep it about geometry: the structural invariants behind the fix (one
 * bounded option rail, Show more inside the grid) are asserted in
 * frontend/src/modules/Fitness/widgets/FitnessInstruction/ExerciseBrowser.test.jsx.
 *
 * THE BUDGET
 * ----------
 * In the default, unfiltered state the grid must own at least half the
 * container. Half is not an aesthetic preference — below it the grid stops
 * showing a complete row of cards, which is the one thing this screen is for.
 */
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

/** Deep link straight at the module — see useFitnessUrlParams: /fitness/module/:id */
const BROWSE_URL = `${FRONTEND_URL}/fitness/module/fitness_instruction`;

/** The grid must own at least this share of the container on open. */
const MIN_GRID_SHARE = 0.5;

async function measure(page) {
  return page.evaluate(() => {
    const grid = document.querySelector('.exercise-browser__grid');
    const container = document.querySelector('.fitness-module-container');
    const deck = document.querySelector('.exercise-browser__filter-deck');
    const optionRail = document.querySelector('.exercise-browser__option-rail');
    if (!grid || !container) return null;
    const h = (el) => (el ? el.clientHeight : 0);
    return {
      container: h(container),
      grid: h(grid),
      filterDeck: h(deck),
      optionRail: h(optionRail),
      optionRailScrollHeight: optionRail ? optionRail.scrollHeight : 0,
      cards: document.querySelectorAll('[data-testid^="exercise-card-"]').length,
      // Card height is its own trap: with the grid's default `grid-auto-rows:
      // auto` and a definite container height, Chromium sized every row to fit
      // and each card measured 0px — 60 mounted cards rendered as hairlines.
      cardHeight: h(document.querySelector('.exercise-browser__card')),
      thumbHeight: h(document.querySelector('.exercise-browser__thumb')),
      gridScrollHeight: grid.scrollHeight,
      muscleChips: document.querySelectorAll('[data-testid^="exercise-muscle-"]').length,
      count: document.querySelector('[data-testid="exercise-browser-count"]')?.textContent ?? null,
      share: +(h(grid) / h(container)).toFixed(3)
    };
  });
}

test.describe('Exercise Browser layout', () => {
  test('the grid owns at least half the container in the default state', async ({ page }) => {
    const failures = [];
    page.on('pageerror', (e) => failures.push(String(e)));
    page.on('response', (r) => { if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`); });

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(BROWSE_URL);

    // Wait for real content, not just for the element: an empty grid trivially
    // satisfies nothing and a library-not-built panel has no grid at all.
    await page.waitForSelector('[data-testid="exercise-browser-grid"]', { timeout: 45000 });
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid^="exercise-card-"]').length > 0,
      null, { timeout: 30000 }
    );
    // Let the rails settle after the taxonomy response lands.
    await page.waitForTimeout(1500);

    const m = await measure(page);
    console.log('exercise-browser layout:', JSON.stringify(m));

    expect(m, 'grid and container must both be present').not.toBeNull();
    expect(m.cards).toBeGreaterThan(0);

    // The regression: rails eat the panel, grid gets a sliver.
    expect(
      m.share,
      `grid ${m.grid}px of container ${m.container}px = ${(m.share * 100).toFixed(1)}%; ` +
      `filter deck took ${m.filterDeck}px`
    ).toBeGreaterThanOrEqual(MIN_GRID_SHARE);

    // Tall enough for a full card row, not a row of clipped tops.
    expect(m.grid, 'grid must show a complete card row').toBeGreaterThan(300);

    // Cards must actually have a body. A collapsed row still satisfies every
    // share assertion above while showing the user nothing.
    expect(m.cardHeight, 'cards must not collapse to hairlines').toBeGreaterThan(150);
    expect(m.thumbHeight, 'the demo GIF needs a visible box').toBeGreaterThan(120);
    // And the grid must overflow (it holds 60 cards in ~412px), which is what
    // makes the lazy-loading window meaningful in the first place.
    expect(m.gridScrollHeight).toBeGreaterThan(m.grid * 2);

    // Category tabs plus one 60px option rail stay inside a fixed compact deck.
    expect(m.filterDeck, 'filter deck must stay compact').toBeLessThan(135);

    // And they scroll sideways rather than growing: content height must not
    // exceed the row they are allotted.
    expect(m.optionRailScrollHeight).toBeLessThanOrEqual(m.optionRail + 2);

    // The default state opens with the muscle rail closed — 38 chips is what
    // blew the budget in the first place.
    expect(m.muscleChips).toBe(0);

    expect(failures, `page errors / failed requests: ${failures.join(', ')}`).toHaveLength(0);
  });

  test('picking a group opens the muscle rail without costing the grid its half', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(BROWSE_URL);
    await page.waitForSelector('[data-testid="exercise-group-back"]', { timeout: 45000 });

    const before = await measure(page);

    // onPointerDown, not click — the controls on this screen do not listen for
    // click at all (see the note atop FitnessApp.jsx).
    const chip = page.locator('[data-testid="exercise-group-back"]');
    const box = await chip.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();

    const muscleTab = page.locator('[data-testid="exercise-browser-tab-muscles"]');
    const muscleTabBox = await muscleTab.boundingBox();
    await page.mouse.move(
      muscleTabBox.x + muscleTabBox.width / 2,
      muscleTabBox.y + muscleTabBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.up();

    await page.waitForSelector('[data-testid^="exercise-muscle-"]', { timeout: 15000 });
    await page.waitForTimeout(1000);

    const after = await measure(page);
    console.log('after group pick:', JSON.stringify(after));

    expect(after.muscleChips).toBeGreaterThan(0);
    // The rail opened, so it must have opened INTO the row it already had.
    expect(after.filterDeck).toBeLessThan(135);
    expect(after.share).toBeGreaterThanOrEqual(MIN_GRID_SHARE);
    expect(after.grid).toBeGreaterThanOrEqual(before.grid - 8);
  });
});
