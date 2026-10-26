import { describe, expect, it } from 'vitest';
import { createContentTimeline, toContentSeconds, validateMovieCompletion } from './contentTimeline.js';

const full = () => createContentTimeline({ catalogDurationSeconds: 5895, rendererStartSeconds: 0, contentStartSeconds: 0 });

describe('authoritative content timeline', () => {
  it('rejects a shortened renderer duration and accepts the three second tolerance', () => {
    expect(validateMovieCompletion({ timeline: full(), nativeSeconds: 4370 })).toEqual({ complete: false, reason: 'early-eof' });
    expect(validateMovieCompletion({ timeline: full(), nativeSeconds: 5891.9 }).complete).toBe(false);
    expect(validateMovieCompletion({ timeline: full(), nativeSeconds: 5892 }).complete).toBe(true);
  });
  it('mapsAbsoluteAndRelativeResume without using the resume position twice', () => {
    expect(toContentSeconds(4370, full())).toBe(4370);
    const relative = createContentTimeline({ catalogDurationSeconds: 5895, rendererStartSeconds: 0, contentStartSeconds: 4320 });
    expect(toContentSeconds(50, relative)).toBe(4370);
    expect(validateMovieCompletion({ timeline: relative, nativeSeconds: 50 }).complete).toBe(false);
    expect(toContentSeconds(75, createContentTimeline({ rendererStartSeconds: 25, contentStartSeconds: 4320 }))).toBe(4370);
  });
  it('honorsConfiguredClipEnd in original content seconds', () => {
    const clip = createContentTimeline({ catalogDurationSeconds: 5895, clipStartSeconds: 4320, clipEndSeconds: 4380, rendererStartSeconds: 0, contentStartSeconds: 0 });
    expect(validateMovieCompletion({ timeline: clip, nativeSeconds: 4370 }).complete).toBe(false);
    expect(validateMovieCompletion({ timeline: clip, nativeSeconds: 4380 }).complete).toBe(true);
  });
  it('retains unknown evidence instead of inventing zero origins or duration', () => {
    const unknown = createContentTimeline({ catalogDurationSeconds: 5895 });
    expect(toContentSeconds(4370, unknown)).toBeNull();
    expect(validateMovieCompletion({ timeline: unknown, nativeSeconds: 4370 })).toEqual({ complete: null, reason: 'timeline-unverified' });
    expect(validateMovieCompletion({ timeline: createContentTimeline({}), nativeSeconds: 4370 })).toEqual({ complete: null, reason: 'completion-unverified' });
    expect(validateMovieCompletion({ timeline: full(), nativeSeconds: NaN }).reason).toBe('timeline-unverified');
  });
});
