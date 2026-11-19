import { useLayoutEffect, useRef } from 'react';
import { invalidateApiResources, useApiResource } from '../../../lib/hooks/useApiResource.js';

export function useAdminRoster(path) {
  const resource = useApiResource(path, { retryTransient: false });
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function refreshAfterWrite() {
    if (mounted.current) return resource.refresh();
    invalidateApiResources(key => key === path);
  }

  return { ...resource, refreshAfterWrite };
}
