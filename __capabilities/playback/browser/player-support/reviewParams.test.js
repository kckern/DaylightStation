import { describe, it, expect } from 'vitest';
import { parseStartParam } from './reviewParams.js';

describe('parseStartParam', () => {
  it('reads ?goto', () => expect(parseStartParam('?goto=120')).toBe(120));
  it('reads ?start as an alias, including 0', () => {
    expect(parseStartParam('?play=plex:662169&start=0')).toBe(0);
    expect(parseStartParam('?start=90.5')).toBe(90.5);
  });
  it('goto wins over start', () => expect(parseStartParam('?start=5&goto=60')).toBe(60));
  it('falls through an invalid goto to a valid start', () => expect(parseStartParam('?goto=abc&start=7')).toBe(7));
  it('ignores missing, empty, negative and non-numeric values', () => {
    expect(parseStartParam('?play=plex:1')).toBeNull();
    expect(parseStartParam('?start=')).toBeNull();
    expect(parseStartParam('?start=-3')).toBeNull();
    expect(parseStartParam('?start=abc')).toBeNull();
    expect(parseStartParam('')).toBeNull();
  });
});
