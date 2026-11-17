import { useEffect, useMemo } from 'react';
import { useSchoolApi } from '../runtime/useSchoolApi.js';
import { useSchoolSurface } from '../portal/SchoolSurface.jsx';
import { useSchoolResource } from '../runtime/useSchoolResource.js';
import { useSchoolInvalidation } from '../runtime/useSchoolInvalidation.js';
import { schoolLog } from '../schoolLog.js';

/** Mounted teacher evidence is verified on read and repaired after School mutations. */
export function useTeacherToday() {
  const api = useSchoolApi(); const { surfaceId, deviceId } = useSchoolSurface();
  const resource = useSchoolResource({
    key: [surfaceId, deviceId, 'teacher-today'],
    load: async (options) => {
      const result = typeof api.request === 'function' ? await api.request('/teacher/today', options) : await api.teacherToday();
      return result?.ok && !Array.isArray(result.data) ? { ok: false, status: 200, data: null, error: { kind: 'invalid-data' } } : result;
    },
  });
  useSchoolInvalidation({ refresh: resource.retry, topics: ['school', 'state-gates'] });
  useEffect(() => {
    if (resource.error) schoolLog.teacherTodayError('fetch-failed', {});
    else if (resource.lastSuccessAt != null) schoolLog.teacherToday('loaded', { learners: resource.data.length });
  }, [resource.error, resource.lastSuccessAt]);
  const byLearner = useMemo(() => new Map((resource.data ?? []).map(row => [row.learnerId, row])), [resource.data]);
  return { ...resource, byLearner, status: resource.state === 'empty' ? 'ready' : resource.state };
}
export default useTeacherToday;
