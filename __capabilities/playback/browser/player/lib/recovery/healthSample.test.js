import { describe, expect, it } from 'vitest';
import { contiguousRunwayMs, normalizeHealthSample } from './healthSample.js';

const observation = (overrides = {}) => ({
  currentTime: 4, playbackRate: 1, ranges: [[0, 10]],
  intended: 'play', phase: 'playing', visible: true, ...overrides
});

describe('contiguousRunwayMs', () => {
  it('does not bridge a known gap to a later buffered range', () => {
    expect(contiguousRunwayMs({ ranges: [[0, 10], [20, 30]], currentTime: 15, playbackRate: 1 })).toBe(0);
  });

  it('converts playable media time to wall time at the current rate', () => {
    expect(contiguousRunwayMs({ ranges: [[0, 10]], currentTime: 4, playbackRate: 2 })).toBe(3000);
  });

  it.each([
    [{ ranges: [], currentTime: 0, playbackRate: 1 }, 0],
    [{ ranges: [[0, 10]], currentTime: 10, playbackRate: 1 }, 0],
    [{ ranges: null, currentTime: 4, playbackRate: 1 }, null],
    [{ ranges: [[0, NaN]], currentTime: 4, playbackRate: 1 }, null],
    [{ ranges: [[10, 0]], currentTime: 4, playbackRate: 1 }, null],
    [{ ranges: [[0, 10]], currentTime: NaN, playbackRate: 1 }, null],
    [{ ranges: [[0, 10]], currentTime: 4, playbackRate: 0 }, null],
  ])('preserves unknown observations instead of inventing runway: %j', (input, expected) => {
    expect(contiguousRunwayMs(input)).toBe(expected);
  });
});

describe('normalizeHealthSample', () => {
  it('keeps absent presentation APIs unknown even while decoded counters increase', () => {
    const previous = normalizeHealthSample(observation({ totalFrames: 10, droppedFrames: 1 }), null, 0);
    const sampleWithoutPresentation = normalizeHealthSample(observation({ currentTime: 4.5, totalFrames: 20, droppedFrames: 1 }), previous, 500);
    expect(sampleWithoutPresentation.presentationAdvancing).toBeNull();
    expect(sampleWithoutPresentation.clockAdvancing).toBe(true);
    expect(sampleWithoutPresentation.droppedFrameRatio).toBe(0);
  });

  it('does not mistake decoded-but-dropped frames for submitted frames', () => {
    const previous = normalizeHealthSample(observation({ presentedFrames: 5, totalFrames: 10, droppedFrames: 0 }), null, 0);
    const sample = normalizeHealthSample(observation({ currentTime: 4.5, presentedFrames: 5, totalFrames: 20, droppedFrames: 10 }), previous, 500);
    expect(sample.presentationAdvancing).toBe(false);
    expect(sample.clockAdvancing).toBe(true);
    expect(sample.droppedFrameRatio).toBe(1);
  });

  it('measures presentation separately from the native clock', () => {
    const previous = normalizeHealthSample(observation({ presentedFrames: 5 }), null, 0);
    const sample = normalizeHealthSample(observation({ presentedFrames: 6 }), previous, 500);
    expect(sample.presentationAdvancing).toBe(true);
    expect(sample.clockAdvancing).toBe(false);
  });

  it('invalidates long scheduling gaps then requires a new observed interval', () => {
    const previous = normalizeHealthSample(observation({ presentedFrames: 5 }), null, 0);
    const sampleAfterLongSchedulingGap = normalizeHealthSample(observation({ currentTime: 8, presentedFrames: 50 }), previous, 5000);
    expect(sampleAfterLongSchedulingGap.fresh).toBe(false);
    expect(sampleAfterLongSchedulingGap.clockAdvancing).toBeNull();
    expect(sampleAfterLongSchedulingGap.presentationAdvancing).toBeNull();
    const resumed = normalizeHealthSample(observation({ currentTime: 8.5, presentedFrames: 60 }), sampleAfterLongSchedulingGap, 5500);
    expect(resumed.fresh).toBe(true);
    expect(resumed.presentationAdvancing).toBe(true);
  });

  it('expires observations at two seconds rather than reusing stale progress', () => {
    const sample = normalizeHealthSample(observation({ atMs: 500 }), null, 2500);
    expect(sample.fresh).toBe(false);
    expect(sample.clockAdvancing).toBeNull();
  });

  it('marks hidden intervals and the first visible interval unknown', () => {
    const previous = normalizeHealthSample(observation(), null, 0);
    const hidden = normalizeHealthSample(observation({ visible: false, currentTime: 5 }), previous, 500);
    expect(hidden).toMatchObject({ fresh: false, clockAdvancing: null, presentationAdvancing: null });
    const visible = normalizeHealthSample(observation({ currentTime: 6 }), hidden, 1000);
    expect(visible).toMatchObject({ fresh: false, clockAdvancing: null });
    expect(normalizeHealthSample(observation({ currentTime: 6.5 }), visible, 1500)).toMatchObject({ fresh: true, clockAdvancing: true });
  });

  it('rejects comparisons across renderer targets and counter resets', () => {
    const target = { ownerId: 'a', visitId: 'v', intentRevision: 1, rendererGeneration: 1 };
    const previous = normalizeHealthSample(observation({ target, presentedFrames: 10, totalFrames: 10, droppedFrames: 3 }), null, 0);
    const sample = normalizeHealthSample(observation({ target: { ...target, rendererGeneration: 2 }, currentTime: 5, presentedFrames: 1, totalFrames: 1, droppedFrames: 0 }), previous, 500);
    expect(sample).toMatchObject({ fresh: false, clockAdvancing: null, presentationAdvancing: null, droppedFrameRatio: null });
  });

  it('rejects an incomplete supplied target instead of comparing missing identity fields', () => {
    const sample = normalizeHealthSample(observation({ target: { ownerId: 'a', visitId: 'v' } }), null, 500);
    expect(sample.fresh).toBe(false);
    expect(sample.clockAdvancing).toBeNull();
  });

  it('does not count seek, pause or stopped clock changes as playing progress', () => {
    const previous = normalizeHealthSample(observation({ presentedFrames: 10 }), null, 0);
    for (const overrides of [{ phase: 'seeking' }, { intended: 'pause' }, { intended: 'stop' }]) {
      expect(normalizeHealthSample(observation({ ...overrides, currentTime: 8, presentedFrames: 20 }), previous, 500))
        .toMatchObject({ clockAdvancing: null, presentationAdvancing: null });
    }
  });
});
