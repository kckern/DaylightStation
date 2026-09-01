import { describe, it, expect } from 'vitest';
import { computeVideoFpsSample, SEEK_SLACK_SECONDS } from './videoFpsSample.js';

// 2026-09-01 17:01:55: video had played 18.2s of a 30s sampling window.
// 18.2/30 × 23.976 = 14.5 "fps" → a false video_fps_degraded warning.
describe('computeVideoFpsSample', () => {
  const prev = { totalFrames: 0, droppedFrames: 0, currentTime: 0, timestamp: 0 };

  it('divides by playing time, so a mid-window start reads the true rate', () => {
    const s = computeVideoFpsSample(prev, { totalFrames: 436, droppedFrames: 0, currentTime: 18.2, timestamp: 30000 });
    // 436/18.2 = 23.956…, reported to 1dp. Asserted exactly: toBeCloseTo would
    // accept the unrounded value and leave the rounding undefended.
    expect(s.fps).toBe(24);
    expect(s.dropRate).toBe(0);
  });
  it('returns null fps when less than a second of media played', () => {
    const s = computeVideoFpsSample(prev, { totalFrames: 10, droppedFrames: 0, currentTime: 0.4, timestamp: 30000 });
    expect(s.fps).toBeNull();
  });
  it('returns null fps and resets when the frame counter went backwards (element reset)', () => {
    const s = computeVideoFpsSample({ ...prev, totalFrames: 500 }, { totalFrames: 20, droppedFrames: 0, currentTime: 1, timestamp: 30000 });
    expect(s.fps).toBeNull();
    expect(s.reset).toBe(true);
    // A reset is "no reading at all", not "no drops": a 0 here would log as a
    // clean window on the one sample where the element just died.
    expect(s.dropRate).toBeNull();
  });
  it('dropRate is dropped ÷ total over the window, in percent', () => {
    const s = computeVideoFpsSample(prev, { totalFrames: 200, droppedFrames: 10, currentTime: 10, timestamp: 10000 });
    expect(s.dropRate).toBe(5);
  });
  it('null fps on the first sample (no previous)', () => {
    expect(computeVideoFpsSample(null, { totalFrames: 5, droppedFrames: 0, currentTime: 1, timestamp: 1 }).fps).toBeNull();
  });

  // --- rounding is part of the contract: these payloads go to the log store ---

  it('rounds fps to one decimal', () => {
    // 100/3 = 33.3333…  Unrounded this is 33.33333333333333 and fails.
    const s = computeVideoFpsSample(prev, { totalFrames: 100, droppedFrames: 0, currentTime: 3, timestamp: 3000 });
    expect(s.fps).toBe(33.3);
  });
  it('rounds dropRate to one decimal', () => {
    // 7/300 = 2.3333…%  Unrounded this is 2.3333333333333335 and fails.
    const s = computeVideoFpsSample(prev, { totalFrames: 300, droppedFrames: 7, currentTime: 10, timestamp: 10000 });
    expect(s.dropRate).toBe(2.3);
  });

  // dropRate must describe THIS window. Cumulative totals would drift toward a
  // lifetime average and stop responding to a burst of drops.
  it('dropRate uses the window delta, not the cumulative totals', () => {
    const withHistory = { totalFrames: 1000, droppedFrames: 100, currentTime: 40, timestamp: 40000 };
    const s = computeVideoFpsSample(withHistory, { totalFrames: 1200, droppedFrames: 110, currentTime: 50, timestamp: 50000 });
    expect(s.dropRate).toBe(5);       // window: 10/200
    expect(s.dropRate).not.toBe(9.2); // cumulative: 110/1200
  });

  // --- pause and seek: media time is the right denominator only for playback ---

  // A paused video advances wall clock but not currentTime. The old wall-clock
  // arithmetic reported ~0 fps here; media time reports "no measurement".
  it('reports no fps for a video that was paused across the whole window', () => {
    const s = computeVideoFpsSample(prev, { totalFrames: 0, droppedFrames: 0, currentTime: 0, timestamp: 30000 });
    expect(s.fps).toBeNull();
    expect(s.reset).toBe(false);
  });

  // The regression media-time arithmetic introduces, and the reason `timestamp`
  // is carried in the tuple. useSeekState.js:195 writes media.currentTime
  // directly, so a forward skip advances media time with no frames to match:
  // 720 frames across a 60s jump reads 12 fps and trips the fps < 20 gate.
  it('reports no fps for a forward seek instead of a fabricated low rate', () => {
    const s = computeVideoFpsSample(prev, { totalFrames: 720, droppedFrames: 0, currentTime: 60, timestamp: 30000 });
    expect(s.fps).toBeNull();
    expect(s.seeked).toBe(true);
  });
  it('does not mistake ordinary playback for a seek', () => {
    const s = computeVideoFpsSample(prev, { totalFrames: 720, droppedFrames: 0, currentTime: 30, timestamp: 30000 });
    expect(s.fps).toBe(24);
    expect(s.seeked).toBe(false);
  });

  // Player.jsx cycles playbackRate (nextPlaybackRate → VideoPlayer). At 2x,
  // media time legitimately advances at twice wall clock; a bare wall-clock
  // guard would call every fast-forward sample a seek and blind the profiler.
  it('allows media time to outrun wall clock in proportion to playbackRate', () => {
    const base = { ...prev, playbackRate: 2 };
    const s = computeVideoFpsSample(base, { totalFrames: 1440, droppedFrames: 0, currentTime: 60, timestamp: 30000, playbackRate: 2 });
    expect(s.seeked).toBe(false);
    expect(s.fps).toBe(24);
  });
  it('still catches a seek that happens while playing fast', () => {
    const base = { ...prev, playbackRate: 2 };
    const s = computeVideoFpsSample(base, { totalFrames: 1440, droppedFrames: 0, currentTime: 120, timestamp: 30000, playbackRate: 2 });
    expect(s.seeked).toBe(true);
    expect(s.fps).toBeNull();
  });

  // The slack has to be small enough that no seek able to move fps across the
  // warning gate slips through. Crossing it in a 30s window needs >6s.
  it('the seek slack is far below the smallest seek that could trip the gate', () => {
    expect(SEEK_SLACK_SECONDS).toBeLessThan(6);
    expect(SEEK_SLACK_SECONDS).toBeGreaterThan(0);
  });

  // 20 is the video_fps_degraded threshold in FitnessApp.jsx. Genuinely slow
  // playback must still trip it — the fix must not blind the warning.
  it('still reports a genuinely low rate when media time really did advance', () => {
    const s = computeVideoFpsSample(prev, { totalFrames: 120, droppedFrames: 12, currentTime: 10, timestamp: 10000 });
    expect(s.fps).toBe(12);
    expect(s.dropRate).toBe(10);
  });

  // The whole point of the fix: the same frame delta must read the same fps
  // whether the sampler happened to open its window before or after playback
  // started. Wall-clock arithmetic makes these two disagree by ~40%.
  it('is independent of how much wall clock elapsed around the played seconds', () => {
    const shortWindow = computeVideoFpsSample(prev, { totalFrames: 240, droppedFrames: 0, currentTime: 10, timestamp: 10000 });
    const longWindow = computeVideoFpsSample(prev, { totalFrames: 240, droppedFrames: 0, currentTime: 10, timestamp: 60000 });
    expect(longWindow.fps).toBe(shortWindow.fps);
    expect(shortWindow.fps).toBe(24);
  });
});
