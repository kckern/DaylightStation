import { useMemo } from 'react';
import { schoolApi } from '../schoolApi.js';
import { useSchoolSurface } from '../portal/SchoolSurface.jsx';

/** Endpoint clients are bound to their surface, never a module-global device id. */
export function useSchoolApi() {
  return useSchoolSurface().api ?? schoolApi;
}
/** Keep feature grants in their adapter while sharing the surface's request scope. */
export function useScopedSchoolClient(factory, fallback, options = {}) {
  const {deviceId,provided}=useSchoolSurface();
  const api=useSchoolApi();
  const key=JSON.stringify(options);
  return useMemo(()=>!provided && fallback ? fallback : factory({...options,deviceId,transport:api.transport}),[factory,fallback,deviceId,provided,key,api]);
}
