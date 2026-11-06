import { describe, it, expect } from 'vitest';
import { box, overlaps, sweepHits } from './geometry.mjs';

describe('box', () => {
  it('is a frozen plain object', () => {
    const b = box(0, 1, 2, 3);
    expect(b).toEqual({ x0: 0, x1: 1, y0: 2, y1: 3 });
    expect(Object.isFrozen(b)).toBe(true);
  });
});

describe('overlaps', () => {
  it('touching edges: open by default, closed on request, per axis', () => {
    expect(overlaps(box(0, 1, 0, 1), box(1, 2, 0, 1))).toBe(false);
    expect(overlaps(box(0, 1, 0, 1), box(1, 2, 0, 1), { x: 'closed' })).toBe(true);
    expect(overlaps(box(0, 1, 0, 1), box(0, 1, 1, 2), { x: 'closed' })).toBe(false);
  });
  it('zero width', () => {
    expect(overlaps(box(0.5, 0.5, 0, 1), box(0, 1, 0, 1), { x: 'closed', y: 'closed' })).toBe(true);
    expect(overlaps(box(0.5, 0.5, 0, 1), box(0, 1, 0, 1), { x: 'open' })).toBe(true);
    expect(overlaps(box(1, 1, 0, 1), box(0, 1, 0, 1), { x: 'open' })).toBe(false);
  });
});

describe('sweepHits', () => {
  it('sweep from inside', () => {
    expect(sweepHits([box(0, 2, 0, 1)], box(1, 3, 0.5, 0.5))).toEqual([{ index: 0, at: 1 }]);
  });
  it('keeps input order and honours include', () => {
    const boxes = [box(5, 6, 0, 1), box(2, 3, 0, 1), box(4, 5, 0, 1)];
    expect(sweepHits(boxes, box(0, 10, 0.5, 0.5), { include: (_, i) => i !== 2 }))
      .toEqual([{ index: 0, at: 5 }, { index: 1, at: 2 }]);
  });
});
