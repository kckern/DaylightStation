import { describe, it, expect } from 'vitest';
import { isActive, readPadActivity, activitySignature, ACTIVE_WINDOW_MS } from './inputActivity.js';

describe('isActive', () => {
  it('is inactive when never pinged (lastPingAt 0)', () => {
    expect(isActive(0, 1000)).toBe(false);
  });

  it('is active within the window and inactive past it', () => {
    const now = 10_000;
    expect(isActive(now - 10, now)).toBe(true);
    expect(isActive(now - ACTIVE_WINDOW_MS, now)).toBe(true); // boundary is inclusive
    expect(isActive(now - (ACTIVE_WINDOW_MS + 1), now)).toBe(false);
  });
});

describe('readPadActivity', () => {
  const pad = (over = {}) => ({
    index: 0, id: 'test-pad', mapping: 'standard', buttons: [], axes: [], ...over,
  });

  it('ignores null slots and idle pads', () => {
    const pads = [null, pad({ buttons: [{ pressed: false }], axes: [0, 0] })];
    expect(readPadActivity(pads)).toEqual([]);
  });

  it('reports pressed button indices', () => {
    const pads = [pad({ buttons: [{ pressed: true }, { pressed: false }, { pressed: true }] })];
    expect(readPadActivity(pads)).toEqual([
      { slot: 0, id: 'test-pad', mapping: 'standard', buttons: [0, 2], axes: [] },
    ]);
  });

  it('reports axes only past the 0.5 deadzone, with direction', () => {
    const pads = [pad({ axes: [0.9, -0.8, 0.2, -0.1] })];
    expect(readPadActivity(pads)[0].axes).toEqual(['0:+', '1:-']);
  });

  it('handles missing getGamepads result', () => {
    expect(readPadActivity(null)).toEqual([]);
    expect(readPadActivity(undefined)).toEqual([]);
  });
});

describe('activitySignature', () => {
  it('is stable for the same pressed set and changes when it changes', () => {
    const a = [{ slot: 0, buttons: [0, 2], axes: ['1:-'] }];
    const b = [{ slot: 0, buttons: [0, 2], axes: ['1:-'] }];
    const c = [{ slot: 0, buttons: [0], axes: ['1:-'] }];
    expect(activitySignature(a)).toBe(activitySignature(b));
    expect(activitySignature(a)).not.toBe(activitySignature(c));
  });

  it('is empty for no activity', () => {
    expect(activitySignature([])).toBe('');
  });
});
