import { describe, it, expect } from 'vitest';
import { bufferAheadOf, pauseForensics } from './pauseForensics.js';

const ranges = (pairs) => ({
  length: pairs.length,
  start: (i) => pairs[i][0],
  end: (i) => pairs[i][1],
});

describe('bufferAheadOf', () => {
  it('reports the runway ahead of the playhead', () => {
    expect(bufferAheadOf(ranges([[0, 60]]), 30)).toBe(30);
  });

  it('picks the range the playhead actually sits in', () => {
    expect(bufferAheadOf(ranges([[0, 10], [100, 160]]), 120)).toBe(40);
  });

  it('returns 0 when the playhead is outside every buffered range', () => {
    expect(bufferAheadOf(ranges([[0, 10]]), 50)).toBe(0);
  });

  it('returns null when the element exposes no ranges', () => {
    expect(bufferAheadOf(null, 5)).toBeNull();
    expect(bufferAheadOf(undefined, 5)).toBeNull();
  });

  it('survives a TimeRanges accessor that throws', () => {
    const hostile = { length: 1, start: () => { throw new Error('detached'); }, end: () => 1 };
    expect(bufferAheadOf(hostile, 0)).toBeNull();
  });
});

describe('pauseForensics', () => {
  const el = {
    readyState: 4,
    networkState: 2,
    currentTime: 76.94,
    buffered: ranges([[0, 105]]),
    playbackRate: 1,
    seeking: false,
    ended: false,
    muted: false,
    volume: 0.8,
    error: null,
  };

  it('captures the signature of the 2026-08-17 mystery pause: healthy and well buffered', () => {
    const doc = { visibilityState: 'visible', hidden: false, hasFocus: () => true };
    const snap = pauseForensics(el, doc);
    expect(snap).toMatchObject({
      readyState: 4,
      bufferAheadSec: 28.06,
      playbackRate: 1,
      visibilityState: 'visible',
      hidden: false,
      hasFocus: true,
      errorCode: null,
    });
  });

  it('surfaces a backgrounded document — the other prime suspect', () => {
    const doc = { visibilityState: 'hidden', hidden: true, hasFocus: () => false };
    expect(pauseForensics(el, doc)).toMatchObject({ visibilityState: 'hidden', hidden: true, hasFocus: false });
  });

  it('surfaces a media error', () => {
    const snap = pauseForensics({ ...el, error: { code: 3, message: 'DECODE' } }, null);
    expect(snap).toMatchObject({ errorCode: 3, errorMessage: 'DECODE' });
  });

  it('emits a flat payload — the log store only indexes data.* one level deep', () => {
    const snap = pauseForensics(el, { visibilityState: 'visible', hidden: false, hasFocus: () => true });
    for (const v of Object.values(snap)) {
      expect(typeof v === 'object' && v !== null).toBe(false);
    }
  });

  it('tolerates a missing element and a missing document', () => {
    expect(pauseForensics(null, null)).toEqual({});
  });

  it('tolerates hasFocus throwing', () => {
    const doc = { visibilityState: 'visible', hidden: false, hasFocus: () => { throw new Error('nope'); } };
    expect(pauseForensics(el, doc).hasFocus).toBeNull();
  });
});
