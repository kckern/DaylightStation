import { it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass';

// jsdom has no layout, so the sticky bar and touch targets are checked in the
// compiled stylesheet.
const css = sass.compile(fileURLToPath(new URL('../health.scss', import.meta.url))).css.replace(/\s+/g, ' ');
const rule = selector => css.match(new RegExp(`${selector.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';

it('the bar sticks to the top of the scroll region, directly under the app header', () => {
  const bar = rule('.health-selection-bar');
  expect(bar).toContain('position: sticky');
  expect(bar).toContain('top: -0.75rem'); // browsers stop sticky at the scroller's 0.75rem top padding
  expect(bar).toContain('background: var(--ds-background)');
});
it('the bar keeps one height whatever it holds', () => {
  expect(rule('.health-selection-bar__status')).toContain('white-space: nowrap');
  expect(rule('.health-selection-bar__actions')).toContain('flex-wrap: nowrap');
  expect(rule('.health-selection-bar__actions')).toMatch(/min-height: \S+/);
});
it('fingers get 44 px on the bar and on the checkbox', () => {
  const coarse = css.split('@media (pointer: coarse)').slice(1).join(' ');
  expect(coarse).toMatch(/\.health-selection-bar__actions[^{]*\{[^}]*min-height: 44px/);
  expect(coarse).toMatch(/\.health-move-menu__item[^{]*\{[^}]*min-height: 44px/);
  expect(coarse).toMatch(/\.health-meal-selection-tick \{[^}]*width: 44px; height: 44px/);
});
it('the tick area reaches left only, leaving a dish triangle its whole target', () => {
  const coarse = css.split('@media (pointer: coarse)').slice(1).join(' ');
  const tick = coarse.match(/\.health-meal-selection-tick \{([^}]*)\}/)[1];
  expect(tick).toContain('margin-left: -16px');
  expect(tick).not.toMatch(/margin-(right|inline)/);
});
it('foods being picked keep the row cursor on portions and artwork', () => {
  expect(css).toMatch(/\.health-meal-selection-row :is\(\.health-portion, \.health-numeric-control, \.health-row-artwork\) \{ cursor: inherit; \}/);
});
it('the capture toast wraps at phone width and gives fingers 44 px', () => {
  expect(rule('.health-capture-actions')).toContain('flex-wrap: wrap');
  const coarse = css.split('@media (pointer: coarse)').slice(1).join(' ');
  expect(coarse).toMatch(/\.health-capture-actions \.mantine-Button-root[^{]*\{[^}]*min-height: 44px/);
});
