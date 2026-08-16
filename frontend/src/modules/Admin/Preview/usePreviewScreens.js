import { useState, useEffect } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';

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
 * `isPreviewable` exists to prevent, reintroduced via the one screen that is
 * always present.
 */
export const FALLBACK_SCREEN = Object.freeze({
  id: '__fallback',
  name: '1280 x 720',
  resolution: Object.freeze({ width: 1280, height: 720 }),
});

/**
 * A resolution the preview can actually lay out against: two finite, positive
 * CSS-pixel dimensions. This is the same predicate `previewFrameVars` applies
 * before it will build frame variables, restated here so that membership in
 * this hook's list always implies a renderable frame — a picker entry that
 * produced no variables would be an option that renders nothing.
 */
function isPreviewable(resolution) {
  const w = resolution?.width;
  const h = resolution?.height;
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
}

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
  const [screens, setScreens] = useState([FALLBACK_SCREEN]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // Two-arg form, not `.then().catch()`: a trailing catch would also swallow
    // anything thrown inside the success handler and report a local logic bug as
    // `screens-load-failed`. This way the error handler only ever sees a rejected
    // request.
    DaylightAPI('api/v1/screens').then(
      (data) => {
        if (cancelled) return;
        const sized = (data?.screens || []).filter((s) => isPreviewable(s?.resolution));
        logger().debug('screens-loaded', { total: data?.screens?.length || 0, sized: sized.length });
        setScreens(sized.length ? sized : [FALLBACK_SCREEN]);
        setLoading(false);
      },
      (err) => {
        if (cancelled) return;
        logger().warn('screens-load-failed', { message: err?.message });
        setScreens([FALLBACK_SCREEN]);
        setLoading(false);
      }
    );

    return () => { cancelled = true; };
  }, []);

  return { screens, loading };
}

export default usePreviewScreens;
