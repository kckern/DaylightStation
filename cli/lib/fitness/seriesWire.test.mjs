import { describe, it, expect } from 'vitest';
import { decodeStoredSeries, encodeStoredSeries } from './seriesWire.mjs';

// Regression: heal/merge/split passed stored JSON STRINGS straight into
// TimelineService.decodeSeries, which only handles semantic arrays. The string
// fell through unparsed and the callers indexed into it character by character,
// so `heal --apply` rewrote a 400-tick heart-rate series as a 1933-element
// array of "[", "n", "u", "l", … over the top of the real session.

describe('decodeStoredSeries', () => {
  it('parses the stored JSON-string RLE form into value arrays', () => {
    const decoded = decodeStoredSeries({ 'grannie:hr': '[[116,2],75,76]' });
    expect(decoded['grannie:hr']).toEqual([116, 116, 75, 76]);
  });

  it('never yields characters from a stored string', () => {
    const decoded = decodeStoredSeries({ 'a:hr': '[[90,3]]' });
    expect(decoded['a:hr']).toEqual([90, 90, 90]);
    expect(decoded['a:hr'].some(v => typeof v === 'string')).toBe(false);
  });

  it('passes an already-decoded array through unchanged', () => {
    const decoded = decodeStoredSeries({ 'a:hr': [[116, 2], 75] });
    expect(decoded['a:hr']).toEqual([116, 116, 75]);
  });

  it('drops a string that is not parseable RLE rather than guessing', () => {
    expect(decodeStoredSeries({ 'a:hr': 'not json' })).toEqual({});
    expect(decodeStoredSeries({ 'a:hr': '{"not":"an array"}' })).toEqual({});
  });

  it('preserves nulls inside a run', () => {
    expect(decodeStoredSeries({ 'a:hr': '[90,[null,3]]' })['a:hr']).toEqual([90, null, null, null]);
  });

  it('survives absent input', () => {
    expect(decodeStoredSeries()).toEqual({});
    expect(decodeStoredSeries({})).toEqual({});
  });
});

describe('encodeStoredSeries', () => {
  it('emits the JSON-string form the app reads back', () => {
    const encoded = encodeStoredSeries({ 'a:hr': [116, 116, 75, 76] });
    expect(typeof encoded['a:hr']).toBe('string');
    expect(encoded['a:hr']).toBe('[[116,2],75,76]');
  });

  it('drops all-null and empty series, as the domain codec does', () => {
    expect(encodeStoredSeries({ 'a:hr': [null, null], 'b:hr': [] })).toEqual({});
  });
});

describe('round trip', () => {
  it('returns the identical stored string for a real-shaped series', () => {
    const stored = { 'device:90001:heart-rate': '[[90,2],101,[108,2],109,[null,15]]' };
    expect(encodeStoredSeries(decodeStoredSeries(stored))).toEqual(stored);
  });

  it('is stable across repeated passes — surgery commands run more than once', () => {
    const stored = { 'a:coins': '[[0,2],[1,644]]' };
    const once = encodeStoredSeries(decodeStoredSeries(stored));
    expect(encodeStoredSeries(decodeStoredSeries(once))).toEqual(once);
  });
});
