import { useLayoutEffect, useRef } from 'react';
import { invalidateApiResources, useApiResource } from '../../../lib/hooks/useApiResource.js';

export function useAdminRoster(path, { retryTransient = false } = {}) {
  const resource = useApiResource(path, { retryTransient });
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function invalidateAfterWrite() {
    invalidateApiResources(key => key === path);
  }

  function refreshAfterWrite(options) {
    if (mounted.current) return resource.refresh(options);
    invalidateAfterWrite();
  }

  return { ...resource, invalidateAfterWrite, refreshAfterWrite };
}
