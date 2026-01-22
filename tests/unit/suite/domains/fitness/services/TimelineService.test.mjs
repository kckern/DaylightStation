// tests/unit/domains/fitness/services/TimelineService.test.mjs
import {
  decodeSeries,
  encodeSeries,
  decodeSingleSeries,
  encodeSingleSeries,
  encodeToRLE,
  isAllNullSeries,
  parseToUnixMs,
  formatTimestamp,
  prepareTimelineForApi,
  prepareTimelineForStorage
} from '#backend/src/1_domains/fitness/services/TimelineService.mjs';

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
      const encoded = JSON.stringify([120, 125, 130]);
      const result = decodeSingleSeries(encoded);
      expect(result).toEqual([120, 125, 130]);
    });

    test('decodes RLE runs', () => {
      const encoded = JSON.stringify([[120, 3], 125]);
      const result = decodeSingleSeries(encoded);
      expect(result).toEqual([120, 120, 120, 125]);
    });

    test('decodes classic RLE format', () => {
      const encoded = JSON.stringify([[120, 1], [125, 2], [130, 1]]);
      const result = decodeSingleSeries(encoded);
      expect(result).toEqual([120, 125, 125, 130]);
    });

    test('handles null runs', () => {
      const encoded = JSON.stringify([[null, 3], 120]);
      const result = decodeSingleSeries(encoded);
      expect(result).toEqual([null, null, null, 120]);
    });

    test('returns null for all-null series', () => {
      const encoded = JSON.stringify([[null, 10]]);
      expect(decodeSingleSeries(encoded)).toBeNull();
    });

    test('returns null for invalid JSON', () => {
      expect(decodeSingleSeries('invalid')).toBeNull();
    });

    test('passes through non-string values', () => {
      expect(decodeSingleSeries([1, 2, 3])).toEqual([1, 2, 3]);
    });
  });

  describe('encodeSingleSeries', () => {
    test('encodes array to JSON RLE', () => {
      const result = encodeSingleSeries([120, 120, 125]);
      expect(JSON.parse(result)).toEqual([[120, 2], 125]);
    });
  });

  describe('decodeSeries', () => {
    test('decodes object of series', () => {
      const series = {
        John: JSON.stringify([[120, 3]]),
        Jane: JSON.stringify([125, 130])
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
        John: JSON.stringify([[null, 10]]),
        Jane: JSON.stringify([120, 125])
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
      expect(JSON.parse(result.John)).toEqual([[120, 2], 125]);
      expect(JSON.parse(result.Jane)).toEqual([[130, 3]]);
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

  describe('parseToUnixMs', () => {
    test('passes through numbers', () => {
      expect(parseToUnixMs(1736596800000)).toBe(1736596800000);
    });

    test('parses numeric strings', () => {
      expect(parseToUnixMs('1736596800000')).toBe(1736596800000);
    });

    test('parses ISO date strings', () => {
      const result = parseToUnixMs('2026-01-11T12:00:00.000Z');
      expect(result).toBe(new Date('2026-01-11T12:00:00.000Z').getTime());
    });

    test('returns null for non-parseable input', () => {
      expect(parseToUnixMs('invalid-date')).toBeNull();
      expect(parseToUnixMs({})).toBeNull();
    });

    test('handles null/undefined as 0', () => {
      // Number(null) = 0, Number(undefined) = NaN
      expect(parseToUnixMs(null)).toBe(0);
      expect(parseToUnixMs(undefined)).toBeNull();
    });
  });

  describe('formatTimestamp', () => {
    test('formats ms to ISO string', () => {
      // Use a known timestamp
      const ts = new Date('2026-01-11T12:00:00.000Z').getTime();
      const result = formatTimestamp(ts);
      expect(result).toBe('2026-01-11T12:00:00.000Z');
    });

    test('returns null for invalid input', () => {
      expect(formatTimestamp(null)).toBeNull();
      expect(formatTimestamp(NaN)).toBeNull();
    });
  });

  describe('prepareTimelineForApi', () => {
    test('decodes series and parses event timestamps', () => {
      const timeline = {
        series: { John: JSON.stringify([[120, 3]]) },
        events: [{ timestamp: '2026-01-11T12:00:00.000Z', type: 'start' }]
      };
      const result = prepareTimelineForApi(timeline);
      expect(result.series.John).toEqual([120, 120, 120]);
      expect(result.events[0].timestamp).toBe(new Date('2026-01-11T12:00:00.000Z').getTime());
    });

    test('handles empty timeline', () => {
      expect(prepareTimelineForApi(null)).toEqual({ series: {}, events: [] });
      expect(prepareTimelineForApi({})).toEqual({ series: {}, events: [] });
    });
  });

  describe('prepareTimelineForStorage', () => {
    test('encodes series for storage', () => {
      const timeline = {
        series: { John: [120, 120, 125] },
        events: [{ type: 'start' }]
      };
      const result = prepareTimelineForStorage(timeline);
      expect(JSON.parse(result.series.John)).toEqual([[120, 2], 125]);
      expect(result.events).toEqual([{ type: 'start' }]);
    });

    test('handles empty timeline', () => {
      expect(prepareTimelineForStorage(null)).toEqual({ series: {}, events: [] });
    });
  });
});
