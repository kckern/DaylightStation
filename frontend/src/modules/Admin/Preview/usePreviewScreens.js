import { useMemo, useEffect } from 'react';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import getLogger from '../../../lib/logging/Logger.js';
import { isPreviewableResolution } from './previewFrame.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'preview-screens' });
  return _logger;
}

/**
 * Used until (or unless) the screens API answers with something sized.
 * Deliberately generic — the preview must never hardcode a household screen id.
 *
 * Frozen all the way down, not just at the top: this is a module singleton that
 * goes into state by identity, so a consumer mutating `.resolution` would poison
 * it for the rest of the session. A `width: 0` in particular would make
 * `previewFrameVars` return null — the "option that renders nothing" that
 * `isPreviewableResolution` exists to prevent, reintroduced via the one screen
 * that is always present.
 */
export const FALLBACK_SCREEN = Object.freeze({
  id: '__fallback',
  name: '1280 x 720',
  resolution: Object.freeze({ width: 1280, height: 720 }),
});

const fallbackScreens = Object.freeze([FALLBACK_SCREEN]);

/**
 * usePreviewScreens
 * -----------------
 * Loads the screens that can be previewed — i.e. those that declare a
 * CSS-pixel `resolution`. An e-ink panel with no `resolution` has no scale to
 * imitate, so it is filtered out rather than previewed at a guessed size.
 *
 * `screens` always holds at least one usable entry, starting at the generic
 * fallback, so a consumer may render before the request settles without a
 * null check. `loading` reports only whether that request is still in flight.
 *
 * @returns {{screens: Array<{id: string, name: string, resolution: {width: number, height: number}}>, loading: boolean}}
 */
export function usePreviewScreens() {
  const { data, loading, error } = useApiResource('api/v1/screens');
  const sized = useMemo(() => (data?.screens || []).filter(screen =>
    isPreviewableResolution(screen?.resolution)), [data]);

  useEffect(() => {
    if (error) logger().warn('screens-load-failed', { message: error.message });
    else if (data) logger().debug('screens-loaded', { total: data.screens?.length || 0, sized: sized.length });
  }, [data, error, sized]);

  return { screens: sized.length && !error ? sized : fallbackScreens, loading };
}

export default usePreviewScreens;
