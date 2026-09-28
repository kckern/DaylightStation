import { describe, expect, it } from 'vitest';
import { decideFooterPlayPause } from './footerPlayPause.js';

describe('decideFooterPlayPause', () => {
  it('plays a paused video and pauses a playing one', () => {
    expect(decideFooterPlayPause({ elPaused: true, readyState: 4, hasToggle: true })).toBe('play');
    expect(decideFooterPlayPause({ elPaused: false, readyState: 4, hasToggle: true })).toBe('pause');
  });

  it('never pauses a video that is loading — the 2026-09-28 presses at readyState 0', () => {
    expect(decideFooterPlayPause({ elPaused: false, readyState: 0, hasToggle: true })).toBe('play');
    expect(decideFooterPlayPause({ elPaused: false, readyState: 1, hasToggle: true })).toBe('play');
  });

  it('pauses once a frame is on screen, even while buffering ahead', () => {
    expect(decideFooterPlayPause({ elPaused: false, readyState: 2, hasToggle: true })).toBe('pause');
  });

  it('falls back to the player toggle when there is no element to read', () => {
    expect(decideFooterPlayPause({ elPaused: null, readyState: null, hasToggle: true })).toBe('toggle');
    expect(decideFooterPlayPause({ elPaused: null, readyState: null, hasToggle: false })).toBe('none');
  });
});
