import { useEffect } from 'react';
import { useApiResource } from '../../../../../frontend/src/lib/hooks/useApiResource.js';
import { mediaLog } from '../logging/mediaLog.js';

export function useContentInfo(contentId) {
  const separator = typeof contentId === 'string' ? contentId.indexOf(':') : -1;
  const path = separator < 0 ? null
    : `api/v1/info/${contentId.slice(0, separator)}/${contentId.slice(separator + 1)}`;
  const { data, loading, error, reload } = useApiResource(path);

  useEffect(() => {
    if (error) mediaLog.loadFailed({ surface: 'detail', contentId, error: error.message });
  }, [contentId, error]);

  return { info: data ?? null, loading, error, reload };
}

export default useContentInfo;
