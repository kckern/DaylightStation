// tests/unit/fitness/fitness-url-routing.unit.test.mjs
import { describe, test, expect } from '@jest/globals';

/**
 * This test validates our understanding of how React Router patterns work.
 * Since react-router-dom is only available in frontend/node_modules,
 * we implement the pattern matching logic to verify our route design.
 *
 * The actual route is defined in frontend/src/main.jsx:
 *   <Route path="/fitness/*" element={<FitnessApp />} />
 */
describe('Fitness URL Routing', () => {
  // Simplified pattern matcher that mimics React Router's matchPath for wildcard routes
  const matchesWildcardPattern = (pattern, pathname) => {
    if (!pattern.endsWith('/*')) {
      return pattern === pathname;
    }
    const basePath = pattern.slice(0, -2); // Remove '/*'
    return pathname === basePath || pathname.startsWith(basePath + '/');
  };

  test('route pattern /fitness/* matches /fitness sub-paths', () => {
    const pattern = '/fitness/*';

    expect(matchesWildcardPattern(pattern, '/fitness')).toBe(true);
    expect(matchesWildcardPattern(pattern, '/fitness/menu/123')).toBe(true);
    expect(matchesWildcardPattern(pattern, '/fitness/show/456')).toBe(true);
    expect(matchesWildcardPattern(pattern, '/fitness/play/abc')).toBe(true);
    expect(matchesWildcardPattern(pattern, '/fitness/plugin/fitness_session')).toBe(true);
    expect(matchesWildcardPattern(pattern, '/fitness/users')).toBe(true);
  });

  test('route pattern /fitness/* does not match unrelated paths', () => {
    const pattern = '/fitness/*';

    expect(matchesWildcardPattern(pattern, '/fitnes')).toBe(false);
    expect(matchesWildcardPattern(pattern, '/fitness-other')).toBe(false);
    expect(matchesWildcardPattern(pattern, '/tv')).toBe(false);
    expect(matchesWildcardPattern(pattern, '/home')).toBe(false);
  });

  test('route pattern without wildcard only matches exact path', () => {
    const pattern = '/fitness';

    expect(matchesWildcardPattern(pattern, '/fitness')).toBe(true);
    expect(matchesWildcardPattern(pattern, '/fitness/menu/123')).toBe(false);
    expect(matchesWildcardPattern(pattern, '/fitness/users')).toBe(false);
  });
});
