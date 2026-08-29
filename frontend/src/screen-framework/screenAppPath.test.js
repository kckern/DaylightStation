import { describe, expect, it } from 'vitest';
import { resolveScreenAppPath } from './screenAppPath.js';

const hasApp = (id) => id === 'party-games' || id === 'weekly-review';

describe('resolveScreenAppPath', () => {
  it('splits a nested screen app route into its canonical app and app path', () => {
    expect(resolveScreenAppPath(
      '/screens/living-room/party-games/charades',
      hasApp,
      { 'party-games': { app: 'party-games' } },
    )).toEqual({
      appId: 'party-games',
      appPath: 'charades',
      menuId: 'party-games/charades',
    });
  });

  it('supports the singular screen prefix and apps without a nested path', () => {
    expect(resolveScreenAppPath('/screen/kitchen/weekly-review', hasApp)).toEqual({
      appId: 'weekly-review',
      appPath: null,
      menuId: 'weekly-review',
    });
  });

  it('allows a screen config route to expose or alias an app', () => {
    expect(resolveScreenAppPath(
      '/screens/living-room/party/charades',
      hasApp,
      { party: { app: 'party-games' } },
    )).toEqual({
      appId: 'party-games',
      appPath: 'charades',
      menuId: 'party-games/charades',
    });
  });

  it('does not claim an unregistered menu suffix', () => {
    expect(resolveScreenAppPath('/screens/living-room/fhe', hasApp)).toBeNull();
  });

  it('does not expose a nested app route on an unconfigured screen', () => {
    expect(resolveScreenAppPath('/screens/office/party-games/charades', hasApp)).toBeNull();
  });
});
