import { describe, it, expect } from 'vitest';
import { isContentIdLike, shouldAutoAdd } from './contentSearchLogic.js';

describe('isContentIdLike', () => {
  it.each([
    ['plex:456724', true],
    ['canvas:religious/stars.jpg', true],
    ['hymn: 147', true],            // space after colon is legal in list YAML
    ['app:webcam', true],
    ['star wars', false],           // exploratory text
    ['beet', false],
    ['plex:', false],               // no local id
    ['', false],
    [null, false],
  ])('%s → %s', (input, expected) => {
    expect(isContentIdLike(input)).toBe(expected);
  });
});

describe('shouldAutoAdd', () => {
  it('adds for id-like input (dropdown picks produce these)', () => {
    expect(shouldAutoAdd('plex:123')).toBe(true);
  });
  it('does NOT add for freeform text (junk-entries guard)', () => {
    expect(shouldAutoAdd('star wars')).toBe(false);
  });
});
