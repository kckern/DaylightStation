import { useEffect, useRef, useState } from 'react';
import { useSchoolApi } from '../runtime/useSchoolApi.js';
import { useSchoolSurface } from '../portal/SchoolSurface.jsx';
import { useSchoolResource } from '../runtime/useSchoolResource.js';
import { useSchoolInvalidation } from '../runtime/useSchoolInvalidation.js';
import { schoolLog } from '../schoolLog.js';

/** A learner's resolved feedback; failures retain the last verified list with stale metadata. */
export function useLearnerFeedback(learnerId, { limit = 20 } = {}) {
  const api = useSchoolApi(); const { surfaceId, deviceId } = useSchoolSurface();
  const [hasNew, setHasNew] = useState(false); const seen = useRef(null);
  const identity = JSON.stringify([surfaceId, deviceId, learnerId, limit]);
  const resource = useSchoolResource({
    key: [surfaceId, deviceId, 'learner-feedback', learnerId, limit], enabled: Boolean(learnerId),
    load: async (options) => {
      const result = typeof api.request === 'function'
        ? await api.request(`/review/learner/${encodeURIComponent(learnerId)}?limit=${encodeURIComponent(limit)}`, options)
        : await api.reviewLearner(learnerId, { limit });
      return result?.ok && !Array.isArray(result.data) ? { ok: false, status: 200, data: null, error: { kind: 'invalid-data' } } : result;
    },
  });
  useSchoolInvalidation({ refresh: resource.retry, learnerId, enabled: Boolean(learnerId), topics: ['school', 'state-gates'] });
  useEffect(() => { seen.current = null; setHasNew(false); }, [identity]);
  useEffect(() => {
    if (!resource.data) return;
    const previous = seen.current;
    if (previous && resource.data.some(item => !previous.has(item.itemId))) setHasNew(true);
    seen.current = new Set(resource.data.map(item => item.itemId));
    schoolLog.feedback('loaded', { learnerId, count: resource.data.length });
  }, [resource.data]);
  useEffect(() => { if (resource.error) schoolLog.feedbackError('fetch-failed', { learnerId }); }, [resource.error, learnerId]);
  return { ...resource, items: resource.data ?? [], status: learnerId ? resource.state : 'empty', hasNew, markSeen: () => setHasNew(false) };
}
export default useLearnerFeedback;
