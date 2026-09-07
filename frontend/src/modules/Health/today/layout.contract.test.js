import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass';
import { readFileSync } from 'node:fs';
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
const scss = readFileSync(new URL('../health.scss', import.meta.url), 'utf8');

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
    expect(today).toMatch(/max-width: 1440px/);
    expect(today).toMatch(/margin-inline: auto/);
  });

  it('keeps capture controls in layout rather than floating over food', () => {
    // Regression guard: the grid rule is a SECOND `.health-today` block, and
    // overwriting rather than extending it would silently drop the padding that
    // stops the floating capture bar covering the last log row.
    expect(rule('.health-quickbar')).toMatch(/position: relative/);
    expect(rule('.health-today')).toMatch(/padding-bottom: 0.75rem/);
  });

  it('keeps the day ledger at its compact type and row rhythm', () => {
    expect(rule('.health-row-line')).toMatch(/min-height: 28px/);
    expect(rule('.health-row-identity')).toMatch(/min-height: 28px/);
    expect(rule('.health-row__name')).toMatch(/font-size: 0.86rem/);
    expect(rule('.health-row-artwork')).toMatch(/width: 24px/);
    expect(rule('.health-density-badge')).toMatch(/min-height: 28px/);
    expect(rule('.health-density-badge__visual')).toMatch(/width: 24px/);
    expect(rule('.health-density-badge__visual')).toMatch(/height: 14px/);
    expect(css).toMatch(/pointer: coarse[^}]*\.health-row-line[^}]*min-height: 44px/s);
    expect(scss).toMatch(/@include bp\.mobile-only \{[\s\S]*\.health-row-line, \.health-row-identity,[\s\S]*min-height: 44px/);
  });

  it('aligns meal headers and rows to shared nutrient tracks while only identity shrinks', () => {
    expect(rule('.health-meal')).toContain('--health-meal-tracks');
    expect(rule('.health-row-line')).toContain('var(--health-meal-tracks)');
    expect(rule('.health-meal__header')).toContain('var(--health-meal-tracks)');
    expect(rule('.health-row__description')).toMatch(/min-width: 0/);
  });

  it('dims child visual content while keeping an open popover fully opaque', () => {
    expect(rule('.health-row-line--child .health-row__visual')).toMatch(/opacity: 0.75/);
    expect(rule('.health-row-line--child .health-macro-badge')).toMatch(/width: 20px/);
    expect(rule('.health-row-line--child .health-macro-badge')).toMatch(/height: 20px/);
    expect(rule('.health-row-line--child .health-macro-badge')).toMatch(/border-radius: 50%/);
    expect(css).toMatch(/health-row-line--child:has\(\[aria-expanded=true\]\) \.health-row__visual \{[^}]*opacity: 1/);
  });

  it('indents child identity content without moving nutrient tracks and anchors its tree to parent artwork', () => {
    expect(rule('.health-row-line--child .health-row-identity')).toMatch(/padding-left: 16px/);
    expect(rule('.health-row-line--child .health-row__branch::before')).toContain('left: calc(100% + var(--health-row-gap) + 12px)');
    expect(rule('.health-row-line')).toContain('var(--health-meal-tracks)');
  });

  it('defines distinct before and after visual orders for all identity siblings', () => {
    expect(rule('.health-density-before .health-row-artwork')).toMatch(/order: 1/);
    expect(rule('.health-density-before .health-density-badge')).toMatch(/order: 2/);
    expect(rule('.health-density-before .health-row-name')).toMatch(/order: 3/);
    expect(rule('.health-density-after .health-row-artwork')).toMatch(/order: 1/);
    expect(rule('.health-density-after .health-row-name')).toMatch(/order: 2/);
    expect(rule('.health-density-after .health-density-badge')).toMatch(/order: 3/);
  });

  it('gives populated meals two equal desktop columns', () => {
    const wide = css.match(/@media \(min-width: 1200px\) \{ \.health-log \{([^}]*)\}/)?.[1] ?? '';
    expect(rule('.health-log')).toMatch(/display: grid/);
    expect(wide).toMatch(/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  });

  it('opts Health into the left context rail without changing other apps', () => {
    const chrome = readFileSync(new URL('../../../lib/ui/ds.scss', import.meta.url), 'utf8');
    expect(chrome).toContain('&--context { grid-template-columns: 320px minmax(0, 1fr); }');
    expect(chrome).toContain('grid-template-columns: 200px 1fr;');
    expect(rule('.health-history > summary')).toMatch(/min-height: 44px/);
  });

  it('never animates `filter` — a known paint-cost trap in this repo', () => {
    expect(css).not.toMatch(/transition:[^;]*filter/);
    expect(css).not.toMatch(/animation:[^;]*filter/);
  });
});

