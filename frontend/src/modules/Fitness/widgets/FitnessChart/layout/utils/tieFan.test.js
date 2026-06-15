import { describe, it, expect } from 'vitest';
import { resolveTieFan } from './tieFan.js';

const A = (id, x, y, value) => ({ id, x, y, value, type: 'avatar' });

describe('resolveTieFan', () => {
  it('leaves a non-tied set untouched (offsets 0, labels shown)', () => {
    const out = resolveTieFan([A('kc', 300, 50, 431), A('soren', 100, 200, 42)], { spacing: 64 });
    expect(out.map(a => a.id).sort()).toEqual(['kc', 'soren']);
    expect(out.every(a => (a.offsetX || 0) === 0 && a.labelHidden !== true)).toBe(true);
  });

  it('fans two tied avatars horizontally around their shared endpoint, centered', () => {
    const out = resolveTieFan([A('milo', 300, 50, 382), A('felix', 300, 50, 382)], { spacing: 64 });
    const milo = out.find(a => a.id === 'milo');
    const felix = out.find(a => a.id === 'felix');
    expect([milo.offsetX, felix.offsetX].sort((a, b) => a - b)).toEqual([-32, 32]);
    expect(milo.offsetY).toBe(0);
  });

  it('shows the value label on exactly one tied member', () => {
    const out = resolveTieFan([A('milo', 300, 50, 382), A('felix', 300, 50, 382)], { spacing: 64 });
    expect(out.filter(a => a.labelHidden === true).length).toBe(1);
    expect(out.filter(a => a.labelHidden !== true).length).toBe(1);
  });

  it('groups by approximate endpoint within tolerance', () => {
    const out = resolveTieFan([A('a', 300, 50, 382), A('b', 301, 51, 382)], { spacing: 64, xTol: 3, yTol: 3 });
    expect(out.filter(a => a.labelHidden === true).length).toBe(1);
  });

  it('fans three tied avatars symmetrically (-spacing, 0, +spacing)', () => {
    const out = resolveTieFan([A('a', 300, 50, 9), A('b', 300, 50, 9), A('c', 300, 50, 9)], { spacing: 60 });
    expect(out.map(a => a.offsetX).sort((x, y) => x - y)).toEqual([-60, 0, 60]);
  });
});
