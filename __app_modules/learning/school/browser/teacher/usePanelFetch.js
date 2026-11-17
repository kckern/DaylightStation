/**
 * usePanelFetch — the teacher console's one fetch contract (spec §4.3).
 * Five states, so a panel can tell the difference between "nothing yet"
 * (empty — quiet zero-state), "this install doesn't have the feature"
 * (unavailable), and "the fetch broke" (error — named inline notice with a
 * retry). Fetches are per-panel and independent: one failing endpoint never
 * blanks its tab.
 *
 * Mapping knobs, because the same status means different things per read:
 *  - `notFoundAs`: a 404 is 'unavailable' for lifecycle-backed panels (the
 *    route isn't registered on this install), 'empty' for known
 *    404-as-empty reads (assignments for an unassigned learner), and the
 *    default 'error' otherwise.
 *  - `nullAs`: an ok-but-null body is 'unavailable' where null is the
 *    unwired tell (`/report-card`), default 'empty'.
 */
import { useEffect } from 'react';
import { teacherLog } from './teacherLog.js';
import { useSchoolResource } from '../runtime/useSchoolResource.js';
import { schoolResourceEmpty } from '../runtime/schoolResources.js';
import { useSchoolInvalidation } from '../runtime/useSchoolInvalidation.js';
import { useSchoolSurface } from '../portal/SchoolSurface.jsx';

export function usePanelFetch(fetcher, {
  deps = [], isEmpty = schoolResourceEmpty, notFoundAs = 'error', nullAs = 'empty', panel = 'panel', learnerId = null,
} = {}) {
  // Each panel owns its store: identical labels never merge different composed fetchers.
  const { surfaceId, deviceId } = useSchoolSurface();
  const resource = useSchoolResource({ key: [surfaceId, deviceId, 'teacher', learnerId, panel, ...deps], load: fetcher, isEmpty, notFoundAs, nullAs });
  useSchoolInvalidation({ refresh: resource.retry, learnerId, topics: ['school', 'state-gates'] });
  const { error, state } = resource;
  useEffect(() => {
    if (error) teacherLog.fetch('fetch-failed', { panel, status: error.status, kind: error.kind });
    else if (state === 'unavailable') teacherLog.fetch('unavailable', { panel });
  }, [error, state, panel]);
  return { ...resource, state: state === 'ready' ? 'ok' : state };
}

/** The single-banner rule: true only when EVERY lifecycle panel reported unavailable. */
export function allUnavailable(states) {
  return states.length > 0 && states.every((s) => s === 'unavailable');
}

export default usePanelFetch;
