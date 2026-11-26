import { describe, it, expect } from 'vitest';
import { rankScreens, screenCanTop, SCREEN_TOP_N } from './screenRanking.js';
import { splitTopMore } from '../../../../../frontend/src/lib/ui/splitTopMore.js';

const house = [
  { id: 'zeta-tv', name: 'Zeta TV', displayState: 'idle' },
  { id: 'den-tv', name: 'Den TV', displayState: 'off' },
  { id: 'browser:abc', name: 'Phone', type: 'browser', displayState: 'playing' },
  { id: 'alpha-tv', name: 'Alpha TV', displayState: 'idle' },
  { id: 'office-tv', name: 'Office Screen', displayState: 'off' },
  { id: 'kitchen', name: 'Kitchen', displayState: 'playing' },
];
const ids = (list) => list.map((d) => d.id);

describe('screen ranking (smart long lists)', () => {
  it('habit weight first, then playing/online, then by name; browser tabs last', () => {
    const weights = new Map([['office-tv', 3], ['den-tv', 1]]);
    expect(ids(rankScreens(house, { weights })))
      .toEqual(['office-tv', 'den-tv', 'kitchen', 'alpha-tv', 'zeta-tv', 'browser:abc']);
  });

  it('preferred ids beat habit weight', () => {
    expect(ids(rankScreens(house, { preferredIds: ['zeta-tv'], weights: new Map([['office-tv', 3]])})).slice(0, 2))
      .toEqual(['zeta-tv', 'office-tv']);
  });

  it('with no habits, asleep screens and browser tabs fall under More', () => {
    const ranked = rankScreens(house);
    const { top, more } = splitTopMore(ranked, { n: SCREEN_TOP_N, canTop: screenCanTop() });
    expect(ids(top)).toEqual(['kitchen', 'alpha-tv', 'zeta-tv']);
    expect(ids(more)).toEqual(['den-tv', 'office-tv', 'browser:abc']);
  });

  it('the usual screen stays on top while asleep; a used browser tab may take a top place', () => {
    const weights = new Map([['office-tv', 2], ['browser:abc', 1]]);
    const options = { weights };
    const { top } = splitTopMore(rankScreens(house, options), { n: SCREEN_TOP_N, canTop: screenCanTop(options) });
    expect(ids(top)).toEqual(['office-tv', 'browser:abc', 'kitchen']);
  });
});
