import { describe, it, expect } from 'vitest';
import { anchorStyle } from './anchorStyle.js';

describe('anchorStyle', () => {
  it('positions top-left with the given offsets', () => {
    expect(anchorStyle({ anchor: 'top-left', offsetX: '3%', offsetY: '4%', scale: 1 }))
      .toEqual({ position: 'absolute', top: '4%', left: '3%' });
  });

  it('positions the opposite edges for bottom-right', () => {
    const s = anchorStyle({ anchor: 'bottom-right', offsetX: '2%', offsetY: '2%', scale: 1 });
    expect(s.bottom).toBe('2%');
    expect(s.right).toBe('2%');
    expect(s.top).toBeUndefined();
    expect(s.left).toBeUndefined();
  });

  it('applies a scale transform anchored to the correct corner', () => {
    const s = anchorStyle({ anchor: 'top-right', offsetX: '2%', offsetY: '2%', scale: 0.5 });
    expect(s.transform).toBe('scale(0.5)');
    expect(s.transformOrigin).toBe('top right');
  });

  it('omits the transform at scale 1 (a no-op that would still cost a paint)', () => {
    const s = anchorStyle({ anchor: 'top-left', offsetX: '2%', offsetY: '2%', scale: 1 });
    expect(s.transform).toBeUndefined();
  });

  it('falls back to top-left for an unrecognised anchor', () => {
    const s = anchorStyle({ anchor: 'nowhere', offsetX: '1%', offsetY: '1%', scale: 1 });
    expect(s.top).toBe('1%');
    expect(s.left).toBe('1%');
  });
});
