import { useCallback } from 'react';
import { useSchoolSurface } from '../portal/SchoolSurface.jsx';
import { useSchoolApi } from './useSchoolApi.js';
import { useLanguageApi } from './useSchoolFeatureApi.js';
import { useSchoolResource } from './useSchoolResource.js';

const shaped = (result, valid) => result?.ok && !valid(result.data)
  ? { ...result, ok: false, error: { kind: 'invalid-data' } } : result;

/** Materials and language courses unlock browsing without waiting for slower question banks. */
export function useSchoolCatalog({ enabled = true, api: suppliedApi, languageApi: suppliedLanguage } = {}) {
  const defaultApi = useSchoolApi();
  const defaultLanguage = useLanguageApi();
  const api = suppliedApi ?? defaultApi;
  const languageApi = suppliedLanguage ?? defaultLanguage;
  const { surfaceId, deviceId, resourceStore } = useSchoolSurface();
  const common = { enabled, store: resourceStore };
  const materials = useSchoolResource({
    ...common, key: [surfaceId, deviceId, 'catalog', 'materials'],
    load: async () => shaped(await api.materials(), data => Array.isArray(data?.materials)),
    isEmpty: data => !data.materials.length,
  });
  const courses = useSchoolResource({
    ...common, key: [surfaceId, deviceId, 'catalog', 'courses'],
    load: async () => shaped(await languageApi.courses(), Array.isArray),
  });
  const banks = useSchoolResource({
    ...common, key: [surfaceId, deviceId, 'catalog', 'banks'],
    load: async () => shaped(await api.banks(), Array.isArray),
  });
  const retry = useCallback(() => { materials.retry(); courses.retry(); banks.retry(); }, [materials.retry, courses.retry, banks.retry]);
  const failed = [['materials', materials], ['courses', courses], ['banks', banks]].find(([, resource]) => resource.error);
  return {
    materials: materials.data?.materials ?? [], courses: courses.data ?? [], banks: banks.data ?? [],
    catalogLoaded: enabled && materials.state !== 'loading' && courses.state !== 'loading',
    error: failed ? { resource: failed[0], ...failed[1].error } : null, retry,
  };
}

export default useSchoolCatalog;
