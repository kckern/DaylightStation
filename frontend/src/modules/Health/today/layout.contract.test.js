import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass';
import { ASIDE_MIN_WIDTH_PX } from './layout.js';

// jsdom cannot see layout. What it CAN do is read the compiled stylesheet, so
// the layout facts pinned here are the ones a wrong value would break silently:
// the breakpoint that must agree with the JS mount gate, the capped column, and
// the fact that the aside is one element repositioned rather than a duplicate.
//
// The visual result at 390px and 1440px is verified with real Playwright
// screenshots — this file guards the invariants a screenshot cannot state.

const css = sass.compile(
  fileURLToPath(new URL('../health.scss', import.meta.url)),
).css.replace(/\s+/g, ' ');

const rule = (selector) => css.match(
  new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`),
)?.[1] ?? '';

describe('Today layout stylesheet', () => {
  it('uses the SAME breakpoint the JS mount gate uses', () => {
    // The stylesheet decides where the column appears; layout.js decides
    // whether the sidebar's 30-day widgets fetch at all. Two numbers that must
    // agree, in two languages — so one of them is asserted against the other.
    expect(css).toContain(`@media (min-width: ${ASIDE_MIN_WIDTH_PX}px)`);
  });

  it('caps and centres the Today column instead of letting it span a 2560px monitor', () => {
    const today = rule('.health-today');
    expect(today).toMatch(/max-width: 720px/);
    expect(today).toMatch(/margin-inline: auto/);
  });

  it('keeps the quick-capture clearance padding when the layout becomes a grid', () => {
    // Regression guard: the grid rule is a SECOND `.health-today` block, and
    // overwriting rather than extending it would silently drop the padding that
    // stops the floating capture bar covering the last log row.
    expect(rule('.health-today')).toMatch(/padding-bottom: calc\(/);
  });

  it('gives the wide layout a main column and a fixed-width aside', () => {
    const wide = css.match(/@media \(min-width: 1100px\) \{ \.health-today \{([^}]*)\}/)?.[1] ?? '';
    expect(wide).toMatch(/display: grid/);
    expect(wide).toMatch(/grid-template-columns: minmax\(0, 1fr\) 320px/);
  });

  it('moves the ONE aside element into column 2 — it is not a second copy that gets hidden', () => {
    // If the aside were duplicated, the narrow rule would be `display: none`
    // on one of them. It is not: the narrow rule is a normal flex stack.
    const narrow = rule('.health-today__aside');
    expect(narrow).toMatch(/display: flex/);
    expect(narrow).not.toMatch(/display: *none/);
    const placed = rule('.health-today > .health-today__aside');
    expect(placed).toMatch(/grid-column: 2/);
  });

  it('never animates `filter` — a known paint-cost trap in this repo', () => {
    expect(css).not.toMatch(/transition:[^;]*filter/);
    expect(css).not.toMatch(/animation:[^;]*filter/);
  });
});

describe('month block stylesheet', () => {
  it('gives a computed day a real track and a hole a hollow outline', () => {
    expect(rule('.health-monthblock__bar')).toMatch(/background: var\(--ds-surface-alt\)/);
    const gap = rule('.health-monthblock__bar--gap');
    expect(gap).toMatch(/background: none/);
    expect(gap).toMatch(/dashed/);
  });

  it('hues over-budget days with the danger token', () => {
    expect(rule('.health-monthblock__fill--over')).toContain('var(--ds-danger)');
  });

  it('gives the bar row a real height rather than collapsing to nothing', () => {
    expect(rule('.health-monthblock__bars')).toMatch(/height: 44px/);
  });
});

describe('week strip stylesheet', () => {
  it('places the budget reference line at 1/cap of the box, derived not guessed', () => {
    // dayBars.js's OVERSHOOT_CAP is 1.25, so a day exactly on budget must land
    // at 80% of the box. A hand-typed number here would drift from the JS.
    expect(rule('.health-weekstrip__goalline')).toMatch(/bottom: 80%/);
  });

  it('renders a gap hollow and a computed day with a real track', () => {
    expect(rule('.health-weekstrip__bar')).toMatch(/background: var\(--ds-surface-alt\)/);
    expect(rule('.health-weekstrip__bar--gap')).toMatch(/background: none/);
    expect(rule('.health-weekstrip__bar--gap')).toMatch(/dashed/);
  });
});
