import { useEffect } from 'react';
import { useApiResource } from '../../../../frontend/src/lib/hooks/useApiResource.js';
import { contentInfoPath, splitContentId } from './contentSearchLogic.js';

const TITLE_CACHE_MAX = 500;
// Process-lifetime cache of contentId -> human title so the resolved-title
// line renders instantly for items we've already seen.
const titleCache = new Map();

export function clearTitleCache() {
  titleCache.clear();
}

export function rememberTitle(contentId, title) {
  if (!contentId || !title) return;
  if (titleCache.size > TITLE_CACHE_MAX) titleCache.clear();
  titleCache.set(contentId, title);
}

export function useContentTitle(contentId) {
  const parsed = splitContentId(contentId);
  const cached = contentId ? titleCache.get(contentId) : null;
  const path = cached ? null : contentInfoPath(parsed?.source, parsed?.localId);
  const { data } = useApiResource(path);
  useEffect(() => {
    if (data?.title) rememberTitle(contentId, data.title);
  }, [contentId, data]);
  return cached || data?.title || null;
}
