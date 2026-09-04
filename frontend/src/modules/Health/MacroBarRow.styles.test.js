import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass';

// jsdom cannot see layout OR resolve a stylesheet, so the colour decisions the
// bars depend on are verified against the COMPILED stylesheet instead of a
// vacuous class-name assertion. If a modifier stops painting its token — or the
// coverage caption is ever given `display: none` to tidy the row — this fails.

const css = sass.compile(
  fileURLToPath(new URL('./health.scss', import.meta.url)),
).css.replace(/\s+/g, ' ');

const rule = (selector) => css.match(
  new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`),
)?.[1] ?? '';

describe('macro bar stylesheet', () => {
  it('paints an over-GOAL macro with the warning token', () => {
    expect(rule('.health-macrobar__item--over-goal .health-macrobar__fill')).toContain('var(--ds-warning)');
  });

  it('paints an over-LIMIT watch micro with the danger token, fill and value alike', () => {
    expect(rule('.health-macrobar__item--over-limit .health-macrobar__fill')).toContain('var(--ds-danger)');
    expect(rule('.health-macrobar__item--over-limit .health-macrobar__value')).toContain('var(--ds-danger)');
  });

  it('paints a reached floor micro with the success token', () => {
    expect(rule('.health-macrobar__item--reached .health-macrobar__fill')).toContain('var(--ds-success)');
  });

  it('gives the bar a real track height rather than a zero-height sliver', () => {
    expect(rule('.health-macrobar__track')).toMatch(/height: 8px/);
  });

  it('keeps the coverage caption visible — it is the honesty mechanism, never display:none', () => {
    const caption = rule('.health-macrobar__caption');
    expect(caption).toBeTruthy();
    expect(caption).not.toMatch(/display: *none/);
    expect(caption).toContain('var(--ds-text-low)');
  });

  it('gives the per-meal macro subtotal its own line, not a slot in the crowded header-right', () => {
    expect(rule('.health-meal__macros')).toBeTruthy();
    expect(rule('.health-meal__header-right')).toContain('flex-wrap: wrap');
  });
});