describe('add-food suggestion panel', () => {
  it('is a bounded surface rather than floating text', () => {
    const panel = rule('.health-suggest');
    expect(panel).toMatch(/border: 1px solid var\(--ds-border\)/);
    expect(panel).toMatch(/background: var\(--ds-surface\)/);
    expect(rule('.health-suggest__list')).toMatch(/max-height:/);
    expect(rule('.health-suggest__list')).toMatch(/overflow-y: auto/);
  });

  it('uses two compact columns when the viewport can hold them', () => {
    expect(css).toContain('@media (min-width: 480px)');
    expect(css).toMatch(/\.health-suggest__list \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
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
  it('makes selection and week navigation visually explicit', () => {
    expect(rule('.health-weekstrip__nav')).toMatch(/grid-template-columns: 44px 1fr 44px/);
    expect(rule('.health-weekstrip__cell--active')).toMatch(/border-color: var\(--ds-accent\)/);
    expect(rule('.health-weekstrip__cell--month-start')).toMatch(/border-left-color: var\(--ds-border\)/);
  });

  it('places the budget reference line at 1/cap of the box, derived not guessed', () => {
    // dayBars.js's OVERSHOOT_CAP is 1.25, so a day exactly on budget must land
    // at 80% of the box. A hand-typed number here would drift from the JS.
    expect(rule('.health-weekstrip__goalline')).toMatch(/bottom: 80%/);
  });

  it('marks an exercise-offset day with a non-colour cue, not hue alone', () => {
    // A day that ate past budget and still came in under is GREEN above the
    // reference line. The capped top edge is what says the overshoot was real
    // and something offset it — the accessible name says the same in words.
    expect(rule('.health-weekstrip__fill--offset')).toMatch(/border-top: 2px solid var\(--ds-warning\)/);
    expect(rule('.health-monthblock__fill--offset')).toMatch(/border-top: 2px solid var\(--ds-warning\)/);
  });

  it('renders a gap hollow and a computed day with a real track', () => {
    expect(rule('.health-weekstrip__bar')).toMatch(/background: var\(--ds-surface-alt\)/);
    expect(rule('.health-weekstrip__bar--gap')).toMatch(/background: none/);
    expect(rule('.health-weekstrip__bar--gap')).toMatch(/dashed/);
  });
});

describe('intake-vs-burn stylesheet', () => {
  // The bug this pins: a column that shrink-wraps its bar gives that bar a
  // percentage height against an auto-height parent, which resolves to zero and
  // paints an empty chart. Caught by a real screenshot; jsdom cannot see it, so
  // the compiled rule is what guards it.
  it('stretches each column to full height so a percentage bar height resolves', () => {
    expect(rule('.health-intakeburn__burn, .health-intakeburn__intake')).toMatch(/align-items: stretch/);
    expect(rule('.health-intakeburn__col')).toMatch(/height: 100%/);
  });

  it('hangs intake down from the baseline and stands burn up from it', () => {
    expect(rule('.health-intakeburn__burn .health-intakeburn__col')).toMatch(/align-items: flex-end/);
    expect(rule('.health-intakeburn__intake .health-intakeburn__col')).toMatch(/align-items: flex-start/);
  });

  it('draws a hole as a hollow stub on the baseline, not a filled bar', () => {
    const gap = rule('.health-intakeburn__bar--gap');
    expect(gap).toMatch(/dashed/);
    expect(gap).toMatch(/background: none/);
  });
});

// The template picker's own layout facts (Task 10.4). jsdom renders the
// toggles and reports nothing about their size, so the tap-target rule and the
// non-colour selected cue are asserted against the COMPILED stylesheet.
describe('Template picker stylesheet', () => {
  it('makes a variant toggle a real phone tap target (A2: >= 44px)', () => {
    expect(rule('.health-templates__toggle')).toMatch(/min-height: 44px/);
  });

  it('carries the selected state on the BORDER, not on colour alone (A1)', () => {
    // The glyph swap (+ / ✓) is the primary non-colour cue and lives in the
    // component; the border change is the one the stylesheet owns. A rule that
    // only changed `background` would leave the state colour-only.
    const on = rule('.health-templates__toggle--on');
    expect(on).toMatch(/border-color/);
  });

  it('gives the meal-level suggestion badge a shape of its own, not just a hue', () => {
    const badge = rule('.health-suggest__badge');
    expect(badge).toMatch(/border-radius: 999px/);
    expect(badge).toMatch(/white-space: nowrap/);
  });
});
