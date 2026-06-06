import { describe, it, expect } from 'vitest';
import { LINE_COLORS } from './lineColors.js';

const FORBIDDEN = ['#6ab8ff', '#51cf66', '#ffd43b', '#ff922b', '#ff6b6b', '#21e6ff', '#ff2d95'];

describe('LINE_COLORS (synthwave rider palette)', () => {
  it('has at least 6 distinct colors', () => {
    expect(LINE_COLORS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(LINE_COLORS.map((c) => c.toLowerCase())).size).toBe(LINE_COLORS.length);
  });
  it('does not reuse any HR-zone or reserved-chrome color', () => {
    const lc = LINE_COLORS.map((c) => c.toLowerCase());
    FORBIDDEN.forEach((f) => expect(lc).not.toContain(f.toLowerCase()));
  });
});
