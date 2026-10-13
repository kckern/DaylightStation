import { describe, expect, it } from 'vitest';
import { ScreenAddressResolver } from './ScreenAddressResolver.mjs';

const SCREENS = [
  { id: 'kitchen-eink', route: '/api/eink/panel' },
  { id: 'living-room', route: '/screen/living-room' },
  { id: 'office', route: '/screen/office' },
  { id: 'portal', route: '/screen/portal' },
];

describe('ScreenAddressResolver', () => {
  it('preserves configured paths and owns the living-room fallback', () => {
    const resolver = new ScreenAddressResolver();
    expect(resolver.resolve({ screenPath: '/screen/office' })).toEqual({ path: '/screen/office', name: 'office', source: 'configured' });
    expect(resolver.resolve({})).toEqual({ path: '/screen/living-room', name: 'living-room', source: 'default' });
  });

  it('fuzzy-matches the device id against known screens before defaulting', () => {
    const resolver = new ScreenAddressResolver({ screens: SCREENS });
    expect(resolver.resolve({ id: 'office-tv' })).toEqual({ path: '/screen/office', name: 'office', source: 'fuzzy' });
    expect(resolver.resolve({ id: 'livingroom-tv' })).toMatchObject({ path: '/screen/living-room', source: 'fuzzy' });
  });

  it('matches on the device location when the id says nothing', () => {
    const resolver = new ScreenAddressResolver({ screens: SCREENS });
    expect(resolver.resolve({ id: 'tv-2', location: 'Living Room' })).toMatchObject({ path: '/screen/living-room', source: 'fuzzy' });
  });

  it('ignores e-ink screens, which route to an image endpoint', () => {
    const resolver = new ScreenAddressResolver({ screens: SCREENS });
    expect(resolver.resolve({ id: 'kitchen-eink-tablet' })).toMatchObject({ path: '/screen/living-room', source: 'default' });
  });

  it('falls back to the default when nothing matches', () => {
    const resolver = new ScreenAddressResolver({ screens: SCREENS });
    expect(resolver.resolve({ id: 'yellow-room-tablet', location: 'Yellow Room' }))
      .toEqual({ path: '/screen/living-room', name: 'living-room', source: 'default' });
  });

  it('prefers the longest match and refuses a tie between screens', () => {
    const resolver = new ScreenAddressResolver({
      screens: [{ id: 'room' }, { id: 'yellow-room' }, { id: 'den' }, { id: 'gym' }],
    });
    expect(resolver.resolve({ id: 'yellow-room-tablet' })).toMatchObject({ path: '/screen/yellow-room', source: 'fuzzy' });
    expect(resolver.resolve({ id: 'den-gym-tv' })).toMatchObject({ source: 'default' });
  });
});
