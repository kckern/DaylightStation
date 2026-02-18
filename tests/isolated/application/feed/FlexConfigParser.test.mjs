import { FlexConfigParser } from '#apps/feed/services/FlexConfigParser.mjs';

describe('FlexConfigParser', () => {
  describe('parseFlexNode', () => {
    test('parses shorthand string "2 0 5"', () => {
      const result = FlexConfigParser.parseFlexNode({ flex: '2 0 5' }, 50);
      expect(result).toEqual({ grow: 2, shrink: 0, basis: 5 / 50, min: 0, max: Infinity });
    });

    test('parses shorthand string "1 1 auto"', () => {
      const result = FlexConfigParser.parseFlexNode({ flex: '1 1 auto' }, 50);
      expect(result).toEqual({ grow: 1, shrink: 1, basis: 'auto', min: 0, max: Infinity });
    });

    test('parses single number flex: 2 as grow only', () => {
      const result = FlexConfigParser.parseFlexNode({ flex: 2 }, 50);
      expect(result).toEqual({ grow: 2, shrink: 1, basis: 0, min: 0, max: Infinity });
    });

    test('parses explicit keys', () => {
      const result = FlexConfigParser.parseFlexNode({ grow: 3, shrink: 0, basis: 10 }, 50);
      expect(result).toEqual({ grow: 3, shrink: 0, basis: 10 / 50, min: 0, max: Infinity });
    });

    test('explicit keys override shorthand', () => {
      const result = FlexConfigParser.parseFlexNode({ flex: '1 1 auto', grow: 5 }, 50);
      expect(result.grow).toBe(5);
    });

    test('parses "filler" alias', () => {
      const result = FlexConfigParser.parseFlexNode({ flex: 'filler' }, 50);
      expect(result).toEqual({ grow: 1, shrink: 1, basis: 0, min: 0, max: Infinity });
    });

    test('parses "fixed" alias', () => {
      const result = FlexConfigParser.parseFlexNode({ flex: 'fixed' }, 50);
      expect(result).toEqual({ grow: 0, shrink: 0, basis: 'auto', min: 0, max: Infinity });
    });

    test('parses "none" alias', () => {
      const result = FlexConfigParser.parseFlexNode({ flex: 'none' }, 50);
      expect(result).toEqual({ grow: 0, shrink: 0, basis: 'auto', min: 0, max: Infinity });
    });

    test('parses "dominant" alias', () => {
      const result = FlexConfigParser.parseFlexNode({ flex: 'dominant' }, 50);
      expect(result).toEqual({ grow: 2, shrink: 0, basis: 'auto', min: 0, max: Infinity });
    });

    test('parses "padding" alias', () => {
      const result = FlexConfigParser.parseFlexNode({ flex: 'padding' }, 50);
      expect(result).toEqual({ grow: 1, shrink: 0, basis: 0, min: 0, max: Infinity });
    });

    test('parses "auto" alias', () => {
      const result = FlexConfigParser.parseFlexNode({ flex: 'auto' }, 50);
      expect(result).toEqual({ grow: 1, shrink: 1, basis: 'auto', min: 0, max: Infinity });
    });

    test('min and max are kept as absolute item counts', () => {
      const result = FlexConfigParser.parseFlexNode({ flex: 'auto', min: 20, max: 40 }, 50);
      expect(result.min).toBe(20);
      expect(result.max).toBe(40);
    });

    test('uses defaults when no flex properties present', () => {
      const result = FlexConfigParser.parseFlexNode({}, 50);
      expect(result).toEqual({ grow: 0, shrink: 1, basis: 'auto', min: 0, max: Infinity });
    });
  });

  describe('legacy key migration', () => {
    test('maps allocation to basis', () => {
      const result = FlexConfigParser.parseFlexNode({ allocation: 6 }, 50);
      expect(result.basis).toBe(6 / 50);
    });

    test('maps max_per_batch to max', () => {
      const result = FlexConfigParser.parseFlexNode({ max_per_batch: 11 }, 50);
      expect(result.max).toBe(11);
    });

    test('maps min_per_batch to min', () => {
      const result = FlexConfigParser.parseFlexNode({ min_per_batch: 3 }, 50);
      expect(result.min).toBe(3);
    });

    test('maps role: filler to filler alias', () => {
      const result = FlexConfigParser.parseFlexNode({ role: 'filler' }, 50);
      expect(result.grow).toBe(1);
      expect(result.shrink).toBe(1);
      expect(result.basis).toBe(0);
    });

    test('maps padding: true to padding alias', () => {
      const result = FlexConfigParser.parseFlexNode({ padding: true }, 50);
      expect(result.grow).toBe(1);
      expect(result.shrink).toBe(0);
      expect(result.basis).toBe(0);
    });

    test('flex keys take precedence over legacy', () => {
      const result = FlexConfigParser.parseFlexNode(
        { allocation: 6, flex: 'dominant' }, 50
      );
      expect(result.grow).toBe(2);
      expect(result.basis).toBe('auto');
    });
  });

  describe('basis normalization', () => {
    test('float 0.0-1.0 stays as proportion', () => {
      const result = FlexConfigParser.parseFlexNode({ basis: 0.5 }, 50);
      expect(result.basis).toBe(0.5);
    });

    test('integer > 1 normalized to proportion', () => {
      const result = FlexConfigParser.parseFlexNode({ basis: 10 }, 50);
      expect(result.basis).toBe(10 / 50);
    });

    test('"auto" stays as "auto"', () => {
      const result = FlexConfigParser.parseFlexNode({ basis: 'auto' }, 50);
      expect(result.basis).toBe('auto');
    });

    test('0 stays as 0', () => {
      const result = FlexConfigParser.parseFlexNode({ basis: 0 }, 50);
      expect(result.basis).toBe(0);
    });
  });
});
