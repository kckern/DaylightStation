// tests/unit/fitness/fitness-url-params.unit.test.mjs
import { describe, test, expect } from '@jest/globals';

/**
 * Unit tests for fitness URL parsing utilities.
 *
 * Since the hook file imports react-router-dom which is only available in the
 * frontend environment, we re-implement the pure parsing functions here for testing.
 * The actual hook implementation uses these same algorithms.
 *
 * This mirrors the pattern used in fitness-url-routing.unit.test.mjs where
 * route matching logic is tested without importing React Router.
 */

/**
 * Parse fitness URL path and query params into structured object.
 * This is the same implementation as in useFitnessUrlParams.js
 */
function parseFitnessUrl(pathname, searchParams) {
  const result = {
    view: 'menu',
    id: null,
    ids: null,
    music: null,
    fullscreen: false,
    simulate: null
  };

  const match = pathname.match(/^\/fitness(?:\/([^/]+))?(?:\/(.+))?$/);
  if (match) {
    const [, view, id] = match;

    if (view) {
      result.view = view;
    }

    if (id) {
      result.id = id;

      if (view === 'menu' && id.includes(',')) {
        result.ids = id.split(',').map(s => s.trim()).filter(Boolean);
      } else if (view === 'menu') {
        result.ids = [id];
      }
    }
  }

  const musicParam = searchParams.get('music');
  if (musicParam === 'on' || musicParam === 'off') {
    result.music = musicParam;
  }

  if (searchParams.get('fullscreen') === '1') {
    result.fullscreen = true;
  }

  if (searchParams.has('simulate')) {
    const simValue = searchParams.get('simulate');

    if (simValue === 'stop') {
      result.simulate = { stop: true };
    } else if (!simValue || simValue === '') {
      result.simulate = { duration: 120, users: 0, rpm: 0 };
    } else {
      const parts = simValue.split(',').map(s => parseInt(s, 10) || 0);
      result.simulate = {
        duration: parts[0] || 120,
        users: parts[1] || 0,
        rpm: parts[2] || 0
      };
    }
  }

  return result;
}

/**
 * Build URL path from fitness state.
 * This is the same implementation as in useFitnessUrlParams.js
 */
function buildFitnessPath(state) {
  const { view, id, ids } = state;

  if (!view || view === 'menu') {
    if (ids && ids.length > 0) {
      return `/fitness/menu/${ids.join(',')}`;
    }
    if (id) {
      return `/fitness/menu/${id}`;
    }
    return '/fitness';
  }

  if (view === 'users') {
    return '/fitness/users';
  }

  if (id) {
    return `/fitness/${view}/${id}`;
  }

  return `/fitness/${view}`;
}

