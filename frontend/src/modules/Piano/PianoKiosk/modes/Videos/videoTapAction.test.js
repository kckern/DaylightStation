import { describe, it, expect } from 'vitest';
import { videoTapAction } from './videoTapAction.js';

describe('videoTapAction', () => {
  it('maps the left third to back', () => {
    expect(videoTapAction(0, 900)).toBe('back');
    expect(videoTapAction(299, 900)).toBe('back');
  });

  it('maps the middle third to toggle', () => {
    expect(videoTapAction(300, 900)).toBe('toggle');
    expect(videoTapAction(450, 900)).toBe('toggle');
    expect(videoTapAction(600, 900)).toBe('toggle');
  });

  it('maps the right third to forward', () => {
    expect(videoTapAction(601, 900)).toBe('forward');
    expect(videoTapAction(899, 900)).toBe('forward');
  });

  it('falls back to toggle when the width is unknown', () => {
    expect(videoTapAction(100, 0)).toBe('toggle');
    expect(videoTapAction(100, NaN)).toBe('toggle');
  });
});
