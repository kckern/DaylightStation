import { FlexAllocator } from '#apps/feed/services/FlexAllocator.mjs';

describe('FlexAllocator', () => {
  describe('distribute', () => {
    test('distributes equally when all children have grow:1 and basis:0', () => {
      const children = [
        { key: 'a', grow: 1, shrink: 1, basis: 0, min: 0, max: Infinity, available: 100 },
        { key: 'b', grow: 1, shrink: 1, basis: 0, min: 0, max: Infinity, available: 100 },
      ];
      const result = FlexAllocator.distribute(10, children);
      expect(result.get('a')).toBe(5);
      expect(result.get('b')).toBe(5);
    });

    test('respects basis allocation before grow', () => {
      const children = [
        { key: 'a', grow: 1, shrink: 1, basis: 0.6, min: 0, max: Infinity, available: 100 },
        { key: 'b', grow: 1, shrink: 1, basis: 0.2, min: 0, max: Infinity, available: 100 },
      ];
      // basis: a=0.6*50=30, b=0.2*50=10 → sum=40 → 10 free → split 5/5 → a=35, b=15
      const result = FlexAllocator.distribute(50, children);
      expect(result.get('a')).toBe(35);
      expect(result.get('b')).toBe(15);
    });

    test('grow:0 children do not receive free space', () => {
      const children = [
        { key: 'fixed', grow: 0, shrink: 0, basis: 0.2, min: 0, max: Infinity, available: 100 },
        { key: 'flex',  grow: 1, shrink: 1, basis: 0,   min: 0, max: Infinity, available: 100 },
      ];
      const result = FlexAllocator.distribute(50, children);
      expect(result.get('fixed')).toBe(10);  // 0.2 * 50 = 10
      expect(result.get('flex')).toBe(40);   // gets all free space
    });

    test('shrinks proportionally on overflow', () => {
      const children = [
        { key: 'a', grow: 0, shrink: 1, basis: 0.6, min: 0, max: Infinity, available: 100 },
        { key: 'b', grow: 0, shrink: 1, basis: 0.6, min: 0, max: Infinity, available: 100 },
      ];
      // basis: a=0.6*50=30, b=0.6*50=30 → sum=60 → overflow=10
      // weighted: a=1*30=30, b=1*30=30 → total=60
      // a_reduction = 10*30/60=5, b_reduction=5 → a=25, b=25
      const result = FlexAllocator.distribute(50, children);
      expect(result.get('a')).toBe(25);
      expect(result.get('b')).toBe(25);
    });

    test('clamps to min and max', () => {
      const children = [
        { key: 'a', grow: 1, shrink: 1, basis: 0, min: 8, max: Infinity, available: 100 },
        { key: 'b', grow: 1, shrink: 1, basis: 0, min: 0, max: 3,       available: 100 },
      ];
      // Without clamp: a=5, b=5. b clamped to 3, freed 2 goes to a → a=7, but min 8 → a=8
      const result = FlexAllocator.distribute(10, children);
      expect(result.get('a')).toBeGreaterThanOrEqual(8);
      expect(result.get('b')).toBeLessThanOrEqual(3);
    });

    test('clamps to available items', () => {
      const children = [
        { key: 'a', grow: 1, shrink: 0, basis: 0, min: 0, max: Infinity, available: 3 },
        { key: 'b', grow: 1, shrink: 0, basis: 0, min: 0, max: Infinity, available: 100 },
      ];
      const result = FlexAllocator.distribute(20, children);
      expect(result.get('a')).toBe(3);      // clamped to available
      expect(result.get('b')).toBe(17);     // gets remainder
    });

    test('implicit floor: children with available > 0 get at least 1', () => {
      const children = [
        { key: 'big',   grow: 10, shrink: 0, basis: 0, min: 0, max: Infinity, available: 100 },
        { key: 'small', grow: 0,  shrink: 0, basis: 0, min: 0, max: Infinity, available: 5 },
      ];
      const result = FlexAllocator.distribute(10, children);
      expect(result.get('small')).toBeGreaterThanOrEqual(1);
    });

    test('children with available: 0 get 0 slots', () => {
      const children = [
        { key: 'a', grow: 1, shrink: 0, basis: 0, min: 0, max: Infinity, available: 0 },
        { key: 'b', grow: 1, shrink: 0, basis: 0, min: 0, max: Infinity, available: 50 },
      ];
      const result = FlexAllocator.distribute(10, children);
      expect(result.get('a')).toBe(0);
      expect(result.get('b')).toBe(10);
    });

    test('rounds to integers and distributes remainder to highest-grow', () => {
      const children = [
        { key: 'a', grow: 2, shrink: 0, basis: 0, min: 0, max: Infinity, available: 100 },
        { key: 'b', grow: 1, shrink: 0, basis: 0, min: 0, max: Infinity, available: 100 },
      ];
      const result = FlexAllocator.distribute(10, children);
      expect(result.get('a') + result.get('b')).toBe(10);
      expect(result.get('a')).toBeGreaterThan(result.get('b'));
    });

    test('auto basis uses min of available and containerSize', () => {
      const children = [
        { key: 'a', grow: 0, shrink: 1, basis: 'auto', min: 0, max: Infinity, available: 3 },
        { key: 'b', grow: 1, shrink: 1, basis: 0,      min: 0, max: Infinity, available: 100 },
      ];
      const result = FlexAllocator.distribute(10, children);
      expect(result.get('a')).toBe(3);  // auto → min(3, 10) = 3
      expect(result.get('b')).toBe(7);
    });

    test('empty children returns empty map', () => {
      const result = FlexAllocator.distribute(10, []);
      expect(result.size).toBe(0);
    });

    test('single child gets full container (clamped to available)', () => {
      const children = [
        { key: 'only', grow: 1, shrink: 0, basis: 0, min: 0, max: Infinity, available: 100 },
      ];
      const result = FlexAllocator.distribute(10, children);
      expect(result.get('only')).toBe(10);
    });

    test('dominant alias pattern: grow:2 gets double the share of grow:1', () => {
      const children = [
        { key: 'dominant', grow: 2, shrink: 0, basis: 0, min: 0, max: Infinity, available: 100 },
        { key: 'normal',   grow: 1, shrink: 0, basis: 0, min: 0, max: Infinity, available: 100 },
        { key: 'normal2',  grow: 1, shrink: 0, basis: 0, min: 0, max: Infinity, available: 100 },
      ];
      const result = FlexAllocator.distribute(40, children);
      expect(result.get('dominant')).toBe(20);
      expect(result.get('normal')).toBe(10);
      expect(result.get('normal2')).toBe(10);
    });
  });
});