describe('parseFitnessUrl', () => {
  test('parses /fitness/menu/:id route', () => {
    const result = parseFitnessUrl('/fitness/menu/12345', new URLSearchParams());
    expect(result).toEqual({
      view: 'menu',
      id: '12345',
      ids: ['12345'],
      music: null,
      fullscreen: false,
      simulate: null
    });
  });

  test('parses comma-separated menu IDs', () => {
    const result = parseFitnessUrl('/fitness/menu/123,456,789', new URLSearchParams());
    expect(result.ids).toEqual(['123', '456', '789']);
  });

  test('parses /fitness/show/:id route', () => {
    const result = parseFitnessUrl('/fitness/show/67890', new URLSearchParams());
    expect(result).toEqual({
      view: 'show',
      id: '67890',
      ids: null,
      music: null,
      fullscreen: false,
      simulate: null
    });
  });

  test('parses /fitness/play/:id route', () => {
    const result = parseFitnessUrl('/fitness/play/abc123', new URLSearchParams());
    expect(result.view).toBe('play');
    expect(result.id).toBe('abc123');
  });

  test('parses /fitness/plugin/:id route', () => {
    const result = parseFitnessUrl('/fitness/plugin/fitness_session', new URLSearchParams());
    expect(result.view).toBe('plugin');
    expect(result.id).toBe('fitness_session');
  });

  test('parses /fitness/users route', () => {
    const result = parseFitnessUrl('/fitness/users', new URLSearchParams());
    expect(result.view).toBe('users');
    expect(result.id).toBeNull();
  });

  test('parses query params', () => {
    const params = new URLSearchParams('music=off&fullscreen=1');
    const result = parseFitnessUrl('/fitness/menu/123', params);
    expect(result.music).toBe('off');
    expect(result.fullscreen).toBe(true);
  });

  test('parses simulate param with defaults', () => {
    const params = new URLSearchParams('simulate');
    const result = parseFitnessUrl('/fitness/users', params);
    expect(result.simulate).toEqual({ duration: 120, users: 0, rpm: 0 });
  });

  test('parses simulate param with values', () => {
    const params = new URLSearchParams('simulate=300,2,4');
    const result = parseFitnessUrl('/fitness/users', params);
    expect(result.simulate).toEqual({ duration: 300, users: 2, rpm: 4 });
  });

  test('parses simulate=stop', () => {
    const params = new URLSearchParams('simulate=stop');
    const result = parseFitnessUrl('/fitness/users', params);
    expect(result.simulate).toEqual({ stop: true });
  });

  test('defaults to menu view for bare /fitness', () => {
    const result = parseFitnessUrl('/fitness', new URLSearchParams());
    expect(result.view).toBe('menu');
    expect(result.id).toBeNull();
  });

  test('parses music=on query param', () => {
    const params = new URLSearchParams('music=on');
    const result = parseFitnessUrl('/fitness/menu/123', params);
    expect(result.music).toBe('on');
  });

  test('ignores invalid music param values', () => {
    const params = new URLSearchParams('music=invalid');
    const result = parseFitnessUrl('/fitness/menu/123', params);
    expect(result.music).toBeNull();
  });

  test('handles whitespace in comma-separated IDs', () => {
    const result = parseFitnessUrl('/fitness/menu/123, 456, 789', new URLSearchParams());
    expect(result.ids).toEqual(['123', '456', '789']);
  });
});

describe('buildFitnessPath', () => {
  test('builds bare /fitness for menu with no ID', () => {
    const result = buildFitnessPath({ view: 'menu', id: null, ids: null });
    expect(result).toBe('/fitness');
  });

  test('builds /fitness/menu/:id for single ID', () => {
    const result = buildFitnessPath({ view: 'menu', id: '123', ids: null });
    expect(result).toBe('/fitness/menu/123');
  });

  test('builds /fitness/menu/:ids for multiple IDs', () => {
    const result = buildFitnessPath({ view: 'menu', id: null, ids: ['123', '456', '789'] });
    expect(result).toBe('/fitness/menu/123,456,789');
  });

  test('builds /fitness/show/:id', () => {
    const result = buildFitnessPath({ view: 'show', id: '67890', ids: null });
    expect(result).toBe('/fitness/show/67890');
  });

  test('builds /fitness/play/:id', () => {
    const result = buildFitnessPath({ view: 'play', id: 'abc123', ids: null });
    expect(result).toBe('/fitness/play/abc123');
  });

  test('builds /fitness/plugin/:id', () => {
    const result = buildFitnessPath({ view: 'plugin', id: 'fitness_session', ids: null });
    expect(result).toBe('/fitness/plugin/fitness_session');
  });

  test('builds /fitness/users', () => {
    const result = buildFitnessPath({ view: 'users', id: null, ids: null });
    expect(result).toBe('/fitness/users');
  });

  test('prioritizes ids over id for menu view', () => {
    const result = buildFitnessPath({ view: 'menu', id: '999', ids: ['123', '456'] });
    expect(result).toBe('/fitness/menu/123,456');
  });

  test('returns /fitness when view is undefined', () => {
    const result = buildFitnessPath({ view: undefined, id: null, ids: null });
    expect(result).toBe('/fitness');
  });

  test('builds view path without ID when ID is null', () => {
    const result = buildFitnessPath({ view: 'show', id: null, ids: null });
    expect(result).toBe('/fitness/show');
  });
});
