/**
 * useFitnessUrlParams - URL Parsing Hook for Fitness Deep Linking
 *
 * Provides utilities for parsing and building fitness URLs.
 * Supports the following URL patterns:
 *   /fitness                     → menu view (no ID)
 *   /fitness/menu/:id            → menu view with video ID(s)
 *   /fitness/show/:id            → show view
 *   /fitness/play/:id            → play view
 *   /fitness/plugin/:id          → plugin view
 *   /fitness/users               → users view
 *
 * Query parameters:
 *   ?music=on|off                → Music preference
 *   ?fullscreen=1                → Fullscreen mode
 *   ?simulate[=duration,users,rpm|stop] → Simulation mode
 */

import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { useMemo, useCallback } from 'react';

/**
 * Parse fitness URL path and query params into structured object.
 * Exported for unit testing.
 *
 * @param {string} pathname - URL pathname (e.g., '/fitness/menu/123')
 * @param {URLSearchParams} searchParams - Query parameters
 * @returns {object} Parsed URL state
 */
export function parseFitnessUrl(pathname, searchParams) {
  // Default result
  const result = {
    view: 'menu',
    id: null,
    ids: null,
    music: null,
    fullscreen: false,
    simulate: null
  };

  // Parse path segments: /fitness/{view}/{id}
  const match = pathname.match(/^\/fitness(?:\/([^/]+))?(?:\/(.+))?$/);
  if (match) {
    const [, view, id] = match;

    if (view) {
      result.view = view;
    }

    if (id) {
      result.id = id;

      // For menu view, support comma-separated IDs
      if (view === 'menu' && id.includes(',')) {
        result.ids = id.split(',').map(s => s.trim()).filter(Boolean);
      } else if (view === 'menu') {
        result.ids = [id];
      }
    }
  }

  // Parse query params
  const musicParam = searchParams.get('music');
  if (musicParam === 'on' || musicParam === 'off') {
    result.music = musicParam;
  }

  if (searchParams.get('fullscreen') === '1') {
    result.fullscreen = true;
  }

  // Parse simulate param
  if (searchParams.has('simulate')) {
    const simValue = searchParams.get('simulate');

    if (simValue === 'stop') {
      result.simulate = { stop: true };
    } else if (!simValue || simValue === '') {
      // ?simulate or ?simulate= → use defaults
      result.simulate = { duration: 120, users: 0, rpm: 0 };
    } else {
      // Parse comma-separated values: duration,users,rpm
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
 *
 * @param {object} state - Fitness navigation state
 * @returns {string} URL path (without query params)
 */
export function buildFitnessPath(state) {
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

/**
 * React hook for fitness URL parsing and navigation.
 *
 * @returns {object} { urlState, navigateTo, updateUrl }
 */
export function useFitnessUrlParams() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const urlState = useMemo(() => {
    return parseFitnessUrl(location.pathname, searchParams);
  }, [location.pathname, searchParams]);

  const navigateTo = useCallback((view, id = null, options = {}) => {
    const path = buildFitnessPath({ view, id, ids: options.ids });
    const params = new URLSearchParams();

    if (options.music) params.set('music', options.music);
    if (options.fullscreen) params.set('fullscreen', '1');

    const queryString = params.toString();
    const fullPath = queryString ? `${path}?${queryString}` : path;

    navigate(fullPath, { replace: options.replace ?? true });
  }, [navigate]);

  const updateUrl = useCallback((state, options = {}) => {
    const path = buildFitnessPath(state);
    navigate(path, { replace: options.replace ?? true });
  }, [navigate]);

  return { urlState, navigateTo, updateUrl };
}

export default useFitnessUrlParams;
