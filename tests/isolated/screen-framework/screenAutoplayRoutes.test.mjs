import { describe, test, expect } from '@jest/globals';

/**
 * Test the route resolution logic extracted from ScreenAutoplay.
 * Given a subPath and a routes map, determine what to push onto the nav stack.
 */
function resolveScreenRoute(subPath, routes) {
  if (routes?.[subPath]) {
    const { contentId, ...routeProps } = routes[subPath];
    // routeProps go INSIDE list — MenuStack passes props.list to TVMenu, dropping siblings
    return { type: 'menu', props: { list: { contentId, ...routeProps } } };
  }
  return { type: 'menu', props: { list: { contentId: `menu:${subPath}` } } };
}

describe('resolveScreenRoute', () => {
  const routes = {
    games: { contentId: 'retroarch/launchable', menuStyle: 'arcade' },
    music: { contentId: 'menu:music' },
  };

  test('matched route puts contentId and extra props inside list object', () => {
    const result = resolveScreenRoute('games', routes);
    expect(result).toEqual({
      type: 'menu',
      props: { list: { contentId: 'retroarch/launchable', menuStyle: 'arcade' } },
    });
  });

  test('matched route without extra props works', () => {
    const result = resolveScreenRoute('music', routes);
    expect(result).toEqual({
      type: 'menu',
      props: { list: { contentId: 'menu:music' } },
    });
  });

  test('unmatched route falls back to menu:{subPath}', () => {
    const result = resolveScreenRoute('fhe', routes);
    expect(result).toEqual({
      type: 'menu',
      props: { list: { contentId: 'menu:fhe' } },
    });
  });

  test('null routes falls back to menu:{subPath}', () => {
    const result = resolveScreenRoute('fhe', null);
    expect(result).toEqual({
      type: 'menu',
      props: { list: { contentId: 'menu:fhe' } },
    });
  });

  test('undefined routes falls back to menu:{subPath}', () => {
    const result = resolveScreenRoute('fhe', undefined);
    expect(result).toEqual({
      type: 'menu',
      props: { list: { contentId: 'menu:fhe' } },
    });
  });
});
