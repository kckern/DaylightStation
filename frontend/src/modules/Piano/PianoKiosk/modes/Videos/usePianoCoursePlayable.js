import { useState, useEffect } from 'react';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import getLogger from '../../../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-course-playable' });
  return _logger;
}

/**
 * Per-user course data for the piano kiosk. When a userId is supplied, calls the
 * piano courses endpoint (returns user-keyed userPercent/userWatched/etc. plus an
 * isSequential flag); otherwise falls back to the device-level fitness show endpoint.
 */
export function usePianoCoursePlayable(courseId, userId) {
  const [state, setState] = useState({ data: null, loading: !!courseId, error: null });

  useEffect(() => {
    if (!courseId) {
      setState({ data: null, loading: false, error: null });
      return undefined;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    const url = userId
      ? `api/v1/piano/courses/${courseId}/playable?userId=${encodeURIComponent(userId)}`
      : `api/v1/fitness/show/${courseId}/playable`;

    DaylightAPI(url)
      .then((r) => {
        if (!cancelled) setState({ data: r || { items: [] }, loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ data: null, loading: false, error: err.message });
        logger().warn('piano.course-playable.failed', { courseId, error: err.message });
      });
    return () => { cancelled = true; };
  }, [courseId, userId]);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    items: state.data?.items ?? null,
    info: state.data?.info ?? {},
    parents: state.data?.parents ?? null,
    isSequential: state.data?.isSequential ?? false,
    coProgressLock: state.data?.coProgressLock ?? null,
    referenceUnitIds: state.data?.referenceUnitIds ?? [],
  };
}
