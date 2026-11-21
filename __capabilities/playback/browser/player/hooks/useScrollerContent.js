import { useApiResource } from '../../../../../frontend/src/lib/hooks/useApiResource.js';

export function useScrollerContent(contentId, initialData) {
  const path = initialData || !contentId
    ? null
    : `api/v1/info/${contentId.replace(':', '/')}`;
  const { data } = useApiResource(path, { retryTransient: false });
  return initialData || data;
}
