import { describe, it, expect } from 'vitest';
import { resolveSet } from './set.js';

describe('resolveSet', () => {
  const SET = { backdrop: 'sets/tv/room.jpg', bezel: 'sets/tv/set.svg', screen: { x: 0.2, y: 0.25, w: 0.3, h: 0.4 } };

  it('resolves the backdrop and bezel under the surround image tree, and keeps the screen rect', () => {
    const set = resolveSet({ set: SET });
    expect(set.backdrop).toMatch(/img\/surround\/sets\/tv\/room\.jpg$/);
    expect(set.bezel).toMatch(/img\/surround\/sets\/tv\/set\.svg$/);
    expect(set.screen).toEqual({ x: 0.2, y: 0.25, w: 0.3, h: 0.4 });
  });

  it('is null without a set, or with a screen that does not fit inside the picture', () => {
    expect(resolveSet({})).toBeNull();
    expect(resolveSet(null)).toBeNull();
    expect(resolveSet({ set: { ...SET, screen: { x: 0.8, y: 0.2, w: 0.3, h: 0.4 } } })).toBeNull();
    expect(resolveSet({ set: { ...SET, screen: { x: 0.2, y: 0.2, w: 0, h: 0.4 } } })).toBeNull();
    expect(resolveSet({ set: { backdrop: 'a.jpg' } })).toBeNull();
  });

  it('allows a set with no bezel', () => {
    expect(resolveSet({ set: { ...SET, bezel: undefined } }).bezel).toBeNull();
  });
});
