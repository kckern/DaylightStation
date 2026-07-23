import { describe, it, expect } from 'vitest';
import { layoutOwnsRouting } from './ScreenRenderer.jsx';

describe('layoutOwnsRouting', () => {
  it('is true when the layout is a single routing-owner widget (the Portal/school)', () => {
    expect(layoutOwnsRouting([{ widget: 'school' }])).toBe(true);
  });

  it('finds a routing-owner nested in a layout tree', () => {
    expect(layoutOwnsRouting({ rows: [{ columns: [{ widget: 'school' }] }] })).toBe(true);
  });

  it('is false for a menu/other-widget layout (path suffix stays a menu navigation)', () => {
    expect(layoutOwnsRouting([{ widget: 'menu' }])).toBe(false);
    expect(layoutOwnsRouting([{ widget: 'clock' }, { widget: 'weather' }])).toBe(false);
  });

  it('is false/empty-safe for missing or empty layouts', () => {
    expect(layoutOwnsRouting(null)).toBe(false);
    expect(layoutOwnsRouting(undefined)).toBe(false);
    expect(layoutOwnsRouting([])).toBe(false);
    expect(layoutOwnsRouting({})).toBe(false);
  });
});
