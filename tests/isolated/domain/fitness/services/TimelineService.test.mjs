// tests/unit/domains/fitness/services/TimelineService.test.mjs
import {
  decodeSeries,
  encodeSeries,
  decodeSingleSeries,
  encodeSingleSeries,
  encodeToRLE,
  isAllNullSeries
} from '#domains/fitness/services/TimelineService.mjs';

describe('TimelineService', () => {
  describe('isAllNullSeries', () => {
    test('returns true for empty array', () => {
      expect(isAllNullSeries([])).toBe(true);
    });

    test('returns true for all-null array', () => {
      expect(isAllNullSeries([null, null, null])).toBe(true);
    });

    test('returns true for RLE all-null', () => {
      expect(isAllNullSeries([[null, 10]])).toBe(true);
    });

    test('returns false for array with values', () => {
      expect(isAllNullSeries([120, 125, 130])).toBe(false);
    });

    test('returns false for RLE with values', () => {
      expect(isAllNullSeries([[120, 5]])).toBe(false);
    });

    test('returns true for non-array', () => {
      expect(isAllNullSeries(null)).toBe(true);
      expect(isAllNullSeries(undefined)).toBe(true);
    });
  });

  describe('encodeToRLE', () => {
    test('encodes singles as bare values', () => {
      const result = encodeToRLE([120, 125, 130]);
      expect(result).toEqual([120, 125, 130]);
    });

    test('encodes runs as [value, count]', () => {
      const result = encodeToRLE([120, 120, 120, 125]);
      expect(result).toEqual([[120, 3], 125]);
    });

    test('handles null values', () => {
      const result = encodeToRLE([null, null, 120, 120]);
      expect(result).toEqual([[null, 2], [120, 2]]);
    });

    test('handles empty array', () => {
      expect(encodeToRLE([])).toEqual([]);
    });

    test('handles single value', () => {
      expect(encodeToRLE([120])).toEqual([120]);
    });
  });

  describe('decodeSingleSeries', () => {
    test('decodes compact RLE with singles', () => {
      const encoded = [120, 125, 130];
      const result = decodeSingleSeries(encoded);
      expect(result).toEqual([120, 125, 130]);
    });

    test('decodes RLE runs', () => {
      const encoded = [[120, 3], 125];
      const result = decodeSingleSeries(encoded);
      expect(result).toEqual([120, 120, 120, 125]);
    });

    test('decodes classic RLE format', () => {
      const encoded = [[120, 1], [125, 2], [130, 1]];
      const result = decodeSingleSeries(encoded);
      expect(result).toEqual([120, 125, 125, 130]);
    });

    test('handles null runs', () => {
      const encoded = [[null, 3], 120];
      const result = decodeSingleSeries(encoded);
      expect(result).toEqual([null, null, null, 120]);
    });

    test('returns null for all-null series', () => {
      const encoded = [[null, 10]];
      expect(decodeSingleSeries(encoded)).toBeNull();
    });

    test('returns null for a non-array value', () => {
      expect(decodeSingleSeries('invalid')).toBeNull();
    });

    test('passes through non-string values', () => {
      expect(decodeSingleSeries([1, 2, 3])).toEqual([1, 2, 3]);
    });
  });

  describe('encodeSingleSeries', () => {
    test('encodes array to RLE entries', () => {
      const result = encodeSingleSeries([120, 120, 125]);
      expect(result).toEqual([[120, 2], 125]);
    });
  });

  describe('decodeSeries', () => {
    test('decodes object of series', () => {
      const series = {
        John: [[120, 3]],
        Jane: [125, 130]
      };
      const result = decodeSeries(series);
      expect(result.John).toEqual([120, 120, 120]);
      expect(result.Jane).toEqual([125, 130]);
    });

    test('passes through already-decoded arrays', () => {
      const series = { John: [120, 125, 130] };
      const result = decodeSeries(series);
      expect(result.John).toEqual([120, 125, 130]);
    });

    test('skips all-null series', () => {
      const series = {
        John: [[null, 10]],
        Jane: [120, 125]
      };
      const result = decodeSeries(series);
      expect(result.John).toBeUndefined();
      expect(result.Jane).toBeDefined();
    });

    test('handles empty input', () => {
      expect(decodeSeries({})).toEqual({});
      expect(decodeSeries(null)).toEqual({});
    });
  });

  describe('encodeSeries', () => {
    test('encodes object of series', () => {
      const series = {
        John: [120, 120, 125],
        Jane: [130, 130, 130]
      };
      const result = encodeSeries(series);
      expect(result.John).toEqual([[120, 2], 125]);
      expect(result.Jane).toEqual([[130, 3]]);
    });

    test('skips all-null series', () => {
      const series = {
        John: [null, null, null],
        Jane: [120, 125]
      };
      const result = encodeSeries(series);
      expect(result.John).toBeUndefined();
      expect(result.Jane).toBeDefined();
    });

    test('handles empty input', () => {
      expect(encodeSeries({})).toEqual({});
    });
  });

});
