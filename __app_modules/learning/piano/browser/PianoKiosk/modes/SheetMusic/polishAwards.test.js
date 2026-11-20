import { describe, expect, it } from 'vitest';
import { POLISH_DIAMOND_COLOR, POLISH_GEM_COLOR, polishStone } from './polishAwards.js';

describe('polishStone', () => {
  it('is nothing until the piece holds a gem', () => {
    expect(polishStone(null)).toBeNull();
    expect(polishStone(undefined)).toBeNull();
    expect(polishStone({ gem: false, diamond: false })).toBeNull();
  });
  it('shows the gem, and the diamond in its place once earned', () => {
    expect(polishStone({ gem: true, diamond: false })).toEqual({ kind: 'gem', color: POLISH_GEM_COLOR, label: 'Polish gem' });
    expect(polishStone({ gem: true, diamond: true })).toEqual({ kind: 'diamond', color: POLISH_DIAMOND_COLOR, label: 'Polish diamond' });
    // A diamond always came with its gem; a record that says otherwise still shows the diamond.
    expect(polishStone({ gem: false, diamond: true })?.kind).toBe('diamond');
  });
});
